//! Line staging, unstaging and discarding (ARCHITECTURE §5.6): each case builds a temp repo,
//! shows the diff the way the UI does, selects lines by index and checks the exact result.

use std::process::Command;

use crate::common::TestRepo;
use tylia_git::{
    DiffContent, DiffRequest, DiffTarget, FULL_CONTEXT, FileDiff, Git, GitError, LineAction,
    LineKind, LinesRequest,
};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// A repo that stores bytes as written (no CRLF conversion from the user's config).
fn repo() -> TestRepo {
    let r = TestRepo::new();
    r.git(&["config", "core.autocrlf", "false"]);
    r
}

/// `"1-3 3a 4"` → `"1\n2\n3\n3a\n4\n"`: space-separated lines, `a-b` for a numeric range.
fn file(spec: &str) -> Vec<u8> {
    let mut out = String::new();
    for token in spec.split_whitespace() {
        match token
            .split_once('-')
            .map(|(a, b)| (a.parse::<u32>(), b.parse::<u32>()))
        {
            Some((Ok(a), Ok(b))) => (a..=b).for_each(|n| out.push_str(&format!("{n}\n"))),
            _ => out.push_str(&format!("{token}\n")),
        }
    }
    out.into_bytes()
}

fn write(r: &TestRepo, path: &str, bytes: &[u8]) {
    std::fs::write(r.path().join(path), bytes).unwrap();
}

fn read(r: &TestRepo, path: &str) -> Vec<u8> {
    std::fs::read(r.path().join(path)).unwrap()
}

/// Runs git and returns raw stdout.
fn raw(r: &TestRepo, args: &[&str]) -> Vec<u8> {
    let out = Command::new("git")
        .args(args)
        .current_dir(r.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}

fn commit_all(r: &TestRepo) {
    r.git(&["add", "-A"]);
    r.git(&["commit", "-q", "-m", "base"]);
}

/// Content of `path` in the index.
fn index_blob(r: &TestRepo, path: &str) -> Vec<u8> {
    raw(r, &["show", &format!(":{path}")])
}

/// `git diff --cached` (or another diff) without `index` lines, whose hashes add nothing.
fn diff_without_index(r: &TestRepo, args: &[&str]) -> Vec<u8> {
    let out = raw(r, args);
    let mut kept = Vec::new();
    for line in out.split_inclusive(|&b| b == b'\n') {
        if !line.starts_with(b"index ") {
            kept.extend_from_slice(line);
        }
    }
    kept
}

fn staged_diff(r: &TestRepo) -> Vec<u8> {
    diff_without_index(r, &["diff", "--cached", "--no-color", "-M"])
}

fn modified(path: &str, hunks: &str) -> String {
    format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n{hunks}")
}

#[track_caller]
fn assert_bytes(actual: &[u8], expected: &[u8]) {
    assert_eq!(
        String::from_utf8_lossy(actual),
        String::from_utf8_lossy(expected)
    );
    assert_eq!(actual, expected);
}

async fn show(
    r: &TestRepo,
    target: DiffTarget,
    path: &str,
    old: Option<&str>,
    ctx: u32,
) -> FileDiff {
    git()
        .diff(
            r.path(),
            &DiffRequest {
                target,
                path: path.to_owned(),
                old_path: old.map(str::to_owned),
                context: ctx,
                ignore_whitespace: false,
                force: true,
            },
        )
        .await
        .unwrap()
}

/// How a case selects lines: explicit `[hunk, line]` indices, or changed lines by text
/// (`"+new"`, `"-old"`), which are resolved to indices of the shown diff.
#[derive(Clone, Copy)]
enum Sel {
    At(&'static [[u32; 2]]),
    Text(&'static [&'static str]),
}

fn resolve(diff: &FileDiff, sel: Sel) -> Vec<[u32; 2]> {
    let DiffContent::Text { hunks, .. } = &diff.content else {
        panic!("expected a text diff, got {:?}", diff.content);
    };
    match sel {
        Sel::At(at) => at.to_vec(),
        Sel::Text(wanted) => wanted
            .iter()
            .map(|w| {
                let (kind, text) = match w.split_at(1) {
                    ("+", t) => (LineKind::Add, t),
                    ("-", t) => (LineKind::Del, t),
                    _ => panic!("selector {w:?} must start with + or -"),
                };
                hunks
                    .iter()
                    .enumerate()
                    .flat_map(|(h, hunk)| {
                        hunk.lines
                            .iter()
                            .enumerate()
                            .map(move |(l, line)| (h, l, line))
                    })
                    .find(|(_, _, line)| line.kind == kind && line.text == text)
                    .map(|(h, l, _)| [h as u32, l as u32])
                    .unwrap_or_else(|| panic!("no line {w:?} in {hunks:#?}"))
            })
            .collect(),
    }
}

struct Op<'a> {
    action: LineAction,
    source: DiffTarget,
    path: &'a str,
    old_path: Option<&'a str>,
    context: u32,
}

impl<'a> Op<'a> {
    fn new(action: LineAction, path: &'a str) -> Self {
        let source = match action {
            LineAction::Unstage => DiffTarget::Staged,
            _ => DiffTarget::Unstaged,
        };
        Self {
            action,
            source,
            path,
            old_path: None,
            context: 3,
        }
    }

    fn request(&self, diff: &FileDiff, lines: Vec<[u32; 2]>) -> LinesRequest {
        LinesRequest {
            path: self.path.to_owned(),
            old_path: self.old_path.map(str::to_owned),
            action: self.action,
            source: self.source.clone(),
            context: self.context,
            fingerprint: diff.fingerprint.clone(),
            lines,
        }
    }

    /// Shows the diff, selects lines and applies them.
    async fn run(&self, r: &TestRepo, sel: Sel) -> Result<(), GitError> {
        let diff = show(
            r,
            self.source.clone(),
            self.path,
            self.old_path,
            self.context,
        )
        .await;
        let req = self.request(&diff, resolve(&diff, sel));
        git().apply_lines(r.path(), &req).await
    }
}

fn invalid_input(result: Result<(), GitError>) -> String {
    match result {
        Err(GitError::InvalidInput(msg)) => msg,
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------------------
// Staging

struct StageCase {
    name: &'static str,
    head: Vec<u8>,
    work: Vec<u8>,
    context: u32,
    sel: Sel,
    /// Expected index content.
    index: Vec<u8>,
    /// Expected hunks of `git diff --cached` (the header is the plain modification one).
    staged: &'static [u8],
}

fn stage_cases() -> Vec<StageCase> {
    vec![
        StageCase {
            name: "single added line in the middle of a hunk",
            head: file("1-16"),
            work: file("1-7 8x 9 9a 10-16"),
            context: 3,
            sel: Sel::At(&[[0, 6]]),
            index: file("1-9 9a 10-16"),
            staged: b"@@ -7,6 +7,7 @@\n 7\n 8\n 9\n+9a\n 10\n 11\n 12\n",
        },
        StageCase {
            name: "first line",
            head: file("1-16"),
            work: file("1x 2-15 16x"),
            context: 3,
            sel: Sel::At(&[[0, 0], [0, 1]]),
            index: file("1x 2-16"),
            staged: b"@@ -1,4 +1,4 @@\n-1\n+1x\n 2\n 3\n 4\n",
        },
        StageCase {
            name: "last line",
            head: file("1-16"),
            work: file("1x 2-15 16x"),
            context: 3,
            sel: Sel::At(&[[1, 3], [1, 4]]),
            index: file("1-15 16x"),
            staged: b"@@ -13,4 +13,4 @@\n 13\n 14\n 15\n-16\n+16x\n",
        },
        StageCase {
            name: "adjacent hunks, select from the second only",
            head: file("1-16"),
            work: file("1-4 5x 6-12 13x 14-16"),
            context: 3,
            sel: Sel::Text(&["-13", "+13x"]),
            index: file("1-12 13x 14-16"),
            staged: b"@@ -10,7 +10,7 @@\n 10\n 11\n 12\n-13\n+13x\n 14\n 15\n 16\n",
        },
        StageCase {
            name: "several hunks, partially",
            head: file("1-30"),
            work: file("1 2x 3-14 15x 16-27 28x 28y 29 30"),
            context: 3,
            sel: Sel::Text(&["-2", "+2x", "-28", "+28y"]),
            index: file("1 2x 3-27 28y 29 30"),
            staged: b"@@ -1,5 +1,5 @@\n 1\n-2\n+2x\n 3\n 4\n 5\n@@ -25,6 +25,6 @@\n 25\n 26\n 27\n-28\n+28y\n 29\n 30\n",
        },
        StageCase {
            name: "unselected removed line is kept",
            head: file("1-10"),
            work: file("1-3 X 6-10"),
            context: 3,
            sel: Sel::Text(&["-4"]),
            index: file("1-3 5-10"),
            staged: b"@@ -1,7 +1,6 @@\n 1\n 2\n 3\n-4\n 5\n 6\n 7\n",
        },
        StageCase {
            name: "added line next to unselected removals",
            head: file("1-10"),
            work: file("1-3 X 6-10"),
            context: 3,
            sel: Sel::Text(&["+X"]),
            index: file("1-5 X 6-10"),
            staged: b"@@ -3,6 +3,7 @@\n 3\n 4\n 5\n+X\n 6\n 7\n 8\n",
        },
        StageCase {
            name: "zero context, replaced line in the second hunk",
            head: file("1-10"),
            work: file("1 2x 3-9 10x"),
            context: 0,
            sel: Sel::At(&[[1, 0], [1, 1]]),
            index: file("1-9 10x"),
            staged: b"@@ -7,4 +7,4 @@\n 7\n 8\n 9\n-10\n+10x\n",
        },
        StageCase {
            name: "zero context, pure insertion",
            head: file("1-10"),
            work: file("1 2x 3-5 5a 6-10"),
            context: 0,
            sel: Sel::At(&[[1, 0]]),
            index: file("1-5 5a 6-10"),
            staged: b"@@ -3,6 +3,7 @@\n 3\n 4\n 5\n+5a\n 6\n 7\n 8\n",
        },
        StageCase {
            name: "whole-file diff (full context)",
            head: file("1-16"),
            work: file("1-7 8x 9 9a 10-16"),
            context: FULL_CONTEXT,
            sel: Sel::Text(&["-8", "+8x"]),
            index: file("1-7 8x 9-16"),
            staged: b"@@ -5,7 +5,7 @@\n 5\n 6\n 7\n-8\n+8x\n 9\n 10\n 11\n",
        },
        StageCase {
            name: "CRLF bytes are kept",
            head: b"a\r\nb\r\nc\r\n".to_vec(),
            work: b"a\r\nB\r\nc\r\nd\r\n".to_vec(),
            context: 3,
            sel: Sel::Text(&["+d"]),
            index: b"a\r\nb\r\nc\r\nd\r\n".to_vec(),
            staged: b"@@ -1,3 +1,4 @@\n a\r\n b\r\n c\r\n+d\r\n",
        },
        StageCase {
            name: "non-UTF-8 (Latin-1) bytes are kept",
            head: b"caf\xe9\nna\xefve\n".to_vec(),
            work: b"caf\xe9!\nna\xefve\nd\xe9j\xe0\n".to_vec(),
            context: 3,
            sel: Sel::At(&[[0, 3]]),
            index: b"caf\xe9\nna\xefve\nd\xe9j\xe0\n".to_vec(),
            staged: b"@@ -1,2 +1,3 @@\n caf\xe9\n na\xefve\n+d\xe9j\xe0\n",
        },
        StageCase {
            name: "no EOL: added last line",
            head: b"a\nb\n".to_vec(),
            work: b"a\nb\nc".to_vec(),
            context: 3,
            sel: Sel::Text(&["+c"]),
            index: b"a\nb\nc".to_vec(),
            staged: b"@@ -1,2 +1,3 @@\n a\n b\n+c\n\\ No newline at end of file\n",
        },
        StageCase {
            name: "no EOL: removed last line",
            head: b"a\nb\nc".to_vec(),
            work: b"a\nb\n".to_vec(),
            context: 3,
            sel: Sel::Text(&["-c"]),
            index: b"a\nb\n".to_vec(),
            staged: b"@@ -1,3 +1,2 @@\n a\n b\n-c\n\\ No newline at end of file\n",
        },
        StageCase {
            name: "no EOL: changed last line, addition only",
            head: b"a\nb".to_vec(),
            work: b"a\nB".to_vec(),
            context: 3,
            sel: Sel::Text(&["+B"]),
            index: b"a\nb\nB".to_vec(),
            staged: b"@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+B\n\\ No newline at end of file\n",
        },
        StageCase {
            name: "no EOL: changed last line, removal only",
            head: b"a\nb".to_vec(),
            work: b"a\nB".to_vec(),
            context: 3,
            sel: Sel::Text(&["-b"]),
            index: b"a\n".to_vec(),
            staged: b"@@ -1,2 +1 @@\n a\n-b\n\\ No newline at end of file\n",
        },
        StageCase {
            name: "no EOL: changed last line, both",
            head: b"a\nb".to_vec(),
            work: b"a\nB".to_vec(),
            context: 3,
            sel: Sel::Text(&["-b", "+B"]),
            index: b"a\nB".to_vec(),
            staged: b"@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n",
        },
        StageCase {
            name: "no EOL: line appended after a last line that gains its newline",
            head: b"a\nb".to_vec(),
            work: b"a\nb\nc\n".to_vec(),
            context: 3,
            sel: Sel::Text(&["+c"]),
            index: b"a\nb\nc\n".to_vec(),
            staged: b"@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+c\n",
        },
    ]
}

#[tokio::test]
async fn stage_selected_lines() {
    for case in stage_cases() {
        let r = repo();
        write(&r, "f.txt", &case.head);
        commit_all(&r);
        write(&r, "f.txt", &case.work);
        let op = Op {
            context: case.context,
            ..Op::new(LineAction::Stage, "f.txt")
        };
        op.run(&r, case.sel)
            .await
            .unwrap_or_else(|e| panic!("{}: {e:?}", case.name));
        assert_eq!(
            String::from_utf8_lossy(&index_blob(&r, "f.txt")),
            String::from_utf8_lossy(&case.index),
            "{}: index",
            case.name
        );
        assert_eq!(
            index_blob(&r, "f.txt"),
            case.index,
            "{}: index bytes",
            case.name
        );
        let mut expected = modified("f.txt", "").into_bytes();
        expected.extend_from_slice(case.staged);
        assert_eq!(
            String::from_utf8_lossy(&staged_diff(&r)),
            String::from_utf8_lossy(&expected),
            "{}: git diff --cached",
            case.name
        );
        assert_eq!(staged_diff(&r), expected, "{}: diff bytes", case.name);
        assert_eq!(read(&r, "f.txt"), case.work, "{}: worktree", case.name);
    }
}

// ---------------------------------------------------------------------------------------
// Unstaging and discarding

struct ReverseCase {
    name: &'static str,
    action: LineAction,
    head: Vec<u8>,
    index: Vec<u8>,
    work: Vec<u8>,
    sel: Sel,
    /// Expected index (unstage) or working tree (discard) content; the other one must not
    /// change.
    result: Vec<u8>,
}

fn reverse_cases() -> Vec<ReverseCase> {
    use LineAction::{Discard, Unstage};
    vec![
        ReverseCase {
            name: "unstage an added line",
            action: Unstage,
            head: file("1-16"),
            index: file("1-7 8x 9 9a 10-16"),
            work: file("1-7 8x 9 9a 10-15 16x"),
            sel: Sel::Text(&["+9a"]),
            result: file("1-7 8x 9-16"),
        },
        ReverseCase {
            name: "unstage a removed line next to an unselected addition",
            action: Unstage,
            head: file("1-16"),
            index: file("1-7 8x 9 9a 10-16"),
            work: file("1-7 8x 9 9a 10-15 16x"),
            sel: Sel::Text(&["-8"]),
            result: file("1-8 8x 9 9a 10-16"),
        },
        ReverseCase {
            name: "unstage, no EOL: changed last line, removal only",
            action: Unstage,
            head: b"a\nb".to_vec(),
            index: b"a\nB".to_vec(),
            work: b"a\nB".to_vec(),
            sel: Sel::Text(&["-b"]),
            result: b"a\nb\nB".to_vec(),
        },
        ReverseCase {
            name: "unstage, no EOL: changed last line, addition only",
            action: Unstage,
            head: b"a\nb".to_vec(),
            index: b"a\nB".to_vec(),
            work: b"a\nB".to_vec(),
            sel: Sel::Text(&["+B"]),
            result: b"a\n".to_vec(),
        },
        ReverseCase {
            // Staging-style patch building fails here: see `discard_is_not_staging_style`.
            name: "discard an added line next to an unselected change",
            action: Discard,
            head: file("1-16"),
            index: file("1-15 16x"),
            work: file("1-7 8x 9 9a 10-15 16x"),
            sel: Sel::Text(&["+9a"]),
            result: file("1-7 8x 9 10-15 16x"),
        },
        ReverseCase {
            name: "discard a removal",
            action: Discard,
            head: file("1-16"),
            index: file("1-15 16x"),
            work: file("1-7 8x 9 9a 10-15 16x"),
            sel: Sel::Text(&["-8"]),
            result: file("1-8 8x 9 9a 10-15 16x"),
        },
        ReverseCase {
            name: "discard several hunks",
            action: Discard,
            head: file("1-30"),
            index: file("1-30"),
            work: file("1 2x 3-14 15x 16-27 28x 28y 29 30"),
            sel: Sel::Text(&["-2", "+2x", "+28y"]),
            result: file("1-14 15x 16-27 28x 29 30"),
        },
        ReverseCase {
            name: "discard, no EOL: changed last line, removal only",
            action: Discard,
            head: b"a\nb".to_vec(),
            index: b"a\nb".to_vec(),
            work: b"a\nB".to_vec(),
            sel: Sel::Text(&["-b"]),
            result: b"a\nb\nB".to_vec(),
        },
        ReverseCase {
            name: "discard, no EOL: changed last line, addition only",
            action: Discard,
            head: b"a\nb".to_vec(),
            index: b"a\nb".to_vec(),
            work: b"a\nB".to_vec(),
            sel: Sel::Text(&["+B"]),
            result: b"a\n".to_vec(),
        },
        ReverseCase {
            name: "discard, no EOL: added last line",
            action: Discard,
            head: b"a\nb\n".to_vec(),
            index: b"a\nb\n".to_vec(),
            work: b"a\nb\nc".to_vec(),
            sel: Sel::Text(&["+c"]),
            result: b"a\nb\n".to_vec(),
        },
        ReverseCase {
            name: "discard keeps CRLF bytes",
            action: Discard,
            head: b"a\r\nb\r\nc\r\n".to_vec(),
            index: b"a\r\nb\r\nc\r\n".to_vec(),
            work: b"a\r\nX\r\nb\r\nc\r\nY\r\n".to_vec(),
            sel: Sel::Text(&["+X"]),
            result: b"a\r\nb\r\nc\r\nY\r\n".to_vec(),
        },
    ]
}

#[tokio::test]
async fn unstage_and_discard_selected_lines() {
    for case in reverse_cases() {
        let r = repo();
        write(&r, "f.txt", &case.head);
        commit_all(&r);
        write(&r, "f.txt", &case.index);
        r.git(&["add", "f.txt"]);
        write(&r, "f.txt", &case.work);
        let staged_before = staged_diff(&r);

        Op::new(case.action, "f.txt")
            .run(&r, case.sel)
            .await
            .unwrap_or_else(|e| panic!("{}: {e:?}", case.name));

        let (index, work) = match case.action {
            LineAction::Unstage => (case.result.clone(), case.work.clone()),
            _ => (case.index.clone(), case.result.clone()),
        };
        assert_eq!(
            String::from_utf8_lossy(&index_blob(&r, "f.txt")),
            String::from_utf8_lossy(&index),
            "{}: index",
            case.name
        );
        assert_eq!(index_blob(&r, "f.txt"), index, "{}: index bytes", case.name);
        assert_eq!(
            String::from_utf8_lossy(&read(&r, "f.txt")),
            String::from_utf8_lossy(&work),
            "{}: worktree",
            case.name
        );
        assert_eq!(read(&r, "f.txt"), work, "{}: worktree bytes", case.name);
        if case.action == LineAction::Discard {
            assert_eq!(
                staged_diff(&r),
                staged_before,
                "{}: index changed",
                case.name
            );
        }
    }
}

#[tokio::test]
async fn unstage_shows_the_exact_remaining_staged_diff() {
    let r = repo();
    write(&r, "f.txt", &file("1-16"));
    commit_all(&r);
    write(&r, "f.txt", &file("1-7 8x 9 9a 10-16"));
    r.git(&["add", "f.txt"]);
    write(&r, "f.txt", &file("1-7 8x 9 9a 10-15 16x"));
    Op::new(LineAction::Unstage, "f.txt")
        .run(&r, Sel::Text(&["-8"]))
        .await
        .unwrap();
    assert_bytes(
        &staged_diff(&r),
        modified(
            "f.txt",
            "@@ -6,7 +6,9 @@\n 6\n 7\n 8\n+8x\n 9\n+9a\n 10\n 11\n 12\n",
        )
        .as_bytes(),
    );
    assert_eq!(read(&r, "f.txt"), file("1-7 8x 9 9a 10-15 16x"));
}

/// ARCHITECTURE §5.6 says discard is built "the same as staging". That patch's new side drops
/// unselected `+` lines, so it doesn't match the working tree and can't be reverse-applied.
#[tokio::test]
async fn discard_is_not_staging_style() {
    let r = repo();
    write(&r, "f.txt", &file("1-16"));
    commit_all(&r);
    write(&r, "f.txt", &file("1-7 8x 9 9a 10-16"));
    // Staging-style patch for selecting `+9a`: `-8` → context, `+8x` dropped.
    let staging_style = modified(
        "f.txt",
        "@@ -5,8 +5,9 @@\n 5\n 6\n 7\n 8\n 9\n+9a\n 10\n 11\n 12\n",
    );
    let check = Command::new("git")
        .args(["apply", "--reverse", "--check", "--recount", "-"])
        .current_dir(r.path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(staging_style.as_bytes())?;
            child.wait()
        })
        .unwrap();
    assert!(
        !check.success(),
        "staging-style discard patch should not apply"
    );

    Op::new(LineAction::Discard, "f.txt")
        .run(&r, Sel::Text(&["+9a"]))
        .await
        .unwrap();
    assert_eq!(read(&r, "f.txt"), file("1-7 8x 9 10-16"));
}

// ---------------------------------------------------------------------------------------
// New, deleted, renamed and mode-changed files

#[tokio::test]
async fn stage_lines_of_an_untracked_file() {
    let r = repo();
    write(&r, "base.txt", b"base\n");
    commit_all(&r);

    // Partial: only the selected lines reach the index.
    write(&r, "n.txt", b"a\nb\nc");
    let op = Op {
        source: DiffTarget::Untracked,
        ..Op::new(LineAction::Stage, "n.txt")
    };
    op.run(&r, Sel::Text(&["+a", "+c"])).await.unwrap();
    assert_bytes(&index_blob(&r, "n.txt"), b"a\nc");
    assert_bytes(
        &staged_diff(&r),
        b"diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+c\n\\ No newline at end of file\n",
    );
    assert_eq!(read(&r, "n.txt"), b"a\nb\nc");
    assert_eq!(r.git(&["status", "--porcelain", "--", "n.txt"]), "AM n.txt");

    // Full: the whole file is staged.
    write(&r, "m.txt", b"x\ny\n");
    let op = Op {
        source: DiffTarget::Untracked,
        ..Op::new(LineAction::Stage, "m.txt")
    };
    op.run(&r, Sel::At(&[[0, 0], [0, 1]])).await.unwrap();
    assert_bytes(&index_blob(&r, "m.txt"), b"x\ny\n");
    assert_eq!(r.git(&["status", "--porcelain", "--", "m.txt"]), "A  m.txt");
}

#[tokio::test]
async fn stage_lines_of_an_untracked_file_without_commits_or_with_autocrlf() {
    // No HEAD yet, and `core.autocrlf`: the `--no-index` diff shows CRLF, the index diff LF.
    let r = TestRepo::new();
    r.git(&["config", "core.autocrlf", "true"]);
    write(&r, "n.txt", b"a\r\nb\r\nc\r\n");
    let op = Op {
        source: DiffTarget::Untracked,
        ..Op::new(LineAction::Stage, "n.txt")
    };
    op.run(&r, Sel::Text(&["+b"])).await.unwrap();
    assert_bytes(&index_blob(&r, "n.txt"), b"b\n");
    assert_eq!(read(&r, "n.txt"), b"a\r\nb\r\nc\r\n");
}

#[tokio::test]
async fn failed_untracked_staging_leaves_no_intent_to_add_entry() {
    let r = repo();
    write(&r, "base.txt", b"base\n");
    commit_all(&r);
    write(&r, "n.txt", b"a\nb\n");
    let op = Op {
        source: DiffTarget::Untracked,
        ..Op::new(LineAction::Stage, "n.txt")
    };
    let diff = show(&r, DiffTarget::Untracked, "n.txt", None, 3).await;
    write(&r, "n.txt", b"a\nB\n");
    let msg = invalid_input(
        git()
            .apply_lines(r.path(), &op.request(&diff, vec![[0, 0]]))
            .await,
    );
    assert!(msg.contains("changed since"), "{msg}");
    assert_eq!(r.git(&["ls-files", "--", "n.txt"]), "");

    // A failure after `git add -N`: a clean filter whose output changes from its third run on
    // (shown, checked, then re-diffed after `add -N`) makes the post-`add -N` diff differ.
    let counter = r.path().join(".git").join("clean-count");
    let counter = counter.to_string_lossy().replace('\\', "/");
    r.git(&[
        "config",
        "filter.count.clean",
        &format!(
            "sh -c 'n=$(cat \"{counter}\" 2>/dev/null || echo 0); n=$((n+1)); echo $n > \"{counter}\"; cat; if [ $n -ge 3 ]; then echo extra; fi'"
        ),
    ]);
    write(&r, ".gitattributes", b"t.txt filter=count\n");
    write(&r, "t.txt", b"a\nb\n");
    let op = Op {
        source: DiffTarget::Untracked,
        ..Op::new(LineAction::Stage, "t.txt")
    };
    let msg = invalid_input(op.run(&r, Sel::Text(&["+a"])).await);
    assert!(msg.contains("changed since"), "{msg}");
    assert_eq!(
        r.git(&["ls-files", "--", "t.txt"]),
        "",
        "intent-to-add entry left behind"
    );

    // Discarding lines of an untracked file isn't a line operation.
    let discard = Op {
        source: DiffTarget::Untracked,
        ..Op::new(LineAction::Discard, "n.txt")
    };
    let diff = show(&r, DiffTarget::Untracked, "n.txt", None, 3).await;
    invalid_input(
        git()
            .apply_lines(r.path(), &discard.request(&diff, vec![[0, 0]]))
            .await,
    );
    assert_eq!(read(&r, "n.txt"), b"a\nB\n");
}

#[tokio::test]
async fn unstage_lines_of_a_new_file() {
    let r = repo();
    write(&r, "base.txt", b"base\n");
    commit_all(&r);
    write(&r, "n.txt", b"a\nb\nc\n");
    r.git(&["add", "n.txt"]);

    Op::new(LineAction::Unstage, "n.txt")
        .run(&r, Sel::Text(&["+b"]))
        .await
        .unwrap();
    assert_bytes(&index_blob(&r, "n.txt"), b"a\nc\n");
    assert_eq!(read(&r, "n.txt"), b"a\nb\nc\n");

    // All remaining lines: the file is no longer staged at all.
    Op::new(LineAction::Unstage, "n.txt")
        .run(&r, Sel::Text(&["+a", "+c"]))
        .await
        .unwrap();
    assert_eq!(r.git(&["ls-files", "--", "n.txt"]), "");
    assert_eq!(read(&r, "n.txt"), b"a\nb\nc\n");
}

#[tokio::test]
async fn stage_lines_of_a_deleted_file() {
    let r = repo();
    write(&r, "d.txt", &file("1-5"));
    commit_all(&r);
    std::fs::remove_file(r.path().join("d.txt")).unwrap();

    // Some lines: the file stays, without them.
    Op::new(LineAction::Stage, "d.txt")
        .run(&r, Sel::Text(&["-2", "-4"]))
        .await
        .unwrap();
    assert_bytes(&index_blob(&r, "d.txt"), &file("1 3 5"));
    assert_bytes(
        &staged_diff(&r),
        modified("d.txt", "@@ -1,5 +1,3 @@\n 1\n-2\n 3\n-4\n 5\n").as_bytes(),
    );

    // The rest: the deletion itself is staged.
    Op::new(LineAction::Stage, "d.txt")
        .run(&r, Sel::At(&[[0, 0], [0, 1], [0, 2]]))
        .await
        .unwrap();
    assert_eq!(r.git(&["ls-files", "--", "d.txt"]), "");
    assert_bytes(
        &staged_diff(&r),
        b"diff --git a/d.txt b/d.txt\ndeleted file mode 100644\n--- a/d.txt\n+++ /dev/null\n@@ -1,5 +0,0 @@\n-1\n-2\n-3\n-4\n-5\n",
    );
    assert!(!r.path().join("d.txt").exists());
}

#[tokio::test]
async fn stage_whole_deletion_at_once_and_unstage_part_of_it() {
    let r = repo();
    write(&r, "d.txt", &file("1-5"));
    commit_all(&r);
    std::fs::remove_file(r.path().join("d.txt")).unwrap();
    Op::new(LineAction::Stage, "d.txt")
        .run(&r, Sel::At(&[[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]))
        .await
        .unwrap();
    assert_eq!(r.git(&["ls-files", "--", "d.txt"]), "");

    // Unstage the removal of 2 and 3: the index has the file again, with just those lines.
    Op::new(LineAction::Unstage, "d.txt")
        .run(&r, Sel::Text(&["-2", "-3"]))
        .await
        .unwrap();
    assert_bytes(&index_blob(&r, "d.txt"), &file("2 3"));
    assert!(!r.path().join("d.txt").exists());
}

#[tokio::test]
async fn unstage_part_of_a_renamed_and_modified_file() {
    let r = repo();
    write(&r, "old.txt", &file("1-12"));
    commit_all(&r);
    r.git(&["mv", "old.txt", "new.txt"]);
    write(&r, "new.txt", &file("1x 2-11 12x"));
    r.git(&["add", "new.txt"]);
    let op = Op {
        old_path: Some("old.txt"),
        ..Op::new(LineAction::Unstage, "new.txt")
    };
    op.run(&r, Sel::At(&[[1, 3], [1, 4]])).await.unwrap();

    // Still a staged rename, now with only the first change.
    assert_bytes(&index_blob(&r, "new.txt"), &file("1x 2-12"));
    assert_eq!(r.git(&["ls-files", "--", "old.txt"]), "");
    let staged = String::from_utf8(staged_diff(&r)).unwrap();
    assert!(
        staged.starts_with("diff --git a/old.txt b/new.txt\nsimilarity index "),
        "{staged}"
    );
    assert!(
        staged.ends_with(
            "rename from old.txt\nrename to new.txt\n--- a/old.txt\n+++ b/new.txt\n@@ -1,4 +1,4 @@\n-1\n+1x\n 2\n 3\n 4\n"
        ),
        "{staged}"
    );
    assert_eq!(read(&r, "new.txt"), file("1x 2-11 12x"));
}

#[tokio::test]
async fn stage_and_discard_lines_of_a_renamed_file() {
    let r = repo();
    write(&r, "old.txt", &file("1-12"));
    commit_all(&r);
    r.git(&["mv", "old.txt", "new.txt"]);
    write(&r, "new.txt", &file("1x 2-11 12x"));
    // The UI passes the rename's source for an unstaged diff of a renamed file too.
    let stage = Op {
        old_path: Some("old.txt"),
        ..Op::new(LineAction::Stage, "new.txt")
    };
    stage.run(&r, Sel::Text(&["-1", "+1x"])).await.unwrap();
    assert_bytes(&index_blob(&r, "new.txt"), &file("1x 2-12"));

    let discard = Op {
        old_path: Some("old.txt"),
        ..Op::new(LineAction::Discard, "new.txt")
    };
    discard.run(&r, Sel::Text(&["+12x"])).await.unwrap();
    assert_bytes(&read(&r, "new.txt"), &file("1x 2-11"));
    assert_bytes(&index_blob(&r, "new.txt"), &file("1x 2-12"));
}

/// Line operations change content only; a staged mode change stays staged.
#[tokio::test]
async fn unstage_lines_keeps_a_staged_mode_change() {
    let r = repo();
    write(&r, "run.sh", &file("1-10"));
    commit_all(&r);
    write(&r, "run.sh", &file("1x 2-9 10x"));
    r.git(&["add", "run.sh"]);
    r.git(&["update-index", "--chmod=+x", "run.sh"]);

    Op::new(LineAction::Unstage, "run.sh")
        .run(&r, Sel::Text(&["-10", "+10x"]))
        .await
        .unwrap();
    assert_bytes(&index_blob(&r, "run.sh"), &file("1x 2-10"));
    assert!(
        r.git(&["ls-files", "-s", "--", "run.sh"])
            .starts_with("100755 ")
    );
    assert_bytes(
        &staged_diff(&r),
        b"diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n--- a/run.sh\n+++ b/run.sh\n@@ -1,4 +1,4 @@\n-1\n+1x\n 2\n 3\n 4\n",
    );
}

// ---------------------------------------------------------------------------------------
// Rejections

#[tokio::test]
async fn binary_files_are_rejected() {
    let r = repo();
    write(&r, "b.bin", b"\x00\x01\x02");
    commit_all(&r);
    write(&r, "b.bin", b"\x00\x01\x03");
    let op = Op::new(LineAction::Stage, "b.bin");
    let diff = show(&r, DiffTarget::Unstaged, "b.bin", None, 3).await;
    assert_eq!(diff.content, DiffContent::Binary);
    let msg = invalid_input(
        git()
            .apply_lines(r.path(), &op.request(&diff, vec![[0, 0]]))
            .await,
    );
    assert!(msg.contains("Binary"), "{msg}");
    assert_eq!(r.git(&["diff", "--cached", "--name-only"]), "");
}

#[tokio::test]
async fn stale_fingerprint_is_rejected() {
    let r = repo();
    write(&r, "f.txt", &file("1-5"));
    commit_all(&r);
    write(&r, "f.txt", &file("1 2x 3-5"));
    let op = Op::new(LineAction::Stage, "f.txt");
    let diff = show(&r, DiffTarget::Unstaged, "f.txt", None, 3).await;
    write(&r, "f.txt", &file("1 2y 3-5"));
    let msg = invalid_input(
        git()
            .apply_lines(
                r.path(),
                &op.request(&diff, resolve(&diff, Sel::Text(&["+2x"]))),
            )
            .await,
    );
    assert!(msg.contains("changed since the diff was shown"), "{msg}");
    assert_eq!(r.git(&["diff", "--cached", "--name-only"]), "");
}

#[tokio::test]
async fn empty_and_context_only_selections_are_rejected() {
    let r = repo();
    write(&r, "f.txt", &file("1-5"));
    commit_all(&r);
    write(&r, "f.txt", &file("1 2x 3-5"));
    let op = Op::new(LineAction::Stage, "f.txt");
    let diff = show(&r, DiffTarget::Unstaged, "f.txt", None, 3).await;
    invalid_input(
        git()
            .apply_lines(r.path(), &op.request(&diff, vec![]))
            .await,
    );
    // Line 0 is the context line `1`.
    invalid_input(
        git()
            .apply_lines(r.path(), &op.request(&diff, vec![[0, 0]]))
            .await,
    );
    // Out of range.
    invalid_input(
        git()
            .apply_lines(r.path(), &op.request(&diff, vec![[3, 0]]))
            .await,
    );
    assert_eq!(r.git(&["diff", "--cached", "--name-only"]), "");
}

#[tokio::test]
async fn actions_must_match_their_source() {
    let r = repo();
    write(&r, "f.txt", &file("1-5"));
    commit_all(&r);
    write(&r, "f.txt", &file("1 2x 3-5"));
    let diff = show(&r, DiffTarget::Unstaged, "f.txt", None, 3).await;
    let unstage_unstaged = Op {
        source: DiffTarget::Unstaged,
        ..Op::new(LineAction::Unstage, "f.txt")
    };
    invalid_input(
        git()
            .apply_lines(r.path(), &unstage_unstaged.request(&diff, vec![[0, 1]]))
            .await,
    );
    let stage_staged = Op {
        source: DiffTarget::Staged,
        ..Op::new(LineAction::Stage, "f.txt")
    };
    invalid_input(
        git()
            .apply_lines(r.path(), &stage_staged.request(&diff, vec![[0, 1]]))
            .await,
    );
}
