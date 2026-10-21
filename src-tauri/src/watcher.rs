//! Watches open repositories and tells the frontend what to refresh.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, NoCache, new_debouncer_opt};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

const DEBOUNCE: Duration = Duration::from_millis(400);
pub const REPO_CHANGED_EVENT: &str = "repo-changed";

/// Payload of the `repo-changed` event.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoChanged {
    pub repo: String,
    /// Branches, tags, HEAD or stashes changed (history and sidebar are stale).
    pub refs: bool,
    /// Working-tree files or the index changed (status is stale).
    pub worktree: bool,
}

/// No file-ID cache: it would walk the whole working tree up front (gigabytes of build
/// output in some repositories), and rename tracking isn't needed here.
pub type RepoWatcher = Debouncer<notify::RecommendedWatcher, NoCache>;

/// Ignored files and directories (absolute). Changes inside them don't refresh anything,
/// so builds writing to `target/`, `build/`, `node_modules/`… stay quiet.
type Ignored = Arc<RwLock<Vec<PathBuf>>>;

pub fn watch(
    app: AppHandle,
    repo: String,
    git_dir: PathBuf,
    ignored: Vec<String>,
) -> notify::Result<RepoWatcher> {
    let root = PathBuf::from(&repo);
    let ignored: Ignored = Arc::new(RwLock::new(absolute(&root, &ignored)));
    let (root_for_events, git_dir_for_events, ignored_for_events) =
        (root.clone(), git_dir.clone(), ignored.clone());
    let handler = move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let mut change = RepoChanged {
            repo: repo.clone(),
            refs: false,
            worktree: false,
        };
        let mut gitignore_changed = false;
        {
            let ignored = ignored_for_events.read().unwrap_or_else(|e| e.into_inner());
            for path in events.iter().flat_map(|e| e.paths.iter()) {
                if ignored.iter().any(|i| path.starts_with(i)) {
                    continue;
                }
                gitignore_changed |= path.file_name().is_some_and(|n| n == ".gitignore");
                classify(path, &root_for_events, &git_dir_for_events, &mut change);
            }
        }
        if gitignore_changed {
            refresh_ignored(root_for_events.clone(), ignored_for_events.clone());
        }
        if change.refs || change.worktree {
            let _ = app.emit(REPO_CHANGED_EVENT, change);
        }
    };
    let mut debouncer = new_debouncer_opt::<_, notify::RecommendedWatcher, NoCache>(
        DEBOUNCE,
        None,
        handler,
        NoCache,
        notify::Config::default(),
    )?;
    debouncer.watch(&root, RecursiveMode::Recursive)?;
    // A linked worktree or separate git dir lives outside the working tree.
    if !git_dir.starts_with(&root) {
        debouncer.watch(&git_dir, RecursiveMode::Recursive)?;
    }
    Ok(debouncer)
}

fn absolute(root: &Path, relative: &[String]) -> Vec<PathBuf> {
    relative
        .iter()
        .map(|p| root.join(p.trim_end_matches('/')))
        .collect()
}

/// Re-reads the ignored paths after a `.gitignore` changed.
fn refresh_ignored(root: PathBuf, ignored: Ignored) {
    tauri::async_runtime::spawn(async move {
        let Ok(git) = crate::state::git() else { return };
        if let Ok(paths) = git.ignored_paths(&root).await {
            *ignored.write().unwrap_or_else(|e| e.into_inner()) = absolute(&root, &paths);
        }
    });
}

fn classify(path: &Path, root: &Path, git_dir: &Path, change: &mut RepoChanged) {
    if let Ok(rel) = path.strip_prefix(git_dir) {
        let first = rel.components().next();
        let name = first.and_then(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        });
        match name {
            Some("HEAD" | "refs" | "packed-refs" | "logs" | "FETCH_HEAD" | "ORIG_HEAD") => {
                change.refs = true
            }
            Some("index") => change.worktree = true,
            // objects/, lock files, hooks, config…: not interesting on their own.
            _ => {}
        }
    } else if path.starts_with(root) {
        change.worktree = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_paths() {
        let root = Path::new("/r");
        let git = Path::new("/r/.git");
        let check = |p: &str| {
            let mut c = RepoChanged {
                repo: String::new(),
                refs: false,
                worktree: false,
            };
            classify(Path::new(p), root, git, &mut c);
            (c.refs, c.worktree)
        };
        assert_eq!(check("/r/.git/refs/heads/main"), (true, false));
        assert_eq!(check("/r/.git/HEAD"), (true, false));
        assert_eq!(check("/r/.git/index"), (false, true));
        assert_eq!(check("/r/.git/objects/ab/cdef"), (false, false));
        assert_eq!(check("/r/.git/index.lock"), (false, false));
        assert_eq!(check("/r/src/main.rs"), (false, true));
        assert_eq!(check("/elsewhere/x"), (false, false));
    }

    #[test]
    fn ignored_paths_are_absolute_prefixes() {
        let root = Path::new("/r");
        let ignored = absolute(
            root,
            &["build/".into(), "app/.gradle/".into(), "x.log".into()],
        );
        assert!(Path::new("/r/build/out/a.class").starts_with(&ignored[0]));
        assert!(Path::new("/r/app/.gradle/cache").starts_with(&ignored[1]));
        assert!(Path::new("/r/x.log").starts_with(&ignored[2]));
        assert!(!Path::new("/r/buildSrc/a").starts_with(&ignored[0]));
    }
}
