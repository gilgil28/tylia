//! Submodule updates, linked worktrees, and Git LFS detection.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, OpContext, RunOptions, lossy};
use crate::worktree::repo_path;

/// A working tree of the repository (`git worktree list`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Worktree {
    pub path: String,
    /// Checked-out commit; `None` for a bare entry.
    pub head: Option<String>,
    /// Checked-out branch (short name); `None` when detached or bare.
    pub branch: Option<String>,
    /// The main working tree (the first entry).
    pub main: bool,
    /// The one this repository view is showing.
    pub current: bool,
    pub locked: bool,
    /// Its folder is gone; `git worktree prune` would remove the entry.
    pub prunable: bool,
}

/// Whether the repository uses Git LFS, and whether Git LFS is installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LfsStatus {
    /// `.gitattributes` routes files through the `lfs` filter.
    pub used: bool,
    /// `git lfs` runs.
    pub installed: bool,
}

impl Git {
    /// `git submodule update --init --recursive` for `paths` (all when empty): clones missing
    /// submodules and checks out the recorded commits. Network: progress and cancel.
    pub async fn submodule_update(
        &self,
        repo: &Path,
        paths: &[String],
        ctx: OpContext<'_>,
    ) -> Result<(), GitError> {
        for p in paths {
            repo_path(repo, p)?;
        }
        let mut args = vec![
            "submodule".to_owned(),
            "update".into(),
            "--init".into(),
            "--recursive".into(),
            "--progress".into(),
            "--".into(),
        ];
        args.extend(paths.iter().cloned());
        self.run_operation(RunOptions::in_dir(repo), &args, ctx)
            .await
            .map(|_| ())
    }

    pub async fn worktrees(&self, repo: &Path) -> Result<Vec<Worktree>, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                ["worktree", "list", "--porcelain", "-z"],
            )
            .await?;
        let top = self
            .run(Some(repo), ["rev-parse", "--show-toplevel"])
            .await
            .map(|o| lossy(&o.stdout).trim().to_owned())
            .unwrap_or_default();
        Ok(parse_worktrees(&out.stdout, &top))
    }

    /// LFS use (from `.gitattributes` at the top level) and installation.
    pub async fn lfs_status(&self, repo: &Path) -> Result<LfsStatus, GitError> {
        let used = std::fs::read_to_string(repo.join(".gitattributes"))
            .map(|text| {
                text.lines()
                    .any(|l| !l.trim_start().starts_with('#') && l.contains("filter=lfs"))
            })
            .unwrap_or(false);
        let installed = used
            && self
                .run_with(
                    RunOptions {
                        ok_codes: &[1, 128],
                        ..RunOptions::in_dir(repo)
                    },
                    ["lfs", "version"],
                )
                .await
                .is_ok_and(|o| o.code == Some(0));
        Ok(LfsStatus { used, installed })
    }
}

/// Normalizes paths for comparison (Git prints `/` on Windows; the top level may differ in
/// case or separators).
fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    !a.is_empty() && norm(a) == norm(b)
}

/// Parses `git worktree list --porcelain -z`: records of NUL-terminated `key value` lines,
/// separated by an empty field.
fn parse_worktrees(out: &[u8], top: &str) -> Vec<Worktree> {
    let text = lossy(out);
    let mut list = Vec::new();
    let mut current: Option<Worktree> = None;
    for field in text.split('\0') {
        if field.is_empty() {
            list.extend(current.take());
            continue;
        }
        let (key, value) = field.split_once(' ').unwrap_or((field, ""));
        match key {
            "worktree" => {
                list.extend(current.take());
                current = Some(Worktree {
                    path: value.to_owned(),
                    head: None,
                    branch: None,
                    main: list.is_empty(),
                    current: same_path(value, top),
                    locked: false,
                    prunable: false,
                });
            }
            _ => {
                let Some(w) = current.as_mut() else { continue };
                match key {
                    "HEAD" => w.head = Some(value.to_owned()),
                    "branch" => {
                        w.branch = Some(
                            value
                                .strip_prefix("refs/heads/")
                                .unwrap_or(value)
                                .to_owned(),
                        )
                    }
                    "locked" => w.locked = true,
                    "prunable" => w.prunable = true,
                    _ => {}
                }
            }
        }
    }
    list.extend(current);
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_worktree_list() {
        let out = b"worktree C:/src/app\0HEAD aaa\0branch refs/heads/main\0\0worktree C:/src/app-fix\0HEAD bbb\0detached\0locked reason\0\0worktree C:/gone\0HEAD ccc\0branch refs/heads/old\0prunable gitdir file points to non-existent location\0\0";
        let list = parse_worktrees(out, "C:\\src\\app-fix\\");
        assert_eq!(list.len(), 3);
        assert!(list[0].main && !list[0].current);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert!(list[1].current && list[1].locked && list[1].branch.is_none());
        assert_eq!(list[1].head.as_deref(), Some("bbb"));
        assert!(list[2].prunable && !list[2].main);
    }
}
