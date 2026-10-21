//! Tags.

use std::path::Path;

use crate::error::GitError;
use crate::remote::{check_remote_name, push_error};
use crate::runner::{Git, OpContext, RunOptions};

impl Git {
    /// Creates a tag on `target` (any commit-ish): annotated with `message`, lightweight
    /// without (a blank message also makes a lightweight tag). Fails if the tag exists.
    pub async fn create_tag(
        &self,
        repo: &Path,
        name: &str,
        target: &str,
        message: Option<&str>,
    ) -> Result<(), GitError> {
        self.check_tag(name).await?;
        let oid = self.resolve_commit(repo, target).await?;
        if self.ref_exists(repo, &format!("refs/tags/{name}")).await? {
            return Err(GitError::InvalidInput(format!(
                "A tag named “{name}” already exists."
            )));
        }
        match message.filter(|m| !m.trim().is_empty()) {
            // The message goes through stdin: no editor, no quoting issues.
            Some(message) => self
                .run_with(
                    RunOptions {
                        stdin: Some(message.as_bytes()),
                        ..RunOptions::in_dir(repo)
                    },
                    ["tag", "-a", "-F", "-", name, &oid],
                )
                .await
                .map(|_| ()),
            None => self.run(Some(repo), ["tag", name, &oid]).await.map(|_| ()),
        }
    }

    pub async fn delete_tag(&self, repo: &Path, name: &str) -> Result<(), GitError> {
        self.check_tag(name).await?;
        self.run(Some(repo), ["tag", "-d", name]).await.map(|_| ())
    }

    /// `git push <remote> refs/tags/<name>` (network).
    pub async fn push_tag(
        &self,
        repo: &Path,
        remote: &str,
        name: &str,
        ctx: OpContext<'_>,
    ) -> Result<(), GitError> {
        check_remote_name(remote)?;
        self.check_tag(name).await?;
        let full = format!("refs/tags/{name}");
        if !self.ref_exists(repo, &full).await? {
            return Err(GitError::InvalidInput(format!("There's no tag “{name}”.")));
        }
        let refspec = format!("{full}:{full}");
        self.run_operation(
            RunOptions::in_dir(repo),
            ["push", "--progress", "--porcelain", "--", remote, &refspec],
            ctx,
        )
        .await
        .map(|_| ())
        .map_err(push_error)
    }
}
