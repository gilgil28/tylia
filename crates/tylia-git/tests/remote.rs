//! Fetch, pull, push and remote management against local bare repositories.

mod common;

use common::TestRepo;
use tokio::sync::oneshot;
use tylia_git::{
    FetchRequest, Git, GitError, OpContext, PullMode, PullOutcome, PushOutcome, PushRejection,
    PushRequest,
};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// Awaits `call` with `ctx` bound to a context that is never cancelled; returns the result
/// and the progress phases reported.
macro_rules! op {
    ($ctx:ident => $call:expr) => {{
        let (_tx, rx) = oneshot::channel();
        let mut phases = Vec::<String>::new();
        let result = {
            let mut record = |p: tylia_git::Progress| phases.push(p.phase);
            let $ctx = OpContext::new(rx, &mut record);
            $call.await
        };
        (result, phases)
    }};
}

fn push_main(set_upstream: bool) -> PushRequest {
    PushRequest {
        remote: "origin".into(),
        branch: "main".into(),
        remote_branch: "main".into(),
        set_upstream,
        tags: false,
        force_lease: None,
    }
}

fn fetch_all() -> FetchRequest {
    FetchRequest {
        remote: None,
        prune: true,
    }
}

/// A bare remote and a clone of it with one pushed commit.
async fn remote_with_commit() -> (TestRepo, TestRepo) {
    let remote = TestRepo::bare();
    let mut a = TestRepo::clone_of(&remote);
    a.commit("one");
    let (result, _) = op!(ctx => git().push(a.path(), &push_main(true), ctx));
    assert_eq!(result.unwrap(), PushOutcome::Pushed);
    (remote, a)
}

#[tokio::test]
async fn push_sets_upstream_then_reports_up_to_date() {
    let (remote, a) = remote_with_commit().await;
    assert_eq!(
        remote.git(&["rev-parse", "main"]),
        a.git(&["rev-parse", "HEAD"])
    );
    let refs = git().refs(a.path()).await.unwrap();
    let main = &refs.branches[0];
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
    assert_eq!(main.upstream_remote.as_deref(), Some("origin"));
    assert_eq!(main.upstream_branch.as_deref(), Some("main"));

    let (result, _) = op!(ctx => git().push(a.path(), &push_main(false), ctx));
    assert_eq!(result.unwrap(), PushOutcome::UpToDate);
}

#[tokio::test]
async fn push_tags_and_to_a_differently_named_branch() {
    let (remote, a) = remote_with_commit().await;
    a.git(&["tag", "v1"]);
    let req = PushRequest {
        remote_branch: "release".into(),
        tags: true,
        ..push_main(false)
    };
    let (result, _) = op!(ctx => git().push(a.path(), &req, ctx));
    assert_eq!(result.unwrap(), PushOutcome::Pushed);
    assert_eq!(remote.git(&["tag"]), "v1");
    assert_eq!(
        remote.git(&["rev-parse", "release"]),
        remote.git(&["rev-parse", "main"])
    );
}

#[tokio::test]
async fn fetch_then_pull_fast_forward() {
    let (remote, mut a) = remote_with_commit().await;
    let b = TestRepo::clone_of(&remote);
    a.commit("two");
    op!(ctx => git().push(a.path(), &push_main(false), ctx))
        .0
        .unwrap();

    let (result, phases) = op!(ctx => git().fetch(b.path(), &fetch_all(), ctx));
    result.unwrap();
    assert!(!phases.is_empty(), "progress reported");
    let refs = git().refs(b.path()).await.unwrap();
    assert_eq!((refs.branches[0].ahead, refs.branches[0].behind), (0, 1));

    let (result, _) = op!(ctx => git().pull(b.path(), PullMode::FfOnly, ctx));
    assert_eq!(result.unwrap(), PullOutcome::Updated);
    assert_eq!(b.git(&["rev-parse", "HEAD"]), a.git(&["rev-parse", "HEAD"]));
    let (result, _) = op!(ctx => git().pull(b.path(), PullMode::FfOnly, ctx));
    assert_eq!(result.unwrap(), PullOutcome::UpToDate);
}

#[tokio::test]
async fn pull_rebase_and_merge_on_diverged_branches() {
    let (remote, mut a) = remote_with_commit().await;
    let mut b = TestRepo::clone_of(&remote);
    let mut c = TestRepo::clone_of(&remote);
    a.commit("from a");
    op!(ctx => git().push(a.path(), &push_main(false), ctx))
        .0
        .unwrap();

    b.commit("from b");
    let (result, _) = op!(ctx => git().pull(b.path(), PullMode::Rebase, ctx));
    assert_eq!(result.unwrap(), PullOutcome::Updated);
    assert_eq!(b.git(&["rev-list", "--merges", "--count", "HEAD"]), "0");
    assert_eq!(
        b.git(&["rev-parse", "HEAD~1"]),
        a.git(&["rev-parse", "HEAD"])
    );

    c.commit("from c");
    let (result, _) = op!(ctx => git().pull(c.path(), PullMode::FfOnly, ctx));
    assert!(matches!(result, Err(GitError::Failed { .. })), "{result:?}");
    let (result, _) = op!(ctx => git().pull(c.path(), PullMode::Merge, ctx));
    assert_eq!(result.unwrap(), PullOutcome::Updated);
    assert_eq!(c.git(&["rev-list", "--merges", "--count", "HEAD"]), "1");
}

#[tokio::test]
async fn pull_reports_conflicts() {
    let (remote, a) = remote_with_commit().await;
    let b = TestRepo::clone_of(&remote);
    for (repo, text) in [(&a, "a\n"), (&b, "b\n")] {
        repo.write("same.txt", text);
        repo.git(&["add", "same.txt"]);
        repo.git(&["commit", "-q", "-m", text.trim()]);
    }
    op!(ctx => git().push(a.path(), &push_main(false), ctx))
        .0
        .unwrap();
    let (result, _) = op!(ctx => git().pull(b.path(), PullMode::Merge, ctx));
    assert_eq!(result.unwrap(), PullOutcome::Conflicts);
    assert!(git().has_conflicts(b.path()).await.unwrap());
}

#[tokio::test]
async fn pull_without_upstream_is_refused_clearly() {
    let (_remote, a) = remote_with_commit().await;
    a.branch("local-only");
    let (result, _) = op!(ctx => git().pull(a.path(), PullMode::Merge, ctx));
    match result {
        Err(GitError::InvalidInput(msg)) => assert!(msg.contains("local-only"), "{msg}"),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn push_rejections_and_force_with_lease() {
    let (remote, mut a) = remote_with_commit().await;
    let mut b = TestRepo::clone_of(&remote);
    let seen_by_b = b.git(&["rev-parse", "origin/main"]);
    a.commit("from a");
    op!(ctx => git().push(a.path(), &push_main(false), ctx))
        .0
        .unwrap();
    b.commit("from b");

    let (result, _) = op!(ctx => git().push(b.path(), &push_main(false), ctx));
    match result {
        Err(GitError::PushRejected { reason, .. }) => assert_eq!(reason, PushRejection::Behind),
        other => panic!("{other:?}"),
    }

    // The lease names what b last saw; after a fetch, origin/main moved, so b can't claim
    // the old commit any more without the lease failing.
    op!(ctx => git().fetch(b.path(), &fetch_all(), ctx))
        .0
        .unwrap();
    let stale = PushRequest {
        force_lease: Some(seen_by_b),
        ..push_main(false)
    };
    let (result, _) = op!(ctx => git().push(b.path(), &stale, ctx));
    match result {
        Err(GitError::PushRejected { reason, .. }) => assert_eq!(reason, PushRejection::Stale),
        other => panic!("{other:?}"),
    }

    let current = PushRequest {
        force_lease: Some(b.git(&["rev-parse", "origin/main"])),
        ..push_main(false)
    };
    let (result, _) = op!(ctx => git().push(b.path(), &current, ctx));
    assert_eq!(result.unwrap(), PushOutcome::Pushed);
    assert_eq!(
        remote.git(&["rev-parse", "main"]),
        b.git(&["rev-parse", "HEAD"])
    );

    let bad = PushRequest {
        force_lease: Some("--upload-pack=x".into()),
        ..push_main(false)
    };
    let (result, _) = op!(ctx => git().push(b.path(), &bad, ctx));
    assert!(
        matches!(result, Err(GitError::InvalidInput(_))),
        "{result:?}"
    );
}

#[tokio::test]
async fn fetch_prunes_deleted_branches_from_every_remote() {
    let (remote, a) = remote_with_commit().await;
    let other = TestRepo::bare();
    let b = TestRepo::clone_of(&remote);
    a.git(&["push", "-q", "origin", "main:gone-soon"]);
    b.git(&[
        "remote",
        "add",
        "second",
        &other.path().display().to_string(),
    ]);
    a.git(&[
        "push",
        "-q",
        &other.path().display().to_string(),
        "main:elsewhere",
    ]);
    op!(ctx => git().fetch(b.path(), &fetch_all(), ctx))
        .0
        .unwrap();
    let names = |refs: &tylia_git::RefsSnapshot| {
        refs.remotes
            .iter()
            .flat_map(|r| r.branches.iter().map(|b| b.full_name.clone()))
            .collect::<Vec<_>>()
    };
    let refs = git().refs(b.path()).await.unwrap();
    assert!(names(&refs).contains(&"origin/gone-soon".to_owned()));
    assert!(names(&refs).contains(&"second/elsewhere".to_owned()));

    a.git(&["push", "-q", "origin", "--delete", "gone-soon"]);
    let only_origin = FetchRequest {
        remote: Some("origin".into()),
        prune: true,
    };
    op!(ctx => git().fetch(b.path(), &only_origin, ctx))
        .0
        .unwrap();
    let refs = git().refs(b.path()).await.unwrap();
    assert!(!names(&refs).contains(&"origin/gone-soon".to_owned()));
}

#[tokio::test]
async fn cancelled_fetch() {
    let (remote, _a) = remote_with_commit().await;
    let b = TestRepo::clone_of(&remote);
    let (tx, rx) = oneshot::channel();
    tx.send(()).unwrap();
    let err = git()
        .fetch(b.path(), &fetch_all(), OpContext::new(rx, &mut |_| {}))
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::Cancelled { .. }), "{err:?}");
}

#[tokio::test]
async fn manages_remotes() {
    let repo = TestRepo::new();
    let g = git();
    g.add_remote(repo.path(), "origin", "https://example.com/a.git")
        .await
        .unwrap();
    g.set_remote_url(repo.path(), "origin", "git@example.com:a.git", true)
        .await
        .unwrap();
    let refs = g.refs(repo.path()).await.unwrap();
    assert_eq!(
        refs.remotes[0].url.as_deref(),
        Some("https://example.com/a.git")
    );
    assert_eq!(
        refs.remotes[0].push_url.as_deref(),
        Some("git@example.com:a.git")
    );

    g.set_remote_url(repo.path(), "origin", "", true)
        .await
        .unwrap();
    g.set_remote_url(repo.path(), "origin", "https://example.com/b.git", false)
        .await
        .unwrap();
    g.rename_remote(repo.path(), "origin", "upstream")
        .await
        .unwrap();
    let refs = g.refs(repo.path()).await.unwrap();
    assert_eq!(refs.remotes.len(), 1);
    assert_eq!(refs.remotes[0].name, "upstream");
    assert_eq!(
        refs.remotes[0].url.as_deref(),
        Some("https://example.com/b.git")
    );
    assert_eq!(refs.remotes[0].push_url, None);

    assert!(matches!(
        g.add_remote(repo.path(), "-x", "u").await,
        Err(GitError::InvalidInput(_))
    ));
    assert!(matches!(
        g.add_remote(repo.path(), "x", "--upload-pack=y").await,
        Err(GitError::InvalidInput(_))
    ));
    assert!(matches!(
        g.add_remote(repo.path(), "upstream", "https://example.com/c.git")
            .await,
        Err(GitError::Failed { .. })
    ));
    g.remove_remote(repo.path(), "upstream").await.unwrap();
    assert!(g.refs(repo.path()).await.unwrap().remotes.is_empty());
}
