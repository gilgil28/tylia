//! File diffs: runs `git diff`, parses the unified output into hunks and lines, and marks
//! word-level changes between paired removed/added lines.

use std::path::Path;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions};

/// Diffs larger than this are not parsed unless forced (DESIGN: large-file guard).
const MAX_DIFF_BYTES: usize = 1024 * 1024;
const MAX_DIFF_LINES: usize = 20_000;
/// Images larger than this are not previewed.
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
/// Context value meaning "the whole file".
pub const FULL_CONTEXT: u32 = u32::MAX;

/// What to compare.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum DiffTarget {
    /// A commit against its first parent; `parent: None` for a root commit.
    Commit { oid: String, parent: Option<String> },
    /// Working tree against the index.
    Unstaged,
    /// Index against HEAD.
    Staged,
    /// An untracked file, shown as entirely added.
    Untracked,
    /// A conflicted file: the working tree (with conflict markers) against "ours"
    /// (`git diff --ours`, index stage 2). Read-only: no line actions.
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffRequest {
    pub target: DiffTarget,
    pub path: String,
    /// Source path of a rename or copy.
    pub old_path: Option<String>,
    /// Lines of context around changes; [`FULL_CONTEXT`] for the whole file.
    pub context: u32,
    pub ignore_whitespace: bool,
    /// Parse even if the diff is over the large-file limit.
    pub force: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
    pub content: DiffContent,
    /// Old and new versions of an image file, for a visual comparison.
    pub image: Option<ImagePair>,
    /// Hash of the hunks (everything from the first `@@`), so line operations can check the
    /// file hasn't changed since this diff was shown.
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum DiffContent {
    Text {
        hunks: Vec<Hunk>,
        additions: u32,
        deletions: u32,
    },
    Binary,
    /// Over the size limit; request again with `force` to load it.
    TooLarge {
        #[ts(type = "number")]
        bytes: u64,
        lines: u32,
    },
    /// No content change (e.g. a mode change or a pure rename).
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Hunk {
    /// Text after the second `@@` (usually the enclosing function), may be empty.
    pub heading: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LineKind {
    Context,
    Add,
    Del,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    /// Line content without the diff marker and line ending.
    pub text: String,
    /// Followed by `\ No newline at end of file`.
    pub no_newline: bool,
    /// Changed word ranges `[start, end)` in UTF-16 code units of `text`.
    pub emphasis: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImagePair {
    /// `data:` URIs; `None` when the side does not exist or is too large.
    pub old: Option<String>,
    pub new: Option<String>,
}

/// Arguments for `git diff` of one file, and the exit codes that mean success. Shared by
/// [`Git::diff`] and line staging (`patch.rs`), which must see identical hunks.
///
/// Prefixes are explicit (`diff.noprefix` / `diff.mnemonicPrefix` would break `git apply`),
/// and working-copy diffs skip textconv filters so their hunks can be applied back.
pub(crate) fn diff_args(
    target: &DiffTarget,
    path: &str,
    old_path: Option<&str>,
    context: u32,
    ignore_whitespace: bool,
) -> (Vec<String>, &'static [i32]) {
    let unified = if context == FULL_CONTEXT {
        // Large enough to cover any file in a single hunk.
        "--unified=100000000".to_owned()
    } else {
        format!("--unified={context}")
    };
    let mut args: Vec<String> = vec![
        "diff".into(),
        "--no-color".into(),
        "--no-ext-diff".into(),
        "-M".into(),
        unified,
        "--src-prefix=a/".into(),
        "--dst-prefix=b/".into(),
    ];
    if ignore_whitespace {
        args.push("--ignore-all-space".into());
    }
    let mut ok_codes: &'static [i32] = &[];
    match target {
        DiffTarget::Commit { oid, parent } => match parent {
            Some(parent) => args.extend([parent.clone(), oid.clone()]),
            None => {
                // Root commit: `show` diffs against the empty tree.
                args[0] = "show".into();
                args.extend(["--format=".into(), oid.clone()]);
            }
        },
        DiffTarget::Unstaged => args.push("--no-textconv".into()),
        DiffTarget::Conflicted => args.extend(["--ours".into(), "--no-textconv".into()]),
        DiffTarget::Staged => args.extend(["--cached".into(), "--no-textconv".into()]),
        DiffTarget::Untracked => {
            args.extend(["--no-index".into(), "--no-textconv".into()]);
            ok_codes = &[1];
        }
    }
    args.push("--".into());
    match (target, old_path) {
        (DiffTarget::Untracked, _) => args.extend(["/dev/null".into(), path.to_owned()]),
        (_, Some(old)) if old != path => args.extend([old.to_owned(), path.to_owned()]),
        _ => args.push(path.to_owned()),
    }
    (args, ok_codes)
}

impl Git {
    pub async fn diff(&self, repo: &Path, req: &DiffRequest) -> Result<FileDiff, GitError> {
        let (args, ok_codes) = diff_args(
            &req.target,
            &req.path,
            req.old_path.as_deref(),
            req.context,
            req.ignore_whitespace,
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
        let mut diff = parse_file_diff(&out.stdout, req.force);
        diff.path = req.path.clone();
        diff.old_path = req.old_path.clone().filter(|p| p != &req.path);
        if is_image(&req.path) {
            diff.image = Some(self.image_pair(repo, req).await);
        }
        Ok(diff)
    }

    async fn image_pair(&self, repo: &Path, req: &DiffRequest) -> ImagePair {
        let old_path = req.old_path.as_deref().unwrap_or(&req.path);
        let (old_spec, new_spec): (Option<String>, Option<String>) = match &req.target {
            DiffTarget::Commit { oid, parent } => (
                parent.as_ref().map(|p| format!("{p}:{old_path}")),
                Some(format!("{oid}:{}", req.path)),
            ),
            DiffTarget::Staged => (
                Some(format!("HEAD:{old_path}")),
                Some(format!(":{}", req.path)),
            ),
            DiffTarget::Unstaged => (Some(format!(":{old_path}")), None),
            DiffTarget::Conflicted => (Some(format!(":2:{}", req.path)), None),
            DiffTarget::Untracked => (None, None),
        };
        let old = match old_spec {
            Some(spec) => self.blob(repo, &spec).await,
            None => None,
        };
        let new = match (&req.target, new_spec) {
            (DiffTarget::Unstaged | DiffTarget::Untracked | DiffTarget::Conflicted, _) => {
                std::fs::read(repo.join(&req.path)).ok()
            }
            (_, Some(spec)) => self.blob(repo, &spec).await,
            _ => None,
        };
        let uri = |bytes: Vec<u8>| {
            (bytes.len() <= MAX_IMAGE_BYTES).then(|| {
                format!(
                    "data:{};base64,{}",
                    image_mime(&req.path),
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )
            })
        };
        ImagePair {
            old: old.and_then(uri),
            new: new.and_then(uri),
        }
    }

    async fn blob(&self, repo: &Path, spec: &str) -> Option<Vec<u8>> {
        self.run(Some(repo), ["cat-file", "blob", spec])
            .await
            .ok()
            .map(|o| o.stdout)
    }
}

fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_image(path: &str) -> bool {
    matches!(
        extension(path).as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
    )
}

fn image_mime(path: &str) -> &'static str {
    match extension(path).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "image/x-icon",
    }
}

/// Parses `git diff` output for a single file.
pub fn parse_file_diff(out: &[u8], force: bool) -> FileDiff {
    let mut diff = FileDiff {
        path: String::new(),
        old_path: None,
        old_mode: None,
        new_mode: None,
        content: DiffContent::Empty,
        image: None,
        fingerprint: hunks_fingerprint(out),
    };
    let line_count = out.iter().filter(|&&b| b == b'\n').count();
    let mut lines = out.split(|&b| b == b'\n').peekable();

    // Extended header, up to the first hunk.
    while let Some(&line) = lines.peek() {
        if line.starts_with(b"@@") {
            break;
        }
        lines.next();
        let text = String::from_utf8_lossy(line);
        if let Some(mode) = text
            .strip_prefix("old mode ")
            .or_else(|| text.strip_prefix("deleted file mode "))
        {
            diff.old_mode = Some(mode.trim().to_owned());
        } else if let Some(mode) = text
            .strip_prefix("new mode ")
            .or_else(|| text.strip_prefix("new file mode "))
        {
            diff.new_mode = Some(mode.trim().to_owned());
        } else if text.starts_with("Binary files ") || text.starts_with("GIT binary patch") {
            diff.content = DiffContent::Binary;
            return diff;
        }
    }
    if lines.peek().is_none() {
        return diff;
    }
    if !force && (out.len() > MAX_DIFF_BYTES || line_count > MAX_DIFF_LINES) {
        diff.content = DiffContent::TooLarge {
            bytes: out.len() as u64,
            lines: line_count as u32,
        };
        return diff;
    }

    let mut hunks: Vec<Hunk> = Vec::new();
    let (mut additions, mut deletions) = (0, 0);
    let (mut old_no, mut new_no) = (0, 0);
    for raw in lines {
        let line = raw.strip_suffix(b"\r").unwrap_or(raw);
        // A second file section (e.g. an undetected rename given two paths): only the first
        // file is shown.
        if line.starts_with(b"diff --git ") {
            break;
        }
        if line.starts_with(b"@@") {
            if let Some(h) = parse_hunk_header(&String::from_utf8_lossy(line)) {
                old_no = h.old_start;
                new_no = h.new_start;
                hunks.push(h);
            }
            continue;
        }
        let Some(hunk) = hunks.last_mut() else {
            continue;
        };
        let (kind, text) = match line.first() {
            Some(b' ') => (LineKind::Context, &line[1..]),
            Some(b'+') => (LineKind::Add, &line[1..]),
            Some(b'-') => (LineKind::Del, &line[1..]),
            Some(b'\\') => {
                if let Some(last) = hunk.lines.last_mut() {
                    last.no_newline = true;
                }
                continue;
            }
            // An empty line is the end of output (or a context line from a tool that
            // strips the leading space).
            _ if line.is_empty() => continue,
            _ => (LineKind::Context, line),
        };
        let (old_line, new_line) = match kind {
            LineKind::Context => {
                old_no += 1;
                new_no += 1;
                (Some(old_no - 1), Some(new_no - 1))
            }
            LineKind::Add => {
                additions += 1;
                new_no += 1;
                (None, Some(new_no - 1))
            }
            LineKind::Del => {
                deletions += 1;
                old_no += 1;
                (Some(old_no - 1), None)
            }
        };
        hunk.lines.push(DiffLine {
            kind,
            old_line,
            new_line,
            text: String::from_utf8_lossy(text).into_owned(),
            no_newline: false,
            emphasis: Vec::new(),
        });
    }
    for hunk in &mut hunks {
        add_word_emphasis(&mut hunk.lines);
    }
    diff.content = if hunks.is_empty() {
        DiffContent::Empty
    } else {
        DiffContent::Text {
            hunks,
            additions,
            deletions,
        }
    };
    diff
}

/// Hash of the hunk text: everything from the first line starting with `@@`. Headers are
/// excluded, so an untracked file's `--no-index` diff and its diff after `git add -N` match.
pub fn hunks_fingerprint(out: &[u8]) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let start = if out.starts_with(b"@@") {
        Some(0)
    } else {
        out.windows(3).position(|w| w == b"\n@@").map(|i| i + 1)
    };
    let mut hasher = DefaultHasher::new();
    out[start.unwrap_or(out.len())..].hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Parses `@@ -a,b +c,d @@ heading`.
fn parse_hunk_header(line: &str) -> Option<Hunk> {
    let rest = line.strip_prefix("@@ -")?;
    let (ranges, heading) = rest.split_once(" @@")?;
    let (old, new) = ranges.split_once(" +")?;
    let range = |r: &str| -> Option<(u32, u32)> {
        match r.split_once(',') {
            Some((s, n)) => Some((s.parse().ok()?, n.parse().ok()?)),
            None => Some((r.parse().ok()?, 1)),
        }
    };
    let (old_start, old_lines) = range(old)?;
    let (new_start, new_lines) = range(new)?;
    Some(Hunk {
        heading: heading.trim().to_owned(),
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: Vec::new(),
    })
}

/// Pairs each run of removed lines with the following run of added lines (first with first,
/// second with second, …) and marks the words that differ.
fn add_word_emphasis(lines: &mut [DiffLine]) {
    let mut i = 0;
    while i < lines.len() {
        if lines[i].kind != LineKind::Del {
            i += 1;
            continue;
        }
        let del_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Del {
            i += 1;
        }
        let add_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Add {
            i += 1;
        }
        let pairs = (add_start - del_start).min(i - add_start);
        for k in 0..pairs {
            let (old, new) = word_diff(&lines[del_start + k].text, &lines[add_start + k].text);
            lines[del_start + k].emphasis = old;
            lines[add_start + k].emphasis = new;
        }
    }
}

/// Skip emphasis when lines are too long to compare cheaply…
const MAX_WORD_TOKENS: usize = 400;
/// …or so different that highlighting every word adds nothing.
const MIN_SHARED_RATIO: f32 = 0.3;

type Ranges = Vec<[u32; 2]>;

/// Changed ranges in `old` and `new` (UTF-16 offsets), from a token-level LCS.
fn word_diff(old: &str, new: &str) -> (Ranges, Ranges) {
    let a = tokenize(old);
    let b = tokenize(new);
    if a.len() > MAX_WORD_TOKENS || b.len() > MAX_WORD_TOKENS || a.is_empty() || b.is_empty() {
        return (Vec::new(), Vec::new());
    }
    // LCS table over token text.
    let (n, m) = (a.len(), b.len());
    let mut dp = vec![0u16; (n + 1) * (m + 1)];
    for x in (0..n).rev() {
        for y in (0..m).rev() {
            dp[x * (m + 1) + y] = if a[x].text == b[y].text {
                dp[(x + 1) * (m + 1) + y + 1] + 1
            } else {
                dp[(x + 1) * (m + 1) + y].max(dp[x * (m + 1) + y + 1])
            };
        }
    }
    let (mut same_a, mut same_b) = (vec![false; n], vec![false; m]);
    let (mut x, mut y) = (0, 0);
    while x < n && y < m {
        if a[x].text == b[y].text {
            same_a[x] = true;
            same_b[y] = true;
            x += 1;
            y += 1;
        } else if dp[(x + 1) * (m + 1) + y] >= dp[x * (m + 1) + y + 1] {
            x += 1;
        } else {
            y += 1;
        }
    }
    let shared = |tokens: &[Token], same: &[bool]| {
        let words = tokens.iter().filter(|t| !t.is_space).count().max(1);
        let kept = tokens
            .iter()
            .zip(same)
            .filter(|(t, s)| **s && !t.is_space)
            .count();
        kept as f32 / words as f32
    };
    if shared(&a, &same_a) < MIN_SHARED_RATIO || shared(&b, &same_b) < MIN_SHARED_RATIO {
        return (Vec::new(), Vec::new());
    }
    (ranges(&a, &same_a), ranges(&b, &same_b))
}

struct Token<'a> {
    text: &'a str,
    start: u32,
    end: u32,
    is_space: bool,
}

/// Words (letters, digits, `_`), whitespace runs, and single other characters, with
/// UTF-16 offsets.
fn tokenize(s: &str) -> Vec<Token<'_>> {
    #[derive(PartialEq)]
    enum Class {
        Word,
        Space,
        Other,
    }
    let class = |c: char| {
        if c.is_alphanumeric() || c == '_' {
            Class::Word
        } else if c.is_whitespace() {
            Class::Space
        } else {
            Class::Other
        }
    };
    let mut tokens = Vec::new();
    let mut utf16 = 0u32;
    let mut chars = s.char_indices().peekable();
    while let Some((start, c)) = chars.next() {
        let cls = class(c);
        let start16 = utf16;
        utf16 += c.len_utf16() as u32;
        let mut end = start + c.len_utf8();
        if cls != Class::Other {
            while let Some(&(i, next)) = chars.peek() {
                if class(next) != cls {
                    break;
                }
                chars.next();
                utf16 += next.len_utf16() as u32;
                end = i + next.len_utf8();
            }
        }
        tokens.push(Token {
            text: &s[start..end],
            start: start16,
            end: utf16,
            is_space: cls == Class::Space,
        });
    }
    tokens
}

/// Merges runs of changed tokens into ranges. Whitespace between two changed tokens joins
/// them; whitespace is never emphasised on its own.
fn ranges(tokens: &[Token], same: &[bool]) -> Ranges {
    let mut out: Ranges = Vec::new();
    let mut open = false;
    for (t, &s) in tokens.iter().zip(same) {
        if t.is_space {
            continue;
        }
        if s {
            open = false;
        } else if let (true, Some(last)) = (open, out.last_mut()) {
            last[1] = t.end;
        } else {
            out.push([t.start, t.end]);
            open = true;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_hunks(diff: &FileDiff) -> &[Hunk] {
        match &diff.content {
            DiffContent::Text { hunks, .. } => hunks,
            other => panic!("expected text, got {other:?}"),
        }
    }

    const SAMPLE: &str = "diff --git a/src/a.rs b/src/a.rs
index 1111111..2222222 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -1,4 +1,5 @@ fn main() {
 let a = 1;
-let y = 2;
+let y = compute();
+let z = 3;
 let b = 4;
 end
@@ -10 +11 @@
-old
+new
\\ No newline at end of file
";

    #[test]
    fn parses_hunks_and_line_numbers() {
        let diff = parse_file_diff(SAMPLE.as_bytes(), false);
        let hunks = text_hunks(&diff);
        assert_eq!(hunks.len(), 2);
        let h = &hunks[0];
        assert_eq!(
            (h.old_start, h.old_lines, h.new_start, h.new_lines),
            (1, 4, 1, 5)
        );
        assert_eq!(h.heading, "fn main() {");
        let nums: Vec<_> = h
            .lines
            .iter()
            .map(|l| (l.kind, l.old_line, l.new_line))
            .collect();
        assert_eq!(
            nums,
            [
                (LineKind::Context, Some(1), Some(1)),
                (LineKind::Del, Some(2), None),
                (LineKind::Add, None, Some(2)),
                (LineKind::Add, None, Some(3)),
                (LineKind::Context, Some(3), Some(4)),
                (LineKind::Context, Some(4), Some(5)),
            ]
        );
        assert_eq!((hunks[1].old_lines, hunks[1].new_lines), (1, 1));
        assert!(hunks[1].lines[1].no_newline);
        assert!(!hunks[1].lines[0].no_newline);
        match diff.content {
            DiffContent::Text {
                additions,
                deletions,
                ..
            } => assert_eq!((additions, deletions), (3, 2)),
            _ => unreachable!(),
        }
    }

    #[test]
    fn emphasises_changed_words() {
        let diff = parse_file_diff(SAMPLE.as_bytes(), false);
        let lines = &text_hunks(&diff)[0].lines;
        // "let y = 2;" vs "let y = compute();"
        assert_eq!(lines[1].emphasis, [[8, 9]]);
        assert_eq!(lines[2].emphasis, [[8, 17]]);
        assert!(lines[3].emphasis.is_empty(), "unpaired added line");
    }

    #[test]
    fn no_emphasis_for_unrelated_lines() {
        let (a, b) = word_diff("completely different", "nothing alike here");
        assert!(a.is_empty() && b.is_empty());
    }

    #[test]
    fn emphasis_uses_utf16_offsets() {
        let (a, b) = word_diff("let é = \"😀 a\";", "let é = \"😀 b\";");
        // é is 1 UTF-16 unit, 😀 is 2: `a` starts at 12.
        assert_eq!(a, [[12, 13]]);
        assert_eq!(b, [[12, 13]]);
    }

    #[test]
    fn crlf_is_stripped() {
        let diff = parse_file_diff(b"@@ -1 +1 @@\r\n-a\r\n+b\r\n", false);
        let lines = &text_hunks(&diff)[0].lines;
        assert_eq!(lines[0].text, "a");
        assert_eq!(lines[1].text, "b");
    }

    #[test]
    fn binary_and_mode_changes() {
        let bin = parse_file_diff(
            b"diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n",
            false,
        );
        assert_eq!(bin.content, DiffContent::Binary);
        let mode = parse_file_diff(
            b"diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n",
            false,
        );
        assert_eq!(mode.content, DiffContent::Empty);
        assert_eq!(mode.old_mode.as_deref(), Some("100644"));
        assert_eq!(mode.new_mode.as_deref(), Some("100755"));
    }

    #[test]
    fn stops_at_a_second_file_section() {
        let diff = parse_file_diff(
            b"@@ -1 +1 @@\n-a\n+b\ndiff --git a/y b/y\n@@ -1 +1 @@\n-c\n+d\n",
            false,
        );
        assert_eq!(text_hunks(&diff).len(), 1);
        assert_eq!(text_hunks(&diff)[0].lines.len(), 2);
    }

    #[test]
    fn fingerprint_ignores_headers() {
        let a =
            hunks_fingerprint(b"diff --git a/x b/x\nnew file mode 100644\n@@ -0,0 +1 @@\n+hi\n");
        let b = hunks_fingerprint(b"diff --no-index\n--- /dev/null\n@@ -0,0 +1 @@\n+hi\n");
        let c = hunks_fingerprint(b"@@ -0,0 +1 @@\n+ho\n");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn large_diffs_are_guarded_unless_forced() {
        let mut big = String::from("@@ -1,30000 +1,30000 @@\n");
        for i in 0..30_000 {
            big.push_str(&format!("-line {i}\n+line {i}!\n"));
        }
        let guarded = parse_file_diff(big.as_bytes(), false);
        assert!(matches!(
            guarded.content,
            DiffContent::TooLarge { lines: 60_001, .. }
        ));
        let forced = parse_file_diff(big.as_bytes(), true);
        assert_eq!(text_hunks(&forced)[0].lines.len(), 60_000);
    }
}
