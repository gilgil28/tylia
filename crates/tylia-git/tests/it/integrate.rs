//! Merge, rebase, cherry-pick, revert, reset, conflict resolution and the operation-in-progress
//! state on temp repositories (Phase 4).

use crate::common::TestRepo;
use tylia_git::{
    ConflictSide, DiffContent, DiffRequest, DiffTarget, FastForward, Git, GitError,
    IntegrateOutcome, LineAction, LinesRequest, OperationKind, RepoOperation, ResetMode,
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

const FIVE: &str = "1\n2\n3\n4\n5\n";

/// A repository whose configured editor fails: any operation that opened an editor would
/// fail, so passing tests prove none was opened.
fn repo() -> TestRepo {
    let repo = TestRepo::new();
    repo.git(&["config", "core.editor", "false"]);
    repo.git(&["config", "sequence.editor", "false"]);
    repo
}

/// `main` and `feature` both change the first line of `f.txt`; `main` is checked out.
fn conflicting() -> TestRepo {
    let mut repo = repo();
    repo.commit_file("f.txt", FIVE, "base");
    repo.branch("feature");
    repo.commit_file("f.txt", "feature\n2\n3\n4\n5\n", "feature edit");
    repo.checkout("main");
    repo.commit_file("f.txt", "main\n2\n3\n4\n5\n", "main edit");
    repo
}

async fn operation(repo: &TestRepo) -> Option<RepoOperation> {
    git().status(repo.path()).await.unwrap().operation
}

fn head(repo: &TestRepo) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

fn parents(repo: &TestRepo, rev: &str) -> usize {
    repo.git(&["rev-list", "--parents", "-n", "1", rev])
        .split_whitespace()
        .count()
        - 1
}

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|p| (*p).to_owned()).collect()
}

#[tokio::test]
async fn merge_fast_forward_and_up_to_date() {
    let mut repo = repo();
    repo.commit("one");
    repo.branch("feature");
    let tip = repo.commit("two");
    repo.checkout("main");

    let outcome = git()
        .merge(repo.path(), "feature", FastForward::Allow)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::FastForward);
    assert_eq!(head(&repo), tip);
    let outcome = git()
        .merge(repo.path(), "feature", FastForward::Allow)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::UpToDate);
    assert_invalid(git().merge(repo.path(), "nope", FastForward::Allow).await);
    assert_invalid(
        git()
            .merge(repo.path(), "--abort", FastForward::Allow)
            .await,
    );
}

#[tokio::test]
async fn merge_no_ff_creates_a_merge_commit() {
    let mut repo = repo();
    repo.commit("one");
    repo.branch("feature");
    repo.commit("two");
    repo.checkout("main");
    let outcome = git()
        .merge(repo.path(), "feature", FastForward::Never)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(parents(&repo, "HEAD"), 2);
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s"]),
        "Merge branch 'feature'"
    );
}

#[tokio::test]
async fn merge_ff_only_refuses_diverged_branches() {
    let mut repo = repo();
    repo.commit("one");
    repo.branch("feature");
    repo.commit("two");
    repo.checkout("main");
    let before = repo.commit("three");
    let err = git()
        .merge(repo.path(), "feature", FastForward::Only)
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::Failed { .. }), "{err:?}");
    assert_eq!(head(&repo), before);
    assert_eq!(operation(&repo).await, None);

    // A plain merge of diverged branches makes a merge commit.
    let outcome = git()
        .merge(repo.path(), "feature", FastForward::Allow)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
}

#[tokio::test]
async fn merge_conflicts_then_continue_without_editor() {
    let repo = conflicting();
    let outcome = git()
        .merge(repo.path(), "feature", FastForward::Allow)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Conflicts);
    let op = operation(&repo).await.unwrap();
    assert_eq!(op.kind, OperationKind::Merge);
    assert_eq!(op.incoming.as_deref(), Some("feature"));

    // The conflicted diff shows the markers; its lines can't be staged.
    let diff = git()
        .diff(
            repo.path(),
            &DiffRequest {
                target: DiffTarget::Conflicted,
                path: "f.txt".into(),
                old_path: None,
                context: 3,
                ignore_whitespace: false,
                force: false,
            },
        )
        .await
        .unwrap();
    let DiffContent::Text { hunks, .. } = &diff.content else {
        panic!("expected a text diff");
    };
    let texts: Vec<&str> = hunks
        .iter()
        .flat_map(|h| h.lines.iter().map(|l| l.text.as_str()))
        .collect();
    assert!(texts.iter().any(|t| t.starts_with("<<<<<<<")), "{texts:?}");
    assert!(texts.contains(&"======="));
    assert!(texts.iter().any(|t| t.starts_with(">>>>>>>")));
    for action in [LineAction::Stage, LineAction::Unstage, LineAction::Discard] {
        let req = LinesRequest {
            path: "f.txt".into(),
            old_path: None,
            action,
            source: DiffTarget::Conflicted,
            context: 3,
            fingerprint: diff.fingerprint.clone(),
            lines: vec![[0, 0]],
        };
        assert_invalid(git().apply_lines(repo.path(), &req).await);
    }

    // Continuing with conflicts left is refused; another merge too.
    assert_invalid(git().continue_operation(repo.path()).await);
    assert_invalid(
        git()
            .merge(repo.path(), "feature", FastForward::Allow)
            .await,
    );
    assert_invalid(git().skip_operation(repo.path()).await);

    repo.write("f.txt", "both\n2\n3\n4\n5\n");
    git()
        .mark_resolved(repo.path(), &paths(&["f.txt"]))
        .await
        .unwrap();
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(operation(&repo).await, None);
    assert_eq!(parents(&repo, "HEAD"), 2);
    let message = repo.git(&["log", "-1", "--format=%B"]);
    assert_eq!(message, "Merge branch 'feature'");
    assert_eq!(repo.read("f.txt"), "both\n2\n3\n4\n5\n");
}

#[tokio::test]
async fn merge_refused_by_local_changes() {
    let repo = conflicting();
    repo.write("f.txt", "local\n2\n3\n4\n5\n");
    let err = git()
        .merge(repo.path(), "feature", FastForward::Allow)
        .await
        .unwrap_err();
    match err {
        GitError::LocalChanges { files, .. } => assert_eq!(files, ["f.txt"]),
        other => panic!("expected LocalChanges, got {other:?}"),
    }
    assert_eq!(operation(&repo).await, None);
}

#[tokio::test]
async fn abort_merge() {
    let repo = conflicting();
    let before = head(&repo);
    git()
        .merge(repo.path(), "feature", FastForward::Never)
        .await
        .unwrap();
    git().abort_operation(repo.path()).await.unwrap();
    assert_eq!(operation(&repo).await, None);
    assert_eq!(head(&repo), before);
    assert_eq!(repo.read("f.txt"), "main\n2\n3\n4\n5\n");
    assert!(!git().has_conflicts(repo.path()).await.unwrap());
    assert_invalid(git().abort_operation(repo.path()).await);
}

#[tokio::test]
async fn rebase_clean_up_to_date_and_fast_forward() {
    let mut repo = repo();
    repo.commit("one");
    repo.branch("feature");
    repo.commit("feature work");
    repo.checkout("main");
    let main = repo.commit("main work");
    repo.checkout("feature");

    let outcome = git().rebase(repo.path(), "main").await.unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(repo.git(&["rev-parse", "HEAD~1"]), main);
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature");
    assert_eq!(
        git().rebase(repo.path(), "main").await.unwrap(),
        IntegrateOutcome::UpToDate
    );

    // main is behind feature: rebasing main onto feature fast-forwards it.
    repo.checkout("main");
    assert_eq!(
        git().rebase(repo.path(), "feature").await.unwrap(),
        IntegrateOutcome::FastForward
    );
    assert_eq!(head(&repo), repo.git(&["rev-parse", "feature"]));
}

/// `feature` has two commits that both conflict with `main`'s change to `f.txt`, and a third
/// that adds another file. `feature` is checked out.
fn rebase_conflicts() -> TestRepo {
    let mut repo = repo();
    repo.commit_file("f.txt", FIVE, "base");
    repo.branch("feature");
    repo.commit_file("f.txt", "a\n2\n3\n4\n5\n", "feature a");
    repo.commit_file("f.txt", "b\n2\n3\n4\n5\n", "feature b");
    repo.commit_file("g.txt", "g\n", "feature g");
    repo.checkout("main");
    repo.commit_file("f.txt", "main\n2\n3\n4\n5\n", "main edit");
    repo.checkout("feature");
    repo
}

#[tokio::test]
async fn rebase_conflicts_continue_to_the_next_conflict_and_finish() {
    let repo = rebase_conflicts();
    let main = repo.git(&["rev-parse", "main"]);
    assert_eq!(
        git().rebase(repo.path(), "main").await.unwrap(),
        IntegrateOutcome::Conflicts
    );
    let op = operation(&repo).await.unwrap();
    assert_eq!(op.kind, OperationKind::Rebase);
    assert_eq!(op.branch.as_deref(), Some("feature"));
    assert_eq!(op.onto.as_deref(), Some(&main[..7]));
    assert_eq!((op.step, op.total), (Some(1), Some(3)));
    assert!(op.incoming.is_some());

    // Keep feature's version of the first commit ("theirs" while rebasing).
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Theirs)
        .await
        .unwrap();
    assert_eq!(repo.read("f.txt"), "a\n2\n3\n4\n5\n");
    // The second commit (a → b) applies cleanly on top of that: only the third step is
    // left, and it doesn't conflict.
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(operation(&repo).await, None);
    let log = repo.git(&["log", "--format=%s", "main..feature"]);
    assert_eq!(log, "feature g\nfeature b\nfeature a");
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature");
}

#[tokio::test]
async fn rebase_continue_stops_at_the_next_conflict() {
    let repo = rebase_conflicts();
    git().rebase(repo.path(), "main").await.unwrap();
    // Keep main's version: then feature's a → b change conflicts again.
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Ours)
        .await
        .unwrap();
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Conflicts
    );
    let op = operation(&repo).await.unwrap();
    assert_eq!((op.step, op.total), (Some(2), Some(3)));
    repo.write("f.txt", "resolved\n2\n3\n4\n5\n");
    git()
        .mark_resolved(repo.path(), &paths(&["f.txt"]))
        .await
        .unwrap();
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    // The first commit became empty and was dropped.
    let log = repo.git(&["log", "--format=%s", "main..feature"]);
    assert_eq!(log, "feature g\nfeature b");
    assert_eq!(repo.read("f.txt"), "resolved\n2\n3\n4\n5\n");
}

#[tokio::test]
async fn rebase_skip_and_abort() {
    let repo = rebase_conflicts();
    let original = head(&repo);
    git().rebase(repo.path(), "main").await.unwrap();
    // Skipping "feature a" makes "feature b" conflict next.
    assert_eq!(
        git().skip_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Conflicts
    );
    assert_eq!(operation(&repo).await.unwrap().step, Some(2));
    git().abort_operation(repo.path()).await.unwrap();
    assert_eq!(operation(&repo).await, None);
    assert_eq!(head(&repo), original);
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature");

    git().rebase(repo.path(), "main").await.unwrap();
    git().skip_operation(repo.path()).await.unwrap();
    assert_eq!(
        git().skip_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    let log = repo.git(&["log", "--format=%s", "main..feature"]);
    assert_eq!(log, "feature g");
}

#[tokio::test]
async fn rebase_refused_by_local_changes() {
    let repo = rebase_conflicts();
    repo.write("g.txt", "dirty\n");
    let err = git().rebase(repo.path(), "main").await.unwrap_err();
    match err {
        GitError::LocalChanges { files, .. } => assert_eq!(files, ["g.txt"]),
        other => panic!("expected LocalChanges, got {other:?}"),
    }
    assert_eq!(operation(&repo).await, None);
}

#[tokio::test]
async fn cherry_pick_clean_and_empty() {
    let mut repo = repo();
    repo.commit("one");
    repo.branch("feature");
    let pick = repo.commit_file("new.txt", "new\n", "add new file");
    repo.checkout("main");
    repo.commit("main work");

    assert_eq!(
        git().cherry_pick(repo.path(), &pick).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "add new file");
    assert_eq!(repo.read("new.txt"), "new\n");

    // Again: the change is already there.
    let before = head(&repo);
    assert_eq!(
        git().cherry_pick(repo.path(), &pick).await.unwrap(),
        IntegrateOutcome::UpToDate
    );
    assert_eq!(head(&repo), before);
    assert_eq!(operation(&repo).await, None);
    assert_invalid(git().cherry_pick(repo.path(), "-n").await);
}

#[tokio::test]
async fn cherry_pick_conflict_continue_and_empty_resolution() {
    let repo = conflicting();
    let pick = repo.git(&["rev-parse", "feature"]);
    assert_eq!(
        git().cherry_pick(repo.path(), &pick).await.unwrap(),
        IntegrateOutcome::Conflicts
    );
    let op = operation(&repo).await.unwrap();
    assert_eq!(op.kind, OperationKind::CherryPick);
    assert_eq!(op.incoming.as_deref(), Some(&pick[..7]));
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Theirs)
        .await
        .unwrap();
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "feature edit");
    assert_eq!(operation(&repo).await, None);

    // Resolved to what HEAD already has: the pick is dropped.
    repo.git(&["reset", "-q", "--hard", "HEAD~1"]);
    let before = head(&repo);
    git().cherry_pick(repo.path(), &pick).await.unwrap();
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Ours)
        .await
        .unwrap();
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(head(&repo), before);
    assert_eq!(operation(&repo).await, None);
}

/// A side branch with a merge commit bringing in `topic.txt`; `main` is checked out.
fn with_merge_commit() -> (TestRepo, String) {
    let mut repo = repo();
    repo.commit("one");
    repo.branch("side");
    repo.branch("topic");
    repo.commit_file("topic.txt", "topic\n", "topic work");
    repo.checkout("side");
    repo.commit("side work");
    let merge = repo.merge("topic");
    repo.checkout("main");
    (repo, merge)
}

#[tokio::test]
async fn cherry_pick_merge_commit() {
    let (repo, merge) = with_merge_commit();
    assert_eq!(
        git().cherry_pick(repo.path(), &merge).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(repo.read("topic.txt"), "topic\n");
    assert!(!repo.path().join("side_work.txt").exists());
    assert_eq!(parents(&repo, "HEAD"), 1);
}

#[tokio::test]
async fn abort_cherry_pick() {
    let repo = conflicting();
    let before = head(&repo);
    git().cherry_pick(repo.path(), "feature").await.unwrap();
    git().abort_operation(repo.path()).await.unwrap();
    assert_eq!(operation(&repo).await, None);
    assert_eq!(head(&repo), before);
    assert_eq!(repo.read("f.txt"), "main\n2\n3\n4\n5\n");
}

#[tokio::test]
async fn revert_clean_merge_commit_and_empty() {
    let mut repo = repo();
    repo.commit("one");
    let two = repo.commit("two");
    assert_eq!(
        git().revert(repo.path(), &two).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Revert \"two\"");
    assert!(!repo.path().join("two.txt").exists());
    // Reverting it again changes nothing.
    let before = head(&repo);
    assert_eq!(
        git().revert(repo.path(), &two).await.unwrap(),
        IntegrateOutcome::UpToDate
    );
    assert_eq!(head(&repo), before);
    assert_eq!(operation(&repo).await, None);

    let (repo, merge) = with_merge_commit();
    repo.git(&["merge", "-q", "side"]);
    assert!(repo.path().join("topic.txt").exists());
    assert_eq!(
        git().revert(repo.path(), &merge).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert!(!repo.path().join("topic.txt").exists());
    assert!(repo.path().join("side_work.txt").exists());
}

#[tokio::test]
async fn revert_conflict_and_abort() {
    let mut repo = repo();
    repo.commit_file("f.txt", FIVE, "base");
    let change = repo.commit_file("f.txt", "x\n2\n3\n4\n5\n", "change");
    repo.commit_file("f.txt", "y\n2\n3\n4\n5\n", "change again");
    let before = head(&repo);
    assert_eq!(
        git().revert(repo.path(), &change).await.unwrap(),
        IntegrateOutcome::Conflicts
    );
    let op = operation(&repo).await.unwrap();
    assert_eq!(op.kind, OperationKind::Revert);
    assert_eq!(op.incoming.as_deref(), Some(&change[..7]));
    git().abort_operation(repo.path()).await.unwrap();
    assert_eq!(operation(&repo).await, None);
    assert_eq!(head(&repo), before);
    assert_eq!(repo.read("f.txt"), "y\n2\n3\n4\n5\n");
}

#[tokio::test]
async fn revert_conflict_continue_keeps_message() {
    let mut repo = repo();
    repo.commit_file("f.txt", FIVE, "base");
    let change = repo.commit_file("f.txt", "x\n2\n3\n4\n5\n", "change");
    repo.commit_file("f.txt", "y\n2\n3\n4\n5\n", "change again");
    git().revert(repo.path(), &change).await.unwrap();
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Theirs)
        .await
        .unwrap();
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert_eq!(repo.read("f.txt"), FIVE);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Revert \"change\"");
}

#[tokio::test]
async fn reset_modes() {
    let mut repo = repo();
    let one = repo.commit_file("f.txt", "one\n", "one");
    repo.commit_file("f.txt", "two\n", "two");
    let two = head(&repo);

    git()
        .reset(repo.path(), &one, ResetMode::Soft)
        .await
        .unwrap();
    assert_eq!(head(&repo), one);
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "f.txt");
    assert_eq!(repo.read("f.txt"), "two\n");

    repo.git(&["reset", "-q", "--hard", &two]);
    git()
        .reset(repo.path(), &one, ResetMode::Mixed)
        .await
        .unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    assert_eq!(repo.git(&["diff", "--name-only"]), "f.txt");

    repo.git(&["reset", "-q", "--hard", &two]);
    repo.write("untracked.txt", "kept\n");
    git()
        .reset(repo.path(), &one, ResetMode::Hard)
        .await
        .unwrap();
    assert_eq!(head(&repo), one);
    assert_eq!(repo.read("f.txt"), "one\n");
    assert_eq!(
        repo.git(&["status", "--porcelain", "--untracked-files=no"]),
        ""
    );
    assert_eq!(repo.read("untracked.txt"), "kept\n");

    assert_invalid(git().reset(repo.path(), "--hard", ResetMode::Hard).await);
}

#[tokio::test]
async fn resolve_with_ours_and_theirs() {
    let repo = conflicting();
    repo.git_ok(&["merge", "feature"]);
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Ours)
        .await
        .unwrap();
    assert_eq!(repo.read("f.txt"), "main\n2\n3\n4\n5\n");
    assert!(!git().has_conflicts(repo.path()).await.unwrap());
    // Not conflicted any more.
    assert_invalid(
        git()
            .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Theirs)
            .await,
    );

    let repo = conflicting();
    repo.git_ok(&["merge", "feature"]);
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Theirs)
        .await
        .unwrap();
    assert_eq!(repo.read("f.txt"), "feature\n2\n3\n4\n5\n");
    assert!(!git().has_conflicts(repo.path()).await.unwrap());
    assert_invalid(
        git()
            .resolve_with(repo.path(), &[], ConflictSide::Ours)
            .await,
    );
}

/// `main` deletes `f.txt`, `feature` modifies it; merging `feature` conflicts.
fn delete_modify() -> TestRepo {
    let mut repo = repo();
    repo.commit_file("f.txt", FIVE, "base");
    repo.branch("feature");
    repo.commit_file("f.txt", "modified\n2\n3\n4\n5\n", "modify");
    repo.checkout("main");
    repo.git(&["rm", "-q", "f.txt"]);
    repo.git(&["commit", "-q", "-m", "delete"]);
    assert!(!repo.git_ok(&["merge", "feature"]));
    repo
}

#[tokio::test]
async fn resolve_delete_modify_conflicts() {
    // Ours deleted it: taking ours removes the file.
    let repo = delete_modify();
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Ours)
        .await
        .unwrap();
    assert!(!repo.path().join("f.txt").exists());
    assert!(!git().has_conflicts(repo.path()).await.unwrap());
    assert_eq!(
        git().continue_operation(repo.path()).await.unwrap(),
        IntegrateOutcome::Done
    );
    assert!(!repo.git_ok(&["cat-file", "-e", "HEAD:f.txt"]));

    // Theirs modified it: taking theirs keeps the modified file.
    let repo = delete_modify();
    git()
        .resolve_with(repo.path(), &paths(&["f.txt"]), ConflictSide::Theirs)
        .await
        .unwrap();
    assert_eq!(repo.read("f.txt"), "modified\n2\n3\n4\n5\n");
    assert!(!git().has_conflicts(repo.path()).await.unwrap());

    // Deleting it by hand, then marking it resolved, removes it.
    let repo = delete_modify();
    std::fs::remove_file(repo.path().join("f.txt")).unwrap();
    git()
        .mark_resolved(repo.path(), &paths(&["f.txt"]))
        .await
        .unwrap();
    assert!(!git().has_conflicts(repo.path()).await.unwrap());
    assert_eq!(repo.git(&["ls-files", "f.txt"]), "");
}

#[tokio::test]
async fn merge_tool_refused_without_a_graphical_tool() {
    let repo = conflicting();
    repo.git_ok(&["merge", "feature"]);
    // TestRepo sets merge.tool and merge.guitool to empty, overriding any global setting.
    assert_invalid(git().merge_tool(repo.path(), "f.txt").await);
    repo.git(&["config", "merge.tool", "vimdiff"]);
    assert_invalid(git().merge_tool(repo.path(), "f.txt").await);
    repo.git(&["config", "merge.guitool", "meld"]);
    // Configured, but the file isn't conflicted: refused before starting anything.
    assert_invalid(git().merge_tool(repo.path(), "other.txt").await);
}

#[tokio::test]
async fn operation_in_a_linked_worktree() {
    let repo = conflicting();
    let dir = tempfile::tempdir().unwrap();
    let wt = dir.path().join("wt");
    repo.git(&[
        "worktree",
        "add",
        "-q",
        "--detach",
        &wt.display().to_string(),
        "main",
    ]);
    assert_eq!(
        git()
            .merge(&wt, "feature", FastForward::Allow)
            .await
            .unwrap(),
        IntegrateOutcome::Conflicts
    );
    let op = git().status(&wt).await.unwrap().operation.unwrap();
    assert_eq!(op.kind, OperationKind::Merge);
    assert_eq!(op.incoming.as_deref(), Some("feature"));
    // The main working tree isn't affected.
    assert_eq!(operation(&repo).await, None);
    git().abort_operation(&wt).await.unwrap();
    assert_eq!(git().status(&wt).await.unwrap().operation, None);
}

#[tokio::test]
async fn merge_of_a_commit_reports_its_short_oid() {
    let repo = conflicting();
    let feature = repo.git(&["rev-parse", "feature"]);
    assert_eq!(
        git()
            .merge(repo.path(), &feature, FastForward::Allow)
            .await
            .unwrap(),
        IntegrateOutcome::Conflicts
    );
    let op = operation(&repo).await.unwrap();
    assert_eq!(op.incoming.as_deref(), Some(&feature[..7]));
}
