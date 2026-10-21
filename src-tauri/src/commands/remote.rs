//! Fetch, pull, push and remote management. Network operations report progress on a
//! channel and can be cancelled with `cancel_operation(operation_id)`.

use std::path::Path;

use tauri::State;
use tauri::ipc::Channel;
use tylia_git::{FetchRequest, Progress, PullMode, PullOutcome, PushOutcome, PushRequest};

use crate::error::IpcError;
use crate::operation::Operation;
use crate::state::{AppState, git};

/// `quiet` is for background fetches: they never show a credential prompt.
#[tauri::command]
pub async fn fetch(
    repo: String,
    request: FetchRequest,
    quiet: bool,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let git = git()?;
    let mut op = Operation::start(&state, operation_id, Some(&repo), quiet, on_progress);
    let mut report = op.reporter();
    Ok(git
        .fetch(Path::new(&repo), &request, op.context(&mut report))
        .await?)
}

/// Pulls the current branch; holds the write lock, since it changes the working copy.
#[tauri::command]
pub async fn pull(
    repo: String,
    mode: PullMode,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<PullOutcome, IpcError> {
    let git = git()?;
    let _guard = state.write_lock(&repo).await;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    Ok(git
        .pull(Path::new(&repo), mode, op.context(&mut report))
        .await?)
}

#[tauri::command]
pub async fn push(
    repo: String,
    request: PushRequest,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<PushOutcome, IpcError> {
    let git = git()?;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    Ok(git
        .push(Path::new(&repo), &request, op.context(&mut report))
        .await?)
}

#[tauri::command]
pub async fn add_remote(
    repo: String,
    name: String,
    url: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.add_remote(Path::new(&repo), &name, &url).await?)
}

/// Sets the fetch URL, or with `push` the push URL (empty removes it).
#[tauri::command]
pub async fn set_remote_url(
    repo: String,
    name: String,
    url: String,
    push: bool,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .set_remote_url(Path::new(&repo), &name, &url, push)
        .await?)
}

#[tauri::command]
pub async fn rename_remote(
    repo: String,
    name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .rename_remote(Path::new(&repo), &name, &new_name)
        .await?)
}

#[tauri::command]
pub async fn remove_remote(
    repo: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.remove_remote(Path::new(&repo), &name).await?)
}
