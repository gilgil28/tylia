//! Conflict blocks in a conflicted file's working copy, resolved one at a time.
//!
//! Git writes each conflict as `<<<<<<< ours-label`, our lines, optionally `||||||| base` and
//! the base lines (diff3 / zdiff3 style), `=======`, their lines, `>>>>>>> theirs-label`. The
//! file is parsed as bytes, so resolving a block rewrites exactly that block and keeps the
//! rest of the file (line endings, encoding) as it was.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, lossy};
use crate::worktree::repo_path;

/// Length of Git's conflict markers (`conflict-marker-size` default).
const MARKER: usize = 7;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
#[ts(export)]
pub enum ConflictSegment {
    /// Lines outside conflicts; `first` is the 1-based line number in the file.
    Lines { first: u32, lines: Vec<String> },
    Conflict {
        /// Pass to [`Git::resolve_block`].
        index: u32,
        first: u32,
        /// What Git wrote after the markers, e.g. `HEAD` and `feature/x`.
        ours_label: String,
        theirs_label: String,
        ours: Vec<String>,
        /// The common ancestor's lines (diff3 / zdiff3 conflict style only).
        base: Option<Vec<String>>,
        theirs: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConflictFile {
    pub path: String,
    /// Identifies this version of the file; [`Git::resolve_block`] refuses another.
    pub fingerprint: String,
    /// Empty when the file has no (well-formed) conflict blocks, e.g. a delete/modify conflict.
    pub segments: Vec<ConflictSegment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BlockResolution {
    Ours,
    Theirs,
    /// Ours, then theirs.
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BlockOutcome {
    /// Conflict blocks left in the file.
    pub remaining: u32,
    /// The last block was resolved and the file marked resolved (staged).
    pub resolved: bool,
}

/// A parsed block: byte ranges of the whole block and of each side's lines.
#[derive(Debug, Clone)]
struct Block {
    whole: std::ops::Range<usize>,
    ours: std::ops::Range<usize>,
    base: Option<std::ops::Range<usize>>,
    theirs: std::ops::Range<usize>,
    ours_label: String,
    theirs_label: String,
    first_line: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Marker {
    Start,
    Base,
    Middle,
    End,
}

/// The marker on `line` (with or without its line ending), if any.
fn marker(line: &[u8]) -> Option<(Marker, String)> {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    let kind = match line.get(..MARKER)? {
        b"<<<<<<<" => Marker::Start,
        b"|||||||" => Marker::Base,
        b"=======" => Marker::Middle,
        b">>>>>>>" => Marker::End,
        _ => return None,
    };
    let rest = &line[MARKER..];
    match kind {
        // `=======` stands alone; the others may carry a label after a space.
        Marker::Middle if !rest.is_empty() => None,
        _ if !rest.is_empty() && rest[0] != b' ' => None,
        _ => Some((kind, lossy(rest).trim().to_owned())),
    }
}

/// Finds the conflict blocks; `None` if the markers don't form well-nested blocks.
fn parse_blocks(bytes: &[u8]) -> Option<Vec<Block>> {
    let mut blocks = Vec::new();
    let mut open: Option<(usize, usize, String, u32)> = None; // start, ours start, label, line
    let mut base: Option<usize> = None;
    let mut ours_end = 0;
    let mut base_range: Option<std::ops::Range<usize>> = None;
    let mut theirs_start: Option<usize> = None;
    let mut pos = 0;
    for (n, line) in bytes.split_inclusive(|&b| b == b'\n').enumerate() {
        let start = pos;
        pos += line.len();
        let Some((kind, label)) = marker(line) else {
            continue;
        };
        match (kind, open.is_some(), base.is_some(), theirs_start.is_some()) {
            (Marker::Start, false, _, _) => open = Some((start, pos, label, n as u32 + 1)),
            (Marker::Base, true, false, false) => {
                ours_end = start;
                base = Some(pos);
            }
            (Marker::Middle, true, _, false) => {
                match base {
                    Some(b) => base_range = Some(b..start),
                    None => ours_end = start,
                }
                theirs_start = Some(pos);
            }
            (Marker::End, true, _, true) => {
                let (whole_start, ours_start, ours_label, first_line) = open.take()?;
                blocks.push(Block {
                    whole: whole_start..pos,
                    ours: ours_start..ours_end,
                    base: base_range.take(),
                    theirs: theirs_start.take()?..start,
                    ours_label,
                    theirs_label: label,
                    first_line,
                });
                base = None;
            }
            // A marker out of order: not something we can resolve block by block.
            _ => return None,
        }
    }
    if open.is_some() { None } else { Some(blocks) }
}

fn lines(bytes: &[u8]) -> Vec<String> {
    bytes
        .split_inclusive(|&b| b == b'\n')
        .map(|l| {
            let l = l.strip_suffix(b"\n").unwrap_or(l);
            lossy(l.strip_suffix(b"\r").unwrap_or(l))
        })
        .collect()
}

fn fingerprint(bytes: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Splits the file into plain lines and conflict blocks.
fn segments(bytes: &[u8], blocks: &[Block]) -> Vec<ConflictSegment> {
    let mut out = Vec::new();
    let mut pos = 0;
    let mut line_no = 1u32;
    for (i, b) in blocks.iter().enumerate() {
        if b.whole.start > pos {
            let text = lines(&bytes[pos..b.whole.start]);
            let count = text.len() as u32;
            out.push(ConflictSegment::Lines {
                first: line_no,
                lines: text,
            });
            line_no += count;
        }
        out.push(ConflictSegment::Conflict {
            index: i as u32,
            first: b.first_line,
            ours_label: b.ours_label.clone(),
            theirs_label: b.theirs_label.clone(),
            ours: lines(&bytes[b.ours.clone()]),
            base: b.base.clone().map(|r| lines(&bytes[r])),
            theirs: lines(&bytes[b.theirs.clone()]),
        });
        line_no += bytes[b.whole.clone()]
            .iter()
            .filter(|&&c| c == b'\n')
            .count() as u32;
        pos = b.whole.end;
    }
    if pos < bytes.len() {
        out.push(ConflictSegment::Lines {
            first: line_no,
            lines: lines(&bytes[pos..]),
        });
    }
    out
}

/// `bytes` with block `index` replaced by the chosen side(s).
fn resolve(bytes: &[u8], block: &Block, resolution: BlockResolution) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&bytes[..block.whole.start]);
    if matches!(resolution, BlockResolution::Ours | BlockResolution::Both) {
        out.extend_from_slice(&bytes[block.ours.clone()]);
    }
    if matches!(resolution, BlockResolution::Theirs | BlockResolution::Both) {
        out.extend_from_slice(&bytes[block.theirs.clone()]);
    }
    out.extend_from_slice(&bytes[block.whole.end..]);
    out
}

impl Git {
    /// Reads a file's conflict blocks from the working tree (no Git process).
    pub async fn conflict_file(&self, repo: &Path, path: &str) -> Result<ConflictFile, GitError> {
        let full = repo_path(repo, path)?;
        let bytes = std::fs::read(&full)?;
        let blocks = parse_blocks(&bytes).unwrap_or_default();
        Ok(ConflictFile {
            path: path.to_owned(),
            fingerprint: fingerprint(&bytes),
            segments: if blocks.is_empty() {
                Vec::new()
            } else {
                segments(&bytes, &blocks)
            },
        })
    }

    /// Replaces conflict block `index` with one side or both. Refuses if the file changed
    /// since `fingerprint` was read. Resolving the last block marks the file resolved.
    pub async fn resolve_block(
        &self,
        repo: &Path,
        path: &str,
        index: u32,
        resolution: BlockResolution,
        fingerprint_seen: &str,
    ) -> Result<BlockOutcome, GitError> {
        let full = repo_path(repo, path)?;
        let bytes = std::fs::read(&full)?;
        if fingerprint(&bytes) != fingerprint_seen {
            return Err(GitError::InvalidInput(format!(
                "{path} changed since it was shown. Look at it again before resolving."
            )));
        }
        let blocks = parse_blocks(&bytes).unwrap_or_default();
        let block = blocks.get(index as usize).ok_or_else(|| {
            GitError::InvalidInput(format!("{path} has no conflict block {}.", index + 1))
        })?;
        std::fs::write(&full, resolve(&bytes, block, resolution))?;
        let remaining = blocks.len() as u32 - 1;
        if remaining == 0 {
            self.mark_resolved(repo, &[path.to_owned()]).await?;
        }
        Ok(BlockOutcome {
            remaining,
            resolved: remaining == 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MERGE: &str = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature/x\nb\n<<<<<<< HEAD\nm2\n=======\nt2\n>>>>>>> feature/x\n";

    #[test]
    fn parses_merge_style_blocks() {
        let blocks = parse_blocks(MERGE.as_bytes()).unwrap();
        assert_eq!(blocks.len(), 2);
        let segs = segments(MERGE.as_bytes(), &blocks);
        assert_eq!(
            segs[0],
            ConflictSegment::Lines {
                first: 1,
                lines: vec!["a".into()]
            }
        );
        match &segs[1] {
            ConflictSegment::Conflict {
                index,
                first,
                ours_label,
                theirs_label,
                ours,
                base,
                theirs,
            } => {
                assert_eq!((*index, *first), (0, 2));
                assert_eq!(
                    (ours_label.as_str(), theirs_label.as_str()),
                    ("HEAD", "feature/x")
                );
                assert_eq!(
                    (ours.as_slice(), theirs.as_slice()),
                    (&["mine".to_owned()][..], &["theirs".to_owned()][..])
                );
                assert!(base.is_none());
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            segs[2],
            ConflictSegment::Lines {
                first: 7,
                lines: vec!["b".into()]
            }
        );
    }

    #[test]
    fn parses_diff3_style_and_keeps_crlf() {
        let text = "x\r\n<<<<<<< ours\r\nO\r\n||||||| base\r\nB\r\n=======\r\nT\r\n>>>>>>> theirs\r\ny\r\n";
        let blocks = parse_blocks(text.as_bytes()).unwrap();
        let segs = segments(text.as_bytes(), &blocks);
        match &segs[1] {
            ConflictSegment::Conflict {
                ours, base, theirs, ..
            } => {
                assert_eq!(ours, &["O".to_owned()]);
                assert_eq!(base.as_deref(), Some(&["B".to_owned()][..]));
                assert_eq!(theirs, &["T".to_owned()]);
            }
            other => panic!("{other:?}"),
        }
        let out = resolve(text.as_bytes(), &blocks[0], BlockResolution::Theirs);
        assert_eq!(out, b"x\r\nT\r\ny\r\n");
    }

    #[test]
    fn resolves_each_way() {
        let bytes = MERGE.as_bytes();
        let blocks = parse_blocks(bytes).unwrap();
        let ours = resolve(bytes, &blocks[0], BlockResolution::Ours);
        assert!(
            String::from_utf8(ours.clone())
                .unwrap()
                .starts_with("a\nmine\nb\n<<<<<<< HEAD")
        );
        let both = resolve(bytes, &blocks[0], BlockResolution::Both);
        assert!(
            String::from_utf8(both)
                .unwrap()
                .starts_with("a\nmine\ntheirs\nb\n")
        );
        // The second block is still there and parses after the first is resolved.
        assert_eq!(parse_blocks(&ours).unwrap().len(), 1);
    }

    #[test]
    fn malformed_or_lookalike_markers() {
        assert!(
            parse_blocks(b"<<<<<<< HEAD\nmine\n").is_none(),
            "unterminated"
        );
        assert!(parse_blocks(b"=======\n").is_none(), "stray middle");
        // Not markers: longer runs, or text glued to the marker.
        assert_eq!(
            parse_blocks(b"========\n<<<<<<<<\n<<<<<<<x\n")
                .unwrap()
                .len(),
            0
        );
    }
}
