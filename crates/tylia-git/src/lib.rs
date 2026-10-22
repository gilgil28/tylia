//! Tylia's Git layer.
//!
//! Every Git invocation goes through [`Git`]: the system `git` binary is spawned with an
//! argument vector (never a shell), with a fixed set of base options and environment so the
//! output is stable and machine-readable. This crate has no Tauri dependency.

mod archive;
mod blame;
mod branch;
mod clone;
mod commit;
mod conflict;
mod diff;
mod error;
mod extras;
mod file_history;
mod flow;
mod graph;
mod history;
mod integrate;
mod log;
mod ops;
mod patch;
mod patch_file;
mod paths;
mod rebase;
mod refs;
mod remote;
mod repo;
mod repo_config;
mod runner;
mod stash;
mod status;
mod tag;
mod version;
mod worktree;

pub use archive::ArchiveFormat;
pub use blame::{Blame, BlameCommit, BlameContent, BlameLine, BlamePrevious};
pub use branch::{CheckoutOutcome, CheckoutRequest, CheckoutTarget};
pub use clone::{CloneRequest, Progress};
pub use commit::{ChangedFile, CommitDetails, Signature};
pub use conflict::{BlockOutcome, BlockResolution, ConflictFile, ConflictSegment};
pub use diff::{
    DiffContent, DiffLine, DiffRequest, DiffTarget, FULL_CONTEXT, FileDiff, Hunk, ImagePair,
    LineKind,
};
pub use error::GitError;
pub use extras::{LfsStatus, Worktree};
pub use file_history::{FileHistoryEntry, FileHistoryPage};
pub use flow::{FlowConfig, FlowFinishRequest, FlowFinished, FlowKind, FlowState};
pub use graph::{Edge, EdgeKind, GraphBuilder, GraphRow};
pub use history::{GraphCell, HistoryBatch, HistoryRow, Segment, SegmentTracker};
pub use integrate::{ConflictSide, FastForward, IntegrateOutcome, ResetMode};
pub use log::{LogCommit, LogOptions, LogOrder, LogScope, SearchField};
pub use patch::{LineAction, LinesRequest};
pub use patch_file::{PatchApplyMode, PatchCheck, PatchFileChange, PatchFormat, PatchPreview};
pub use paths::{PathIndex, PathKind, PathQuery, PathSuggestion};
pub use rebase::{RebaseTodo, TodoAction, TodoCommit, TodoItem};
pub use refs::{
    Branch, Head, RefsSnapshot, Remote, RemoteBranch, Stash, Submodule, SubmoduleState, Tag,
};
pub use remote::{FetchRequest, PullMode, PullOutcome, PushOutcome, PushRejection, PushRequest};
pub use repo::RepoInfo;
pub use repo_config::{ConfigScope, ConfigValue, RemoteSettings, RepoConfig, UrlProtocol};
pub use runner::{AccessFailure, Git, GitOutput, OpContext, RunOptions};
pub use stash::{StashOutcome, StashRequest};
pub use status::{FileStatus, OperationKind, RepoOperation, StatusEntry, WorkingStatus};
pub use version::{GitInfo, GitVersion, MIN_GIT_VERSION};
pub use worktree::{add_to_gitignore, repo_path};
