//! Measures history streaming on a real repository (Phase 1 acceptance: first rows of
//! `git/git` in under 300 ms):
//! `cargo run --release -p tylia-git --example history-timing -- <repo>`.

use std::path::PathBuf;
use std::time::Instant;

use tylia_git::{Git, LogOptions};

fn main() {
    let repo = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("usage: history-timing <repo>"),
    );
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    runtime.block_on(async {
        let git = Git::discover().expect("git");
        for run in 1..=1 {
            let start = Instant::now();
            let head = git.refs(&repo).await.expect("refs").head.oid;
            let refs_ms = start.elapsed().as_millis();
            let mut first = None;
            let mut max_width = 0;
            let (mut json_bytes, mut segments) = (0usize, 0usize);
            let total = git
                .stream_history(&repo, LogOptions::default(), head.as_deref(), |batch| {
                    first.get_or_insert_with(|| start.elapsed().as_millis());
                    max_width = batch.rows.iter().map(|r| r.graph.width).fold(max_width, u16::max);
                    json_bytes += serde_json::to_vec(&batch).map_or(0, |v| v.len());
                    segments += batch.segments.len();
                    true
                })
                .await
                .expect("history");
            println!(
                "run {run}: refs {refs_ms} ms, first rows {} ms, all {total} rows {} ms, widest row {max_width} lanes, JSON {} MB, {segments} segments",
                first.unwrap_or_default(),
                start.elapsed().as_millis(),
                json_bytes / 1_000_000
            );
        }
    });
}
