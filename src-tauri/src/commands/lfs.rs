//! Git LFS: LFS files, tracking, pulling objects and locks (`tylia_git::lfs`). The network
//! ones (pull, locks) report progress and cancel like fetch.

use std::path::Path;

use tauri::State;
use tauri::ipc::Channel;
use tylia_git::{LfsLocks, Progress};

use crate::error::IpcError;
use crate::operation::Operation;
use crate::state::{AppState, git};

/// The paths among `paths` that Git LFS stores.
#[tauri::command]
pub async fn lfs_files(repo: String, paths: Vec<String>) -> Result<Vec<String>, IpcError> {
    Ok(git()?.lfs_files(Path::new(&repo), &paths).await?)
}

#[tauri::command]
pub async fn lfs_track(
    repo: String,
    pattern: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.lfs_track(Path::new(&repo), &pattern).await?)
}

#[tauri::command]
pub async fn lfs_pull(
    repo: String,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let git = git()?;
    let _guard = state.write_lock(&repo).await;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    Ok(git
        .lfs_pull(Path::new(&repo), op.context(&mut report))
        .await?)
}

#[tauri::command]
pub async fn lfs_locks(
    repo: String,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<LfsLocks, IpcError> {
    let git = git()?;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    Ok(git
        .lfs_locks(Path::new(&repo), op.context(&mut report))
        .await?)
}

/// Locks (`lock: true`) or unlocks `path` on the server.
#[tauri::command]
pub async fn lfs_set_lock(
    repo: String,
    path: String,
    lock: bool,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let git = git()?;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    let ctx = op.context(&mut report);
    if lock {
        git.lfs_lock(Path::new(&repo), &path, ctx).await?;
    } else {
        git.lfs_unlock(Path::new(&repo), &path, ctx).await?;
    }
    Ok(())
}
