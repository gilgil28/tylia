use tauri::State;

use crate::state::AppState;

/// Answers a credential prompt shown from an `askpass-prompt` event; `None` cancels it.
#[tauri::command]
pub fn askpass_respond(id: u32, answer: Option<String>, state: State<'_, AppState>) {
    state.askpass.respond(id, answer);
}
