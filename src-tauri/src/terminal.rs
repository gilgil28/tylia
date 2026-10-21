//! Opens the user's terminal in a repository folder ("Open in terminal").
//!
//! The terminal program is started directly (never through a shell) with the folder as its
//! working directory, plus the folder flag of terminals that ignore the working directory.
//! The choice: the program set in Settings, else the platform's usual terminals in order.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// One way to start a terminal: a program (name looked up on PATH, or a path) and its
/// arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    /// Windows: give it its own console window (shells), rather than none (Windows
    /// Terminal opens its own window).
    pub new_console: bool,
}

impl Launch {
    fn new(program: &str, args: &[&str]) -> Self {
        Self {
            program: program.to_owned(),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            new_console: false,
        }
    }

    fn console(program: &str) -> Self {
        Self {
            new_console: true,
            ..Self::new(program, &[])
        }
    }
}

/// What the choice depends on, so it can be tested without the real environment.
pub struct Env<'a> {
    pub os: &'a str,
    /// The terminal chosen in Settings.
    pub custom: Option<&'a str>,
    /// `$TERMINAL` (Linux convention).
    pub terminal_var: Option<&'a str>,
    /// `$XDG_CURRENT_DESKTOP`, e.g. `KDE`, `GNOME`, `XFCE`.
    pub desktop: Option<&'a str>,
}

/// Terminals to try, best first.
pub fn candidates(env: &Env, dir: &Path) -> Vec<Launch> {
    let dir = dir.display().to_string();
    let mut list = Vec::new();
    if let Some(custom) = env.custom.map(str::trim).filter(|c| !c.is_empty()) {
        list.push(
            if env.os == "macos" && !custom.contains('/') || custom.ends_with(".app") {
                // An application name or bundle: `open -a "iTerm" <dir>`.
                Launch::new("open", &["-a", custom, &dir])
            } else {
                Launch {
                    new_console: true,
                    ..Launch::new(custom, &[])
                }
            },
        );
    }
    match env.os {
        "windows" => {
            list.push(Launch::new("wt.exe", &["-d", &dir]));
            list.push(Launch::console("pwsh.exe"));
            list.push(Launch::console("powershell.exe"));
            list.push(Launch::console("cmd.exe"));
        }
        "macos" => list.push(Launch::new("open", &["-a", "Terminal", &dir])),
        _ => {
            if let Some(var) = env.terminal_var.map(str::trim).filter(|t| !t.is_empty()) {
                list.push(Launch::new(var, &[]));
            }
            let desktop = env.desktop.unwrap_or_default().to_ascii_uppercase();
            let kde = Launch::new("konsole", &["--workdir", &dir]);
            let gnome = [
                Launch::new("ptyxis", &["--new-window", "--working-directory", &dir]),
                Launch::new("kgx", &["--working-directory", &dir]),
                Launch::new("gnome-terminal", &["--working-directory", &dir]),
            ];
            let xfce = Launch::new("xfce4-terminal", &["--working-directory", &dir]);
            if desktop.contains("KDE") {
                list.push(kde.clone());
            } else if desktop.contains("GNOME") {
                list.extend(gnome.iter().cloned());
            } else if desktop.contains("XFCE") {
                list.push(xfce.clone());
            }
            // Debian / Ubuntu's configured default.
            list.push(Launch::new("x-terminal-emulator", &[]));
            list.extend(gnome);
            list.push(kde);
            list.push(xfce);
            list.extend([
                Launch::new("mate-terminal", &["--working-directory", &dir]),
                Launch::new("tilix", &["--working-directory", &dir]),
                Launch::new("wezterm", &["start", "--cwd", &dir]),
                Launch::new("kitty", &["--directory", &dir]),
                Launch::new("alacritty", &["--working-directory", &dir]),
                Launch::new("ghostty", &[&format!("--working-directory={dir}")]),
                Launch::new("foot", &[&format!("--working-directory={dir}")]),
                Launch::new("xterm", &[]),
            ]);
        }
    }
    let mut seen = Vec::new();
    list.retain(|l| {
        let new = !seen.contains(l);
        seen.push(l.clone());
        new
    });
    list
}

/// The program's full path: as given if it is a path, else the first match on `path_var`
/// (with `.exe` added on Windows). `symlink_metadata`, because Windows Terminal's `wt.exe`
/// is an app execution alias that ordinary metadata can't read.
pub fn resolve(program: &str, path_var: Option<&OsString>, windows: bool) -> Option<PathBuf> {
    let exists = |p: &Path| p.symlink_metadata().is_ok();
    let as_path = Path::new(program);
    if as_path.components().count() > 1 || as_path.is_absolute() {
        return exists(as_path).then(|| as_path.to_owned());
    }
    let names: Vec<String> = if windows && !program.to_ascii_lowercase().ends_with(".exe") {
        vec![format!("{program}.exe"), program.to_owned()]
    } else {
        vec![program.to_owned()]
    };
    std::env::split_paths(path_var?).find_map(|dir| {
        names
            .iter()
            .map(|n| dir.join(n))
            .find(|candidate| exists(candidate))
    })
}

/// Starts the first terminal that exists. `Ok(None)`: none was found. A terminal chosen in
/// Settings that doesn't exist is an error (`NotFound`), not a silent fallback.
pub fn open(env: &Env, dir: &Path) -> io::Result<Option<String>> {
    let path_var = std::env::var_os("PATH");
    let custom = env.custom.map(str::trim).filter(|c| !c.is_empty());
    for (i, launch) in candidates(env, dir).into_iter().enumerate() {
        let Some(program) = resolve(&launch.program, path_var.as_ref(), env.os == "windows") else {
            if i == 0 && custom == Some(launch.program.as_str()) {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("{} wasn't found", launch.program),
                ));
            }
            continue;
        };
        let mut cmd = Command::new(&program);
        cmd.args(&launch.args)
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            const DETACHED_PROCESS: u32 = 0x0000_0008;
            cmd.creation_flags(if launch.new_console {
                CREATE_NEW_CONSOLE
            } else {
                DETACHED_PROCESS
            });
        }
        let mut child = cmd.spawn()?;
        // Reap it when it exits (no zombie on Unix); the terminal outlives nothing else.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        return Ok(Some(launch.program));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(os: &'a str) -> Env<'a> {
        Env {
            os,
            custom: None,
            terminal_var: None,
            desktop: None,
        }
    }

    fn programs(list: &[Launch]) -> Vec<&str> {
        list.iter().map(|l| l.program.as_str()).collect()
    }

    #[test]
    fn windows_prefers_windows_terminal_in_the_folder() {
        let list = candidates(&env("windows"), Path::new(r"C:\repo"));
        assert_eq!(
            programs(&list),
            ["wt.exe", "pwsh.exe", "powershell.exe", "cmd.exe"]
        );
        assert_eq!(list[0].args, ["-d", r"C:\repo"]);
        assert!(!list[0].new_console && list[1].new_console);
    }

    #[test]
    fn macos_opens_terminal_app_or_the_chosen_one() {
        let list = candidates(&env("macos"), Path::new("/r"));
        assert_eq!(list, [Launch::new("open", &["-a", "Terminal", "/r"])]);
        let iterm = Env {
            custom: Some("iTerm"),
            ..env("macos")
        };
        assert_eq!(
            candidates(&iterm, Path::new("/r"))[0],
            Launch::new("open", &["-a", "iTerm", "/r"])
        );
    }

    #[test]
    fn custom_program_comes_first() {
        let e = Env {
            custom: Some("  C:/tools/cmder.exe "),
            ..env("windows")
        };
        let list = candidates(&e, Path::new("C:/r"));
        assert_eq!(list[0].program, "C:/tools/cmder.exe");
        assert!(list[0].args.is_empty() && list[0].new_console);
        assert_eq!(list[1].program, "wt.exe");
    }

    #[test]
    fn linux_follows_terminal_var_then_desktop() {
        let kde = Env {
            terminal_var: Some("foot"),
            desktop: Some("KDE"),
            ..env("linux")
        };
        let list = candidates(&kde, Path::new("/r"));
        assert_eq!(
            &programs(&list)[..3],
            ["foot", "konsole", "x-terminal-emulator"]
        );
        assert_eq!(list[1].args, ["--workdir", "/r"]);
        // Each terminal once, even when the desktop moved it up.
        assert_eq!(
            programs(&list).iter().filter(|p| **p == "konsole").count(),
            1
        );

        let gnome = Env {
            desktop: Some("ubuntu:GNOME"),
            ..env("linux")
        };
        assert_eq!(programs(&candidates(&gnome, Path::new("/r")))[0], "ptyxis");
        assert_eq!(
            programs(&candidates(&env("linux"), Path::new("/r")))[0],
            "x-terminal-emulator"
        );
    }

    #[test]
    fn a_missing_chosen_terminal_is_an_error_not_a_fallback() {
        let e = Env {
            custom: Some("/no/such/dir/terminal-that-does-not-exist"),
            ..env("linux")
        };
        let err = open(&e, Path::new(".")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn resolves_on_path() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("myterm.exe"), "").unwrap();
        let path = std::env::join_paths([dir.path()]).unwrap();
        assert_eq!(
            resolve("myterm", Some(&path), true),
            Some(dir.path().join("myterm.exe"))
        );
        assert_eq!(resolve("myterm", Some(&path), false), None);
        assert_eq!(resolve("missing", Some(&path), true), None);
        let full = dir.path().join("myterm.exe").display().to_string();
        assert_eq!(resolve(&full, None, true), Some(PathBuf::from(&full)));
    }
}
