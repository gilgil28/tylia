//! Hosting accounts (Settings → Accounts): GitHub (and GitHub Enterprise Server), GitLab
//! (gitlab.com or a self-managed host) and Bitbucket Cloud, signed in with a personal access
//! token, to list the user's repositories in the Clone dialog.
//!
//! - **Network:** only when the user adds an account or opens the list; nothing at start.
//! - **Tokens** are never written to settings.json: they go to Git's credential helpers
//!   (`tylia_git::credential`) under `https://<API host>` with the username `tylia:<login>`,
//!   so they can't replace the user's own Git sign-in for the same host.
//! - **Parsing** of each provider's JSON is pure (`parse_*`), tested with recorded responses.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;
use tylia_git::CredentialKey;

use crate::error::IpcError;

/// At most this many pages of 100 repositories are read.
const MAX_PAGES: usize = 10;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum HostingProvider {
    #[default]
    Github,
    Gitlab,
    Bitbucket,
}

/// A signed-in account (persisted in settings.json, without its token).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct HostingAccount {
    pub provider: HostingProvider,
    /// The web host: `github.com`, a GitHub Enterprise or GitLab host, `bitbucket.org`.
    pub host: String,
    /// The login the token belongs to (Bitbucket: the Atlassian account's email).
    pub login: String,
    /// The account's display name.
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HostedRepo {
    /// `owner/name` (GitLab: the full namespace path).
    pub full_name: String,
    pub description: Option<String>,
    pub private: bool,
    pub https_url: String,
    pub ssh_url: Option<String>,
    /// RFC 3339, when the provider says.
    pub updated: Option<String>,
}

impl HostingAccount {
    /// The API's base URL.
    fn api(&self) -> String {
        match self.provider {
            HostingProvider::Github if self.host == "github.com" => {
                "https://api.github.com".to_owned()
            }
            HostingProvider::Github => format!("https://{}/api/v3", self.host),
            HostingProvider::Gitlab => format!("https://{}/api/v4", self.host),
            HostingProvider::Bitbucket => "https://api.bitbucket.org/2.0".to_owned(),
        }
    }

    pub fn credential_key(&self) -> CredentialKey {
        let host = self
            .api()
            .trim_start_matches("https://")
            .split('/')
            .next()
            .unwrap_or_default()
            .to_owned();
        CredentialKey {
            host,
            username: format!("tylia:{}", self.login),
        }
    }
}

/// A host name as typed: `https://gitlab.example.com/` → `gitlab.example.com`; refused if it
/// isn't a plain host (with an optional port).
pub fn normalize_host(input: &str) -> Result<String, IpcError> {
    let host = input
        .trim()
        .trim_start_matches("https://")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let valid = !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
    if valid {
        Ok(host)
    } else {
        Err(IpcError::invalid(format!(
            "“{}” isn't a host name.",
            input.trim()
        )))
    }
}

/// The signed-in user from `GET /user`: `(login, name)`.
pub fn parse_user(provider: HostingProvider, json: &Value) -> Option<(String, String)> {
    let s = |key: &str| json.get(key).and_then(Value::as_str).map(str::to_owned);
    match provider {
        HostingProvider::Github => {
            let login = s("login")?;
            Some((login.clone(), s("name").unwrap_or(login)))
        }
        HostingProvider::Gitlab => {
            let login = s("username")?;
            Some((login.clone(), s("name").unwrap_or(login)))
        }
        HostingProvider::Bitbucket => {
            let name = s("display_name").or_else(|| s("nickname"))?;
            Some((String::new(), name))
        }
    }
}

/// One page of repositories.
pub fn parse_repos(provider: HostingProvider, json: &Value) -> Vec<HostedRepo> {
    let items = match provider {
        HostingProvider::Bitbucket => json.get("values").and_then(Value::as_array),
        _ => json.as_array(),
    };
    let s = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).map(str::to_owned);
    items
        .into_iter()
        .flatten()
        .filter_map(|r| match provider {
            HostingProvider::Github => Some(HostedRepo {
                full_name: s(r, "full_name")?,
                description: s(r, "description").filter(|d| !d.is_empty()),
                private: r.get("private").and_then(Value::as_bool).unwrap_or(false),
                https_url: s(r, "clone_url")?,
                ssh_url: s(r, "ssh_url"),
                updated: s(r, "pushed_at").or_else(|| s(r, "updated_at")),
            }),
            HostingProvider::Gitlab => Some(HostedRepo {
                full_name: s(r, "path_with_namespace")?,
                description: s(r, "description").filter(|d| !d.is_empty()),
                private: s(r, "visibility").is_some_and(|v| v != "public"),
                https_url: s(r, "http_url_to_repo")?,
                ssh_url: s(r, "ssh_url_to_repo"),
                updated: s(r, "last_activity_at"),
            }),
            HostingProvider::Bitbucket => {
                let clone = r.get("links")?.get("clone")?.as_array()?;
                let link = |name: &str| {
                    clone
                        .iter()
                        .find(|l| l.get("name").and_then(Value::as_str) == Some(name))
                        .and_then(|l| s(l, "href"))
                };
                Some(HostedRepo {
                    full_name: s(r, "full_name")?,
                    description: s(r, "description").filter(|d| !d.is_empty()),
                    private: r
                        .get("is_private")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    // Bitbucket puts the login into the HTTPS URL; Git asks for it anyway.
                    https_url: strip_user(&link("https")?),
                    ssh_url: link("ssh"),
                    updated: s(r, "updated_on"),
                })
            }
        })
        .collect()
}

/// `https://ada@bitbucket.org/x/y.git` → `https://bitbucket.org/x/y.git`.
fn strip_user(url: &str) -> String {
    let Some(rest) = url.strip_prefix("https://") else {
        return url.to_owned();
    };
    let authority = rest.split('/').next().unwrap_or_default();
    match authority.rsplit_once('@') {
        Some((_, host)) => format!("https://{host}{}", &rest[authority.len()..]),
        None => url.to_owned(),
    }
}

/// The next page's URL from GitHub's `Link` header.
pub fn next_link(header: &str) -> Option<String> {
    header.split(',').find_map(|part| {
        let (url, rel) = part.split_once(';')?;
        rel.contains("rel=\"next\"").then(|| {
            url.trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_owned()
        })
    })
}

fn client() -> Result<reqwest::Client, IpcError> {
    // rustls needs a crypto provider; the updater plugin installs the same one.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(concat!("Tylia/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| IpcError::invalid(format!("Couldn't start a network client: {err}")))
}

fn authorize(
    request: reqwest::RequestBuilder,
    account: &HostingAccount,
    token: &str,
) -> reqwest::RequestBuilder {
    match account.provider {
        HostingProvider::Bitbucket => request.basic_auth(&account.login, Some(token)),
        _ => request.bearer_auth(token),
    }
}

/// A GET with the token; JSON body and the headers that page.
async fn get(
    client: &reqwest::Client,
    account: &HostingAccount,
    token: &str,
    url: &str,
) -> Result<(Value, reqwest::header::HeaderMap), IpcError> {
    let response = authorize(client.get(url), account, token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| IpcError::invalid(format!("Couldn't reach {}: {err}", account.host)))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(IpcError::invalid(format!(
            "{} refused the token ({status}). Check that it hasn't expired and can read repositories.",
            account.host
        )));
    }
    if !status.is_success() {
        return Err(IpcError::invalid(format!(
            "{} answered {status}.",
            account.host
        )));
    }
    let headers = response.headers().clone();
    let json = response.json::<Value>().await.map_err(|err| {
        IpcError::invalid(format!("{} sent an unreadable answer: {err}", account.host))
    })?;
    Ok((json, headers))
}

/// Checks `token` and fills in the account's login and name.
pub async fn verify(mut account: HostingAccount, token: &str) -> Result<HostingAccount, IpcError> {
    let client = client()?;
    let (json, _) = get(&client, &account, token, &format!("{}/user", account.api())).await?;
    let (login, name) = parse_user(account.provider, &json).ok_or_else(|| {
        IpcError::invalid(format!(
            "{} didn't say who the token belongs to.",
            account.host
        ))
    })?;
    if !login.is_empty() {
        account.login = login;
    }
    account.name = name;
    Ok(account)
}

/// The account's repositories, most recently active first, up to `MAX_PAGES` pages.
pub async fn repos(account: &HostingAccount, token: &str) -> Result<Vec<HostedRepo>, IpcError> {
    let client = client()?;
    let mut next = Some(match account.provider {
        HostingProvider::Github => format!(
            "{}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
            account.api()
        ),
        HostingProvider::Gitlab => format!(
            "{}/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true",
            account.api()
        ),
        HostingProvider::Bitbucket => format!(
            "{}/repositories?role=member&pagelen=100&sort=-updated_on",
            account.api()
        ),
    });
    let mut all = Vec::new();
    for _ in 0..MAX_PAGES {
        let Some(url) = next.take() else { break };
        let (json, headers) = get(&client, account, token, &url).await?;
        all.extend(parse_repos(account.provider, &json));
        next = match account.provider {
            HostingProvider::Github => headers
                .get("link")
                .and_then(|h| h.to_str().ok())
                .and_then(next_link),
            HostingProvider::Gitlab => headers
                .get("x-next-page")
                .and_then(|h| h.to_str().ok())
                .filter(|p| !p.is_empty())
                .map(|page| format!("{url}&page={page}")),
            HostingProvider::Bitbucket => {
                json.get("next").and_then(Value::as_str).map(str::to_owned)
            }
        };
    }
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn account(provider: HostingProvider, host: &str) -> HostingAccount {
        HostingAccount {
            provider,
            host: host.into(),
            login: "ada".into(),
            name: "Ada".into(),
        }
    }

    #[test]
    fn tokens_are_keyed_by_the_api_host_and_a_tylia_username() {
        let key = |p, h| account(p, h).credential_key();
        assert_eq!(
            key(HostingProvider::Github, "github.com").host,
            "api.github.com"
        );
        assert_eq!(
            key(HostingProvider::Github, "git.corp.example").host,
            "git.corp.example"
        );
        assert_eq!(
            key(HostingProvider::Gitlab, "gitlab.com").host,
            "gitlab.com"
        );
        assert_eq!(
            key(HostingProvider::Bitbucket, "bitbucket.org").host,
            "api.bitbucket.org"
        );
        assert_eq!(
            key(HostingProvider::Github, "github.com").username,
            "tylia:ada"
        );
    }

    #[test]
    fn hosts_are_normalized_and_checked() {
        assert_eq!(
            normalize_host(" https://GitLab.Example.com/ ").unwrap(),
            "gitlab.example.com"
        );
        assert_eq!(normalize_host("git.local:8443").unwrap(), "git.local:8443");
        for bad in ["", "evil.com/path", "a b", "user@host"] {
            assert!(normalize_host(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn users_are_read_per_provider() {
        let github = json!({"login": "ada", "name": "Ada Lovelace", "id": 1});
        assert_eq!(
            parse_user(HostingProvider::Github, &github),
            Some(("ada".into(), "Ada Lovelace".into()))
        );
        let gitlab = json!({"username": "ada", "name": null});
        assert_eq!(
            parse_user(HostingProvider::Gitlab, &gitlab),
            Some(("ada".into(), "ada".into()))
        );
        let bitbucket = json!({"display_name": "Ada L", "nickname": "ada"});
        assert_eq!(
            parse_user(HostingProvider::Bitbucket, &bitbucket),
            Some((String::new(), "Ada L".into()))
        );
        assert_eq!(
            parse_user(
                HostingProvider::Github,
                &json!({"message": "Bad credentials"})
            ),
            None
        );
    }

    #[test]
    fn repositories_are_read_from_recorded_answers() {
        let github = json!([{
            "full_name": "ada/engine", "description": "", "private": true,
            "clone_url": "https://github.com/ada/engine.git",
            "ssh_url": "git@github.com:ada/engine.git",
            "pushed_at": "2026-10-20T10:00:00Z", "updated_at": "2026-01-01T00:00:00Z"
        }]);
        assert_eq!(
            parse_repos(HostingProvider::Github, &github),
            [HostedRepo {
                full_name: "ada/engine".into(),
                description: None,
                private: true,
                https_url: "https://github.com/ada/engine.git".into(),
                ssh_url: Some("git@github.com:ada/engine.git".into()),
                updated: Some("2026-10-20T10:00:00Z".into()),
            }]
        );
        let gitlab = json!([{
            "path_with_namespace": "group/sub/tool", "description": "A tool",
            "visibility": "internal", "http_url_to_repo": "https://gitlab.com/group/sub/tool.git",
            "ssh_url_to_repo": "git@gitlab.com:group/sub/tool.git",
            "last_activity_at": "2026-10-01T00:00:00Z"
        }]);
        let repos = parse_repos(HostingProvider::Gitlab, &gitlab);
        assert_eq!(repos[0].full_name, "group/sub/tool");
        assert!(repos[0].private);
        assert_eq!(repos[0].description.as_deref(), Some("A tool"));
        let bitbucket = json!({"values": [{
            "full_name": "team/app", "is_private": false, "updated_on": "2026-09-09T00:00:00Z",
            "links": {"clone": [
                {"name": "https", "href": "https://ada@bitbucket.org/team/app.git"},
                {"name": "ssh", "href": "git@bitbucket.org:team/app.git"}
            ]}
        }], "next": "https://api.bitbucket.org/2.0/repositories?page=2"});
        let repos = parse_repos(HostingProvider::Bitbucket, &bitbucket);
        assert_eq!(repos[0].https_url, "https://bitbucket.org/team/app.git");
        assert_eq!(
            repos[0].ssh_url.as_deref(),
            Some("git@bitbucket.org:team/app.git")
        );
        // Entries without a name or URL are skipped, not fatal.
        assert!(parse_repos(HostingProvider::Github, &json!([{"name": "x"}])).is_empty());
    }

    #[test]
    fn github_pages_follow_the_link_header() {
        let header = "<https://api.github.com/user/repos?page=2>; rel=\"next\", \
                      <https://api.github.com/user/repos?page=5>; rel=\"last\"";
        assert_eq!(
            next_link(header).as_deref(),
            Some("https://api.github.com/user/repos?page=2")
        );
        assert_eq!(next_link("<https://x?page=1>; rel=\"prev\""), None);
    }
}
