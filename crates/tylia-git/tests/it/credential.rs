//! Tylia's own secrets through Git's credential helpers (Phase 9). Each test clears the
//! machine's helpers in a temp repository's local config and uses `store` with a temp file,
//! so the developer's real credential store is never touched.

use crate::common::TestRepo;
use tylia_git::{CredentialKey, Git, GitError};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// A repository whose only credential helper is `store` writing to `file`.
fn isolated(file: &std::path::Path) -> TestRepo {
    let repo = TestRepo::new();
    repo.git(&["config", "--local", "credential.helper", ""]);
    let helper = format!(
        "store --file={}",
        file.display().to_string().replace('\\', "/")
    );
    repo.git(&["config", "--local", "--add", "credential.helper", &helper]);
    repo
}

fn key(user: &str) -> CredentialKey {
    CredentialKey {
        host: "api.github.com".into(),
        username: format!("tylia:{user}"),
    }
}

#[tokio::test]
async fn secrets_round_trip_and_are_erased() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("creds");
    let repo = isolated(&file);
    assert_eq!(
        git().read_secret(repo.path(), &key("ada")).await.unwrap(),
        None
    );

    git()
        .store_secret(repo.path(), &key("ada"), "ghp_secret")
        .await
        .unwrap();
    git()
        .store_secret(repo.path(), &key("bob"), "ghp_other")
        .await
        .unwrap();
    assert_eq!(
        git()
            .read_secret(repo.path(), &key("ada"))
            .await
            .unwrap()
            .as_deref(),
        Some("ghp_secret")
    );
    assert_eq!(
        git()
            .read_secret(repo.path(), &key("bob"))
            .await
            .unwrap()
            .as_deref(),
        Some("ghp_other")
    );

    git().erase_secret(repo.path(), &key("ada")).await.unwrap();
    assert_eq!(
        git().read_secret(repo.path(), &key("ada")).await.unwrap(),
        None
    );
    assert!(
        git()
            .read_secret(repo.path(), &key("bob"))
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn without_a_helper_nothing_is_kept_and_nothing_asks() {
    let repo = TestRepo::new();
    repo.git(&["config", "--local", "credential.helper", ""]);
    // An askpass that would answer if Git ran it: it must not be run.
    repo.git(&["config", "--local", "core.askPass", "echo"]);
    git()
        .store_secret(repo.path(), &key("ada"), "ghp_secret")
        .await
        .unwrap();
    assert_eq!(
        git().read_secret(repo.path(), &key("ada")).await.unwrap(),
        None
    );
}

#[tokio::test]
async fn values_that_would_add_lines_are_refused() {
    let repo = TestRepo::new();
    for bad in [
        CredentialKey {
            host: "api.github.com\nhost=evil".into(),
            username: "x".into(),
        },
        CredentialKey {
            host: "api.github.com".into(),
            username: String::new(),
        },
    ] {
        let result = git().store_secret(repo.path(), &bad, "token").await;
        assert!(
            matches!(result, Err(GitError::InvalidInput(_))),
            "{result:?}"
        );
    }
    let result = git()
        .store_secret(repo.path(), &key("ada"), "line\npassword=other")
        .await;
    assert!(
        matches!(result, Err(GitError::InvalidInput(_))),
        "{result:?}"
    );
}
