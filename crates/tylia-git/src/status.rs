//! Working tree status from `git status --porcelain=v2 -z`, plus the operation in progress
//! read from the git dir.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy, split_nul};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Unmerged,
    Untracked,
}

impl FileStatus {
    /// From a `git diff --name-status` / porcelain status letter; `None` for `.` (unchanged).
    pub fn from_letter(c: u8) -> Option<Self> {
        Some(match c {
            b'A' => Self::Added,
            b'M' => Self::Modified,
            b'D' => Self::Deleted,
            b'R' => Self::Renamed,
            b'C' => Self::Copied,
            b'T' => Self::TypeChanged,
            b'U' => Self::Unmerged,
            b'?' => Self::Untracked,
            _ => return None,
        })
    }
}

/// One changed path. A file can be both staged and unstaged (changed again after `add`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StatusEntry {
    pub path: String,
    /// Source of a staged rename or copy.
    pub old_path: Option<String>,
    /// Change in the index relative to HEAD.
    pub staged: Option<FileStatus>,
    /// Change in the working tree relative to the index.
    pub unstaged: Option<FileStatus>,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

/// A merge, rebase, cherry-pick or revert in progress (stopped on conflicts, or waiting to
/// be continued). Read from the files Git keeps in the git dir (`MERGE_HEAD`,
/// `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `sequencer/`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoOperation {
    pub kind: OperationKind,
    /// What is coming in: the merged branch (from `MERGE_MSG`, else a short oid), the
    /// commit being picked / reverted (short oid).
    pub incoming: Option<String>,
    /// Rebase: the branch being rebased (`head-name`, without `refs/heads/`).
    pub branch: Option<String>,
    /// Rebase: short oid of the commit being rebased onto.
    pub onto: Option<String>,
    /// Rebase: current step and total (`msgnum` / `end`).
    pub step: Option<u32>,
    pub total: Option<u32>,
    /// Interactive rebase: stopped at an `edit` step (`rebase-merge/amend`), not on
    /// conflicts; `incoming` is the commit to amend.
    pub editing: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorkingStatus {
    pub entries: Vec<StatusEntry>,
    /// Commit HEAD points at; `None` before the first commit.
    pub head_oid: Option<String>,
    /// Checked-out branch; `None` when detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Operation in progress, if any.
    pub operation: Option<RepoOperation>,
}

impl WorkingStatus {
    /// Files with any staged or unstaged change (the "Changes" count).
    pub fn changed_files(&self) -> usize {
        self.entries.len()
    }
}

impl Git {
    pub async fn status(&self, repo: &Path) -> Result<WorkingStatus, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    no_optional_locks: true,
                    ..RunOptions::in_dir(repo)
                },
                [
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--branch",
                    "--untracked-files=all",
                ],
            )
            .await?;
        let mut status = parse_status(&out.stdout)?;
        // A few stat calls, no extra Git process: status runs on every file change.
        status.operation = find_git_dir(repo).and_then(|dir| read_operation(&dir));
        Ok(status)
    }
}

/// The git dir of the repository whose working tree contains `repo`: a `.git` folder, or
/// the `gitdir: <path>` file of a linked worktree or submodule. `None` if there is neither
/// (the caller can ask `git rev-parse --git-dir`).
pub(crate) fn find_git_dir(repo: &Path) -> Option<PathBuf> {
    for dir in repo.ancestors() {
        let dot_git = dir.join(".git");
        let Ok(meta) = std::fs::metadata(&dot_git) else {
            continue;
        };
        if meta.is_dir() {
            return Some(dot_git);
        }
        let text = std::fs::read_to_string(&dot_git).ok()?;
        let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
        return Some(dir.join(target));
    }
    None
}

/// Short form of an oid for display.
fn short(oid: &str) -> String {
    oid.chars().take(7).collect()
}

/// The merge, rebase, cherry-pick or revert in progress in `git_dir`, from the files Git
/// keeps while one is stopped. `git am` (also `rebase-apply/`) is not reported.
pub(crate) fn read_operation(git_dir: &Path) -> Option<RepoOperation> {
    let read = |path: &Path| {
        std::fs::read_to_string(path)
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
    };
    let number = |path: &Path| read(path).and_then(|s| s.parse::<u32>().ok());
    let empty = |kind| RepoOperation {
        kind,
        incoming: None,
        branch: None,
        onto: None,
        step: None,
        total: None,
        editing: false,
    };

    for (dir, step, total) in [
        ("rebase-merge", "msgnum", "end"),
        ("rebase-apply", "next", "last"),
    ] {
        let dir = git_dir.join(dir);
        if !dir.is_dir() {
            continue;
        }
        if dir.join("applying").exists() {
            return None;
        }
        return Some(RepoOperation {
            incoming: read(&git_dir.join("REBASE_HEAD")).map(|oid| short(&oid)),
            branch: read(&dir.join("head-name"))
                .and_then(|name| name.strip_prefix("refs/heads/").map(str::to_owned)),
            onto: read(&dir.join("onto")).map(|oid| short(&oid)),
            step: number(&dir.join(step)),
            total: number(&dir.join(total)),
            editing: dir.join("amend").is_file(),
            ..empty(OperationKind::Rebase)
        });
    }
    if let Some(head) = read(&git_dir.join("MERGE_HEAD")) {
        let incoming = read(&git_dir.join("MERGE_MSG"))
            .and_then(|msg| merged_name(msg.lines().next().unwrap_or_default()))
            .unwrap_or_else(|| short(head.lines().next().unwrap_or_default()));
        return Some(RepoOperation {
            incoming: Some(incoming),
            ..empty(OperationKind::Merge)
        });
    }
    for (file, kind) in [
        ("CHERRY_PICK_HEAD", OperationKind::CherryPick),
        ("REVERT_HEAD", OperationKind::Revert),
    ] {
        if let Some(oid) = read(&git_dir.join(file)) {
            return Some(RepoOperation {
                incoming: Some(short(&oid)),
                ..empty(kind)
            });
        }
    }
    // A multi-commit cherry-pick / revert between steps: the next command in the todo list.
    let todo = read(&git_dir.join("sequencer").join("todo"))?;
    let (command, oid) = todo
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .and_then(|line| {
            let mut words = line.split_whitespace();
            Some((words.next()?, words.next()?))
        })?;
    let kind = match command {
        "pick" | "p" => OperationKind::CherryPick,
        "revert" => OperationKind::Revert,
        _ => return None,
    };
    Some(RepoOperation {
        incoming: Some(short(oid)),
        ..empty(kind)
    })
}

/// The branch or tag name from a merge message's first line ("Merge branch 'x'",
/// "Merge remote-tracking branch 'origin/x' into main", "Merge tag 'v1'").
fn merged_name(first_line: &str) -> Option<String> {
    let rest = [
        "Merge branch '",
        "Merge remote-tracking branch '",
        "Merge tag '",
    ]
    .iter()
    .find_map(|prefix| first_line.strip_prefix(prefix))?;
    let (name, _) = rest.split_once('\'')?;
    (!name.is_empty()).then(|| name.to_owned())
}

pub fn parse_status(out: &[u8]) -> Result<WorkingStatus, GitError> {
    const CMD: &str = "git status --porcelain=v2";
    let mut status = WorkingStatus::default();
    let mut records = split_nul(out);
    while let Some(rec) = records.next() {
        let line = lossy(rec);
        let bad = || GitError::parse(CMD, line.clone());
        match rec.first() {
            Some(b'#') => parse_header(&line, &mut status),
            Some(b'1') => {
                // 1 XY sub mH mI mW hH hI path
                let fields: Vec<&str> = line.splitn(9, ' ').collect();
                let (xy, path) = (
                    fields.get(1).ok_or_else(bad)?,
                    fields.get(8).ok_or_else(bad)?,
                );
                status.entries.push(entry(xy, path, None));
            }
            Some(b'2') => {
                // 2 XY sub mH mI mW hH hI Xscore path, then the original path as its own record.
                let fields: Vec<&str> = line.splitn(10, ' ').collect();
                let (xy, path) = (
                    fields.get(1).ok_or_else(bad)?,
                    fields.get(9).ok_or_else(bad)?,
                );
                let orig = records.next().map(lossy).ok_or_else(bad)?;
                status.entries.push(entry(xy, path, Some(orig)));
            }
            Some(b'u') => {
                // u XY sub m1 m2 m3 mW h1 h2 h3 path
                let fields: Vec<&str> = line.splitn(11, ' ').collect();
                let path = fields.get(10).ok_or_else(bad)?;
                status.entries.push(StatusEntry {
                    path: (*path).to_owned(),
                    old_path: None,
                    staged: None,
                    unstaged: Some(FileStatus::Unmerged),
                    conflicted: true,
                });
            }
            Some(b'?') => status.entries.push(StatusEntry {
                path: line[2..].to_owned(),
                old_path: None,
                staged: None,
                unstaged: Some(FileStatus::Untracked),
                conflicted: false,
            }),
            // Ignored files (`!`) are not requested; anything else is skipped.
            _ => {}
        }
    }
    Ok(status)
}

fn parse_header(line: &str, status: &mut WorkingStatus) {
    let Some((key, value)) = line.trim_start_matches("# ").split_once(' ') else {
        return;
    };
    match key {
        "branch.oid" if value != "(initial)" => status.head_oid = Some(value.to_owned()),
        "branch.head" if value != "(detached)" => status.branch = Some(value.to_owned()),
        "branch.upstream" => status.upstream = Some(value.to_owned()),
        "branch.ab" => {
            for part in value.split(' ') {
                if let Some(n) = part.strip_prefix('+') {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
        }
        _ => {}
    }
}

fn entry(xy: &str, path: &str, old_path: Option<String>) -> StatusEntry {
    let xy = xy.as_bytes();
    StatusEntry {
        path: path.to_owned(),
        old_path,
        staged: xy.first().and_then(|&c| FileStatus::from_letter(c)),
        unstaged: xy.get(1).and_then(|&c| FileStatus::from_letter(c)),
        conflicted: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let out = b"# branch.oid 1234567890123456789012345678901234567890\0\
# branch.head main\0\
# branch.upstream origin/main\0\
# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 aaa bbb src/app.ts\0\
1 A. N... 000000 100644 100644 000 ccc src/new file.ts\0\
2 R. N... 100644 100644 100644 ddd eee R100 lib/new.rs\0lib/old.rs\0\
u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.txt\0\
? notes.md\0";
        let s = parse_status(out).unwrap();
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert_eq!(s.changed_files(), 5);
        let e = &s.entries;
        assert_eq!(
            (e[0].staged, e[0].unstaged),
            (None, Some(FileStatus::Modified))
        );
        assert_eq!(e[1].path, "src/new file.ts");
        assert_eq!(e[1].staged, Some(FileStatus::Added));
        assert_eq!(e[2].path, "lib/new.rs");
        assert_eq!(e[2].old_path.as_deref(), Some("lib/old.rs"));
        assert_eq!(e[2].staged, Some(FileStatus::Renamed));
        assert!(e[3].conflicted);
        assert_eq!(e[4].unstaged, Some(FileStatus::Untracked));
    }

    #[test]
    fn merge_names() {
        assert_eq!(
            merged_name("Merge branch 'feature/x'").as_deref(),
            Some("feature/x")
        );
        assert_eq!(
            merged_name("Merge remote-tracking branch 'origin/main' into dev").as_deref(),
            Some("origin/main")
        );
        assert_eq!(merged_name("Merge tag 'v1.0'").as_deref(), Some("v1.0"));
        assert_eq!(merged_name("Merge commit 'abc123'"), None);
        assert_eq!(merged_name("Merge branches 'a' and 'b'"), None);
    }

    #[test]
    fn initial_and_detached() {
        let s = parse_status(b"# branch.oid (initial)\0# branch.head main\0").unwrap();
        assert_eq!(s.head_oid, None);
        assert_eq!(s.branch.as_deref(), Some("main"));
        let s = parse_status(b"# branch.oid abc\0# branch.head (detached)\0").unwrap();
        assert_eq!(s.branch, None);
        assert_eq!(s.head_oid.as_deref(), Some("abc"));
    }
}
