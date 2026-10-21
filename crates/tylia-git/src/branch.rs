//! Branches and checkout.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::remote::{check_remote_name, push_error};
use crate::runner::{Git, OpContext, RunOptions};
use crate::stash::{StashOutcome, StashRequest};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export)]
pub enum CheckoutTarget {
    /// A local branch.
    Branch { name: String },
    /// A remote branch (`origin/feature/x`), checked out as a new local branch
    /// `local_name` that tracks it.
    Remote {
        remote_branch: String,
        local_name: String,
    },
    /// A commit, leaving HEAD detached.
    Detached { oid: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CheckoutRequest {
    pub target: CheckoutTarget,
    /// Stash local changes first and reapply them after switching ("stash & reapply"). Without
    /// it, changes that don't conflict are carried along (plain `git switch`) and conflicting
    /// ones make the checkout fail with [`GitError::LocalChanges`].
    pub stash: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CheckoutOutcome {
    Done,
    /// Switched, but reapplying the stashed changes conflicted: the conflicts are in the
    /// working tree and the stash is kept (`stash@{0}`).
    StashConflicts,
}

impl Git {
    /// `git branch <name> <start>` (or `switch -c` with `checkout`). `start` is any commit-ish
    /// (oid, branch, tag). Names are validated.
    pub async fn create_branch(
        &self,
        repo: &Path,
        name: &str,
        start: &str,
        checkout: bool,
    ) -> Result<(), GitError> {
        self.check_branch(name).await?;
        // The resolved oid, so the new branch never silently starts tracking `start`.
        let oid = self.resolve_commit(repo, start).await?;
        self.ensure_branch_free(repo, name).await?;
        if !checkout {
            return self
                .run(Some(repo), ["branch", name, &oid])
                .await
                .map(|_| ());
        }
        self.ensure_idle(repo).await?;
        let attempt = self
            .attempt(repo, ["switch", "-c", name, &oid], &[])
            .await?;
        if attempt.ok() {
            Ok(())
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    /// Switches branches (or to a commit). See [`CheckoutRequest::stash`].
    pub async fn checkout(
        &self,
        repo: &Path,
        req: &CheckoutRequest,
    ) -> Result<CheckoutOutcome, GitError> {
        // Everything is validated before any change, so a stash is never made in vain.
        let (args, label) = match &req.target {
            CheckoutTarget::Branch { name } => {
                self.check_branch(name).await?;
                if !self.ref_exists(repo, &format!("refs/heads/{name}")).await? {
                    return Err(GitError::InvalidInput(format!(
                        "There's no local branch “{name}”."
                    )));
                }
                if self.current_branch(repo).await?.as_deref() == Some(name.as_str()) {
                    return Ok(CheckoutOutcome::Done);
                }
                let args: Vec<String> = vec!["switch".into(), "--no-guess".into(), name.clone()];
                (args, name.clone())
            }
            CheckoutTarget::Remote {
                remote_branch,
                local_name,
            } => {
                self.check_remote_branch(remote_branch).await?;
                self.check_branch(local_name).await?;
                let full = format!("refs/remotes/{remote_branch}");
                if !self.ref_exists(repo, &full).await? {
                    return Err(GitError::InvalidInput(format!(
                        "There's no remote branch “{remote_branch}”. Fetch, then try again."
                    )));
                }
                self.ensure_branch_free(repo, local_name).await?;
                // The full ref name, so a local branch called `origin/x` can't shadow it.
                let args = vec![
                    "switch".into(),
                    "--track".into(),
                    "-c".into(),
                    local_name.clone(),
                    full,
                ];
                (args, local_name.clone())
            }
            CheckoutTarget::Detached { oid } => {
                let resolved = self.resolve_commit(repo, oid).await?;
                let label = resolved.chars().take(7).collect();
                (vec!["switch".into(), "--detach".into(), resolved], label)
            }
        };
        self.ensure_idle(repo).await?;

        let stashed = req.stash
            && self
                .stash_save(
                    repo,
                    &StashRequest {
                        message: Some(format!("Tylia: local changes, switching to {label}")),
                        include_untracked: true,
                        keep_index: false,
                    },
                )
                .await?;
        let attempt = self.attempt(repo, &args, &[]).await?;
        if !attempt.ok() {
            let err = self.failure(repo, attempt).await;
            if stashed {
                // Still on the original branch: put the changes back where they were. If
                // even that fails, the stash is kept (stash@{0}).
                let _ = self.stash_apply(repo, 0, true).await;
            }
            return Err(err);
        }
        if !stashed {
            return Ok(CheckoutOutcome::Done);
        }
        Ok(match self.stash_apply(repo, 0, true).await? {
            StashOutcome::Applied => CheckoutOutcome::Done,
            StashOutcome::Conflicts => CheckoutOutcome::StashConflicts,
        })
    }

    /// `git branch -m`. Renaming the current branch is allowed.
    pub async fn rename_branch(&self, repo: &Path, old: &str, new: &str) -> Result<(), GitError> {
        self.check_branch(old).await?;
        self.check_branch(new).await?;
        if !self.ref_exists(repo, &format!("refs/heads/{old}")).await? {
            return Err(GitError::InvalidInput(format!(
                "There's no local branch “{old}”."
            )));
        }
        // A case-only rename is left to Git (the refs may live on a case-insensitive disk).
        if !old.eq_ignore_ascii_case(new) {
            self.ensure_branch_free(repo, new).await?;
        }
        self.run(Some(repo), ["branch", "-m", old, new])
            .await
            .map(|_| ())
    }

    /// `git branch -d` (or `-D` with `force`). A branch with commits not merged anywhere
    /// fails with [`GitError::NotFullyMerged`] unless forced; the current branch can't be
    /// deleted.
    pub async fn delete_branch(
        &self,
        repo: &Path,
        name: &str,
        force: bool,
    ) -> Result<(), GitError> {
        self.check_branch(name).await?;
        if self.current_branch(repo).await?.as_deref() == Some(name) {
            return Err(GitError::InvalidInput(format!(
                "“{name}” is checked out. Switch to another branch before deleting it."
            )));
        }
        let flag = if force { "-D" } else { "-d" };
        let attempt = self
            .attempt(repo, ["branch", flag, "--", name], &[])
            .await?;
        if attempt.ok() {
            Ok(())
        } else if attempt.stderr.contains("not fully merged") {
            Err(GitError::NotFullyMerged {
                command: attempt.command,
                stderr: attempt.stderr,
            })
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    /// `git push <remote> --delete <branch>` (network: progress, cancel, credential prompts).
    /// A branch that is already gone from the remote only has its stale remote-tracking
    /// branch removed.
    pub async fn delete_remote_branch(
        &self,
        repo: &Path,
        remote: &str,
        branch: &str,
        ctx: OpContext<'_>,
    ) -> Result<(), GitError> {
        check_remote_name(remote)?;
        self.check_branch(branch).await?;
        let refspec = format!(":refs/heads/{branch}");
        let args = ["push", "--progress", "--porcelain", "--", remote, &refspec];
        match self
            .run_operation(RunOptions::in_dir(repo), args, ctx)
            .await
        {
            Ok(_) => Ok(()),
            Err(GitError::Failed { stderr, .. })
                if stderr.contains("remote ref does not exist") =>
            {
                let tracking = format!("refs/remotes/{remote}/{branch}");
                self.run(Some(repo), ["update-ref", "-d", &tracking])
                    .await
                    .map(|_| ())
            }
            Err(err) => Err(push_error(err)),
        }
    }

    /// Sets `branch`'s upstream to `upstream` (`origin/main`), or removes it with `None`.
    pub async fn set_upstream(
        &self,
        repo: &Path,
        branch: &str,
        upstream: Option<&str>,
    ) -> Result<(), GitError> {
        self.check_branch(branch).await?;
        let Some(upstream) = upstream else {
            // Exit 128 "has no upstream information": already the requested state.
            let attempt = self
                .attempt(repo, ["branch", "--unset-upstream", branch], &[])
                .await?;
            return if attempt.ok() || attempt.stderr.contains("has no upstream information") {
                Ok(())
            } else {
                Err(self.failure(repo, attempt).await)
            };
        };
        if upstream.starts_with('-')
            || !(self
                .ref_exists(repo, &format!("refs/remotes/{upstream}"))
                .await?
                || self
                    .ref_exists(repo, &format!("refs/heads/{upstream}"))
                    .await?)
        {
            return Err(GitError::InvalidInput(format!(
                "There's no branch “{upstream}” to track."
            )));
        }
        self.run(
            Some(repo),
            ["branch", &format!("--set-upstream-to={upstream}"), branch],
        )
        .await
        .map(|_| ())
    }

    /// Refuses a new branch name that is taken.
    async fn ensure_branch_free(&self, repo: &Path, name: &str) -> Result<(), GitError> {
        if self.ref_exists(repo, &format!("refs/heads/{name}")).await? {
            Err(GitError::InvalidInput(format!(
                "A branch named “{name}” already exists."
            )))
        } else {
            Ok(())
        }
    }
}
