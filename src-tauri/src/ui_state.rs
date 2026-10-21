//! UI state the frontend owns (open tabs, recent repositories, panel sizes, …), stored as an
//! opaque JSON document next to the settings.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;

pub struct UiStateStore {
    path: PathBuf,
}

impl UiStateStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("ui-state.json"),
        }
    }

    /// The stored document, or `null` when there is none. An unreadable file is kept as
    /// `ui-state.invalid.json`, never deleted.
    pub fn load(&self) -> Value {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return Value::Null;
        };
        serde_json::from_str(&text).unwrap_or_else(|err| {
            eprintln!("tylia: ignoring invalid {}: {err}", self.path.display());
            let _ = fs::rename(
                &self.path,
                self.path.with_file_name("ui-state.invalid.json"),
            );
            Value::Null
        })
    }

    /// Writes atomically: to a temporary file, then renamed over the old one.
    pub fn save(&self, value: &Value) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec(value).map_err(io::Error::other)?)?;
        fs::rename(&tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_preserves_invalid_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = UiStateStore::new(dir.path());
        assert_eq!(store.load(), Value::Null);
        let value = serde_json::json!({ "tabs": ["a"], "recent": [] });
        store.save(&value).unwrap();
        assert_eq!(store.load(), value);
        fs::write(dir.path().join("ui-state.json"), "{oops").unwrap();
        assert_eq!(store.load(), Value::Null);
        assert!(dir.path().join("ui-state.invalid.json").exists());
    }
}
