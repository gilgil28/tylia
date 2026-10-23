//! Undo and redo (Phase 11 A): local writes are recorded in `tylia-git`'s journal. Lost
//! commits (Phase 11 B).

use std::future::Future;
use std::path::Path;

use tauri::State;
use tylia_git::{BackupPending, DiscardBackup, LostCommit, RestoreOutcome, UndoKind, UndoState};

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

/// Runs a discard (the caller holds the write lock) after `begin` snapshotted what it
/// throws away; returns the write's result and the backup's id. Like the journal, a backup
/// that can't be taken doesn't stop the write.
pub(crate) async fn backed_up<T, B, W, BFut, WFut>(
    repo: &str,
    begin: B,
    write: W,
) -> Result<(T, Option<String>), IpcError>
where
    B: FnOnce() -> BFut,
    BFut: Future<Output = Result<Option<BackupPending>, tylia_git::GitError>>,
    W: FnOnce() -> WFut,
    WFut: Future<Output = Result<T, IpcError>>,
{
    let git = git()?;
    let pending = begin().await.ok().flatten();
    let result = write().await?;
    let id = match pending {
        Some(pending) => git
            .backup_finish(Path::new(repo), pending)
            .await
            .ok()
            .flatten(),
        None => None,
    };
    Ok((result, id))
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

/// Backups of discarded changes, newest first; old ones are pruned first.
#[tauri::command]
pub async fn discard_backups(repo: String) -> Result<Vec<DiscardBackup>, IpcError> {
    let git = git()?;
    let _ = git.prune_backups(Path::new(&repo)).await;
    Ok(git.discard_backups(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn restore_backup(
    repo: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<RestoreOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.restore_backup(Path::new(&repo), &id).await?)
}
