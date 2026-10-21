//! Interactive rebase on temp repositories: the todo list, every action, stops, conflicts and
//! refusals. The repositories' editors fail (`core.editor=false`, `sequence.editor=false`), so
//! passing tests prove no editor was opened.

use std::process::Command;

use crate::common::TestRepo;
use tylia_git::{Git, GitError, IntegrateOutcome, OperationKind, TodoAction, TodoItem};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

fn repo() -> TestRepo {
    let repo = TestRepo::new();
    repo.git(&["config", "core.editor", "false"]);
    repo.git(&["config", "sequence.editor", "false"]);
    repo
}

/// `base`, then commits `a`, `b`, `c` (each adding its own file); returns the base oid and
/// the three oids.
fn linear() -> (TestRepo, String, [String; 3]) {
    let mut repo = repo();
    let base = repo.commit("base");
    let a = repo.commit("a");
    let b = repo.commit("b");
    let c = repo.commit("c");
    (repo, base, [a, b, c])
}

fn item(oid: &str, action: TodoAction) -> TodoItem {
    TodoItem {
        oid: oid.to_owned(),
        action,
    }
}

fn picks(oids: &[&String]) -> Vec<TodoItem> {
    oids.iter().map(|o| item(o, TodoAction::Pick)).collect()
}

/// Full messages of `base..HEAD`, oldest first.
fn messages(repo: &TestRepo, base: &str) -> Vec<String> {
    let out = repo.git(&[
        "log",
        "--reverse",
        "--format=%B%x00",
        &format!("{base}..HEAD"),
    ]);
    out.split('\0')
        .map(|m| m.trim().to_owned())
        .filter(|m| !m.is_empty())
        .collect()
}

fn files(repo: &TestRepo) -> Vec<String> {
    let mut files: Vec<String> = repo
        .git(&["ls-tree", "--name-only", "HEAD"])
        .lines()
        .map(str::to_owned)
        .collect();
    files.sort();
    files
}

fn head(repo: &TestRepo) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

async fn operation(repo: &TestRepo) -> Option<tylia_git::RepoOperation> {
    git().status(repo.path()).await.unwrap().operation
}

fn assert_invalid<T: std::fmt::Debug>(result: Result<T, GitError>) {
    assert!(
        matches!(result, Err(GitError::InvalidInput(_))),
        "expected InvalidInput, got {result:?}"
    );
}

#[tokio::test]
async fn todo_lists_the_commits_oldest_first() {
    let (repo, base, [a, b, c]) = linear();
    // `a` is on a remote-tracking branch: rewriting it needs a force push.
    repo.git(&["update-ref", "refs/remotes/origin/main", &a]);
    let todo = git().rebase_todo(repo.path(), &base).await.unwrap();
    assert_eq!(todo.base, base);
    assert_eq!(todo.branch.as_deref(), Some("main"));
    let oids: Vec<&str> = todo.commits.iter().map(|c| c.oid.as_str()).collect();
    assert_eq!(oids, [a.as_str(), b.as_str(), c.as_str()]);
    let subjects: Vec<&str> = todo.commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, ["a", "b", "c"]);
    let pushed: Vec<bool> = todo.commits.iter().map(|c| c.pushed).collect();
    assert_eq!(pushed, [true, false, false]);
    assert_eq!(todo.commits[0].author_name, "Test");

    assert!(git().is_rebase_base(repo.path(), &base).await.unwrap());
    assert!(!git().is_rebase_base(repo.path(), &c).await.unwrap());
}

#[tokio::test]
async fn unchanged_plan_is_up_to_date() {
    let (repo, base, [a, b, c]) = linear();
    let before = head(&repo);
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &picks(&[&a, &b, &c]))
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::UpToDate);
    assert_eq!(head(&repo), before);
}

#[tokio::test]
async fn reorders() {
    let (repo, base, [a, b, c]) = linear();
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &picks(&[&c, &a, &b]))
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["c", "a", "b"]);
    assert_eq!(files(&repo), ["a.txt", "b.txt", "base.txt", "c.txt"]);
    assert_eq!(operation(&repo).await, None);
}

#[tokio::test]
async fn rewords_keeping_author_and_unchanged_commits() {
    let (repo, base, [a, b, c]) = linear();
    let author_before = repo.git(&["log", "-1", "--format=%an <%ae> %at", &b]);
    let plan = vec![
        item(&a, TodoAction::Pick),
        item(
            &b,
            TodoAction::Reword {
                message: "b, reworded\n\nWith a body.  \n".to_owned(),
            },
        ),
        item(&c, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(
        messages(&repo, &base),
        ["a", "b, reworded\n\nWith a body.", "c"]
    );
    // The commit before the first change is kept as is.
    assert_eq!(repo.git(&["rev-parse", "HEAD~2"]), a);
    assert_eq!(
        repo.git(&["log", "-1", "--format=%an <%ae> %at", "HEAD~1"]),
        author_before
    );
    assert_eq!(files(&repo), ["a.txt", "b.txt", "base.txt", "c.txt"]);
}

#[tokio::test]
async fn rewords_the_last_commit() {
    let (repo, base, [a, b, c]) = linear();
    let mut plan = picks(&[&a, &b]);
    plan.push(item(
        &c,
        TodoAction::Reword {
            message: "c2".to_owned(),
        },
    ));
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["a", "b", "c2"]);
    assert_eq!(repo.git(&["rev-parse", "HEAD~1"]), b);
}

#[tokio::test]
async fn squashes_with_a_message() {
    let (repo, base, [a, b, c]) = linear();
    let plan = vec![
        item(&a, TodoAction::Pick),
        item(
            &b,
            TodoAction::Squash {
                message: Some("a and b".to_owned()),
            },
        ),
        item(&c, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["a and b", "c"]);
    assert_eq!(
        repo.git(&["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD~1"]),
        "a.txt\nb.txt"
    );
}

#[tokio::test]
async fn squashes_combining_messages() {
    let (repo, base, [a, b, c]) = linear();
    let plan = vec![
        item(&a, TodoAction::Pick),
        item(&b, TodoAction::Squash { message: None }),
        item(&c, TodoAction::Squash { message: None }),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["a\n\nb\n\nc"]);
    assert_eq!(files(&repo), ["a.txt", "b.txt", "base.txt", "c.txt"]);
}

#[tokio::test]
async fn fixup_keeps_the_target_message_and_author() {
    let (repo, base, [a, b, c]) = linear();
    let author = repo.git(&["log", "-1", "--format=%an %at", &a]);
    // Moved up and folded into `a`.
    let plan = vec![
        item(&a, TodoAction::Pick),
        item(&c, TodoAction::Fixup),
        item(&b, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["a", "b"]);
    assert_eq!(
        repo.git(&["log", "-1", "--format=%an %at", "HEAD~1"]),
        author
    );
    assert_eq!(
        repo.git(&["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD~1"]),
        "a.txt\nc.txt"
    );
}

#[tokio::test]
async fn drops() {
    let (repo, base, [a, b, c]) = linear();
    let plan = vec![
        item(&a, TodoAction::Pick),
        item(&b, TodoAction::Drop),
        item(&c, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["a", "c"]);
    assert_eq!(files(&repo), ["a.txt", "base.txt", "c.txt"]);
}

#[tokio::test]
async fn edit_stops_then_continue_finishes() {
    let (repo, base, [a, b, c]) = linear();
    let plan = vec![
        item(&a, TodoAction::Pick),
        item(&b, TodoAction::Edit),
        item(&c, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Stopped);
    let op = operation(&repo).await.expect("the rebase is in progress");
    assert_eq!(op.kind, OperationKind::Rebase);
    assert!(op.editing);
    assert_eq!(op.incoming.as_deref(), Some(&b[..7]));
    assert_eq!(head(&repo), b, "stopped after applying the edited commit");

    // Nothing changed: continue goes on.
    let outcome = git().continue_operation(repo.path()).await.unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(operation(&repo).await, None);
    assert_eq!(messages(&repo, &base), ["a", "b", "c"]);
}

#[tokio::test]
async fn edit_stop_with_staged_changes_amends() {
    let (repo, base, [a, b, c]) = linear();
    let plan = vec![
        item(&a, TodoAction::Edit),
        item(&b, TodoAction::Edit),
        item(&c, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Stopped);
    repo.write("a.txt", "amended");
    repo.git(&["add", "a.txt"]);
    // Stops again at the next `edit`.
    let outcome = git().continue_operation(repo.path()).await.unwrap();
    assert_eq!(outcome, IntegrateOutcome::Stopped);
    assert!(operation(&repo).await.unwrap().editing);
    let outcome = git().continue_operation(repo.path()).await.unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["a", "b", "c"]);
    assert_eq!(repo.git(&["show", "HEAD~2:a.txt"]), "amended");
}

#[tokio::test]
async fn conflicts_stop_and_abort_restores() {
    let mut repo = repo();
    let base = repo.commit_file("f.txt", "1\n", "base");
    let one = repo.commit_file("f.txt", "2\n", "two");
    let two = repo.commit_file("f.txt", "3\n", "three");
    let before = head(&repo);
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &picks(&[&two, &one]))
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Conflicts);
    let op = operation(&repo).await.expect("the rebase is in progress");
    assert_eq!(op.kind, OperationKind::Rebase);
    assert!(!op.editing);

    git().abort_operation(repo.path()).await.unwrap();
    assert_eq!(operation(&repo).await, None);
    assert_eq!(head(&repo), before);
}

#[tokio::test]
async fn refuses_merge_commits_in_the_range() {
    let mut repo = repo();
    let base = repo.commit("base");
    repo.branch("side");
    repo.commit("side");
    repo.checkout("main");
    repo.commit("main");
    repo.merge("side");
    assert_invalid(git().rebase_todo(repo.path(), &base).await);
    // After the merge it's a straight line again.
    let merge = head(&repo);
    let after = repo.commit("after");
    let todo = git().rebase_todo(repo.path(), &merge).await.unwrap();
    assert_eq!(todo.commits.len(), 1);
    assert_eq!(todo.commits[0].oid, after);
}

#[tokio::test]
async fn refuses_bases_that_are_not_ancestors() {
    let (repo, base, [_, _, c]) = linear();
    repo.git(&["checkout", "-q", "-b", "other", &base]);
    let mut other = repo;
    other.commit("other");
    assert_invalid(git().rebase_todo(other.path(), &c).await);
    let head = head(&other);
    assert_invalid(git().rebase_todo(other.path(), &head).await);
    assert_invalid(git().rebase_todo(other.path(), "--all").await);
}

#[tokio::test]
async fn refuses_invalid_plans() {
    let (repo, base, [a, b, c]) = linear();
    let before = head(&repo);
    let plans = [
        // Missing a commit.
        picks(&[&a, &b]),
        // Twice.
        picks(&[&a, &b, &c, &c]),
        // Not in the range.
        picks(&[&a, &b, &base]),
        // Nothing to fold into.
        vec![
            item(&a, TodoAction::Fixup),
            item(&b, TodoAction::Pick),
            item(&c, TodoAction::Pick),
        ],
        vec![
            item(&a, TodoAction::Drop),
            item(&b, TodoAction::Squash { message: None }),
            item(&c, TodoAction::Pick),
        ],
        // Everything dropped.
        vec![
            item(&a, TodoAction::Drop),
            item(&b, TodoAction::Drop),
            item(&c, TodoAction::Drop),
        ],
        // Empty message.
        vec![
            item(&a, TodoAction::Pick),
            item(
                &b,
                TodoAction::Reword {
                    message: "  \n\n".to_owned(),
                },
            ),
            item(&c, TodoAction::Pick),
        ],
    ];
    for plan in plans {
        assert_invalid(git().rebase_interactive(repo.path(), &base, &plan).await);
    }
    assert_eq!(head(&repo), before);
    assert_eq!(operation(&repo).await, None);
}

#[tokio::test]
async fn refuses_local_changes() {
    let (repo, base, [a, b, c]) = linear();
    repo.write("a.txt", "changed");
    let result = git()
        .rebase_interactive(repo.path(), &base, &picks(&[&c, &b, &a]))
        .await;
    match result {
        Err(GitError::LocalChanges { files, .. }) => assert_eq!(files, ["a.txt"]),
        other => panic!("expected LocalChanges, got {other:?}"),
    }
    assert_eq!(operation(&repo).await, None);
    assert_eq!(repo.read("a.txt"), "changed");
}

#[tokio::test]
async fn refuses_while_an_operation_is_in_progress() {
    let (repo, base, [a, b, c]) = linear();
    let plan = vec![
        item(&a, TodoAction::Edit),
        item(&b, TodoAction::Pick),
        item(&c, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Stopped);
    assert_invalid(git().rebase_interactive(repo.path(), &base, &plan).await);
    git().abort_operation(repo.path()).await.unwrap();
}

#[tokio::test]
async fn works_in_a_path_with_spaces_and_quotes() {
    let dir = tempfile::tempdir().unwrap();
    // Windows file names can't contain double quotes.
    let name = if cfg!(windows) {
        "my repo's dir $HOME"
    } else {
        "my repo's \"dir\" $HOME"
    };
    let path = dir.path().join(name);
    std::fs::create_dir_all(&path).unwrap();
    let run = |args: &[&str]| {
        let out = Command::new("git")
            .args(args)
            .current_dir(&path)
            .output()
            .unwrap();
        assert!(out.status.success(), "{args:?}: {out:?}");
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    };
    run(&["init", "-q", "-b", "main"]);
    for (k, v) in [
        ("user.name", "Test"),
        ("user.email", "test@example.com"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.editor", "false"),
        ("sequence.editor", "false"),
    ] {
        run(&["config", k, v]);
    }
    let mut oids = Vec::new();
    for name in ["base", "a", "b"] {
        std::fs::write(path.join(name), name).unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", name]);
        oids.push(run(&["rev-parse", "HEAD"]));
    }
    let plan = vec![
        item(&oids[2], TodoAction::Pick),
        item(
            &oids[1],
            TodoAction::Reword {
                message: "a, moved".to_owned(),
            },
        ),
    ];
    let outcome = git()
        .rebase_interactive(&path, &oids[0], &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(run(&["log", "--format=%s", "-2"]), "a, moved\nb");
}

#[tokio::test]
async fn reworded_commits_stay_signed_when_signing_is_on() {
    let (repo, base, [a, b, c]) = linear();
    // SSH signing with a throwaway key; skipped where ssh-keygen isn't available.
    let key = repo.path().join(".git").join("signing-key");
    let made = std::process::Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-f"])
        .arg(&key)
        .status();
    if !made.is_ok_and(|s| s.success()) {
        eprintln!("ssh-keygen not available; skipping");
        return;
    }
    repo.git(&["config", "gpg.format", "ssh"]);
    repo.git(&["config", "user.signingkey", &key.display().to_string()]);
    repo.git(&["config", "commit.gpgsign", "true"]);
    let plan = vec![
        item(
            &a,
            TodoAction::Reword {
                message: "a2".to_owned(),
            },
        ),
        item(&b, TodoAction::Pick),
        item(&c, TodoAction::Pick),
    ];
    let outcome = git()
        .rebase_interactive(repo.path(), &base, &plan)
        .await
        .unwrap();
    assert_eq!(outcome, IntegrateOutcome::Done);
    assert_eq!(messages(&repo, &base), ["a2", "b", "c"]);
    for rev in ["HEAD~2", "HEAD~1", "HEAD"] {
        assert!(
            repo.git(&["cat-file", "-p", rev]).contains("gpgsig"),
            "{rev} is signed"
        );
    }
}
