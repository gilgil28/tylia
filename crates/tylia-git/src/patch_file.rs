//! Patch files: a commit saved with `git format-patch`, working-copy or staged changes saved
//! with `git diff --binary`, and previewing / applying one (`git apply`, `git am --3way`).
//! Not to be confused with `patch.rs`, which builds the patches of line staging.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::integrate::IntegrateOutcome;
use crate::ops::no_editor_env;
use crate::runner::{Git, RunOptions, lossy};

/// Patch files larger than this are refused (a preview reads the whole file).
const MAX_PATCH: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PatchFormat {
    /// `git format-patch` output: one mail per commit, with author and message.
    Mailbox,
    /// A plain diff (`git diff`, `diff -u`): changes only.
    Diff,
}

/// Whether the patch applies to the current working tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PatchCheck {
    Clean,
    /// Only with a three-way merge, which may leave conflicts to resolve.
    ThreeWay,
    Fails,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PatchFileChange {
    pub path: String,
    /// The path before a rename or copy.
    pub old_path: Option<String>,
    /// Line counts; `None` for binary files.
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PatchPreview {
    pub format: PatchFormat,
    /// Mailbox: the commits' subjects, in order.
    pub commits: Vec<String>,
    pub files: Vec<PatchFileChange>,
    pub check: PatchCheck,
    /// Git's explanation when the patch doesn't apply cleanly.
    pub check_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PatchApplyMode {
    /// Change the files (`git apply`, then `--3way` if needed); nothing is committed.
    WorkingTree,
    /// Mailbox only: create its commits (`git am --3way`).
    Commits,
}

fn invalid(msg: impl Into<String>) -> GitError {
    GitError::InvalidInput(msg.into())
}

impl Git {
    /// Saves commit `oid` as a mailbox patch (`git format-patch`) to `file`.
    pub async fn save_commit_patch(
        &self,
        repo: &Path,
        oid: &str,
        file: &Path,
    ) -> Result<(), GitError> {
        let oid = self.resolve_commit(repo, oid).await?;
        let out = self
            .run(
                Some(repo),
                ["format-patch", "-1", "--stdout", "--no-signature", &oid],
            )
            .await?;
        Ok(std::fs::write(file, out.stdout)?)
    }

    /// Saves the staged (`staged`) or unstaged changes of tracked files as a diff with
    /// binary data (`git diff --binary`) to `file`. Untracked files aren't part of either.
    pub async fn save_changes_patch(
        &self,
        repo: &Path,
        staged: bool,
        file: &Path,
    ) -> Result<(), GitError> {
        // -M: renames as renames whatever diff.renames says (smaller, and they apply as such).
        let mut args = vec!["diff", "--binary", "-M", "--no-ext-diff", "--no-textconv"];
        if staged {
            args.push("--cached");
        }
        let out = self.run(Some(repo), args).await?;
        if out.stdout.is_empty() {
            return Err(invalid(if staged {
                "There are no staged changes to save."
            } else {
                "There are no unstaged changes to save (new files must be staged first)."
            }));
        }
        Ok(std::fs::write(file, out.stdout)?)
    }

    /// What applying `file` would do: its commits (a mailbox), the files it touches, and
    /// whether it applies cleanly, only with a three-way merge, or not at all.
    pub async fn preview_patch(&self, repo: &Path, file: &Path) -> Result<PatchPreview, GitError> {
        let text = read_patch(file)?;
        let commits = mailbox_subjects(&text);
        let file_arg = file.as_os_str();
        let numstat = self
            .run_with(
                RunOptions {
                    ok_codes: &[1, 128],
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                [
                    "apply".as_ref(),
                    "--numstat".as_ref(),
                    "-z".as_ref(),
                    "--".as_ref(),
                    file_arg,
                ],
            )
            .await?;
        if numstat.code != Some(0) {
            return Err(invalid(format!(
                "{} isn't a patch Git can read: {}",
                file.display(),
                lossy(&numstat.stderr).trim()
            )));
        }
        let renames = renames(&text);
        let mut files = parse_numstat(&lossy(&numstat.stdout));
        for file in &mut files {
            if file.old_path.is_none() {
                file.old_path = renames
                    .iter()
                    .find(|(_, new)| *new == file.path)
                    .map(|(old, _)| old.clone());
            }
        }
        if files.is_empty() {
            return Err(invalid(format!("{} changes no files.", file.display())));
        }

        let check = |three_way: bool| {
            let mut args = vec!["apply".as_ref(), "--check".as_ref()];
            if three_way {
                args.push("--3way".as_ref());
            }
            args.extend(["--".as_ref(), file_arg]);
            self.run_with(
                RunOptions {
                    ok_codes: &[1, 128],
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                args,
            )
        };
        let plain = check(false).await?;
        let (check, check_message) = if plain.code == Some(0) {
            (PatchCheck::Clean, None)
        } else {
            let message = Some(lossy(&plain.stderr).trim().to_owned());
            if check(true).await?.code == Some(0) {
                (PatchCheck::ThreeWay, message)
            } else {
                (PatchCheck::Fails, message)
            }
        };
        Ok(PatchPreview {
            format: if commits.is_empty() {
                PatchFormat::Diff
            } else {
                PatchFormat::Mailbox
            },
            commits,
            files,
            check,
            check_message,
        })
    }

    /// Applies `file`: to the working tree (falling back to a three-way merge, which may
    /// leave conflicted files), or as commits with `git am --3way`, which stops on
    /// conflicts like a rebase (continue / skip / abort).
    pub async fn apply_patch_file(
        &self,
        repo: &Path,
        file: &Path,
        mode: PatchApplyMode,
    ) -> Result<IntegrateOutcome, GitError> {
        self.ensure_idle(repo).await?;
        let text = read_patch(file)?;
        let file_arg = file.to_string_lossy().into_owned();
        match mode {
            PatchApplyMode::WorkingTree => {
                let plain = self
                    .attempt(repo, ["apply", "--", file_arg.as_str()], &[])
                    .await?;
                if plain.ok() {
                    return Ok(IntegrateOutcome::Done);
                }
                let merged = self
                    .attempt(repo, ["apply", "--3way", "--", file_arg.as_str()], &[])
                    .await?;
                if merged.ok() {
                    Ok(IntegrateOutcome::Done)
                } else if self.has_conflicts(repo).await? {
                    Ok(IntegrateOutcome::Conflicts)
                } else {
                    Err(self.failure(repo, plain).await)
                }
            }
            PatchApplyMode::Commits => {
                if mailbox_subjects(&text).is_empty() {
                    return Err(invalid(
                        "This patch has no commits (it isn't from git format-patch). Apply it to the working copy instead.",
                    ));
                }
                // am strips a CR at the end of each line (mail converts line endings), which
                // breaks the patches of CRLF files. Keep them, unless the whole mailbox has
                // CRLF line endings, its headers included (saved from a mail client).
                let mut args = vec!["am", "--3way"];
                if !text.lines().next().is_some_and(|line| line.ends_with('\r')) {
                    args.push("--keep-cr");
                }
                args.extend(["--", file_arg.as_str()]);
                let attempt = self.attempt(repo, args, &no_editor_env()).await?;
                if attempt.ok() {
                    Ok(IntegrateOutcome::Done)
                } else if self.has_conflicts(repo).await? {
                    Ok(IntegrateOutcome::Conflicts)
                } else {
                    // Stopped without conflicts (a patch that doesn't apply at all): the am
                    // is in progress; Git's message says why, the banner offers skip / abort.
                    Err(self.failure(repo, attempt).await)
                }
            }
        }
    }
}

fn read_patch(file: &Path) -> Result<String, GitError> {
    let size = std::fs::metadata(file)?.len();
    if size > MAX_PATCH {
        return Err(invalid(format!(
            "{} is too large for a patch ({} MB).",
            file.display(),
            size / 1024 / 1024
        )));
    }
    Ok(String::from_utf8_lossy(&std::fs::read(file)?).into_owned())
}

/// The subjects of a mailbox's patches (`From <oid> <date>` lines start each one), without
/// the `[PATCH n/m]` prefix; empty for a plain diff.
fn mailbox_subjects(text: &str) -> Vec<String> {
    let mut subjects = Vec::new();
    let mut in_headers = false;
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        let line = line.trim_end_matches('\r');
        if line.starts_with("From ") && line.len() > 5 {
            in_headers = true;
            continue;
        }
        if !in_headers {
            continue;
        }
        if line.is_empty() {
            in_headers = false;
        } else if let Some(subject) = line.strip_prefix("Subject:") {
            // Folded headers continue on lines that start with whitespace.
            let mut subject = subject.trim().to_owned();
            while let Some(next) = lines.peek() {
                if !next.starts_with([' ', '\t']) {
                    break;
                }
                subject.push(' ');
                subject.push_str(next.trim());
                lines.next();
            }
            let subject = match subject.strip_prefix('[') {
                Some(rest) if subject.starts_with("[PATCH") => {
                    rest.split_once(']').map_or(rest, |(_, s)| s).trim()
                }
                _ => subject.as_str(),
            };
            subjects.push(subject.to_owned());
        }
    }
    subjects
}

/// `(old, new)` from each diff's `rename from` / `rename to` (or `copy …`) headers, which
/// `git apply --numstat` doesn't report.
fn renames(text: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut from = None;
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(path) = line
            .strip_prefix("rename from ")
            .or_else(|| line.strip_prefix("copy from "))
        {
            from = Some(unquote(path));
        } else if let Some(path) = line
            .strip_prefix("rename to ")
            .or_else(|| line.strip_prefix("copy to "))
            && let Some(old) = from.take()
        {
            pairs.push((old, unquote(path)));
        }
    }
    pairs
}

/// A path as Git writes it in patch headers: as is, or C-quoted when it has special
/// characters (`"a\"b\tc"`).
fn unquote(path: &str) -> String {
    let Some(inner) = path.strip_prefix('"').and_then(|p| p.strip_suffix('"')) else {
        return path.to_owned();
    };
    let mut bytes = Vec::new();
    let mut chars = inner.bytes().peekable();
    while let Some(b) = chars.next() {
        if b != b'\\' {
            bytes.push(b);
            continue;
        }
        match chars.next() {
            Some(b'n') => bytes.push(b'\n'),
            Some(b't') => bytes.push(b'\t'),
            Some(d @ b'0'..=b'7') => {
                // Up to three octal digits: a byte of a UTF-8 sequence.
                let mut value = u32::from(d - b'0');
                for _ in 0..2 {
                    match chars.peek() {
                        Some(&o @ b'0'..=b'7') => {
                            value = value * 8 + u32::from(o - b'0');
                            chars.next();
                        }
                        _ => break,
                    }
                }
                bytes.push(value as u8);
            }
            Some(other) => bytes.push(other),
            None => {}
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `git apply --numstat -z`: `added\tremoved\tpath\0`, or for a rename / copy
/// `added\tremoved\t\0old\0new\0`; `-\t-` for binary files.
fn parse_numstat(out: &str) -> Vec<PatchFileChange> {
    let mut files = Vec::new();
    let mut fields = out.split('\0');
    while let Some(record) = fields.next() {
        let mut parts = record.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (path, old_path) = if path.is_empty() {
            let old = fields.next().unwrap_or_default().to_owned();
            let new = fields.next().unwrap_or_default().to_owned();
            (new, Some(old))
        } else {
            (path.to_owned(), None)
        };
        files.push(PatchFileChange {
            path,
            old_path,
            added: added.parse().ok(),
            removed: removed.parse().ok(),
        });
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mailbox_subjects_read_each_mail_and_drop_the_patch_prefix() {
        let mbox = "From 1234567890abcdef Mon Sep 17 00:00:00 2001\n\
                    From: Ada <ada@example.com>\n\
                    Subject: [PATCH 1/2] graph: draw merge curves\n\
                    \x20as beziers\n\
                    \n\
                    body\n\
                    ---\n\
                    diff --git a/a b/a\n\
                    From 2234567890abcdef Mon Sep 17 00:00:00 2001\r\n\
                    Subject: fix the parser\r\n\
                    \r\n";
        assert_eq!(
            mailbox_subjects(mbox),
            ["graph: draw merge curves as beziers", "fix the parser"]
        );
        assert!(mailbox_subjects("diff --git a/a b/a\n--- a/a\n+++ b/a\n").is_empty());
    }

    #[test]
    fn renames_come_from_the_headers_and_quoted_paths_are_unquoted() {
        let patch = "diff --git a/old name.txt b/new name.txt\n\
                     similarity index 100%\n\
                     rename from old name.txt\n\
                     rename to new name.txt\n\
                     diff --git \"a/tab\\there\" \"b/caf\\303\\251\"\n\
                     rename from \"tab\\there\"\n\
                     rename to \"caf\\303\\251\"\n";
        assert_eq!(
            renames(patch),
            [
                ("old name.txt".to_owned(), "new name.txt".to_owned()),
                ("tab\there".to_owned(), "café".to_owned()),
            ]
        );
    }

    #[test]
    fn numstat_reads_renames_and_binary_files() {
        let out = "3\t1\tsrc/a.rs\0-\t-\tlogo.png\x000\t0\t\0old name.txt\0new name.txt\0";
        assert_eq!(
            parse_numstat(out),
            [
                PatchFileChange {
                    path: "src/a.rs".into(),
                    old_path: None,
                    added: Some(3),
                    removed: Some(1)
                },
                PatchFileChange {
                    path: "logo.png".into(),
                    old_path: None,
                    added: None,
                    removed: None
                },
                PatchFileChange {
                    path: "new name.txt".into(),
                    old_path: Some("old name.txt".into()),
                    added: Some(0),
                    removed: Some(0)
                },
            ]
        );
    }
}
