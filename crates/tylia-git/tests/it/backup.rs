//! Backups of discarded changes and restoring them (Phase 11 C).

use crate::common::TestRepo;
use tylia_git::{DiscardKind, Git};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|p| (*p).to_owned()).collect()
}

/// Discards `files` the way the app does, with a backup around it; returns its id.
async fn discard(repo: &TestRepo, files: &[&str]) -> String {
    let files = paths(files);
    let pending = git()
        .backup_begin(repo.path(), DiscardKind::Files, &files)
        .await
        .unwrap()
        .unwrap();
    git().discard_files(repo.path(), &files, &[]).await.unwrap();
    git()
        .backup_finish(repo.path(), pending)
        .await
        .unwrap()
        .expect("a backup")
}

fn base() -> TestRepo {
    let mut repo = TestRepo::new();
    repo.commit_file("a.txt", "1\n2\n3\n4\n5\n6\n7\n8\n", "first");
    repo.commit_file("b.txt", "b\n", "second");
    repo
}

#[tokio::test]
async fn a_discarded_file_comes_back_and_the_backup_goes() {
    let repo = base();
    repo.write("a.txt", "1\n2\n3\n4\n5\n6\n7\nnew\n");
    repo.write("b.txt", "kept\n");
    let id = discard(&repo, &["a.txt"]).await;
    assert_eq!(repo.read("a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n");

    let backups = git().discard_backups(repo.path()).await.unwrap();
    assert_eq!(backups.len(), 1);
    assert_eq!(backups[0].id, id);
    assert_eq!(backups[0].kind, DiscardKind::Files);
    assert_eq!(backups[0].files, ["a.txt"]);

    let outcome = git().restore_backup(repo.path(), &id).await.unwrap();
    assert_eq!(outcome.restored, ["a.txt"]);
    assert_eq!(repo.read("a.txt"), "1\n2\n3\n4\n5\n6\n7\nnew\n");
    assert_eq!(repo.read("b.txt"), "kept\n");
    assert!(git().discard_backups(repo.path()).await.unwrap().is_empty());
    // The index was never touched.
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[tokio::test]
async fn a_file_changed_since_is_merged_not_overwritten() {
    let repo = base();
    repo.write("a.txt", "1\n2\n3\n4\n5\n6\n7\ndiscarded\n");
    let id = discard(&repo, &["a.txt"]).await;
    // A new edit elsewhere in the file after discarding.
    repo.write("a.txt", "edited\n2\n3\n4\n5\n6\n7\n8\n");
    let outcome = git().restore_backup(repo.path(), &id).await.unwrap();
    assert_eq!(outcome.restored, ["a.txt"]);
    assert_eq!(repo.read("a.txt"), "edited\n2\n3\n4\n5\n6\n7\ndiscarded\n");

    // The same line changed both ways: conflict markers, and the backup stays.
    repo.write("a.txt", "1\n2\n3\n4\n5\n6\n7\nmine\n");
    let id = discard(&repo, &["a.txt"]).await;
    repo.write("a.txt", "1\n2\n3\n4\n5\n6\n7\nother\n");
    let outcome = git().restore_backup(repo.path(), &id).await.unwrap();
    assert_eq!(outcome.conflicts, ["a.txt"]);
    assert!(repo.read("a.txt").contains("<<<<<<< current"));
    assert_eq!(git().discard_backups(repo.path()).await.unwrap().len(), 1);
}

#[tokio::test]
async fn discarded_lines_and_a_discarded_deletion_come_back() {
    let repo = base();
    repo.write("a.txt", "one\n2\n3\n4\n5\n6\n7\neight\n");
    let files = paths(&["a.txt"]);
    let pending = git()
        .backup_begin(repo.path(), DiscardKind::Lines, &files)
        .await
        .unwrap()
        .unwrap();
    // Discarding the last line's change (the backup doesn't care how lines were
    // discarded; the line operations have their own tests).
    repo.write("a.txt", "one\n2\n3\n4\n5\n6\n7\n8\n");
    assert_eq!(repo.read("a.txt"), "one\n2\n3\n4\n5\n6\n7\n8\n");
    let id = git()
        .backup_finish(repo.path(), pending)
        .await
        .unwrap()
        .unwrap();
    git().restore_backup(repo.path(), &id).await.unwrap();
    assert_eq!(repo.read("a.txt"), "one\n2\n3\n4\n5\n6\n7\neight\n");

    // A deleted tracked file, "discarded" (restored), is deleted again by restoring.
    std::fs::remove_file(repo.path().join("b.txt")).unwrap();
    let id = discard(&repo, &["b.txt"]).await;
    assert!(repo.path().join("b.txt").exists());
    git().restore_backup(repo.path(), &id).await.unwrap();
    assert!(!repo.path().join("b.txt").exists());
}

#[tokio::test]
async fn nothing_discarded_keeps_no_backup_and_ids_are_checked() {
    let repo = base();
    let files = paths(&["a.txt"]);
    let pending = git()
        .backup_begin(repo.path(), DiscardKind::Files, &files)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        git().backup_finish(repo.path(), pending).await.unwrap(),
        None
    );
    assert!(
        git()
            .restore_backup(repo.path(), "../../heads/main")
            .await
            .is_err()
    );
    assert!(git().restore_backup(repo.path(), "123").await.is_err());
}
