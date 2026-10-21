//! Stashes. A stash is addressed by its index (`stash@{index}`) as listed in
//! `RefsSnapshot::stashes`.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StashRequest {
    pub message: Option<String>,
    pub include_untracked: bool,
    /// Leave staged changes in the index (they are stashed too).
    pub keep_index: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StashOutcome {
    Applied,
    /// Applied with conflicts; the stash is kept even for a pop.
    Conflicts,
}

impl Git {
    /// `git stash push`. Returns false when there was nothing to stash.
    pub async fn stash_save(&self, repo: &Path, req: &StashRequest) -> Result<bool, GitError> {
        let mut args = vec!["stash".to_owned(), "push".into()];
        if req.include_untracked {
            args.push("--include-untracked".into());
        }
        if req.keep_index {
            args.push("--keep-index".into());
        }
        if let Some(message) = req.message.as_deref().filter(|m| !m.trim().is_empty()) {
            args.push(format!("--message={message}"));
        }
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                &args,
            )
            .await?;
        Ok(!lossy(&out.stdout).contains("No local changes to save"))
    }

    /// `git stash apply` (or `pop`, which drops it unless it conflicted). Restores the index
    /// too when it can (`--index`), falling back to a plain apply.
    pub async fn stash_apply(
        &self,
        repo: &Path,
        index: u32,
        pop: bool,
    ) -> Result<StashOutcome, GitError> {
        if self.has_conflicts(repo).await? {
            return Err(GitError::InvalidInput(
                "Resolve the conflicted files first.".to_owned(),
            ));
        }
        let stash = self.stash_ref(repo, index).await?;
        let mut attempt = self
            .attempt(repo, ["stash", "apply", "--index", &stash], &[])
            .await?;
        // The staged part doesn't apply to the current index: nothing was changed, so apply
        // the stash as plain working-tree changes instead.
        if !attempt.ok() && attempt.text().contains("Try without --index") {
            attempt = self.attempt(repo, ["stash", "apply", &stash], &[]).await?;
        }
        if attempt.ok() {
            if pop {
                self.run(Some(repo), ["stash", "drop", "-q", &stash])
                    .await?;
            }
            Ok(StashOutcome::Applied)
        } else if self.has_conflicts(repo).await? {
            Ok(StashOutcome::Conflicts)
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    pub async fn stash_drop(&self, repo: &Path, index: u32) -> Result<(), GitError> {
        let stash = self.stash_ref(repo, index).await?;
        self.run(Some(repo), ["stash", "drop", "-q", &stash])
            .await
            .map(|_| ())
    }

    /// `stash@{index}`, checked to exist.
    async fn stash_ref(&self, repo: &Path, index: u32) -> Result<String, GitError> {
        let stash = format!("stash@{{{index}}}");
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1, 128],
                    ..RunOptions::in_dir(repo)
                },
                ["rev-parse", "-q", "--verify", &format!("refs/{stash}")],
            )
            .await?;
        if out.code == Some(0) {
            Ok(stash)
        } else {
            Err(GitError::InvalidInput(format!("There's no {stash}.")))
        }
    }
}
