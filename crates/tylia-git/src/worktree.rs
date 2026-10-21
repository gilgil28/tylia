//! Working-copy writes: staging and unstaging files, discarding changes, committing,
//! ignoring files.

use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy};

/// `path` relative to the repository, refusing absolute paths and `..` (paths come from
/// the UI and must stay inside the working tree).
pub fn repo_path(repo: &Path, path: &str) -> Result<PathBuf, GitError> {
    let rel = Path::new(path);
    let inside = rel
        .components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if path.is_empty() || !inside {
        return Err(GitError::InvalidInput(format!("Invalid path: {path}")));
    }
    Ok(repo.join(rel))
}

fn pathspec_args<'a>(base: &[&'a str], paths: &'a [String]) -> Vec<&'a str> {
    let mut args = base.to_vec();
    args.push("--");
    args.extend(paths.iter().map(String::as_str));
    args
}

impl Git {
    /// Stages files (new, modified and deleted).
    pub async fn stage_files(&self, repo: &Path, paths: &[String]) -> Result<(), GitError> {
        if paths.is_empty() {
            return Ok(());
        }
        self.run(Some(repo), pathspec_args(&["add", "-A"], paths))
            .await
            .map(|_| ())
    }

    pub async fn stage_all(&self, repo: &Path) -> Result<(), GitError> {
        self.run(Some(repo), ["add", "-A"]).await.map(|_| ())
    }

    /// Removes files from the index, keeping the working tree. For a staged rename pass
    /// both the old and the new path.
    pub async fn unstage_files(&self, repo: &Path, paths: &[String]) -> Result<(), GitError> {
        if paths.is_empty() {
            return Ok(());
        }
        // Each git process costs 100–300 ms on Windows, so don't check for HEAD up front:
        // only an unborn branch makes `restore --staged` fail, and then there's no HEAD to
        // restore from anyway.
        match self
            .run(Some(repo), pathspec_args(&["restore", "--staged"], paths))
            .await
        {
            Err(err) if self.head_oid(repo).await?.is_none() => {
                drop(err);
                self.run(
                    Some(repo),
                    pathspec_args(&["rm", "--cached", "-r", "-q"], paths),
                )
                .await
                .map(|_| ())
            }
            other => other.map(|_| ()),
        }
    }

    pub async fn unstage_all(&self, repo: &Path) -> Result<(), GitError> {
        match self.run(Some(repo), ["reset", "-q"]).await {
            Err(err) if self.head_oid(repo).await?.is_none() => {
                drop(err);
                self.run(Some(repo), ["rm", "--cached", "-r", "-q", "--", "."])
                    .await
                    .map(|_| ())
            }
            other => other.map(|_| ()),
        }
    }

    /// Ignored files and directories (directories not descended into), relative to `repo`
    /// with `/` separators; directories end in `/`.
    pub async fn ignored_paths(&self, repo: &Path) -> Result<Vec<String>, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    no_optional_locks: true,
                    ..RunOptions::in_dir(repo)
                },
                [
                    "ls-files",
                    "--others",
                    "--ignored",
                    "--exclude-standard",
                    "--directory",
                    "-z",
                ],
            )
            .await?;
        Ok(crate::runner::split_nul(&out.stdout).map(lossy).collect())
    }

    /// Discards working-tree changes: tracked files are restored from the index (staged
    /// changes are kept), untracked files are moved to the OS trash — never deleted.
    pub async fn discard_files(
        &self,
        repo: &Path,
        tracked: &[String],
        untracked: &[String],
    ) -> Result<(), GitError> {
        let untracked = untracked
            .iter()
            .map(|p| repo_path(repo, p))
            .collect::<Result<Vec<_>, _>>()?;
        if !tracked.is_empty() {
            self.run(
                Some(repo),
                pathspec_args(&["restore", "--worktree"], tracked),
            )
            .await?;
        }
        if !untracked.is_empty() {
            trash::delete_all(&untracked).map_err(|e| {
                GitError::InvalidInput(format!("Couldn't move files to the trash: {e}"))
            })?;
        }
        Ok(())
    }

    /// Commits the index with `message`; returns the new commit id. Hook output (stdout and
    /// stderr) is kept in the error when the commit fails.
    pub async fn commit(
        &self,
        repo: &Path,
        message: &str,
        amend: bool,
    ) -> Result<String, GitError> {
        let mut args = vec!["commit", "-F", "-"];
        if amend {
            args.push("--amend");
        }
        let out = self
            .run_with(
                RunOptions {
                    stdin: Some(message.as_bytes()),
                    // Report failure ourselves, with stdout included.
                    ok_codes: &[1, 128],
                    ..RunOptions::in_dir(repo)
                },
                &args,
            )
            .await?;
        if out.code != Some(0) {
            let mut output = lossy(&out.stdout);
            output.push_str(&lossy(&out.stderr));
            return Err(GitError::Failed {
                command: crate::runner::display_command(&args),
                code: out.code,
                stderr: output,
            });
        }
        self.head_oid(repo)
            .await?
            .ok_or_else(|| GitError::parse("git commit", "no HEAD after commit"))
    }

    /// The message of the HEAD commit (to prefill an amend); `None` before the first commit.
    pub async fn head_message(&self, repo: &Path) -> Result<Option<String>, GitError> {
        if self.head_oid(repo).await?.is_none() {
            return Ok(None);
        }
        let out = self.run(Some(repo), ["log", "-1", "--format=%B"]).await?;
        Ok(Some(lossy(&out.stdout).trim_end().to_owned()))
    }
}

/// Appends `pattern` to the repository's top-level `.gitignore` (created if needed) unless
/// an identical line is already there.
pub fn add_to_gitignore(repo: &Path, pattern: &str) -> Result<(), GitError> {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern.contains('\n') {
        return Err(GitError::InvalidInput(format!(
            "Invalid ignore pattern: {pattern}"
        )));
    }
    let path = repo.join(".gitignore");
    let mut existing = String::new();
    if let Ok(mut f) = std::fs::File::open(&path) {
        f.read_to_string(&mut existing)?;
    }
    if existing.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }
    let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    writeln!(f, "{separator}{pattern}")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_paths_stay_inside() {
        let repo = Path::new("/r");
        assert!(repo_path(repo, "src/a.rs").is_ok());
        assert!(repo_path(repo, "./a").is_ok());
        assert!(repo_path(repo, "../etc/passwd").is_err());
        assert!(repo_path(repo, "a/../../b").is_err());
        assert!(repo_path(repo, "").is_err());
        assert!(repo_path(repo, "/abs").is_err());
    }

    #[test]
    fn gitignore_appends_once() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "target").unwrap();
        add_to_gitignore(dir.path(), "*.log").unwrap();
        add_to_gitignore(dir.path(), "*.log").unwrap();
        add_to_gitignore(dir.path(), " node_modules/ ").unwrap();
        let text = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert_eq!(text, "target\n*.log\nnode_modules/\n");
        assert!(add_to_gitignore(dir.path(), "a\nb").is_err());
    }
}
