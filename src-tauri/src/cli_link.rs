//! "Install the `tylia` command" on macOS: a symbolic link `/usr/local/bin/tylia` to the
//! binary inside Tylia.app, as VS Code does for `code` (docs/ARCHITECTURE.md §5.19). Windows
//! installers and Linux packages put the command on `PATH` themselves.
//!
//! What to do is decided by [`plan`] (pure, tested on every OS); only the linking itself is
//! macOS code. When `/usr/local/bin` isn't writable, macOS asks for an administrator's
//! password through `osascript`, with the binary's path passed as an argument, never quoted
//! into a command.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

pub const LINK: &str = "/usr/local/bin/tylia";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum CliLinkOutcome {
    Installed,
    /// The link already pointed at this copy of Tylia.
    AlreadyInstalled,
    /// The user dismissed the password prompt.
    Cancelled,
}

/// What is at [`LINK`] now.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Existing {
    Nothing,
    Link(PathBuf),
    /// A file or folder that isn't a symbolic link: someone else's, never replaced.
    Other,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Plan {
    Done,
    /// Create the link, or replace one that points elsewhere (an older Tylia.app).
    Link,
    Refuse(String),
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn plan(exe: &Path, existing: &Existing) -> Plan {
    let path = exe.to_string_lossy();
    if path.contains("/AppTranslocation/") {
        return Plan::Refuse(
            "macOS is running Tylia from a temporary copy. Move Tylia to the Applications folder, open it from there, then try again."
                .to_owned(),
        );
    }
    if !path.contains(".app/Contents/MacOS/") {
        return Plan::Refuse(
            "Only Tylia.app can install the tylia command (this copy isn't an app bundle)."
                .to_owned(),
        );
    }
    match existing {
        Existing::Link(target) if target == exe => Plan::Done,
        Existing::Link(_) | Existing::Nothing => Plan::Link,
        Existing::Other => Plan::Refuse(format!(
            "{LINK} already exists and isn't a link to Tylia. Remove or rename it, then try again."
        )),
    }
}

/// `osascript` arguments that create the link as an administrator; `exe` arrives as `argv`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn osascript_args(exe: &Path) -> Vec<OsString> {
    let script = format!(
        "do shell script \"mkdir -p /usr/local/bin && ln -sfn \" & quoted form of (item 1 of argv) & \" {LINK}\" with administrator privileges"
    );
    ["-e", "on run argv", "-e", &script, "-e", "end run"]
        .into_iter()
        .map(OsString::from)
        .chain([exe.as_os_str().to_owned()])
        .collect()
}

#[cfg(target_os = "macos")]
pub fn install() -> Result<CliLinkOutcome, crate::error::IpcError> {
    use crate::error::IpcError;

    let exe = std::env::current_exe()?;
    let link = Path::new(LINK);
    let existing = match std::fs::symlink_metadata(link) {
        Err(_) => Existing::Nothing,
        Ok(meta) if meta.file_type().is_symlink() => {
            Existing::Link(std::fs::read_link(link).unwrap_or_default())
        }
        Ok(_) => Existing::Other,
    };
    match plan(&exe, &existing) {
        Plan::Done => return Ok(CliLinkOutcome::AlreadyInstalled),
        Plan::Refuse(reason) => return Err(IpcError::invalid(reason)),
        Plan::Link => {}
    }
    // Without a password when /usr/local/bin is writable (e.g. Homebrew on Intel owns it).
    if (existing == Existing::Nothing || std::fs::remove_file(link).is_ok())
        && std::os::unix::fs::symlink(&exe, link).is_ok()
    {
        return Ok(CliLinkOutcome::Installed);
    }
    let out = std::process::Command::new("osascript")
        .args(osascript_args(&exe))
        .output()?;
    if out.status.success() {
        Ok(CliLinkOutcome::Installed)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        // "User canceled. (-128)"
        if stderr.contains("-128") {
            Ok(CliLinkOutcome::Cancelled)
        } else {
            Err(IpcError {
                stderr: Some(stderr),
                ..IpcError::invalid(format!("Couldn't create {LINK}."))
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "/Applications/Tylia.app/Contents/MacOS/tylia";

    #[test]
    fn links_when_nothing_or_another_link_is_there() {
        assert_eq!(plan(Path::new(EXE), &Existing::Nothing), Plan::Link);
        let old = Existing::Link("/Users/ada/Apps/Tylia.app/Contents/MacOS/tylia".into());
        assert_eq!(plan(Path::new(EXE), &old), Plan::Link);
        assert_eq!(
            plan(Path::new(EXE), &Existing::Link(EXE.into())),
            Plan::Done
        );
    }

    #[test]
    fn refuses_foreign_files_translocated_copies_and_dev_builds() {
        let refused = |exe: &str, existing: Existing| {
            matches!(plan(Path::new(exe), &existing), Plan::Refuse(_))
        };
        assert!(refused(EXE, Existing::Other));
        assert!(refused(
            "/private/var/folders/x/AppTranslocation/1234/d/Tylia.app/Contents/MacOS/tylia",
            Existing::Nothing
        ));
        assert!(refused(
            "/Users/ada/tylia/target/debug/tylia",
            Existing::Nothing
        ));
    }

    #[test]
    fn the_path_is_an_argument_not_part_of_the_script() {
        let exe = Path::new("/Applications/It's \"Tylia\".app/Contents/MacOS/tylia");
        let args = osascript_args(exe);
        assert_eq!(args.last().map(|a| a.as_os_str()), Some(exe.as_os_str()));
        assert!(
            args[..args.len() - 1]
                .iter()
                .all(|a| !a.to_string_lossy().contains("It's"))
        );
        assert!(
            args[3]
                .to_string_lossy()
                .contains("quoted form of (item 1 of argv)")
        );
    }
}
