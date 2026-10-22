//! Exporting a commit's files as a zip or tar.gz (`git archive`).

use std::ffi::OsString;
use std::path::Path;

use serde::Deserialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::Git;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ArchiveFormat {
    Zip,
    TarGz,
}

impl Git {
    /// Writes the files of `rev` (a commit, branch or tag) to `file`, inside a folder named
    /// `<repository>-<label>/`, `label` being what the user picked (a branch or tag name, a
    /// short hash).
    pub async fn export_archive(
        &self,
        repo: &Path,
        rev: &str,
        label: &str,
        format: ArchiveFormat,
        file: &Path,
    ) -> Result<(), GitError> {
        let oid = self.resolve_commit(repo, rev).await?;
        let name = repo
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "repository".to_owned());
        let prefix = format!("--prefix={}/", folder_name(&format!("{name}-{label}")));
        let format = match format {
            ArchiveFormat::Zip => "--format=zip",
            ArchiveFormat::TarGz => "--format=tar.gz",
        };
        let mut output = OsString::from("--output=");
        output.push(file);
        let args: Vec<OsString> = vec![
            "archive".into(),
            format.into(),
            prefix.into(),
            output,
            oid.into(),
        ];
        self.run(Some(repo), args).await?;
        Ok(())
    }
}

/// A folder name from a label: `feature/graph` → `feature-graph`; characters Windows refuses
/// and control characters become `-`.
fn folder_name(label: &str) -> String {
    let name: String = label
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let name = name.trim_matches(|c| c == '.' || c == ' ' || c == '-');
    if name.is_empty() {
        "archive".to_owned()
    } else {
        name.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::folder_name;

    #[test]
    fn folder_names_are_safe_on_every_os() {
        assert_eq!(folder_name("tylia-feature/graph"), "tylia-feature-graph");
        assert_eq!(folder_name("tylia-v1.0"), "tylia-v1.0");
        assert_eq!(folder_name(r#"a:b*c?"d<e>f|g\h"#), "a-b-c--d-e-f-g-h");
        assert_eq!(folder_name("../.."), "archive");
    }
}
