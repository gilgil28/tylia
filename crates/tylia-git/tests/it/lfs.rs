//! Git LFS: which files are LFS files, and tracking a pattern (Phase 9). Pull and locks need
//! an LFS server; their parsing is unit-tested in `lfs.rs`.

use crate::common::TestRepo;
use tylia_git::{Git, GitError};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

fn lfs_installed(repo: &TestRepo) -> bool {
    let ok = repo.git_ok(&["lfs", "version"]);
    if !ok {
        eprintln!("git-lfs isn't installed: skipping");
    }
    ok
}

#[tokio::test]
async fn lfs_files_come_from_the_attributes_without_git_lfs() {
    let mut repo = TestRepo::new();
    repo.commit_file(
        ".gitattributes",
        "*.psd filter=lfs diff=lfs merge=lfs -text\nart/** filter=lfs\n",
        "attributes",
    );
    let paths: Vec<String> = ["logo.psd", "notes.txt", "art/level 1.bin", "src/a.rs"]
        .map(String::from)
        .into();
    let lfs = git().lfs_files(repo.path(), &paths).await.unwrap();
    assert_eq!(lfs, ["logo.psd", "art/level 1.bin"]);
    assert!(git().lfs_files(repo.path(), &[]).await.unwrap().is_empty());
}

#[tokio::test]
async fn tracking_writes_the_attributes() {
    let mut repo = TestRepo::new();
    repo.commit("first");
    if !lfs_installed(&repo) {
        return;
    }
    git().lfs_track(repo.path(), "*.bin").await.unwrap();
    git()
        .lfs_track(repo.path(), "assets/big file.dat")
        .await
        .unwrap();
    let attributes = repo.read(".gitattributes");
    assert!(attributes.contains("*.bin filter=lfs"), "{attributes}");
    let lfs = git()
        .lfs_files(repo.path(), &["x.bin".into(), "x.txt".into()])
        .await
        .unwrap();
    assert_eq!(lfs, ["x.bin"]);
    for bad in ["", "--help", "a\nb"] {
        let result = git().lfs_track(repo.path(), bad).await;
        assert!(
            matches!(result, Err(GitError::InvalidInput(_))),
            "{bad:?}: {result:?}"
        );
    }
}
