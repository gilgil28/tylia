//! Commit details: message, signatures and changed files.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, lossy, split_nul};
use crate::status::FileStatus;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Signature {
    pub name: String,
    pub email: String,
    #[ts(type = "number")]
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChangedFile {
    pub path: String,
    /// Source of a rename or copy.
    pub old_path: Option<String>,
    pub status: FileStatus,
    /// `None` for binary files.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitDetails {
    pub oid: String,
    pub parents: Vec<String>,
    pub author: Signature,
    pub committer: Signature,
    pub subject: String,
    /// Message after the subject line, trimmed.
    pub body: String,
    /// Changes against the first parent (for merges, like Sourcetree; all files for a root).
    pub files: Vec<ChangedFile>,
}

const SHOW_FORMAT: &str = "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B";

impl Git {
    pub async fn commit_details(&self, repo: &Path, oid: &str) -> Result<CommitDetails, GitError> {
        let meta = self
            .run(Some(repo), ["show", "-s", SHOW_FORMAT, oid, "--"])
            .await?;
        let mut details = parse_show(&meta.stdout)
            .ok_or_else(|| GitError::parse("git show -s", lossy(&meta.stdout)))?;
        let mut args = vec![
            "diff-tree",
            "-r",
            "-z",
            "-M",
            "--no-commit-id",
            "--raw",
            "--numstat",
        ];
        let parent = details.parents.first().cloned();
        match &parent {
            Some(p) => args.extend([p.as_str(), oid]),
            None => args.extend(["--root", oid]),
        }
        let files = self.run(Some(repo), &args).await?;
        details.files = parse_diff_tree(&files.stdout);
        Ok(details)
    }
}

fn parse_show(out: &[u8]) -> Option<CommitDetails> {
    let text = lossy(out);
    let f: Vec<&str> = text.splitn(9, '\0').collect();
    let [oid, parents, an, ae, at, cn, ce, ct, message] = f[..] else {
        return None;
    };
    let message = message.trim_end();
    let (subject, body) = match message.split_once('\n') {
        Some((s, b)) => (s.trim_end(), b.trim()),
        None => (message, ""),
    };
    Some(CommitDetails {
        oid: oid.to_owned(),
        parents: parents.split_whitespace().map(str::to_owned).collect(),
        author: Signature {
            name: an.to_owned(),
            email: ae.to_owned(),
            time: at.parse().ok()?,
        },
        committer: Signature {
            name: cn.to_owned(),
            email: ce.to_owned(),
            time: ct.parse().ok()?,
        },
        subject: subject.to_owned(),
        body: body.to_owned(),
        files: Vec::new(),
    })
}

/// Parses `diff-tree -z --raw --numstat`: raw records (`:modes oids STATUS`, then one or two
/// paths) followed by numstat records (`add\tdel\tpath`, or `add\tdel\t` then two paths).
fn parse_diff_tree(out: &[u8]) -> Vec<ChangedFile> {
    let mut files = Vec::new();
    let mut stats: HashMap<String, (Option<u32>, Option<u32>)> = HashMap::new();
    let mut records = split_nul(out).map(lossy);
    while let Some(rec) = records.next() {
        if let Some(raw) = rec.strip_prefix(':') {
            let status = raw.rsplit(' ').next().unwrap_or_default();
            let letter = status.as_bytes().first().copied().unwrap_or(b'M');
            let two_paths = matches!(letter, b'R' | b'C');
            let first = records.next().unwrap_or_default();
            let (old_path, path) = if two_paths {
                (Some(first), records.next().unwrap_or_default())
            } else {
                (None, first)
            };
            files.push(ChangedFile {
                path,
                old_path,
                status: FileStatus::from_letter(letter).unwrap_or(FileStatus::Modified),
                additions: None,
                deletions: None,
            });
        } else {
            let mut parts = rec.splitn(3, '\t');
            let (Some(add), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            let path = if path.is_empty() {
                records.next();
                records.next().unwrap_or_default()
            } else {
                path.to_owned()
            };
            stats.insert(path, (add.parse().ok(), del.parse().ok()));
        }
    }
    for file in &mut files {
        if let Some(&(a, d)) = stats.get(&file.path) {
            file.additions = a;
            file.deletions = d;
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_show_output() {
        let d = parse_show(
            b"abc\0p1 p2\0Ada\0ada@x\x001700000000\0Bob\0bob@x\x001700000100\0Subject line\n\nBody\nmore\n\n",
        )
        .unwrap();
        assert_eq!(d.parents, ["p1", "p2"]);
        assert_eq!(d.subject, "Subject line");
        assert_eq!(d.body, "Body\nmore");
        assert_eq!(d.committer.time, 1_700_000_100);
    }

    #[test]
    fn parses_raw_and_numstat() {
        let out = b":100644 100644 aaa bbb M\0src/a.rs\0\
:000000 100644 000 ccc A\0new file.txt\0\
:100644 100644 ddd eee R087\0old/name.rs\0new/name.rs\0\
:100644 100644 fff 111 M\0img.png\0\
4\t1\tsrc/a.rs\0\
10\t0\tnew file.txt\0\
2\t2\t\0old/name.rs\0new/name.rs\0\
-\t-\timg.png\0";
        let files = parse_diff_tree(out);
        assert_eq!(files.len(), 4);
        assert_eq!((files[0].additions, files[0].deletions), (Some(4), Some(1)));
        assert_eq!(files[1].status, FileStatus::Added);
        assert_eq!(files[1].path, "new file.txt");
        assert_eq!(files[2].status, FileStatus::Renamed);
        assert_eq!(files[2].old_path.as_deref(), Some("old/name.rs"));
        assert_eq!(files[2].additions, Some(2));
        assert_eq!(files[3].additions, None, "binary");
    }
}
