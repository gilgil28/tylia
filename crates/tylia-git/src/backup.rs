//! Backups of discarded changes (Phase 11 C, ARCHITECTURE §5.22).
//!
//! Before Tylia discards working-tree changes (files, hunks or lines, or a hard reset), it
//! snapshots the affected files as a tree through a temporary index, and again afterwards.
//! The backup is a commit of the "before" tree whose parent is a commit of the "after"
//! tree, with the files listed in its message, kept by `refs/tylia/discarded/<id>`.
//! Restoring merges each file three ways (base: after, theirs: before, ours: now), so a
//! file changed since is merged, never overwritten.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::ops::literal_pathspecs_env;
use crate::runner::{Git, RunOptions, lossy};

const BACKUPS: &str = "refs/tylia/discarded";
/// Kept regardless of age…
const KEEP_COUNT: usize = 50;
/// …and any younger than this.
const KEEP_SECS: i64 = 14 * 24 * 60 * 60;

/// What discarded the changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DiscardKind {
    Files,
    Lines,
    Reset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiscardBackup {
    /// Names the backup for [`Git::restore_backup`].
    pub id: String,
    /// Seconds since the Unix epoch.
    #[ts(type = "number")]
    pub time: i64,
    pub kind: DiscardKind,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RestoreOutcome {
    pub restored: Vec<String>,
    /// Changed since and merged with conflict markers.
    pub conflicts: Vec<String>,
    /// Changed since in a way that can't be merged (binary, deleted); left as they are.
    pub skipped: Vec<String>,
}

/// The "before" snapshot, waiting for [`Git::backup_finish`].
#[derive(Debug)]
pub struct BackupPending {
    kind: DiscardKind,
    paths: Vec<String>,
    before: String,
}

/// Backup commits are Tylia's, not the user's: they don't need the user's identity.
fn identity_env() -> Vec<(String, String)> {
    [
        ("GIT_AUTHOR_NAME", "Tylia"),
        ("GIT_AUTHOR_EMAIL", "tylia@localhost"),
        ("GIT_COMMITTER_NAME", "Tylia"),
        ("GIT_COMMITTER_EMAIL", "tylia@localhost"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect()
}

impl Git {
    /// Snapshots `paths` before they are discarded; `None` when there's nothing to keep.
    pub async fn backup_begin(
        &self,
        repo: &Path,
        kind: DiscardKind,
        paths: &[String],
    ) -> Result<Option<BackupPending>, GitError> {
        // A path with a line break can't be listed in the commit message.
        let paths: Vec<String> = paths
            .iter()
            .filter(|p| !p.contains('\n'))
            .cloned()
            .collect();
        if paths.is_empty() {
            return Ok(None);
        }
        let before = self.snapshot_paths(repo, &paths).await?;
        Ok(Some(BackupPending {
            kind,
            paths,
            before,
        }))
    }

    /// [`Git::backup_begin`] for every tracked file with changes (before a hard reset).
    pub async fn backup_begin_all(
        &self,
        repo: &Path,
        kind: DiscardKind,
    ) -> Result<Option<BackupPending>, GitError> {
        let paths = self.changed_tracked_files(repo).await?;
        self.backup_begin(repo, kind, &paths).await
    }

    /// Stores the backup begun with [`Git::backup_begin`]; returns its id.
    pub async fn backup_finish(
        &self,
        repo: &Path,
        pending: BackupPending,
    ) -> Result<Option<String>, GitError> {
        let after = self.snapshot_paths(repo, &pending.paths).await?;
        if after == pending.before {
            return Ok(None);
        }
        let env = identity_env();
        let opts = RunOptions {
            env: &env,
            ..RunOptions::in_dir(repo)
        };
        let base = self
            .run_with(opts, ["commit-tree", &after, "-m", "after discarding"])
            .await?;
        let base = lossy(&base.stdout).trim().to_owned();
        let kind = serde_json::to_string(&pending.kind).expect("kind serializes");
        let message = format!("{}\n\n{}", kind.trim_matches('"'), pending.paths.join("\n"));
        let backup = self
            .run_with(
                opts,
                ["commit-tree", &pending.before, "-p", &base, "-m", &message],
            )
            .await?;
        let backup = lossy(&backup.stdout).trim().to_owned();
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis())
            .to_string();
        self.run(
            Some(repo),
            ["update-ref", &format!("{BACKUPS}/{id}"), &backup],
        )
        .await?;
        Ok(Some(id))
    }

    /// Backups, newest first.
    pub async fn discard_backups(&self, repo: &Path) -> Result<Vec<DiscardBackup>, GitError> {
        let out = self
            .run(
                Some(repo),
                [
                    "for-each-ref",
                    "--sort=-committerdate",
                    "--format=%(refname)%00%(committerdate:unix)%00%(contents:subject)%00%(contents:body)%01",
                    BACKUPS,
                ],
            )
            .await?;
        let text = lossy(&out.stdout);
        Ok(text
            .split('\u{1}')
            .filter_map(|record| {
                let mut fields = record.trim_start_matches('\n').split('\0');
                let id = fields
                    .next()?
                    .strip_prefix(BACKUPS)?
                    .trim_start_matches('/');
                let time = fields.next()?.parse().ok()?;
                let kind = serde_json::from_str(&format!("\"{}\"", fields.next()?)).ok()?;
                let files = fields
                    .next()?
                    .lines()
                    .filter(|l| !l.is_empty())
                    .map(str::to_owned)
                    .collect();
                Some(DiscardBackup {
                    id: id.to_owned(),
                    time,
                    kind,
                    files,
                })
            })
            .collect())
    }

    /// Brings a backup's files back; the backup is dropped once everything came back cleanly.
    pub async fn restore_backup(&self, repo: &Path, id: &str) -> Result<RestoreOutcome, GitError> {
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
            return Err(GitError::InvalidInput(format!("There's no backup {id}.")));
        }
        let name = format!("{BACKUPS}/{id}");
        if !self.ref_exists(repo, &name).await? {
            return Err(GitError::InvalidInput(
                "That backup no longer exists.".to_owned(),
            ));
        }
        let files = self
            .discard_backups(repo)
            .await?
            .into_iter()
            .find(|b| b.id == id)
            .map(|b| b.files)
            .unwrap_or_default();
        let mut outcome = RestoreOutcome::default();
        for path in files {
            let full = crate::worktree::repo_path(repo, &path)?;
            let base = self.blob_at(repo, &format!("{name}^1"), &path).await?;
            let theirs = self.blob_at(repo, &name, &path).await?;
            let ours = if full.exists() {
                Some(self.hash_file(repo, &path).await?)
            } else {
                None
            };
            if ours == theirs {
                continue;
            }
            if ours == base {
                match &theirs {
                    Some(_) => {
                        let content = self.smudged(repo, &name, &path).await?;
                        if let Some(dir) = full.parent() {
                            std::fs::create_dir_all(dir).map_err(io)?;
                        }
                        std::fs::write(&full, content).map_err(io)?;
                    }
                    None => std::fs::remove_file(&full).map_err(io)?,
                }
                outcome.restored.push(path);
                continue;
            }
            match (ours.is_some(), base.is_some(), theirs.is_some()) {
                (true, true, true) => match self.merge_into(repo, &name, &path, &full).await? {
                    Some(0) => outcome.restored.push(path),
                    Some(_) => outcome.conflicts.push(path),
                    None => outcome.skipped.push(path),
                },
                _ => outcome.skipped.push(path),
            }
        }
        if outcome.conflicts.is_empty() && outcome.skipped.is_empty() {
            self.run(Some(repo), ["update-ref", "-d", &name]).await?;
        }
        Ok(outcome)
    }

    /// Drops backups beyond the newest [`KEEP_COUNT`] that are older than 14 days.
    pub async fn prune_backups(&self, repo: &Path) -> Result<(), GitError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        let stdin: String = self
            .discard_backups(repo)
            .await?
            .iter()
            .skip(KEEP_COUNT)
            .filter(|b| now - b.time > KEEP_SECS)
            .map(|b| format!("delete {BACKUPS}/{}\n", b.id))
            .collect();
        if stdin.is_empty() {
            return Ok(());
        }
        self.run_with(
            RunOptions {
                stdin: Some(stdin.as_bytes()),
                ..RunOptions::in_dir(repo)
            },
            ["update-ref", "--stdin"],
        )
        .await
        .map(|_| ())
    }

    /// A tree of the index with `paths` taken from the working tree, built in a temporary
    /// index so the real one is untouched.
    async fn snapshot_paths(&self, repo: &Path, paths: &[String]) -> Result<String, GitError> {
        let git_dir = self.git_dir(repo).await?;
        let dir = git_dir.join("tylia");
        std::fs::create_dir_all(&dir).map_err(io)?;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let index = TempFile(dir.join(format!("backup-index-{nanos}")));
        if git_dir.join("index").exists() {
            std::fs::copy(git_dir.join("index"), &index.0).map_err(io)?;
        }
        let mut env = literal_pathspecs_env();
        env.push((
            "GIT_INDEX_FILE".to_owned(),
            index.0.to_string_lossy().into_owned(),
        ));
        let opts = RunOptions {
            env: &env,
            ..RunOptions::in_dir(repo)
        };
        let mut args = vec!["add", "-A", "--"];
        args.extend(paths.iter().map(String::as_str));
        self.run_with(opts, &args).await?;
        let tree = self.run_with(opts, ["write-tree"]).await?;
        Ok(lossy(&tree.stdout).trim().to_owned())
    }

    /// The blob id of `path` in `rev`, if it has one.
    async fn blob_at(
        &self,
        repo: &Path,
        rev: &str,
        path: &str,
    ) -> Result<Option<String>, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1, 128],
                    ..RunOptions::in_dir(repo)
                },
                ["rev-parse", "-q", "--verify", &format!("{rev}:{path}")],
            )
            .await?;
        Ok((out.code == Some(0)).then(|| lossy(&out.stdout).trim().to_owned()))
    }

    /// The blob id the working-tree file would get (clean filters and line endings applied).
    async fn hash_file(&self, repo: &Path, path: &str) -> Result<String, GitError> {
        let out = self.run(Some(repo), ["hash-object", "--", path]).await?;
        Ok(lossy(&out.stdout).trim().to_owned())
    }

    /// `rev:path` as it would be checked out (smudge filters and line endings applied).
    async fn smudged(&self, repo: &Path, rev: &str, path: &str) -> Result<Vec<u8>, GitError> {
        let out = self
            .run(
                Some(repo),
                ["cat-file", "--filters", &format!("{rev}:{path}")],
            )
            .await?;
        Ok(out.stdout)
    }

    /// Merges the backup's version of `path` into the working-tree file; returns the
    /// number of conflicts, or `None` when the file can't be merged (binary).
    async fn merge_into(
        &self,
        repo: &Path,
        backup: &str,
        path: &str,
        full: &Path,
    ) -> Result<Option<i32>, GitError> {
        let dir = self.git_dir(repo).await?.join("tylia");
        let base = TempFile(dir.join("merge-base"));
        let theirs = TempFile(dir.join("merge-theirs"));
        std::fs::write(
            &base.0,
            self.smudged(repo, &format!("{backup}^1"), path).await?,
        )
        .map_err(io)?;
        std::fs::write(&theirs.0, self.smudged(repo, backup, path).await?).map_err(io)?;
        let full_text = full.to_string_lossy();
        let base_text = base.0.to_string_lossy();
        let theirs_text = theirs.0.to_string_lossy();
        let out = self
            .run_with(
                RunOptions {
                    // 1..=127: the number of conflicts; 255 (-1): an error (binary).
                    ok_codes: &(1..=255).collect::<Vec<_>>(),
                    ..RunOptions::in_dir(repo)
                },
                [
                    "merge-file",
                    "-L",
                    "current",
                    "-L",
                    "when discarded",
                    "-L",
                    "discarded",
                    &full_text,
                    &base_text,
                    &theirs_text,
                ],
            )
            .await?;
        Ok(match out.code {
            Some(code) if (0..=127).contains(&code) => Some(code),
            _ => None,
        })
    }
}

fn io(err: std::io::Error) -> GitError {
    GitError::InvalidInput(format!("Couldn't restore the files: {err}"))
}

/// Removed when dropped.
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
