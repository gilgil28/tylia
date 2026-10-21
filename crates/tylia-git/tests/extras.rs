//! Worktrees, LFS detection and submodule updates on temp repositories.

mod common;

use common::TestRepo;
use tokio::sync::oneshot;
use tylia_git::{Git, OpContext, SubmoduleState};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

#[tokio::test]
async fn lists_worktrees() {
    let mut r = TestRepo::new();
    r.commit("one");
    let extra = tempfile::tempdir().unwrap();
    let wt = extra.path().join("wt");
    r.git(&[
        "worktree",
        "add",
        "-q",
        "-b",
        "side",
        &wt.display().to_string(),
    ]);

    let list = git().worktrees(r.path()).await.unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[0].main && list[0].current, "{list:?}");
    assert_eq!(list[0].branch.as_deref(), Some("main"));
    assert_eq!(list[1].branch.as_deref(), Some("side"));
    assert!(!list[1].current);

    // Seen from the linked worktree, that one is current.
    let list = git().worktrees(&wt).await.unwrap();
    assert!(list[1].current && !list[0].current, "{list:?}");
}

#[tokio::test]
async fn detects_lfs_use() {
    let mut r = TestRepo::new();
    r.commit("one");
    assert!(!git().lfs_status(r.path()).await.unwrap().used);
    r.write(
        ".gitattributes",
        "# comment filter=lfs\n*.psd filter=lfs diff=lfs merge=lfs -text\n",
    );
    assert!(git().lfs_status(r.path()).await.unwrap().used);
}

#[tokio::test]
async fn updates_submodules() {
    let mut sub = TestRepo::new();
    sub.commit("sub one");
    let mut sup = TestRepo::new();
    sup.commit("base");
    let sub_url = sub.path().display().to_string().replace('\\', "/");
    sup.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        &sub_url,
        "libs/sub",
    ]);
    sup.git(&["commit", "-qm", "add submodule"]);

    // A fresh clone has the submodule registered but not checked out.
    let clone = TestRepo::clone_of(&sup);
    let before = git().submodules(clone.path()).await.unwrap();
    assert_eq!(before[0].state, SubmoduleState::NotInitialized);

    // Local file submodules need protocol.file.allow (Git refuses them by default).
    let env = [
        ("GIT_CONFIG_COUNT".to_owned(), "1".to_owned()),
        (
            "GIT_CONFIG_KEY_0".to_owned(),
            "protocol.file.allow".to_owned(),
        ),
        ("GIT_CONFIG_VALUE_0".to_owned(), "always".to_owned()),
    ];
    let (_tx, rx) = oneshot::channel();
    git()
        .submodule_update(
            clone.path(),
            &["libs/sub".to_owned()],
            OpContext::new(rx, &mut |_| {}).with_env(&env),
        )
        .await
        .unwrap();
    let after = git().submodules(clone.path()).await.unwrap();
    assert_eq!(after[0].state, SubmoduleState::UpToDate);
    assert!(clone.path().join("libs/sub/sub_one.txt").exists());

    let (_tx, rx) = oneshot::channel();
    let outside = git()
        .submodule_update(
            clone.path(),
            &["../x".to_owned()],
            OpContext::new(rx, &mut |_| {}),
        )
        .await;
    assert!(outside.is_err());
}

#[tokio::test]
async fn diff_tool_refuses_without_a_tool() {
    let mut r = TestRepo::new();
    r.commit("one");
    r.write("one.txt", "changed");
    // Independent of the machine's global config.
    r.git(&["config", "diff.tool", ""]);
    r.git(&["config", "diff.guitool", ""]);
    let req = tylia_git::DiffRequest {
        target: tylia_git::DiffTarget::Unstaged,
        path: "one.txt".into(),
        old_path: None,
        context: 3,
        ignore_whitespace: false,
        force: false,
    };
    let err = git().diff_tool(r.path(), &req).await.unwrap_err();
    assert!(
        matches!(&err, tylia_git::GitError::InvalidInput(m) if m.contains("No diff tool")),
        "{err:?}"
    );
    r.git(&["config", "diff.tool", "vimdiff"]);
    let err = git().diff_tool(r.path(), &req).await.unwrap_err();
    assert!(
        matches!(&err, tylia_git::GitError::InvalidInput(m) if m.contains("terminal")),
        "{err:?}"
    );
}
