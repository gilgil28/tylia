//! Git LFS beyond the toolbar badge (`extras.rs` detects it): which files are LFS files,
//! tracking a pattern, pulling the objects, and file locks. Every `git lfs` call needs Git LFS
//! installed; `lfs_files` doesn't (it reads the attributes).

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, OpContext, RunOptions, lossy};
use crate::worktree::repo_path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LfsLock {
    pub id: String,
    pub path: String,
    /// The lock owner's name on the server.
    pub owner: String,
    /// RFC 3339.
    pub locked_at: String,
}

/// The server's locks, split into the user's and everyone else's (`git lfs locks --verify`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LfsLocks {
    pub ours: Vec<LfsLock>,
    pub theirs: Vec<LfsLock>,
}

fn invalid(msg: impl Into<String>) -> GitError {
    GitError::InvalidInput(msg.into())
}

impl Git {
    /// The paths among `paths` that Git LFS stores (`filter=lfs` in the attributes).
    pub async fn lfs_files(&self, repo: &Path, paths: &[String]) -> Result<Vec<String>, GitError> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        let mut input = Vec::new();
        for p in paths {
            input.extend_from_slice(p.as_bytes());
            input.push(0);
        }
        let out = self
            .run_with(
                RunOptions {
                    stdin: Some(&input),
                    ..RunOptions::in_dir(repo)
                },
                ["check-attr", "-z", "--stdin", "filter"],
            )
            .await?;
        Ok(parse_check_attr(&lossy(&out.stdout), "lfs"))
    }

    /// `git lfs track <pattern>`: Git LFS stores matching files from now on (it writes
    /// `.gitattributes`, which the user then commits). Existing commits are unchanged.
    pub async fn lfs_track(&self, repo: &Path, pattern: &str) -> Result<(), GitError> {
        let pattern = pattern.trim();
        if pattern.is_empty() || pattern.starts_with('-') || pattern.contains(['\n', '\0']) {
            return Err(invalid(format!(
                "“{pattern}” isn't a pattern Git LFS can track."
            )));
        }
        self.run(Some(repo), ["lfs", "track", pattern])
            .await
            .map(|_| ())
    }

    /// `git lfs pull`: downloads the LFS objects of the checked-out commit and puts them in
    /// the working tree. Network: progress and cancel through `ctx`.
    pub async fn lfs_pull(&self, repo: &Path, ctx: OpContext<'_>) -> Result<(), GitError> {
        self.run_operation(RunOptions::in_dir(repo), ["lfs", "pull"], ctx)
            .await
            .map(|_| ())
    }

    /// The server's locks (network).
    pub async fn lfs_locks(&self, repo: &Path, ctx: OpContext<'_>) -> Result<LfsLocks, GitError> {
        let out = self
            .run_operation(
                RunOptions::in_dir(repo),
                ["lfs", "locks", "--verify", "--json"],
                ctx,
            )
            .await?;
        parse_locks(&lossy(&out.stdout))
            .ok_or_else(|| invalid("Git LFS sent locks Tylia can't read."))
    }

    /// Locks `path` on the server, so others can't push changes to it (network).
    pub async fn lfs_lock(
        &self,
        repo: &Path,
        path: &str,
        ctx: OpContext<'_>,
    ) -> Result<(), GitError> {
        repo_path(repo, path)?;
        self.run_operation(RunOptions::in_dir(repo), ["lfs", "lock", "--", path], ctx)
            .await
            .map(|_| ())
    }

    /// Releases the user's lock on `path` (network). Someone else's lock can't be released here.
    pub async fn lfs_unlock(
        &self,
        repo: &Path,
        path: &str,
        ctx: OpContext<'_>,
    ) -> Result<(), GitError> {
        repo_path(repo, path)?;
        self.run_operation(RunOptions::in_dir(repo), ["lfs", "unlock", "--", path], ctx)
            .await
            .map(|_| ())
    }
}

/// `git check-attr -z`: `path\0attribute\0value\0` triplets; the paths whose value is `value`.
fn parse_check_attr(out: &str, value: &str) -> Vec<String> {
    let fields: Vec<&str> = out.split('\0').collect();
    fields
        .chunks(3)
        .filter(|c| c.len() == 3 && c[2] == value)
        .map(|c| c[0].to_owned())
        .collect()
}

/// `git lfs locks --verify --json`: `{"ours": [...], "theirs": [...]}`, each lock with
/// `id`, `path`, `owner.name` and `locked_at`.
fn parse_locks(json: &str) -> Option<LfsLocks> {
    #[derive(Deserialize)]
    struct Owner {
        name: String,
    }
    #[derive(Deserialize)]
    struct Raw {
        id: String,
        path: String,
        owner: Option<Owner>,
        locked_at: String,
    }
    #[derive(Deserialize)]
    struct Verified {
        #[serde(default)]
        ours: Vec<Raw>,
        #[serde(default)]
        theirs: Vec<Raw>,
    }
    let convert = |raw: Vec<Raw>| {
        raw.into_iter()
            .map(|r| LfsLock {
                id: r.id,
                path: r.path,
                owner: r.owner.map(|o| o.name).unwrap_or_default(),
                locked_at: r.locked_at,
            })
            .collect()
    };
    let verified: Verified = serde_json::from_str(json.trim()).ok()?;
    Some(LfsLocks {
        ours: convert(verified.ours),
        theirs: convert(verified.theirs),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_attr_picks_the_lfs_paths() {
        let out =
            "art/logo.psd\0filter\0lfs\0src/a.rs\0filter\0unspecified\0a b.bin\0filter\0lfs\0";
        assert_eq!(parse_check_attr(out, "lfs"), ["art/logo.psd", "a b.bin"]);
        assert!(parse_check_attr("", "lfs").is_empty());
    }

    #[test]
    fn locks_are_read_from_the_verified_json() {
        let json = r#"{"ours":[{"id":"1","path":"art/logo.psd","owner":{"name":"ada"},
            "locked_at":"2026-10-22T10:00:00Z"}],
            "theirs":[{"id":"2","path":"level.bin","owner":{"name":"bob"},
            "locked_at":"2026-10-21T09:00:00Z"}]}"#;
        let locks = parse_locks(json).unwrap();
        assert_eq!(locks.ours[0].path, "art/logo.psd");
        assert_eq!(locks.ours[0].owner, "ada");
        assert_eq!(locks.theirs[0].owner, "bob");
        assert_eq!(
            parse_locks(r#"{"ours":[],"theirs":[]}"#),
            Some(LfsLocks::default())
        );
        assert_eq!(parse_locks("not json"), None);
    }
}
