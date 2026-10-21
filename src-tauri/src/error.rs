use serde::Serialize;
use ts_rs::TS;
use tylia_git::{AccessFailure, GitError, PushRejection};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum IpcErrorKind {
    GitNotFound,
    GitFailed,
    NotARepository,
    BareRepository,
    InvalidInput,
    Cancelled,
    Io,
    /// The remote has commits the branch doesn't: pull first (or force push).
    PushBehind,
    /// Force-with-lease refused: the remote branch moved since the last fetch.
    PushStale,
    /// The server refused the push (hook, protected branch, permissions).
    PushRejected,
    /// Wrong or missing credentials, or no access to the repository.
    AuthFailed,
    /// ssh couldn't verify the server's host key (not trusted, or changed).
    HostKeyFailed,
    /// Checkout refused: local changes to these files would be overwritten (`files`).
    LocalChanges,
    /// Branch delete refused: it has commits not merged anywhere (force to delete).
    NotFullyMerged,
    /// The update check or install failed (network, manifest or signature).
    UpdateFailed,
}

/// Error returned by every command. The frontend picks its message from `kind` and shows
/// `message`, `command` and `stderr` under "Details".
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IpcError {
    pub kind: IpcErrorKind,
    pub message: String,
    pub command: Option<String>,
    pub stderr: Option<String>,
    /// Files the error is about (`localChanges`: the ones a checkout would overwrite).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub files: Option<Vec<String>>,
}

impl From<GitError> for IpcError {
    fn from(err: GitError) -> Self {
        let kind = match err {
            GitError::NotFound => IpcErrorKind::GitNotFound,
            GitError::NotARepository { .. } => IpcErrorKind::NotARepository,
            GitError::BareRepository { .. } => IpcErrorKind::BareRepository,
            GitError::InvalidInput(_) => IpcErrorKind::InvalidInput,
            GitError::Cancelled { .. } => IpcErrorKind::Cancelled,
            GitError::Io(_) => IpcErrorKind::Io,
            GitError::LocalChanges { .. } => IpcErrorKind::LocalChanges,
            GitError::NotFullyMerged { .. } => IpcErrorKind::NotFullyMerged,
            GitError::AccessDenied { reason, .. } => match reason {
                AccessFailure::Auth => IpcErrorKind::AuthFailed,
                AccessFailure::HostKey => IpcErrorKind::HostKeyFailed,
            },
            GitError::PushRejected { reason, .. } => match reason {
                PushRejection::Behind => IpcErrorKind::PushBehind,
                PushRejection::Stale => IpcErrorKind::PushStale,
                PushRejection::Remote | PushRejection::Other => IpcErrorKind::PushRejected,
            },
            GitError::Spawn { .. } | GitError::Failed { .. } | GitError::Parse { .. } => {
                IpcErrorKind::GitFailed
            }
        };
        let files = match &err {
            GitError::LocalChanges { files, .. } => Some(files.clone()),
            _ => None,
        };
        Self {
            kind,
            message: err.to_string(),
            command: err.command().map(str::to_owned),
            stderr: err.stderr().map(str::to_owned),
            files,
        }
    }
}

impl From<std::io::Error> for IpcError {
    fn from(err: std::io::Error) -> Self {
        Self {
            kind: IpcErrorKind::Io,
            message: err.to_string(),
            command: None,
            stderr: None,
            files: None,
        }
    }
}
