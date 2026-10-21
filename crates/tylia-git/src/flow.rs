//! git-flow helpers, done with plain Git (the git-flow extension isn't needed). The setup
//! lives in the same `gitflow.*` config keys the git-flow CLI uses, so both work on one
//! repository.
//!
//! Finishing checks every merge it will make with `git merge-tree` first, so it either
//! completes or changes nothing: it never stops half-way on conflicts.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::ops::no_editor_env;
use crate::runner::{Git, RunOptions, lossy};

/// A repository's git-flow setup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FlowConfig {
    /// The production branch (git-flow's `master`).
    pub main: String,
    /// The integration branch features start from and finish into.
    pub develop: String,
    pub feature_prefix: String,
    pub release_prefix: String,
    pub hotfix_prefix: String,
    /// Put before a release or hotfix name to make its tag (`v` → `v1.2.0`); may be empty.
    pub version_tag_prefix: String,
}

/// What `flow_state` reports: the setup, or (not set up yet) a suggestion for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FlowState {
    pub config: Option<FlowConfig>,
    pub suggested: FlowConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FlowKind {
    Feature,
    Release,
    Hotfix,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FlowFinishRequest {
    /// The full branch name (`feature/login`).
    pub branch: String,
    /// The release or hotfix tag's message (annotated tag); ignored for features.
    pub tag_message: Option<String>,
    /// Keep the branch after merging it (it's deleted by default).
    pub keep_branch: bool,
}

/// What finishing did, for the UI to report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FlowFinished {
    /// Branches merged into, in order.
    pub merged_into: Vec<String>,
    pub tag: Option<String>,
    pub deleted: bool,
}

/// What finishing `branch` will do, computed without changing anything.
struct FinishPlan {
    kind: FlowKind,
    /// `branch` without its prefix: the feature name or the version.
    name: String,
    targets: Vec<String>,
    tag: Option<String>,
}

fn invalid(msg: impl Into<String>) -> GitError {
    GitError::InvalidInput(msg.into())
}

fn not_set_up() -> GitError {
    invalid("git-flow isn't set up in this repository.")
}

impl FlowConfig {
    fn prefix(&self, kind: FlowKind) -> &str {
        match kind {
            FlowKind::Feature => &self.feature_prefix,
            FlowKind::Release => &self.release_prefix,
            FlowKind::Hotfix => &self.hotfix_prefix,
        }
    }

    /// The kind of flow branch `branch` is, and its name without the prefix.
    pub fn classify<'a>(&self, branch: &'a str) -> Option<(FlowKind, &'a str)> {
        [FlowKind::Feature, FlowKind::Release, FlowKind::Hotfix]
            .into_iter()
            .find_map(|kind| {
                let prefix = self.prefix(kind);
                branch
                    .strip_prefix(prefix)
                    .filter(|rest| !prefix.is_empty() && !rest.is_empty())
                    .map(|rest| (kind, rest))
            })
    }
}

impl Git {
    /// The git-flow setup from the `gitflow.*` config, or `None` when it isn't set up, plus a
    /// suggested setup (production branch `main`, else `master`, else the current branch).
    pub async fn flow_state(&self, repo: &Path) -> Result<FlowState, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                ["config", "--get-regexp", r"^gitflow\."],
            )
            .await?;
        let text = lossy(&out.stdout);
        let get = |key: &str| {
            text.lines().find_map(|line| {
                let (k, v) = line.split_once(' ').unwrap_or((line, ""));
                k.eq_ignore_ascii_case(key).then(|| v.to_owned())
            })
        };
        let config = match (get("gitflow.branch.master"), get("gitflow.branch.develop")) {
            (Some(main), Some(develop)) => Some(FlowConfig {
                main,
                develop,
                feature_prefix: get("gitflow.prefix.feature").unwrap_or_else(|| "feature/".into()),
                release_prefix: get("gitflow.prefix.release").unwrap_or_else(|| "release/".into()),
                hotfix_prefix: get("gitflow.prefix.hotfix").unwrap_or_else(|| "hotfix/".into()),
                version_tag_prefix: get("gitflow.prefix.versiontag").unwrap_or_default(),
            }),
            _ => None,
        };
        let main = if self.ref_exists(repo, "refs/heads/main").await? {
            "main".to_owned()
        } else if self.ref_exists(repo, "refs/heads/master").await? {
            "master".to_owned()
        } else {
            self.current_branch(repo)
                .await?
                .unwrap_or_else(|| "main".into())
        };
        Ok(FlowState {
            config,
            suggested: FlowConfig {
                main,
                develop: "develop".into(),
                feature_prefix: "feature/".into(),
                release_prefix: "release/".into(),
                hotfix_prefix: "hotfix/".into(),
                version_tag_prefix: String::new(),
            },
        })
    }

    /// Sets git-flow up: validates the names, creates the development branch from the
    /// production branch (or from `origin/<develop>` when that exists) and writes the config.
    pub async fn flow_init(&self, repo: &Path, config: &FlowConfig) -> Result<(), GitError> {
        self.check_branch(&config.main).await?;
        self.check_branch(&config.develop).await?;
        if config.main == config.develop {
            return Err(invalid(
                "The production and development branches must be different.",
            ));
        }
        let prefixes = [
            &config.feature_prefix,
            &config.release_prefix,
            &config.hotfix_prefix,
        ];
        for (i, prefix) in prefixes.iter().enumerate() {
            if prefix.is_empty() {
                return Err(invalid("Branch prefixes can't be empty."));
            }
            self.check_branch(&format!("{prefix}name")).await?;
            if prefixes[..i].contains(prefix) {
                return Err(invalid(format!("The prefix “{prefix}” is used twice.")));
            }
        }
        if !config.version_tag_prefix.is_empty() {
            self.check_tag(&format!("{}1.0", config.version_tag_prefix))
                .await?;
        }
        if !self
            .ref_exists(repo, &format!("refs/heads/{}", config.main))
            .await?
        {
            return Err(invalid(format!(
                "There's no branch “{}”. Make a first commit (or pick an existing branch) before setting up git-flow.",
                config.main
            )));
        }
        if !self
            .ref_exists(repo, &format!("refs/heads/{}", config.develop))
            .await?
        {
            let remote = format!("refs/remotes/origin/{}", config.develop);
            let start = if self.ref_exists(repo, &remote).await? {
                remote
            } else {
                format!("refs/heads/{}", config.main)
            };
            self.run(
                Some(repo),
                ["branch", "--no-track", &config.develop, &start],
            )
            .await?;
        }
        let entries = [
            ("gitflow.branch.master", config.main.as_str()),
            ("gitflow.branch.develop", &config.develop),
            ("gitflow.prefix.feature", &config.feature_prefix),
            ("gitflow.prefix.release", &config.release_prefix),
            ("gitflow.prefix.hotfix", &config.hotfix_prefix),
            ("gitflow.prefix.versiontag", &config.version_tag_prefix),
            // Not used by Tylia; set so the git-flow CLI sees a complete setup.
            ("gitflow.prefix.bugfix", "bugfix/"),
            ("gitflow.prefix.support", "support/"),
        ];
        for (key, value) in entries {
            self.run(Some(repo), ["config", "--local", key, value])
                .await?;
        }
        Ok(())
    }

    /// Starts a feature (from the development branch), release (from it too) or hotfix
    /// (from the production branch) named `name`, and checks it out. Only one release and
    /// one hotfix can be open at a time, as in git-flow.
    pub async fn flow_start(
        &self,
        repo: &Path,
        kind: FlowKind,
        name: &str,
    ) -> Result<String, GitError> {
        let config = self.flow_state(repo).await?.config.ok_or_else(not_set_up)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(invalid("Enter a name."));
        }
        let branch = format!("{}{name}", config.prefix(kind));
        self.check_branch(&branch).await?;
        if kind != FlowKind::Feature
            && let Some(open) = self.flow_branches(repo, config.prefix(kind)).await?.first()
        {
            return Err(invalid(format!(
                "{open} is still open. Finish it before starting another {}.",
                if kind == FlowKind::Release {
                    "release"
                } else {
                    "hotfix"
                }
            )));
        }
        let base = match kind {
            FlowKind::Feature | FlowKind::Release => &config.develop,
            FlowKind::Hotfix => &config.main,
        };
        self.create_branch(repo, &branch, &format!("refs/heads/{base}"), true)
            .await?;
        Ok(branch)
    }

    /// Finishes a flow branch: a feature merges into the development branch; a release
    /// merges into the production branch (tagged) and then the development branch; a hotfix
    /// likewise, but into the open release branch instead of the development one if there
    /// is one. Merges are `--no-ff`; the branch is deleted unless `keep_branch`. Ends on the
    /// last branch merged into.
    pub async fn flow_finish(
        &self,
        repo: &Path,
        req: &FlowFinishRequest,
    ) -> Result<FlowFinished, GitError> {
        let config = self.flow_state(repo).await?.config.ok_or_else(not_set_up)?;
        let plan = self.finish_plan(repo, &config, &req.branch).await?;
        self.ensure_idle(repo).await?;
        let changed = self.changed_tracked_files(repo).await?;
        if !changed.is_empty() {
            return Err(GitError::LocalChanges {
                command: "git flow finish".into(),
                files: changed,
                stderr: String::new(),
            });
        }
        for target in &plan.targets {
            self.ensure_merges_cleanly(repo, target, &req.branch)
                .await?;
        }

        let mut merged_into = Vec::new();
        for (i, target) in plan.targets.iter().enumerate() {
            self.switch_to(repo, target).await?;
            let attempt = self
                .attempt(
                    repo,
                    [
                        "merge",
                        "--no-ff",
                        "--no-edit",
                        "--no-autostash",
                        &req.branch,
                    ],
                    &no_editor_env(),
                )
                .await?;
            if !attempt.ok() {
                return Err(self.failure(repo, attempt).await);
            }
            merged_into.push(target.clone());
            // The tag goes on the production branch's merge commit.
            if i == 0
                && let Some(tag) = &plan.tag
            {
                let message = req
                    .tag_message
                    .as_deref()
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| default_tag_message(plan.kind, &plan.name));
                self.create_tag(repo, tag, "HEAD", Some(&message)).await?;
            }
        }
        if !req.keep_branch {
            self.run(Some(repo), ["branch", "-d", &req.branch]).await?;
        }
        Ok(FlowFinished {
            merged_into,
            tag: plan.tag,
            deleted: !req.keep_branch,
        })
    }

    async fn finish_plan(
        &self,
        repo: &Path,
        config: &FlowConfig,
        branch: &str,
    ) -> Result<FinishPlan, GitError> {
        self.check_branch(branch).await?;
        let (kind, name) = config.classify(branch).ok_or_else(|| {
            invalid(format!(
                "“{branch}” isn't a feature, release or hotfix branch."
            ))
        })?;
        if !self
            .ref_exists(repo, &format!("refs/heads/{branch}"))
            .await?
        {
            return Err(invalid(format!("There's no branch “{branch}”.")));
        }
        let targets = match kind {
            FlowKind::Feature => vec![config.develop.clone()],
            FlowKind::Release => vec![config.main.clone(), config.develop.clone()],
            FlowKind::Hotfix => {
                let release = self
                    .flow_branches(repo, &config.release_prefix)
                    .await?
                    .into_iter()
                    .next();
                vec![
                    config.main.clone(),
                    release.unwrap_or_else(|| config.develop.clone()),
                ]
            }
        };
        for target in &targets {
            if !self
                .ref_exists(repo, &format!("refs/heads/{target}"))
                .await?
            {
                return Err(invalid(format!("There's no branch “{target}”.")));
            }
        }
        let tag = match kind {
            FlowKind::Feature => None,
            FlowKind::Release | FlowKind::Hotfix => {
                let tag = format!("{}{name}", config.version_tag_prefix);
                self.check_tag(&tag).await?;
                if self.ref_exists(repo, &format!("refs/tags/{tag}")).await? {
                    return Err(invalid(format!(
                        "A tag named “{tag}” already exists. Delete it or rename the branch before finishing."
                    )));
                }
                Some(tag)
            }
        };
        Ok(FinishPlan {
            kind,
            name: name.to_owned(),
            targets,
            tag,
        })
    }

    /// Local branches named `<prefix>…`, sorted.
    async fn flow_branches(&self, repo: &Path, prefix: &str) -> Result<Vec<String>, GitError> {
        let out = self
            .run(
                Some(repo),
                ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
            )
            .await?;
        let mut names: Vec<String> = lossy(&out.stdout)
            .lines()
            .filter(|name| name.len() > prefix.len() && name.starts_with(prefix))
            .map(str::to_owned)
            .collect();
        names.sort();
        Ok(names)
    }

    /// Refuses (naming the files) if merging `branch` into `target` would conflict.
    async fn ensure_merges_cleanly(
        &self,
        repo: &Path,
        target: &str,
        branch: &str,
    ) -> Result<(), GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                [
                    "merge-tree",
                    "--write-tree",
                    "--name-only",
                    "--no-messages",
                    &format!("refs/heads/{target}"),
                    &format!("refs/heads/{branch}"),
                ],
            )
            .await?;
        if out.code != Some(1) {
            return Ok(());
        }
        // First line: the tree; then one conflicted path per line.
        let files: Vec<String> = lossy(&out.stdout)
            .lines()
            .skip(1)
            .filter(|l| !l.is_empty())
            .map(str::to_owned)
            .collect();
        Err(invalid(format!(
            "Merging {branch} into {target} would conflict in {}. Merge {target} into {branch} and resolve the conflicts there, then finish again. Nothing was changed.",
            files.join(", ")
        )))
    }

    async fn switch_to(&self, repo: &Path, branch: &str) -> Result<(), GitError> {
        if self.current_branch(repo).await?.as_deref() == Some(branch) {
            return Ok(());
        }
        let attempt = self
            .attempt(repo, ["switch", "--no-guess", branch], &[])
            .await?;
        if attempt.ok() {
            Ok(())
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }
}

fn default_tag_message(kind: FlowKind, name: &str) -> String {
    match kind {
        FlowKind::Hotfix => format!("Hotfix {name}"),
        _ => format!("Release {name}"),
    }
}
