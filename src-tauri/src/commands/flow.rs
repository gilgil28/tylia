//! git-flow helpers. Writes hold the repository's write lock.

use std::path::Path;

use tauri::State;
use tylia_git::{FlowConfig, FlowFinishRequest, FlowFinished, FlowKind, FlowState, UndoKind};

use crate::commands::undo::journaled;
use crate::error::IpcError;
use crate::state::{AppState, git};

#[tauri::command]
pub async fn flow_state(repo: String) -> Result<FlowState, IpcError> {
    Ok(git()?.flow_state(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn flow_init(
    repo: String,
    config: FlowConfig,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.flow_init(Path::new(&repo), &config).await?)
}

/// Returns the new branch's name.
#[tauri::command]
pub async fn flow_start(
    repo: String,
    kind: FlowKind,
    name: String,
    state: State<'_, AppState>,
) -> Result<String, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.flow_start(Path::new(&repo), kind, &name).await?)
}

#[tauri::command]
pub async fn flow_finish(
    repo: String,
    request: FlowFinishRequest,
    state: State<'_, AppState>,
) -> Result<FlowFinished, IpcError> {
    let _guard = state.write_lock(&repo).await;
    journaled(&repo, UndoKind::FlowFinish, || async {
        Ok(git()?.flow_finish(Path::new(&repo), &request).await?)
    })
    .await
}
