use tauri::State;
use tauri::ipc::Channel;
use tylia_git::{CloneRequest, Progress, RepoInfo};

use crate::error::IpcError;
use crate::operation::Operation;
use crate::state::{AppState, git, lock};

/// Clones with progress on `on_progress`; `operation_id` (chosen by the frontend) can be
/// passed to `cancel_operation`.
#[tauri::command]
pub async fn clone_repo(
    request: CloneRequest,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<RepoInfo, IpcError> {
    let git = git()?;
    let result = {
        let mut op = Operation::start(&state, operation_id, None, false, on_progress);
        let mut report = op.reporter();
        git.clone_repo(&request, op.context(&mut report)).await
    };
    let repo = result?;
    // Fast history for the new repository; runs in the background, failures are harmless.
    let path = std::path::PathBuf::from(&repo.path);
    tauri::async_runtime::spawn(async move {
        let _ = git.write_commit_graph(&path).await;
    });
    Ok(repo)
}

#[tauri::command]
pub fn cancel_operation(operation_id: u32, state: State<'_, AppState>) {
    if let Some(tx) = lock(&state.operations).remove(&operation_id) {
        let _ = tx.send(());
    }
    state.askpass.end_operation(operation_id);
}
