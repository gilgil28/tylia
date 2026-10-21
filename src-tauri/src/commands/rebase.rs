//! Interactive rebase (Phase 5): the commits after a base, and replaying them by a plan. The
//! rebase holds the repository's write lock; stops are continued through `branch.rs`.

use std::path::Path;

use tauri::State;
use tylia_git::{IntegrateOutcome, RebaseTodo, TodoItem};

use crate::error::IpcError;
use crate::state::{AppState, git};

#[tauri::command]
pub async fn rebase_todo(repo: String, base: String) -> Result<RebaseTodo, IpcError> {
    Ok(git()?.rebase_todo(Path::new(&repo), &base).await?)
}

#[tauri::command]
pub async fn is_rebase_base(repo: String, oid: String) -> Result<bool, IpcError> {
    Ok(git()?.is_rebase_base(Path::new(&repo), &oid).await?)
}

#[tauri::command]
pub async fn rebase_interactive(
    repo: String,
    base: String,
    plan: Vec<TodoItem>,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .rebase_interactive(Path::new(&repo), &base, &plan)
        .await?)
}
