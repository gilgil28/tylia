//! Branches, checkout, tags and stashes on temp repositories (Phase 4).

use crate::common::TestRepo;
use tokio::sync::oneshot;
use tylia_git::{
    CheckoutOutcome, CheckoutRequest, CheckoutTarget, Git, GitError, OpContext, PushRejection,
    StashOutcome, StashRequest,
};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// Awaits `call` with `ctx` bound to a context that is never cancelled.
macro_rules! op {
    ($ctx:ident => $call:expr) => {{
        let (_tx, rx) = oneshot::channel();
        let mut record = |_: tylia_git::Progress| {};
        let $ctx = OpContext::new(rx, &mut record);
        $call.await
    }};
}

fn assert_invalid<T: std::fmt::Debug>(result: Result<T, GitError>) {
    assert!(
        matches!(result, Err(GitError::InvalidInput(_))),
        "expected InvalidInput, got {result:?}"
    );
}

fn to_branch(name: &str, stash: bool) -> CheckoutRequest {
    CheckoutRequest {
        target: CheckoutTarget::Branch { name: name.into() },
        stash,
    }
}

fn current(repo: &TestRepo) -> String {
    repo.git(&["branch", "--show-current"])
}

const FIVE: &str = "1\n2\n3\n4\n5\n";

/// `main` and `feature` differ in the first line of `f.txt`; `main` is checked out.
fn diverged_on_f() -> TestRepo {
    let mut repo = TestRepo::new();
    repo.commit_file("f.txt", FIVE, "base");
    repo.branch("feature");
    repo.commit_file("f.txt", "one\n2\n3\n4\n5\n", "feature edit");
    repo.checkout("main");
    repo
}

#[tokio::test]
async fn create_branch_from_oid_and_tag() {
    let mut repo = TestRepo::new();
    let first = repo.commit("one");
    repo.commit("two");
    repo.git(&["tag", "v1", &first]);

    git()
        .create_branch(repo.path(), "from-oid", &first, false)
        .await
        .unwrap();
    assert_eq!(repo.git(&["rev-parse", "from-oid"]), first);
    assert_eq!(current(&repo), "main");

    git()
        .create_branch(repo.path(), "feature/from-tag", "v1", true)
        .await
        .unwrap();
    assert_eq!(current(&repo), "feature/from-tag");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    // Started from a commit, not a remote branch: no upstream.
    assert!(!repo.git_ok(&["config", "branch.feature/from-tag.merge"]));

    assert_invalid(
        git()
            .create_branch(repo.path(), "from-oid", "main", false)
            .await,
    );
    for bad in ["-x", "a..b", "@{-1}", "a b", "HEAD"] {
        assert_invalid(git().create_branch(repo.path(), bad, "main", false).await);
    }
    for bad in ["nope", "--all", "-q", ""] {
        assert_invalid(git().create_branch(repo.path(), "ok", bad, false).await);
    }
}

#[tokio::test]
async fn checkout_carries_non_conflicting_changes() {
    let mut repo = TestRepo::new();
    repo.commit_file("shared.txt", "shared\n", "base");
    repo.branch("feature");
    repo.commit("feature work");
    repo.checkout("main");
    repo.write("shared.txt", "edited\n");
    repo.write("new.txt", "untracked\n");

    let outcome = git()
        .checkout(repo.path(), &to_branch("feature", false))
        .await
        .unwrap();
    assert_eq!(outcome, CheckoutOutcome::Done);
    assert_eq!(current(&repo), "feature");
    assert_eq!(repo.read("shared.txt"), "edited\n");
    assert_eq!(repo.read("new.txt"), "untracked\n");

    // Already there: nothing to do.
    let outcome = git()
        .checkout(repo.path(), &to_branch("feature", true))
        .await
        .unwrap();
    assert_eq!(outcome, CheckoutOutcome::Done);
    assert_eq!(repo.git(&["stash", "list"]), "");
}

#[tokio::test]
async fn checkout_refused_lists_local_changes() {
    let repo = diverged_on_f();
    repo.write("f.txt", "1\n2\n3\n4\nfive\n");
    let err = git()
        .checkout(repo.path(), &to_branch("feature", false))
        .await
        .unwrap_err();
    match err {
        GitError::LocalChanges { files, .. } => assert_eq!(files, ["f.txt"]),
        other => panic!("expected LocalChanges, got {other:?}"),
    }
    assert_eq!(current(&repo), "main");
    assert_eq!(repo.read("f.txt"), "1\n2\n3\n4\nfive\n");

    assert_invalid(
        git()
            .checkout(repo.path(), &to_branch("missing", false))
            .await,
    );
    assert_invalid(git().checkout(repo.path(), &to_branch("-f", false)).await);
}

#[tokio::test]
async fn checkout_with_stash_reapplies_changes() {
    let repo = diverged_on_f();
    // Conflicts with a plain switch (feature changed f.txt), but merges cleanly.
    repo.write("f.txt", "1\n2\n3\n4\nfive\n");
    repo.write("untracked.txt", "u\n");
    let outcome = git()
        .checkout(repo.path(), &to_branch("feature", true))
        .await
        .unwrap();
    assert_eq!(outcome, CheckoutOutcome::Done);
    assert_eq!(current(&repo), "feature");
    assert_eq!(repo.read("f.txt"), "one\n2\n3\n4\nfive\n");
    assert_eq!(repo.read("untracked.txt"), "u\n");
    assert_eq!(repo.git(&["stash", "list"]), "");

    // Nothing to stash: a plain switch.
    repo.git(&["stash", "-u", "-q"]);
    let outcome = git()
        .checkout(repo.path(), &to_branch("main", true))
        .await
        .unwrap();
    assert_eq!(outcome, CheckoutOutcome::Done);
    assert_eq!(repo.git(&["stash", "list"]).lines().count(), 1);
}

#[tokio::test]
async fn checkout_with_stash_reports_conflicts_and_keeps_the_stash() {
    let repo = diverged_on_f();
    repo.write("f.txt", "uno\n2\n3\n4\n5\n");
    let outcome = git()
        .checkout(repo.path(), &to_branch("feature", true))
        .await
        .unwrap();
    assert_eq!(outcome, CheckoutOutcome::StashConflicts);
    assert_eq!(current(&repo), "feature");
    assert_eq!(repo.git(&["stash", "list"]).lines().count(), 1);
    let status = git().status(repo.path()).await.unwrap();
    assert!(
        status
            .entries
            .iter()
            .any(|e| e.path == "f.txt" && e.conflicted)
    );
    // Not a merge / rebase: nothing to continue or abort.
    assert_eq!(status.operation, None);
}

#[tokio::test]
async fn checkout_with_stash_restores_changes_when_switching_fails() {
    let mut repo = TestRepo::new();
    repo.commit("base");
    repo.git(&["branch", "feature"]);
    // Git refuses to switch to a branch checked out in another worktree.
    let other = tempfile::tempdir().unwrap();
    let wt = other.path().join("wt");
    repo.git(&[
        "worktree",
        "add",
        "-q",
        &wt.display().to_string(),
        "feature",
    ]);
    repo.write("base.txt", "edited\n");
    repo.write("new.txt", "untracked\n");
    let result = git()
        .checkout(repo.path(), &to_branch("feature", true))
        .await;
    assert!(result.is_err(), "{result:?}");
    assert_eq!(current(&repo), "main");
    assert_eq!(repo.read("base.txt"), "edited\n");
    assert_eq!(repo.read("new.txt"), "untracked\n");
    assert_eq!(repo.git(&["stash", "list"]), "");
}

#[tokio::test]
async fn checkout_remote_branch_as_tracking_branch() {
    let remote = TestRepo::bare();
    let mut a = TestRepo::clone_of(&remote);
    a.commit("one");
    a.branch("feature/x");
    a.commit("two");
    a.git(&["push", "-q", "origin", "main", "feature/x"]);
    let b = TestRepo::clone_of(&remote);

    let req = CheckoutRequest {
        target: CheckoutTarget::Remote {
            remote_branch: "origin/feature/x".into(),
            local_name: "x".into(),
        },
        stash: false,
    };
    assert_eq!(
        git().checkout(b.path(), &req).await.unwrap(),
        CheckoutOutcome::Done
    );
    assert_eq!(current(&b), "x");
    assert_eq!(b.git(&["config", "branch.x.remote"]), "origin");
    assert_eq!(b.git(&["config", "branch.x.merge"]), "refs/heads/feature/x");

    // The local name is taken now; and a missing remote branch is refused.
    assert_invalid(git().checkout(b.path(), &req).await);
    let missing = CheckoutRequest {
        target: CheckoutTarget::Remote {
            remote_branch: "origin/nope".into(),
            local_name: "nope".into(),
        },
        stash: false,
    };
    assert_invalid(git().checkout(b.path(), &missing).await);
}

#[tokio::test]
async fn checkout_detached() {
    let mut repo = TestRepo::new();
    let first = repo.commit("one");
    repo.commit("two");
    let req = CheckoutRequest {
        target: CheckoutTarget::Detached { oid: first.clone() },
        stash: false,
    };
    assert_eq!(
        git().checkout(repo.path(), &req).await.unwrap(),
        CheckoutOutcome::Done
    );
    assert_eq!(git().current_branch(repo.path()).await.unwrap(), None);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);

    let bad = CheckoutRequest {
        target: CheckoutTarget::Detached {
            oid: "--orphan".into(),
        },
        stash: false,
    };
    assert_invalid(git().checkout(repo.path(), &bad).await);
}

#[tokio::test]
async fn rename_current_branch() {
    let mut repo = TestRepo::new();
    repo.commit("one");
    repo.git(&["branch", "other"]);
    git()
        .rename_branch(repo.path(), "main", "trunk")
        .await
        .unwrap();
    assert_eq!(current(&repo), "trunk");
    assert_invalid(git().rename_branch(repo.path(), "trunk", "other").await);
    assert_invalid(git().rename_branch(repo.path(), "missing", "new").await);
    assert_invalid(git().rename_branch(repo.path(), "trunk", "bad name").await);
}

#[tokio::test]
async fn delete_branches() {
    let mut repo = TestRepo::new();
    repo.commit("one");
    repo.git(&["branch", "merged"]);
    repo.branch("unmerged");
    repo.commit("only here");
    repo.checkout("main");

    git()
        .delete_branch(repo.path(), "merged", false)
        .await
        .unwrap();
    assert!(!repo.git_ok(&["rev-parse", "--verify", "-q", "refs/heads/merged"]));

    let err = git()
        .delete_branch(repo.path(), "unmerged", false)
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::NotFullyMerged { .. }), "{err:?}");
    git()
        .delete_branch(repo.path(), "unmerged", true)
        .await
        .unwrap();
    assert!(!repo.git_ok(&["rev-parse", "--verify", "-q", "refs/heads/unmerged"]));

    assert_invalid(git().delete_branch(repo.path(), "main", true).await);
    assert_invalid(git().delete_branch(repo.path(), "-D", true).await);
}

#[tokio::test]
async fn delete_remote_branch_and_push_tags() {
    let remote = TestRepo::bare();
    let mut a = TestRepo::clone_of(&remote);
    let first = a.commit("one");
    a.git(&["branch", "feature"]);
    a.git(&["push", "-q", "origin", "main", "feature"]);
    a.git(&["fetch", "-q"]);

    op!(ctx => git().delete_remote_branch(a.path(), "origin", "feature", ctx)).unwrap();
    assert!(!remote.git_ok(&["rev-parse", "--verify", "-q", "refs/heads/feature"]));
    assert!(!a.git_ok(&["rev-parse", "--verify", "-q", "refs/remotes/origin/feature"]));

    // Already gone from the remote: the stale remote-tracking branch is removed.
    a.git(&["update-ref", "refs/remotes/origin/stale", &first]);
    op!(ctx => git().delete_remote_branch(a.path(), "origin", "stale", ctx)).unwrap();
    assert!(!a.git_ok(&["rev-parse", "--verify", "-q", "refs/remotes/origin/stale"]));

    let bad = op!(ctx => git().delete_remote_branch(a.path(), "-origin", "x", ctx));
    assert!(matches!(bad, Err(GitError::InvalidInput(_))));

    // Tags.
    git()
        .create_tag(a.path(), "v1", "main", Some("First release"))
        .await
        .unwrap();
    op!(ctx => git().push_tag(a.path(), "origin", "v1", ctx)).unwrap();
    assert_eq!(remote.git(&["cat-file", "-t", "refs/tags/v1"]), "tag");

    let missing = op!(ctx => git().push_tag(a.path(), "origin", "nope", ctx));
    assert!(matches!(missing, Err(GitError::InvalidInput(_))));

    // The remote already has a different v1: rejected.
    let second = a.commit("two");
    git().delete_tag(a.path(), "v1").await.unwrap();
    git()
        .create_tag(a.path(), "v1", &second, None)
        .await
        .unwrap();
    let rejected = op!(ctx => git().push_tag(a.path(), "origin", "v1", ctx));
    assert!(
        matches!(
            rejected,
            Err(GitError::PushRejected {
                reason: PushRejection::Other | PushRejection::Behind,
                ..
            })
        ),
        "{rejected:?}"
    );
}

#[tokio::test]
async fn set_and_unset_upstream() {
    let remote = TestRepo::bare();
    let mut a = TestRepo::clone_of(&remote);
    a.commit("one");
    a.git(&["push", "-q", "origin", "main"]);
    a.git(&["branch", "topic"]);

    git()
        .set_upstream(a.path(), "topic", Some("origin/main"))
        .await
        .unwrap();
    assert_eq!(a.git(&["config", "branch.topic.remote"]), "origin");
    assert_eq!(a.git(&["config", "branch.topic.merge"]), "refs/heads/main");

    git().set_upstream(a.path(), "topic", None).await.unwrap();
    assert!(!a.git_ok(&["config", "branch.topic.merge"]));
    // Already without one: fine.
    git().set_upstream(a.path(), "topic", None).await.unwrap();

    assert_invalid(
        git()
            .set_upstream(a.path(), "topic", Some("origin/nope"))
            .await,
    );
    assert_invalid(git().set_upstream(a.path(), "topic", Some("-x")).await);
}

#[tokio::test]
async fn annotated_lightweight_and_duplicate_tags() {
    let mut repo = TestRepo::new();
    let first = repo.commit("one");
    repo.commit("two");

    git()
        .create_tag(
            repo.path(),
            "v1.0",
            &first,
            Some("Release 1\n\n# not a comment"),
        )
        .await
        .unwrap();
    assert_eq!(repo.git(&["cat-file", "-t", "v1.0"]), "tag");
    assert_eq!(repo.git(&["rev-parse", "v1.0^{commit}"]), first);
    assert!(
        repo.git(&["tag", "-l", "--format=%(contents)", "v1.0"])
            .starts_with("Release 1")
    );

    git()
        .create_tag(repo.path(), "light", "HEAD", None)
        .await
        .unwrap();
    assert_eq!(repo.git(&["cat-file", "-t", "light"]), "commit");
    git()
        .create_tag(repo.path(), "blank", "HEAD", Some("  \n"))
        .await
        .unwrap();
    assert_eq!(repo.git(&["cat-file", "-t", "blank"]), "commit");

    assert_invalid(git().create_tag(repo.path(), "v1.0", "HEAD", None).await);
    for bad in ["-x", "a b", "a..b", "x.lock", ""] {
        assert_invalid(git().create_tag(repo.path(), bad, "HEAD", None).await);
    }
    assert_invalid(git().create_tag(repo.path(), "ok", "--all", None).await);

    git().delete_tag(repo.path(), "v1.0").await.unwrap();
    assert!(!repo.git_ok(&["rev-parse", "--verify", "-q", "refs/tags/v1.0"]));
    assert!(git().delete_tag(repo.path(), "v1.0").await.is_err());
}

fn stash_req(message: Option<&str>, include_untracked: bool, keep_index: bool) -> StashRequest {
    StashRequest {
        message: message.map(str::to_owned),
        include_untracked,
        keep_index,
    }
}

#[tokio::test]
async fn stash_save_variants() {
    let mut repo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "base");
    repo.commit_file("b.txt", "b\n", "more");

    assert!(
        !git()
            .stash_save(repo.path(), &stash_req(None, true, false))
            .await
            .unwrap()
    );

    // Untracked files only: nothing to stash unless included.
    repo.write("u.txt", "u\n");
    assert!(
        !git()
            .stash_save(repo.path(), &stash_req(None, false, false))
            .await
            .unwrap()
    );
    assert!(
        git()
            .stash_save(repo.path(), &stash_req(Some("with untracked"), true, false))
            .await
            .unwrap()
    );
    assert!(!repo.path().join("u.txt").exists());
    assert!(repo.git(&["stash", "list"]).contains("with untracked"));

    // Keep index: the staged change stays staged, the unstaged one is stashed away.
    repo.write("a.txt", "a staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("b.txt", "b unstaged\n");
    assert!(
        git()
            .stash_save(repo.path(), &stash_req(None, false, true))
            .await
            .unwrap()
    );
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "a.txt");
    assert_eq!(repo.read("b.txt"), "b\n");
    assert_eq!(repo.git(&["stash", "list"]).lines().count(), 2);
}

#[tokio::test]
async fn stash_apply_pop_and_drop() {
    let mut repo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "base");
    repo.write("a.txt", "a staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "a staged and more\n");
    repo.git(&["stash", "push", "-q"]);

    // Apply restores the index too and keeps the stash.
    assert_eq!(
        git().stash_apply(repo.path(), 0, false).await.unwrap(),
        StashOutcome::Applied
    );
    assert_eq!(repo.read("a.txt"), "a staged and more\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "a staged");
    assert_eq!(repo.git(&["stash", "list"]).lines().count(), 1);

    repo.git(&["reset", "-q", "--hard"]);
    assert_eq!(
        git().stash_apply(repo.path(), 0, true).await.unwrap(),
        StashOutcome::Applied
    );
    assert_eq!(repo.git(&["stash", "list"]), "");

    repo.git(&["stash", "push", "-q"]);
    repo.write("a.txt", "second\n");
    repo.git(&["stash", "push", "-q"]);
    git().stash_drop(repo.path(), 1).await.unwrap();
    assert_eq!(repo.git(&["stash", "list"]).lines().count(), 1);
    assert_invalid(git().stash_drop(repo.path(), 5).await);
    assert_invalid(git().stash_apply(repo.path(), 5, false).await);
}

#[tokio::test]
async fn stash_apply_falls_back_without_index() {
    let mut repo = TestRepo::new();
    repo.commit_file("f.txt", FIVE, "base");
    repo.write("f.txt", "one\n2\n3\n4\n5\n");
    repo.git(&["add", "f.txt"]);
    repo.git(&["stash", "push", "-q"]);
    // A nearby committed change: the staged patch no longer applies to the index, but the
    // three-way merge of the working tree is clean.
    repo.commit_file("f.txt", "1\n2\nthree\n4\n5\n", "nearby");
    assert_eq!(
        git().stash_apply(repo.path(), 0, true).await.unwrap(),
        StashOutcome::Applied
    );
    assert_eq!(repo.read("f.txt"), "one\n2\nthree\n4\n5\n");
    assert_eq!(repo.git(&["stash", "list"]), "");
}

#[tokio::test]
async fn stash_pop_with_conflicts_keeps_the_stash() {
    let mut repo = TestRepo::new();
    repo.commit_file("f.txt", FIVE, "base");
    repo.write("f.txt", "stashed\n2\n3\n4\n5\n");
    repo.git(&["stash", "push", "-q"]);
    repo.commit_file("f.txt", "committed\n2\n3\n4\n5\n", "conflicting");
    assert_eq!(
        git().stash_apply(repo.path(), 0, true).await.unwrap(),
        StashOutcome::Conflicts
    );
    assert_eq!(repo.git(&["stash", "list"]).lines().count(), 1);
    assert!(git().has_conflicts(repo.path()).await.unwrap());
    // With conflicts in the index, another apply is refused up front.
    assert_invalid(git().stash_apply(repo.path(), 0, false).await);
}

#[tokio::test]
async fn stash_apply_refused_by_local_changes() {
    let mut repo = TestRepo::new();
    repo.commit_file("f.txt", FIVE, "base");
    repo.write("f.txt", "stashed\n2\n3\n4\n5\n");
    repo.git(&["stash", "push", "-q"]);
    repo.write("f.txt", "local\n2\n3\n4\n5\n");
    let err = git().stash_apply(repo.path(), 0, false).await.unwrap_err();
    match err {
        GitError::LocalChanges { files, .. } => assert_eq!(files, ["f.txt"]),
        other => panic!("expected LocalChanges, got {other:?}"),
    }
    assert_eq!(repo.read("f.txt"), "local\n2\n3\n4\n5\n");
}
