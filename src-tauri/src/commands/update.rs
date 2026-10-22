//! Opt-in update check and install (tauri-plugin-updater). Nothing here runs unless the user
//! turned on "Check for updates" or pressed "Check now": the only request is a GET of the
//! release manifest (no version or machine details in the URL), then of the signed bundle.

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use ts_rs::TS;

use crate::error::{IpcError, IpcErrorKind};
use crate::state::lock;

/// The update found by the last check, kept for `install_update`.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// RFC 3339 publish date (`pub_date` of the manifest), if the release has one.
    pub date: Option<String>,
    /// Release notes (Markdown as written on the release).
    pub notes: Option<String>,
    /// Whether Tylia can install it itself; otherwise the user downloads it (or, for a
    /// package-manager install such as the AUR, updates through the package manager).
    pub can_install: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DownloadProgress {
    #[ts(type = "number")]
    pub downloaded: u64,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
}

fn update_error(err: tauri_plugin_updater::Error) -> IpcError {
    IpcError {
        kind: IpcErrorKind::UpdateFailed,
        message: err.to_string(),
        command: None,
        stderr: None,
        files: None,
    }
}

/// Where this copy of Tylia gets its updates, when that isn't Tylia itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub enum Distribution {
    /// A Flatpak: Flathub updates it, so Tylia doesn't check for updates at all.
    Flatpak,
    /// A pacman package (from the AUR): pacman must stay in charge of the files.
    Pacman,
    /// Tylia's own installers and bundles (the updater decides per bundle).
    Other,
}

pub fn distribution() -> Distribution {
    #[cfg(target_os = "linux")]
    {
        if std::path::Path::new("/.flatpak-info").is_file() {
            return Distribution::Flatpak;
        }
        if on_path("pacman") {
            return Distribution::Pacman;
        }
    }
    Distribution::Other
}

#[cfg(target_os = "linux")]
fn on_path(tool: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|d| d.join(tool).is_file()))
}

/// Installing in place works for the Windows and macOS bundles and the AppImage. A .deb or
/// .rpm is installed with the system's package tool, so only where that tool exists and
/// isn't pacman's (the AUR's `tylia-bin` repackages the .deb).
fn can_install() -> bool {
    #[cfg(target_os = "linux")]
    {
        use tauri::utils::config::BundleType;
        if distribution() != Distribution::Other {
            return false;
        }
        match tauri::utils::platform::bundle_type() {
            Some(BundleType::AppImage) => std::env::var_os("APPIMAGE").is_some(),
            Some(BundleType::Deb) => on_path("dpkg"),
            Some(BundleType::Rpm) => on_path("rpm"),
            _ => false,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        tauri::utils::platform::bundle_type().is_some()
    }
}

/// Asks the release server for a newer version; `None` when this one is the latest.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, IpcError> {
    let update = app
        .updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        date: u
            .raw_json
            .get("pub_date")
            .and_then(|d| d.as_str())
            .map(str::to_owned),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        can_install: can_install(),
    });
    *lock(&pending.0) = update;
    Ok(info)
}

/// Downloads, verifies (minisign signature) and installs the update found by the last check,
/// then restarts Tylia. On Windows the installer closes the app itself.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), IpcError> {
    let Some(update) = lock(&pending.0).clone() else {
        return Err(IpcError::invalid(
            "There's no update to install. Check for updates first.".to_owned(),
        ));
    };
    let mut downloaded = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_progress.send(DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(update_error)?;
    app.restart()
}
