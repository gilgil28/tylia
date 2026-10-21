use tylia_git::{Git, GitError};

#[tokio::test]
async fn discovers_git_and_reads_version() {
    let git = Git::discover().expect("git must be installed to run the tests");
    let info = git.info().await.unwrap();
    assert!(info.raw.starts_with("git version "));
    assert!(
        info.supported,
        "tests require git >= 2.40, found {}",
        info.raw
    );
}

#[tokio::test]
async fn failed_command_keeps_command_and_stderr() {
    let git = Git::discover().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let err = git
        .run(Some(dir.path()), ["rev-parse", "HEAD"])
        .await
        .unwrap_err();
    match &err {
        GitError::Failed { code, .. } => assert_ne!(*code, Some(0)),
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(err.command(), Some("git rev-parse HEAD"));
    assert!(err.stderr().unwrap().contains("not a git repository"));
}

#[tokio::test]
async fn missing_executable_is_a_spawn_error() {
    let git = Git::with_path("definitely-not-git-tylia");
    let err = git.run(None, ["--version"]).await.unwrap_err();
    assert!(matches!(err, GitError::Spawn { .. }), "{err:?}");
}
