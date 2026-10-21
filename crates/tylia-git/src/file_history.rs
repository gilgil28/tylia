//! A file's history ("Log selected…"): the commits that changed it, following renames
//! (`git log --follow`), with the file's path and change at each one. Paged.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::ops::check_rev;
use crate::runner::{Git, RunOptions, lossy};
use crate::status::FileStatus;
use crate::worktree::repo_path;

/// Starts each commit's record (records also contain NUL-separated name-status fields).
const RECORD_START: u8 = 0x1e;
const FIELD_SEP: char = '\x1f';
const FORMAT: &str = "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s";
/// Upper bound for one page.
const MAX_PAGE: u32 = 1000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileHistoryEntry {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    #[ts(type = "number")]
    pub time: i64,
    pub subject: String,
    /// The file's path in this commit.
    pub path: String,
    /// The path before this commit, when it renamed or copied the file.
    pub old_path: Option<String>,
    /// The change against the first parent; `None` for a merge that didn't change the file
    /// relative to its first parent.
    pub status: Option<FileStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileHistoryPage {
    /// Newest first.
    pub entries: Vec<FileHistoryEntry>,
    /// More entries follow (request the next page with `skip` + `entries.len()`).
    pub more: bool,
}

impl Git {
    /// Commits that changed `path`, newest first, starting at `rev` (`None`: HEAD) and
    /// following renames. Returns up to `limit` entries after skipping `skip`.
    pub async fn file_history(
        &self,
        repo: &Path,
        path: &str,
        rev: Option<&str>,
        skip: u32,
        limit: u32,
    ) -> Result<FileHistoryPage, GitError> {
        repo_path(repo, path)?;
        if let Some(rev) = rev {
            check_rev(rev)?;
        }
        let limit = limit.clamp(1, MAX_PAGE);
        let skip_arg = format!("--skip={skip}");
        // One more than asked for, to know whether another page follows.
        let count_arg = format!("--max-count={}", limit + 1);
        let args = [
            "log",
            "--follow",
            "-z",
            "-M",
            "--name-status",
            "--diff-merges=first-parent",
            "--no-ext-diff",
            FORMAT,
            &skip_arg,
            &count_arg,
            rev.unwrap_or("HEAD"),
            "--",
            path,
        ];
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                args,
            )
            .await;
        let out = match out {
            Ok(out) => out,
            // An unborn branch has no history yet.
            Err(err) if rev.is_none() && self.head_oid(repo).await?.is_none() => {
                drop(err);
                return Ok(FileHistoryPage {
                    entries: Vec::new(),
                    more: false,
                });
            }
            Err(err) => return Err(err),
        };
        let mut entries = parse_log(&out.stdout, path);
        let more = entries.len() > limit as usize;
        entries.truncate(limit as usize);
        Ok(FileHistoryPage { entries, more })
    }
}

/// Parses `log -z --name-status` with [`FORMAT`]: each commit is `RS fields NUL`, then
/// (unless the commit didn't change the file) `\n STATUS NUL path NUL`, with two paths for a
/// rename or copy. `path` is the requested path: the file's name in the newest commit.
fn parse_log(out: &[u8], path: &str) -> Vec<FileHistoryEntry> {
    let mut entries: Vec<FileHistoryEntry> = Vec::new();
    // The file's name as the walk goes back in time (changes at each rename).
    let mut current = path.to_owned();
    let mut tokens = out.split(|&b| b == 0);
    while let Some(token) = tokens.next() {
        let token = token.strip_prefix(b"\n").unwrap_or(token);
        if let Some(record) = token.strip_prefix(&[RECORD_START]) {
            if let Some(entry) = parse_record(&lossy(record), &current) {
                entries.push(entry);
            }
            continue;
        }
        let Some(&letter) = token.first() else {
            continue;
        };
        let two_paths = matches!(letter, b'R' | b'C');
        let first = tokens.next().map(lossy).unwrap_or_default();
        let (old_path, new_path) = if two_paths {
            (Some(first), tokens.next().map(lossy).unwrap_or_default())
        } else {
            (None, first)
        };
        let Some(entry) = entries.last_mut() else {
            continue;
        };
        // Only the file itself is listed; keep the first status if Git ever repeats it.
        if entry.status.is_some() {
            continue;
        }
        entry.status = FileStatus::from_letter(letter);
        entry.path = new_path;
        if let Some(old) = &old_path {
            current = old.clone();
        } else {
            current = entry.path.clone();
        }
        entry.old_path = old_path;
    }
    entries
}

fn parse_record(record: &str, path: &str) -> Option<FileHistoryEntry> {
    let mut f = record.splitn(6, FIELD_SEP);
    Some(FileHistoryEntry {
        oid: f.next()?.to_owned(),
        parents: f.next()?.split_whitespace().map(str::to_owned).collect(),
        author_name: f.next()?.to_owned(),
        author_email: f.next()?.to_owned(),
        time: f.next()?.parse().ok()?,
        subject: f.next()?.to_owned(),
        path: path.to_owned(),
        old_path: None,
        status: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_records_with_renames() {
        let out = b"\x1ec4\x1fc3\x1fAda\x1fada@x\x1f40\x1fEdit\0\nM\0b.txt\0\
\x1ec3\x1fc2 m1\x1fAda\x1fada@x\x1f30\x1fMerge\0\
\x1ec2\x1fc1\x1fBob\x1fbob@x\x1f20\x1fMove \x1f it\0\nR100\0a.txt\0b.txt\0\
\x1ec1\x1f\x1fBob\x1fbob@x\x1f10\x1fAdd\0\nA\0a.txt\0";
        let entries = parse_log(out, "b.txt");
        let got: Vec<_> = entries
            .iter()
            .map(|e| {
                (
                    e.oid.as_str(),
                    e.path.as_str(),
                    e.old_path.as_deref(),
                    e.status,
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                ("c4", "b.txt", None, Some(FileStatus::Modified)),
                ("c3", "b.txt", None, None),
                ("c2", "b.txt", Some("a.txt"), Some(FileStatus::Renamed)),
                ("c1", "a.txt", None, Some(FileStatus::Added)),
            ]
        );
        assert_eq!(entries[1].parents, ["c2", "m1"]);
        assert_eq!(entries[2].subject, "Move \x1f it");
        assert!(entries[3].parents.is_empty());
    }
}
