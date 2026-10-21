//! History: streams `git log` incrementally, and searches it.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy};

/// Field separator inside a record (records themselves are NUL-terminated with `-z`).
const FIELD_SEP: char = '\x1f';
const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LogScope {
    /// All branches, remotes and tags (stashes excluded).
    #[default]
    All,
    /// Only what is reachable from HEAD.
    Head,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LogOrder {
    #[default]
    Date,
    Topo,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LogOptions {
    pub scope: LogScope,
    pub order: LogOrder,
}

impl LogOptions {
    pub(crate) fn revision_args(&self) -> Vec<&'static str> {
        let order = match self.order {
            LogOrder::Date => "--date-order",
            LogOrder::Topo => "--topo-order",
        };
        match self.scope {
            LogScope::All => vec![order, "--exclude=refs/stash", "--all"],
            LogScope::Head => vec![order, "HEAD"],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogCommit {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub time: i64,
    pub subject: String,
}

fn parse_commit(rec: &[u8]) -> Option<LogCommit> {
    let rec = lossy(rec);
    let mut f = rec.splitn(6, FIELD_SEP);
    Some(LogCommit {
        oid: f.next()?.to_owned(),
        parents: f
            .next()?
            .split(' ')
            .filter(|p| !p.is_empty())
            .map(str::to_owned)
            .collect(),
        author_name: f.next()?.to_owned(),
        author_email: f.next()?.to_owned(),
        time: f.next()?.parse().ok()?,
        subject: f.next()?.to_owned(),
    })
}

/// How a search query is matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SearchField {
    /// Commit message, case-insensitive substring.
    Message,
    /// Author name or email, case-insensitive substring.
    Author,
    /// Commits that touched paths matching a pathspec (e.g. `src/` or `*.rs`).
    Path,
    /// Commit hash prefix (resolved to one commit if unambiguous).
    Hash,
}

impl Git {
    /// Streams history newest first. `on_batch` receives commits in display order — first a
    /// small batch for a fast first paint, then larger ones — and returns `false` to stop
    /// early (the git process is killed). Returns the number of commits read.
    pub async fn stream_log<F>(
        &self,
        repo: &Path,
        opts: LogOptions,
        mut on_batch: F,
    ) -> Result<usize, GitError>
    where
        F: FnMut(Vec<LogCommit>) -> bool,
    {
        const FIRST_BATCH: usize = 200;
        const BATCH: usize = 2000;

        let mut args = vec!["log", "-z", LOG_FORMAT];
        args.extend(opts.revision_args());
        let (mut child, command) = self.spawn(RunOptions::in_dir(repo), &args)?;
        let stdout = child.stdout.take().expect("stdout is piped");
        let mut stderr = child.stderr.take().expect("stderr is piped");
        let stderr_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            let _ = stderr.read_to_end(&mut buf).await;
            buf
        });

        let mut reader = BufReader::with_capacity(256 * 1024, stdout);
        let mut record = Vec::new();
        let mut batch = Vec::with_capacity(FIRST_BATCH);
        let mut batch_size = FIRST_BATCH;
        let mut total = 0;
        loop {
            record.clear();
            let n = reader.read_until(0, &mut record).await?;
            if n == 0 {
                break;
            }
            let rec = record.strip_suffix(b"\0").unwrap_or(&record);
            // A leading newline separates records after the first.
            let rec = rec.strip_prefix(b"\n").unwrap_or(rec);
            if let Some(commit) = parse_commit(rec) {
                batch.push(commit);
                total += 1;
            }
            if batch.len() >= batch_size {
                if !on_batch(std::mem::take(&mut batch)) {
                    let _ = child.kill().await;
                    return Ok(total);
                }
                batch_size = BATCH;
            }
        }
        let status = child.wait().await?;
        let stderr = stderr_task.await.unwrap_or_default();
        if !status.success() {
            // An unborn branch has no history: not an error.
            let stderr = lossy(&stderr);
            if total == 0 && stderr.contains("does not have any commits yet") {
                return Ok(0);
            }
            return Err(GitError::Failed {
                command,
                code: status.code(),
                stderr,
            });
        }
        if !batch.is_empty() {
            on_batch(batch);
        }
        Ok(total)
    }

    /// Hashes of commits in `opts`' scope matching `query`.
    pub async fn search_log(
        &self,
        repo: &Path,
        opts: LogOptions,
        field: SearchField,
        query: &str,
    ) -> Result<Vec<String>, GitError> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        if field == SearchField::Hash {
            if !query.chars().all(|c| c.is_ascii_hexdigit()) {
                return Ok(Vec::new());
            }
            let out = self
                .run_with(
                    RunOptions {
                        ok_codes: &[1, 128],
                        ..RunOptions::in_dir(repo)
                    },
                    [
                        "rev-parse",
                        "-q",
                        "--verify",
                        &format!("{query}^{{commit}}"),
                    ],
                )
                .await?;
            return Ok(lossy(&out.stdout).lines().map(str::to_owned).collect());
        }
        let mut args: Vec<String> = vec!["log".into(), "--format=%H".into()];
        match field {
            SearchField::Message => {
                args.extend(["-i".into(), "-F".into(), format!("--grep={query}")])
            }
            SearchField::Author => {
                args.extend(["-i".into(), "-F".into(), format!("--author={query}")])
            }
            SearchField::Path | SearchField::Hash => {}
        }
        args.extend(opts.revision_args().into_iter().map(str::to_owned));
        if field == SearchField::Path {
            args.extend(["--".into(), query.to_owned()]);
        }
        let out = self.run(Some(repo), &args).await?;
        Ok(lossy(&out.stdout).lines().map(str::to_owned).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_records() {
        let c = parse_commit(
            "abc\x1fp1 p2\x1fAda Lovelace\x1fada@example.com\x1f1700000000\x1fMerge: a \x1f b"
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(c.parents, ["p1", "p2"]);
        assert_eq!(c.time, 1_700_000_000);
        assert_eq!(
            c.subject, "Merge: a \x1f b",
            "separator inside subject survives"
        );
        let root = parse_commit(b"abc\x1f\x1fA\x1fa@x\x1f1\x1froot").unwrap();
        assert!(root.parents.is_empty());
    }
}
