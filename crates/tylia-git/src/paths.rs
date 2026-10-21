//! Every path a repository has ever had, for history search by file ("Path") and its
//! suggestions.
//!
//! The index is the set of paths added by any commit reachable from any ref (a renamed or
//! deleted file is still in it), built once with `git log --diff-filter=A --name-only` and
//! then extended with only the commits that appeared since. What the user types is resolved
//! against it into exact paths, which Git searches much faster than glob pathspecs (tree
//! pruning and changed-path Bloom filters apply).

use std::collections::{BTreeSet, HashSet};
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::log::LogOptions;
use crate::runner::{Git, RunOptions, lossy, split_nul};

/// More matches than this search with one glob pathspec instead of exact paths (slower, but
/// the command line stays short).
const MAX_EXACT_PATHS: usize = 200;

/// The paths of a repository's whole history.
#[derive(Debug, Clone, Default)]
pub struct PathIndex {
    /// Commits (peeled ref targets) already walked; the next update starts after them.
    tips: Vec<String>,
    files: BTreeSet<String>,
    dirs: BTreeSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PathKind {
    File,
    Dir,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PathSuggestion {
    /// Repository-relative, `/`-separated; directories end with `/`.
    pub path: String,
    pub kind: PathKind,
    /// Only in history: not in the current tree (deleted or renamed away).
    pub deleted: bool,
}

/// How a path query is searched: the pathspecs to pass to `git log`, and whether to follow
/// renames (a single file).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathQuery {
    pub pathspecs: Vec<String>,
    pub follow: bool,
}

impl PathIndex {
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    fn add(&mut self, path: &str) {
        let mut end = path.len();
        while let Some(i) = path[..end].rfind('/') {
            if !self.dirs.insert(path[..i].to_owned()) {
                break; // Its parents are already in.
            }
            end = i;
        }
        self.files.insert(path.to_owned());
    }

    /// An index from a fixed list of paths (tests, and before the history walk is done).
    pub fn from_paths<'a>(paths: impl IntoIterator<Item = &'a str>) -> Self {
        let mut index = Self::default();
        for p in paths {
            index.add(p);
        }
        index
    }

    /// Resolves what the user typed into pathspecs:
    /// - `*` / `?` wildcards: the paths they match (`*.gradle` matches by file name, a
    ///   pattern with `/` matches the whole path, `**` crosses folders);
    /// - a path with `/` (or `\`): that file or folder; a folder ends with `/`;
    /// - a bare name: every file and folder with that name, in any folder, else every file
    ///   whose name contains it.
    ///
    /// Case is ignored. A single file follows renames.
    pub fn resolve(&self, query: &str) -> PathQuery {
        let q = normalize(query);
        let none = PathQuery {
            pathspecs: Vec::new(),
            follow: false,
        };
        if q.is_empty() {
            return none;
        }
        let lower = q.to_lowercase();
        if q.contains(['*', '?']) {
            let pattern = lower.trim_end_matches('/');
            let matches: Vec<&String> = self
                .files
                .iter()
                .filter(|f| {
                    let f = f.to_lowercase();
                    if pattern.contains('/') {
                        glob_match(pattern, &f)
                    } else {
                        glob_match(pattern, basename(&f))
                    }
                })
                .collect();
            return if matches.len() > MAX_EXACT_PATHS {
                let pattern = if pattern.contains('/') {
                    pattern.to_owned()
                } else {
                    format!("**/{pattern}")
                };
                PathQuery {
                    pathspecs: vec![format!(":(glob,icase){pattern}")],
                    follow: false,
                }
            } else {
                exact(matches.into_iter().cloned().collect(), Vec::new())
            };
        }
        if q.contains('/') {
            let trimmed = lower.trim_end_matches('/');
            if !q.ends_with('/')
                && let Some(file) = self.files.iter().find(|f| f.to_lowercase() == trimmed)
            {
                return exact(vec![file.clone()], Vec::new());
            }
            if let Some(dir) = self.dirs.iter().find(|d| d.to_lowercase() == trimmed) {
                return exact(Vec::new(), vec![dir.clone()]);
            }
            // Not in history (yet): search it as typed.
            return PathQuery {
                pathspecs: vec![format!(":(literal){}", q.trim_end_matches('/'))],
                follow: false,
            };
        }
        let named = |set: &BTreeSet<String>| -> Vec<String> {
            set.iter()
                .filter(|p| basename(p).to_lowercase() == lower)
                .cloned()
                .collect()
        };
        let (files, dirs) = (named(&self.files), named(&self.dirs));
        if !files.is_empty() || !dirs.is_empty() {
            return exact(files, dirs);
        }
        let containing: Vec<String> = self
            .files
            .iter()
            .filter(|f| basename(f).to_lowercase().contains(&lower))
            .cloned()
            .collect();
        if containing.len() > MAX_EXACT_PATHS {
            return PathQuery {
                pathspecs: vec![format!(":(glob,icase)**/*{}*", glob_escape(&lower))],
                follow: false,
            };
        }
        exact(containing, Vec::new())
    }

    /// Up to `limit` suggestions for what the user is typing, best first: file or folder
    /// name equal to it, then starting with it, then containing it, then the path containing
    /// it. Within a rank: paths in the current tree first, then shorter, then alphabetical.
    pub fn suggest(
        &self,
        query: &str,
        tracked: &HashSet<String>,
        limit: usize,
    ) -> Vec<PathSuggestion> {
        let q = normalize(query).to_lowercase();
        let q = q.trim_end_matches('/');
        if q.is_empty() || q.contains(['*', '?']) {
            return Vec::new();
        }
        let live_dirs: HashSet<&str> = tracked
            .iter()
            .flat_map(|t| t.match_indices('/').map(move |(i, _)| &t[..i]))
            .collect();
        let rank = |path: &str| -> Option<u8> {
            let lower = path.to_lowercase();
            let name = basename(&lower);
            if q.contains('/') {
                return if lower.starts_with(q) {
                    Some(1)
                } else {
                    lower.contains(q).then_some(4)
                };
            }
            if name == q {
                Some(0)
            } else if name.starts_with(q) {
                Some(1)
            } else if name.contains(q) {
                Some(2)
            } else {
                lower.contains(q).then_some(3)
            }
        };
        let mut found: Vec<(u8, bool, PathSuggestion)> = Vec::new();
        for file in &self.files {
            if let Some(r) = rank(file) {
                let deleted = !tracked.contains(file);
                found.push((
                    r,
                    deleted,
                    PathSuggestion {
                        path: file.clone(),
                        kind: PathKind::File,
                        deleted,
                    },
                ));
            }
        }
        for dir in &self.dirs {
            if let Some(r) = rank(dir) {
                let deleted = !live_dirs.contains(dir.as_str());
                found.push((
                    r,
                    deleted,
                    PathSuggestion {
                        path: format!("{dir}/"),
                        kind: PathKind::Dir,
                        deleted,
                    },
                ));
            }
        }
        found.sort_by(|a, b| {
            (a.0, a.1, a.2.path.len(), &a.2.path).cmp(&(b.0, b.1, b.2.path.len(), &b.2.path))
        });
        found.into_iter().take(limit).map(|(_, _, s)| s).collect()
    }
}

/// Exact pathspecs for these files and folders; one file (whose name Git won't read as a
/// pattern) follows renames.
fn exact(files: Vec<String>, dirs: Vec<String>) -> PathQuery {
    let follow = files.len() == 1 && dirs.is_empty() && !files[0].contains(['*', '?', '[', '\\']);
    let pathspecs = if follow {
        // `--follow` takes one plain path.
        files
    } else {
        files
            .into_iter()
            .chain(dirs)
            .map(|p| format!(":(literal){p}"))
            .collect()
    };
    PathQuery { pathspecs, follow }
}

/// `/`-separated, without a leading `./` or `/`.
fn normalize(query: &str) -> String {
    let q = query.trim().replace('\\', "/");
    let q = q.strip_prefix("./").unwrap_or(&q);
    q.trim_start_matches('/').to_owned()
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn glob_escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| {
            if matches!(c, '*' | '?' | '[' | '\\') {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect()
}

/// `*` matches within one folder, `**` across folders, `?` one character.
fn glob_match(pattern: &str, text: &str) -> bool {
    fn go(p: &[char], t: &[char]) -> bool {
        match p.first() {
            None => t.is_empty(),
            Some('*') if p.get(1) == Some(&'*') => {
                let after = &p[2..];
                if after.first() == Some(&'/') {
                    // `**/`: zero or more whole folders ("**/a" matches "a" and "x/y/a").
                    let rest = &after[1..];
                    go(rest, t) || (0..t.len()).any(|i| t[i] == '/' && go(rest, &t[i + 1..]))
                } else {
                    (0..=t.len()).any(|i| go(after, &t[i..]))
                }
            }
            Some('*') => (0..=t.len())
                .take_while(|&i| i == 0 || t[i - 1] != '/')
                .any(|i| go(&p[1..], &t[i..])),
            Some('?') => t.first().is_some_and(|&c| c != '/') && go(&p[1..], &t[1..]),
            Some(&c) => t.first() == Some(&c) && go(&p[1..], &t[1..]),
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    go(&p, &t)
}

impl Git {
    /// Commits the refs and HEAD point at (tags peeled; refs to trees or blobs skipped).
    async fn index_tips(&self, repo: &Path) -> Result<Vec<String>, GitError> {
        let out = self
            .run(
                Some(repo),
                [
                    "for-each-ref",
                    "--format=%(objecttype) %(objectname) %(*objecttype) %(*objectname)",
                    "refs/heads",
                    "refs/remotes",
                    "refs/tags",
                ],
            )
            .await?;
        let mut tips: Vec<String> = lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let f: Vec<&str> = line.split(' ').collect();
                match f.as_slice() {
                    ["commit", oid, ..] => Some((*oid).to_owned()),
                    ["tag", _, "commit", oid] => Some((*oid).to_owned()),
                    _ => None,
                }
            })
            .collect();
        if let Some(head) = self.head_oid(repo).await? {
            tips.push(head);
        }
        tips.sort();
        tips.dedup();
        Ok(tips)
    }

    /// Brings `index` up to date with the repository's refs: the whole history the first
    /// time, then only commits not reachable from the tips walked before. Returns whether
    /// anything was walked.
    pub async fn update_path_index(
        &self,
        repo: &Path,
        index: &mut PathIndex,
    ) -> Result<bool, GitError> {
        let tips = self.index_tips(repo).await?;
        if tips == index.tips {
            return Ok(false);
        }
        if tips.is_empty() {
            *index = PathIndex::default();
            return Ok(true);
        }
        // The tips to walk on stdin (any number of refs, no command-line limit), the old ones
        // negated.
        let mut revs = String::new();
        for t in &tips {
            revs.push_str(t);
            revs.push('\n');
        }
        for t in &index.tips {
            revs.push('^');
            revs.push_str(t);
            revs.push('\n');
        }
        let out = self
            .run_with(
                RunOptions {
                    stdin: Some(revs.as_bytes()),
                    ..RunOptions::in_dir(repo)
                },
                [
                    "log",
                    "--stdin",
                    "--no-renames",
                    "--diff-filter=A",
                    "--name-only",
                    "--format=",
                    "-z",
                ],
            )
            .await?;
        for path in split_nul(&out.stdout).map(lossy) {
            let path = path.trim_start_matches('\n');
            if !path.is_empty() {
                index.add(path);
            }
        }
        index.tips = tips;
        Ok(true)
    }

    /// Paths in the index (the current tree as staged), to mark the rest as deleted.
    pub async fn tracked_paths(&self, repo: &Path) -> Result<HashSet<String>, GitError> {
        let out = self.run(Some(repo), ["ls-files", "-z"]).await?;
        Ok(split_nul(&out.stdout).map(lossy).collect())
    }

    /// Commits (newest first) that changed any of `query`'s pathspecs, following renames for
    /// a single file.
    pub async fn search_paths(
        &self,
        repo: &Path,
        opts: &LogOptions,
        query: &PathQuery,
    ) -> Result<Vec<String>, GitError> {
        if query.pathspecs.is_empty() {
            return Ok(Vec::new());
        }
        let mut args: Vec<String> = vec!["log".into(), "--format=%H".into()];
        if query.follow {
            args.push("--follow".into());
        }
        args.extend(opts.revision_args().into_iter().map(str::to_owned));
        args.push("--".into());
        args.extend(query.pathspecs.iter().cloned());
        let out = self.run(Some(repo), &args).await?;
        Ok(lossy(&out.stdout).lines().map(str::to_owned).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> PathIndex {
        PathIndex::from_paths([
            "Makefile",
            "src/Makefile",
            "src/parser.rs",
            "src/parser_test.rs",
            "src/old/lexer.rs",
            "docs/guide.md",
            "app/build.gradle",
            "build.gradle",
            "t/t0001-init.sh",
        ])
    }

    fn specs(q: &PathQuery) -> Vec<&str> {
        q.pathspecs.iter().map(String::as_str).collect()
    }

    #[test]
    fn a_name_matches_every_file_and_folder_with_it() {
        let q = index().resolve("makefile");
        assert_eq!(specs(&q), [":(literal)Makefile", ":(literal)src/Makefile"]);
        assert!(!q.follow);
        let q = index().resolve("t");
        assert_eq!(specs(&q), [":(literal)t"]);
    }

    #[test]
    fn a_single_file_follows_renames() {
        let q = index().resolve("Parser.rs");
        assert_eq!(specs(&q), ["src/parser.rs"]);
        assert!(q.follow);
        let q = index().resolve(r".\src\PARSER.rs");
        assert_eq!(specs(&q), ["src/parser.rs"]);
        assert!(q.follow);
    }

    #[test]
    fn a_path_is_a_file_or_a_folder() {
        assert_eq!(specs(&index().resolve("src/old")), [":(literal)src/old"]);
        assert_eq!(specs(&index().resolve("src/old/")), [":(literal)src/old"]);
        // Not in history: searched as typed.
        assert_eq!(
            specs(&index().resolve("new/file.txt")),
            [":(literal)new/file.txt"]
        );
    }

    #[test]
    fn part_of_a_name_matches_files_containing_it() {
        let q = index().resolve("parse");
        assert_eq!(
            specs(&q),
            [":(literal)src/parser.rs", ":(literal)src/parser_test.rs"]
        );
        assert!(index().resolve("nothing-like-this").pathspecs.is_empty());
        assert!(index().resolve("   ").pathspecs.is_empty());
    }

    #[test]
    fn wildcards() {
        let q = index().resolve("*.GRADLE");
        assert_eq!(
            specs(&q),
            [":(literal)app/build.gradle", ":(literal)build.gradle"]
        );
        let q = index().resolve("src/**/*.rs");
        assert_eq!(
            specs(&q),
            [
                ":(literal)src/old/lexer.rs",
                ":(literal)src/parser.rs",
                ":(literal)src/parser_test.rs"
            ]
        );
        assert_eq!(specs(&index().resolve("src/*.rs")).len(), 2);
        // One match is one file: it follows renames like a typed path.
        assert_eq!(specs(&index().resolve("t????-*")), ["t/t0001-init.sh"]);
    }

    #[test]
    fn many_matches_fall_back_to_one_glob() {
        let paths: Vec<String> = (0..300).map(|i| format!("gen/f{i}.txt")).collect();
        let index = PathIndex::from_paths(paths.iter().map(String::as_str));
        assert_eq!(specs(&index.resolve("*.txt")), [":(glob,icase)**/*.txt"]);
        assert_eq!(specs(&index.resolve("f")), [":(glob,icase)**/*f*"]);
    }

    #[test]
    fn glob_rules() {
        assert!(glob_match("*.rs", "a.rs"));
        assert!(!glob_match("*.rs", "src/a.rs"));
        assert!(glob_match("**/a.rs", "a.rs"));
        assert!(glob_match("**/a.rs", "x/y/a.rs"));
        assert!(glob_match("src/**", "src/x/y"));
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("a?c", "a/c"));
    }

    #[test]
    fn suggestions_rank_names_before_paths_and_live_before_deleted() {
        let tracked: HashSet<String> = [
            "src/parser.rs",
            "src/parser_test.rs",
            "Makefile",
            "src/Makefile",
        ]
        .map(str::to_owned)
        .into();
        let s = index().suggest("pars", &tracked, 10);
        let paths: Vec<&str> = s.iter().map(|x| x.path.as_str()).collect();
        assert_eq!(paths, ["src/parser.rs", "src/parser_test.rs"]);

        let s = index().suggest("lexer", &tracked, 10);
        assert_eq!(s[0].path, "src/old/lexer.rs");
        assert!(s[0].deleted);

        let s = index().suggest("src", &tracked, 10);
        assert_eq!(
            s[0],
            PathSuggestion {
                path: "src/".into(),
                kind: PathKind::Dir,
                deleted: false,
            }
        );
        let old = s.iter().find(|x| x.path == "src/old/").unwrap();
        assert!(old.deleted, "no tracked file left under it");

        assert_eq!(
            index().suggest("src/p", &tracked, 1)[0].path,
            "src/parser.rs"
        );
        assert!(index().suggest("*.rs", &tracked, 10).is_empty());
        assert_eq!(index().suggest("e", &tracked, 3).len(), 3);
    }
}
