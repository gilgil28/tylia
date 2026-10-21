//! Opening and creating repositories.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy};

/// A repository Tylia can browse (non-bare, with a working tree).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoInfo {
    /// Top level of the working tree.
    pub path: String,
    /// Folder name, used as the tab title.
    pub name: String,
    pub git_dir: String,
}

impl Git {
    /// Resolves `path` (the repository root or any folder inside it) to its repository.
    pub async fn open_repo(&self, path: &Path) -> Result<RepoInfo, GitError> {
        if !path.is_dir() {
            return Err(GitError::NotARepository {
                path: path.to_owned(),
            });
        }
        let opts = RunOptions {
            c_locale: true,
            ..RunOptions::in_dir(path)
        };
        let out = self
            .run_with(
                opts,
                ["rev-parse", "--is-bare-repository", "--absolute-git-dir"],
            )
            .await
            .map_err(|err| match err {
                GitError::Failed { ref stderr, .. } if stderr.contains("not a git repository") => {
                    GitError::NotARepository {
                        path: path.to_owned(),
                    }
                }
                other => other,
            })?;
        let text = lossy(&out.stdout);
        let mut lines = text.lines();
        let bare = lines.next() == Some("true");
        let git_dir = lines.next().unwrap_or_default().to_owned();
        if bare {
            return Err(GitError::BareRepository {
                path: path.to_owned(),
            });
        }
        let top = self
            .run_with(opts, ["rev-parse", "--show-toplevel"])
            .await?;
        let top = PathBuf::from(lossy(&top.stdout).trim());
        Ok(RepoInfo {
            name: repo_name(&top),
            path: native_path(&top),
            git_dir,
        })
    }

    /// The checked-out branch of the repository at `path` (`None` when detached); fails if
    /// `path` is not a repository. Cheap enough for listing recent repositories.
    pub async fn current_branch(&self, path: &Path) -> Result<Option<String>, GitError> {
        if !path.is_dir() {
            return Err(GitError::NotARepository {
                path: path.to_owned(),
            });
        }
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    c_locale: true,
                    ..RunOptions::in_dir(path)
                },
                ["symbolic-ref", "-q", "--short", "HEAD"],
            )
            .await
            .map_err(|_| GitError::NotARepository {
                path: path.to_owned(),
            })?;
        let branch = lossy(&out.stdout).trim().to_owned();
        Ok((!branch.is_empty()).then_some(branch))
    }

    /// The commit HEAD points at; `None` on an unborn branch.
    pub async fn head_oid(&self, repo: &Path) -> Result<Option<String>, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                ["rev-parse", "-q", "--verify", "HEAD^{commit}"],
            )
            .await?;
        let oid = lossy(&out.stdout).trim().to_owned();
        Ok((!oid.is_empty()).then_some(oid))
    }

    /// `git init` in `path` (created if missing), then opens it.
    pub async fn init_repo(&self, path: &Path) -> Result<RepoInfo, GitError> {
        std::fs::create_dir_all(path)?;
        self.run(Some(path), ["init"]).await?;
        self.open_repo(path).await
    }
}

fn repo_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// Git prints forward slashes on Windows (`C:/Dev/x`); use the platform's separators.
fn native_path(path: &Path) -> String {
    let s = path.display().to_string();
    if cfg!(windows) {
        s.replace('/', "\\")
    } else {
        s
    }
}
