//! Branches, remotes, tags, stashes and submodules: everything the sidebar lists.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::GitError;
use crate::runner::{Git, RunOptions, lossy, split_nul};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Head {
    /// Checked-out branch (short name); `None` when detached.
    pub branch: Option<String>,
    /// `None` on an unborn branch (no commits yet).
    pub oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Branch {
    /// Short name, e.g. `feature/graph`.
    pub name: String,
    pub oid: String,
    /// Upstream short name, e.g. `origin/feature/graph`.
    pub upstream: Option<String>,
    /// The upstream's remote (`origin`; `.` for a local upstream) and its branch name there
    /// (`feature/graph`), for pull and push.
    pub upstream_remote: Option<String>,
    pub upstream_branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// The upstream is configured but no longer exists.
    pub upstream_gone: bool,
    pub is_head: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteBranch {
    /// Name within the remote, e.g. `main`.
    pub name: String,
    /// `origin/main`.
    pub full_name: String,
    pub oid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Remote {
    pub name: String,
    /// Fetch URL.
    pub url: Option<String>,
    /// Push URL, when set separately from the fetch URL.
    pub push_url: Option<String>,
    pub branches: Vec<RemoteBranch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Tag {
    pub name: String,
    /// The commit the tag points at (peeled for annotated tags).
    pub oid: String,
    pub annotated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Stash {
    /// `stash@{0}`.
    pub name: String,
    pub oid: String,
    #[ts(type = "number")]
    pub time: i64,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SubmoduleState {
    UpToDate,
    NotInitialized,
    /// Checked-out commit differs from the one recorded in the superproject.
    Modified,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Submodule {
    pub path: String,
    pub oid: String,
    pub state: SubmoduleState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RefsSnapshot {
    pub head: Head,
    pub branches: Vec<Branch>,
    pub remotes: Vec<Remote>,
    pub tags: Vec<Tag>,
    pub stashes: Vec<Stash>,
}

const REF_FORMAT: &str = "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(symref)%00%(upstream:remotename)%00%(upstream:remoteref)";

impl Git {
    pub async fn refs(&self, repo: &Path) -> Result<RefsSnapshot, GitError> {
        let opts = RunOptions {
            c_locale: true,
            ..RunOptions::in_dir(repo)
        };
        let (refs, head_branch, head_oid, remotes, stashes) = tokio::join!(
            self.run_with(
                opts,
                [
                    "for-each-ref",
                    REF_FORMAT,
                    "refs/heads",
                    "refs/remotes",
                    "refs/tags"
                ]
            ),
            self.run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..opts
                },
                ["symbolic-ref", "-q", "--short", "HEAD"]
            ),
            self.run_with(
                RunOptions {
                    ok_codes: &[1],
                    ..opts
                },
                ["rev-parse", "-q", "--verify", "HEAD^{commit}"]
            ),
            self.run_with(opts, ["remote", "-v"]),
            self.run_with(
                opts,
                ["stash", "list", "-z", "--format=%gd%x1f%H%x1f%at%x1f%s"]
            ),
        );
        let mut snapshot = parse_refs(&refs?.stdout);
        let branch = lossy(&head_branch?.stdout).trim().to_owned();
        let oid = lossy(&head_oid?.stdout).trim().to_owned();
        snapshot.head = Head {
            branch: (!branch.is_empty()).then_some(branch),
            oid: (!oid.is_empty()).then_some(oid),
        };
        apply_remote_urls(&mut snapshot.remotes, &lossy(&remotes?.stdout));
        snapshot.stashes = parse_stashes(&stashes?.stdout);
        Ok(snapshot)
    }

    /// Submodules and their state. Separate from [`Git::refs`] because `git submodule
    /// status` inspects every submodule's working tree and can take most of a second.
    pub async fn submodules(&self, repo: &Path) -> Result<Vec<Submodule>, GitError> {
        if !repo.join(".gitmodules").is_file() {
            return Ok(Vec::new());
        }
        let out = self
            .run_with(
                RunOptions {
                    c_locale: true,
                    ..RunOptions::in_dir(repo)
                },
                ["submodule", "status"],
            )
            .await?;
        Ok(parse_submodules(&lossy(&out.stdout)))
    }
}

fn parse_track(track: &str) -> (u32, u32, bool) {
    if track == "gone" {
        return (0, 0, true);
    }
    let (mut ahead, mut behind) = (0, 0);
    for part in track.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind, false)
}

/// Parses `for-each-ref` with [`REF_FORMAT`] (remote URLs, stashes and HEAD are filled in
/// separately).
pub fn parse_refs(out: &[u8]) -> RefsSnapshot {
    let mut snapshot = RefsSnapshot::default();
    let mut remotes: BTreeMap<String, Remote> = BTreeMap::new();
    for line in lossy(out).lines() {
        let f: Vec<&str> = line.split('\0').collect();
        let [
            refname,
            oid,
            peeled,
            upstream,
            track,
            head,
            symref,
            upstream_remote,
            upstream_ref,
        ] = f[..]
        else {
            continue;
        };
        if !symref.is_empty() {
            // `refs/remotes/origin/HEAD` and other symbolic refs.
            continue;
        }
        if let Some(name) = refname.strip_prefix("refs/heads/") {
            let (ahead, behind, upstream_gone) = parse_track(track);
            snapshot.branches.push(Branch {
                name: name.to_owned(),
                oid: oid.to_owned(),
                upstream: (!upstream.is_empty()).then(|| upstream.to_owned()),
                upstream_remote: (!upstream_remote.is_empty()).then(|| upstream_remote.to_owned()),
                upstream_branch: upstream_ref.strip_prefix("refs/heads/").map(str::to_owned),
                ahead,
                behind,
                upstream_gone,
                is_head: head == "*",
            });
        } else if let Some(full) = refname.strip_prefix("refs/remotes/") {
            let Some((remote, name)) = full.split_once('/') else {
                continue;
            };
            remotes
                .entry(remote.to_owned())
                .or_insert_with(|| Remote {
                    name: remote.to_owned(),
                    url: None,
                    push_url: None,
                    branches: Vec::new(),
                })
                .branches
                .push(RemoteBranch {
                    name: name.to_owned(),
                    full_name: full.to_owned(),
                    oid: oid.to_owned(),
                });
        } else if let Some(name) = refname.strip_prefix("refs/tags/") {
            snapshot.tags.push(Tag {
                name: name.to_owned(),
                oid: if peeled.is_empty() { oid } else { peeled }.to_owned(),
                annotated: !peeled.is_empty(),
            });
        }
    }
    snapshot.remotes = remotes.into_values().collect();
    snapshot
}

/// Adds URLs from `git remote -v` ("name<TAB>url (fetch|push)"), including remotes without
/// any fetched branches.
fn apply_remote_urls(remotes: &mut Vec<Remote>, out: &str) {
    for line in out.lines() {
        let Some((name, rest)) = line.split_once('\t') else {
            continue;
        };
        let Some((url, kind)) = rest.rsplit_once(' ') else {
            continue;
        };
        let i = match remotes.iter().position(|r| r.name == name) {
            Some(i) => i,
            None => {
                remotes.push(Remote {
                    name: name.to_owned(),
                    url: None,
                    push_url: None,
                    branches: Vec::new(),
                });
                remotes.len() - 1
            }
        };
        let remote = &mut remotes[i];
        match kind {
            "(fetch)" => remote.url = Some(url.to_owned()),
            "(push)" => remote.push_url = Some(url.to_owned()),
            _ => {}
        }
    }
    for remote in remotes.iter_mut() {
        if remote.push_url == remote.url {
            remote.push_url = None;
        }
    }
    remotes.sort_by(|a, b| a.name.cmp(&b.name));
}

fn parse_stashes(out: &[u8]) -> Vec<Stash> {
    split_nul(out)
        .filter_map(|rec| {
            let rec = lossy(rec);
            let mut f = rec.splitn(4, '\x1f');
            Some(Stash {
                name: f.next()?.to_owned(),
                oid: f.next()?.to_owned(),
                time: f.next()?.parse().ok()?,
                message: f.next()?.to_owned(),
            })
        })
        .collect()
}

/// Parses `git submodule status`: `<state><oid> <path>[ (<describe>)]`.
fn parse_submodules(out: &str) -> Vec<Submodule> {
    out.lines()
        .filter_map(|line| {
            let state = match line.chars().next()? {
                '-' => SubmoduleState::NotInitialized,
                '+' => SubmoduleState::Modified,
                'U' => SubmoduleState::Conflicted,
                _ => SubmoduleState::UpToDate,
            };
            let mut parts = line[1..].splitn(2, ' ');
            let oid = parts.next()?.to_owned();
            let rest = parts.next()?;
            let path = match rest.rfind(" (") {
                Some(i) if rest.ends_with(')') => &rest[..i],
                _ => rest,
            };
            Some(Submodule {
                path: path.to_owned(),
                oid,
                state,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_for_each_ref() {
        let out = "refs/heads/main\0aaa\0\0origin/main\0ahead 2, behind 1\0*\0\0origin\0refs/heads/main\n\
refs/heads/feature/x\0bbb\0\0origin/feature/x\0gone\0 \0\0origin\0refs/heads/feature/x\n\
refs/heads/local\0ccc\0\0\0\0 \0\0\0\n\
refs/remotes/origin/HEAD\0aaa\0\0\0\0 \0refs/remotes/origin/main\0\0\n\
refs/remotes/origin/main\0aaa\0\0\0\0 \0\0\0\n\
refs/remotes/upstream/feature/y\0ddd\0\0\0\0 \0\0\0\n\
refs/tags/v1.0\0t01\0eee\0\0\0 \0\0\0\n\
refs/tags/light\0fff\0\0\0\0 \0\0\0\n";
        let s = parse_refs(out.as_bytes());
        assert_eq!(s.branches.len(), 3);
        let main = &s.branches[0];
        assert!(main.is_head);
        assert_eq!((main.ahead, main.behind), (2, 1));
        assert_eq!(main.upstream_remote.as_deref(), Some("origin"));
        assert_eq!(main.upstream_branch.as_deref(), Some("main"));
        assert!(s.branches[1].upstream_gone);
        assert_eq!(s.branches[2].upstream, None);
        assert_eq!(s.remotes.len(), 2);
        assert_eq!(s.remotes[0].name, "origin");
        assert_eq!(s.remotes[0].branches.len(), 1, "origin/HEAD skipped");
        assert_eq!(s.remotes[1].branches[0].name, "feature/y");
        assert_eq!(s.remotes[1].branches[0].full_name, "upstream/feature/y");
        assert_eq!(s.tags[0].oid, "eee", "annotated tag is peeled");
        assert!(s.tags[0].annotated);
        assert!(!s.tags[1].annotated);
    }

    #[test]
    fn remote_urls_include_empty_remotes() {
        let mut remotes = vec![];
        apply_remote_urls(
            &mut remotes,
            "origin\thttps://example.com/a.git (fetch)\norigin\thttps://example.com/a.git (push)\n",
        );
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].url.as_deref(), Some("https://example.com/a.git"));
        assert_eq!(remotes[0].push_url, None, "same as the fetch URL");

        let mut remotes = vec![];
        apply_remote_urls(
            &mut remotes,
            "local\tC:/My Repos/a (fetch)\nlocal\tgit@example.com:a.git (push)\n",
        );
        assert_eq!(remotes[0].url.as_deref(), Some("C:/My Repos/a"));
        assert_eq!(
            remotes[0].push_url.as_deref(),
            Some("git@example.com:a.git")
        );
    }

    #[test]
    fn parses_stashes_and_submodules() {
        let s = parse_stashes(b"stash@{0}\x1faaa\x1f1700000000\x1fWIP on main: fix\0");
        assert_eq!(s[0].name, "stash@{0}");
        assert_eq!(s[0].message, "WIP on main: fix");
        let m = parse_submodules(
            " abc vendor/lib (v1.2-3-gabc)\n-def tools/x\n+123 a path (heads/main)\n",
        );
        assert_eq!(m[0].path, "vendor/lib");
        assert_eq!(m[0].state, SubmoduleState::UpToDate);
        assert_eq!(m[1].state, SubmoduleState::NotInitialized);
        assert_eq!(m[2].path, "a path");
        assert_eq!(m[2].state, SubmoduleState::Modified);
    }
}
