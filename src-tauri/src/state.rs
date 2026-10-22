use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use tokio::sync::{OwnedMutexGuard, oneshot};
use tylia_git::Git;

use crate::askpass::Askpass;
use crate::commands::{Distribution, distribution};
use crate::error::IpcError;
use crate::path_index::PathIndexes;
use crate::settings::{Settings, SettingsStore};
use crate::ui_state::UiStateStore;
use crate::watcher::RepoWatcher;

/// App-wide state managed by Tauri.
pub struct AppState {
    pub settings: SettingsStore,
    pub ui_state: UiStateStore,
    /// File watchers of open repositories, by repository path.
    pub watchers: Mutex<HashMap<String, RepoWatcher>>,
    /// Latest history stream per repository; older streams stop when this changes.
    pub history_generation: Mutex<HashMap<String, u64>>,
    /// Cancel handles of running operations (clone), by frontend-chosen id.
    pub operations: Mutex<HashMap<u32, oneshot::Sender<()>>>,
    /// One write at a time per repository (ARCHITECTURE §5.2).
    pub write_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Relays Git's credential and ssh prompts to the UI.
    pub askpass: Askpass,
    /// Every path in each repository's history, for path search and its suggestions.
    pub path_indexes: PathIndexes,
    /// Hosting-account tokens of this session, by account (see `hosting.rs`): the only copy
    /// when no credential helper keeps them.
    pub hosting_tokens: Mutex<HashMap<String, String>>,
}

impl AppState {
    pub fn new(settings: SettingsStore, ui_state: UiStateStore, askpass: Askpass) -> Self {
        Self {
            settings,
            ui_state,
            watchers: Mutex::default(),
            history_generation: Mutex::default(),
            operations: Mutex::default(),
            write_locks: Mutex::default(),
            askpass,
            path_indexes: PathIndexes::default(),
            hosting_tokens: Mutex::default(),
        }
    }

    /// Waits for and holds the repository's write lock.
    pub async fn write_lock(&self, repo: &str) -> OwnedMutexGuard<()> {
        let lock = lock(&self.write_locks)
            .entry(repo.to_owned())
            .or_default()
            .clone();
        lock.lock_owned().await
    }
}

/// The Git executable chosen in Settings, if any (set at start and on every settings save).
static GIT_PATH: RwLock<Option<PathBuf>> = RwLock::new(None);
/// Settings → Git → "Use the system's Git", in the Flatpak only.
static HOST_GIT: AtomicBool = AtomicBool::new(false);

pub fn set_git(settings: &Settings) {
    let path = settings
        .git_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);
    *GIT_PATH.write().unwrap_or_else(|e| e.into_inner()) = path;
    HOST_GIT.store(
        settings.host_git && distribution() == Distribution::Flatpak,
        Ordering::Relaxed,
    );
}

/// Whether Git runs outside the Flatpak sandbox (its prompts need the host-side helper).
pub fn host_git() -> bool {
    HOST_GIT.load(Ordering::Relaxed)
}

/// The Git executable: the host's when chosen in the Flatpak, else the one chosen in
/// Settings, else discovered per call (cheap, and picks up an install or PATH change
/// without restarting).
pub fn git() -> Result<Git, IpcError> {
    if host_git() {
        return Ok(Git::flatpak_host());
    }
    if let Some(path) = GIT_PATH.read().unwrap_or_else(|e| e.into_inner()).clone() {
        return if path.is_file() {
            Ok(Git::with_path(path))
        } else {
            Err(tylia_git::GitError::NotFound.into())
        };
    }
    Ok(Git::discover()?)
}

/// Locks a mutex, recovering the data if a previous holder panicked.
pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
