use std::path::PathBuf;

/// Errors from running Git. Each variant keeps the user-visible command line so the UI can
/// show what was run (see "Honest about Git" in the roadmap).
#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git executable not found")]
    NotFound,

    #[error("failed to start `{command}`: {source}")]
    Spawn {
        command: String,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("`{command}` exited with {}", code.map_or_else(|| "a signal".to_owned(), |c| format!("code {c}")))]
    Failed {
        command: String,
        code: Option<i32>,
        stderr: String,
    },

    #[error("could not parse output of `{command}`: {detail}")]
    Parse { command: String, detail: String },

    #[error("{} is not a Git repository", path.display())]
    NotARepository { path: PathBuf },

    #[error("{} is a bare repository", path.display())]
    BareRepository { path: PathBuf },

    #[error("{0}")]
    InvalidInput(String),

    #[error("local changes would be overwritten")]
    LocalChanges {
        command: String,
        /// The files Git named.
        files: Vec<String>,
        stderr: String,
    },

    #[error("the branch has commits that aren't merged")]
    NotFullyMerged { command: String, stderr: String },

    #[error("the remote refused access")]
    AccessDenied {
        command: String,
        reason: crate::runner::AccessFailure,
        stderr: String,
    },

    #[error("the remote refused the push")]
    PushRejected {
        command: String,
        reason: crate::remote::PushRejection,
        stderr: String,
    },

    #[error("`{command}` was cancelled")]
    Cancelled { command: String },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

impl GitError {
    /// The command line shown to the user, if the error came from a specific invocation.
    pub fn command(&self) -> Option<&str> {
        match self {
            Self::Spawn { command, .. }
            | Self::Failed { command, .. }
            | Self::PushRejected { command, .. }
            | Self::AccessDenied { command, .. }
            | Self::LocalChanges { command, .. }
            | Self::NotFullyMerged { command, .. }
            | Self::Parse { command, .. }
            | Self::Cancelled { command } => Some(command),
            _ => None,
        }
    }

    /// Git's stderr, when the process ran and failed.
    pub fn stderr(&self) -> Option<&str> {
        match self {
            Self::Failed { stderr, .. }
            | Self::PushRejected { stderr, .. }
            | Self::AccessDenied { stderr, .. }
            | Self::LocalChanges { stderr, .. }
            | Self::NotFullyMerged { stderr, .. } => Some(stderr),
            _ => None,
        }
    }

    pub(crate) fn parse(command: &str, detail: impl Into<String>) -> Self {
        Self::Parse {
            command: command.to_owned(),
            detail: detail.into(),
        }
    }
}
