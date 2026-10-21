//! Temp-repo fixture builder for integration tests.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

/// A throwaway repository driven with the real `git` binary.
pub struct TestRepo {
    dir: TempDir,
    clock: i64,
}

impl TestRepo {
    pub fn new() -> Self {
        let repo = Self {
            dir: tempfile::tempdir().unwrap(),
            clock: 1_700_000_000,
        };
        repo.git(&["init", "-q", "-b", "main"]);
        repo.configure();
        repo
    }

    /// Pins the settings that would otherwise come from the machine's global config.
    fn configure(&self) {
        for (key, value) in [
            ("user.name", "Test"),
            ("user.email", "test@example.com"),
            ("commit.gpgsign", "false"),
            ("tag.gpgsign", "false"),
            // Deterministic line endings regardless of the machine's global config.
            ("core.autocrlf", "false"),
            ("pull.rebase", "false"),
            ("merge.ff", "true"),
            ("merge.autoStash", "false"),
            ("merge.conflictStyle", "merge"),
            ("rebase.autoStash", "false"),
            ("rebase.updateRefs", "false"),
            ("rerere.enabled", "false"),
            ("branch.autoSetupMerge", "true"),
            ("merge.tool", ""),
            ("merge.guitool", ""),
        ] {
            self.git(&["config", key, value]);
        }
    }

    /// A bare repository, to act as a remote.
    pub fn bare() -> Self {
        let repo = Self {
            dir: tempfile::tempdir().unwrap(),
            clock: 1_700_000_000,
        };
        repo.git(&["init", "-q", "--bare", "-b", "main"]);
        repo
    }

    /// A clone of `remote`, configured like [`TestRepo::new`].
    pub fn clone_of(remote: &TestRepo) -> Self {
        let repo = Self {
            dir: tempfile::tempdir().unwrap(),
            clock: 1_800_000_000,
        };
        repo.git(&["clone", "-q", &remote.path().display().to_string(), "."]);
        repo.configure();
        repo
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn path_buf(&self) -> PathBuf {
        self.dir.path().to_owned()
    }

    /// Runs git in the repo and returns trimmed stdout; panics on failure.
    pub fn git(&self, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(self.path())
            .env("GIT_COMMITTER_DATE", format!("{} +0000", self.clock))
            .env("GIT_AUTHOR_DATE", format!("{} +0000", self.clock))
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    pub fn write(&self, path: &str, content: &str) -> &Self {
        let full = self.path().join(path);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, content).unwrap();
        self
    }

    /// Writes `<message>.txt`, stages everything and commits; returns the commit id.
    pub fn commit(&mut self, message: &str) -> String {
        self.clock += 60;
        self.write(&format!("{}.txt", message.replace(' ', "_")), message);
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    /// Writes `path` with `content`, stages everything and commits; returns the commit id.
    pub fn commit_file(&mut self, path: &str, content: &str, message: &str) -> String {
        self.clock += 60;
        self.write(path, content);
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    pub fn read(&self, path: &str) -> String {
        std::fs::read_to_string(self.path().join(path)).unwrap()
    }

    /// Runs git and returns whether it succeeded (for commands expected to fail).
    pub fn git_ok(&self, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(self.path())
            .output()
            .unwrap()
            .status
            .success()
    }

    pub fn branch(&self, name: &str) -> &Self {
        self.git(&["checkout", "-q", "-b", name]);
        self
    }

    pub fn checkout(&self, name: &str) -> &Self {
        self.git(&["checkout", "-q", name]);
        self
    }

    /// `git merge --no-ff`; returns the merge commit id.
    pub fn merge(&mut self, branch: &str) -> String {
        self.clock += 60;
        self.git(&[
            "merge",
            "-q",
            "--no-ff",
            "-m",
            &format!("Merge {branch}"),
            branch,
        ]);
        self.git(&["rev-parse", "HEAD"])
    }
}
