//! Blame and file history on temp repositories.

use crate::common::TestRepo;
use tylia_git::{Blame, BlameContent, FileStatus, Git, GitError};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// (commit oid, text) per line, or a panic for other content.
fn attributed(blame: &Blame) -> Vec<(String, String)> {
    match &blame.content {
        BlameContent::Lines { commits, lines } => lines
            .iter()
            .map(|l| (commits[l.commit as usize].oid.clone(), l.text.clone()))
            .collect(),
        other => panic!("expected lines, got {other:?}"),
    }
}

#[tokio::test]
async fn blames_the_working_copy_including_uncommitted_lines() {
    let mut r = TestRepo::new();
    let c1 = r.commit_file("src/a.rs", "one\ntwo\nthree\n", "Add a");
    let c2 = r.commit_file("src/a.rs", "one\nTWO\nthree\n", "Shout two");
    r.write("src/a.rs", "one\nTWO\nthree\nfour\n");

    let blame = git()
        .blame(r.path(), "src/a.rs", None, false)
        .await
        .unwrap();
    assert_eq!(blame.rev, None);
    let lines = attributed(&blame);
    assert_eq!(lines[0], (c1.clone(), "one".to_owned()));
    assert_eq!(lines[1], (c2.clone(), "TWO".to_owned()));
    assert_eq!(lines[2], (c1.clone(), "three".to_owned()));
    assert_eq!(lines[3].1, "four");

    let BlameContent::Lines {
        commits,
        lines: raw,
    } = &blame.content
    else {
        unreachable!()
    };
    let wip = &commits[raw[3].commit as usize];
    assert!(wip.uncommitted);
    let second = commits.iter().find(|c| c.oid == c2).unwrap();
    assert_eq!(second.summary, "Shout two");
    assert_eq!(second.author_name, "Test");
    assert_eq!(second.author_email, "test@example.com");
    assert!(second.author_time > 0);
    assert_eq!(second.path, "src/a.rs");
    let previous = second.previous.as_ref().expect("blame the parent");
    assert_eq!(
        (previous.oid.as_str(), previous.path.as_str()),
        (c1.as_str(), "src/a.rs")
    );
    let first = commits.iter().find(|c| c.oid == c1).unwrap();
    assert!(first.previous.is_none(), "the commit that added the file");
    assert_eq!(
        raw.iter().map(|l| l.line).collect::<Vec<_>>(),
        [1, 2, 3, 4],
        "final line numbers"
    );
}

#[tokio::test]
async fn blames_an_older_commit() {
    let mut r = TestRepo::new();
    let c1 = r.commit_file("a.txt", "a\nb\n", "First");
    r.commit_file("a.txt", "a\nB\nc\n", "Second");

    let blame = git()
        .blame(r.path(), "a.txt", Some(&c1), false)
        .await
        .unwrap();
    assert_eq!(blame.rev.as_deref(), Some(c1.as_str()));
    assert_eq!(
        attributed(&blame),
        [(c1.clone(), "a".to_owned()), (c1.clone(), "b".to_owned())]
    );
}

#[tokio::test]
async fn blame_follows_a_renamed_file() {
    let mut r = TestRepo::new();
    let c1 = r.commit_file("old.txt", "kept\n", "Add old");
    r.git(&["mv", "old.txt", "new.txt"]);
    r.git(&["commit", "-q", "-m", "Rename"]);
    let c3 = r.commit_file("new.txt", "kept\nadded\n", "Append");

    let blame = git().blame(r.path(), "new.txt", None, false).await.unwrap();
    assert_eq!(
        attributed(&blame),
        [
            (c1.clone(), "kept".to_owned()),
            (c3.clone(), "added".to_owned())
        ]
    );
    let BlameContent::Lines { commits, .. } = &blame.content else {
        unreachable!()
    };
    let first = commits.iter().find(|c| c.oid == c1).unwrap();
    assert_eq!(first.path, "old.txt", "the file's name in that commit");
}

#[tokio::test]
async fn blame_refuses_binary_large_and_missing_files() {
    let mut r = TestRepo::new();
    std::fs::write(r.path().join("img.bin"), b"\x89PNG\0\0binary").unwrap();
    let head = r.commit("With binary");
    let g = git();

    let bin = g
        .blame(r.path(), "img.bin", Some(&head), false)
        .await
        .unwrap();
    assert_eq!(bin.content, BlameContent::Binary);
    let bin = g.blame(r.path(), "img.bin", None, false).await.unwrap();
    assert_eq!(bin.content, BlameContent::Binary);

    let big = "x".repeat(99) + "\n";
    r.commit_file("big.txt", &big.repeat(11_000), "Big");
    let large = g.blame(r.path(), "big.txt", None, false).await.unwrap();
    assert_eq!(large.content, BlameContent::TooLarge { bytes: 1_100_000 });
    let forced = g.blame(r.path(), "big.txt", None, true).await.unwrap();
    assert_eq!(attributed(&forced).len(), 11_000);

    // Not in the commit, untracked, deleted from the working copy.
    let missing = g
        .blame(r.path(), "big.txt", Some(&head), false)
        .await
        .unwrap();
    assert_eq!(missing.content, BlameContent::Missing);
    r.write("untracked.txt", "new\n");
    let untracked = g
        .blame(r.path(), "untracked.txt", None, false)
        .await
        .unwrap();
    assert_eq!(untracked.content, BlameContent::Missing);
    std::fs::remove_file(r.path().join("big.txt")).unwrap();
    let deleted = g.blame(r.path(), "big.txt", None, false).await.unwrap();
    assert_eq!(deleted.content, BlameContent::Missing);
    let folder = g.blame(r.path(), "nope", Some(&head), false).await.unwrap();
    assert_eq!(folder.content, BlameContent::Missing);
}

#[tokio::test]
async fn rejects_invalid_input() {
    let mut r = TestRepo::new();
    r.commit("a");
    let g = git();
    for (path, rev) in [
        ("../outside.txt", None),
        ("", None),
        ("a.txt", Some("--output=x")),
        ("a.txt", Some("HEAD two")),
    ] {
        let err = g.blame(r.path(), path, rev, false).await.unwrap_err();
        assert!(matches!(err, GitError::InvalidInput(_)), "{path} {rev:?}");
        let err = g
            .file_history(r.path(), path, rev, 0, 10)
            .await
            .unwrap_err();
        assert!(matches!(err, GitError::InvalidInput(_)), "{path} {rev:?}");
    }
}

#[tokio::test]
async fn file_history_follows_renames() {
    let mut r = TestRepo::new();
    let c1 = r.commit_file("docs/old.md", "# Title\n\nbody\n", "Add doc");
    r.commit("Unrelated");
    let c3 = r.commit_file("docs/old.md", "# Title\n\nbody text\n", "Edit doc");
    r.git(&["mv", "docs/old.md", "docs/new.md"]);
    r.git(&["commit", "-q", "-m", "Rename doc"]);
    let c4 = r.git(&["rev-parse", "HEAD"]);
    let c5 = r.commit_file("docs/new.md", "# Title\n\nbody text\nmore\n", "Extend doc");

    let page = git()
        .file_history(r.path(), "docs/new.md", None, 0, 50)
        .await
        .unwrap();
    assert!(!page.more);
    let got: Vec<_> = page
        .entries
        .iter()
        .map(|e| {
            (
                e.oid.as_str(),
                e.path.as_str(),
                e.old_path.as_deref(),
                e.status,
            )
        })
        .collect();
    assert_eq!(
        got,
        [
            (c5.as_str(), "docs/new.md", None, Some(FileStatus::Modified)),
            (
                c4.as_str(),
                "docs/new.md",
                Some("docs/old.md"),
                Some(FileStatus::Renamed)
            ),
            (c3.as_str(), "docs/old.md", None, Some(FileStatus::Modified)),
            (c1.as_str(), "docs/old.md", None, Some(FileStatus::Added)),
        ]
    );
    let first = &page.entries[0];
    assert_eq!(first.subject, "Extend doc");
    assert_eq!(first.author_name, "Test");
    assert_eq!(first.parents, std::slice::from_ref(&c4));
    assert!(page.entries[3].parents.is_empty(), "the root commit");
}

#[tokio::test]
async fn file_history_pages() {
    let mut r = TestRepo::new();
    let mut oids = Vec::new();
    for i in 0..5 {
        oids.push(r.commit_file("f.txt", &format!("{i}\n"), &format!("Edit {i}")));
    }
    oids.reverse();
    let g = git();
    let mut seen = Vec::new();
    let mut skip = 0;
    loop {
        let page = g
            .file_history(r.path(), "f.txt", None, skip, 2)
            .await
            .unwrap();
        assert!(page.entries.len() <= 2);
        skip += page.entries.len() as u32;
        seen.extend(page.entries.into_iter().map(|e| e.oid));
        if !page.more {
            break;
        }
    }
    assert_eq!(seen, oids);

    // From an older commit.
    let page = g
        .file_history(r.path(), "f.txt", Some(&oids[3]), 0, 10)
        .await
        .unwrap();
    assert_eq!(
        page.entries.iter().map(|e| &e.oid).collect::<Vec<_>>(),
        [&oids[3], &oids[4]]
    );
}

#[tokio::test]
async fn untracked_files_and_unborn_branches_have_no_history() {
    let r = TestRepo::new();
    let g = git();
    r.write("new.txt", "x\n");
    let page = g
        .file_history(r.path(), "new.txt", None, 0, 10)
        .await
        .unwrap();
    assert!(page.entries.is_empty() && !page.more);
    let blame = g.blame(r.path(), "new.txt", None, false).await.unwrap();
    assert_eq!(blame.content, BlameContent::Missing);

    let mut r = TestRepo::new();
    r.commit("a");
    r.write("new.txt", "x\n");
    let page = g
        .file_history(r.path(), "new.txt", None, 0, 10)
        .await
        .unwrap();
    assert!(page.entries.is_empty());
}
