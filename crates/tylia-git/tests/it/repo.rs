use crate::common::TestRepo;
use tokio::sync::oneshot;
use tylia_git::{
    CloneRequest, DiffContent, DiffRequest, DiffTarget, FileStatus, Git, GitError, LineKind,
    LogOptions, LogScope, OpContext, SearchField,
};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// main: a — b — M(merge) — d ; feature: b — f1 — f2 (merged into M); tag v1 on a.
fn sample() -> (TestRepo, Vec<String>) {
    let mut r = TestRepo::new();
    let a = r.commit("a");
    r.git(&["tag", "-a", "v1", "-m", "release 1"]);
    let b = r.commit("b");
    r.branch("feature");
    let f1 = r.commit("f1");
    let f2 = r.commit("f2");
    r.checkout("main");
    let m = r.merge("feature");
    let d = r.commit("d");
    (r, vec![a, b, f1, f2, m, d])
}

#[tokio::test]
async fn opens_repos_and_reports_non_repos() {
    let (r, _) = sample();
    let info = git().open_repo(&r.path().join("")).await.unwrap();
    assert_eq!(
        std::fs::canonicalize(&info.path).unwrap(),
        std::fs::canonicalize(r.path()).unwrap()
    );
    assert!(!info.name.is_empty());

    // A subfolder resolves to the repository root.
    std::fs::create_dir(r.path().join("sub")).unwrap();
    let sub = git().open_repo(&r.path().join("sub")).await.unwrap();
    assert_eq!(sub.path, info.path);

    let plain = tempfile::tempdir().unwrap();
    let err = git().open_repo(plain.path()).await.unwrap_err();
    assert!(matches!(err, GitError::NotARepository { .. }), "{err:?}");

    let bare = tempfile::tempdir().unwrap();
    std::process::Command::new("git")
        .args(["init", "-q", "--bare"])
        .current_dir(bare.path())
        .status()
        .unwrap();
    let err = git().open_repo(bare.path()).await.unwrap_err();
    assert!(matches!(err, GitError::BareRepository { .. }), "{err:?}");
}

#[tokio::test]
async fn init_creates_an_empty_repo() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("new repo");
    let info = git().init_repo(&target).await.unwrap();
    assert_eq!(info.name, "new repo");
    let refs = git().refs(&target).await.unwrap();
    assert_eq!(refs.head.oid, None, "unborn");
    assert!(refs.head.branch.is_some());
    let mut rows = 0;
    let n = git()
        .stream_log(&target, LogOptions::default(), |b| {
            rows += b.len();
            true
        })
        .await
        .unwrap();
    assert_eq!((n, rows), (0, 0), "empty history is not an error");
}

#[tokio::test]
async fn reads_refs() {
    let (r, ids) = sample();
    r.git(&["stash", "list"]);
    let refs = git().refs(r.path()).await.unwrap();
    assert_eq!(refs.head.branch.as_deref(), Some("main"));
    assert_eq!(refs.head.oid.as_deref(), Some(ids[5].as_str()));
    let names: Vec<_> = refs.branches.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, ["feature", "main"]);
    assert!(refs.branches[1].is_head);
    assert_eq!(refs.tags[0].name, "v1");
    assert_eq!(
        refs.tags[0].oid, ids[0],
        "annotated tag peeled to its commit"
    );
    assert!(refs.remotes.is_empty());
}

#[tokio::test]
async fn streams_history_in_display_order() {
    let (r, ids) = sample();
    let mut batches = Vec::new();
    let total = git()
        .stream_log(r.path(), LogOptions::default(), |b| {
            batches.push(b);
            true
        })
        .await
        .unwrap();
    let commits: Vec<_> = batches.concat();
    assert_eq!(total, 6);
    assert_eq!(commits[0].oid, ids[5], "newest first");
    let merge = commits.iter().find(|c| c.oid == ids[4]).unwrap();
    assert_eq!(merge.parents, [ids[1].clone(), ids[3].clone()]);
    assert_eq!(commits.last().unwrap().parents.len(), 0, "root");
    assert_eq!(commits[0].author_email, "test@example.com");

    // Stopping early.
    let mut seen = 0;
    git()
        .stream_log(r.path(), LogOptions::default(), |b| {
            seen += b.len();
            false
        })
        .await
        .unwrap();
    assert_eq!(seen, 6, "single batch delivered, then stopped");

    // Current branch only, after switching to feature.
    r.checkout("feature");
    let mut head_only = Vec::new();
    git()
        .stream_log(
            r.path(),
            LogOptions {
                scope: LogScope::Head,
                ..LogOptions::default()
            },
            |b| {
                head_only.extend(b);
                true
            },
        )
        .await
        .unwrap();
    assert_eq!(head_only.len(), 4, "f2 f1 b a");
}

#[tokio::test]
async fn searches_history() {
    let (r, ids) = sample();
    let opts = LogOptions::default();
    let g = git();
    assert_eq!(
        g.search_log(r.path(), opts, SearchField::Message, "F1")
            .await
            .unwrap(),
        [ids[2].clone()]
    );
    assert_eq!(
        g.search_log(r.path(), opts, SearchField::Author, "TEST@")
            .await
            .unwrap()
            .len(),
        6
    );
    assert_eq!(
        g.search_log(r.path(), opts, SearchField::Path, "d.txt")
            .await
            .unwrap(),
        [ids[5].clone()]
    );
    assert_eq!(
        g.search_log(r.path(), opts, SearchField::Hash, &ids[3][..10])
            .await
            .unwrap(),
        [ids[3].clone()]
    );
    assert!(
        g.search_log(r.path(), opts, SearchField::Hash, "zz")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn commit_details_and_diff() {
    let (mut r, _) = sample();
    r.write("src/lib.rs", "fn a() {}\nlet y = 2;\nend\n");
    let base = r.commit("base");
    r.write("src/lib.rs", "fn a() {}\nlet y = compute();\nend\n");
    r.git(&["mv", "f1.txt", "renamed.txt"]);
    let change = r.commit("change");

    let d = git().commit_details(r.path(), &change).await.unwrap();
    assert_eq!(d.subject, "change");
    assert_eq!(d.parents, std::slice::from_ref(&base));
    let lib = d.files.iter().find(|f| f.path == "src/lib.rs").unwrap();
    assert_eq!(
        (lib.status, lib.additions, lib.deletions),
        (FileStatus::Modified, Some(1), Some(1))
    );
    let renamed = d.files.iter().find(|f| f.path == "renamed.txt").unwrap();
    assert_eq!(renamed.status, FileStatus::Renamed);
    assert_eq!(renamed.old_path.as_deref(), Some("f1.txt"));

    let diff = git()
        .diff(
            r.path(),
            &DiffRequest {
                target: DiffTarget::Commit {
                    oid: change.clone(),
                    parent: Some(base),
                },
                path: "src/lib.rs".into(),
                old_path: None,
                context: 3,
                ignore_whitespace: false,
                force: false,
            },
        )
        .await
        .unwrap();
    let DiffContent::Text { hunks, .. } = &diff.content else {
        panic!("{diff:?}");
    };
    let del = hunks[0]
        .lines
        .iter()
        .find(|l| l.kind == LineKind::Del)
        .unwrap();
    assert_eq!(del.text, "let y = 2;");
    assert!(!del.emphasis.is_empty());

    // Root commit diff (no parent).
    let root = r.git(&["rev-list", "--max-parents=0", "HEAD"]);
    let root_diff = git()
        .diff(
            r.path(),
            &DiffRequest {
                target: DiffTarget::Commit {
                    oid: root,
                    parent: None,
                },
                path: "a.txt".into(),
                old_path: None,
                context: 3,
                ignore_whitespace: false,
                force: false,
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        root_diff.content,
        DiffContent::Text { additions: 1, .. }
    ));
}

#[tokio::test]
async fn working_copy_status_and_diffs() {
    let (r, _) = sample();
    r.write("a.txt", "a changed\n");
    r.write("staged.txt", "new\n");
    r.git(&["add", "staged.txt"]);
    r.write("untracked dir/u.txt", "u1\nu2\n");
    let s = git().status(r.path()).await.unwrap();
    assert_eq!(s.branch.as_deref(), Some("main"));
    assert_eq!(s.changed_files(), 3);
    let req = |target, path: &str| DiffRequest {
        target,
        path: path.into(),
        old_path: None,
        context: 3,
        ignore_whitespace: false,
        force: false,
    };
    let unstaged = git()
        .diff(r.path(), &req(DiffTarget::Unstaged, "a.txt"))
        .await
        .unwrap();
    assert!(matches!(
        unstaged.content,
        DiffContent::Text {
            additions: 1,
            deletions: 1,
            ..
        }
    ));
    let staged = git()
        .diff(r.path(), &req(DiffTarget::Staged, "staged.txt"))
        .await
        .unwrap();
    assert!(matches!(
        staged.content,
        DiffContent::Text { additions: 1, .. }
    ));
    let untracked = git()
        .diff(r.path(), &req(DiffTarget::Untracked, "untracked dir/u.txt"))
        .await
        .unwrap();
    assert!(matches!(
        untracked.content,
        DiffContent::Text {
            additions: 2,
            deletions: 0,
            ..
        }
    ));
}

#[tokio::test]
async fn clones_local_repo_with_progress_and_validates_input() {
    let (r, ids) = sample();
    let dest_root = tempfile::tempdir().unwrap();
    let dest = dest_root.path().join("clone");
    let (_tx, rx) = oneshot::channel();
    let url = format!(
        "file://{}",
        r.path().display().to_string().replace('\\', "/")
    );
    let mut phases = Vec::new();
    let info = git()
        .clone_repo(
            &CloneRequest {
                url: url.clone(),
                destination: dest.display().to_string(),
                branch: Some("feature".into()),
                depth: None,
            },
            OpContext::new(rx, &mut |p| phases.push(p.phase)),
        )
        .await
        .unwrap();
    assert_eq!(info.name, "clone");
    let refs = git().refs(&dest).await.unwrap();
    assert_eq!(refs.head.branch.as_deref(), Some("feature"));
    assert_eq!(refs.head.oid.as_deref(), Some(ids[3].as_str()));
    assert_eq!(refs.remotes[0].name, "origin");
    assert!(!phases.is_empty(), "progress reported");
    git().write_commit_graph(&dest).await.unwrap();
    assert!(dest.join(".git/objects/info/commit-graph").exists());

    // Non-empty destination is refused before running git.
    let (_tx, rx) = oneshot::channel();
    let err = git()
        .clone_repo(
            &CloneRequest {
                url: url.clone(),
                destination: dest.display().to_string(),
                branch: None,
                depth: None,
            },
            OpContext::new(rx, &mut |_| {}),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::InvalidInput(_)), "{err:?}");

    // A failing clone leaves nothing behind.
    let (_tx, rx) = oneshot::channel();
    let missing = dest_root.path().join("missing");
    let err = git()
        .clone_repo(
            &CloneRequest {
                url: format!("{url}-does-not-exist"),
                destination: missing.display().to_string(),
                branch: None,
                depth: None,
            },
            OpContext::new(rx, &mut |_| {}),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::Failed { .. }), "{err:?}");
    assert!(!missing.exists());

    // Option-like URLs and bad branch names are rejected.
    for (url, branch) in [("--upload-pack=x", None), (url.as_str(), Some("bad..name"))] {
        let (_tx, rx) = oneshot::channel();
        let err = git()
            .clone_repo(
                &CloneRequest {
                    url: url.into(),
                    destination: dest_root.path().join("x").display().to_string(),
                    branch: branch.map(Into::into),
                    depth: None,
                },
                OpContext::new(rx, &mut |_| {}),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, GitError::InvalidInput(_)), "{err:?}");
    }
}

#[tokio::test]
async fn cancelled_clone_removes_the_folder() {
    let (r, _) = sample();
    let dest_root = tempfile::tempdir().unwrap();
    let dest = dest_root.path().join("cancelled");
    let (tx, rx) = oneshot::channel();
    tx.send(()).unwrap();
    let err = git()
        .clone_repo(
            &CloneRequest {
                url: r.path().display().to_string(),
                destination: dest.display().to_string(),
                branch: None,
                depth: None,
            },
            OpContext::new(rx, &mut |_| {}),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::Cancelled { .. }), "{err:?}");
    assert!(!dest.exists());
}

#[tokio::test]
async fn refs_report_the_last_fetch() {
    let mut remote = TestRepo::new();
    remote.commit("one");
    let clone = TestRepo::clone_of(&remote);
    clone.git(&["fetch", "-q"]);
    let after = git().refs(clone.path()).await.unwrap().last_fetch;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    assert!(after.is_some_and(|t| (now - t).abs() < 120), "{after:?}");

    let never = TestRepo::new();
    assert_eq!(git().refs(never.path()).await.unwrap().last_fetch, None);
}
