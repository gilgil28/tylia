//! Shared plumbing for the Phase 4 write operations (branches, tags, stashes, merge /
//! rebase / cherry-pick / revert): name and revision validation, running a command whose
//! failure is an expected outcome, and classifying Git's refusals.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::error::GitError;
use crate::runner::{Git, RunOptions, display_command, lossy, split_nul};
use crate::status::{OperationKind, RepoOperation, find_git_dir, read_operation};

/// Every exit code, so a failed run still returns its output for inspection.
const ALL_CODES: [i32; 255] = {
    let mut codes = [0; 255];
    let mut i = 0;
    while i < 255 {
        codes[i] = i as i32 + 1;
        i += 1;
    }
    codes
};

/// Environment that keeps Git from opening an editor. `:` is special-cased by Git as "no
/// editor": the prepared message (MERGE_MSG, the picked commit's message) is used as is.
pub(crate) fn no_editor_env() -> Vec<(String, String)> {
    [
        ("GIT_EDITOR", ":"),
        ("GIT_SEQUENCE_EDITOR", ":"),
        ("GIT_MERGE_AUTOEDIT", "no"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect()
}

/// Pathspecs are matched literally (a file named `a[1].txt` is not a glob).
pub(crate) fn literal_pathspecs_env() -> Vec<(String, String)> {
    vec![("GIT_LITERAL_PATHSPECS".to_owned(), "1".to_owned())]
}

/// The result of a command that may fail as part of normal operation (conflicts, refusals).
pub(crate) struct Attempt {
    pub command: String,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl Attempt {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }

    /// stdout and stderr together: CONFLICT lines and "nothing to commit" are on stdout.
    pub fn text(&self) -> String {
        let mut text = self.stdout.clone();
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&self.stderr);
        text
    }
}

fn invalid(msg: impl Into<String>) -> GitError {
    GitError::InvalidInput(msg.into())
}

impl Git {
    /// Runs Git in `repo` (C locale, so messages can be matched) and returns the outcome
    /// whatever the exit code.
    pub(crate) async fn attempt<I, S>(
        &self,
        repo: &Path,
        args: I,
        env: &[(String, String)],
    ) -> Result<Attempt, GitError>
    where
        I: IntoIterator<Item = S> + Clone,
        S: AsRef<OsStr>,
    {
        let command = display_command(args.clone());
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ok_codes: &ALL_CODES,
                    env,
                    ..RunOptions::in_dir(repo)
                },
                args,
            )
            .await?;
        Ok(Attempt {
            command,
            code: out.code,
            stdout: lossy(&out.stdout),
            stderr: lossy(&out.stderr),
        })
    }

    /// The error for a failed attempt: [`GitError::LocalChanges`] when Git refused because of
    /// uncommitted changes, else [`GitError::Failed`] with Git's output.
    pub(crate) async fn failure(&self, repo: &Path, attempt: Attempt) -> GitError {
        let text = attempt.text();
        match local_changes(&attempt.command, &text) {
            Some(GitError::LocalChanges {
                command,
                mut files,
                stderr,
            }) => {
                if files.is_empty() {
                    // "cannot rebase: You have unstaged changes" names no files.
                    files = self.changed_tracked_files(repo).await.unwrap_or_default();
                }
                GitError::LocalChanges {
                    command,
                    files,
                    stderr,
                }
            }
            _ => GitError::Failed {
                command: attempt.command,
                code: attempt.code,
                stderr: text,
            },
        }
    }

    /// Tracked files whose index or working tree differs from HEAD.
    pub(crate) async fn changed_tracked_files(&self, repo: &Path) -> Result<Vec<String>, GitError> {
        let out = self
            .run_with(
                RunOptions::in_dir(repo),
                ["diff", "--name-only", "-z", "HEAD", "--"],
            )
            .await?;
        Ok(split_nul(&out.stdout).map(lossy).collect())
    }

    /// The repository's git dir: read from the file system (`.git` folder, or the `gitdir:`
    /// file of a linked worktree / submodule), else asked from Git.
    pub(crate) async fn git_dir(&self, repo: &Path) -> Result<PathBuf, GitError> {
        if let Some(dir) = find_git_dir(repo) {
            return Ok(dir);
        }
        let out = self
            .run(Some(repo), ["rev-parse", "--absolute-git-dir"])
            .await?;
        Ok(PathBuf::from(lossy(&out.stdout).trim()))
    }

    /// The merge / rebase / cherry-pick / revert in progress, if any.
    pub(crate) async fn operation(&self, repo: &Path) -> Result<Option<RepoOperation>, GitError> {
        Ok(read_operation(&self.git_dir(repo).await?))
    }

    /// Refuses to start an operation while another one (or an unresolved conflict) is in
    /// progress; Git's own refusals would otherwise look like new conflicts.
    pub(crate) async fn ensure_idle(&self, repo: &Path) -> Result<(), GitError> {
        if let Some(op) = self.operation(repo).await? {
            return Err(invalid(format!(
                "{} is in progress. Continue or abort it first.",
                match op.kind {
                    OperationKind::Merge => "A merge",
                    OperationKind::Rebase => "A rebase",
                    OperationKind::CherryPick => "A cherry-pick",
                    OperationKind::Revert => "A revert",
                }
            )));
        }
        if self.has_conflicts(repo).await? {
            return Err(invalid("Resolve the conflicted files first."));
        }
        Ok(())
    }

    /// Whether `full_ref` (`refs/heads/x`) exists.
    pub(crate) async fn ref_exists(&self, repo: &Path, full_ref: &str) -> Result<bool, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1, 2],
                    ..RunOptions::in_dir(repo)
                },
                ["show-ref", "--verify", "--quiet", full_ref],
            )
            .await?;
        Ok(out.code == Some(0))
    }

    /// Resolves a user-supplied commit-ish (oid, branch, tag, `HEAD~2`) to a full commit id.
    pub(crate) async fn resolve_commit(&self, repo: &Path, rev: &str) -> Result<String, GitError> {
        check_rev(rev)?;
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1, 128],
                    ..RunOptions::in_dir(repo)
                },
                ["rev-parse", "-q", "--verify", &format!("{rev}^{{commit}}")],
            )
            .await?;
        let oid = lossy(&out.stdout).trim().to_owned();
        if out.code == Some(0) && !oid.is_empty() {
            Ok(oid)
        } else {
            Err(invalid(format!(
                "“{rev}” isn't a commit in this repository."
            )))
        }
    }

    /// Number of parents of a (resolved) commit.
    pub(crate) async fn parent_count(&self, repo: &Path, oid: &str) -> Result<usize, GitError> {
        let out = self
            .run(Some(repo), ["rev-list", "--parents", "-n", "1", oid, "--"])
            .await?;
        Ok(lossy(&out.stdout)
            .split_whitespace()
            .count()
            .saturating_sub(1))
    }

    /// Whether the index matches HEAD (nothing staged).
    pub(crate) async fn index_matches_head(&self, repo: &Path) -> Result<bool, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                ["diff", "--cached", "--quiet", "HEAD", "--"],
            )
            .await?;
        Ok(out.code == Some(0))
    }

    /// A branch name typed or chosen by the user: `check-ref-format --branch`, plus the
    /// forms that command would accept but that aren't plain names (`@{-1}`, options).
    pub(crate) async fn check_branch(&self, name: &str) -> Result<(), GitError> {
        if name.starts_with('-') || name.contains("@{") || name == "HEAD" || name == "@" {
            return Err(invalid(format!("“{name}” isn't a valid branch name")));
        }
        self.check_branch_name(name).await
    }

    /// A tag name (`check-ref-format refs/tags/<name>`).
    pub(crate) async fn check_tag(&self, name: &str) -> Result<(), GitError> {
        let bad = || invalid(format!("“{name}” isn't a valid tag name"));
        if name.is_empty() || name.starts_with('-') || name.contains("@{") {
            return Err(bad());
        }
        self.run(None, ["check-ref-format", &format!("refs/tags/{name}")])
            .await
            .map(|_| ())
            .map_err(|_| bad())
    }

    /// A remote-tracking branch name as shown in the UI (`origin/feature/x`).
    pub(crate) async fn check_remote_branch(&self, name: &str) -> Result<(), GitError> {
        let bad = || invalid(format!("“{name}” isn't a valid remote branch name"));
        if name.is_empty() || name.starts_with('-') || name.contains("@{") || !name.contains('/') {
            return Err(bad());
        }
        self.run(None, ["check-ref-format", &format!("refs/remotes/{name}")])
            .await
            .map(|_| ())
            .map_err(|_| bad())
    }
}

/// A commit-ish must not be readable as an option or contain anything a revision can't.
pub(crate) fn check_rev(rev: &str) -> Result<(), GitError> {
    if rev.is_empty()
        || rev.starts_with('-')
        || rev.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        Err(invalid(format!("“{rev}” isn't a valid commit")))
    } else {
        Ok(())
    }
}

/// Repository-relative paths chosen in the UI.
pub(crate) fn check_paths(paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(invalid("No files selected."));
    }
    for path in paths {
        if path.is_empty() || Path::new(path).is_absolute() || path.contains('\0') {
            return Err(invalid(format!("Invalid path: {path}")));
        }
    }
    Ok(())
}

/// Recognises Git's (C-locale) "your local changes would be overwritten" refusals from
/// switch / checkout, merge, rebase, cherry-pick, revert and stash apply, with the files Git
/// listed (tab-indented under the "…would be overwritten by …:" line).
pub(crate) fn local_changes(command: &str, text: &str) -> Option<GitError> {
    const MARKERS: &[&str] = &[
        "would be overwritten by",
        "would be removed by",
        "Please commit your changes or stash them",
        "your local changes would be overwritten",
        "You have unstaged changes",
        "Your index contains uncommitted changes",
    ];
    if !MARKERS.iter().any(|m| text.contains(m)) {
        return None;
    }
    let mut files = Vec::new();
    let mut in_list = false;
    for line in text.lines() {
        if in_list {
            if let Some(file) = line.strip_prefix('\t') {
                files.push(file.trim_end().to_owned());
                continue;
            }
            in_list = false;
        }
        if line.ends_with(':')
            && (line.contains("would be overwritten by") || line.contains("would be removed by"))
        {
            in_list = true;
        }
    }
    files.sort();
    files.dedup();
    Some(GitError::LocalChanges {
        command: command.to_owned(),
        files,
        stderr: text.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_local_changes() {
        let checkout = "error: Your local changes to the following files would be overwritten by checkout:\n\tf.txt\n\tsrc/a b.rs\nPlease commit your changes or stash them before you switch branches.\nAborting\n";
        let Some(GitError::LocalChanges { files, .. }) = local_changes("git switch x", checkout)
        else {
            panic!("not recognised");
        };
        assert_eq!(files, ["f.txt", "src/a b.rs"]);

        let untracked = "error: The following untracked working tree files would be overwritten by checkout:\n\tg.txt\nPlease move or remove them before you switch branches.\nAborting\n";
        let Some(GitError::LocalChanges { files, .. }) = local_changes("git switch x", untracked)
        else {
            panic!("not recognised");
        };
        assert_eq!(files, ["g.txt"]);

        let rebase = "error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.\n";
        let Some(GitError::LocalChanges { files, .. }) = local_changes("git rebase main", rebase)
        else {
            panic!("not recognised");
        };
        assert!(files.is_empty());

        assert!(local_changes("git merge x", "CONFLICT (content): Merge conflict in f").is_none());
    }

    #[test]
    fn revisions() {
        for ok in ["main", "HEAD~2", "v1.0", "0123abcd", "origin/feature/x"] {
            assert!(check_rev(ok).is_ok(), "{ok}");
        }
        for bad in ["", "-x", "--all", "a b", "a\nb"] {
            assert!(check_rev(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn paths() {
        assert!(check_paths(&["a.txt".into(), "dir/b c.txt".into()]).is_ok());
        assert!(check_paths(&[]).is_err());
        assert!(check_paths(&["".into()]).is_err());
    }
}
