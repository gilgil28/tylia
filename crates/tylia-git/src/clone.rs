//! `git clone` with progress and cancellation.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::repo::RepoInfo;
use crate::runner::{Git, OpContext, RunOptions, lossy};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloneRequest {
    pub url: String,
    /// Folder to create; must not exist or be empty.
    pub destination: String,
    /// Branch to check out instead of the remote's default.
    pub branch: Option<String>,
    /// Shallow clone with this many commits.
    pub depth: Option<u32>,
}

/// A progress line from Git, e.g. "Receiving objects: 45% (450/1000)".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Progress {
    /// Git's phase name, e.g. "Receiving objects".
    pub phase: String,
    pub percent: u8,
    #[ts(type = "number | null")]
    pub current: Option<u64>,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
}

impl Git {
    /// Clones into `req.destination`. Cancelling kills Git; the
    /// destination folder is then removed if this call created it (or emptied if it was an
    /// empty folder before), so no half-cloned repository is left behind.
    pub async fn clone_repo(
        &self,
        req: &CloneRequest,
        ctx: OpContext<'_>,
    ) -> Result<RepoInfo, GitError> {
        let url = req.url.trim();
        if url.is_empty() || url.starts_with('-') {
            return Err(GitError::InvalidInput(format!(
                "Invalid repository URL: {url}"
            )));
        }
        if let Some(branch) = &req.branch {
            self.check_branch_name(branch).await?;
        }
        let dest = PathBuf::from(req.destination.trim());
        let existed = dest.exists();
        if existed
            && dest
                .read_dir()
                .map(|mut d| d.next().is_some())
                .unwrap_or(true)
        {
            return Err(GitError::InvalidInput(format!(
                "{} already exists and isn't empty",
                dest.display()
            )));
        }

        let mut args: Vec<String> = vec!["clone".into(), "--progress".into()];
        if let Some(branch) = &req.branch {
            args.extend(["--branch".into(), branch.clone()]);
        }
        if let Some(depth) = req.depth {
            args.push(format!("--depth={depth}"));
        }
        args.extend(["--".into(), url.to_owned(), dest.display().to_string()]);
        if let Err(err) = self.run_operation(RunOptions::default(), &args, ctx).await {
            remove_partial(&dest, existed);
            return Err(err);
        }
        self.open_repo(&dest).await
    }

    /// Writes a commit-graph file, which lets `log --date-order` stream immediately instead of
    /// walking the whole history first (seconds on large repositories). Used after Tylia's
    /// own clones; never run on a user's existing repository without asking.
    pub async fn write_commit_graph(&self, repo: &Path) -> Result<(), GitError> {
        self.run(Some(repo), ["commit-graph", "write", "--reachable"])
            .await
            .map(|_| ())
    }

    /// Whether the repository has a commit-graph (a single file or a split chain).
    pub async fn has_commit_graph(&self, repo: &Path) -> Result<bool, GitError> {
        let out = self
            .run(
                Some(repo),
                [
                    "rev-parse",
                    "--git-path",
                    "objects/info/commit-graph",
                    "--git-path",
                    "objects/info/commit-graphs/commit-graph-chain",
                ],
            )
            .await?;
        Ok(lossy(&out.stdout).lines().any(|p| {
            let path = Path::new(p.trim());
            let path = if path.is_absolute() {
                path.to_owned()
            } else {
                repo.join(path)
            };
            path.is_file()
        }))
    }

    /// Validates a user-entered branch name with `git check-ref-format --branch`.
    pub async fn check_branch_name(&self, name: &str) -> Result<(), GitError> {
        self.run(None, ["check-ref-format", "--branch", name])
            .await
            .map(|_| ())
            .map_err(|_| GitError::InvalidInput(format!("“{name}” isn't a valid branch name")))
    }
}

/// Removes what a failed clone wrote: the whole folder if the clone created it, otherwise
/// only its contents (it was empty before).
fn remove_partial(dest: &Path, existed: bool) {
    if !existed {
        let _ = std::fs::remove_dir_all(dest);
    } else if let Ok(entries) = dest.read_dir() {
        for entry in entries.flatten() {
            let path = entry.path();
            let _ = if path.is_dir() {
                std::fs::remove_dir_all(path)
            } else {
                std::fs::remove_file(path)
            };
        }
    }
}

/// Parses "Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s" (with or without a
/// "remote: " prefix).
pub fn parse_progress(line: &str) -> Option<Progress> {
    let line = line.trim().trim_start_matches("remote: ");
    let (phase, rest) = line.split_once(':')?;
    let rest = rest.trim_start();
    let pct_end = rest.find('%')?;
    let percent: u8 = rest[..pct_end].trim().parse().ok()?;
    let counts = rest[pct_end..]
        .split_once('(')
        .and_then(|(_, r)| r.split_once(')'))
        .and_then(|(c, _)| c.split_once('/'));
    let (current, total) = match counts {
        Some((c, t)) => (c.parse().ok(), t.parse().ok()),
        None => (None, None),
    };
    Some(Progress {
        phase: phase.trim().to_owned(),
        percent: percent.min(100),
        current,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_lines() {
        let p =
            parse_progress("Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s").unwrap();
        assert_eq!(p.phase, "Receiving objects");
        assert_eq!((p.percent, p.current, p.total), (45, Some(450), Some(1000)));
        let p = parse_progress("remote: Counting objects: 100% (12/12), done.").unwrap();
        assert_eq!(p.phase, "Counting objects");
        assert_eq!(p.percent, 100);
        assert!(parse_progress("Cloning into 'x'...").is_none());
        assert!(parse_progress("fatal: repository not found").is_none());
    }
}
