mod common;

use common::TestRepo;
use tylia_git::{FileStatus, Git, GitError};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

fn paths(p: &[&str]) -> Vec<String> {
    p.iter().map(|s| (*s).to_owned()).collect()
}

#[tokio::test]
async fn stages_and_unstages_files() {
    let mut r = TestRepo::new();
    r.commit("a");
    r.commit("b");
    r.write("a.txt", "changed\n");
    std::fs::remove_file(r.path().join("b.txt")).unwrap();
    r.write("new.txt", "new\n");

    let g = git();
    g.stage_files(r.path(), &paths(&["a.txt", "b.txt", "new.txt"]))
        .await
        .unwrap();
    let s = g.status(r.path()).await.unwrap();
    let staged: Vec<_> = s
        .entries
        .iter()
        .map(|e| (e.path.as_str(), e.staged))
        .collect();
    assert!(staged.contains(&("a.txt", Some(FileStatus::Modified))));
    assert!(staged.contains(&("b.txt", Some(FileStatus::Deleted))));
    assert!(staged.contains(&("new.txt", Some(FileStatus::Added))));

    g.unstage_files(r.path(), &paths(&["a.txt"])).await.unwrap();
    let s = g.status(r.path()).await.unwrap();
    let a = s.entries.iter().find(|e| e.path == "a.txt").unwrap();
    assert_eq!((a.staged, a.unstaged), (None, Some(FileStatus::Modified)));

    g.unstage_all(r.path()).await.unwrap();
    assert!(
        g.status(r.path())
            .await
            .unwrap()
            .entries
            .iter()
            .all(|e| e.staged.is_none())
    );
    g.stage_all(r.path()).await.unwrap();
    assert!(
        g.status(r.path())
            .await
            .unwrap()
            .entries
            .iter()
            .all(|e| e.unstaged.is_none())
    );
}

#[tokio::test]
async fn unstaging_works_before_the_first_commit() {
    let r = TestRepo::new();
    r.write("x.txt", "x\n").write("y.txt", "y\n");
    let g = git();
    g.stage_all(r.path()).await.unwrap();
    g.unstage_files(r.path(), &paths(&["x.txt"])).await.unwrap();
    let s = g.status(r.path()).await.unwrap();
    let x = s.entries.iter().find(|e| e.path == "x.txt").unwrap();
    assert_eq!(x.unstaged, Some(FileStatus::Untracked));
    g.unstage_all(r.path()).await.unwrap();
    assert!(
        g.status(r.path())
            .await
            .unwrap()
            .entries
            .iter()
            .all(|e| e.staged.is_none())
    );
}

#[tokio::test]
async fn discard_restores_tracked_files_from_the_index() {
    let mut r = TestRepo::new();
    r.write("f.txt", "one\n");
    r.commit("base");
    r.write("f.txt", "staged\n");
    r.git(&["add", "f.txt"]);
    r.write("f.txt", "staged then edited\n");
    git()
        .discard_files(r.path(), &paths(&["f.txt"]), &[])
        .await
        .unwrap();
    // The unstaged edit is gone; the staged change stays.
    assert_eq!(
        std::fs::read_to_string(r.path().join("f.txt")).unwrap(),
        "staged\n"
    );
    let s = git().status(r.path()).await.unwrap();
    assert_eq!(s.entries[0].staged, Some(FileStatus::Modified));
    assert_eq!(s.entries[0].unstaged, None);
}

#[tokio::test]
async fn discard_rejects_paths_outside_the_repo() {
    let r = TestRepo::new();
    let err = git()
        .discard_files(r.path(), &[], &paths(&["../outside.txt"]))
        .await
        .unwrap_err();
    assert!(matches!(err, GitError::InvalidInput(_)), "{err:?}");
}

#[tokio::test]
async fn commits_amends_and_reports_hook_failures() {
    let mut r = TestRepo::new();
    r.commit("first");
    r.write("a.txt", "a\n");
    let g = git();
    g.stage_all(r.path()).await.unwrap();
    let oid = g
        .commit(r.path(), "Add a\n\nWith a body line.", false)
        .await
        .unwrap();
    assert_eq!(r.git(&["rev-parse", "HEAD"]), oid);
    assert_eq!(
        g.head_message(r.path()).await.unwrap().as_deref(),
        Some("Add a\n\nWith a body line.")
    );

    let amended = g.commit(r.path(), "Add a (amended)", true).await.unwrap();
    assert_ne!(amended, oid);
    assert_eq!(r.git(&["log", "-1", "--format=%s"]), "Add a (amended)");
    assert_eq!(
        r.git(&["rev-list", "--count", "HEAD"]),
        "2",
        "amend replaced the commit"
    );

    // A failing pre-commit hook: the error carries its output.
    let hooks = r.path().join(".git/hooks");
    std::fs::write(
        hooks.join("pre-commit"),
        "#!/bin/sh\necho 'lint: 2 problems'\necho 'fix them first' >&2\nexit 1\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            hooks.join("pre-commit"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }
    r.write("b.txt", "b\n");
    g.stage_all(r.path()).await.unwrap();
    let err = g.commit(r.path(), "Add b", false).await.unwrap_err();
    let output = err.stderr().unwrap();
    assert!(output.contains("lint: 2 problems"), "{output}");
    assert!(output.contains("fix them first"), "{output}");
}

#[tokio::test]
async fn head_message_is_none_before_the_first_commit() {
    let r = TestRepo::new();
    assert_eq!(git().head_message(r.path()).await.unwrap(), None);
}
