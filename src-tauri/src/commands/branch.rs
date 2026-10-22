//! Branches, tags, stashes and history-rewriting operations (Phase 4). Local writes hold the
//! repository's write lock; the network ones (deleting a remote branch, pushing a tag) are
//! operations with progress and cancel.

use std::path::Path;

use tauri::State;
use tauri::ipc::Channel;
use tylia_git::{
    BlockOutcome, BlockResolution, CheckoutOutcome, CheckoutRequest, ConflictFile, ConflictSide,
    FastForward, IntegrateOutcome, Progress, ResetMode, StashOutcome, StashRequest,
};

use crate::error::IpcError;
use crate::operation::Operation;
use crate::state::{AppState, git};

#[tauri::command]
pub async fn create_branch(
    repo: String,
    name: String,
    start: String,
    checkout: bool,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .create_branch(Path::new(&repo), &name, &start, checkout)
        .await?)
}

#[tauri::command]
pub async fn checkout(
    repo: String,
    request: CheckoutRequest,
    state: State<'_, AppState>,
) -> Result<CheckoutOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.checkout(Path::new(&repo), &request).await?)
}

#[tauri::command]
pub async fn rename_branch(
    repo: String,
    name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .rename_branch(Path::new(&repo), &name, &new_name)
        .await?)
}

#[tauri::command]
pub async fn delete_branch(
    repo: String,
    name: String,
    force: bool,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.delete_branch(Path::new(&repo), &name, force).await?)
}

#[tauri::command]
pub async fn delete_remote_branch(
    repo: String,
    remote: String,
    branch: String,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let git = git()?;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    Ok(git
        .delete_remote_branch(Path::new(&repo), &remote, &branch, op.context(&mut report))
        .await?)
}

/// `upstream: None` removes it.
#[tauri::command]
pub async fn set_upstream(
    repo: String,
    branch: String,
    upstream: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .set_upstream(Path::new(&repo), &branch, upstream.as_deref())
        .await?)
}

/// Annotated with `message`, lightweight without.
#[tauri::command]
pub async fn create_tag(
    repo: String,
    name: String,
    target: String,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .create_tag(Path::new(&repo), &name, &target, message.as_deref())
        .await?)
}

#[tauri::command]
pub async fn delete_tag(
    repo: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.delete_tag(Path::new(&repo), &name).await?)
}

#[tauri::command]
pub async fn push_tag(
    repo: String,
    remote: String,
    name: String,
    operation_id: u32,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let git = git()?;
    let mut op = Operation::start(&state, operation_id, Some(&repo), false, on_progress);
    let mut report = op.reporter();
    Ok(git
        .push_tag(Path::new(&repo), &remote, &name, op.context(&mut report))
        .await?)
}

/// Returns false when there was nothing to stash.
#[tauri::command]
pub async fn stash_save(
    repo: String,
    request: StashRequest,
    state: State<'_, AppState>,
) -> Result<bool, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.stash_save(Path::new(&repo), &request).await?)
}

#[tauri::command]
pub async fn stash_apply(
    repo: String,
    index: u32,
    pop: bool,
    state: State<'_, AppState>,
) -> Result<StashOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.stash_apply(Path::new(&repo), index, pop).await?)
}

#[tauri::command]
pub async fn stash_drop(
    repo: String,
    index: u32,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.stash_drop(Path::new(&repo), index).await?)
}

#[tauri::command]
pub async fn merge(
    repo: String,
    rev: String,
    ff: FastForward,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.merge(Path::new(&repo), &rev, ff).await?)
}

#[tauri::command]
pub async fn rebase(
    repo: String,
    onto: String,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.rebase(Path::new(&repo), &onto).await?)
}

#[tauri::command]
pub async fn cherry_pick(
    repo: String,
    oid: String,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.cherry_pick(Path::new(&repo), &oid).await?)
}

#[tauri::command]
pub async fn revert(
    repo: String,
    oid: String,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.revert(Path::new(&repo), &oid).await?)
}

/// Cherry-picks `oids` (oldest first) as one operation.
#[tauri::command]
pub async fn cherry_pick_many(
    repo: String,
    oids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.cherry_pick_many(Path::new(&repo), &oids).await?)
}

/// Reverts `oids` (newest first) as one operation.
#[tauri::command]
pub async fn revert_many(
    repo: String,
    oids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.revert_many(Path::new(&repo), &oids).await?)
}

#[tauri::command]
pub async fn reset(
    repo: String,
    oid: String,
    mode: ResetMode,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.reset(Path::new(&repo), &oid, mode).await?)
}

#[tauri::command]
pub async fn continue_operation(
    repo: String,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.continue_operation(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn skip_operation(
    repo: String,
    state: State<'_, AppState>,
) -> Result<IntegrateOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.skip_operation(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn abort_operation(repo: String, state: State<'_, AppState>) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.abort_operation(Path::new(&repo)).await?)
}

#[tauri::command]
pub async fn resolve_with(
    repo: String,
    paths: Vec<String>,
    side: ConflictSide,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.resolve_with(Path::new(&repo), &paths, side).await?)
}

#[tauri::command]
pub async fn mark_resolved(
    repo: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?.mark_resolved(Path::new(&repo), &paths).await?)
}

/// Waits until the merge tool closes. No write lock: the user may take minutes, and the
/// tool only writes that one file.
#[tauri::command]
pub async fn merge_tool(repo: String, path: String) -> Result<(), IpcError> {
    Ok(git()?.merge_tool(Path::new(&repo), &path).await?)
}

/// A conflicted file's conflict blocks, read from the working tree.
#[tauri::command]
pub async fn conflict_file(repo: String, path: String) -> Result<ConflictFile, IpcError> {
    Ok(git()?.conflict_file(Path::new(&repo), &path).await?)
}

/// Resolves one conflict block; `fingerprint` is from the `ConflictFile` it was chosen in.
#[tauri::command]
pub async fn resolve_block(
    repo: String,
    path: String,
    index: u32,
    resolution: BlockResolution,
    fingerprint: String,
    state: State<'_, AppState>,
) -> Result<BlockOutcome, IpcError> {
    let _guard = state.write_lock(&repo).await;
    Ok(git()?
        .resolve_block(Path::new(&repo), &path, index, resolution, &fingerprint)
        .await?)
}

/// Opens the configured external diff tool for one file and waits for it to close.
#[tauri::command]
pub async fn diff_tool(repo: String, request: tylia_git::DiffRequest) -> Result<(), IpcError> {
    Ok(git()?.diff_tool(Path::new(&repo), &request).await?)
}
