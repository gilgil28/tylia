//! Per-repository settings shown in "Repository settings": the commit identity, which SSH
//! key Git uses, the credential helper in effect, and each remote's URL with its SSH / HTTPS
//! alternative. Writes go to the repository's own config (`--local`) only; global and
//! system config are read, never changed.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy};

/// Where a config value comes from (`git config --show-scope`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ConfigScope {
    System,
    Global,
    Local,
    Worktree,
    Command,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConfigValue {
    pub value: String,
    pub scope: ConfigScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum UrlProtocol {
    Https,
    Ssh,
    /// A path or `file://` URL (another repository on this computer or a share).
    Local,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteSettings {
    pub name: String,
    pub url: String,
    pub push_url: Option<String>,
    pub protocol: UrlProtocol,
    /// The same repository over the other protocol (SSH ↔ HTTPS), when the URL has the
    /// usual `host/owner/repo` shape.
    pub alternate_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoConfig {
    /// `user.name` in effect, and where it's set.
    pub user_name: Option<ConfigValue>,
    pub user_email: Option<ConfigValue>,
    /// `core.sshCommand` in effect, if any.
    pub ssh_command: Option<ConfigValue>,
    /// The key file of a repository SSH command Tylia wrote (see [`ssh_command_for_key`]).
    pub ssh_key: Option<String>,
    /// `credential.helper` values in effect, in order (an empty value clears earlier ones).
    pub credential_helpers: Vec<ConfigValue>,
    pub remotes: Vec<RemoteSettings>,
}

fn parse_scope(s: &str) -> Option<ConfigScope> {
    Some(match s {
        "system" => ConfigScope::System,
        "global" => ConfigScope::Global,
        "local" => ConfigScope::Local,
        "worktree" => ConfigScope::Worktree,
        "command" => ConfigScope::Command,
        _ => return None,
    })
}

/// The `core.sshCommand` Tylia writes for "use this key": `-i` with the key, and only that
/// key (not every key the agent offers). Git runs it through a shell, so the path is quoted.
pub fn ssh_command_for_key(key: &str) -> String {
    let path = key.replace('\\', "/").replace('\'', r"'\''");
    format!("ssh -i '{path}' -o IdentitiesOnly=yes")
}

/// The key file in a command written by [`ssh_command_for_key`]; `None` for any other.
pub fn key_from_ssh_command(command: &str) -> Option<String> {
    let path = command
        .strip_prefix("ssh -i '")?
        .strip_suffix("' -o IdentitiesOnly=yes")?;
    Some(path.replace(r"'\''", "'"))
}

/// The protocol of a remote URL.
pub fn url_protocol(url: &str) -> UrlProtocol {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        UrlProtocol::Https
    } else if lower.starts_with("ssh://") || scp_like(url).is_some() {
        UrlProtocol::Ssh
    } else if lower.starts_with("file://")
        || url.starts_with('/')
        || url.starts_with('.')
        || url.as_bytes().get(1) == Some(&b':')
            && url
                .as_bytes()
                .get(2)
                .is_some_and(|c| *c == b'\\' || *c == b'/')
    {
        UrlProtocol::Local
    } else {
        UrlProtocol::Other
    }
}

/// `user@host:path` (scp-like SSH), as (user, host, path).
fn scp_like(url: &str) -> Option<(&str, &str, &str)> {
    if url.contains("://") {
        return None;
    }
    // The `user@` part also keeps Windows paths (`C:\x`, `C:/x`) out.
    let (user_host, path) = url.split_once(':')?;
    let (user, host) = user_host.split_once('@')?;
    (!user.is_empty() && !host.is_empty() && !path.is_empty() && !path.starts_with('/'))
        .then_some((user, host, path))
}

/// The same repository over the other protocol: `https://host/owner/repo.git` ↔
/// `git@host:owner/repo.git` (and `ssh://git@host[:port]/owner/repo` → HTTPS). Ports are
/// dropped: SSH and HTTPS ports differ.
pub fn alternate_url(url: &str) -> Option<String> {
    let with_git = |path: &str| {
        let path = path.trim_matches('/');
        if path.ends_with(".git") {
            path.to_owned()
        } else {
            format!("{path}.git")
        }
    };
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("https://") {
        let rest = &url["https://".len()..];
        let rest = rest.rsplit_once('@').map_or(rest, |(_, r)| r); // drop credentials
        let (host, path) = rest.split_once('/')?;
        let host = host.split(':').next()?;
        (!host.is_empty() && path.trim_matches('/').contains('/'))
            .then(|| format!("git@{host}:{}", with_git(path)))
    } else if lower.starts_with("ssh://") {
        let rest = &url["ssh://".len()..];
        let rest = rest.rsplit_once('@').map_or(rest, |(_, r)| r);
        let (host, path) = rest.split_once('/')?;
        let host = host.split(':').next()?;
        (!host.is_empty() && !path.is_empty()).then(|| format!("https://{host}/{}", with_git(path)))
    } else {
        let (_, host, path) = scp_like(url)?;
        Some(format!("https://{host}/{}", with_git(path)))
    }
}

impl Git {
    /// The repository's settings as Git sees them (all scopes), and its remotes.
    pub async fn repo_config(&self, repo: &Path) -> Result<RepoConfig, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                [
                    "config",
                    "--show-scope",
                    "-z",
                    "--get-regexp",
                    r"^(user\.(name|email)|core\.sshcommand|credential\.helper|remote\..*\.(url|pushurl))$",
                ],
            )
            .await?;
        // `--show-scope -z`: "scope\0key\nvalue\0" per entry.
        let mut config = RepoConfig {
            user_name: None,
            user_email: None,
            ssh_command: None,
            ssh_key: None,
            credential_helpers: Vec::new(),
            remotes: Vec::new(),
        };
        let mut remotes: Vec<(String, Option<String>, Option<String>)> = Vec::new();
        let text = lossy(&out.stdout);
        let mut fields = text.split('\0');
        while let (Some(scope), Some(entry)) = (fields.next(), fields.next()) {
            // A key without a value (`[x] flag`) has no newline.
            let (key, value) = entry.split_once('\n').unwrap_or((entry, ""));
            let Some(scope) = parse_scope(scope) else {
                continue;
            };
            let value = ConfigValue {
                value: value.to_owned(),
                scope,
            };
            match key {
                "user.name" => config.user_name = Some(value),
                "user.email" => config.user_email = Some(value),
                "core.sshcommand" => config.ssh_command = Some(value),
                "credential.helper" => {
                    if value.value.is_empty() {
                        config.credential_helpers.clear();
                    } else {
                        config.credential_helpers.push(value);
                    }
                }
                _ => {
                    // remote.<name>.url / .pushurl (the name may contain dots).
                    let Some(rest) = key.strip_prefix("remote.") else {
                        continue;
                    };
                    let (name, field) = match rest.rsplit_once('.') {
                        Some(split) => split,
                        None => continue,
                    };
                    let i = match remotes.iter().position(|r| r.0 == name) {
                        Some(i) => i,
                        None => {
                            remotes.push((name.to_owned(), None, None));
                            remotes.len() - 1
                        }
                    };
                    match field {
                        "url" => remotes[i].1 = remotes[i].1.take().or(Some(value.value)),
                        _ => remotes[i].2 = remotes[i].2.take().or(Some(value.value)),
                    }
                }
            }
        }
        config.ssh_key = config
            .ssh_command
            .as_ref()
            .filter(|c| c.scope == ConfigScope::Local)
            .and_then(|c| key_from_ssh_command(&c.value));
        config.remotes = remotes
            .into_iter()
            .filter_map(|(name, url, push_url)| {
                let url = url?;
                Some(RemoteSettings {
                    protocol: url_protocol(&url),
                    alternate_url: alternate_url(&url),
                    name,
                    url,
                    push_url,
                })
            })
            .collect();
        Ok(config)
    }

    /// Sets (or, with `None` / blank, removes) the repository's own `user.name` and
    /// `user.email`; without them the global ones apply.
    pub async fn set_identity(
        &self,
        repo: &Path,
        name: Option<&str>,
        email: Option<&str>,
    ) -> Result<(), GitError> {
        for (key, value) in [("user.name", name), ("user.email", email)] {
            self.set_local(repo, key, value.map(str::trim).filter(|v| !v.is_empty()))
                .await?;
        }
        Ok(())
    }

    /// Makes Git use only `key` for this repository's SSH remotes, or (`None`) removes the
    /// repository's SSH command so the defaults (ssh-agent, `~/.ssh`) apply again.
    pub async fn set_ssh_key(&self, repo: &Path, key: Option<&Path>) -> Result<(), GitError> {
        let command = match key {
            Some(key) => {
                if !key.is_file() {
                    return Err(GitError::InvalidInput(format!(
                        "{} isn't a file. Choose your private key (e.g. id_ed25519, not the .pub file).",
                        key.display()
                    )));
                }
                if key.extension().is_some_and(|e| e == "pub") {
                    return Err(GitError::InvalidInput(
                        "That's a public key. Choose the private key file next to it (without .pub)."
                            .to_owned(),
                    ));
                }
                Some(ssh_command_for_key(&key.display().to_string()))
            }
            None => None,
        };
        self.set_local(repo, "core.sshCommand", command.as_deref())
            .await
    }

    /// Asks the credential helpers to forget what they saved for `url` (a new token is then
    /// asked for on the next fetch or push).
    pub async fn forget_credentials(&self, repo: &Path, url: &str) -> Result<(), GitError> {
        if url_protocol(url) != UrlProtocol::Https {
            return Err(GitError::InvalidInput(
                "Only HTTPS remotes have saved sign-ins; SSH remotes use your SSH key.".to_owned(),
            ));
        }
        if url.contains(['\n', '\0']) {
            return Err(GitError::InvalidInput("That isn't a valid URL.".to_owned()));
        }
        let input = format!("url={url}\n\n");
        self.run_with(
            RunOptions {
                stdin: Some(input.as_bytes()),
                env: &[("GIT_TERMINAL_PROMPT".to_owned(), "0".to_owned())],
                ..RunOptions::in_dir(repo)
            },
            ["credential", "reject"],
        )
        .await
        .map(|_| ())
    }

    /// `git config --local key value`, or `--unset-all` for `None` (not set is fine).
    async fn set_local(&self, repo: &Path, key: &str, value: Option<&str>) -> Result<(), GitError> {
        match value {
            Some(v) => self
                .run(Some(repo), ["config", "--local", key, v])
                .await
                .map(|_| ()),
            None => self
                .run_with(
                    RunOptions {
                        // 5: the key wasn't set.
                        ok_codes: &[5],
                        ..RunOptions::in_dir(repo)
                    },
                    ["config", "--local", "--unset-all", key],
                )
                .await
                .map(|_| ()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alternates() {
        assert_eq!(
            alternate_url("https://github.com/tylia-dev/tylia.git").as_deref(),
            Some("git@github.com:tylia-dev/tylia.git")
        );
        assert_eq!(
            alternate_url("https://user@bitbucket.org/team/app").as_deref(),
            Some("git@bitbucket.org:team/app.git")
        );
        assert_eq!(
            alternate_url("git@gitlab.com:group/sub/proj.git").as_deref(),
            Some("https://gitlab.com/group/sub/proj.git")
        );
        assert_eq!(
            alternate_url("ssh://git@example.com:2222/srv/repo.git").as_deref(),
            Some("https://example.com/srv/repo.git")
        );
        assert_eq!(
            alternate_url("https://example.com/repo.git"),
            None,
            "no owner"
        );
        assert_eq!(alternate_url("C:/Dev/repo.git"), None);
        assert_eq!(alternate_url("/srv/git/repo.git"), None);
    }

    #[test]
    fn protocols() {
        assert_eq!(url_protocol("https://h/o/r"), UrlProtocol::Https);
        assert_eq!(url_protocol("git@h:o/r.git"), UrlProtocol::Ssh);
        assert_eq!(url_protocol("ssh://git@h/o/r"), UrlProtocol::Ssh);
        assert_eq!(url_protocol(r"C:\Dev\r.git"), UrlProtocol::Local);
        assert_eq!(url_protocol("C:/Dev/r.git"), UrlProtocol::Local);
        assert_eq!(url_protocol("/srv/r.git"), UrlProtocol::Local);
        assert_eq!(url_protocol("file:///srv/r.git"), UrlProtocol::Local);
        assert_eq!(url_protocol("git://h/r"), UrlProtocol::Other);
    }

    #[test]
    fn ssh_command_round_trip() {
        let cmd = ssh_command_for_key(r"C:\Users\Ada O'Neil\.ssh\id_ed25519");
        assert_eq!(
            cmd,
            r"ssh -i 'C:/Users/Ada O'\''Neil/.ssh/id_ed25519' -o IdentitiesOnly=yes"
        );
        assert_eq!(
            key_from_ssh_command(&cmd).as_deref(),
            Some("C:/Users/Ada O'Neil/.ssh/id_ed25519")
        );
        assert_eq!(key_from_ssh_command("ssh -v"), None);
    }
}
