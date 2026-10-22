//! Hosting accounts: sign in with a token, sign out, list repositories (`hosting.rs`).

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::error::IpcError;
use crate::hosting::{self, HostedRepo, HostingAccount, HostingProvider};
use crate::state::{AppState, git, lock};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AddedAccount {
    pub account: HostingAccount,
    /// The token went to a credential helper; otherwise it lasts until Tylia quits.
    pub saved: bool,
}

/// `git credential` needs a folder to run in; outside any repository.
fn neutral_dir() -> std::path::PathBuf {
    std::env::temp_dir()
}

fn cache_key(account: &HostingAccount) -> String {
    let key = account.credential_key();
    format!("{}\n{}", key.host, key.username)
}

/// Checks the token with the provider, then stores it with Git's credential helpers.
#[tauri::command]
pub async fn add_hosting_account(
    provider: HostingProvider,
    host: String,
    login: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<AddedAccount, IpcError> {
    let token = token.trim().to_owned();
    if token.is_empty() {
        return Err(IpcError::invalid("Paste a token first.".to_owned()));
    }
    let host = match provider {
        HostingProvider::Bitbucket => "bitbucket.org".to_owned(),
        HostingProvider::Github if host.trim().is_empty() => "github.com".to_owned(),
        HostingProvider::Gitlab if host.trim().is_empty() => "gitlab.com".to_owned(),
        _ => hosting::normalize_host(&host)?,
    };
    let login = login.trim().to_owned();
    if provider == HostingProvider::Bitbucket && !login.contains('@') {
        return Err(IpcError::invalid(
            "Bitbucket API tokens sign in with your Atlassian account's email.".to_owned(),
        ));
    }
    let account = hosting::verify(
        HostingAccount {
            provider,
            host,
            login,
            name: String::new(),
        },
        &token,
    )
    .await?;
    let key = account.credential_key();
    let git = git()?;
    git.store_secret(&neutral_dir(), &key, &token).await?;
    let saved = git.read_secret(&neutral_dir(), &key).await?.as_deref() == Some(token.as_str());
    lock(&state.hosting_tokens).insert(cache_key(&account), token);
    Ok(AddedAccount { account, saved })
}

/// Forgets the account's token (the frontend removes the account from settings).
#[tauri::command]
pub async fn remove_hosting_account(
    account: HostingAccount,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    lock(&state.hosting_tokens).remove(&cache_key(&account));
    Ok(git()?
        .erase_secret(&neutral_dir(), &account.credential_key())
        .await?)
}

/// The account's repositories, most recently active first.
#[tauri::command]
pub async fn list_hosted_repos(
    account: HostingAccount,
    state: State<'_, AppState>,
) -> Result<Vec<HostedRepo>, IpcError> {
    let cached = lock(&state.hosting_tokens)
        .get(&cache_key(&account))
        .cloned();
    let token = match cached {
        Some(token) => token,
        None => git()?
            .read_secret(&neutral_dir(), &account.credential_key())
            .await?
            .ok_or_else(|| {
                IpcError::invalid(format!(
                    "Tylia no longer has the token for {} on {}. Sign in again in Settings → Accounts.",
                    account.name, account.host
                ))
            })?,
    };
    hosting::repos(&account, &token).await
}
