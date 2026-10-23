//! Lost commits from the reflogs and dangling commits from `git fsck` (Phase 11 B).

use crate::common::TestRepo;
use tylia_git::Git;

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

fn base() -> TestRepo {
    let mut repo = TestRepo::new();
    repo.commit_file("f.txt", "one\n", "first");
    repo
}

#[tokio::test]
async fn a_reset_loses_a_chain_listed_by_its_tip() {
    let mut repo = base();
    repo.commit("second");
    let third = repo.commit("third");
    repo.git(&["reset", "-q", "--hard", "HEAD~2"]);

    let lost = git().lost_commits(repo.path()).await.unwrap();
    assert_eq!(lost.len(), 1, "{lost:?}");
    assert_eq!(lost[0].oid, third);
    assert_eq!(lost[0].subject, "third");
    assert_eq!(lost[0].commits, 2);
    // Found in HEAD's reflog too; the branch's is the one shown.
    assert_eq!(lost[0].reflog.as_deref(), Some("refs/heads/main"));
    assert!(lost[0].reason.as_deref().unwrap().starts_with("commit"));
    assert!(lost[0].time > 0);
}

#[tokio::test]
async fn an_amend_loses_the_original_and_reachable_commits_are_not_lost() {
    let mut repo = base();
    let original = repo.commit("draft");
    repo.git(&["commit", "-q", "--amend", "-m", "final"]);
    let lost = git().lost_commits(repo.path()).await.unwrap();
    assert_eq!(
        lost.iter().map(|c| c.oid.as_str()).collect::<Vec<_>>(),
        [original.as_str()]
    );

    // Restoring it as a branch makes it reachable again.
    repo.git(&["branch", "rescued", &original]);
    assert!(git().lost_commits(repo.path()).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_deleted_branch_that_was_checked_out_is_found() {
    let mut repo = base();
    repo.branch("topic");
    let tip = repo.commit("topic work");
    repo.checkout("main");
    repo.git(&["branch", "-q", "-D", "topic"]);
    let lost = git().lost_commits(repo.path()).await.unwrap();
    assert_eq!(lost.len(), 1);
    assert_eq!(lost[0].oid, tip);
}

#[tokio::test]
async fn a_dropped_stash_is_only_found_by_the_deep_search() {
    let repo = base();
    repo.write("f.txt", "stashed work\n");
    repo.git(&["stash", "push", "-q", "-m", "keep me"]);
    let stash = repo.git(&["rev-parse", "refs/stash"]);
    repo.git(&["stash", "drop", "-q"]);

    assert!(git().lost_commits(repo.path()).await.unwrap().is_empty());
    let dangling = git().dangling_commits(repo.path()).await.unwrap();
    let found = dangling
        .iter()
        .find(|c| c.oid == stash)
        .expect("the stash commit");
    assert_eq!(found.subject, "On main: keep me");
    assert_eq!(found.reflog, None);
}

#[tokio::test]
async fn nothing_lost_in_a_fresh_repository() {
    let repo = base();
    assert!(git().lost_commits(repo.path()).await.unwrap().is_empty());
    assert!(
        git()
            .dangling_commits(repo.path())
            .await
            .unwrap()
            .is_empty()
    );
}
