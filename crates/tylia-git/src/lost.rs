//! Lost commits (Phase 11 B): commits that HEAD or a branch pointed at and that no branch,
//! tag or remote branch reaches any more (after a reset, a rebase, an amend, a deleted
//! branch…), from the reflogs; and, on request, dangling commits no reflog knows either
//! (`git fsck`, e.g. a dropped stash).

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy, split_nul};

/// Lost commits listed at most; the newest come first.
const LIMIT: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LostCommit {
    pub oid: String,
    pub subject: String,
    pub author: String,
    /// When it was lost (the reflog entry's time) or, for a dangling commit, committed;
    /// seconds since the Unix epoch.
    #[ts(type = "number")]
    pub time: i64,
    /// Where it was found: the reflog's ref (`HEAD`, `refs/heads/topic`), or `None` for a
    /// dangling commit found by [`Git::dangling_commits`].
    pub reflog: Option<String>,
    /// The reflog message of the entry that pointed at it (`commit (amend): …`,
    /// `rebase (start): …`); `None` for a dangling commit.
    pub reason: Option<String>,
    /// Lost commits only it reaches (itself included): what restoring it brings back.
    pub commits: usize,
}

impl Git {
    /// Commits the reflogs point at that nothing else reaches, newest first. Only the tips
    /// are listed: a lost commit whose child is lost too is part of that child's chain.
    pub async fn lost_commits(&self, repo: &Path) -> Result<Vec<LostCommit>, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                [
                    "reflog",
                    "show",
                    "--all",
                    "--date=unix",
                    "-z",
                    "--format=%H%x00%gD%x00%gs%x00%s%x00%an",
                ],
            )
            .await?;
        let mut candidates: Vec<LostCommit> = Vec::new();
        let mut seen: HashMap<String, usize> = HashMap::new();
        let fields: Vec<String> = split_nul(&out.stdout).map(lossy).collect();
        for entry in fields.as_chunks::<5>().0 {
            let oid = entry[0].trim_start_matches('\n').to_owned();
            // `refs/heads/topic@{1700000000}`
            let (reflog, time) = entry[1].rsplit_once("@{").unwrap_or((&entry[1], "0}"));
            if reflog == "refs/stash" {
                continue;
            }
            // Listed once; a branch's reflog says more than HEAD's ("lost from topic").
            if let Some(&i) = seen.get(&oid) {
                if candidates[i].reflog.as_deref() == Some("HEAD") && reflog != "HEAD" {
                    candidates[i].reflog = Some(reflog.to_owned());
                }
                continue;
            }
            seen.insert(oid.clone(), candidates.len());
            candidates.push(LostCommit {
                oid,
                subject: entry[3].clone(),
                author: entry[4].clone(),
                time: time.trim_end_matches('}').parse().unwrap_or(0),
                reflog: Some(reflog.to_owned()),
                reason: Some(entry[2].clone()),
                commits: 0,
            });
        }
        candidates.sort_by_key(|c| std::cmp::Reverse(c.time));
        self.keep_lost_tips(repo, candidates).await
    }

    /// Unreachable commits that no reflog knows either (`git fsck`). Walks every object,
    /// so it can take seconds on a large repository.
    pub async fn dangling_commits(&self, repo: &Path) -> Result<Vec<LostCommit>, GitError> {
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                ["fsck", "--unreachable", "--no-progress", "--no-reflogs"],
            )
            .await?;
        let oids: Vec<String> = lossy(&out.stdout)
            .lines()
            .filter_map(|line| line.strip_prefix("unreachable commit "))
            .map(str::to_owned)
            .collect();
        if oids.is_empty() {
            return Ok(Vec::new());
        }
        // Subjects, authors and times, in one call.
        let mut args = vec![
            "show".to_owned(),
            "-s".into(),
            "-z".into(),
            "--format=%H%x00%ct%x00%s%x00%an".into(),
        ];
        args.extend(oids);
        let out = self.run(Some(repo), &args).await?;
        let fields: Vec<String> = split_nul(&out.stdout).map(lossy).collect();
        let mut commits: Vec<LostCommit> = fields
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| LostCommit {
                oid: c[0].trim_start_matches('\n').to_owned(),
                subject: c[2].clone(),
                author: c[3].clone(),
                time: c[1].parse().unwrap_or(0),
                reflog: None,
                reason: None,
                commits: 0,
            })
            .collect();
        commits.sort_by_key(|c| std::cmp::Reverse(c.time));
        self.keep_lost_tips(repo, commits).await
    }

    /// Keeps the candidates that no ref reaches and no other lost candidate contains, with
    /// the number of lost commits each brings back.
    async fn keep_lost_tips(
        &self,
        repo: &Path,
        candidates: Vec<LostCommit>,
    ) -> Result<Vec<LostCommit>, GitError> {
        if candidates.is_empty() {
            return Ok(candidates);
        }
        // Every commit reachable from a candidate but from no ref, with its parents.
        let stdin: String = candidates.iter().map(|c| format!("{}\n", c.oid)).collect();
        let out = self
            .run_with(
                RunOptions {
                    stdin: Some(stdin.as_bytes()),
                    ..RunOptions::in_dir(repo)
                },
                [
                    "rev-list",
                    "--parents",
                    "--stdin",
                    "--not",
                    "--exclude=refs/tylia/*",
                    "--exclude=refs/stash",
                    "--all",
                ],
            )
            .await?;
        let mut parents: HashMap<String, Vec<String>> = HashMap::new();
        for line in lossy(&out.stdout).lines() {
            let mut ids = line.split(' ').map(str::to_owned);
            if let Some(oid) = ids.next() {
                parents.insert(oid, ids.collect());
            }
        }
        let inner: HashSet<&String> = parents.values().flatten().collect();
        let mut tips: Vec<LostCommit> = candidates
            .into_iter()
            .filter(|c| parents.contains_key(&c.oid) && !inner.contains(&c.oid))
            .take(LIMIT)
            .collect();
        for tip in &mut tips {
            tip.commits = chain_len(&tip.oid, &parents);
        }
        Ok(tips)
    }
}

/// Lost commits reachable from `tip` (itself included).
fn chain_len(tip: &str, parents: &HashMap<String, Vec<String>>) -> usize {
    let mut seen = HashSet::new();
    let mut stack = vec![tip];
    while let Some(oid) = stack.pop() {
        if let Some(ps) = parents.get(oid)
            && seen.insert(oid)
        {
            stack.extend(ps.iter().map(String::as_str));
        }
    }
    seen.len()
}
