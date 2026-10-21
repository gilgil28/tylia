//! History path index and search by file, on temp repositories.

mod common;

use common::TestRepo;
use tylia_git::{Git, LogOptions, LogOrder, LogScope, PathIndex, PathKind};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

const ALL: LogOptions = LogOptions {
    scope: LogScope::All,
    order: LogOrder::Date,
};

/// main: add a/app.txt, README.md; rename app.txt → src/main.txt; delete README.md;
/// a side branch adds docs/Guide.md.
fn repo() -> (TestRepo, Vec<String>) {
    let mut r = TestRepo::new();
    let c1 = r.commit_file("a/app.txt", "1\n", "add app");
    let c2 = r.commit_file("README.md", "hi\n", "add readme");
    std::fs::create_dir_all(r.path().join("src")).unwrap();
    r.git(&["mv", "a/app.txt", "src/main.txt"]);
    r.git(&["commit", "-q", "-m", "move app"]);
    let c3 = r.git(&["rev-parse", "HEAD"]);
    let c4 = r.commit_file("src/main.txt", "1\n2\n", "edit main");
    r.git(&["rm", "-q", "README.md"]);
    r.git(&["commit", "-q", "-m", "drop readme"]);
    let c5 = r.git(&["rev-parse", "HEAD"]);
    r.branch("side");
    let c6 = r.commit_file("docs/Guide.md", "g\n", "add guide");
    r.checkout("main");
    (r, vec![c1, c2, c3, c4, c5, c6])
}

#[tokio::test]
async fn index_has_every_path_ever_and_marks_deleted_ones() {
    let (r, _) = repo();
    let mut index = PathIndex::default();
    assert!(git().update_path_index(r.path(), &mut index).await.unwrap());
    assert_eq!(
        index.file_count(),
        4,
        "a/app.txt, README.md, src/main.txt, docs/Guide.md"
    );
    // Nothing new: no walk.
    assert!(!git().update_path_index(r.path(), &mut index).await.unwrap());

    let tracked = git().tracked_paths(r.path()).await.unwrap();
    let s = index.suggest("app", &tracked, 10);
    assert_eq!(s[0].path, "a/app.txt");
    assert!(s[0].deleted);
    let s = index.suggest("guide", &tracked, 10);
    assert_eq!(s[0].path, "docs/Guide.md");
    assert!(
        s[0].deleted,
        "only on another branch, not in the checked-out tree"
    );
    let s = index.suggest("src", &tracked, 10);
    assert_eq!(
        (s[0].path.as_str(), s[0].kind, s[0].deleted),
        ("src/", PathKind::Dir, false)
    );
}

#[tokio::test]
async fn index_updates_with_only_new_commits() {
    let (mut r, _) = repo();
    let mut index = PathIndex::default();
    git().update_path_index(r.path(), &mut index).await.unwrap();
    r.commit_file("new/thing.txt", "x\n", "add thing");
    assert!(git().update_path_index(r.path(), &mut index).await.unwrap());
    assert_eq!(index.file_count(), 5);
    assert!(index.suggest("thing", &Default::default(), 5)[0].path == "new/thing.txt");
}

#[tokio::test]
async fn empty_repository_has_an_empty_index() {
    let r = TestRepo::new();
    let mut index = PathIndex::default();
    git().update_path_index(r.path(), &mut index).await.unwrap();
    assert_eq!(index.file_count(), 0);
}

#[tokio::test]
async fn search_by_name_folder_and_following_renames() {
    let (r, c) = repo();
    let mut index = PathIndex::default();
    git().update_path_index(r.path(), &mut index).await.unwrap();
    let search = |q: &str| {
        let query = index.resolve(q);
        let r = r.path_buf();
        async move { git().search_paths(&r, &ALL, &query).await.unwrap() }
    };

    // A deleted file, by name in any case.
    assert_eq!(search("readme.md").await, [c[4].clone(), c[1].clone()]);
    // One file: follows the rename back to a/app.txt.
    assert_eq!(
        search("main.txt").await,
        [c[3].clone(), c[2].clone(), c[0].clone()]
    );
    // A folder (by path), on another branch.
    assert_eq!(search("docs/").await, [c[5].clone()]);
    // Wildcards over every branch.
    assert_eq!(
        search("*.md").await,
        [c[5].clone(), c[4].clone(), c[1].clone()]
    );
    // Nothing matches: no commits, no error.
    assert!(search("nope.bin").await.is_empty());
}
