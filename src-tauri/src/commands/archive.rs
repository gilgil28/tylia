//! Exporting a commit, branch or tag as a zip or tar.gz.

use std::path::Path;

use tylia_git::ArchiveFormat;

use crate::error::IpcError;
use crate::state::git;

#[tauri::command]
pub async fn export_archive(
    repo: String,
    rev: String,
    label: String,
    format: ArchiveFormat,
    file: String,
) -> Result<(), IpcError> {
    Ok(git()?
        .export_archive(Path::new(&repo), &rev, &label, format, Path::new(&file))
        .await?)
}
