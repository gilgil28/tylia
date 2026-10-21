//! Reading repositories: open, refs, status, history, commits, diffs, search, watching.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use ts_rs::TS;
use tylia_git::{
    CommitDetails, DiffRequest, FileDiff, HistoryBatch, LfsStatus, LogOptions, PathIndex,
    PathSuggestion, Progress, RefsSnapshot, RepoInfo, SearchField, Submodule, WorkingStatus,
    Worktree,
};

use crate::error::IpcError;
use crate::operation::Operation;
use crate::state::{AppState, git, lock};
use crate::watcher;

#[tauri::command]
pub async fn open_repo(path: String) -> Result<RepoInfo, IpcError> {
    Ok(git()?.open_repo(Path::new(&path)).await?)
}

#[tauri::command]
pub async fn init_repo(path: String) -> Result<RepoInfo, IpcError> {
    Ok(git()?.init_repo(Path::new(&path)).await?)
}

/// For the recent-repositories list: the branch, or a `notARepository` error if the folder
/// is gone or no longer a repository.
#[tauri::command]
pub async fn repo_branch(path: String) -> Result<Option<String>, IpcError> {
    Ok(git()?.current_branch(Path::new(&path)).await?)
}

#[tauri::command]
pub async fn get_refs(repo: String) -> Result<RefsSnapshot, IpcError> {
    Ok(git()?.refs(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn get_submodules(repo: String) -> Result<Vec<Submodule>, IpcError> {
    Ok(git()?.submodules(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn get_worktrees(repo: String) -> Result<Vec<Worktree>, IpcError> {
    Ok(git()?.worktrees(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn lfs_status(repo: String) -> Result<LfsStatus, IpcError> {
    Ok(git()?.lfs_status(Path::new(&repo)).await?)
}

/// Initializes and updates submodules (`paths` empty: all). Network: progress and cancel.
#[tauri::command]
pub async fn submodule_update(
    repo: String,
    paths: Vec<String>,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let git = git()?;
    let _guard = state.write_lock(&repo).await;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    Ok(git
        .submodule_update(Path::new(&repo), &paths, op.context(&mut report))
        .await?)
}

#[tauri::command]
pub async fn has_commit_graph(repo: String) -> Result<bool, IpcError> {
    Ok(git()?.has_commit_graph(Path::new(&repo)).await?)
}

/// Writes a commit-graph (only when the user asked: it adds a file to the repository's
/// `.git` folder).
#[tauri::command]
pub async fn write_commit_graph(repo: String, state: State<'_, AppState>) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.write_commit_graph(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn get_status(repo: String) -> Result<WorkingStatus, IpcError> {
    Ok(git()?.status(Path::new(&repo)).await?)
}

/// Messages on the history channel.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum HistoryEvent {
    Rows(HistoryBatch),
    Done { total: u32 },
}

/// Streams history over `on_event`. Starting a new stream for the same repository stops
/// the previous one.
#[tauri::command]
pub async fn stream_history(
    repo: String,
    options: LogOptions,
    head: Option<String>,
    on_event: Channel<HistoryEvent>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let generation = {
        let mut generations = lock(&state.history_generation);
        let g = generations.entry(repo.clone()).or_default();
        *g += 1;
        *g
    };
    let current = || lock(&state.history_generation).get(&repo) == Some(&generation);
    let total = git()?
        .stream_history(Path::new(&repo), options, head.as_deref(), |batch| {
            current() && on_event.send(HistoryEvent::Rows(batch)).is_ok()
        })
        .await?;
    if current() {
        let _ = on_event.send(HistoryEvent::Done {
            total: total as u32,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn get_commit(repo: String, oid: String) -> Result<CommitDetails, IpcError> {
    Ok(git()?.commit_details(Path::new(&repo), &oid).await?)
}

#[tauri::command]
pub async fn get_diff(repo: String, request: DiffRequest) -> Result<FileDiff, IpcError> {
    Ok(git()?.diff(Path::new(&repo), &request).await?)
}

/// Commit ids matching the search. A path query is resolved against every path the
/// history has had (see tylia-git `paths.rs`): a file name anywhere, a path, a folder or
/// wildcards; a single file follows renames.
#[tauri::command]
pub async fn search_history(
    repo: String,
    options: LogOptions,
    field: SearchField,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, IpcError> {
    let git = git()?;
    if field == SearchField::Path {
        let resolved = state
            .path_indexes
            .with_current(&git, &repo, |index| index.resolve(&query))
            .await?;
        return Ok(git
            .search_paths(Path::new(&repo), &options, &resolved)
            .await?);
    }
    Ok(git
        .search_log(Path::new(&repo), options, field, &query)
        .await?)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PathSuggestions {
    pub items: Vec<PathSuggestion>,
    /// The history is still being indexed: `items` are only current files so far.
    pub indexing: bool,
}

/// Files and folders, from the whole history, whose name or path matches what's typed.
#[tauri::command]
pub async fn path_suggestions(
    repo: String,
    query: String,
    limit: u32,
    state: State<'_, AppState>,
) -> Result<PathSuggestions, IpcError> {
    let git = git()?;
    let tracked = git.tracked_paths(Path::new(&repo)).await?;
    let limit = limit.min(50) as usize;
    let ready = state
        .path_indexes
        .with_ready(&git, &repo, |index| index.suggest(&query, &tracked, limit))
        .await?;
    Ok(match ready {
        Some(items) => PathSuggestions {
            items,
            indexing: false,
        },
        None => PathSuggestions {
            items: PathIndex::from_paths(tracked.iter().map(String::as_str))
                .suggest(&query, &tracked, limit),
            indexing: true,
        },
    })
}

/// Starts emitting `repo-changed` events for `repo` (idempotent).
#[tauri::command]
pub async fn watch_repo(
    repo: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    if lock(&state.watchers).contains_key(&repo) {
        return Ok(());
    }
    let git = git()?;
    let info = git.open_repo(Path::new(&repo)).await?;
    // If listing ignored paths fails, watch everything rather than nothing.
    let ignored = git
        .ignored_paths(Path::new(&repo))
        .await
        .unwrap_or_default();
    let watcher = watcher::watch(app, repo.clone(), PathBuf::from(info.git_dir), ignored)
        .map_err(|e| IpcError::from(std::io::Error::other(e)))?;
    lock(&state.watchers).insert(repo, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_repo(repo: String, state: State<'_, AppState>) {
    lock(&state.watchers).remove(&repo);
}
