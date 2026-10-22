//! Patch files: saving a commit or changes, previewing and applying them, `git am` stopping
//! on conflicts (Phase 8).

use std::path::PathBuf;

use crate::common::TestRepo;
use tylia_git::{
    Git, GitError, IntegrateOutcome, OperationKind, PatchApplyMode, PatchCheck, PatchFormat,
};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

fn assert_invalid<T: std::fmt::Debug>(result: Result<T, GitError>) {
    assert!(
        matches!(result, Err(GitError::InvalidInput(_))),
        "expected InvalidInput, got {result:?}"
    );
}

/// A repository whose configured editor fails, so a test fails if anything opens one.
fn repo() -> TestRepo {
    let repo = TestRepo::new();
    repo.git(&["config", "core.editor", "false"]);
    repo
}

fn patch_path(name: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    (dir, path)
}

#[tokio::test]
async fn a_saved_commit_becomes_the_same_commit_with_am() {
    let mut repo = repo();
    repo.commit_file("f.txt", "1\n2\n3\n", "base");
    repo.branch("feature");
    let oid = repo.commit_file("f.txt", "1\ntwo\n3\n", "change two");
    let (_dir, file) = patch_path("change.patch");
    git()
        .save_commit_patch(repo.path(), &oid, &file)
        .await
        .unwrap();

    repo.checkout("main");
    let preview = git().preview_patch(repo.path(), &file).await.unwrap();
    assert_eq!(preview.format, PatchFormat::Mailbox);
    assert_eq!(preview.commits, ["change two"]);
    assert_eq!(preview.files.len(), 1);
    assert_eq!(preview.files[0].path, "f.txt");
    assert_eq!(
        (preview.files[0].added, preview.files[0].removed),
        (Some(1), Some(1))
    );
    assert_eq!(preview.check, PatchCheck::Clean);

    let outcome = git()
        .apply_patch_file(repo.path(), &file, PatchApplyMode::Commits)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s|%an"]),
        "change two|Test"
    );
    assert_eq!(repo.read("f.txt"), "1\ntwo\n3\n");
    assert!(repo.git(&["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn changes_with_binary_files_and_renames_apply_to_the_working_tree() {
    let mut repo = repo();
    std::fs::write(repo.path().join("logo.bin"), [0u8, 1, 2, 255, 0, 7]).unwrap();
    repo.commit_file("old name.txt", "keep\n", "base");
    std::fs::write(repo.path().join("logo.bin"), [9u8, 0, 8, 255, 0, 1, 2]).unwrap();
    repo.git(&["mv", "old name.txt", "new name.txt"]);
    repo.git(&["add", "-A"]);
    let (_dir, file) = patch_path("staged.patch");
    git()
        .save_changes_patch(repo.path(), true, &file)
        .await
        .unwrap();

    repo.git(&["reset", "-q", "--hard"]);
    let preview = git().preview_patch(repo.path(), &file).await.unwrap();
    assert_eq!(preview.format, PatchFormat::Diff);
    assert!(preview.commits.is_empty());
    let binary = preview.files.iter().find(|f| f.path == "logo.bin").unwrap();
    assert_eq!((binary.added, binary.removed), (None, None));
    let renamed = preview
        .files
        .iter()
        .find(|f| f.path == "new name.txt")
        .unwrap();
    assert_eq!(renamed.old_path.as_deref(), Some("old name.txt"));

    let outcome = git()
        .apply_patch_file(repo.path(), &file, PatchApplyMode::WorkingTree)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(
        std::fs::read(repo.path().join("logo.bin")).unwrap(),
        [9u8, 0, 8, 255, 0, 1, 2]
    );
    assert!(repo.path().join("new name.txt").is_file());
    assert!(!repo.path().join("old name.txt").exists());
    // A plain diff has no commits to create.
    assert_invalid(
        git()
            .apply_patch_file(repo.path(), &file, PatchApplyMode::Commits)
            .await,
    );
}

#[tokio::test]
async fn crlf_lines_survive_save_and_apply() {
    let mut repo = repo();
    repo.commit_file("win.txt", "a\r\nb\r\nc\r\n", "base");
    repo.branch("feature");
    let oid = repo.commit_file("win.txt", "a\r\nB\r\nc\r\n", "change b");
    let (_dir, file) = patch_path("crlf.patch");
    git()
        .save_commit_patch(repo.path(), &oid, &file)
        .await
        .unwrap();
    repo.checkout("main");

    let outcome = git()
        .apply_patch_file(repo.path(), &file, PatchApplyMode::Commits)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(repo.read("win.txt"), "a\r\nB\r\nc\r\n");

    repo.git(&["reset", "-q", "--hard", "HEAD~1"]);
    let outcome = git()
        .apply_patch_file(repo.path(), &file, PatchApplyMode::WorkingTree)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(repo.read("win.txt"), "a\r\nB\r\nc\r\n");
}

#[tokio::test]
async fn a_conflicting_patch_stops_am_like_a_rebase() {
    let mut repo = repo();
    repo.commit_file("f.txt", "1\n2\n3\n", "base");
    repo.branch("feature");
    let oid = repo.commit_file("f.txt", "feature\n2\n3\n", "feature edit");
    let (_dir, file) = patch_path("feature.patch");
    git()
        .save_commit_patch(repo.path(), &oid, &file)
        .await
        .unwrap();
    repo.checkout("main");
    repo.commit_file("f.txt", "main\n2\n3\n", "main edit");

    let preview = git().preview_patch(repo.path(), &file).await.unwrap();
    assert_eq!(preview.check, PatchCheck::ThreeWay);
    assert!(preview.check_message.is_some());

    let outcome = git()
        .apply_patch_file(repo.path(), &file, PatchApplyMode::Commits)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Conflicts);
    let op = git().status(repo.path()).await.unwrap().operation.unwrap();
    assert_eq!(op.kind, OperationKind::Am);
    assert_eq!(op.incoming.as_deref(), Some("feature edit"));
    assert_eq!((op.step, op.total), (Some(1), Some(1)));
    // Nothing else starts meanwhile.
    assert_invalid(
        git()
            .apply_patch_file(repo.path(), &file, PatchApplyMode::Commits)
            .await,
    );

    // Resolve, continue: the patch's commit is created with its message.
    repo.write("f.txt", "both\n2\n3\n");
    repo.git(&["add", "f.txt"]);
    let outcome = git().continue_operation(repo.path()).await.unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "feature edit");
    assert!(git().status(repo.path()).await.unwrap().operation.is_none());

    // Again, then abort: back to where it started.
    let before = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["reset", "-q", "--hard", "HEAD~1"]);
    let start = repo.git(&["rev-parse", "HEAD"]);
    assert_ne!(before, start);
    let outcome = git()
        .apply_patch_file(repo.path(), &file, PatchApplyMode::Commits)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Conflicts);
    git().abort_operation(repo.path()).await.unwrap();
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), start);
    assert_eq!(repo.read("f.txt"), "main\n2\n3\n");
    assert!(git().status(repo.path()).await.unwrap().operation.is_none());
}

#[tokio::test]
async fn a_patch_for_other_files_fails_the_check_and_changes_nothing() {
    let mut repo = repo();
    repo.commit_file("f.txt", "1\n2\n3\n", "base");
    let (_dir, file) = patch_path("other.patch");
    std::fs::write(
        &file,
        "diff --git a/missing.txt b/missing.txt\n\
         --- a/missing.txt\n\
         +++ b/missing.txt\n\
         @@ -1,2 +1,2 @@\n\
         -x\n\
         +y\n\
         \x20z\n",
    )
    .unwrap();
    let preview = git().preview_patch(repo.path(), &file).await.unwrap();
    assert_eq!(preview.check, PatchCheck::Fails);
    assert!(preview.check_message.unwrap().contains("missing.txt"));
    let result = git()
        .apply_patch_file(repo.path(), &file, PatchApplyMode::WorkingTree)
        .await;
    assert!(matches!(result, Err(GitError::Failed { .. })), "{result:?}");
    assert!(repo.git(&["status", "--porcelain"]).is_empty());
}

#[tokio::test]
async fn nothing_to_save_and_files_that_arent_patches_are_refused() {
    let mut repo = repo();
    repo.commit_file("f.txt", "1\n", "base");
    let (_dir, file) = patch_path("empty.patch");
    assert_invalid(git().save_changes_patch(repo.path(), true, &file).await);
    assert_invalid(git().save_changes_patch(repo.path(), false, &file).await);
    assert!(!file.exists());

    std::fs::write(&file, "just some notes\n").unwrap();
    assert_invalid(git().preview_patch(repo.path(), &file).await);
    assert_invalid(
        git()
            .save_commit_patch(repo.path(), "--output=x", &file)
            .await,
    );
}
