//! Interactive rebase without an editor: the commits after a base commit, and replaying them
//! in a new order with pick / reword / edit / squash / fixup / drop.
//!
//! The todo list is written to a file in the git dir and copied over Git's own by a sequence
//! editor that uses only shell built-ins (see [`SEQUENCE_EDITOR`]). New messages never go
//! through an editor either: a commit whose message changes (reword, or the target of a squash)
//! is first recreated with `commit-tree` — same tree, parent and author, new message — and the
//! todo picks that copy instead. Squashed commits then become plain `fixup`s, which keep the
//! target's (already final) message. Ranges with merge commits are refused.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::integrate::IntegrateOutcome;
use crate::ops::no_editor_env;
use crate::runner::{Git, RunOptions, lossy, split_nul};
use crate::status::OperationKind;

/// The environment variable that tells [`SEQUENCE_EDITOR`] where Tylia's todo list is.
const TODO_VAR: &str = "TYLIA_REBASE_TODO";

/// `GIT_SEQUENCE_EDITOR` for `rebase -i`. Git runs it through its shell as
/// `<editor> "$@"` with the path of its todo list; this copies Tylia's list (named by
/// [`TODO_VAR`], so no path is ever quoted into the command) over it, line by line with
/// shell built-ins only (`read`, `printf`), which works the same in Git for Windows' `sh`.
const SEQUENCE_EDITOR: &str = "tylia_todo() { while IFS= read -r line || [ -n \"$line\" ]; do \
     printf '%s\\n' \"$line\"; done < \"$TYLIA_REBASE_TODO\" > \"$1\"; }; tylia_todo";

/// File in the git dir holding the todo list while `rebase -i` starts.
const TODO_FILE: &str = "tylia-rebase-todo";

/// Field separator inside a record (records are NUL-terminated with `-z`).
const FIELD_SEP: char = '\x1f';
const TODO_FORMAT: &str = "--format=%H%x1f%an%x1f%ae%x1f%at%x1f%ad%x1f%B";

/// One commit an interactive rebase from a base commit replays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TodoCommit {
    pub oid: String,
    pub subject: String,
    /// The whole message (subject, blank line, body), trailing whitespace trimmed.
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    #[ts(type = "number")]
    pub time: i64,
    /// Already on a remote-tracking branch: rewriting it means a force push.
    pub pushed: bool,
}

/// What an interactive rebase of the current branch from `base` would list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RebaseTodo {
    /// The commit the others are replayed onto (full oid).
    pub base: String,
    /// The branch being rebased; `None` on a detached HEAD.
    pub branch: Option<String>,
    /// Oldest first, as Git's todo list (and the order they are applied in).
    pub commits: Vec<TodoCommit>,
}

/// What to do with one commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export)]
pub enum TodoAction {
    /// Keep it as is.
    Pick,
    /// Keep its changes with a new message.
    Reword { message: String },
    /// Apply it, then stop so it can be amended (the rebase stays in progress).
    Edit,
    /// Fold into the commit before it, combining the messages. `message` is the message for
    /// the combined commit (the last one given in a run of squashes wins); without one, the
    /// messages are joined with a blank line between them, like Git's default.
    Squash { message: Option<String> },
    /// Fold into the commit before it, keeping that commit's message.
    Fixup,
    /// Leave it out.
    Drop,
}

/// One line of the plan, in the new order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TodoItem {
    pub oid: String,
    pub action: TodoAction,
}

/// A commit of the range with what `commit-tree` needs to recreate it.
struct RangeCommit {
    commit: TodoCommit,
    /// `GIT_AUTHOR_DATE` (`<seconds> <offset>`).
    author_date: String,
}

fn invalid(msg: impl Into<String>) -> GitError {
    GitError::InvalidInput(msg.into())
}

impl Git {
    /// The commits an interactive rebase of HEAD from `base` would replay, oldest first.
    /// `base` must be an ancestor of HEAD; a range with merge commits is refused.
    pub async fn rebase_todo(&self, repo: &Path, base: &str) -> Result<RebaseTodo, GitError> {
        let (base, commits) = self.rebase_range(repo, base).await?;
        let branch = self.current_branch(repo).await?;
        Ok(RebaseTodo {
            base,
            branch,
            commits: commits.into_iter().map(|c| c.commit).collect(),
        })
    }

    /// Whether `oid` is an ancestor of HEAD other than HEAD itself: a starting point for an
    /// interactive rebase.
    pub async fn is_rebase_base(&self, repo: &Path, oid: &str) -> Result<bool, GitError> {
        let base = self.resolve_commit(repo, oid).await?;
        let Some(head) = self.head_oid(repo).await? else {
            return Ok(false);
        };
        Ok(base != head && self.is_ancestor(repo, &base, &head).await?)
    }

    /// Replays the commits after `base` as `plan` says (every commit of
    /// [`rebase_todo`](Self::rebase_todo) exactly once, in the new order), without opening an
    /// editor. `Stopped` when it paused at an `edit`, `Conflicts` when a step conflicts; both
    /// leave the rebase in progress for continue / skip / abort.
    pub async fn rebase_interactive(
        &self,
        repo: &Path,
        base: &str,
        plan: &[TodoItem],
    ) -> Result<IntegrateOutcome, GitError> {
        self.ensure_idle(repo).await?;
        let (base, commits) = self.rebase_range(repo, base).await?;
        let by_oid: HashMap<&str, &RangeCommit> =
            commits.iter().map(|c| (c.commit.oid.as_str(), c)).collect();
        check_plan(plan, &by_oid)?;

        let mut lines = Vec::with_capacity(plan.len());
        for (i, item) in plan.iter().enumerate() {
            let line = match &item.action {
                TodoAction::Pick | TodoAction::Reword { .. } | TodoAction::Edit => {
                    let original = by_oid[item.oid.as_str()];
                    let message = group_message(plan, i, &by_oid);
                    let oid = if clean_message(&message) == clean_message(&original.commit.message)
                    {
                        item.oid.clone()
                    } else {
                        self.with_message(repo, original, &message).await?
                    };
                    let verb = if item.action == TodoAction::Edit {
                        "edit"
                    } else {
                        "pick"
                    };
                    format!("{verb} {oid}")
                }
                // The target already carries the combined message.
                TodoAction::Squash { .. } | TodoAction::Fixup => format!("fixup {}", item.oid),
                TodoAction::Drop => format!("drop {}", item.oid),
            };
            lines.push(line);
        }

        let todo_path = self.git_dir(repo).await?.join(TODO_FILE);
        let mut todo = lines.join("\n");
        todo.push('\n');
        std::fs::write(&todo_path, todo)?;
        let mut env = no_editor_env();
        env.retain(|(k, _)| k != "GIT_SEQUENCE_EDITOR");
        env.push(("GIT_SEQUENCE_EDITOR".to_owned(), SEQUENCE_EDITOR.to_owned()));
        env.push((TODO_VAR.to_owned(), shell_path(&todo_path)));
        let before = self.head_oid(repo).await?;
        let attempt = self
            .attempt(
                repo,
                [
                    // The todo replaces originals with reworded copies; that isn't "missing".
                    "-c",
                    "rebase.missingCommitsCheck=ignore",
                    "rebase",
                    "-i",
                    "--no-autostash",
                    "--no-update-refs",
                    &base,
                ],
                &env,
            )
            .await;
        let _ = std::fs::remove_file(&todo_path);
        let attempt = attempt?;

        if attempt.ok() {
            if self.rebase_in_progress(repo).await? {
                return Ok(IntegrateOutcome::Stopped);
            }
            return Ok(if self.head_oid(repo).await? == before {
                IntegrateOutcome::UpToDate
            } else {
                IntegrateOutcome::Done
            });
        }
        if self.has_conflicts(repo).await? {
            Ok(IntegrateOutcome::Conflicts)
        } else {
            Err(self.failure(repo, attempt).await)
        }
    }

    /// Whether a rebase is (still) in progress.
    pub(crate) async fn rebase_in_progress(&self, repo: &Path) -> Result<bool, GitError> {
        Ok(self
            .operation(repo)
            .await?
            .is_some_and(|op| op.kind == OperationKind::Rebase))
    }

    /// The resolved base and the commits after it up to HEAD, oldest first.
    async fn rebase_range(
        &self,
        repo: &Path,
        base: &str,
    ) -> Result<(String, Vec<RangeCommit>), GitError> {
        let base = self.resolve_commit(repo, base).await?;
        let head = self
            .head_oid(repo)
            .await?
            .ok_or_else(|| invalid("There are no commits to rebase yet."))?;
        if base == head {
            return Err(invalid(
                "There are no commits after this one on the current branch.",
            ));
        }
        if !self.is_ancestor(repo, &base, &head).await? {
            return Err(invalid(
                "This commit isn’t on the current branch, so there’s nothing to rebase from it.",
            ));
        }
        let range = format!("{base}..{head}");
        let merges = self
            .run(
                Some(repo),
                ["rev-list", "--count", "--merges", &range, "--"],
            )
            .await?;
        if lossy(&merges.stdout).trim() != "0" {
            return Err(invalid(
                "The commits after this one include a merge commit. Interactive rebase in Tylia \
                 works on a straight line of commits; start from a commit after the merge.",
            ));
        }
        let out = self
            .run(
                Some(repo),
                [
                    "log",
                    "--reverse",
                    "-z",
                    "--date=raw",
                    TODO_FORMAT,
                    &range,
                    "--",
                ],
            )
            .await?;
        let unpushed = self
            .run(Some(repo), ["rev-list", &range, "--not", "--remotes", "--"])
            .await?;
        let unpushed: HashSet<String> =
            lossy(&unpushed.stdout).lines().map(str::to_owned).collect();
        let commits = split_nul(&out.stdout)
            .map(|record| {
                parse_record(&lossy(record), &unpushed)
                    .ok_or_else(|| GitError::parse("git log", lossy(record)))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok((base, commits))
    }

    /// `merge-base --is-ancestor`.
    async fn is_ancestor(&self, repo: &Path, ancestor: &str, of: &str) -> Result<bool, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..RunOptions::in_dir(repo)
                },
                ["merge-base", "--is-ancestor", ancestor, of],
            )
            .await?;
        Ok(out.code == Some(0))
    }

    /// A copy of `original` (same tree, parent and author) with `message`; returns its oid.
    async fn with_message(
        &self,
        repo: &Path,
        original: &RangeCommit,
        message: &str,
    ) -> Result<String, GitError> {
        let c = &original.commit;
        let message = clean_message(message);
        let env = [
            ("GIT_AUTHOR_NAME", c.author_name.as_str()),
            ("GIT_AUTHOR_EMAIL", c.author_email.as_str()),
            ("GIT_AUTHOR_DATE", original.author_date.as_str()),
        ]
        .map(|(k, v)| (k.to_owned(), v.to_owned()));
        let tree = format!("{}^{{tree}}", c.oid);
        let parent = format!("{}^", c.oid);
        let mut args = vec!["commit-tree", &tree, "-p", &parent, "-F", "-"];
        // Unlike `commit`, `commit-tree` doesn't sign on its own: honour commit.gpgSign.
        let sign = self
            .config_value(repo, "commit.gpgsign")
            .await?
            .is_some_and(|v| {
                matches!(v.to_ascii_lowercase().as_str(), "true" | "yes" | "on" | "1")
            });
        if sign {
            args.push("-S");
        }
        let out = self
            .run_with(
                RunOptions {
                    stdin: Some(message.as_bytes()),
                    env: &env,
                    ..RunOptions::in_dir(repo)
                },
                &args,
            )
            .await?;
        Ok(lossy(&out.stdout).trim().to_owned())
    }
}

/// `oid ␟ author name ␟ email ␟ time ␟ raw date ␟ message`.
fn parse_record(record: &str, unpushed: &HashSet<String>) -> Option<RangeCommit> {
    let record = record.trim_start_matches('\n');
    let mut f = record.splitn(6, FIELD_SEP);
    let oid = f.next()?.to_owned();
    let author_name = f.next()?.to_owned();
    let author_email = f.next()?.to_owned();
    let time = f.next()?.parse().ok()?;
    let author_date = f.next()?.to_owned();
    let message = f.next()?.trim_end().to_owned();
    let subject = message.lines().next().unwrap_or_default().to_owned();
    Some(RangeCommit {
        commit: TodoCommit {
            pushed: !unpushed.contains(&oid),
            oid,
            subject,
            message,
            author_name,
            author_email,
            time,
        },
        author_date,
    })
}

/// Checks that `plan` lists every commit of the range exactly once, that every squash / fixup
/// has a commit to fold into, that messages aren't empty, and that something is kept.
fn check_plan(plan: &[TodoItem], range: &HashMap<&str, &RangeCommit>) -> Result<(), GitError> {
    let mut seen = HashSet::new();
    for item in plan {
        if !range.contains_key(item.oid.as_str()) {
            return Err(invalid(format!(
                "{} isn’t one of the commits being rebased. The branch may have changed; \
                 reopen the editor.",
                short(&item.oid)
            )));
        }
        if !seen.insert(item.oid.as_str()) {
            return Err(invalid(format!(
                "{} is listed more than once.",
                short(&item.oid)
            )));
        }
    }
    if seen.len() != range.len() {
        return Err(invalid(
            "The plan doesn’t list every commit being rebased. The branch may have changed; \
             reopen the editor.",
        ));
    }
    let mut has_target = false;
    for item in plan {
        match &item.action {
            TodoAction::Squash { .. } | TodoAction::Fixup if !has_target => {
                return Err(invalid(format!(
                    "{} can’t be squashed: there’s no commit before it to fold it into.",
                    short(&item.oid)
                )));
            }
            TodoAction::Reword { message } if clean_message(message).is_empty() => {
                return Err(invalid(format!(
                    "The new message for {} is empty.",
                    short(&item.oid)
                )));
            }
            TodoAction::Squash {
                message: Some(message),
            } if clean_message(message).is_empty() => {
                return Err(invalid(format!(
                    "The message for the commits squashed with {} is empty.",
                    short(&item.oid)
                )));
            }
            TodoAction::Pick | TodoAction::Reword { .. } | TodoAction::Edit => has_target = true,
            _ => {}
        }
    }
    if !has_target {
        return Err(invalid(
            "Every commit would be dropped. To remove them all, reset the branch instead.",
        ));
    }
    Ok(())
}

/// The message of the commit made from `plan[target]` and the squash / fixup lines that
/// follow it (dropped lines in between don't end the run).
fn group_message(plan: &[TodoItem], target: usize, range: &HashMap<&str, &RangeCommit>) -> String {
    let message_of = |oid: &str| range[oid].commit.message.clone();
    let first = match &plan[target].action {
        TodoAction::Reword { message } => message.clone(),
        _ => message_of(&plan[target].oid),
    };
    let mut parts = vec![first];
    let mut chosen = None;
    for item in &plan[target + 1..] {
        match &item.action {
            TodoAction::Squash { message } => {
                parts.push(message_of(&item.oid));
                if let Some(m) = message {
                    chosen = Some(m.clone());
                }
            }
            TodoAction::Fixup | TodoAction::Drop => {}
            _ => break,
        }
    }
    chosen.unwrap_or_else(|| {
        parts
            .iter()
            .map(|p| p.trim())
            .collect::<Vec<_>>()
            .join("\n\n")
    })
}

/// Git's `--cleanup=whitespace`: no trailing whitespace, no leading / trailing blank lines,
/// runs of blank lines collapsed; ends with a newline (empty if there's no text).
fn clean_message(message: &str) -> String {
    let mut out = String::new();
    let mut blank = false;
    for line in message.lines().map(str::trim_end) {
        if line.is_empty() {
            blank = !out.is_empty();
            continue;
        }
        if blank {
            out.push('\n');
            blank = false;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn short(oid: &str) -> &str {
    oid.get(..7).unwrap_or(oid)
}

/// A path for Git's shell: forward slashes on Windows (`C:/x/.git/…`), which its `sh`
/// reads as is.
fn shell_path(path: &Path) -> String {
    let s = path.display().to_string();
    if cfg!(windows) {
        s.replace('\\', "/")
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_messages() {
        assert_eq!(
            clean_message("  \nSubject  \n\n\n\nBody\t\n\n"),
            "Subject\n\nBody\n"
        );
        assert_eq!(clean_message("\n \n"), "");
        assert_eq!(clean_message("One"), "One\n");
    }

    fn commit(oid: &str, message: &str) -> RangeCommit {
        RangeCommit {
            commit: TodoCommit {
                oid: oid.to_owned(),
                subject: message.lines().next().unwrap_or_default().to_owned(),
                message: message.to_owned(),
                author_name: "A".to_owned(),
                author_email: "a@example.com".to_owned(),
                time: 0,
                pushed: false,
            },
            author_date: "0 +0000".to_owned(),
        }
    }

    fn item(oid: &str, action: TodoAction) -> TodoItem {
        TodoItem {
            oid: oid.to_owned(),
            action,
        }
    }

    #[test]
    fn group_messages() {
        let (a, b, c) = (commit("a", "A"), commit("b", "B"), commit("c", "C"));
        let range: HashMap<&str, &RangeCommit> = [("a", &a), ("b", &b), ("c", &c)].into();
        let plan = [
            item("a", TodoAction::Pick),
            item("b", TodoAction::Squash { message: None }),
            item("c", TodoAction::Fixup),
        ];
        assert_eq!(group_message(&plan, 0, &range), "A\n\nB");
        let plan = [
            item(
                "a",
                TodoAction::Reword {
                    message: "A2".to_owned(),
                },
            ),
            item("b", TodoAction::Drop),
            item(
                "c",
                TodoAction::Squash {
                    message: Some("Both".to_owned()),
                },
            ),
        ];
        assert_eq!(group_message(&plan, 0, &range), "Both");
        let plan = [item("a", TodoAction::Pick), item("b", TodoAction::Pick)];
        assert_eq!(group_message(&plan, 0, &range), "A");
    }

    #[test]
    fn checks_plans() {
        let (a, b) = (commit("a", "A"), commit("b", "B"));
        let range: HashMap<&str, &RangeCommit> = [("a", &a), ("b", &b)].into();
        let ok = [item("b", TodoAction::Pick), item("a", TodoAction::Fixup)];
        assert!(check_plan(&ok, &range).is_ok());
        for bad in [
            vec![item("a", TodoAction::Pick)],
            vec![item("a", TodoAction::Pick), item("a", TodoAction::Pick)],
            vec![item("a", TodoAction::Pick), item("x", TodoAction::Pick)],
            vec![item("a", TodoAction::Fixup), item("b", TodoAction::Pick)],
            vec![
                item("a", TodoAction::Drop),
                item("b", TodoAction::Squash { message: None }),
            ],
            vec![item("a", TodoAction::Drop), item("b", TodoAction::Drop)],
            vec![
                item(
                    "a",
                    TodoAction::Reword {
                        message: " \n".to_owned(),
                    },
                ),
                item("b", TodoAction::Pick),
            ],
        ] {
            assert!(check_plan(&bad, &range).is_err(), "{bad:?}");
        }
    }
}
