use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::Git;

/// Oldest Git release Tylia supports.
pub const MIN_GIT_VERSION: GitVersion = GitVersion {
    major: 2,
    minor: 40,
    patch: 0,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[ts(export)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl GitVersion {
    /// Parses `git --version` output such as `git version 2.50.1.windows.1` or
    /// `git version 2.39.3 (Apple Git-146)`.
    pub fn parse(output: &str) -> Option<Self> {
        let rest = output.trim().strip_prefix("git version ")?;
        let mut parts = rest
            .split(|c: char| !c.is_ascii_digit())
            .take_while(|s| !s.is_empty())
            .map(str::parse::<u32>);
        let major = parts.next()?.ok()?;
        let minor = parts.next()?.ok()?;
        let patch = parts.next().and_then(Result::ok).unwrap_or(0);
        Some(Self {
            major,
            minor,
            patch,
        })
    }
}

/// The Git executable in use and whether it is new enough.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitInfo {
    pub version: GitVersion,
    /// Full `git --version` output, e.g. `git version 2.50.1.windows.1`.
    pub raw: String,
    pub path: String,
    /// [`MIN_GIT_VERSION`], so the UI can name it.
    pub minimum: GitVersion,
    pub supported: bool,
}

impl Git {
    pub async fn info(&self) -> Result<GitInfo, GitError> {
        let out = self.run(None, ["--version"]).await?;
        let raw = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        let version = GitVersion::parse(&raw).ok_or_else(|| GitError::Parse {
            command: "git --version".to_owned(),
            detail: raw.clone(),
        })?;
        Ok(GitInfo {
            version,
            raw,
            path: self.path().display().to_string(),
            minimum: MIN_GIT_VERSION,
            supported: version >= MIN_GIT_VERSION,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(major: u32, minor: u32, patch: u32) -> GitVersion {
        GitVersion {
            major,
            minor,
            patch,
        }
    }

    #[test]
    fn parses_common_formats() {
        let cases = [
            ("git version 2.50.1", v(2, 50, 1)),
            ("git version 2.50.1.windows.1\n", v(2, 50, 1)),
            ("git version 2.39.3 (Apple Git-146)", v(2, 39, 3)),
            ("git version 2.45.0.rc1", v(2, 45, 0)),
            ("git version 2.40", v(2, 40, 0)),
        ];
        for (input, expected) in cases {
            assert_eq!(GitVersion::parse(input), Some(expected), "{input}");
        }
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(GitVersion::parse(""), None);
        assert_eq!(GitVersion::parse("hg version 6.0"), None);
        assert_eq!(GitVersion::parse("git version x.y"), None);
    }

    #[test]
    fn compares_against_minimum() {
        assert!(v(2, 39, 9) < MIN_GIT_VERSION);
        assert!(v(2, 40, 0) >= MIN_GIT_VERSION);
        assert!(v(3, 0, 0) >= MIN_GIT_VERSION);
    }
}
