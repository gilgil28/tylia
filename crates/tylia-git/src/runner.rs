use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use ts_rs::TS;

use crate::clone::{Progress, parse_progress};
use crate::error::GitError;

/// Options passed to every invocation so output is stable regardless of user config.
const BASE_ARGS: &[&str] = &[
    "-c",
    "core.quotepath=off",
    "-c",
    "color.ui=false",
    "-c",
    "log.showSignature=false",
];

#[cfg(windows)]
const GIT_EXE: &str = "git.exe";
#[cfg(not(windows))]
const GIT_EXE: &str = "git";

/// Install locations checked when `git` is not on `PATH` (GUI apps on macOS, for example,
/// do not inherit the login shell's `PATH`).
fn fallback_locations() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(var) {
                paths.push(Path::new(&dir).join(r"Git\cmd\git.exe"));
            }
        }
        if let Some(dir) = std::env::var_os("LOCALAPPDATA") {
            paths.push(Path::new(&dir).join(r"Programs\Git\cmd\git.exe"));
        }
    } else {
        for p in [
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
            "/bin/git",
        ] {
            paths.push(PathBuf::from(p));
        }
    }
    paths
}

/// Per-invocation options.
#[derive(Debug, Clone, Copy, Default)]
pub struct RunOptions<'a> {
    pub cwd: Option<&'a Path>,
    /// `LC_ALL=C`: for commands whose output or messages are parsed.
    pub c_locale: bool,
    /// `GIT_OPTIONAL_LOCKS=0`: for status and other background reads.
    pub no_optional_locks: bool,
    /// Exit codes other than 0 that mean success (e.g. 1 for `diff --no-index`).
    pub ok_codes: &'a [i32],
    /// Written to Git's stdin (e.g. a patch for `apply -`, a message for `commit -F -`).
    pub stdin: Option<&'a [u8]>,
    /// Extra environment variables (e.g. the credential prompt bridge).
    pub env: &'a [(String, String)],
}

impl<'a> RunOptions<'a> {
    pub fn in_dir(cwd: &'a Path) -> Self {
        Self {
            cwd: Some(cwd),
            ..Self::default()
        }
    }
}

/// Captured output of a successful Git invocation.
#[derive(Debug, Clone)]
pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub code: Option<i32>,
}

/// Handle to a Git executable. Cheap to clone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Git {
    path: PathBuf,
}

impl Git {
    /// Uses the given executable without checking it.
    pub fn with_path(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Finds `git` on `PATH`, then in common install locations.
    pub fn discover() -> Result<Self, GitError> {
        let on_path = std::env::var_os("PATH")
            .into_iter()
            .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
            .map(|dir| dir.join(GIT_EXE));
        on_path
            .chain(fallback_locations())
            .find(|p| p.is_file())
            .map(Self::with_path)
            .ok_or(GitError::NotFound)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Builds a command with the base options and environment applied. `args` are the
    /// caller's arguments; pathspecs must already be separated with `--`.
    fn command<I, S>(&self, opts: &RunOptions, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut cmd = Command::new(&self.path);
        cmd.args(BASE_ARGS)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(if opts.stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(dir) = opts.cwd {
            cmd.current_dir(dir);
        }
        if opts.c_locale {
            cmd.env("LC_ALL", "C");
        }
        if opts.no_optional_locks {
            cmd.env("GIT_OPTIONAL_LOCKS", "0");
        }
        cmd.envs(opts.env.iter().map(|(k, v)| (k, v)));
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }

    /// Runs Git in `cwd` to completion; see [`Git::run_with`].
    pub async fn run<I, S>(&self, cwd: Option<&Path>, args: I) -> Result<GitOutput, GitError>
    where
        I: IntoIterator<Item = S> + Clone,
        S: AsRef<OsStr>,
    {
        self.run_with(
            RunOptions {
                cwd,
                ..RunOptions::default()
            },
            args,
        )
        .await
    }

    /// Runs Git to completion and returns its output, or [`GitError::Failed`] with stderr
    /// when it exits with a code not in `opts.ok_codes`.
    pub async fn run_with<I, S>(&self, opts: RunOptions<'_>, args: I) -> Result<GitOutput, GitError>
    where
        I: IntoIterator<Item = S> + Clone,
        S: AsRef<OsStr>,
    {
        let display = display_command(args.clone());
        let mut child = self
            .command(&opts, args)
            .spawn()
            .map_err(|source| self.spawn_error(&display, source))?;
        if let (Some(input), Some(mut stdin)) = (opts.stdin, child.stdin.take()) {
            use tokio::io::AsyncWriteExt;
            // Write concurrently with reading output, so large inputs can't deadlock.
            let input = input.to_vec();
            tokio::spawn(async move {
                let _ = stdin.write_all(&input).await;
            });
        }
        let output = child
            .wait_with_output()
            .await
            .map_err(|source| self.spawn_error(&display, source))?;
        let code = output.status.code();
        if output.status.success() || code.is_some_and(|c| opts.ok_codes.contains(&c)) {
            Ok(GitOutput {
                stdout: output.stdout,
                stderr: output.stderr,
                code,
            })
        } else {
            Err(GitError::Failed {
                command: display,
                code,
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            })
        }
    }

    /// Starts Git with piped stdout/stderr for streaming. The child is killed when dropped.
    pub fn spawn<I, S>(&self, opts: RunOptions<'_>, args: I) -> Result<(Child, String), GitError>
    where
        I: IntoIterator<Item = S> + Clone,
        S: AsRef<OsStr>,
    {
        let display = display_command(args.clone());
        let child = self
            .command(&opts, args)
            .spawn()
            .map_err(|source| self.spawn_error(&display, source))?;
        Ok((child, display))
    }

    /// Runs a long network operation (clone, fetch, pull, push): progress lines on stderr
    /// go to `ctx.on_progress`, and cancelling kills Git together with the processes it
    /// started (remote helpers, ssh). Returns stdout and the tail of stderr.
    pub async fn run_operation<I, S>(
        &self,
        opts: RunOptions<'_>,
        args: I,
        ctx: OpContext<'_>,
    ) -> Result<GitOutput, GitError>
    where
        I: IntoIterator<Item = S> + Clone,
        S: AsRef<OsStr>,
    {
        let OpContext {
            mut cancel,
            env,
            on_progress,
        } = ctx;
        let display = display_command(args.clone());
        let opts = RunOptions {
            c_locale: true,
            env,
            ..opts
        };
        let mut cmd = self.command(&opts, args);
        // Its own process group, so a cancel can stop the whole tree.
        #[cfg(unix)]
        cmd.process_group(0);
        let mut child = cmd
            .spawn()
            .map_err(|source| self.spawn_error(&display, source))?;
        let mut stderr = child.stderr.take().expect("stderr is piped");
        let mut stdout = child.stdout.take().expect("stdout is piped");

        let mut out = Vec::new();
        let mut tail = Vec::new();
        let mut line = Vec::new();
        let mut buf = [0u8; 4096];
        let mut out_buf = [0u8; 4096];
        let (mut err_open, mut out_open) = (true, true);
        let mut cancelled = false;
        while err_open || out_open {
            tokio::select! {
                read = stderr.read(&mut buf), if err_open => {
                    let n = read?;
                    if n == 0 {
                        err_open = false;
                        tail.extend_from_slice(&line);
                        continue;
                    }
                    for &b in &buf[..n] {
                        if b == b'\r' || b == b'\n' {
                            if let Some(p) = parse_progress(&lossy(&line)) {
                                on_progress(p);
                            } else if !line.is_empty() {
                                // Progress lines are noise in an error report; keep the rest.
                                tail.extend_from_slice(&line);
                                tail.push(b'\n');
                            }
                            line.clear();
                        } else {
                            line.push(b);
                        }
                    }
                    if tail.len() > STDERR_TAIL {
                        tail.drain(..tail.len() - STDERR_TAIL);
                    }
                }
                read = stdout.read(&mut out_buf), if out_open => {
                    let n = read?;
                    if n == 0 {
                        out_open = false;
                    } else {
                        out.extend_from_slice(&out_buf[..n]);
                    }
                }
                _ = &mut cancel => {
                    cancelled = true;
                    break;
                }
            }
        }
        if cancelled {
            kill_tree(&mut child).await;
            return Err(GitError::Cancelled { command: display });
        }
        let status = child.wait().await?;
        let code = status.code();
        if status.success() {
            Ok(GitOutput {
                stdout: out,
                stderr: tail,
                code,
            })
        } else {
            // Some of the story is on stdout (pull's CONFLICT lines, push's per-ref status).
            let mut report = out;
            if report.len() > STDERR_TAIL {
                report.drain(..report.len() - STDERR_TAIL);
            }
            report.extend_from_slice(&tail);
            let stderr = lossy(&report);
            Err(match access_failure(&stderr) {
                Some(reason) => GitError::AccessDenied {
                    command: display,
                    reason,
                    stderr,
                },
                None => GitError::Failed {
                    command: display,
                    code,
                    stderr,
                },
            })
        }
    }

    fn spawn_error(&self, display: &str, source: std::io::Error) -> GitError {
        GitError::Spawn {
            command: display.to_owned(),
            path: self.path.clone(),
            source,
        }
    }
}

/// Why a remote refused access, from Git's / ssh's (C-locale) messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AccessFailure {
    /// Wrong or missing credentials (or no permission for this repository).
    Auth,
    /// ssh couldn't verify the server: unknown host not trusted, or its key changed.
    HostKey,
}

fn access_failure(output: &str) -> Option<AccessFailure> {
    let text = output.to_ascii_lowercase();
    let any = |needles: &[&str]| needles.iter().any(|n| text.contains(n));
    if any(&[
        "host key verification failed",
        "remote host identification has changed",
    ]) {
        Some(AccessFailure::HostKey)
    } else if any(&[
        "authentication failed",
        "could not read username",
        "could not read password",
        "permission denied (publickey",
        "invalid username or password",
        "the requested url returned error: 401",
        "the requested url returned error: 403",
    ]) {
        Some(AccessFailure::Auth)
    } else {
        None
    }
}

/// Keep this much of a network operation's stderr for error reports.
const STDERR_TAIL: usize = 16 * 1024;

/// The caller's side of a long network operation.
pub struct OpContext<'a> {
    /// Firing it, or dropping the sender, cancels the operation.
    pub cancel: oneshot::Receiver<()>,
    /// Extra environment, e.g. the credential prompt bridge.
    pub env: &'a [(String, String)],
    pub on_progress: &'a mut (dyn FnMut(Progress) + Send),
}

impl<'a> OpContext<'a> {
    pub fn new(
        cancel: oneshot::Receiver<()>,
        on_progress: &'a mut (dyn FnMut(Progress) + Send),
    ) -> Self {
        Self {
            cancel,
            env: &[],
            on_progress,
        }
    }

    pub fn with_env(self, env: &'a [(String, String)]) -> Self {
        Self { env, ..self }
    }
}

/// Kills Git and everything it started: remote helpers and ssh would otherwise keep
/// running (and keep a credential prompt open) after Git itself is gone.
async fn kill_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)]
        {
            // Before killing Git: `/T` finds the children through their parent.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .await;
        }
        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-KILL", "--", &format!("-{pid}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }
    }
    let _ = child.kill().await;
}

/// The command line as shown to users: `git` plus the caller's arguments (base options
/// omitted), with arguments containing whitespace quoted.
pub(crate) fn display_command<I, S>(args: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut out = String::from("git");
    for arg in args {
        let arg = arg.as_ref().to_string_lossy();
        out.push(' ');
        if arg.is_empty() || arg.contains(char::is_whitespace) {
            out.push('"');
            out.push_str(&arg.replace('"', "\\\""));
            out.push('"');
        } else {
            out.push_str(&arg);
        }
    }
    out
}

/// Splits NUL-terminated records (`-z` output), dropping a trailing empty record.
pub(crate) fn split_nul(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    let trimmed = bytes.strip_suffix(b"\0").unwrap_or(bytes);
    trimmed
        .split(|&b| b == 0)
        .filter(move |_| !trimmed.is_empty())
}

pub(crate) fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_command_quotes_whitespace() {
        assert_eq!(
            display_command(["commit", "-m", "fix the \"parser\""]),
            r#"git commit -m "fix the \"parser\"""#
        );
        assert_eq!(display_command(["log", ""]), r#"git log """#);
    }

    #[test]
    fn classifies_access_failures() {
        let auth = [
            "remote: Invalid username or password.
fatal: Authentication failed for 'https://github.com/a/b.git/'",
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            "git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.",
            "fatal: unable to access 'https://example.com/a.git/': The requested URL returned error: 403",
        ];
        for text in auth {
            assert_eq!(access_failure(text), Some(AccessFailure::Auth), "{text}");
        }
        assert_eq!(
            access_failure(
                "Host key verification failed.
fatal: Could not read from remote repository."
            ),
            Some(AccessFailure::HostKey)
        );
        assert_eq!(
            access_failure("fatal: unable to access 'x': Could not resolve host: github.com"),
            None
        );
    }

    #[test]
    fn split_nul_records() {
        assert_eq!(split_nul(b"a\0b\0").collect::<Vec<_>>(), [b"a", b"b"]);
        assert_eq!(
            split_nul(b"a\0\0b").collect::<Vec<_>>(),
            [&b"a"[..], b"", b"b"]
        );
        assert_eq!(split_nul(b"").count(), 0);
    }
}
