//! Running a custom action (Settings → Actions); `cancel_operation` stops it.

use tauri::State;
use tokio::sync::oneshot;

use crate::custom_action::{self, ActionContext, ActionRun, CustomAction};
use crate::error::IpcError;
use crate::state::{AppState, lock};

/// The program and arguments the action would run here (for "ask before running").
#[tauri::command]
pub fn custom_action_command(
    action: CustomAction,
    context: ActionContext,
) -> Result<Vec<String>, IpcError> {
    let (program, args) = custom_action::command_line(&action, &context)?;
    Ok(std::iter::once(program).chain(args).collect())
}

#[tauri::command]
pub async fn run_custom_action(
    action: CustomAction,
    context: ActionContext,
    operation_id: u32,
    state: State<'_, AppState>,
) -> Result<ActionRun, IpcError> {
    let (tx, rx) = oneshot::channel();
    lock(&state.operations).insert(operation_id, tx);
    let result = custom_action::run(&action, &context, rx).await;
    lock(&state.operations).remove(&operation_id);
    result
}
