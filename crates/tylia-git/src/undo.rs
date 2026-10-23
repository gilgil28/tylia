//! Undo and redo of Tylia's own operations (ARCHITECTURE §5.22).
//!
//! Before a write, [`Git::undo_begin`] captures HEAD, every branch and tag, the stash list,
//! the `branch.*` config and, for operations that touch them, the index and working tree
//! (`git stash create`). [`Git::undo_finish`] captures the same afterwards and keeps what
//! changed as a journal entry in `<git dir>/tylia/journal.json`; the objects it names are
//! kept alive by refs under `refs/tylia/undo/`. Undo restores the "before" side once it has
//! checked that the repository is still exactly in the "after" state; redo does the reverse.
//! It refuses rather than overwrite anything changed since.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy, split_nul};

/// Entries kept; older ones (and their refs) are dropped.
const KEEP: usize = 50;
/// Keeps the journal's objects reachable, so `git gc` leaves them.
const KEEP_ALIVE: &str = "refs/tylia/undo";
const ZERO_OID: &str = "0000000000000000000000000000000000000000";

/// What an entry undoes; the frontend names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum UndoKind {
    Commit,
    Amend,
    Merge,
    Rebase,
    InteractiveRebase,
    CherryPick,
    Revert,
    Reset,
    Checkout,
    CreateBranch,
    RenameBranch,
    DeleteBranch,
    CreateTag,
    DeleteTag,
    StashSave,
    StashApply,
    StashPop,
    StashDrop,
    FlowFinish,
}

impl UndoKind {
    /// Changes the index or working tree, which are then captured and restored too.
    fn touches_worktree(self) -> bool {
        !matches!(
            self,
            Self::Commit
                | Self::Amend
                | Self::CreateBranch
                | Self::RenameBranch
                | Self::DeleteBranch
                | Self::CreateTag
                | Self::DeleteTag
                | Self::StashDrop
        )
    }
}

/// What can be undone and redone right now.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UndoState {
    pub undo: Option<UndoKind>,
    pub redo: Option<UndoKind>,
}

/// The state captured before an operation, waiting for [`Git::undo_finish`].
#[derive(Debug)]
pub struct UndoPending {
    kind: UndoKind,
    before: Snapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Head {
    /// The checked-out branch's name; `None` when detached.
    branch: Option<String>,
    /// `None` on an unborn branch.
    oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StashEntry {
    oid: String,
    message: String,
}

/// One side of an operation, everything that matters to undo.
/// The index and working tree as `git stash create` captured them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Changes {
    Clean,
    Stash(String),
}

#[derive(Debug, Clone)]
struct Snapshot {
    head: Head,
    /// Branches and tags: full ref name → object id.
    refs: BTreeMap<String, String>,
    stashes: Vec<StashEntry>,
    /// `branch.<name>.<key>` values per branch.
    config: BTreeMap<String, Vec<(String, String)>>,
    /// Captured only for operations that touch the index and working tree.
    worktree: Option<Changes>,
}

/// One side of a journal entry: only what the operation changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Side {
    head: Head,
    /// Changed refs; `None`: the ref doesn't exist on this side.
    refs: BTreeMap<String, Option<String>>,
    /// The whole stash list, when the operation changed it.
    stashes: Option<Vec<StashEntry>>,
    /// The config of each branch whose config changed.
    config: BTreeMap<String, Vec<(String, String)>>,
    worktree: Option<Changes>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: u64,
    kind: UndoKind,
    /// Seconds since the Unix epoch.
    time: u64,
    undone: bool,
    before: Side,
    after: Side,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Journal {
    /// Names this journal's refs (`refs/tylia/undo/<key>/<id>/…`): linked worktrees each
    /// have a journal but share the refs.
    #[serde(default)]
    key: String,
    next_id: u64,
    entries: Vec<Entry>,
}

impl Journal {
    fn state(&self) -> UndoState {
        UndoState {
            undo: self
                .entries
                .iter()
                .rev()
                .find(|e| !e.undone)
                .map(|e| e.kind),
            // Only what was undone last, and nothing recorded since.
            redo: self.entries.last().filter(|e| e.undone).map(|e| e.kind),
        }
    }
}

impl Git {
    /// Captures the repository before an operation of `kind`.
    pub async fn undo_begin(&self, repo: &Path, kind: UndoKind) -> Result<UndoPending, GitError> {
        Ok(UndoPending {
            kind,
            before: self.snapshot(repo, kind.touches_worktree()).await?,
        })
    }

    /// Records the operation begun with [`Git::undo_begin`], unless it changed nothing or
    /// stopped in the middle (conflicts: the banner's Abort undoes those). Returns what can
    /// be undone now.
    pub async fn undo_finish(
        &self,
        repo: &Path,
        pending: UndoPending,
    ) -> Result<UndoState, GitError> {
        let mut journal = self.journal(repo).await?;
        if self.operation(repo).await?.is_some() {
            return Ok(journal.state());
        }
        let worktree = pending.kind.touches_worktree();
        let after = self.snapshot(repo, worktree).await?;
        let Some((before, after)) = diff(&pending.before, &after) else {
            return Ok(journal.state());
        };
        // A new operation ends what could be redone.
        let dropped: Vec<u64> = journal
            .entries
            .iter()
            .filter(|e| e.undone)
            .map(|e| e.id)
            .collect();
        journal.entries.retain(|e| !e.undone);
        let id = journal.next_id;
        journal.next_id += 1;
        let entry = Entry {
            id,
            kind: pending.kind,
            time: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs()),
            undone: false,
            before,
            after,
        };
        self.keep_alive(repo, &journal.key, &entry).await?;
        journal.entries.push(entry);
        let excess = journal.entries.len().saturating_sub(KEEP);
        let pruned = journal.entries.drain(..excess).map(|e| e.id);
        let release: Vec<u64> = dropped.into_iter().chain(pruned).collect();
        self.save_journal(repo, &journal).await?;
        self.release(repo, &journal.key, &release).await?;
        Ok(journal.state())
    }

    /// What can be undone and redone in `repo`.
    pub async fn undo_state(&self, repo: &Path) -> Result<UndoState, GitError> {
        Ok(self.journal(repo).await?.state())
    }

    /// Undoes the last operation that hasn't been undone.
    pub async fn undo(&self, repo: &Path) -> Result<UndoState, GitError> {
        let mut journal = self.journal(repo).await?;
        let Some(entry) = journal.entries.iter_mut().rev().find(|e| !e.undone) else {
            return Err(GitError::InvalidInput(
                "There's nothing to undo.".to_owned(),
            ));
        };
        self.restore(repo, &entry.after, &entry.before).await?;
        entry.undone = true;
        self.save_journal(repo, &journal).await?;
        Ok(journal.state())
    }

    /// Redoes the operation undone last.
    pub async fn redo(&self, repo: &Path) -> Result<UndoState, GitError> {
        let mut journal = self.journal(repo).await?;
        let Some(entry) = journal.entries.last_mut().filter(|e| e.undone) else {
            return Err(GitError::InvalidInput(
                "There's nothing to redo.".to_owned(),
            ));
        };
        self.restore(repo, &entry.before, &entry.after).await?;
        entry.undone = false;
        self.save_journal(repo, &journal).await?;
        Ok(journal.state())
    }

    /// Moves the repository from `from` (checked first) to `to`.
    async fn restore(&self, repo: &Path, from: &Side, to: &Side) -> Result<(), GitError> {
        self.ensure_idle(repo).await?;
        let now = self.snapshot(repo, from.worktree.is_some()).await?;
        if !self.matches(repo, &now, from).await? {
            return Err(GitError::InvalidInput(
                "The repository changed after this operation (outside Tylia, or with an \
                 operation Tylia can't undo), so undoing it could lose that work. Nothing \
                 was changed."
                    .to_owned(),
            ));
        }

        // Branches and tags, in one transaction that checks each old value.
        let mut stdin = String::from("start\n");
        for (name, target) in &to.refs {
            let old = from.refs.get(name).cloned().flatten();
            let old = old.as_deref().unwrap_or(ZERO_OID);
            match target {
                Some(oid) => stdin.push_str(&format!("update {name} {oid} {old}\n")),
                None => stdin.push_str(&format!("delete {name} {old}\n")),
            }
        }
        stdin.push_str("prepare\ncommit\n");
        self.run_with(
            RunOptions {
                stdin: Some(stdin.as_bytes()),
                ..RunOptions::in_dir(repo)
            },
            ["update-ref", "--stdin"],
        )
        .await?;

        // HEAD: attached to the branch (which already points where it should), or detached.
        match (&to.head.branch, &to.head.oid) {
            (Some(branch), _) => {
                self.run(
                    Some(repo),
                    ["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")],
                )
                .await?;
            }
            (None, Some(oid)) => {
                self.run(Some(repo), ["update-ref", "--no-deref", "HEAD", oid])
                    .await?;
            }
            (None, None) => {}
        }

        for (branch, values) in &to.config {
            self.set_branch_config(repo, branch, values).await?;
        }

        // The index and working tree: `from`'s were checked to be the ones the operation
        // left, so resetting loses nothing; then `to`'s changes go back on top.
        if let Some(worktree) = &to.worktree {
            if to.head.oid.is_some() {
                self.run(Some(repo), ["reset", "-q", "--hard", "HEAD"])
                    .await?;
            }
            if let Changes::Stash(changes) = worktree {
                self.run(Some(repo), ["stash", "apply", "-q", "--index", changes])
                    .await?;
            }
        }

        if let Some(stashes) = &to.stashes {
            self.set_stashes(repo, stashes).await?;
        }
        Ok(())
    }

    /// The repository is in `side`'s state, as far as `side` describes it.
    async fn matches(&self, repo: &Path, now: &Snapshot, side: &Side) -> Result<bool, GitError> {
        if now.head != side.head {
            return Ok(false);
        }
        for (name, oid) in &side.refs {
            if now.refs.get(name) != oid.as_ref() {
                return Ok(false);
            }
        }
        if side.stashes.as_ref().is_some_and(|s| *s != now.stashes) {
            return Ok(false);
        }
        match (&side.worktree, &now.worktree) {
            (Some(expected), Some(current)) => self.same_changes(repo, expected, current).await,
            _ => Ok(true),
        }
    }

    /// Two `stash create` captures hold the same index and working tree.
    async fn same_changes(&self, repo: &Path, a: &Changes, b: &Changes) -> Result<bool, GitError> {
        match (a, b) {
            (Changes::Clean, Changes::Clean) => Ok(true),
            (Changes::Stash(a), Changes::Stash(b)) => {
                let trees = |oid: &str| [format!("{oid}^{{tree}}"), format!("{oid}^2^{{tree}}")];
                let out = self
                    .run(
                        Some(repo),
                        ["rev-parse"]
                            .into_iter()
                            .map(str::to_owned)
                            .chain(trees(a))
                            .chain(trees(b)),
                    )
                    .await?;
                let ids: Vec<String> = lossy(&out.stdout).lines().map(str::to_owned).collect();
                Ok(ids.len() == 4 && ids[0] == ids[2] && ids[1] == ids[3])
            }
            _ => Ok(false),
        }
    }

    async fn snapshot(&self, repo: &Path, worktree: bool) -> Result<Snapshot, GitError> {
        let opts = RunOptions {
            c_locale: true,
            ok_codes: &[1],
            ..RunOptions::in_dir(repo)
        };
        let (branch, oid, refs, stashes, config) = tokio::join!(
            self.run_with(opts, ["symbolic-ref", "-q", "--short", "HEAD"]),
            self.run_with(opts, ["rev-parse", "-q", "--verify", "HEAD"]),
            self.run_with(
                opts,
                [
                    "for-each-ref",
                    "--format=%(refname)%00%(objectname)%00",
                    "refs/heads",
                    "refs/tags",
                ],
            ),
            self.run_with(opts, ["stash", "list", "-z", "--format=%H%x00%gs"]),
            self.run_with(opts, ["config", "-z", "--get-regexp", r"^branch\."]),
        );
        let line = |out: Result<crate::runner::GitOutput, GitError>| -> Result<_, GitError> {
            let text = lossy(&out?.stdout).trim().to_owned();
            Ok((!text.is_empty()).then_some(text))
        };
        let head = Head {
            branch: line(branch)?,
            oid: line(oid)?,
        };
        let refs = pairs(&refs?.stdout).collect();
        let stashes = pairs(&stashes?.stdout)
            .map(|(oid, message)| StashEntry { oid, message })
            .collect();
        let mut by_branch: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
        for item in split_nul(&config?.stdout).map(lossy) {
            let (key, value) = item.split_once('\n').unwrap_or((&item, ""));
            // branch.<name>.<key>, where <name> may itself contain dots.
            if let Some((branch, setting)) = key
                .strip_prefix("branch.")
                .and_then(|rest| rest.rsplit_once('.'))
            {
                by_branch
                    .entry(branch.to_owned())
                    .or_default()
                    .push((setting.to_owned(), value.to_owned()));
            }
        }
        let worktree = if !worktree {
            None
        } else if head.oid.is_none() {
            Some(Changes::Clean)
        } else {
            Some(
                match line(self.run_with(opts, ["stash", "create"]).await)? {
                    Some(oid) => Changes::Stash(oid),
                    None => Changes::Clean,
                },
            )
        };
        Ok(Snapshot {
            head,
            refs,
            stashes,
            config: by_branch,
            worktree,
        })
    }

    async fn set_branch_config(
        &self,
        repo: &Path,
        branch: &str,
        values: &[(String, String)],
    ) -> Result<(), GitError> {
        let section = format!("branch.{branch}");
        // Fails when there's no such section, which is fine.
        self.run_with(
            RunOptions {
                ok_codes: &[128],
                ..RunOptions::in_dir(repo)
            },
            ["config", "--remove-section", &section],
        )
        .await?;
        for (key, value) in values {
            self.run(
                Some(repo),
                ["config", "--add", &format!("{section}.{key}"), value],
            )
            .await?;
        }
        Ok(())
    }

    /// Rebuilds the stash list as `stashes` (newest first): `refs/stash`'s reflog is the list.
    async fn set_stashes(&self, repo: &Path, stashes: &[StashEntry]) -> Result<(), GitError> {
        self.run_with(
            RunOptions {
                ok_codes: &[1],
                ..RunOptions::in_dir(repo)
            },
            ["update-ref", "-d", "refs/stash"],
        )
        .await?;
        for stash in stashes.iter().rev() {
            self.run(
                Some(repo),
                ["stash", "store", "-q", "-m", &stash.message, &stash.oid],
            )
            .await?;
        }
        Ok(())
    }

    /// Refs under `refs/tylia/undo/<id>/` for every object the entry names.
    async fn keep_alive(&self, repo: &Path, key: &str, entry: &Entry) -> Result<(), GitError> {
        let mut oids = BTreeSet::new();
        for side in [&entry.before, &entry.after] {
            oids.extend(side.head.oid.iter().cloned());
            oids.extend(side.refs.values().flatten().cloned());
            oids.extend(side.stashes.iter().flatten().map(|s| s.oid.clone()));
            if let Some(Changes::Stash(oid)) = &side.worktree {
                oids.insert(oid.clone());
            }
        }
        let stdin: String = oids
            .iter()
            .enumerate()
            .map(|(i, oid)| format!("update {KEEP_ALIVE}/{key}/{}/{i} {oid}\n", entry.id))
            .collect();
        if stdin.is_empty() {
            return Ok(());
        }
        self.run_with(
            RunOptions {
                stdin: Some(stdin.as_bytes()),
                ..RunOptions::in_dir(repo)
            },
            ["update-ref", "--stdin"],
        )
        .await
        .map(|_| ())
    }

    /// Deletes the keep-alive refs of dropped entries.
    async fn release(&self, repo: &Path, key: &str, ids: &[u64]) -> Result<(), GitError> {
        if ids.is_empty() {
            return Ok(());
        }
        let patterns: Vec<String> = ids
            .iter()
            .map(|id| format!("{KEEP_ALIVE}/{key}/{id}/"))
            .collect();
        let out = self
            .run(
                Some(repo),
                ["for-each-ref", "--format=delete %(refname)"]
                    .into_iter()
                    .map(str::to_owned)
                    .chain(patterns),
            )
            .await?;
        if out.stdout.is_empty() {
            return Ok(());
        }
        self.run_with(
            RunOptions {
                stdin: Some(&out.stdout),
                ..RunOptions::in_dir(repo)
            },
            ["update-ref", "--stdin"],
        )
        .await
        .map(|_| ())
    }

    async fn journal_path(&self, repo: &Path) -> Result<PathBuf, GitError> {
        Ok(self.git_dir(repo).await?.join("tylia").join("journal.json"))
    }

    async fn journal(&self, repo: &Path) -> Result<Journal, GitError> {
        let path = self.journal_path(repo).await?;
        // A missing or unreadable journal is an empty one: undo is a convenience.
        let mut journal: Journal = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        if journal.key.is_empty() {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos());
            journal.key = format!("{nanos:x}");
        }
        Ok(journal)
    }

    async fn save_journal(&self, repo: &Path, journal: &Journal) -> Result<(), GitError> {
        let path = self.journal_path(repo).await?;
        let write = || -> std::io::Result<()> {
            std::fs::create_dir_all(path.parent().expect("journal.json has a parent"))?;
            let temp = path.with_extension("json.tmp");
            std::fs::write(
                &temp,
                serde_json::to_vec(journal).expect("journal serializes"),
            )?;
            std::fs::rename(&temp, &path)
        };
        write()
            .map_err(|err| GitError::InvalidInput(format!("Couldn't save the undo history: {err}")))
    }
}

/// NUL-separated pairs: `a\0b\0` (or `a\0b\n` lines from `for-each-ref`).
fn pairs(bytes: &[u8]) -> impl Iterator<Item = (String, String)> + '_ {
    let mut parts = split_nul(bytes).map(|part| lossy(part).trim_matches('\n').to_owned());
    std::iter::from_fn(move || {
        let a = parts.next()?;
        let b = parts.next()?;
        Some((a, b))
    })
    .filter(|(a, _)| !a.is_empty())
}

/// What changed between the two snapshots, as journal sides; `None` when nothing did.
fn diff(before: &Snapshot, after: &Snapshot) -> Option<(Side, Side)> {
    let names: BTreeSet<&String> = before.refs.keys().chain(after.refs.keys()).collect();
    let mut refs_before = BTreeMap::new();
    let mut refs_after = BTreeMap::new();
    for name in names {
        let (b, a) = (before.refs.get(name), after.refs.get(name));
        if b != a {
            refs_before.insert(name.clone(), b.cloned());
            refs_after.insert(name.clone(), a.cloned());
        }
    }
    let stashes_changed = before.stashes != after.stashes;
    let branches: BTreeSet<&String> = before.config.keys().chain(after.config.keys()).collect();
    let mut config_before = BTreeMap::new();
    let mut config_after = BTreeMap::new();
    for branch in branches {
        let (b, a) = (before.config.get(branch), after.config.get(branch));
        if b != a {
            config_before.insert(branch.clone(), b.cloned().unwrap_or_default());
            config_after.insert(branch.clone(), a.cloned().unwrap_or_default());
        }
    }
    let worktree_changed = before.worktree != after.worktree;
    if before.head == after.head
        && refs_before.is_empty()
        && !stashes_changed
        && config_before.is_empty()
        && !worktree_changed
    {
        return None;
    }
    let side = |s: &Snapshot, refs, config| Side {
        head: s.head.clone(),
        refs,
        stashes: stashes_changed.then(|| s.stashes.clone()),
        config,
        worktree: s.worktree.clone(),
    };
    Some((
        side(before, refs_before, config_before),
        side(after, refs_after, config_after),
    ))
}
