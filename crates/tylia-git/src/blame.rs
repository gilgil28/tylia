//! Blame: who last changed each line of a file, at a commit or in the working copy
//! (`git blame --porcelain`).

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use serde::Serialize;
use tokio::io::AsyncReadExt;
use ts_rs::TS;

use crate::error::GitError;
use crate::ops::check_rev;
use crate::runner::{Git, RunOptions, lossy};
use crate::worktree::repo_path;

/// Files larger than this are not blamed unless forced (blame output is several times the
/// file's size, and Git's work grows with the history).
const MAX_BLAME_BYTES: u64 = 1024 * 1024;
/// Git's own heuristic: a NUL byte in the first 8000 bytes means binary.
const BINARY_PROBE: usize = 8000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Blame {
    pub path: String,
    /// The commit blamed at; `None` for the working copy (uncommitted lines included).
    pub rev: Option<String>,
    pub content: BlameContent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum BlameContent {
    Lines {
        /// Each commit once, in order of first appearance.
        commits: Vec<BlameCommit>,
        lines: Vec<BlameLine>,
    },
    Binary,
    /// Over the size limit; request again with `force` to blame it anyway.
    TooLarge {
        #[ts(type = "number")]
        bytes: u64,
    },
    /// The file isn't in that commit (or, for the working copy, not tracked or not on disk).
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BlameCommit {
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    #[ts(type = "number")]
    pub author_time: i64,
    pub summary: String,
    /// The file's path in this commit (differs from the blamed path across renames).
    pub path: String,
    /// The parent and the file's path there: what to blame next to see the line before this
    /// commit changed it. `None` for the commit that added the file.
    pub previous: Option<BlamePrevious>,
    /// Lines changed in the working copy (Git's all-zero id, "Not Committed Yet").
    pub uncommitted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BlamePrevious {
    pub oid: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BlameLine {
    /// Index into [`BlameContent::Lines`]' `commits`.
    pub commit: u32,
    /// The line's number in the file as of its commit.
    pub original_line: u32,
    /// The line's number in the blamed version (1-based).
    pub line: u32,
    /// Content without the line ending.
    pub text: String,
}

impl Git {
    /// Blames `path` at `rev`, or the working copy with `None`. Binary files, files over the
    /// size limit (unless `force`) and files missing from `rev` are reported, not blamed.
    pub async fn blame(
        &self,
        repo: &Path,
        path: &str,
        rev: Option<&str>,
        force: bool,
    ) -> Result<Blame, GitError> {
        let full = repo_path(repo, path)?;
        if let Some(rev) = rev {
            check_rev(rev)?;
        }
        let result = |content| Blame {
            path: path.to_owned(),
            rev: rev.map(str::to_owned),
            content,
        };

        let probe = match rev {
            Some(rev) => self.probe_blob(repo, rev, path).await?,
            None => probe_file(&full)?,
        };
        let Some((bytes, binary)) = probe else {
            return Ok(result(BlameContent::Missing));
        };
        if binary {
            return Ok(result(BlameContent::Binary));
        }
        if bytes > MAX_BLAME_BYTES && !force {
            return Ok(result(BlameContent::TooLarge { bytes }));
        }

        let mut args = vec!["blame", "--porcelain"];
        args.extend(rev);
        args.extend(["--", path]);
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                &args,
            )
            .await;
        match out {
            Ok(out) => Ok(result(parse_porcelain(&out.stdout))),
            // Untracked or deleted in the working copy, or not in HEAD yet (a new file, an
            // unborn branch).
            Err(GitError::Failed { stderr, .. })
                if ["no such path", "cannot lstat", "no such ref"]
                    .iter()
                    .any(|m| stderr.to_ascii_lowercase().contains(m)) =>
            {
                Ok(result(BlameContent::Missing))
            }
            Err(err) => Err(err),
        }
    }

    /// Size of `path` at `rev` and whether it looks binary; `None` if it isn't a file there.
    async fn probe_blob(
        &self,
        repo: &Path,
        rev: &str,
        path: &str,
    ) -> Result<Option<(u64, bool)>, GitError> {
        let out = self
            .run(Some(repo), ["ls-tree", "-l", "-z", rev, "--", path])
            .await?;
        // `<mode> SP <type> SP <oid> SP+ <size> TAB <path>`
        let entry = lossy(&out.stdout);
        let Some((meta, name)) = entry.trim_end_matches('\0').split_once('\t') else {
            return Ok(None);
        };
        let mut fields = meta.split_whitespace();
        let (Some(_mode), Some(kind), Some(oid), Some(size)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            return Ok(None);
        };
        if kind != "blob" || name != path {
            return Ok(None);
        }
        let bytes: u64 = size.parse().unwrap_or(0);

        let (mut child, _) = self.spawn(RunOptions::in_dir(repo), ["cat-file", "blob", oid])?;
        let mut head = Vec::with_capacity(BINARY_PROBE);
        if let Some(stdout) = child.stdout.take() {
            stdout
                .take(BINARY_PROBE as u64)
                .read_to_end(&mut head)
                .await?;
        }
        // Dropping the child kills it, so a large blob isn't read to the end.
        drop(child);
        Ok(Some((bytes, head.contains(&0))))
    }
}

/// Size of a working-copy file and whether it looks binary; `None` if it isn't a file.
fn probe_file(full: &Path) -> Result<Option<(u64, bool)>, GitError> {
    let meta = match std::fs::metadata(full) {
        Ok(meta) if meta.is_file() => meta,
        Ok(_) => return Ok(None),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    let mut head = Vec::with_capacity(BINARY_PROBE);
    std::fs::File::open(full)?
        .take(BINARY_PROBE as u64)
        .read_to_end(&mut head)?;
    Ok(Some((meta.len(), head.contains(&0))))
}

/// Parses `git blame --porcelain`: per line a header `<oid> <orig> <final> [<count>]`,
/// the commit's details the first time it appears (`author …`, `summary …`, `previous …`,
/// `filename …`), then the line's content after a tab.
fn parse_porcelain(out: &[u8]) -> BlameContent {
    let mut commits: Vec<BlameCommit> = Vec::new();
    let mut by_oid: HashMap<String, u32> = HashMap::new();
    let mut lines = Vec::new();
    // The current header: commit index, original and final line numbers.
    let mut current: Option<(u32, u32, u32)> = None;

    for raw in out.split(|&b| b == b'\n') {
        if let Some(text) = raw.strip_prefix(b"\t") {
            if let Some((commit, original_line, line)) = current {
                let text = text.strip_suffix(b"\r").unwrap_or(text);
                lines.push(BlameLine {
                    commit,
                    original_line,
                    line,
                    text: lossy(text),
                });
            }
            continue;
        }
        let raw = lossy(raw);
        if let Some(header) = parse_header(&raw) {
            let (oid, original_line, line) = header;
            let index = *by_oid.entry(oid.to_owned()).or_insert_with(|| {
                commits.push(BlameCommit {
                    oid: oid.to_owned(),
                    author_name: String::new(),
                    author_email: String::new(),
                    author_time: 0,
                    summary: String::new(),
                    path: String::new(),
                    previous: None,
                    uncommitted: oid.bytes().all(|b| b == b'0'),
                });
                commits.len() as u32 - 1
            });
            current = Some((index, original_line, line));
            continue;
        }
        let Some((index, ..)) = current else {
            continue;
        };
        let commit = &mut commits[index as usize];
        let (key, value) = raw.split_once(' ').unwrap_or((&raw, ""));
        match key {
            "author" => commit.author_name = value.to_owned(),
            "author-mail" => {
                commit.author_email = value
                    .strip_prefix('<')
                    .and_then(|v| v.strip_suffix('>'))
                    .unwrap_or(value)
                    .to_owned();
            }
            "author-time" => commit.author_time = value.parse().unwrap_or(0),
            "summary" => commit.summary = value.to_owned(),
            "previous" => {
                commit.previous = value.split_once(' ').map(|(oid, path)| BlamePrevious {
                    oid: oid.to_owned(),
                    path: unquote(path),
                });
            }
            // Repeated when a commit touched the file under several names; the first wins.
            "filename" if commit.path.is_empty() => commit.path = unquote(value),
            _ => {}
        }
    }
    BlameContent::Lines { commits, lines }
}

/// `<oid> <orig> <final> [<count>]` → (oid, orig, final).
fn parse_header(line: &str) -> Option<(&str, u32, u32)> {
    let mut parts = line.split(' ');
    let oid = parts.next()?;
    if oid.len() < 40 || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let original = parts.next()?.parse().ok()?;
    let line = parts.next()?.parse().ok()?;
    Some((oid, original, line))
}

/// Undoes Git's C-style quoting of unusual paths (`"a\tb"`); other text is returned as is.
fn unquote(s: &str) -> String {
    let Some(inner) = s.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
        return s.to_owned();
    };
    let mut bytes = Vec::with_capacity(inner.len());
    let mut chars = inner.bytes().peekable();
    while let Some(b) = chars.next() {
        if b != b'\\' {
            bytes.push(b);
            continue;
        }
        match chars.next() {
            Some(b'n') => bytes.push(b'\n'),
            Some(b't') => bytes.push(b'\t'),
            Some(b'r') => bytes.push(b'\r'),
            Some(b'a') => bytes.push(7),
            Some(b'b') => bytes.push(8),
            Some(b'f') => bytes.push(12),
            Some(b'v') => bytes.push(11),
            Some(d @ b'0'..=b'7') => {
                let mut value = u32::from(d - b'0');
                for _ in 0..2 {
                    match chars.peek() {
                        Some(&o @ b'0'..=b'7') => {
                            value = value * 8 + u32::from(o - b'0');
                            chars.next();
                        }
                        _ => break,
                    }
                }
                bytes.push(value as u8);
            }
            Some(other) => bytes.push(other),
            None => {}
        }
    }
    lossy(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "1111111111111111111111111111111111111111 1 1 2
author Ada
author-mail <ada@example.com>
author-time 1700000000
author-tz +0000
committer Ada
committer-mail <ada@example.com>
committer-time 1700000000
committer-tz +0000
summary First
boundary
filename \"old\\tname.rs\"
\tfn main() {\r
1111111111111111111111111111111111111111 2 2
\t}
0000000000000000000000000000000000000000 3 3 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1700000100
summary Version of a.rs from a.rs
previous 1111111111111111111111111111111111111111 a.rs
filename a.rs
\t// new
";

    #[test]
    fn parses_porcelain() {
        let BlameContent::Lines { commits, lines } = parse_porcelain(SAMPLE.as_bytes()) else {
            panic!("expected lines");
        };
        assert_eq!(commits.len(), 2);
        let first = &commits[0];
        assert_eq!(first.author_name, "Ada");
        assert_eq!(first.author_email, "ada@example.com");
        assert_eq!(first.author_time, 1_700_000_000);
        assert_eq!(first.summary, "First");
        assert_eq!(first.path, "old\tname.rs");
        assert!(first.previous.is_none() && !first.uncommitted);
        let wip = &commits[1];
        assert!(wip.uncommitted);
        assert_eq!(
            wip.previous,
            Some(BlamePrevious {
                oid: "1".repeat(40),
                path: "a.rs".into()
            })
        );
        let got: Vec<_> = lines
            .iter()
            .map(|l| (l.commit, l.original_line, l.line, l.text.as_str()))
            .collect();
        assert_eq!(
            got,
            [
                (0, 1, 1, "fn main() {"),
                (0, 2, 2, "}"),
                (1, 3, 3, "// new")
            ]
        );
    }

    #[test]
    fn content_lines_that_look_like_headers_stay_content() {
        let out = format!(
            "{} 1 1 1\nsummary x\nfilename a\n\t{} 9 9 9\n",
            "a".repeat(40),
            "b".repeat(40)
        );
        let BlameContent::Lines { commits, lines } = parse_porcelain(out.as_bytes()) else {
            panic!("expected lines");
        };
        assert_eq!(commits.len(), 1);
        assert_eq!(lines[0].text, format!("{} 9 9 9", "b".repeat(40)));
    }

    #[test]
    fn unquotes_c_style_paths() {
        assert_eq!(unquote("plain.rs"), "plain.rs");
        assert_eq!(unquote("\"a\\\"b\\\\c\""), "a\"b\\c");
        assert_eq!(unquote("\"caf\\303\\251.txt\""), "café.txt");
    }
}
