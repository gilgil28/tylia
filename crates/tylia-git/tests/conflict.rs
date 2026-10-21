//! Resolving conflict blocks one at a time in a real merge conflict.

mod common;

use common::TestRepo;
use tylia_git::{BlockResolution, ConflictSegment, Git, GitError};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// A merge stopped with two conflict blocks in `app.txt`.
fn two_block_conflict() -> TestRepo {
    let mut r = TestRepo::new();
    let base = "a\nb\nc\nd\ne\nf\ng\nh\n";
    r.commit_file("app.txt", base, "base");
    r.branch("feature");
    r.commit_file(
        "app.txt",
        "a\nB-theirs\nc\nd\ne\nf\nG-theirs\nh\n",
        "theirs",
    );
    r.checkout("main");
    r.commit_file("app.txt", "a\nB-mine\nc\nd\ne\nf\nG-mine\nh\n", "mine");
    assert!(
        !r.git_ok(&["merge", "--no-edit", "feature"]),
        "the merge conflicts"
    );
    r
}

fn conflicts(segments: &[ConflictSegment]) -> usize {
    segments
        .iter()
        .filter(|s| matches!(s, ConflictSegment::Conflict { .. }))
        .count()
}

#[tokio::test]
async fn resolves_blocks_one_by_one_then_marks_the_file() {
    let r = two_block_conflict();
    let g = git();
    let file = g.conflict_file(r.path(), "app.txt").await.unwrap();
    assert_eq!(conflicts(&file.segments), 2);
    match &file.segments[1] {
        ConflictSegment::Conflict {
            ours,
            theirs,
            ours_label,
            theirs_label,
            ..
        } => {
            assert_eq!(ours, &["B-mine".to_owned()]);
            assert_eq!(theirs, &["B-theirs".to_owned()]);
            assert_eq!(ours_label, "HEAD");
            assert_eq!(theirs_label, "feature");
        }
        other => panic!("{other:?}"),
    }

    let out = g
        .resolve_block(
            r.path(),
            "app.txt",
            0,
            BlockResolution::Theirs,
            &file.fingerprint,
        )
        .await
        .unwrap();
    assert_eq!((out.remaining, out.resolved), (1, false));
    assert!(
        r.git(&["ls-files", "-u"]).contains("app.txt"),
        "still conflicted"
    );

    // The old fingerprint no longer matches the file.
    let stale = g
        .resolve_block(
            r.path(),
            "app.txt",
            0,
            BlockResolution::Ours,
            &file.fingerprint,
        )
        .await;
    assert!(matches!(stale, Err(GitError::InvalidInput(_))), "{stale:?}");

    let file = g.conflict_file(r.path(), "app.txt").await.unwrap();
    assert_eq!(conflicts(&file.segments), 1);
    let out = g
        .resolve_block(
            r.path(),
            "app.txt",
            0,
            BlockResolution::Both,
            &file.fingerprint,
        )
        .await
        .unwrap();
    assert_eq!((out.remaining, out.resolved), (0, true));
    assert_eq!(
        r.read("app.txt"),
        "a\nB-theirs\nc\nd\ne\nf\nG-mine\nG-theirs\nh\n"
    );
    assert_eq!(r.git(&["ls-files", "-u"]), "", "marked resolved");
}

#[tokio::test]
async fn files_without_blocks_and_bad_input() {
    let r = two_block_conflict();
    let g = git();
    r.write("plain.txt", "no conflicts here\n");
    let file = g.conflict_file(r.path(), "plain.txt").await.unwrap();
    assert!(file.segments.is_empty());

    let file = g.conflict_file(r.path(), "app.txt").await.unwrap();
    let missing = g
        .resolve_block(
            r.path(),
            "app.txt",
            5,
            BlockResolution::Ours,
            &file.fingerprint,
        )
        .await;
    assert!(
        matches!(missing, Err(GitError::InvalidInput(_))),
        "{missing:?}"
    );
    assert!(g.conflict_file(r.path(), "../outside.txt").await.is_err());
}
