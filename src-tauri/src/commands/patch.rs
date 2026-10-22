//! Patch files: save a commit or changes as a patch, preview one, apply it.

use std::path::Path;

use tauri::State;
use tylia_git::{IntegrateOutcome, PatchApplyMode, PatchPreview};

use crate::error::IpcError;
use crate::state::{AppState, git};

#[tauri::command]
pub async fn save_commit_patch(repo: String, oid: String, file: String) -> Result<(), IpcError> {
    Ok(git()?
        .save_commit_patch(Path::new(&repo), &oid, Path::new(&file))
        .await?)
}

#[tauri::command]
pub async fn save_changes_patch(repo: String, staged: bool, file: String) -> Result<(), IpcError> {
    Ok(git()?
        .save_changes_patch(Path::new(&repo), staged, Path::new(&file))
        .await?)
}

#[tauri::command]
pub async fn preview_patch(repo: String, file: String) -> Result<PatchPreview, IpcError> {
    Ok(git()?
        .preview_patch(Path::new(&repo), Path::new(&file))
        .await?)
}

#[tauri::command]
pub async fn apply_patch_file(
    repo: String,
    file: String,
    mode: PatchApplyMode,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .apply_patch_file(Path::new(&repo), Path::new(&file), mode)
        .await?)
}
