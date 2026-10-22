use serde_json::Value;
use tauri::{State, WebviewWindow};
use tylia_git::GitInfo;

use crate::cli_link::CliLinkOutcome;
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
    crate::state::set_git(&settings);
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

/// "Install the tylia command": macOS only (`cli_link.rs`); elsewhere the installer or the
/// package puts it on `PATH`.
#[tauri::command]
pub async fn install_cli() -> Result<CliLinkOutcome, IpcError> {
    // The password prompt can take a while: off the async runtime's threads.
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(crate::cli_link::install)
            .await
            .map_err(|err| IpcError::invalid(err.to_string()))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(IpcError::invalid(
            "The installer or package already puts the tylia command on PATH.".to_owned(),
        ))
    }
}
