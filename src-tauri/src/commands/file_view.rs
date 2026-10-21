//! A single file's blame and history. Reads only: no write lock.

use std::path::Path;

use tylia_git::{Blame, FileHistoryPage};

use crate::error::IpcError;
use crate::state::git;

#[tauri::command]
pub async fn get_blame(
    repo: String,
    path: String,
    rev: Option<String>,
    force: bool,
) -> Result<Blame, IpcError> {
    Ok(git()?
        .blame(Path::new(&repo), &path, rev.as_deref(), force)
        .await?)
}

#[tauri::command]
pub async fn get_file_history(
    repo: String,
    path: String,
    rev: Option<String>,
    skip: u32,
    limit: u32,
) -> Result<FileHistoryPage, IpcError> {
    Ok(git()?
        .file_history(Path::new(&repo), &path, rev.as_deref(), skip, limit)
        .await?)
}
