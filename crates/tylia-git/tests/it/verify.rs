//! Commit signatures, with a throwaway SSH signing key (Phase 11 D).

use std::process::Command;

use crate::common::TestRepo;
use tylia_git::{Git, SignatureStatus};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

#[tokio::test]
async fn ssh_signed_commits_are_checked_against_allowed_signers() {
    let mut repo = TestRepo::new();
    let unsigned = repo.commit("unsigned");
    let keys = tempfile::tempdir().unwrap();
    let key = keys.path().join("key");
    let made = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f"])
        .arg(&key)
        .status()
        .unwrap();
    assert!(made.success());
    let key_path = key.display().to_string();
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
