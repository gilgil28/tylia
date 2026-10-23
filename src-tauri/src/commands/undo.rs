//! Undo and redo (Phase 11 A): local writes are recorded in `tylia-git`'s journal. Lost
//! commits (Phase 11 B).

use std::future::Future;
use std::path::Path;

use tauri::State;
use tylia_git::{LostCommit, UndoKind, UndoState};

use crate::error::IpcError;
use crate::state::{AppState, git};

/// Runs a local write (the caller holds the write lock) and records it for undo. Undo is a
/// convenience: if the journal can't capture the repository, the write still runs.
pub(crate) async fn journaled<T, F, Fut>(
    repo: &str,
    kind: UndoKind,
    write: F,
) -> Result<T, IpcError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, IpcError>>,
{
    let git = git()?;
    let path = Path::new(repo);
    let pending = git.undo_begin(path, kind).await.ok();
    let result = write().await;
    // Also after a failure: whatever it changed can be undone.
    if let Some(pending) = pending {
        let _ = git.undo_finish(path, pending).await;
    }
    result
}

#[tauri::command]
pub async fn undo_state(repo: String) -> Result<UndoState, IpcError> {
    Ok(git()?.undo_state(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn undo(repo: String, state: State<'_, AppState>) -> Result<UndoState, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.undo(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn redo(repo: String, state: State<'_, AppState>) -> Result<UndoState, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.redo(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn lost_commits(repo: String) -> Result<Vec<LostCommit>, IpcError> {
    Ok(git()?.lost_commits(Path::new(&repo)).await?)
}

/// `git fsck`: slow on large repositories, so only when asked ("Search deeper").
#[tauri::command]
pub async fn dangling_commits(repo: String) -> Result<Vec<LostCommit>, IpcError> {
    Ok(git()?.dangling_commits(Path::new(&repo)).await?)
}
