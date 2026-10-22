//! Merge, rebase, cherry-pick, revert, reset, and the operations they can leave in
//! progress (continue / skip / abort, resolving conflicts).
//!
//! Git never opens an editor here (see [`no_editor_env`]): merges keep MERGE_MSG, picks keep
//! the picked commit's message.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::ops::{Attempt, check_paths, literal_pathspecs_env, no_editor_env};
use crate::runner::{Git, RunOptions, lossy, split_nul};
use crate::status::{OperationKind, RepoOperation};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FastForward {
    /// Fast-forward when possible, else a merge commit (Git's default).
    #[default]
    Allow,
    /// `--ff-only`: refuse if a merge commit would be needed.
    Only,
    /// `--no-ff`: always create a merge commit.
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum IntegrateOutcome {
    /// Nothing to do (already merged / up to date).
    UpToDate,
    FastForward,
    /// Completed: a merge commit, rebased commits, a cherry-picked or reverting commit.
    Done,
    /// Stopped on conflicts; the repository is now mid-operation (see `WorkingStatus::operation`).
    Conflicts,
    /// An interactive rebase paused at an `edit` step (no conflicts): amend or add commits,
    /// then continue. The rebase is in progress.
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ResetMode {
    /// Keep index and working tree.
    Soft,
    /// Keep the working tree, reset the index.
    Mixed,
    /// Discard staged and unstaged changes to tracked files.
    Hard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ConflictSide {
    /// The current branch's version (HEAD, "ours"; during a rebase, the branch being
    /// rebased onto).
    Ours,
    /// The incoming version ("theirs").
    Theirs,
}

impl Git {
    /// Merges `rev` (branch, tag or oid) into the current branch; never opens an editor.
    pub async fn merge(
        &self,
        repo: &Path,
        rev: &str,
        ff: FastForward,
    ) -> Result<IntegrateOutcome, GitError> {
        self.ensure_idle(repo).await?;
        let target = self.resolve_commit(repo, rev).await?;
        let ff_arg = match ff {
            FastForward::Allow => "--ff",
            FastForward::Only => "--ff-only",
            FastForward::Never => "--no-ff",
        };
        let before = self.head_oid(repo).await?;
        // `rev` as given (validated), so the message reads "Merge branch 'x'".
        let attempt = self
            .attempt(
                repo,
                ["merge", "--no-edit", "--no-autostash", ff_arg, rev],
                &no_editor_env(),
            )
            .await?;
        self.finish_start(repo, attempt, before, Some(&target))
            .await
    }

    /// Rebases the current branch onto `onto`.
    pub async fn rebase(&self, repo: &Path, onto: &str) -> Result<IntegrateOutcome, GitError> {
        self.ensure_idle(repo).await?;
        let target = self.resolve_commit(repo, onto).await?;
        let before = self.head_oid(repo).await?;
        let attempt = self
            .attempt(
                repo,
                ["rebase", "--no-autostash", &target],
                &no_editor_env(),
            )
            .await?;
        self.finish_start(repo, attempt, before, Some(&target))
            .await
    }

    /// Cherry-picks one commit onto HEAD (a merge commit relative to its first parent).
    /// A pick whose changes are already in HEAD changes nothing and returns `UpToDate`.
    pub async fn cherry_pick(&self, repo: &Path, oid: &str) -> Result<IntegrateOutcome, GitError> {
        self.pick(repo, oid, OperationKind::CherryPick).await
    }

    /// Creates a commit that reverts `oid` (a merge commit relative to its first parent).
    /// A revert that changes nothing (already reverted) returns `UpToDate`.
    pub async fn revert(&self, repo: &Path, oid: &str) -> Result<IntegrateOutcome, GitError> {
        self.pick(repo, oid, OperationKind::Revert).await
    }

    /// Moves the current branch (or detached HEAD) to `oid`.
    pub async fn reset(&self, repo: &Path, oid: &str, mode: ResetMode) -> Result<(), GitError> {
        let target = self.resolve_commit(repo, oid).await?;
        let mode = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        let attempt = self
            .attempt(repo, ["reset", "-q", mode, &target, "--"], &[])
            .await?;
        if attempt.ok() {
            Ok(())
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    /// Continues the operation in progress after conflicts are resolved and staged, keeping
    /// Git's prepared message. `Conflicts` when the next rebase / pick step conflicts.
    pub async fn continue_operation(&self, repo: &Path) -> Result<IntegrateOutcome, GitError> {
        let op = self.current_operation(repo, "continue").await?;
        if self.has_conflicts(repo).await? {
            return Err(GitError::InvalidInput(
                "Some files still have conflicts. Resolve them and mark them resolved first."
                    .to_owned(),
            ));
        }
        let env = no_editor_env();
        let attempt = match op.kind {
            // `merge --continue` is `git commit`; with the prepared MERGE_MSG, minus the
            // commented "# Conflicts:" section an editor session would strip.
            OperationKind::Merge => {
                self.attempt(repo, ["commit", "--no-edit", "--cleanup=strip"], &env)
                    .await?
            }
            OperationKind::Rebase => self.attempt(repo, ["rebase", "--continue"], &env).await?,
            OperationKind::CherryPick => {
                self.attempt(repo, ["cherry-pick", "--continue"], &env)
                    .await?
            }
            OperationKind::Revert => self.attempt(repo, ["revert", "--continue"], &env).await?,
            OperationKind::Am => self.attempt(repo, ["am", "--continue"], &env).await?,
        };
        if attempt.ok() {
            return self.after_step(repo, op.kind).await;
        }
        if self.has_conflicts(repo).await? {
            return Ok(IntegrateOutcome::Conflicts);
        }
        // The resolution left nothing to commit: drop this pick, as a rebase does.
        if matches!(
            op.kind,
            OperationKind::CherryPick | OperationKind::Revert | OperationKind::Am
        ) && self
            .operation(repo)
            .await?
            .is_some_and(|o| o.kind == op.kind)
            && self.index_matches_head(repo).await?
        {
            return self.skip_operation(repo).await;
        }
        Err(self.failure(repo, attempt).await)
    }

    /// Skips the current commit of a rebase, cherry-pick, revert or `git am`.
    pub async fn skip_operation(&self, repo: &Path) -> Result<IntegrateOutcome, GitError> {
        let op = self.current_operation(repo, "skip").await?;
        let command = match op.kind {
            OperationKind::Merge => {
                return Err(GitError::InvalidInput(
                    "A merge can't be skipped. Abort it instead.".to_owned(),
                ));
            }
            OperationKind::Rebase => "rebase",
            OperationKind::CherryPick => "cherry-pick",
            OperationKind::Revert => "revert",
            OperationKind::Am => "am",
        };
        let attempt = self
            .attempt(repo, [command, "--skip"], &no_editor_env())
            .await?;
        if attempt.ok() {
            self.after_step(repo, op.kind).await
        } else if self.has_conflicts(repo).await? {
            Ok(IntegrateOutcome::Conflicts)
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    /// Aborts the operation in progress, restoring the state before it started.
    pub async fn abort_operation(&self, repo: &Path) -> Result<(), GitError> {
        let op = self.current_operation(repo, "abort").await?;
        let command = match op.kind {
            OperationKind::Merge => "merge",
            OperationKind::Rebase => "rebase",
            OperationKind::CherryPick => "cherry-pick",
            OperationKind::Revert => "revert",
            OperationKind::Am => "am",
        };
        let attempt = self
            .attempt(repo, [command, "--abort"], &no_editor_env())
            .await?;
        if attempt.ok() {
            Ok(())
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    /// Resolves conflicted files by taking one side whole, and stages them. Where the chosen
    /// side deleted the file (a delete/modify conflict), the resolution is to remove it.
    pub async fn resolve_with(
        &self,
        repo: &Path,
        paths: &[String],
        side: ConflictSide,
    ) -> Result<(), GitError> {
        check_paths(paths)?;
        let stages = self.unmerged_stages(repo).await?;
        let (stage, flag) = match side {
            ConflictSide::Ours => (2, "--ours"),
            ConflictSide::Theirs => (3, "--theirs"),
        };
        let mut take = Vec::new();
        let mut remove = Vec::new();
        for path in paths {
            let Some(present) = stages.get(path) else {
                return Err(GitError::InvalidInput(format!(
                    "“{path}” isn't conflicted."
                )));
            };
            if present[stage] {
                take.push(path.as_str());
            } else {
                remove.push(path.as_str());
            }
        }
        let env = literal_pathspecs_env();
        let opts = RunOptions {
            env: &env,
            ..RunOptions::in_dir(repo)
        };
        if !take.is_empty() {
            let mut args = vec!["checkout", flag, "--"];
            args.extend(&take);
            self.run_with(opts, &args).await?;
            let mut args = vec!["add", "--"];
            args.extend(&take);
            self.run_with(opts, &args).await?;
        }
        if !remove.is_empty() {
            let mut args = vec!["rm", "-q", "-f", "--"];
            args.extend(&remove);
            self.run_with(opts, &args).await?;
        }
        Ok(())
    }

    /// Marks conflicted files resolved as they are in the working tree (stages them; a file
    /// deleted in the working tree is removed).
    pub async fn mark_resolved(&self, repo: &Path, paths: &[String]) -> Result<(), GitError> {
        check_paths(paths)?;
        let (present, deleted): (Vec<&str>, Vec<&str>) = paths
            .iter()
            .map(String::as_str)
            .partition(|p| repo.join(p).symlink_metadata().is_ok());
        let env = literal_pathspecs_env();
        let opts = RunOptions {
            env: &env,
            ..RunOptions::in_dir(repo)
        };
        if !present.is_empty() {
            let mut args = vec!["add", "--"];
            args.extend(&present);
            self.run_with(opts, &args).await?;
        }
        if !deleted.is_empty() {
            let mut args = vec!["rm", "-q", "--cached", "--"];
            args.extend(&deleted);
            self.run_with(opts, &args).await?;
        }
        Ok(())
    }

    /// Opens the user's configured merge tool (`git mergetool --no-prompt`) for one file and
    /// waits for it to close. Fails with [`GitError::InvalidInput`] when no GUI merge tool is
    /// configured (`merge.tool`), rather than starting a terminal tool nobody can see.
    pub async fn merge_tool(&self, repo: &Path, path: &str) -> Result<(), GitError> {
        let paths = [path.to_owned()];
        check_paths(&paths)?;
        let (gui, tool) = match (
            self.config_value(repo, "merge.guitool").await?,
            self.config_value(repo, "merge.tool").await?,
        ) {
            (Some(tool), _) => (true, tool),
            (None, Some(tool)) => (false, tool),
            (None, None) => {
                return Err(GitError::InvalidInput(
                    "No merge tool is configured. Set merge.tool (or merge.guitool) in your Git \
                     config to a graphical merge tool, such as meld, kdiff3 or vscode."
                        .to_owned(),
                ));
            }
        };
        if is_terminal_tool(&tool) {
            return Err(GitError::InvalidInput(format!(
                "The configured merge tool “{tool}” runs in a terminal. Set merge.guitool to a \
                 graphical merge tool to use it from Tylia."
            )));
        }
        if !self.unmerged_stages(repo).await?.contains_key(path) {
            return Err(GitError::InvalidInput(format!(
                "“{path}” isn't conflicted."
            )));
        }
        let mut args = Vec::new();
        // Git's default keeps a `<file>.orig` backup, which then shows up as a new file.
        if self
            .config_value(repo, "mergetool.keepBackup")
            .await?
            .is_none()
        {
            args.extend(["-c", "mergetool.keepBackup=false"]);
        }
        args.push("mergetool");
        if gui {
            args.push("--gui");
        }
        args.extend(["--no-prompt", "--", path]);
        // The user's locale, not C: the tool inherits the environment.
        self.run_with(RunOptions::in_dir(repo), &args)
            .await
            .map(|_| ())
    }

    /// Opens the user's configured diff tool (`git difftool --no-prompt`) for one file of a
    /// commit, the index or the working tree, and waits for it to close. Refuses when no
    /// graphical diff tool is configured (`diff.guitool` / `diff.tool`, else the merge tool
    /// settings Git falls back to).
    pub async fn diff_tool(&self, repo: &Path, req: &crate::DiffRequest) -> Result<(), GitError> {
        use crate::DiffTarget;
        let mut paths = vec![req.path.clone()];
        paths.extend(req.old_path.iter().cloned());
        check_paths(&paths)?;
        let mut tool = None;
        for (key, gui) in [
            ("diff.guitool", true),
            ("diff.tool", false),
            ("merge.guitool", true),
            ("merge.tool", false),
        ] {
            if let Some(value) = self.config_value(repo, key).await? {
                tool = Some((value, gui));
                break;
            }
        }
        let Some((tool, gui)) = tool else {
            return Err(GitError::InvalidInput(
                "No diff tool is configured. Set diff.tool (or diff.guitool) in your Git config \
                 to a graphical diff tool, such as meld, kdiff3, bc or vscode."
                    .to_owned(),
            ));
        };
        if is_terminal_tool(&tool) {
            return Err(GitError::InvalidInput(format!(
                "The configured diff tool “{tool}” runs in a terminal. Set diff.guitool to a \
                 graphical diff tool to use it from Tylia."
            )));
        }
        let mut args: Vec<String> = vec!["difftool".into(), "--no-prompt".into()];
        if gui {
            args.push("--gui".into());
        }
        match &req.target {
            DiffTarget::Unstaged => {}
            DiffTarget::Staged => args.push("--cached".into()),
            DiffTarget::Commit { oid, parent } => {
                // A root commit compares with the empty tree.
                const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
                for rev in [parent.as_deref().unwrap_or(EMPTY_TREE), oid] {
                    if rev.starts_with('-') {
                        return Err(GitError::InvalidInput(format!("Invalid revision: {rev}")));
                    }
                }
                args.extend([
                    parent.clone().unwrap_or_else(|| EMPTY_TREE.to_owned()),
                    oid.clone(),
                ]);
            }
            DiffTarget::Untracked => {
                return Err(GitError::InvalidInput(
                    "An untracked file has no other version to compare with.".to_owned(),
                ));
            }
            DiffTarget::Conflicted => {
                return Err(GitError::InvalidInput(
                    "Use the merge tool for a conflicted file.".to_owned(),
                ));
            }
        }
        args.push("--".into());
        args.extend(paths);
        // The user's locale, not C: the tool inherits the environment.
        self.run_with(RunOptions::in_dir(repo), &args)
            .await
            .map(|_| ())
    }

    /// Outcome of starting a merge, rebase, cherry-pick or revert.
    async fn finish_start(
        &self,
        repo: &Path,
        attempt: Attempt,
        before: Option<String>,
        target: Option<&str>,
    ) -> Result<IntegrateOutcome, GitError> {
        if attempt.ok() {
            let after = self.head_oid(repo).await?;
            return Ok(if after == before {
                IntegrateOutcome::UpToDate
            } else if after.is_some() && after.as_deref() == target {
                IntegrateOutcome::FastForward
            } else {
                IntegrateOutcome::Done
            });
        }
        if self.has_conflicts(repo).await? {
            Ok(IntegrateOutcome::Conflicts)
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    /// Cherry-picks several commits in the given order (oldest first, so each applies on top of
    /// the one before), as one operation: conflicts stop it like a single pick.
    pub async fn cherry_pick_many(
        &self,
        repo: &Path,
        oids: &[String],
    ) -> Result<IntegrateOutcome, GitError> {
        self.pick_all(repo, oids, OperationKind::CherryPick).await
    }

    /// Reverts several commits in the given order (newest first, so later changes are undone
    /// before the ones they build on), one reverting commit each.
    pub async fn revert_many(
        &self,
        repo: &Path,
        oids: &[String],
    ) -> Result<IntegrateOutcome, GitError> {
        self.pick_all(repo, oids, OperationKind::Revert).await
    }

    /// Cherry-pick or revert of one commit.
    async fn pick(
        &self,
        repo: &Path,
        oid: &str,
        kind: OperationKind,
    ) -> Result<IntegrateOutcome, GitError> {
        self.pick_all(repo, &[oid.to_owned()], kind).await
    }

    /// Cherry-pick or revert of `oids`, in order. Merge commits are picked against their first
    /// parent (`-m 1`, which Git 2.21+ also accepts for the other commits of the list).
    async fn pick_all(
        &self,
        repo: &Path,
        oids: &[String],
        kind: OperationKind,
    ) -> Result<IntegrateOutcome, GitError> {
        if oids.is_empty() {
            return Err(GitError::InvalidInput("No commits were given.".to_owned()));
        }
        self.ensure_idle(repo).await?;
        let mut targets = Vec::with_capacity(oids.len());
        let mut merges = false;
        for oid in oids {
            let target = self.resolve_commit(repo, oid).await?;
            merges |= self.parent_count(repo, &target).await? > 1;
            targets.push(target);
        }
        let mut args = vec![match kind {
            OperationKind::Revert => "revert",
            _ => "cherry-pick",
        }];
        if kind == OperationKind::Revert {
            args.push("--no-edit");
        }
        if merges {
            args.extend(["-m", "1"]);
        }
        args.extend(targets.iter().map(String::as_str));
        let before = self.head_oid(repo).await?;
        let attempt = self.attempt(repo, &args, &no_editor_env()).await?;
        if attempt.ok() || self.has_conflicts(repo).await? {
            return self.finish_start(repo, attempt, before, None).await;
        }
        // Nothing to commit: the change is already there (or already reverted). Git leaves a
        // cherry-pick waiting for `--skip`; drop it so the repository isn't mid-operation.
        if self.head_oid(repo).await? == before && self.index_matches_head(repo).await? {
            if self.operation(repo).await?.is_some_and(|o| o.kind == kind) {
                self.run(Some(repo), [args[0], "--skip"]).await?;
                return Ok(IntegrateOutcome::UpToDate);
            }
            if attempt.text().contains("nothing to commit") {
                return Ok(IntegrateOutcome::UpToDate);
            }
        }
        Err(self.failure(repo, attempt).await)
    }

    /// Outcome of a continue / skip that succeeded: an interactive rebase may have paused at
    /// the next `edit` step.
    async fn after_step(
        &self,
        repo: &Path,
        kind: OperationKind,
    ) -> Result<IntegrateOutcome, GitError> {
        if kind == OperationKind::Rebase && self.rebase_in_progress(repo).await? {
            Ok(IntegrateOutcome::Stopped)
        } else {
            Ok(IntegrateOutcome::Done)
        }
    }

    async fn current_operation(&self, repo: &Path, verb: &str) -> Result<RepoOperation, GitError> {
        self.operation(repo).await?.ok_or_else(|| {
            GitError::InvalidInput(format!(
                "There's no merge, rebase, cherry-pick, revert or patch to {verb}."
            ))
        })
    }

    /// Conflicted paths with the index stages present for each (`[_, base, ours, theirs]`).
    async fn unmerged_stages(&self, repo: &Path) -> Result<HashMap<String, [bool; 4]>, GitError> {
        let out = self
            .run(Some(repo), ["ls-files", "--unmerged", "-z"])
            .await?;
        let mut stages: HashMap<String, [bool; 4]> = HashMap::new();
        for record in split_nul(&out.stdout) {
            // <mode> SP <oid> SP <stage> TAB <path>
            let record = lossy(record);
            let Some((info, path)) = record.split_once('\t') else {
                continue;
            };
            let stage = info
                .rsplit(' ')
                .next()
                .and_then(|s| s.parse::<usize>().ok())
                .filter(|&s| s <= 3);
            if let Some(stage) = stage {
                stages.entry(path.to_owned()).or_default()[stage] = true;
            }
        }
        Ok(stages)
    }

    /// A config value (`git config --get`), `None` when unset or empty.
    pub(crate) async fn config_value(
        &self,
        repo: &Path,
        key: &str,
    ) -> Result<Option<String>, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                ["config", "--get", key],
            )
            .await?;
        let value = lossy(&out.stdout).trim().to_owned();
        Ok((!value.is_empty()).then_some(value))
    }
}

/// Merge tools Git runs inside a terminal; there is none to show them in.
pub(crate) fn is_terminal_tool(tool: &str) -> bool {
    ["vimdiff", "nvimdiff", "emerge", "vim", "nvim"]
        .iter()
        .any(|t| tool == *t || (tool.starts_with(t) && tool[t.len()..].parse::<u8>().is_ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_tools() {
        for t in ["vimdiff", "vimdiff3", "nvimdiff1", "emerge"] {
            assert!(is_terminal_tool(t), "{t}");
        }
        for t in ["meld", "kdiff3", "gvimdiff", "vscode", "bc"] {
            assert!(!is_terminal_tool(t), "{t}");
        }
    }
}
