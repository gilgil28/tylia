//! Undo and redo through the operation journal (Phase 11 A). The journal doesn't care how
//! an operation was made, so the operations here are plain `git` commands.

use crate::common::TestRepo;
use tylia_git::{Git, GitError, UndoKind, UndoState};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// Runs `op` between `undo_begin` and `undo_finish`, as the app does around a write.
async fn record(repo: &TestRepo, kind: UndoKind, op: impl FnOnce(&TestRepo)) -> UndoState {
    let pending = git().undo_begin(repo.path(), kind).await.unwrap();
    op(repo);
    git().undo_finish(repo.path(), pending).await.unwrap()
}

fn head(repo: &TestRepo) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

fn base() -> TestRepo {
    let mut repo = TestRepo::new();
    repo.commit_file("f.txt", "one\n", "first");
    repo.commit_file("f.txt", "two\n", "second");
    repo
}

#[tokio::test]
async fn undo_and_redo_a_commit_keep_the_staged_changes() {
    let repo = base();
    let before = head(&repo);
    repo.write("f.txt", "three\n");
    repo.git(&["add", "f.txt"]);
    let state = record(&repo, UndoKind::Commit, |r| {
        r.git(&["commit", "-q", "-m", "third"]);
    })
    .await;
    assert_eq!(
        state,
        UndoState {
            undo: Some(UndoKind::Commit),
            redo: None
        }
    );
    let committed = head(&repo);

    let state = git().undo(repo.path()).await.unwrap();
    assert_eq!(state.redo, Some(UndoKind::Commit));
    assert_eq!(head(&repo), before);
    // Like `reset --soft`: the change is staged again, nothing is lost.
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "f.txt");
    assert_eq!(repo.read("f.txt"), "three\n");

    git().redo(repo.path()).await.unwrap();
    assert_eq!(head(&repo), committed);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[tokio::test]
async fn a_hard_reset_gives_back_the_discarded_changes() {
    let repo = base();
    let second = head(&repo);
    repo.write("f.txt", "work in progress\n");
    repo.write("staged.txt", "staged\n");
    repo.git(&["add", "staged.txt"]);
    record(&repo, UndoKind::Reset, |r| {
        r.git(&["reset", "-q", "--hard", "HEAD~1"]);
    })
    .await;
    assert_eq!(repo.read("f.txt"), "one\n");

    git().undo(repo.path()).await.unwrap();
    assert_eq!(head(&repo), second);
    assert_eq!(repo.read("f.txt"), "work in progress\n");
    // The staged file is staged again, the edit is unstaged again.
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "staged.txt");
    assert_eq!(repo.git(&["diff", "--name-only"]), "f.txt");
}

#[tokio::test]
async fn undo_a_merge_and_a_checkout() {
    let mut repo = base();
    repo.branch("feature");
    repo.commit_file("g.txt", "g\n", "feature work");
    repo.checkout("main");
    let main = head(&repo);

    record(&repo, UndoKind::Merge, |r| {
        r.git(&["merge", "-q", "--no-ff", "-m", "merge", "feature"]);
    })
    .await;
    git().undo(repo.path()).await.unwrap();
    assert_eq!(head(&repo), main);
    assert!(!repo.path().join("g.txt").exists());

    record(&repo, UndoKind::Checkout, |r| {
        r.git(&["checkout", "-q", "feature"]);
    })
    .await;
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature");
    git().undo(repo.path()).await.unwrap();
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    assert!(!repo.path().join("g.txt").exists());
}

#[tokio::test]
async fn a_deleted_branch_comes_back_with_its_upstream() {
    let mut repo = base();
    repo.git(&["branch", "topic"]);
    repo.git(&["config", "branch.topic.remote", "origin"]);
    repo.git(&["config", "branch.topic.merge", "refs/heads/topic"]);
    repo.checkout("topic");
    let tip = repo.commit("topic work");
    repo.checkout("main");

    record(&repo, UndoKind::DeleteBranch, |r| {
        r.git(&["branch", "-q", "-D", "topic"]);
    })
    .await;
    assert!(!repo.git_ok(&["rev-parse", "--verify", "topic"]));

    git().undo(repo.path()).await.unwrap();
    assert_eq!(repo.git(&["rev-parse", "topic"]), tip);
    assert_eq!(repo.git(&["config", "branch.topic.remote"]), "origin");
    assert_eq!(
        repo.git(&["config", "branch.topic.merge"]),
        "refs/heads/topic"
    );
}

#[tokio::test]
async fn renaming_the_current_branch_is_undone() {
    let repo = base();
    record(&repo, UndoKind::RenameBranch, |r| {
        r.git(&["branch", "-m", "main", "trunk"]);
    })
    .await;
    git().undo(repo.path()).await.unwrap();
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    assert!(!repo.git_ok(&["rev-parse", "--verify", "refs/heads/trunk"]));
}

#[tokio::test]
async fn a_deleted_annotated_tag_comes_back() {
    let repo = base();
    repo.git(&["tag", "-a", "v1", "-m", "release"]);
    let tag = repo.git(&["rev-parse", "refs/tags/v1"]);
    record(&repo, UndoKind::DeleteTag, |r| {
        r.git(&["tag", "-d", "v1"]);
    })
    .await;
    git().undo(repo.path()).await.unwrap();
    // The same tag object, message and all.
    assert_eq!(repo.git(&["rev-parse", "refs/tags/v1"]), tag);
    assert_eq!(
        repo.git(&["tag", "-l", "-n1", "v1"]),
        "v1              release"
    );
}

#[tokio::test]
async fn stash_save_pop_and_drop_are_undone() {
    let repo = base();
    repo.write("f.txt", "first stash\n");
    repo.git(&["stash", "push", "-q", "-m", "older"]);
    repo.write("f.txt", "edit\n");

    record(&repo, UndoKind::StashSave, |r| {
        r.git(&["stash", "push", "-q", "-m", "newer"]);
    })
    .await;
    assert_eq!(repo.read("f.txt"), "two\n");
    git().undo(repo.path()).await.unwrap();
    assert_eq!(repo.read("f.txt"), "edit\n");
    assert_eq!(
        repo.git(&["stash", "list", "--format=%gs"]),
        "On main: older"
    );

    // Back to a clean tree, then pop and drop the remaining stash.
    repo.git(&["checkout", "-q", "--", "f.txt"]);
    record(&repo, UndoKind::StashPop, |r| {
        r.git(&["stash", "pop", "-q"]);
    })
    .await;
    assert_eq!(repo.read("f.txt"), "first stash\n");
    git().undo(repo.path()).await.unwrap();
    assert_eq!(repo.read("f.txt"), "two\n");
    assert_eq!(
        repo.git(&["stash", "list", "--format=%gs"]),
        "On main: older"
    );

    record(&repo, UndoKind::StashDrop, |r| {
        r.git(&["stash", "drop", "-q"]);
    })
    .await;
    git().undo(repo.path()).await.unwrap();
    assert_eq!(
        repo.git(&["stash", "list", "--format=%gs"]),
        "On main: older"
    );
}

#[tokio::test]
async fn refuses_when_the_repository_changed_since() {
    let mut repo = base();
    record(&repo, UndoKind::CreateBranch, |r| {
        r.git(&["branch", "topic"]);
    })
    .await;
    repo.checkout("topic");
    repo.commit("work outside the journal");
    let tip = head(&repo);
    repo.checkout("main");

    let result = git().undo(repo.path()).await;
    assert!(
        matches!(result, Err(GitError::InvalidInput(_))),
        "{result:?}"
    );
    // Nothing was touched.
    assert_eq!(repo.git(&["rev-parse", "topic"]), tip);
}

#[tokio::test]
async fn refuses_to_reset_over_new_changes() {
    let repo = base();
    record(&repo, UndoKind::Reset, |r| {
        r.git(&["reset", "-q", "--hard", "HEAD~1"]);
    })
    .await;
    repo.write("f.txt", "new work\n");
    assert!(git().undo(repo.path()).await.is_err());
    assert_eq!(repo.read("f.txt"), "new work\n");
}

#[tokio::test]
async fn a_new_operation_ends_redo_and_nothing_changed_records_nothing() {
    let repo = base();
    record(&repo, UndoKind::CreateTag, |r| {
        r.git(&["tag", "v1"]);
    })
    .await;
    git().undo(repo.path()).await.unwrap();
    assert_eq!(
        git().undo_state(repo.path()).await.unwrap().redo,
        Some(UndoKind::CreateTag)
    );

    let state = record(&repo, UndoKind::CreateTag, |r| {
        r.git(&["tag", "v2"]);
    })
    .await;
    assert_eq!(state.redo, None);
    assert!(git().redo(repo.path()).await.is_err());

    // A failed or empty operation leaves the journal as it was.
    let state = record(&repo, UndoKind::Checkout, |_| {}).await;
    assert_eq!(state.undo, Some(UndoKind::CreateTag));
}

#[tokio::test]
async fn journal_refs_stay_out_of_the_history() {
    let repo = base();
    record(&repo, UndoKind::Reset, |r| {
        r.git(&["reset", "-q", "--hard", "HEAD~1"]);
    })
    .await;
    assert!(!repo.git(&["for-each-ref", "refs/tylia/undo"]).is_empty());
    let options = tylia_git::LogOptions {
        scope: tylia_git::LogScope::All,
        order: tylia_git::LogOrder::Date,
    };
    let count = git()
        .stream_log(repo.path(), options, |_| true)
        .await
        .unwrap();
    // Only `first`: `second` is reachable from the journal's refs alone.
    assert_eq!(count, 1);
}

#[tokio::test]
async fn undo_a_rebase() {
    let mut repo = base();
    repo.branch("feature");
    repo.commit_file("g.txt", "g\n", "feature work");
    let feature = head(&repo);
    repo.checkout("main");
    repo.commit_file("h.txt", "h\n", "main work");
    repo.checkout("feature");

    record(&repo, UndoKind::Rebase, |r| {
        r.git(&["rebase", "-q", "main"]);
    })
    .await;
    assert_ne!(head(&repo), feature);
    git().undo(repo.path()).await.unwrap();
    assert_eq!(head(&repo), feature);
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature");
    assert!(!repo.path().join("h.txt").exists());
}

#[tokio::test]
async fn redo_a_hard_reset_after_undoing_it() {
    let repo = base();
    repo.write("f.txt", "work in progress\n");
    record(&repo, UndoKind::Reset, |r| {
        r.git(&["reset", "-q", "--hard", "HEAD~1"]);
    })
    .await;
    let first = head(&repo);
    git().undo(repo.path()).await.unwrap();
    assert_eq!(repo.read("f.txt"), "work in progress\n");

    git().redo(repo.path()).await.unwrap();
    assert_eq!(head(&repo), first);
    assert_eq!(repo.read("f.txt"), "one\n");
    // And back again: the work is never lost.
    git().undo(repo.path()).await.unwrap();
    assert_eq!(repo.read("f.txt"), "work in progress\n");
}
