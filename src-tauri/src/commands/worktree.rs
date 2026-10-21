//! Working-copy writes. Each takes the repository's write lock, so writes never overlap.

use std::path::Path;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tylia_git::{LinesRequest, add_to_gitignore, repo_path};

use crate::error::IpcError;
use crate::state::{AppState, git};

#[tauri::command]
pub async fn stage_files(
    repo: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.stage_files(Path::new(&repo), &paths).await?)
}

#[tauri::command]
pub async fn unstage_files(
    repo: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.unstage_files(Path::new(&repo), &paths).await?)
}

#[tauri::command]
pub async fn stage_all(repo: String, state: State<'_, AppState>) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.stage_all(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn unstage_all(repo: String, state: State<'_, AppState>) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.unstage_all(Path::new(&repo)).await?)
}

/// Discards working-tree changes; untracked files go to the OS trash.
#[tauri::command]
pub async fn discard_files(
    repo: String,
    tracked: Vec<String>,
    untracked: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .discard_files(Path::new(&repo), &tracked, &untracked)
        .await?)
}

/// Stages, unstages or discards selected lines (or whole hunks).
#[tauri::command]
pub async fn apply_lines(
    repo: String,
    request: LinesRequest,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.apply_lines(Path::new(&repo), &request).await?)
}

/// Commits the index; returns the new commit id.
#[tauri::command]
pub async fn commit(
    repo: String,
    message: String,
    amend: bool,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.commit(Path::new(&repo), &message, amend).await?)
}

/// The HEAD commit's message, to prefill an amend.
#[tauri::command]
pub async fn head_message(repo: String) -> Result<Option<String>, IpcError> {
    Ok(git()?.head_message(Path::new(&repo)).await?)
}

/// Adds a pattern to the repository's `.gitignore`.
#[tauri::command]
pub async fn ignore_pattern(
    repo: String,
    pattern: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(add_to_gitignore(Path::new(&repo), &pattern)?)
}

/// Opens a file of the working tree with the OS default application.
#[tauri::command]
pub fn open_file(repo: String, path: String, app: AppHandle) -> Result<(), IpcError> {
    let full = repo_path(Path::new(&repo), &path)?;
    app.opener()
        .open_path(full.display().to_string(), None::<&str>)
        .map_err(|e| IpcError::from(std::io::Error::other(e)))
}
