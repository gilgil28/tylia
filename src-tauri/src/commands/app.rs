use serde_json::Value;
use tauri::{State, WebviewWindow};
use tylia_git::GitInfo;

use crate::error::IpcError;
use crate::settings::Settings;
use crate::state::{AppState, git};
use crate::window;

#[tauri::command]
pub async fn git_version() -> Result<GitInfo, IpcError> {
    Ok(git()?.info().await?)
}

#[tauri::command]
pub fn set_settings(
    settings: Settings,
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> Result<(), IpcError> {
    state.settings.save(&settings)?;
    crate::state::set_git_path(settings.git_path.as_deref());
    window::apply_theme(&window, settings.theme);
    Ok(())
}

#[tauri::command]
pub fn load_ui_state(state: State<'_, AppState>) -> Value {
    state.ui_state.load()
}

#[tauri::command]
pub fn save_ui_state(value: Value, state: State<'_, AppState>) -> Result<(), IpcError> {
    Ok(state.ui_state.save(&value)?)
}
