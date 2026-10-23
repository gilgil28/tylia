//! Commit and tag signatures (Phase 11 D): whether a GPG, SSH or X.509 signature is good,
//! and by whom. One object at a time (the details pane): checking runs the signing
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
        let mut check = parse_log(&lossy(&checked?.stdout));
        // Git says "no signature" for an SSH signature it has no allowed signers to check
        // against; the commit's own header says it's signed.
        if check.status == SignatureStatus::Unsigned && is_signed(&lossy(&object?.stdout)) {
            check.status = SignatureStatus::CannotCheck;
        }
        Ok(check)
    }

    /// The tag's signature. Lightweight and unsigned annotated tags are `Unsigned`.
    pub async fn verify_tag(&self, repo: &Path, name: &str) -> Result<SignatureCheck, GitError> {
        self.check_tag(name).await?;
        let full = format!("refs/tags/{name}");
        let tag = self
            .run(
                Some(repo),
                [
                    "for-each-ref",
                    "--format=%(objecttype)%00%(contents:signature)",
                    &full,
                ],
            )
            .await?;
        let tag = lossy(&tag.stdout);
        let (kind, signature) = tag.split_once('\0').unwrap_or(("", ""));
        if kind.is_empty() {
            return Err(GitError::InvalidInput(format!("There's no tag “{name}”.")));
        }
        if kind != "tag" || signature.trim().is_empty() {
            return Ok(SignatureCheck::UNSIGNED);
        }
        // `for-each-ref` has no signature atoms for tags, so this reads what the signing
        // program reported. It exits 1 for anything but a good signature.
        let checked = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                ["verify-tag", "--raw", &full],
            )
            .await?;
        Ok(parse_raw(&lossy(&checked.stderr)))
    }
}

impl SignatureCheck {
    const UNSIGNED: Self = Self {
        status: SignatureStatus::Unsigned,
        signer: None,
        key: None,
    };
}

/// Git's letter for a signature (`%G?`).
fn status(letter: &str) -> SignatureStatus {
    match letter {
        "G" => SignatureStatus::Good,
        "U" => SignatureStatus::GoodUntrusted,
        "X" | "Y" | "R" => SignatureStatus::GoodExpired,
        "B" => SignatureStatus::Bad,
        "E" => SignatureStatus::CannotCheck,
        _ => SignatureStatus::Unsigned,
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

fn field(f: Option<&str>) -> Option<String> {
    f.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// `log --format=%G?%x00%GS%x00%GF%x00%GK`.
fn parse_log(text: &str) -> SignatureCheck {
    let mut fields = text.trim_end_matches('\n').split('\0');
    let status = status(fields.next().unwrap_or("N"));
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

/// `verify-tag --raw` of a signed tag: GnuPG status lines (GPG and X.509), mapped the way
/// Git maps them for `%G?`, or `ssh-keygen`'s messages.
fn parse_raw(text: &str) -> SignatureCheck {
    let mut check = SignatureCheck {
        status: SignatureStatus::CannotCheck,
        ..SignatureCheck::UNSIGNED
    };
    let mut fingerprint = None;
    let mut untrusted = false;
    let mut gnupg = false;
    for line in text.lines() {
        if let Some(status_line) = line.strip_prefix("[GNUPG:] ") {
            gnupg = true;
            let (keyword, rest) = status_line.split_once(' ').unwrap_or((status_line, ""));
            let letter = match keyword {
                "GOODSIG" => "G",
                "EXPSIG" => "X",
                "EXPKEYSIG" => "Y",
                "REVKEYSIG" => "R",
                "BADSIG" => "B",
                "ERRSIG" => {
                    let mut fields = rest.split(' ');
                    check.key = field(fields.next());
                    fingerprint = field(fields.nth(5));
                    "E"
                }
                "VALIDSIG" => {
                    fingerprint = field(rest.split(' ').next());
                    continue;
                }
                "TRUST_UNDEFINED" | "TRUST_NEVER" => {
                    untrusted = true;
                    continue;
                }
                _ => continue,
            };
            check.status = status(letter);
            if letter != "E" {
                let (key, signer) = rest.split_once(' ').unwrap_or((rest, ""));
                check.key = field(Some(key));
                check.signer = field(Some(signer));
            }
        } else if !gnupg && let Some(good) = line.strip_prefix("Good \"git\" signature ") {
            // "for <principal> with <ALG> key <fingerprint>"; without "for", the key isn't
            // in the allowed-signers file (Git's "U").
            let (signer, key) = good.rsplit_once(" key ").unwrap_or((good, ""));
            check.key = field(Some(key));
            match signer.strip_prefix("for ") {
                Some(principal) => {
                    check.status = SignatureStatus::Good;
                    check.signer = field(principal.rsplit_once(" with ").map(|(p, _)| p));
                }
                None => check.status = SignatureStatus::GoodUntrusted,
            }
        } else if !gnupg && line.contains("incorrect signature") {
            check.status = SignatureStatus::Bad;
        }
    }
    if untrusted && check.status == SignatureStatus::Good {
        check.status = SignatureStatus::GoodUntrusted;
    }
    check.key = fingerprint.or(check.key);
    check
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_status_letters() {
        let check = parse_log("G\0Ada <ada@example.com>\0ABCD1234\0EF56\n");
        assert_eq!(check.status, SignatureStatus::Good);
        assert_eq!(check.signer.as_deref(), Some("Ada <ada@example.com>"));
        assert_eq!(check.key.as_deref(), Some("ABCD1234"));
        assert_eq!(parse_log("E\0\0\0EF56\n").key.as_deref(), Some("EF56"));
        assert_eq!(parse_log("N\0\0\0\n").status, SignatureStatus::Unsigned);
        assert_eq!(parse_log("Y\0a\0\0\n").status, SignatureStatus::GoodExpired);
        assert_eq!(parse_log("B\0a\0\0\n").status, SignatureStatus::Bad);
        assert_eq!(parse_log("").status, SignatureStatus::Unsigned);
    }

    #[test]
    fn parses_gnupg_status_lines() {
        // A git/git release tag without Junio's key.
        let missing = parse_raw(
            "[GNUPG:] NEWSIG\n\
             [GNUPG:] ERRSIG B0B5E88696AFE6CB 1 8 00 1714401043 9 \
             E1F036B1FEE7221FC778ECEFB0B5E88696AFE6CB\n\
             [GNUPG:] NO_PUBKEY B0B5E88696AFE6CB\n\
             [GNUPG:] FAILURE gpg-exit 33554433\n",
        );
        assert_eq!(missing.status, SignatureStatus::CannotCheck);
        assert_eq!(
            missing.key.as_deref(),
            Some("E1F036B1FEE7221FC778ECEFB0B5E88696AFE6CB")
        );
        assert_eq!(missing.signer, None);

        let good = "[GNUPG:] NEWSIG\n\
                    [GNUPG:] GOODSIG B0B5E88696AFE6CB Junio C Hamano <gitster@pobox.com>\n\
                    [GNUPG:] VALIDSIG E1F036B1FEE7221FC778ECEFB0B5E88696AFE6CB 2024-04-29\n";
        let check = parse_raw(&format!("{good}[GNUPG:] TRUST_FULLY 0 pgp\n"));
        assert_eq!(check.status, SignatureStatus::Good);
        assert_eq!(
            check.signer.as_deref(),
            Some("Junio C Hamano <gitster@pobox.com>")
        );
        assert_eq!(
            check.key.as_deref(),
            Some("E1F036B1FEE7221FC778ECEFB0B5E88696AFE6CB")
        );
        let check = parse_raw(&format!("{good}[GNUPG:] TRUST_UNDEFINED 0 pgp\n"));
        assert_eq!(check.status, SignatureStatus::GoodUntrusted);
        let check = parse_raw("[GNUPG:] EXPKEYSIG AB Ada\n");
        assert_eq!(check.status, SignatureStatus::GoodExpired);
        let check = parse_raw("[GNUPG:] BADSIG AB Ada <ada@example.com>\n");
        assert_eq!(check.status, SignatureStatus::Bad);
        assert_eq!(check.signer.as_deref(), Some("Ada <ada@example.com>"));
        // No signing program at all.
        let check = parse_raw("error: cannot run gpg: No such file or directory\n");
        assert_eq!(check.status, SignatureStatus::CannotCheck);
    }
}
