//! Commit signatures, with a throwaway SSH signing key (Phase 11 D).

use std::path::Path;
use std::process::Command;

use crate::common::TestRepo;
use tylia_git::{Git, SignatureStatus};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// A throwaway SSH key without a passphrase; returns the private key's path.
fn keygen(dir: &Path, name: &str) -> String {
    let key = dir.join(name);
    let made = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f"])
        .arg(&key)
        .status()
        .unwrap();
    assert!(made.success());
    key.display().to_string()
}

#[tokio::test]
async fn ssh_signed_commits_are_checked_against_allowed_signers() {
    let mut repo = TestRepo::new();
    let unsigned = repo.commit("unsigned");
    let keys = tempfile::tempdir().unwrap();
    let key_path = keygen(keys.path(), "key");
    repo.git(&["config", "gpg.format", "ssh"]);
    repo.git(&["config", "user.signingkey", &key_path]);
    repo.write("signed.txt", "signed");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-q", "-S", "-m", "signed"]);
    let signed = repo.git(&["rev-parse", "HEAD"]);

    // Without an allowed-signers file Git can't tell whose key it is.
    let check = git().verify_commit(repo.path(), &signed).await.unwrap();
    assert_eq!(check.status, SignatureStatus::CannotCheck, "{check:?}");

    let public = std::fs::read_to_string(format!("{key_path}.pub")).unwrap();
    let allowed = keys.path().join("allowed");
    std::fs::write(&allowed, format!("test@example.com {public}")).unwrap();
    repo.git(&[
        "config",
        "gpg.ssh.allowedSignersFile",
        &allowed.display().to_string(),
    ]);
    let check = git().verify_commit(repo.path(), &signed).await.unwrap();
    assert_eq!(check.status, SignatureStatus::Good, "{check:?}");
    assert_eq!(check.signer.as_deref(), Some("test@example.com"));
    assert!(check.key.as_deref().unwrap().starts_with("SHA256:"));

    let check = git().verify_commit(repo.path(), &unsigned).await.unwrap();
    assert_eq!(check.status, SignatureStatus::Unsigned);
    assert!(git().verify_commit(repo.path(), "--all").await.is_err());
}

#[tokio::test]
async fn ssh_signed_tags_are_checked_and_others_are_unsigned() {
    let mut repo = TestRepo::new();
    repo.commit("first");
    let keys = tempfile::tempdir().unwrap();
    let key_path = keygen(keys.path(), "key");
    repo.git(&["config", "gpg.format", "ssh"]);
    repo.git(&["config", "user.signingkey", &key_path]);
    repo.git(&["tag", "-s", "-m", "signed", "signed"]);
    repo.git(&["tag", "-a", "-m", "annotated", "annotated"]);
    repo.git(&["tag", "light"]);

    let check = git().verify_tag(repo.path(), "signed").await.unwrap();
    assert_eq!(check.status, SignatureStatus::CannotCheck, "{check:?}");

    // A key that isn't in the allowed signers: good, but whose is unknown.
    let public = std::fs::read_to_string(format!("{key_path}.pub")).unwrap();
    let allowed = keys.path().join("allowed");
    let other = keygen(keys.path(), "other");
    let other = std::fs::read_to_string(format!("{other}.pub")).unwrap();
    std::fs::write(&allowed, format!("other@example.com {other}")).unwrap();
    repo.git(&[
        "config",
        "gpg.ssh.allowedSignersFile",
        &allowed.display().to_string(),
    ]);
    let check = git().verify_tag(repo.path(), "signed").await.unwrap();
    assert_eq!(check.status, SignatureStatus::GoodUntrusted, "{check:?}");

    std::fs::write(&allowed, format!("test@example.com {public}")).unwrap();
    let check = git().verify_tag(repo.path(), "signed").await.unwrap();
    assert_eq!(check.status, SignatureStatus::Good, "{check:?}");
    assert_eq!(check.signer.as_deref(), Some("test@example.com"));
    assert!(check.key.as_deref().unwrap().starts_with("SHA256:"));

    // The same tag with its message changed after signing.
    let object = repo.git(&["cat-file", "tag", "signed"]);
    let tampered = repo.path().join("tampered");
    std::fs::write(
        &tampered,
        format!("{}\n", object.replacen("\n\nsigned", "\n\nchanged", 1)),
    )
    .unwrap();
    let oid = repo.git(&[
        "hash-object",
        "-t",
        "tag",
        "-w",
        &tampered.display().to_string(),
    ]);
    repo.git(&["update-ref", "refs/tags/tampered", &oid]);
    let check = git().verify_tag(repo.path(), "tampered").await.unwrap();
    assert_eq!(check.status, SignatureStatus::Bad, "{check:?}");

    for name in ["annotated", "light"] {
        let check = git().verify_tag(repo.path(), name).await.unwrap();
        assert_eq!(check.status, SignatureStatus::Unsigned, "{name}");
    }
    assert!(git().verify_tag(repo.path(), "missing").await.is_err());
    assert!(git().verify_tag(repo.path(), "-x").await.is_err());
}
