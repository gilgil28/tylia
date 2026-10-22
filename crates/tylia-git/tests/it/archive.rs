//! Exporting archives of commits, branches and tags (Phase 8).

use std::process::Command;

use crate::common::TestRepo;
use tylia_git::{ArchiveFormat, Git, GitError};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

/// File names in a zip's central directory (no zip crate needed for a list of names).
fn zip_names(bytes: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    let mut i = 0;
    while i + 46 <= bytes.len() {
        if bytes[i..i + 4] == [0x50, 0x4b, 0x01, 0x02] {
            let len = u16::from_le_bytes([bytes[i + 28], bytes[i + 29]]) as usize;
            let extra = u16::from_le_bytes([bytes[i + 30], bytes[i + 31]]) as usize;
            let comment = u16::from_le_bytes([bytes[i + 32], bytes[i + 33]]) as usize;
            names.push(String::from_utf8_lossy(&bytes[i + 46..i + 46 + len]).into_owned());
            i += 46 + len + extra + comment;
        } else {
            i += 1;
        }
    }
    names.sort();
    names
}

fn tar_names(path: &std::path::Path) -> Vec<String> {
    let out = Command::new("tar").arg("-tzf").arg(path).output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let mut names: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::to_owned)
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn zip_and_tar_gz_hold_the_revs_files_under_one_folder() {
    let mut repo = TestRepo::new();
    repo.commit_file("README.md", "hi\n", "first");
    repo.commit_file("src/lib.rs", "fn main() {}\n", "second");
    repo.git(&["tag", "v1.0"]);
    repo.commit_file("later.txt", "not in v1.0\n", "third");
    repo.branch("feature/graph");
    repo.write("dirty.txt", "never committed\n");

    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("tag.zip");
    git()
        .export_archive(repo.path(), "v1.0", "v1.0", ArchiveFormat::Zip, &zip)
        .await
        .unwrap();
    // Leading dots are dropped, so the folder isn't hidden (temp dirs are `.tmpXXXX`).
    let name = repo
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let root = format!("{}-v1.0/", name.trim_start_matches('.'));
    assert_eq!(
        zip_names(&std::fs::read(&zip).unwrap()),
        [
            root.clone(),
            format!("{root}README.md"),
            format!("{root}src/"),
            format!("{root}src/lib.rs"),
        ]
    );

    let tgz = dir.path().join("branch.tar.gz");
    git()
        .export_archive(
            repo.path(),
            "feature/graph",
            "feature/graph",
            ArchiveFormat::TarGz,
            &tgz,
        )
        .await
        .unwrap();
    let bytes = std::fs::read(&tgz).unwrap();
    assert_eq!(bytes[..2], [0x1f, 0x8b], "gzip");
    let names = tar_names(&tgz);
    let root = names[0].clone();
    assert!(root.ends_with("-feature-graph/"), "{root}");
    assert!(names.contains(&format!("{root}later.txt")));
    assert!(!names.iter().any(|n| n.ends_with("dirty.txt")));
}

#[tokio::test]
async fn bad_revisions_are_refused_before_git_writes_anything() {
    let mut repo = TestRepo::new();
    repo.commit("first");
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("x.zip");
    for rev in ["--output=/tmp/evil", "no-such-branch"] {
        let result = git()
            .export_archive(repo.path(), rev, "x", ArchiveFormat::Zip, &file)
            .await;
        assert!(
            matches!(result, Err(GitError::InvalidInput(_))),
            "{rev}: {result:?}"
        );
    }
    assert!(!file.exists());
}
