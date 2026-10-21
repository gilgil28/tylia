//! Per-repository history path indexes (tylia-git `paths.rs`), kept for the session.
//!
//! The first build walks the whole history (about 5 s on git/git), so suggestions never wait
//! for it: they come from the tracked files until the index is ready. A path search waits,
//! since its result depends on every path. Later updates only walk new commits.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tylia_git::{Git, GitError, PathIndex};

use crate::state::lock;

#[derive(Default)]
struct PathSlot {
    index: tokio::sync::Mutex<Option<PathIndex>>,
    building: AtomicBool,
}

#[derive(Default)]
pub struct PathIndexes(Mutex<HashMap<String, Arc<PathSlot>>>);

impl PathIndexes {
    fn slot(&self, repo: &str) -> Arc<PathSlot> {
        lock(&self.0).entry(repo.to_owned()).or_default().clone()
    }

    /// Runs `f` on the up-to-date index, building it first if needed (waits).
    pub async fn with_current<R>(
        &self,
        git: &Git,
        repo: &str,
        f: impl FnOnce(&PathIndex) -> R,
    ) -> Result<R, GitError> {
        let slot = self.slot(repo);
        let mut guard = slot.index.lock().await;
        let index = guard.get_or_insert_with(PathIndex::default);
        git.update_path_index(Path::new(repo), index).await?;
        Ok(f(index))
    }

    /// Runs `f` on the index if it's ready (brought up to date first; cheap after the first
    /// build). Otherwise starts the first build in the background and returns `None`.
    pub async fn with_ready<R>(
        &self,
        git: &Git,
        repo: &str,
        f: impl FnOnce(&PathIndex) -> R,
    ) -> Result<Option<R>, GitError> {
        let slot = self.slot(repo);
        if let Ok(mut guard) = slot.index.try_lock()
            && let Some(index) = guard.as_mut()
        {
            git.update_path_index(Path::new(repo), index).await?;
            return Ok(Some(f(index)));
        }
        if !slot.building.swap(true, Ordering::AcqRel) {
            let (git, repo) = (git.clone(), repo.to_owned());
            tauri::async_runtime::spawn(async move {
                {
                    let mut guard = slot.index.lock().await;
                    let mut index = guard.take().unwrap_or_default();
                    // On failure the next request tries again.
                    if git
                        .update_path_index(Path::new(&repo), &mut index)
                        .await
                        .is_ok()
                    {
                        *guard = Some(index);
                    }
                }
                slot.building.store(false, Ordering::Release);
            });
        }
        Ok(None)
    }
}
