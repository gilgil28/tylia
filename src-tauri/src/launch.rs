//! The command line, and folders to open that arrive from outside the window (ARCHITECTURE
//! §5.19): `tylia <path>`, a second launch (the single-instance plugin hands its arguments to
//! this process and exits), or a file manager's "Open in Tylia".
//!
//! Paths are resolved against the caller's working directory here, then queued; the
//! frontend takes the queue when told (`open-requested`) and opens each as a tab.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::error::IpcError;

pub const HELP: &str = "\
Tylia, a calm, fast Git client

Usage: tylia [PATH]...

Opens each PATH (a repository, or any folder or file inside one) as a tab. If Tylia is
already running, its window opens them.

Options:
  -h, --help     Show this help
  -V, --version  Show the version
";

/// What the command line asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    /// Start (or focus) the app and open these folders.
    Open(Vec<PathBuf>),
    Help,
    Version,
    /// An option Tylia doesn't know.
    Unknown(String),
}

/// Parses the arguments after the program name. Relative paths are resolved against `cwd`,
/// and a file stands for the folder it is in.
pub fn parse(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Command {
    let mut paths = Vec::new();
    let mut options_done = false;
    for arg in args {
        if !options_done {
            match arg.to_str() {
                Some("-h" | "--help") => return Command::Help,
                Some("-V" | "--version") => return Command::Version,
                Some("--") => {
                    options_done = true;
                    continue;
                }
                // macOS adds a process serial number when an app is started from Finder.
                Some(s) if s.starts_with("-psn_") => continue,
                Some(s) if s.starts_with('-') && s.len() > 1 => {
                    return Command::Unknown(s.to_owned());
                }
                _ => {}
            }
        }
        paths.push(resolve(Path::new(&arg), cwd));
    }
    Command::Open(paths)
}

fn resolve(path: &Path, cwd: &Path) -> PathBuf {
    let joined = cwd.join(path);
    let absolute = std::path::absolute(&joined).unwrap_or(joined);
    if absolute.is_file() {
        absolute.parent().map(Path::to_path_buf).unwrap_or(absolute)
    } else {
        absolute
    }
}

/// Folders waiting for the frontend to open them.
#[derive(Default)]
pub struct OpenRequests(Mutex<Vec<String>>);

impl OpenRequests {
    pub fn new(paths: Vec<PathBuf>) -> Self {
        let requests = Self::default();
        requests.push(paths);
        requests
    }

    fn push(&self, paths: Vec<PathBuf>) {
        let mut queue = self.0.lock().unwrap_or_else(|e| e.into_inner());
        queue.extend(paths.iter().map(|p| p.to_string_lossy().into_owned()));
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

/// Another launch of Tylia (from the command line, a shortcut or a file manager): bring the
/// window forward and open what it asked for.
pub fn on_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    // The second process already handled --help / --version / errors itself, so only paths
    // arrive here.
    if let Command::Open(paths) = parse(
        args.into_iter().skip(1).map(OsString::from),
        Path::new(&cwd),
    ) {
        open(app, paths);
    }
}

/// Queues folders for the frontend and tells it.
pub fn open(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    app.state::<OpenRequests>().push(paths);
    let _ = app.emit("open-requested", ());
}

/// Returns and clears the folders waiting to be opened.
#[tauri::command]
pub fn take_open_requests(
    requests: tauri::State<'_, OpenRequests>,
) -> Result<Vec<String>, IpcError> {
    Ok(requests.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn options() {
        let cwd = std::env::temp_dir();
        assert_eq!(parse(args(&["--help"]), &cwd), Command::Help);
        assert_eq!(parse(args(&["repo", "-h"]), &cwd), Command::Help);
        assert_eq!(parse(args(&["-V"]), &cwd), Command::Version);
        assert_eq!(parse(args(&["--version"]), &cwd), Command::Version);
        assert_eq!(
            parse(args(&["--frobnicate"]), &cwd),
            Command::Unknown("--frobnicate".into())
        );
        assert_eq!(parse(args(&[]), &cwd), Command::Open(vec![]));
    }

    #[test]
    fn paths_resolve_against_the_callers_folder() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().join("work");
        std::fs::create_dir_all(cwd.join("repo/src")).unwrap();
        std::fs::write(cwd.join("repo/src/main.rs"), "").unwrap();
        let Command::Open(paths) = parse(args(&["repo", "repo/src/main.rs", "-psn_0_1"]), &cwd)
        else {
            panic!("expected paths");
        };
        assert_eq!(paths, vec![cwd.join("repo"), cwd.join("repo").join("src")]);
    }

    #[test]
    fn absolute_paths_and_dashes_after_double_dash() {
        let dir = tempfile::tempdir().unwrap();
        let other = dir.path().join("elsewhere");
        let cwd = std::env::temp_dir();
        let Command::Open(paths) = parse(
            vec![OsString::from(&other), "--".into(), "-dash".into()],
            &cwd,
        ) else {
            panic!("expected paths");
        };
        assert_eq!(paths, vec![other, cwd.join("-dash")]);
    }

    #[test]
    fn requests_are_taken_once() {
        let requests = OpenRequests::new(vec![PathBuf::from("a")]);
        requests.push(vec![PathBuf::from("b")]);
        assert_eq!(requests.take(), vec!["a".to_owned(), "b".to_owned()]);
        assert!(requests.take().is_empty());
    }
}
