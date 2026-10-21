//! Repository settings: identity, SSH key, saved credentials, remotes (read). Writes go to
//! the repository's own config only and hold its write lock.

use std::path::{Path, PathBuf};

use tauri::State;
use tylia_git::RepoConfig;

use crate::error::IpcError;
use crate::state::{AppState, git};

#[tauri::command]
pub async fn repo_config(repo: String) -> Result<RepoConfig, IpcError> {
    Ok(git()?.repo_config(Path::new(&repo)).await?)
}

/// `None` (or blank) for either removes the repository's own value (the global one applies).
#[tauri::command]
pub async fn set_identity(
    repo: String,
    name: Option<String>,
    email: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .set_identity(Path::new(&repo), name.as_deref(), email.as_deref())
        .await?)
}

/// The private key this repository's SSH remotes use; `None` for the defaults.
#[tauri::command]
pub async fn set_ssh_key(
    repo: String,
    key: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    let key = key.map(PathBuf::from);
    Ok(git()?.set_ssh_key(Path::new(&repo), key.as_deref()).await?)
}

/// Asks the credential helper to forget the sign-in saved for an HTTPS remote URL.
#[tauri::command]
pub async fn forget_credentials(repo: String, url: String) -> Result<(), IpcError> {
    Ok(git()?.forget_credentials(Path::new(&repo), &url).await?)
}
