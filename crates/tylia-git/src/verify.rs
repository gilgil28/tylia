//! Commit signatures (Phase 11 D): whether a commit's GPG, SSH or X.509 signature is good,
//! and by whom. One commit at a time (the details pane): checking runs the signing
//! program, too slow for every row of a large history.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::ops::check_rev;
use crate::runner::{Git, RunOptions, lossy};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SignatureStatus {
    Unsigned,
    /// Good, from a trusted key.
    Good,
    /// Good, but the key's owner isn't confirmed (GPG "unknown validity").
    GoodUntrusted,
    /// Good, but the signature or the key has expired, or the key was revoked.
    GoodExpired,
    Bad,
    /// Signed, but it can't be checked here: the key, or the signing program, is missing
    /// (or, for SSH, no allowed-signers file is configured).
    CannotCheck,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SignatureCheck {
    pub status: SignatureStatus,
    /// Who signed it, as the key names them.
    pub signer: Option<String>,
    /// The key's id or fingerprint.
    pub key: Option<String>,
}

impl Git {
    pub async fn verify_commit(&self, repo: &Path, oid: &str) -> Result<SignatureCheck, GitError> {
        check_rev(oid)?;
        let opts = RunOptions {
            c_locale: true,
            ..RunOptions::in_dir(repo)
        };
        let (checked, object) = tokio::join!(
            self.run_with(
                opts,
                [
                    "log",
                    "-1",
                    "--no-walk",
                    "--format=%G?%x00%GS%x00%GF%x00%GK",
                    oid,
                    "--",
                ],
            ),
            self.run_with(opts, ["cat-file", "commit", oid]),
        );
        let mut check = parse(&lossy(&checked?.stdout));
        // Git says "no signature" for an SSH signature it has no allowed signers to check
        // against; the commit's own header says it's signed.
        if check.status == SignatureStatus::Unsigned && is_signed(&lossy(&object?.stdout)) {
            check.status = SignatureStatus::CannotCheck;
        }
        Ok(check)
    }
}

/// The commit object has a signature header (`gpgsig`, or `gpgsig-sha256`).
fn is_signed(object: &str) -> bool {
    object
        .split("\n\n")
        .next()
        .unwrap_or("")
        .lines()
        .any(|line| line.starts_with("gpgsig ") || line.starts_with("gpgsig-sha256 "))
}

fn parse(text: &str) -> SignatureCheck {
    let mut fields = text.trim_end_matches('\n').split('\0');
    let status = match fields.next().unwrap_or("N") {
        "G" => SignatureStatus::Good,
        "U" => SignatureStatus::GoodUntrusted,
        "X" | "Y" | "R" => SignatureStatus::GoodExpired,
        "B" => SignatureStatus::Bad,
        "E" => SignatureStatus::CannotCheck,
        _ => SignatureStatus::Unsigned,
    };
    let field = |f: Option<&str>| {
        f.map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let signer = field(fields.next());
    // The fingerprint when Git has one, else the key id.
    let fingerprint = field(fields.next());
    let key = fingerprint.or_else(|| field(fields.next()));
    SignatureCheck {
        status,
        signer,
        key,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_status_letters() {
        let check = parse("G\0Ada <ada@example.com>\0ABCD1234\0EF56\n");
        assert_eq!(check.status, SignatureStatus::Good);
        assert_eq!(check.signer.as_deref(), Some("Ada <ada@example.com>"));
        assert_eq!(check.key.as_deref(), Some("ABCD1234"));
        assert_eq!(parse("E\0\0\0EF56\n").key.as_deref(), Some("EF56"));
        assert_eq!(parse("N\0\0\0\n").status, SignatureStatus::Unsigned);
        assert_eq!(parse("Y\0a\0\0\n").status, SignatureStatus::GoodExpired);
        assert_eq!(parse("B\0a\0\0\n").status, SignatureStatus::Bad);
        assert_eq!(parse("").status, SignatureStatus::Unsigned);
    }
}
