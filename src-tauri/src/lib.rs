pub mod askpass;
mod cli_link;
mod commands;
mod error;
pub mod launch;
mod operation;
mod path_index;
mod settings;
mod state;
mod terminal;
mod ui_state;
mod watcher;
mod window;

use std::path::PathBuf;

use tauri::Manager;

use crate::settings::SettingsStore;
use crate::state::AppState;
use crate::ui_state::UiStateStore;

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
