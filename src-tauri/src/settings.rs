//! User settings, persisted as JSON in the OS config directory.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use tylia_git::PullMode;

use crate::custom_action::CustomAction;
use crate::hosting::HostingAccount;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DateFormat {
    /// "2 hours ago" (the exact time in a tooltip).
    #[default]
    Relative,
    /// "Oct 20, 2026, 14:05".
    Absolute,
}

/// Unknown or missing fields fall back to defaults, so older and newer settings files load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub theme: ThemePreference,
    /// Use the OS title bar instead of Tylia's own. Applied on the next start.
    pub native_title_bar: bool,
    /// What the Pull button does: the mode last chosen from its menu.
    pub pull_mode: PullMode,
    /// Fetch with `--prune` (drop remote branches deleted on the remote).
    pub fetch_prune: bool,
    /// Minutes between background fetches of open repositories; 0 is off.
    pub auto_fetch_minutes: u32,
    /// Push the branch after each commit.
    pub push_after_commit: bool,
    /// Row height of lists and the history.
    pub density: Density,
    /// Base UI font size in px (12–15); everything else scales with it.
    pub ui_font_size: u32,
    /// Shortcut rebindings by action id; an empty string unbinds. Actions without an entry
    /// use their default shortcut.
    pub shortcuts: BTreeMap<String, String>,
    pub date_format: DateFormat,
    /// Columns per tab in diffs and file views.
    pub tab_width: u32,
    /// Git executable to use instead of the one found on PATH; `None` = find it.
    pub git_path: Option<String>,
    /// In the Flatpak: run the host system's Git (through `flatpak-spawn --host`) instead of
    /// the bundled one. Ignored elsewhere.
    pub host_git: bool,
    /// Ask GitHub for a newer release once at start. Off by default: no network request
    /// unless the user turns this on or presses "Check now".
    pub check_for_updates: bool,
    /// Terminal for "Open in terminal": a program (or, on macOS, an app name); `None` = the
    /// platform's usual terminal (see `terminal.rs`).
    pub terminal: Option<String>,
    /// Settings → Actions, in the order shown.
    pub custom_actions: Vec<CustomAction>,
    /// Settings → Accounts (their tokens are with Git's credential helpers, not here).
    pub hosting_accounts: Vec<HostingAccount>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::default(),
            native_title_bar: false,
            pull_mode: PullMode::default(),
            fetch_prune: false,
            auto_fetch_minutes: 0,
            push_after_commit: false,
            density: Density::default(),
            ui_font_size: 13,
            shortcuts: BTreeMap::new(),
            date_format: DateFormat::default(),
            tab_width: 4,
            git_path: None,
            host_git: false,
            check_for_updates: false,
            terminal: None,
            custom_actions: Vec::new(),
            hosting_accounts: Vec::new(),
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("settings.json"),
        }
    }

    /// Loads settings. A file that cannot be parsed is kept as `settings.invalid.json`
    /// (never deleted) and defaults are used.
    pub fn load(&self) -> Settings {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(_) => return Settings::default(),
        };
        serde_json::from_str(&text).unwrap_or_else(|err| {
            eprintln!("tylia: ignoring invalid {}: {err}", self.path.display());
            let _ = fs::rename(
                &self.path,
                self.path.with_file_name("settings.invalid.json"),
            );
            Settings::default()
        })
    }

    /// Writes atomically: to a temporary file, then renamed over the old one.
    pub fn save(&self, settings: &Settings) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(settings).map_err(io::Error::other)?;
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::custom_action::ActionScope;

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(SettingsStore::new(dir.path()).load(), Settings::default());
    }

    #[test]
    fn round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(&dir.path().join("nested"));
        let settings = Settings {
            theme: ThemePreference::Dark,
            native_title_bar: true,
            pull_mode: PullMode::Rebase,
            fetch_prune: true,
            auto_fetch_minutes: 10,
            push_after_commit: true,
            density: Density::Compact,
            ui_font_size: 15,
            shortcuts: BTreeMap::from([("remote.fetch".to_owned(), "Mod+Shift+F".to_owned())]),
            date_format: DateFormat::Absolute,
            tab_width: 8,
            git_path: Some("/usr/local/bin/git".to_owned()),
            host_git: true,
            check_for_updates: true,
            terminal: Some("wezterm".to_owned()),
            custom_actions: vec![CustomAction {
                id: "a1".to_owned(),
                name: "Lint".to_owned(),
                program: "cargo".to_owned(),
                arguments: "clippy -- {file}".to_owned(),
                scope: ActionScope::File,
                confirm: true,
                show_output: true,
            }],
            hosting_accounts: vec![crate::hosting::HostingAccount {
                provider: crate::hosting::HostingProvider::Gitlab,
                host: "gitlab.example.com".to_owned(),
                login: "ada".to_owned(),
                name: "Ada".to_owned(),
            }],
        };
        store.save(&settings).unwrap();
        assert_eq!(store.load(), settings);
    }

    #[test]
    fn unknown_and_missing_fields_use_defaults() {
        let parsed: Settings = serde_json::from_str(r#"{"theme":"light","future":1}"#).unwrap();
        assert_eq!(parsed.theme, ThemePreference::Light);
        assert!(!parsed.native_title_bar);
        assert!(!parsed.check_for_updates);
    }

    #[test]
    fn invalid_file_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{not json").unwrap();
        assert_eq!(SettingsStore::new(dir.path()).load(), Settings::default());
        let kept = fs::read_to_string(dir.path().join("settings.invalid.json")).unwrap();
        assert_eq!(kept, "{not json");
    }
}
