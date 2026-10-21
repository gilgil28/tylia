//! Dumps a repository's data as JSON for the frontend's mock backend:
//! `cargo run -p tylia-git --example dump-fixture -- <repo> <out.json> [max-rows]`.
//!
//! Includes refs, status, the first history rows, details of the newest commits and diffs of
//! their files, plus diffs of uncommitted changes.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{Value, json};
use tylia_git::{DiffRequest, DiffTarget, Git, HistoryRow, LogOptions, Segment};

/// Commits whose details and diffs are included.
const DETAILED_COMMITS: usize = 40;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(repo), Some(out)) = (args.next(), args.next()) else {
        eprintln!("usage: dump-fixture <repo> <out.json> [max-rows]");
        std::process::exit(2);
    };
    let max_rows: usize = args.next().and_then(|n| n.parse().ok()).unwrap_or(500);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let fixture = runtime.block_on(dump(PathBuf::from(repo), max_rows));
    std::fs::write(&out, serde_json::to_string_pretty(&fixture).unwrap()).expect("write output");
    eprintln!("wrote {out}");
}

fn diff_request(target: DiffTarget, path: &str, old_path: Option<&str>) -> DiffRequest {
    DiffRequest {
        target,
        path: path.to_owned(),
        old_path: old_path.map(str::to_owned),
        context: 3,
        ignore_whitespace: false,
        force: false,
    }
}

async fn dump(repo: PathBuf, max_rows: usize) -> Value {
    let git = Git::discover().expect("git");
    let info = git.open_repo(&repo).await.expect("open repo");
    let refs = git.refs(&repo).await.expect("refs");
    let status = git.status(&repo).await.expect("status");

    let mut history: Vec<HistoryRow> = Vec::new();
    let mut segments: Vec<Segment> = Vec::new();
    let mut open: Vec<Segment> = Vec::new();
    git.stream_history(
        &repo,
        LogOptions::default(),
        refs.head.oid.as_deref(),
        |batch| {
            history.extend(batch.rows);
            segments.extend(batch.segments);
            open = batch.open;
            history.len() < max_rows
        },
    )
    .await
    .expect("history");
    // The mock serves everything as one batch, so open segments become closed ones.
    history.truncate(max_rows);
    segments.extend(open);

    let mut commits = BTreeMap::new();
    let mut diffs = BTreeMap::new();
    for row in history.iter().take(DETAILED_COMMITS) {
        let details = git.commit_details(&repo, &row.oid).await.expect("commit");
        for file in &details.files {
            let target = DiffTarget::Commit {
                oid: row.oid.clone(),
                parent: details.parents.first().cloned(),
            };
            let req = diff_request(target, &file.path, file.old_path.as_deref());
            let diff = git.diff(&repo, &req).await.expect("diff");
            diffs.insert(format!("{}:{}", row.oid, file.path), diff);
        }
        commits.insert(row.oid.clone(), details);
    }
    for entry in &status.entries {
        let add = |target: DiffTarget, key: &str| {
            let req = diff_request(target, &entry.path, entry.old_path.as_deref());
            (key.to_owned(), req)
        };
        let mut requests = Vec::new();
        if entry.staged.is_some() {
            requests.push(add(DiffTarget::Staged, "staged"));
        }
        match entry.unstaged {
            Some(tylia_git::FileStatus::Untracked) => {
                requests.push(add(DiffTarget::Untracked, "untracked"))
            }
            Some(_) => requests.push(add(DiffTarget::Unstaged, "unstaged")),
            None => {}
        }
        for (key, req) in requests {
            let diff = git.diff(&repo, &req).await.expect("diff");
            diffs.insert(format!("{key}:{}", entry.path), diff);
        }
    }

    json!({
        "repo": info,
        "refs": refs,
        "status": status,
        "history": history,
        "segments": segments,
        "commits": commits,
        "diffs": diffs,
    })
}
