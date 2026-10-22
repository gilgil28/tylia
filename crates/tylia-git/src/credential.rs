//! Secrets Tylia keeps for itself (hosting-account tokens), stored with Git's credential
//! helpers (`git credential approve / fill / reject`): wherever the user's Git keeps its
//! sign-ins (Git Credential Manager, the macOS Keychain, libsecret), with nothing of our own.
//!
//! Never interactive: a `fill` that the helpers can't answer fails instead of asking
//! (no askpass, no terminal prompt, no Git Credential Manager window).

use std::path::Path;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy};

/// The key a secret is stored under: `https://<host>` with a username.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialKey {
    pub host: String,
    pub username: String,
}

impl CredentialKey {
    fn input(&self, password: Option<&str>) -> Result<String, GitError> {
        let fields = [
            Some(self.host.as_str()),
            Some(self.username.as_str()),
            password,
        ];
        for value in fields.into_iter().flatten() {
            if value.is_empty() || value.contains(['\n', '\0']) {
                return Err(GitError::InvalidInput(
                    "A credential can't be empty or span lines.".to_owned(),
                ));
            }
        }
        let mut input = format!(
            "protocol=https\nhost={}\nusername={}\n",
            self.host, self.username
        );
        if let Some(password) = password {
            input.push_str(&format!("password={password}\n"));
        }
        input.push('\n');
        Ok(input)
    }
}

/// Config and environment that keep `git credential` from asking anyone.
const QUIET_CONFIG: &[&str] = &["-c", "core.askPass=", "-c", "credential.interactive=never"];

fn quiet_env() -> Vec<(String, String)> {
    [
        ("GIT_ASKPASS", ""),
        ("SSH_ASKPASS", ""),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GCM_INTERACTIVE", "never"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect()
}

impl Git {
    async fn credential(
        &self,
        action: &str,
        input: &str,
        cwd: &Path,
        ok_codes: &[i32],
    ) -> Result<crate::GitOutput, GitError> {
        let env = quiet_env();
        let args: Vec<&str> = QUIET_CONFIG
            .iter()
            .copied()
            .chain(["credential", action])
            .collect();
        self.run_with(
            RunOptions {
                stdin: Some(input.as_bytes()),
                env: &env,
                ok_codes,
                ..RunOptions::in_dir(cwd)
            },
            args,
        )
        .await
    }

    /// Stores `secret` under `key` with the configured credential helpers. Without one, Git
    /// keeps nothing (the caller says so). `cwd` is any existing folder (no repository needed).
    pub async fn store_secret(
        &self,
        cwd: &Path,
        key: &CredentialKey,
        secret: &str,
    ) -> Result<(), GitError> {
        let input = key.input(Some(secret))?;
        self.credential("approve", &input, cwd, &[])
            .await
            .map(|_| ())
    }

    /// The secret stored under `key`, or `None` when no helper has one.
    pub async fn read_secret(
        &self,
        cwd: &Path,
        key: &CredentialKey,
    ) -> Result<Option<String>, GitError> {
        let input = key.input(None)?;
        // 128: nothing found, and asking was not allowed.
        let out = self.credential("fill", &input, cwd, &[128]).await?;
        if out.code != Some(0) {
            return Ok(None);
        }
        Ok(lossy(&out.stdout)
            .lines()
            .find_map(|line| line.strip_prefix("password="))
            .map(str::to_owned)
            .filter(|p| !p.is_empty()))
    }

    /// Asks every helper to forget what it stored under `key`.
    pub async fn erase_secret(&self, cwd: &Path, key: &CredentialKey) -> Result<(), GitError> {
        let input = key.input(None)?;
        self.credential("reject", &input, cwd, &[])
            .await
            .map(|_| ())
    }
}
