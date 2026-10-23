//! Tauri commands: the whole backend API the frontend can call.

mod app;
mod archive;
mod askpass;
mod branch;
mod clone;
mod custom;
mod file_view;
mod flow;
mod hosting;
mod lfs;
mod patch;
mod rebase;
mod remote;
mod repo;
mod repo_settings;
mod undo;
mod update;
mod worktree;

pub use app::*;
pub use archive::*;
pub use askpass::*;
pub use branch::*;
pub use clone::*;
pub use custom::*;
pub use file_view::*;
pub use flow::*;
pub use hosting::*;
pub use lfs::*;
pub use patch::*;
pub use rebase::*;
pub use remote::*;
pub use repo::*;
pub use repo_settings::*;
pub use undo::*;
pub use update::*;
pub use worktree::*;
