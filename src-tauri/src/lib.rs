pub mod askpass;
mod cli_link;
mod commands;
mod custom_action;
mod error;
mod hosting;
pub mod launch;
mod operation;
mod path_index;
mod settings;
mod state;
mod system_theme;
mod terminal;
mod ui_state;
mod watcher;
mod window;

use std::path::PathBuf;

use tauri::Manager;

use crate::settings::SettingsStore;
use crate::state::AppState;
use crate::ui_state::UiStateStore;

/// NVIDIA's driver on Wayland breaks WebKitGTK's GPU buffers with explicit sync: the window
/// dies at start with "Error 71 (Protocol error) dispatching to Wayland display". Falling
/// back to implicit sync keeps rendering on the GPU (unlike `WEBKIT_DISABLE_DMABUF_RENDERER`).
/// Only with the NVIDIA driver loaded, and never over the user's own value. A workaround:
/// remove it once WebKitGTK or the driver fixes this (ROADMAP → "Known issues").
///
/// Setting our own environment is `unsafe` (and forbidden here), so Tylia replaces itself
/// with a copy that has the variable set; that copy skips this, as the variable is there.
/// If the exec fails, Tylia carries on without the workaround.
#[cfg(target_os = "linux")]
pub fn nvidia_wayland_workaround() {
    use std::os::unix::process::CommandExt;

    const VAR: &str = "__NV_DISABLE_EXPLICIT_SYNC";
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty());
    let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
    if !(wayland && nvidia) || std::env::var_os(VAR).is_some() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut args = std::env::args_os();
    let arg0 = args.next().unwrap_or_else(|| exe.clone().into_os_string());
    // `exec` only returns on failure.
    let error = std::process::Command::new(&exe)
        .arg0(arg0)
        .args(args)
        .env(VAR, "1")
        .exec();
    eprintln!("tylia: couldn't restart with {VAR}=1: {error}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Starts the app; `open` are the folders from the command line (see `launch`).
pub fn run(open: Vec<PathBuf>) {
    tauri::Builder::default()
        // First: a second launch hands its arguments to this process and exits before any
        // other plugin or the setup runs.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            launch::on_second_instance(app, args, cwd);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::PendingUpdate::default())
        .manage(launch::OpenRequests::new(open))
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let store = SettingsStore::new(&config_dir);
            let settings = store.load();
            state::set_git(&settings);
            window::create_main(app.handle(), &settings)?;
            system_theme::watch(app.handle().clone());
            app.manage(AppState::new(
                store,
                UiStateStore::new(&config_dir),
                askpass::Askpass::start(askpass::EventSink(app.handle().clone()))
                    .unwrap_or_default(),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::git_version,
            commands::check_update,
            commands::install_update,
            commands::set_settings,
            commands::load_ui_state,
            commands::save_ui_state,
            commands::write_perf_report,
            commands::undo_state,
            commands::undo,
            commands::redo,
            commands::lost_commits,
            commands::dangling_commits,
            commands::open_repo,
            launch::take_open_requests,
            commands::init_repo,
            commands::repo_branch,
            commands::get_refs,
            commands::get_status,
            commands::get_submodules,
            commands::has_commit_graph,
            commands::get_worktrees,
            commands::lfs_status,
            commands::submodule_update,
            commands::write_commit_graph,
            commands::stream_history,
            commands::get_commit,
            commands::get_diff,
            commands::search_history,
            commands::path_suggestions,
            commands::get_blame,
            commands::get_file_history,
            commands::watch_repo,
            commands::unwatch_repo,
            commands::clone_repo,
            commands::cancel_operation,
            commands::fetch,
            commands::pull,
            commands::push,
            commands::add_remote,
            commands::set_remote_url,
            commands::rename_remote,
            commands::remove_remote,
            commands::repo_config,
            commands::set_identity,
            commands::set_ssh_key,
            commands::forget_credentials,
            commands::askpass_respond,
            commands::stage_files,
            commands::unstage_files,
            commands::stage_all,
            commands::unstage_all,
            commands::discard_files,
            commands::apply_lines,
            commands::commit,
            commands::head_message,
            commands::ignore_pattern,
            commands::open_file,
            commands::open_terminal,
            commands::install_cli,
            commands::create_branch,
            commands::checkout,
            commands::rename_branch,
            commands::delete_branch,
            commands::delete_remote_branch,
            commands::set_upstream,
            commands::create_tag,
            commands::delete_tag,
            commands::push_tag,
            commands::stash_save,
            commands::stash_apply,
            commands::stash_drop,
            commands::merge,
            commands::rebase,
            commands::rebase_todo,
            commands::is_rebase_base,
            commands::rebase_interactive,
            commands::cherry_pick,
            commands::save_commit_patch,
            commands::save_commit_patches,
            commands::cherry_pick_many,
            commands::revert_many,
            commands::save_changes_patch,
            commands::preview_patch,
            commands::apply_patch_file,
            commands::export_archive,
            commands::custom_action_command,
            commands::run_custom_action,
            commands::add_hosting_account,
            commands::remove_hosting_account,
            commands::list_hosted_repos,
            commands::lfs_files,
            commands::lfs_track,
            commands::lfs_pull,
            commands::lfs_locks,
            commands::lfs_set_lock,
            commands::revert,
            commands::reset,
            commands::continue_operation,
            commands::skip_operation,
            commands::abort_operation,
            commands::resolve_with,
            commands::mark_resolved,
            commands::merge_tool,
            commands::diff_tool,
            commands::conflict_file,
            commands::resolve_block,
            commands::flow_state,
            commands::flow_init,
            commands::flow_start,
            commands::flow_finish,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tylia")
        .run(|_app, _event| {
            // Folders dropped on the Dock icon or opened with "Open With" in Finder.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                launch::open(_app, paths);
            }
        });
}
