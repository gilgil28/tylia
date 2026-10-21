//! git-flow helpers on temp repositories.

mod common;

use common::TestRepo;
use tylia_git::{FlowConfig, FlowFinishRequest, FlowKind, Git, GitError};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

fn config(tag_prefix: &str) -> FlowConfig {
    FlowConfig {
        main: "main".into(),
        develop: "develop".into(),
        feature_prefix: "feature/".into(),
        release_prefix: "release/".into(),
        hotfix_prefix: "hotfix/".into(),
        version_tag_prefix: tag_prefix.into(),
    }
}

fn finish(branch: &str) -> FlowFinishRequest {
    FlowFinishRequest {
        branch: branch.into(),
        tag_message: None,
        keep_branch: false,
    }
}

fn assert_invalid<T: std::fmt::Debug>(result: Result<T, GitError>, needle: &str) {
    match result {
        Err(GitError::InvalidInput(msg)) => assert!(msg.contains(needle), "message: {msg}"),
        other => panic!("expected InvalidInput containing {needle:?}, got {other:?}"),
    }
}

/// A repository with one commit on `main` and git-flow set up (tags prefixed `v`).
async fn flow_repo() -> TestRepo {
    let mut repo = TestRepo::new();
    repo.commit_file("app.txt", "1\n2\n3\n", "initial");
    git().flow_init(repo.path(), &config("v")).await.unwrap();
    repo
}

fn parents(repo: &TestRepo, rev: &str) -> usize {
    repo.git(&["rev-list", "--parents", "-n", "1", rev])
        .split_whitespace()
        .count()
        - 1
}

#[tokio::test]
async fn state_suggests_a_setup_until_initialized() {
    let mut repo = TestRepo::new();
    repo.commit("initial");
    let state = git().flow_state(repo.path()).await.unwrap();
    assert_eq!(state.config, None);
    assert_eq!(state.suggested, config(""));

    git().flow_init(repo.path(), &config("v")).await.unwrap();
    let state = git().flow_state(repo.path()).await.unwrap();
    assert_eq!(state.config, Some(config("v")));
    // develop was created from main; the current branch didn't change.
    assert_eq!(
        repo.git(&["rev-parse", "develop"]),
        repo.git(&["rev-parse", "main"])
    );
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    // Keys the git-flow CLI reads.
    assert_eq!(repo.git(&["config", "gitflow.branch.master"]), "main");
    assert_eq!(repo.git(&["config", "gitflow.prefix.support"]), "support/");
}

#[tokio::test]
async fn suggests_master_when_there_is_no_main() {
    let mut repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "master"]);
    repo.commit("initial");
    let state = git().flow_state(repo.path()).await.unwrap();
    assert_eq!(state.suggested.main, "master");
}

#[tokio::test]
async fn init_keeps_an_existing_develop_and_validates() {
    let mut repo = TestRepo::new();
    repo.commit("initial");
    repo.branch("develop");
    let dev = repo.commit("on develop");
    repo.checkout("main");
    git().flow_init(repo.path(), &config("")).await.unwrap();
    assert_eq!(repo.git(&["rev-parse", "develop"]), dev);

    let mut same = config("");
    same.develop = "main".into();
    assert_invalid(
        git().flow_init(repo.path(), &same).await,
        "must be different",
    );
    let mut empty = config("");
    empty.hotfix_prefix = String::new();
    assert_invalid(git().flow_init(repo.path(), &empty).await, "can't be empty");
    let mut twice = config("");
    twice.release_prefix = "feature/".into();
    assert_invalid(git().flow_init(repo.path(), &twice).await, "used twice");
    let mut bad = config("");
    bad.feature_prefix = "fea ture/".into();
    assert!(git().flow_init(repo.path(), &bad).await.is_err());
}

#[tokio::test]
async fn init_needs_the_production_branch() {
    let repo = TestRepo::new();
    assert_invalid(
        git().flow_init(repo.path(), &config("")).await,
        "first commit",
    );
}

#[tokio::test]
async fn feature_starts_from_develop_and_finishes_into_it() {
    let mut repo = flow_repo().await;
    repo.checkout("develop");
    let dev = repo.commit("develop work");
    repo.checkout("main");

    let branch = git()
        .flow_start(repo.path(), FlowKind::Feature, " login ")
        .await
        .unwrap();
    assert_eq!(branch, "feature/login");
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature/login");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), dev);
    // No upstream set from the local base branch.
    assert!(!repo.git_ok(&["rev-parse", "--abbrev-ref", "feature/login@{u}"]));
    repo.commit("login form");

    let done = git()
        .flow_finish(repo.path(), &finish("feature/login"))
        .await
        .unwrap();
    assert_eq!(done.merged_into, ["develop"]);
    assert_eq!(done.tag, None);
    assert!(done.deleted);
    assert_eq!(repo.git(&["branch", "--show-current"]), "develop");
    assert_eq!(parents(&repo, "develop"), 2, "merged with --no-ff");
    assert!(!repo.git_ok(&["rev-parse", "--verify", "refs/heads/feature/login"]));
    assert!(repo.read("login_form.txt").contains("login form"));
}

#[tokio::test]
async fn release_merges_into_main_tags_and_back_into_develop() {
    let mut repo = flow_repo().await;
    git()
        .flow_start(repo.path(), FlowKind::Release, "1.2.0")
        .await
        .unwrap();
    repo.commit("bump version");

    let done = git()
        .flow_finish(
            repo.path(),
            &FlowFinishRequest {
                branch: "release/1.2.0".into(),
                tag_message: Some("Tylia 1.2".into()),
                keep_branch: true,
            },
        )
        .await
        .unwrap();
    assert_eq!(done.merged_into, ["main", "develop"]);
    assert_eq!(done.tag.as_deref(), Some("v1.2.0"));
    assert!(!done.deleted);
    // Annotated tag on main's merge commit, with the given message.
    assert_eq!(repo.git(&["cat-file", "-t", "v1.2.0"]), "tag");
    assert_eq!(
        repo.git(&["rev-parse", "v1.2.0^{commit}"]),
        repo.git(&["rev-parse", "main"])
    );
    assert_eq!(
        repo.git(&["tag", "-l", "--format=%(contents:subject)", "v1.2.0"]),
        "Tylia 1.2"
    );
    assert_eq!(parents(&repo, "main"), 2);
    assert_eq!(parents(&repo, "develop"), 2);
    assert_eq!(repo.git(&["branch", "--show-current"]), "develop");
    assert!(repo.git_ok(&["rev-parse", "--verify", "refs/heads/release/1.2.0"]));
}

#[tokio::test]
async fn only_one_release_at_a_time() {
    let repo = flow_repo().await;
    git()
        .flow_start(repo.path(), FlowKind::Release, "1.0")
        .await
        .unwrap();
    assert_invalid(
        git()
            .flow_start(repo.path(), FlowKind::Release, "1.1")
            .await,
        "release/1.0 is still open",
    );
    // Features don't count.
    git()
        .flow_start(repo.path(), FlowKind::Feature, "a")
        .await
        .unwrap();
}

#[tokio::test]
async fn hotfix_starts_from_main_and_goes_into_an_open_release() {
    let mut repo = flow_repo().await;
    repo.checkout("develop");
    repo.commit("unreleased work");
    git()
        .flow_start(repo.path(), FlowKind::Release, "2.0")
        .await
        .unwrap();
    let main = repo.git(&["rev-parse", "main"]);
    git()
        .flow_start(repo.path(), FlowKind::Hotfix, "1.0.1")
        .await
        .unwrap();
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), main);
    repo.commit("fix crash");

    let done = git()
        .flow_finish(repo.path(), &finish("hotfix/1.0.1"))
        .await
        .unwrap();
    assert_eq!(done.merged_into, ["main", "release/2.0"]);
    assert_eq!(done.tag.as_deref(), Some("v1.0.1"));
    assert_eq!(
        repo.git(&["tag", "-l", "--format=%(contents:subject)", "v1.0.1"]),
        "Hotfix 1.0.1"
    );
    // The fix reached the open release, not develop.
    let has_fix = |branch: &str| {
        repo.git(&["ls-tree", "--name-only", branch])
            .lines()
            .any(|f| f == "fix_crash.txt")
    };
    assert!(has_fix("release/2.0"));
    assert!(!has_fix("develop"));
}

#[tokio::test]
async fn finish_refuses_conflicts_without_changing_anything() {
    let mut repo = flow_repo().await;
    git()
        .flow_start(repo.path(), FlowKind::Release, "1.0")
        .await
        .unwrap();
    repo.commit_file("app.txt", "release\n2\n3\n", "release edit");
    repo.checkout("develop");
    repo.commit_file("app.txt", "develop\n2\n3\n", "develop edit");
    repo.checkout("release/1.0");
    let before = (
        repo.git(&["rev-parse", "main"]),
        repo.git(&["rev-parse", "develop"]),
    );

    assert_invalid(
        git().flow_finish(repo.path(), &finish("release/1.0")).await,
        "Merging release/1.0 into develop would conflict in app.txt",
    );
    assert_eq!(
        (
            repo.git(&["rev-parse", "main"]),
            repo.git(&["rev-parse", "develop"])
        ),
        before
    );
    assert_eq!(repo.git(&["tag", "-l"]), "");
    assert_eq!(repo.git(&["branch", "--show-current"]), "release/1.0");
}

#[tokio::test]
async fn finish_refuses_local_changes_and_existing_tags() {
    let mut repo = flow_repo().await;
    git()
        .flow_start(repo.path(), FlowKind::Release, "1.0")
        .await
        .unwrap();
    repo.commit("release work");
    repo.write("app.txt", "dirty\n");
    assert!(matches!(
        git().flow_finish(repo.path(), &finish("release/1.0")).await,
        Err(GitError::LocalChanges { files, .. }) if files == ["app.txt"]
    ));
    repo.git(&["checkout", "--", "app.txt"]);

    repo.git(&["tag", "v1.0", "main"]);
    assert_invalid(
        git().flow_finish(repo.path(), &finish("release/1.0")).await,
        "“v1.0” already exists",
    );
}

#[tokio::test]
async fn finish_rejects_other_branches_and_needs_setup() {
    let repo = flow_repo().await;
    assert_invalid(
        git().flow_finish(repo.path(), &finish("main")).await,
        "isn't a feature, release or hotfix branch",
    );
    assert_invalid(
        git()
            .flow_finish(repo.path(), &finish("feature/missing"))
            .await,
        "There's no branch",
    );

    let mut plain = TestRepo::new();
    plain.commit("initial");
    assert_invalid(
        git().flow_start(plain.path(), FlowKind::Feature, "x").await,
        "isn't set up",
    );
}
