//! tylia-git integration tests on temp repositories. One binary with a module per area,
//! so the crate is linked once: `cargo test -p tylia-git --test it <filter>`.

#[path = "../common/mod.rs"]
mod common;

mod archive;
mod branching;
mod conflict;
mod credential;
mod extras;
mod file_view;
mod flow;
mod integrate;
mod lfs;
mod patch;
mod patch_file;
mod paths;
mod rebase;
mod remote;
mod repo;
mod repo_config;
mod runner;
mod undo;
mod worktree;
