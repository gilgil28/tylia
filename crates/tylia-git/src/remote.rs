//! Fetch, pull, push and remote management.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, OpContext, RunOptions, lossy};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FetchRequest {
    /// `None` fetches every remote.
    pub remote: Option<String>,
    /// Remove remote-tracking branches that no longer exist on the remote.
    pub prune: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PullMode {
    #[default]
    Merge,
    Rebase,
    FfOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PullOutcome {
    UpToDate,
    Updated,
    /// The merge or rebase stopped on conflicts; the repository is mid-operation.
    Conflicts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PushRequest {
    pub remote: String,
    /// Local branch to push.
    pub branch: String,
    /// Branch name on the remote (usually the same).
    pub remote_branch: String,
    /// Make `remote/remote_branch` the branch's upstream (first push).
    pub set_upstream: bool,
    /// Also push all tags.
    pub tags: bool,
    /// Force push, but only if the remote branch is still at this commit (what the user last
    /// fetched; empty means "must not exist yet"). `None` is a normal push.
    pub force_lease: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PushOutcome {
    UpToDate,
    Pushed,
}

/// Why a push was refused, from `git push --porcelain`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PushRejection {
    /// The remote has commits the local branch doesn't (fetch first / non-fast-forward).
    Behind,
    /// Force-with-lease: the remote branch moved since it was last fetched.
    Stale,
    /// Refused by the server (hook, protected branch, permissions).
    Remote,
    Other,
}

impl Git {
    /// `git fetch` with progress.
    pub async fn fetch(
        &self,
        repo: &Path,
        req: &FetchRequest,
        ctx: OpContext<'_>,
    ) -> Result<(), GitError> {
        let mut args = vec!["fetch".to_owned(), "--progress".to_owned()];
        if req.prune {
            args.push("--prune".into());
        }
        match &req.remote {
            Some(remote) => {
                check_remote_name(remote)?;
                args.extend(["--".into(), remote.clone()]);
            }
            None => args.push("--all".into()),
        }
        self.run_operation(RunOptions::in_dir(repo), &args, ctx)
            .await
            .map(|_| ())
    }

    /// Pulls the current branch from its upstream.
    pub async fn pull(
        &self,
        repo: &Path,
        mode: PullMode,
        ctx: OpContext<'_>,
    ) -> Result<PullOutcome, GitError> {
        let opts = RunOptions {
            c_locale: true,
            ..RunOptions::in_dir(repo)
        };
        // Checked first for a clear message; Git's own is about "tracking information".
        let upstream = self
            .run_with(
                opts,
                [
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{upstream}",
                ],
            )
            .await;
        if upstream.is_err() {
            let branch = self.current_branch(repo).await?;
            return Err(GitError::InvalidInput(match branch {
                Some(b) => format!("{b} has no upstream branch to pull from. Push it first."),
                None => "HEAD is detached; check out a branch to pull.".to_owned(),
            }));
        }
        let before = self.head_oid(repo).await?;
        let mode_arg = match mode {
            PullMode::Merge => "--no-rebase",
            PullMode::Rebase => "--rebase",
            PullMode::FfOnly => "--ff-only",
        };
        let result = self
            .run_operation(
                RunOptions::in_dir(repo),
                ["pull", "--progress", "--no-edit", mode_arg],
                ctx,
            )
            .await;
        match result {
            Ok(_) if self.head_oid(repo).await? == before => Ok(PullOutcome::UpToDate),
            Ok(_) => Ok(PullOutcome::Updated),
            Err(err @ GitError::Failed { .. }) => {
                if self.has_conflicts(repo).await? {
                    Ok(PullOutcome::Conflicts)
                } else {
                    Err(err)
                }
            }
            Err(err) => Err(err),
        }
    }

    /// Pushes `req.branch` to `req.remote`.
    pub async fn push(
        &self,
        repo: &Path,
        req: &PushRequest,
        ctx: OpContext<'_>,
    ) -> Result<PushOutcome, GitError> {
        check_remote_name(&req.remote)?;
        self.check_branch_name(&req.branch).await?;
        self.check_branch_name(&req.remote_branch).await?;
        let remote_ref = format!("refs/heads/{}", req.remote_branch);
        let mut args = vec!["push".to_owned(), "--progress".into(), "--porcelain".into()];
        if req.set_upstream {
            args.push("--set-upstream".into());
        }
        if req.tags {
            args.push("--tags".into());
        }
        if let Some(expected) = &req.force_lease {
            if !(expected.is_empty() || expected.bytes().all(|b| b.is_ascii_hexdigit())) {
                return Err(GitError::InvalidInput(format!(
                    "Invalid commit id: {expected}"
                )));
            }
            args.push(format!("--force-with-lease={remote_ref}:{expected}"));
        }
        args.extend([
            "--".into(),
            req.remote.clone(),
            format!("refs/heads/{}:{remote_ref}", req.branch),
        ]);
        self.run_operation(RunOptions::in_dir(repo), &args, ctx)
            .await
            .map(|out| push_outcome(&lossy(&out.stdout)))
            .map_err(push_error)
    }

    /// Whether the index has unmerged entries.
    pub async fn has_conflicts(&self, repo: &Path) -> Result<bool, GitError> {
        let out = self.run(Some(repo), ["ls-files", "--unmerged"]).await?;
        Ok(!out.stdout.is_empty())
    }

    pub async fn add_remote(&self, repo: &Path, name: &str, url: &str) -> Result<(), GitError> {
        check_remote_name(name)?;
        let url = check_url(url)?;
        self.run(Some(repo), ["remote", "add", "--", name, url])
            .await
            .map(|_| ())
    }

    /// Sets the fetch URL, or the push URL with `push`. An empty push URL removes it, so
    /// pushes use the fetch URL again.
    pub async fn set_remote_url(
        &self,
        repo: &Path,
        name: &str,
        url: &str,
        push: bool,
    ) -> Result<(), GitError> {
        check_remote_name(name)?;
        if push && url.trim().is_empty() {
            let key = format!("remote.{name}.pushurl");
            return self
                .run_with(
                    RunOptions {
                        ok_codes: &[5],
                        ..RunOptions::in_dir(repo)
                    },
                    ["config", "--unset-all", &key],
                )
                .await
                .map(|_| ());
        }
        let url = check_url(url)?;
        let mut args = vec!["remote", "set-url"];
        if push {
            args.push("--push");
        }
        args.extend(["--", name, url]);
        self.run(Some(repo), args).await.map(|_| ())
    }

    pub async fn rename_remote(&self, repo: &Path, old: &str, new: &str) -> Result<(), GitError> {
        check_remote_name(old)?;
        check_remote_name(new)?;
        self.run(Some(repo), ["remote", "rename", "--", old, new])
            .await
            .map(|_| ())
    }

    /// Removes the remote with its remote-tracking branches.
    pub async fn remove_remote(&self, repo: &Path, name: &str) -> Result<(), GitError> {
        check_remote_name(name)?;
        self.run(Some(repo), ["remote", "remove", "--", name])
            .await
            .map(|_| ())
    }
}

/// Remote names become ref path components (`refs/remotes/<name>/…`).
pub(crate) fn check_remote_name(name: &str) -> Result<(), GitError> {
    let ok = !name.is_empty()
        && !name.starts_with(['-', '.'])
        && !name.ends_with(['.', '/'])
        && !name.ends_with(".lock")
        && !name.contains("..")
        && !name.contains("//")
        && !name.contains("@{")
        && !name
            .chars()
            .any(|c| c.is_control() || " ~^:?*[\\".contains(c));
    if ok {
        Ok(())
    } else {
        Err(GitError::InvalidInput(format!(
            "“{name}” isn't a valid remote name"
        )))
    }
}

fn check_url(url: &str) -> Result<&str, GitError> {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') {
        Err(GitError::InvalidInput(format!("Invalid remote URL: {url}")))
    } else {
        Ok(url)
    }
}

/// A failed `push --porcelain` whose output has a rejected ref becomes
/// [`GitError::PushRejected`].
pub(crate) fn push_error(err: GitError) -> GitError {
    match err {
        GitError::Failed {
            command,
            code,
            stderr,
        } => match push_rejection(&stderr) {
            Some(reason) => GitError::PushRejected {
                command,
                reason,
                stderr,
            },
            None => GitError::Failed {
                command,
                code,
                stderr,
            },
        },
        err => err,
    }
}

/// `--porcelain` lines are `<flag>\t<from>:<to>\t<summary>`; `=` means up to date.
fn porcelain_flags(stdout: &str) -> impl Iterator<Item = (char, &str)> {
    stdout.lines().filter_map(|line| {
        let mut fields = line.splitn(3, '\t');
        let flag = fields.next()?;
        let _refs = fields.next()?;
        let summary = fields.next()?;
        let mut chars = flag.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) => Some((c, summary)),
            _ => None,
        }
    })
}

fn push_outcome(stdout: &str) -> PushOutcome {
    if porcelain_flags(stdout).all(|(flag, _)| flag == '=') {
        PushOutcome::UpToDate
    } else {
        PushOutcome::Pushed
    }
}

fn push_rejection(stdout: &str) -> Option<PushRejection> {
    let (_, summary) = porcelain_flags(stdout).find(|(flag, _)| *flag == '!')?;
    Some(if summary.starts_with("[remote rejected]") {
        PushRejection::Remote
    } else if summary.contains("stale info") {
        PushRejection::Stale
    } else if summary.contains("fetch first") || summary.contains("non-fast-forward") {
        PushRejection::Behind
    } else {
        PushRejection::Other
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_names() {
        for ok in ["origin", "upstream", "my-fork", "team/a"] {
            assert!(check_remote_name(ok).is_ok(), "{ok}");
        }
        for bad in ["", "-x", ".x", "a..b", "a b", "a:b", "x.lock", "a/"] {
            assert!(check_remote_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn parses_push_porcelain() {
        let up_to_date = "To ../remote\n=\trefs/heads/main:refs/heads/main\t[up to date]\nDone\n";
        assert_eq!(push_outcome(up_to_date), PushOutcome::UpToDate);
        let pushed = "To ../remote\n \trefs/heads/main:refs/heads/main\tabc..def\nDone\n";
        assert_eq!(push_outcome(pushed), PushOutcome::Pushed);
        let behind =
            "To ../remote\n!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\nDone\n";
        assert_eq!(push_rejection(behind), Some(PushRejection::Behind));
        let stale = "!\trefs/heads/main:refs/heads/main\t[rejected] (stale info)\n";
        assert_eq!(push_rejection(stale), Some(PushRejection::Stale));
        let hook =
            "!\trefs/heads/main:refs/heads/main\t[remote rejected] (pre-receive hook declined)\n";
        assert_eq!(push_rejection(hook), Some(PushRejection::Remote));
        assert_eq!(push_rejection(pushed), None);
    }
}
