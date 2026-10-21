//! Staging, unstaging and discarding selected lines of a file (ARCHITECTURE §5.6).
//!
//! The UI shows a [`FileDiff`](crate::FileDiff) and sends back `[hunk, line]` indices into it.
//! [`Git::apply_lines`] re-runs the same `git diff` as raw bytes, checks its fingerprint, and
//! builds a patch that contains only the selected changes, which `git apply` then applies:
//!
//! | action  | diff shown           | patch is built against  | applied with               |
//! | ------- | -------------------- | ----------------------- | -------------------------- |
//! | stage   | index → working tree | old side (the index)    | `apply --cached`           |
//! | unstage | HEAD → index         | new side (the index)    | `apply --cached --reverse` |
//! | discard | index → working tree | new side (the worktree) | `apply --reverse`          |
//!
//! "Built against a side" means that side of the patch must equal the file the patch is applied
//! to, so every line on it is kept: unselected changes on that side become context, unselected
//! changes on the other side are dropped. For stage the base is the old side (unselected `-`
//! become context, unselected `+` are dropped); for unstage and discard it is the new side
//! (unselected `+` become context, unselected `-` are dropped).
//!
//! Discard deliberately differs from ARCHITECTURE §5.6, which says "same as staging": the
//! working tree holds *all* unstaged changes, so a patch reverse-applied to it must have the
//! working tree as its new side. A staging-style patch drops unselected `+` lines from the new
//! side and no longer matches the file whenever an unselected addition sits in a touched hunk.
//!
//! Everything is done on bytes, so CRLF, non-UTF-8 content and `\ No newline at end of file`
//! markers survive unchanged. Other details:
//!
//! - Hunk headers are recomputed (counts and both start lines, accounting for skipped and
//!   shrunk hunks) and `--recount` is passed as well.
//! - Line operations change content only: `old mode`/`new mode` lines are left out of the
//!   patch, so a pending mode change stays where it is (staging the whole file stages it).
//! - A partial selection of a new or deleted file can't keep the `new file`/`deleted file`
//!   header when the result isn't empty; the header becomes a plain modification. Unstaging or
//!   discarding lines of a rename is a plain modification of the new path, so the rename stays.
//! - Untracked files are first added with `git add -N` (intent to add) and the selection is
//!   staged from the resulting working-tree diff; the intent-to-add entry is removed again if
//!   anything fails.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::diff::{DiffTarget, LineKind, diff_args, hunks_fingerprint, parse_file_diff};
use crate::error::GitError;
use crate::runner::{Git, RunOptions};

const STALE: &str = "The file changed since the diff was shown. Review the changes and try again.";
const NOTHING_SELECTED: &str = "Select at least one added or removed line.";
const BINARY: &str = "Binary files can't be staged line by line.";
const UNSUPPORTED: &str = "This diff can't be split into lines.";

/// What to do with the selected lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LineAction {
    /// Add the lines' changes to the index.
    Stage,
    /// Take the lines' changes out of the index (the working tree keeps them).
    Unstage,
    /// Revert the lines' changes in the working tree (the index is untouched).
    Discard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LinesRequest {
    pub path: String,
    /// Source path of a rename or copy.
    pub old_path: Option<String>,
    pub action: LineAction,
    /// The diff the selection refers to: `unstaged` or `untracked` for stage and discard,
    /// `staged` for unstage.
    pub source: DiffTarget,
    /// Context lines of the displayed diff (line indices depend on it).
    pub context: u32,
    /// `FileDiff::fingerprint` of the displayed diff; the request fails if it changed.
    pub fingerprint: String,
    /// Selected lines as `[hunk index, line index]` into the displayed diff. Only added and
    /// removed lines count; a whole hunk is all of its changed lines.
    pub lines: Vec<[u32; 2]>,
}

/// The side of the displayed diff that the patch must match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Base {
    /// Applied forwards to the old side (stage).
    Old,
    /// Applied in reverse to the new side (unstage, discard).
    New,
}

fn invalid(msg: &str) -> GitError {
    GitError::InvalidInput(msg.to_owned())
}

impl Git {
    pub async fn apply_lines(&self, repo: &Path, req: &LinesRequest) -> Result<(), GitError> {
        let base = match (req.action, &req.source) {
            (_, DiffTarget::Conflicted) => {
                return Err(invalid(
                    "Lines of a conflicted file can't be staged or discarded; resolve the file first.",
                ));
            }
            (LineAction::Stage, DiffTarget::Unstaged | DiffTarget::Untracked) => Base::Old,
            (LineAction::Unstage, DiffTarget::Staged)
            | (LineAction::Discard, DiffTarget::Unstaged) => Base::New,
            (LineAction::Stage, _) => return Err(invalid("Only unstaged lines can be staged.")),
            (LineAction::Unstage, _) => return Err(invalid("Only staged lines can be unstaged.")),
            (LineAction::Discard, DiffTarget::Untracked) => {
                return Err(invalid(
                    "Lines of an untracked file can't be discarded; discard the whole file.",
                ));
            }
            (LineAction::Discard, _) => {
                return Err(invalid("Only unstaged lines can be discarded."));
            }
        };
        if req.lines.is_empty() {
            return Err(invalid(NOTHING_SELECTED));
        }
        let raw = self.raw_diff(repo, req, &req.source).await?;
        if hunks_fingerprint(&raw) != req.fingerprint {
            return Err(invalid(STALE));
        }
        // Validates the selection (and rejects binary files) before anything is changed.
        let patch = build_patch(&raw, &req.lines, base)?;
        if req.source == DiffTarget::Untracked {
            return self.stage_untracked_lines(repo, req, &raw).await;
        }
        self.apply_patch(repo, &patch, req.action, req.context)
            .await
    }

    /// Stages lines of an untracked file: `git add -N`, then stage the selection from the
    /// working-tree diff, which now shows the file as new. Undoes the `add -N` on failure.
    async fn stage_untracked_lines(
        &self,
        repo: &Path,
        req: &LinesRequest,
        shown: &[u8],
    ) -> Result<(), GitError> {
        self.run_with(RunOptions::in_dir(repo), ["add", "-N", "--", &req.path])
            .await?;
        let result = async {
            let raw = self.raw_diff(repo, req, &DiffTarget::Unstaged).await?;
            // The hunks normally match byte for byte. With `core.autocrlf` the `--no-index` diff
            // shows CRLF while the index diff shows LF; the lines (and so the indices) are the
            // same, which is what this compares.
            if parse_file_diff(&raw, true).content != parse_file_diff(shown, true).content {
                return Err(invalid(STALE));
            }
            let patch = build_patch(&raw, &req.lines, Base::Old)?;
            self.apply_patch(repo, &patch, LineAction::Stage, req.context)
                .await
        }
        .await;
        if result.is_err() {
            // Best effort: the original error is the one worth reporting.
            let _ = self
                .run_with(
                    RunOptions::in_dir(repo),
                    ["rm", "--cached", "-q", "--ignore-unmatch", "--", &req.path],
                )
                .await;
        }
        result
    }

    /// The displayed diff as raw bytes, with the same arguments as [`Git::diff`] (so the
    /// hunks and their fingerprint are identical).
    async fn raw_diff(
        &self,
        repo: &Path,
        req: &LinesRequest,
        target: &DiffTarget,
    ) -> Result<Vec<u8>, GitError> {
        if matches!(target, DiffTarget::Commit { .. }) {
            return Err(invalid(UNSUPPORTED));
        }
        let (args, ok_codes) = diff_args(
            target,
            &req.path,
            req.old_path.as_deref(),
            req.context,
            false,
        );
        let out = self
            .run_with(
                RunOptions {
                    ok_codes,
                    ..RunOptions::in_dir(repo)
                },
                &args,
            )
            .await?;
        Ok(out.stdout)
    }

    async fn apply_patch(
        &self,
        repo: &Path,
        patch: &[u8],
        action: LineAction,
        context: u32,
    ) -> Result<(), GitError> {
        let mut args = vec!["apply"];
        match action {
            LineAction::Stage => args.push("--cached"),
            LineAction::Unstage => args.extend(["--cached", "--reverse"]),
            LineAction::Discard => args.push("--reverse"),
        }
        args.extend(["--recount", "--whitespace=nowarn"]);
        if context == 0 {
            // Without context `git apply` would require hunks to match at the end of the file;
            // the recomputed line numbers place them instead.
            args.push("--unidiff-zero");
        }
        args.push("-");
        self.run_with(
            RunOptions {
                stdin: Some(patch),
                ..RunOptions::in_dir(repo)
            },
            &args,
        )
        .await?;
        Ok(())
    }
}

/// One file's `git diff` output, split into raw lines (without `\n`; a `\r` stays).
struct RawDiff<'a> {
    header: Vec<&'a [u8]>,
    hunks: Vec<RawHunk<'a>>,
}

struct RawHunk<'a> {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
    /// Everything after the second `@@` (the heading).
    tail: &'a [u8],
    lines: Vec<RawLine<'a>>,
    /// Displayed line index → index into `lines`. They differ only for blank context lines
    /// written without their leading space (`diff.suppressBlankEmpty`), which the display
    /// parser skips.
    shown: Vec<usize>,
}

struct RawLine<'a> {
    kind: LineKind,
    /// The line after its diff marker, including any `\r`.
    body: &'a [u8],
    /// The `\ No newline at end of file` line that follows it.
    no_eol: Option<&'a [u8]>,
}

impl<'a> RawDiff<'a> {
    /// Splits the output the same way `diff::parse_file_diff` does, so indices agree.
    fn parse(raw: &'a [u8]) -> Result<Self, GitError> {
        let mut lines: Vec<&[u8]> = raw.split(|&b| b == b'\n').collect();
        if lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        let mut diff = RawDiff {
            header: Vec::new(),
            hunks: Vec::new(),
        };
        for line in lines {
            if line.starts_with(b"@@") {
                diff.hunks
                    .push(parse_hunk_header(line).ok_or_else(|| invalid(UNSUPPORTED))?);
                continue;
            }
            let Some(hunk) = diff.hunks.last_mut() else {
                if line.starts_with(b"Binary files ") || line.starts_with(b"GIT binary patch") {
                    return Err(invalid(BINARY));
                }
                diff.header.push(line);
                continue;
            };
            let stripped = line.strip_suffix(b"\r").unwrap_or(line);
            let (kind, body) = match stripped.first() {
                Some(b' ') => (LineKind::Context, &line[1..]),
                Some(b'+') => (LineKind::Add, &line[1..]),
                Some(b'-') => (LineKind::Del, &line[1..]),
                Some(b'\\') => {
                    let last = hunk.lines.last_mut().ok_or_else(|| invalid(UNSUPPORTED))?;
                    last.no_eol = Some(line);
                    continue;
                }
                None => (LineKind::Context, line),
                // Anything else (such as a second file's `diff --git`) would desynchronise
                // the indices.
                Some(_) => return Err(invalid(UNSUPPORTED)),
            };
            if !stripped.is_empty() {
                hunk.shown.push(hunk.lines.len());
            }
            hunk.lines.push(RawLine {
                kind,
                body,
                no_eol: None,
            });
        }
        Ok(diff)
    }
}

/// Parses `@@ -a,b +c,d @@tail`.
fn parse_hunk_header(line: &[u8]) -> Option<RawHunk<'_>> {
    let rest = line.strip_prefix(b"@@ -")?;
    let end = rest.windows(3).position(|w| w == b" @@")?;
    let ranges = std::str::from_utf8(&rest[..end]).ok()?;
    let (old, new) = ranges.split_once(" +")?;
    let range = |r: &str| -> Option<(u32, u32)> {
        match r.split_once(',') {
            Some((s, n)) => Some((s.parse().ok()?, n.parse().ok()?)),
            None => Some((r.parse().ok()?, 1)),
        }
    };
    let (old_start, old_lines) = range(old)?;
    let (new_start, new_lines) = range(new)?;
    Some(RawHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        tail: &rest[end + 3..],
        lines: Vec::new(),
        shown: Vec::new(),
    })
}

/// How a line of the shown diff appears in the patch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Emit {
    Keep,
    Context,
    Drop,
}

/// Builds the patch for the selected `[hunk, line]` indices of one file's raw diff.
fn build_patch(raw: &[u8], selection: &[[u32; 2]], base: Base) -> Result<Vec<u8>, GitError> {
    let diff = RawDiff::parse(raw)?;
    let mut selected: Vec<Vec<bool>> = diff
        .hunks
        .iter()
        .map(|h| vec![false; h.lines.len()])
        .collect();
    for &[h, l] in selection {
        let hunk = diff.hunks.get(h as usize).ok_or_else(|| invalid(STALE))?;
        let &index = hunk.shown.get(l as usize).ok_or_else(|| invalid(STALE))?;
        selected[h as usize][index] = true;
    }
    let is_change = |l: &RawLine| l.kind != LineKind::Context;
    let mut total = 0;
    let mut chosen = 0;
    for (hunk, sel) in diff.hunks.iter().zip(&selected) {
        for (line, &s) in hunk.lines.iter().zip(sel) {
            if is_change(line) {
                total += 1;
                chosen += usize::from(s);
            }
        }
    }
    if chosen == 0 {
        return Err(invalid(NOTHING_SELECTED));
    }

    let mut out = patch_header(&diff.header, base, chosen == total)?;
    let mut delta = 0i64;
    for (hunk, sel) in diff.hunks.iter().zip(&selected) {
        if hunk.lines.iter().zip(sel).any(|(l, &s)| s && is_change(l)) {
            emit_hunk(&mut out, hunk, sel, base, &mut delta);
        }
    }
    Ok(out)
}

/// The file header for the patch.
///
/// - `old mode`/`new mode` are dropped: line operations change content only.
/// - Stage of part of a deleted file, and unstage/discard of part of a new file, leave a
///   non-empty file, so `deleted file`/`new file` become a plain modification.
/// - Unstage/discard of a rename becomes a modification of the new path (reverse-applying the
///   rename would move the file back).
fn patch_header(lines: &[&[u8]], base: Base, all: bool) -> Result<Vec<u8>, GitError> {
    let has = |prefix: &[u8]| lines.iter().any(|l| l.starts_with(prefix));
    let is_new = has(b"new file mode ");
    let is_deleted = has(b"deleted file mode ");
    let is_rename = has(b"rename from ") || has(b"copy from ");
    let name = |prefix: &[u8]| lines.iter().find_map(|l| l.strip_prefix(prefix));

    let mut out = Vec::new();
    let modification_of = match base {
        Base::Old if is_deleted && !all => Some(name(b"--- ")),
        Base::New if is_rename || (is_new && !all) => Some(name(b"+++ ")),
        _ => None,
    };
    let Some(path) = modification_of else {
        for line in lines {
            if !line.starts_with(b"old mode ") && !line.starts_with(b"new mode ") {
                out.extend_from_slice(line);
                out.push(b'\n');
            }
        }
        return Ok(out);
    };
    let path = path.ok_or_else(|| invalid(UNSUPPORTED))?;
    // `a/P`, `b/P`, or quoted (`"a/P"`); Git appends a tab to names that contain spaces.
    let (path, tab) = match path.strip_suffix(b"\t") {
        Some(p) => (p, &b"\t"[..]),
        None => (path, &b""[..]),
    };
    let prefix_at = usize::from(path.starts_with(b"\""));
    if !matches!(path.get(prefix_at..prefix_at + 2), Some(b"a/" | b"b/")) {
        return Err(invalid(UNSUPPORTED));
    }
    let with_prefix = |p: u8| {
        let mut name = path.to_vec();
        name[prefix_at] = p;
        name
    };
    let (a, b) = (with_prefix(b'a'), with_prefix(b'b'));
    for parts in [
        &[&b"diff --git "[..], &a, b" ", &b, b"\n"][..],
        &[b"--- ", &a, tab, b"\n"],
        &[b"+++ ", &b, tab, b"\n"],
    ] {
        out.extend(parts.iter().flat_map(|p| p.iter()));
    }
    Ok(out)
}

/// Appends one hunk with only the selected changes; `delta` is the running offset between
/// the new and old sides of the patch.
fn emit_hunk(out: &mut Vec<u8>, hunk: &RawHunk, selected: &[bool], base: Base, delta: &mut i64) {
    let emits: Vec<Emit> = hunk
        .lines
        .iter()
        .zip(selected)
        .map(|(line, &s)| match (line.kind, s, base) {
            (LineKind::Context, ..) => Emit::Context,
            (_, true, _) => Emit::Keep,
            (LineKind::Del, false, Base::Old) | (LineKind::Add, false, Base::New) => Emit::Context,
            _ => Emit::Drop,
        })
        .collect();
    // The side the patch produces: new when applied forwards, old when reversed.
    let result_kind = match base {
        Base::Old => LineKind::Add,
        Base::New => LineKind::Del,
    };
    // `followed[i]`: some line after `i` ends up on the result side.
    let mut followed = vec![false; emits.len()];
    for i in (1..emits.len()).rev() {
        let reaches_result = match emits[i] {
            Emit::Context => true,
            Emit::Keep => hunk.lines[i].kind == result_kind,
            Emit::Drop => false,
        };
        followed[i - 1] = followed[i] || reaches_result;
    }

    let mut body = Vec::new();
    let (mut old_count, mut new_count) = (0i64, 0i64);
    let mut push = |prefix: u8, line: &RawLine, marker: Option<&[u8]>| {
        match prefix {
            b'-' => old_count += 1,
            b'+' => new_count += 1,
            _ => {
                old_count += 1;
                new_count += 1;
            }
        }
        body.push(prefix);
        body.extend_from_slice(line.body);
        body.push(b'\n');
        if let Some(marker) = marker {
            body.extend_from_slice(marker);
            body.push(b'\n');
        }
    };
    // A `\ No newline at end of file` marker is only true for the last line of a side. The
    // base side is unchanged, so its markers stay; on the result side a marked line that is no
    // longer last (because unselected lines now follow it) gets its newline back.
    for ((line, &emit), &followed) in hunk.lines.iter().zip(&emits).zip(&followed) {
        match emit {
            Emit::Drop => {}
            Emit::Keep => {
                let marker = if line.kind == result_kind && followed {
                    None
                } else {
                    line.no_eol
                };
                let prefix = if line.kind == LineKind::Add {
                    b'+'
                } else {
                    b'-'
                };
                push(prefix, line, marker);
            }
            Emit::Context => {
                // An unselected change turned into context that ends the base side without a
                // newline. As context the marker would mean "no newline on both sides", which
                // is wrong if more lines follow on the result side. Keep it as a `-`/`+` pair
                // with the marker on the base side only.
                let split = line.kind != LineKind::Context && line.no_eol.is_some() && followed;
                if !split {
                    push(b' ', line, line.no_eol);
                } else if base == Base::Old {
                    push(b'-', line, line.no_eol);
                    push(b'+', line, None);
                } else {
                    push(b'-', line, None);
                    push(b'+', line, line.no_eol);
                }
            }
        }
    }

    // Git's convention: an empty side's start is the line before the hunk.
    let first = |start: u32, count: u32| i64::from(start) + i64::from(count == 0);
    let start = |first: i64, count: i64| (first - i64::from(count == 0)).max(0);
    let (old_first, new_first) = match base {
        Base::Old => {
            let old_first = first(hunk.old_start, hunk.old_lines);
            (old_first, old_first + *delta)
        }
        Base::New => {
            let new_first = first(hunk.new_start, hunk.new_lines);
            (new_first - *delta, new_first)
        }
    };
    *delta += new_count - old_count;
    out.extend_from_slice(
        format!(
            "@@ -{},{} +{},{} @@",
            start(old_first, old_count),
            old_count,
            start(new_first, new_count),
            new_count
        )
        .as_bytes(),
    );
    out.extend_from_slice(hunk.tail);
    out.push(b'\n');
    out.extend_from_slice(&body);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(raw: &str, selection: &[[u32; 2]], base: Base) -> String {
        String::from_utf8(build_patch(raw.as_bytes(), selection, base).unwrap()).unwrap()
    }

    const HEADER: &str = "diff --git a/f b/f\nindex 1111111..2222222 100644\n--- a/f\n+++ b/f\n";

    /// Two hunks; the first replaces `c` with `C1`, `C2`, the second removes `x`.
    const TWO_HUNKS: &str = "diff --git a/f b/f
index 1111111..2222222 100644
--- a/f
+++ b/f
@@ -1,5 +1,6 @@ heading
 a
 b
-c
+C1
+C2
 d
 e
@@ -20,3 +21,2 @@
 w
-x
 y
";

    #[test]
    fn stage_keeps_unselected_removals_as_context() {
        // Select `+C2` only: `-c` becomes context, `+C1` is dropped.
        assert_eq!(
            build(TWO_HUNKS, &[[0, 4]], Base::Old),
            format!("{HEADER}@@ -1,5 +1,6 @@ heading\n a\n b\n c\n+C2\n d\n e\n")
        );
    }

    #[test]
    fn unstage_and_discard_keep_unselected_additions_as_context() {
        // Select `-c` only: `+C1`/`+C2` become context.
        assert_eq!(
            build(TWO_HUNKS, &[[0, 2]], Base::New),
            format!("{HEADER}@@ -1,7 +1,6 @@ heading\n a\n b\n-c\n C1\n C2\n d\n e\n")
        );
    }

    #[test]
    fn later_hunks_are_renumbered() {
        // Only the second hunk: its new start no longer includes the first hunk's +1.
        assert_eq!(
            build(TWO_HUNKS, &[[1, 1]], Base::Old),
            format!("{HEADER}@@ -20,3 +20,2 @@\n w\n-x\n y\n")
        );
        // Reverse: the new side is fixed, the old side shifts by the skipped hunk.
        assert_eq!(
            build(TWO_HUNKS, &[[1, 1]], Base::New),
            format!("{HEADER}@@ -21,3 +21,2 @@\n w\n-x\n y\n")
        );
        // Both hunks, first one partially: offset is that hunk's actual growth.
        assert_eq!(
            build(TWO_HUNKS, &[[0, 2], [0, 3], [1, 1]], Base::Old),
            format!(
                "{HEADER}@@ -1,5 +1,5 @@ heading\n a\n b\n-c\n+C1\n d\n e\n@@ -20,3 +20,2 @@\n w\n-x\n y\n"
            )
        );
    }

    #[test]
    fn context_and_out_of_range_selections() {
        let err = build_patch(TWO_HUNKS.as_bytes(), &[[0, 0]], Base::Old).unwrap_err();
        assert_eq!(err.to_string(), NOTHING_SELECTED);
        let err = build_patch(TWO_HUNKS.as_bytes(), &[[0, 99]], Base::Old).unwrap_err();
        assert_eq!(err.to_string(), STALE);
        let err = build_patch(TWO_HUNKS.as_bytes(), &[[5, 0]], Base::Old).unwrap_err();
        assert_eq!(err.to_string(), STALE);
    }

    #[test]
    fn bytes_are_preserved() {
        let raw = b"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\r\n-caf\xe9\r\n+CAF\xc9\r\n";
        let patch = build_patch(raw, &[[0, 2]], Base::Old).unwrap();
        assert_eq!(
            patch,
            b"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n a\r\n caf\xe9\r\n+CAF\xc9\r\n"
        );
    }

    /// Old `a`, `b` (no newline); new `a`, `B` (no newline).
    const CHANGED_LAST: &str = "diff --git a/f b/f
--- a/f
+++ b/f
@@ -1,2 +1,2 @@
 a
-b
\\ No newline at end of file
+B
\\ No newline at end of file
";

    #[test]
    fn no_newline_markers_follow_their_lines() {
        let h = "diff --git a/f b/f\n--- a/f\n+++ b/f\n";
        let nl = "\\ No newline at end of file\n";
        // Only the addition: `b` stays but needs a newline before `B`.
        assert_eq!(
            build(CHANGED_LAST, &[[0, 2]], Base::Old),
            format!("{h}@@ -1,2 +1,3 @@\n a\n-b\n{nl}+b\n+B\n{nl}")
        );
        // Only the removal: `+B` and its marker are dropped.
        assert_eq!(
            build(CHANGED_LAST, &[[0, 1]], Base::Old),
            format!("{h}@@ -1,2 +1,1 @@\n a\n-b\n{nl}")
        );
        // Reverse, only the removal: `B` becomes context and stays last on both sides, so
        // the restored `b` before it gets a newline.
        assert_eq!(
            build(CHANGED_LAST, &[[0, 1]], Base::New),
            format!("{h}@@ -1,3 +1,2 @@\n a\n-b\n B\n{nl}")
        );
        // Reverse, only the addition: `-b` is dropped.
        assert_eq!(
            build(CHANGED_LAST, &[[0, 2]], Base::New),
            format!("{h}@@ -1,1 +1,2 @@\n a\n+B\n{nl}")
        );
    }

    #[test]
    fn reverse_split_when_old_side_continues() {
        // Not produced by git (removals come first) but handled symmetrically.
        let raw = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n+n\n\\ No newline at end of file\n-o\n";
        assert_eq!(
            build(raw, &[[0, 1]], Base::New),
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,1 @@\n-n\n+n\n\\ No newline at end of file\n-o\n"
        );
    }

    #[test]
    fn headers_of_new_deleted_renamed_and_mode_changed_files() {
        let new = "diff --git a/n b/n\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+x\n+y\n";
        // Staging part of a new file keeps it new.
        assert_eq!(
            build(new, &[[0, 1]], Base::Old),
            "diff --git a/n b/n\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,1 @@\n+y\n"
        );
        // Unstaging part of it leaves a file: a plain modification.
        assert_eq!(
            build(new, &[[0, 1]], Base::New),
            "diff --git a/n b/n\n--- a/n\n+++ b/n\n@@ -1,1 +1,2 @@\n x\n+y\n"
        );
        // Unstaging all of it removes the file.
        assert!(build(new, &[[0, 0], [0, 1]], Base::New).contains("new file mode"));

        let deleted = "diff --git a/my d b/my d\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/my d\t\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-x\n-y\n";
        assert_eq!(
            build(deleted, &[[0, 0]], Base::Old),
            "diff --git a/my d b/my d\n--- a/my d\t\n+++ b/my d\t\n@@ -1,2 +1,1 @@\n-x\n y\n"
        );
        assert!(build(deleted, &[[0, 0], [0, 1]], Base::Old).contains("deleted file mode"));

        let renamed = "diff --git a/old b/\"n\\tew\"\nsimilarity index 90%\nrename from old\nrename to \"n\\tew\"\nindex 1111111..2222222 100644\n--- a/old\n+++ \"b/n\\tew\"\n@@ -1 +1 @@\n-x\n+y\n";
        assert!(build(renamed, &[[0, 1]], Base::Old).contains("rename from old\n"));
        assert_eq!(
            build(renamed, &[[0, 1]], Base::New),
            "diff --git \"a/n\\tew\" \"b/n\\tew\"\n--- \"a/n\\tew\"\n+++ \"b/n\\tew\"\n@@ -0,0 +1,1 @@\n+y\n"
        );

        let mode = "diff --git a/m b/m\nold mode 100644\nnew mode 100755\nindex 1111111..2222222\n--- a/m\n+++ b/m\n@@ -1 +1 @@\n-x\n+y\n";
        assert_eq!(
            build(mode, &[[0, 1]], Base::Old),
            "diff --git a/m b/m\nindex 1111111..2222222\n--- a/m\n+++ b/m\n@@ -1,1 +1,2 @@\n x\n+y\n"
        );
    }

    #[test]
    fn binary_and_multi_file_diffs_are_rejected() {
        let bin = "diff --git a/b b/b\nindex 1..2 100644\nBinary files a/b and b/b differ\n";
        assert_eq!(
            build_patch(bin.as_bytes(), &[[0, 0]], Base::Old)
                .unwrap_err()
                .to_string(),
            BINARY
        );
        let two = format!("{TWO_HUNKS}diff --git a/g b/g\n");
        assert_eq!(
            build_patch(two.as_bytes(), &[[0, 2]], Base::Old)
                .unwrap_err()
                .to_string(),
            UNSUPPORTED
        );
    }

    #[test]
    fn suppressed_blank_context_lines_are_kept_but_not_indexed() {
        // `diff.suppressBlankEmpty`: the blank context line has no leading space.
        let raw = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n";
        assert_eq!(
            build(raw, &[[0, 2]], Base::Old),
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n a\n \n b\n+B\n"
        );
    }
}
