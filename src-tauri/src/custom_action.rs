//! Custom actions (Settings → Actions): programs the user adds to menus and the palette.
//!
//! The arguments are one line of text, split here into a list (spaces separate, `"…"` or
//! `'…'` group) before the variables are substituted into each argument. The program is then
//! started directly, never through a shell, so a value can't add arguments or commands: a
//! file named `a; rm -rf ~` stays one argument.

use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::oneshot;
use ts_rs::TS;

use crate::error::IpcError;

/// Output kept per stream; the rest is dropped (the panel says so).
const MAX_OUTPUT: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ActionScope {
    /// The palette, for the open repository.
    #[default]
    Repository,
    /// Commit menus (and the palette, for the selected commit).
    Commit,
    /// Branch menus (and the palette, for the current branch).
    Branch,
    /// File menus in Changes (and the palette, for the selected file).
    File,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct CustomAction {
    /// Stable id: the palette action is `custom.<id>`, so its shortcut survives renames.
    pub id: String,
    pub name: String,
    /// A program on `PATH` or a full path.
    pub program: String,
    /// One line, split into arguments; see the module docs for quoting and variables.
    pub arguments: String,
    pub scope: ActionScope,
    /// Ask before running (with the command line it will run).
    pub confirm: bool,
    /// Wait for the program and show its output; otherwise it is started and left running.
    pub show_output: bool,
}

/// What the variables stand for where the action was started.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ActionContext {
    pub repo: String,
    pub sha: Option<String>,
    pub branch: Option<String>,
    /// Paths relative to the repository (the program runs there).
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActionRun {
    pub program: String,
    pub args: Vec<String>,
    /// `None` when not waited for, or ended by a signal.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// Some output was dropped (over 1 MB per stream).
    pub truncated: bool,
    pub waited: bool,
}

/// Splits the arguments line: whitespace separates, `"…"` and `'…'` group (quotes can't be
/// escaped; use the other kind). An unterminated quote is an error.
pub fn split_arguments(line: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_arg = false;
    let mut quote = None;
    for c in line.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                in_arg = true;
            }
            None if c.is_whitespace() => {
                if in_arg {
                    args.push(std::mem::take(&mut current));
                    in_arg = false;
                }
            }
            None => {
                current.push(c);
                in_arg = true;
            }
        }
    }
    if let Some(q) = quote {
        return Err(format!("The arguments have an unterminated {q} quote."));
    }
    if in_arg {
        args.push(current);
    }
    Ok(args)
}

/// Substitutes `{repo}`, `{sha}`, `{shortSha}`, `{branch}`, `{file}` and `{files}` in each
/// argument. `{files}` on its own becomes one argument per file; inside a longer argument the
/// files are joined with spaces. Other braces are left alone (`find … {} +` works).
pub fn expand(args: &[String], ctx: &ActionContext) -> Result<Vec<String>, String> {
    let need = |value: &Option<String>, what: &str| {
        value
            .clone()
            .ok_or_else(|| format!("This action uses {what}, which isn't available here."))
    };
    let mut out = Vec::new();
    for arg in args {
        if arg == "{files}" {
            if ctx.files.is_empty() {
                return Err("This action uses {files}, but no files are selected.".to_owned());
            }
            out.extend(ctx.files.iter().cloned());
            continue;
        }
        let mut value = String::new();
        let mut rest = arg.as_str();
        while let Some(start) = rest.find('{') {
            value.push_str(&rest[..start]);
            let after = &rest[start..];
            let Some(end) = after.find('}') else {
                value.push_str(after);
                rest = "";
                break;
            };
            let name = &after[1..end];
            let replacement = match name {
                "repo" => Some(ctx.repo.clone()),
                "sha" => Some(need(&ctx.sha, "{sha}")?),
                "shortSha" => Some(need(&ctx.sha, "{shortSha}")?.chars().take(7).collect()),
                "branch" => Some(need(&ctx.branch, "{branch}")?),
                "file" => Some(ctx.files.first().cloned().ok_or_else(|| {
                    "This action uses {file}, but no file is selected.".to_owned()
                })?),
                "files" => {
                    if ctx.files.is_empty() {
                        return Err(
                            "This action uses {files}, but no files are selected.".to_owned()
                        );
                    }
                    Some(ctx.files.join(" "))
                }
                _ => None,
            };
            match replacement {
                Some(r) => value.push_str(&r),
                None => value.push_str(&after[..=end]),
            }
            rest = &after[end + 1..];
        }
        value.push_str(rest);
        out.push(value);
    }
    Ok(out)
}

/// The program and arguments `action` runs in `ctx`.
pub fn command_line(
    action: &CustomAction,
    ctx: &ActionContext,
) -> Result<(String, Vec<String>), IpcError> {
    let program = action.program.trim();
    if program.is_empty() {
        return Err(IpcError::invalid(format!(
            "“{}” has no program. Set one in Settings → Actions.",
            action.name
        )));
    }
    let args = split_arguments(&action.arguments)
        .and_then(|args| expand(&args, ctx))
        .map_err(IpcError::invalid)?;
    Ok((program.to_owned(), args))
}

/// Runs `action` in the repository. With `show_output` it waits (until `cancel` fires, which
/// kills the program) and returns the output; otherwise it returns once the program started.
pub async fn run(
    action: &CustomAction,
    ctx: &ActionContext,
    cancel: oneshot::Receiver<()>,
) -> Result<ActionRun, IpcError> {
    let (program, args) = command_line(action, ctx)?;
    let dir = Path::new(&ctx.repo);
    if !dir.is_dir() {
        return Err(IpcError::invalid(format!("{} doesn't exist.", ctx.repo)));
    }
    let mut cmd = Command::new(&program);
    cmd.args(&args).current_dir(dir).stdin(Stdio::null());
    let not_found = |err: std::io::Error| -> IpcError {
        if err.kind() == std::io::ErrorKind::NotFound {
            IpcError::invalid(format!(
                "{program} wasn't found. Check the program in Settings → Actions."
            ))
        } else {
            err.into()
        }
    };
    let mut result = ActionRun {
        program: program.clone(),
        args: args.clone(),
        code: None,
        stdout: String::new(),
        stderr: String::new(),
        truncated: false,
        waited: action.show_output,
    };
    if !action.show_output {
        let mut child = cmd
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(not_found)?;
        // Reaped in the background, so it never lingers as a zombie.
        tokio::spawn(async move {
            let _ = child.wait().await;
        });
        return Ok(result);
    }

    #[cfg(windows)]
    {
        // Console programs get no window of their own; their output comes here.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(not_found)?;
    let mut stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let read = async {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (o, e) = tokio::join!(
            read_capped(&mut stdout, &mut out),
            read_capped(&mut stderr, &mut err)
        );
        let (o, e) = (o?, e?);
        Ok::<_, std::io::Error>((out, err, o || e))
    };
    tokio::select! {
        read = read => {
            let (out, err, truncated) = read?;
            let status = child.wait().await?;
            result.code = status.code();
            result.stdout = String::from_utf8_lossy(&out).into_owned();
            result.stderr = String::from_utf8_lossy(&err).into_owned();
            result.truncated = truncated;
            Ok(result)
        }
        _ = cancel => {
            let _ = child.kill().await;
            Err(IpcError {
                kind: crate::error::IpcErrorKind::Cancelled,
                ..IpcError::invalid(format!("{} was stopped.", action.name))
            })
        }
    }
}

/// Reads all of `stream`, keeping the first [`MAX_OUTPUT`] bytes; true if some were dropped.
async fn read_capped(
    stream: &mut (impl AsyncReadExt + Unpin),
    into: &mut Vec<u8>,
) -> std::io::Result<bool> {
    let mut buf = [0u8; 8192];
    let mut dropped = false;
    loop {
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            return Ok(dropped);
        }
        let room = MAX_OUTPUT.saturating_sub(into.len());
        into.extend_from_slice(&buf[..n.min(room)]);
        dropped |= n > room;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> ActionContext {
        ActionContext {
            repo: "/home/ada/tylia".into(),
            sha: Some("66c71f7a1b2c3d4e5f60718293a4b5c6d7e8f901".into()),
            branch: Some("feature/graph".into()),
            files: vec!["src/a b.rs".into(), "; rm -rf ~".into()],
        }
    }

    fn line(s: &str) -> Vec<String> {
        expand(&split_arguments(s).unwrap(), &ctx()).unwrap()
    }

    #[test]
    fn splitting_follows_spaces_and_quotes() {
        assert_eq!(
            split_arguments(r#"log  --format="%h %s" 'it''s' -n 5"#).unwrap(),
            ["log", "--format=%h %s", "its", "-n", "5"]
        );
        assert_eq!(split_arguments(r#"a "" b"#).unwrap(), ["a", "", "b"]);
        assert!(split_arguments("   ").unwrap().is_empty());
        assert!(split_arguments(r#"say "hi"#).is_err());
    }

    #[test]
    fn variables_fill_in_without_ever_adding_arguments() {
        assert_eq!(
            line("show {shortSha} --stat {branch}"),
            ["show", "66c71f7", "--stat", "feature/graph"]
        );
        assert_eq!(line("--repo={repo}"), ["--repo=/home/ada/tylia"]);
        // A file name with a shell command in it stays one argument.
        assert_eq!(
            line("diff -- {files}"),
            ["diff", "--", "src/a b.rs", "; rm -rf ~"]
        );
        assert_eq!(line("open {file}"), ["open", "src/a b.rs"]);
        assert_eq!(line("echo x{files}y"), ["echo", "xsrc/a b.rs ; rm -rf ~y"]);
        // Unknown braces stay as they are.
        assert_eq!(
            line("find . -exec ls {} +"),
            ["find", ".", "-exec", "ls", "{}", "+"]
        );
        assert_eq!(line("{unknown} {sha"), ["{unknown}", "{sha"]);
    }

    #[test]
    fn runs_the_program_in_the_repository_and_reports_a_missing_one() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ActionContext {
            repo: dir.path().display().to_string(),
            ..ActionContext::default()
        };
        let action = |program: &str, arguments: &str| CustomAction {
            name: "Test".into(),
            program: program.into(),
            arguments: arguments.into(),
            show_output: true,
            ..CustomAction::default()
        };
        tauri::async_runtime::block_on(async {
            // git prints its version, and `git rev-parse` fails outside a repository: both
            // outputs and the exit code come back.
            let (_tx, rx) = oneshot::channel();
            let ran = super::run(&action("git", "--version"), &ctx, rx)
                .await
                .unwrap();
            assert_eq!(ran.code, Some(0));
            assert!(ran.stdout.starts_with("git version"), "{ran:?}");
            let (_tx, rx) = oneshot::channel();
            let ran = super::run(&action("git", "rev-parse --git-dir"), &ctx, rx)
                .await
                .unwrap();
            assert_ne!(ran.code, Some(0));
            assert!(ran.stderr.contains("not a git repository"), "{ran:?}");

            let (_tx, rx) = oneshot::channel();
            let missing = super::run(&action("tylia-no-such-program", ""), &ctx, rx).await;
            assert!(
                matches!(&missing, Err(e) if e.message.contains("wasn't found")),
                "{missing:?}"
            );
        });
    }

    #[test]
    fn missing_values_are_reported() {
        let empty = ActionContext {
            repo: "/r".into(),
            ..ActionContext::default()
        };
        for args in [
            "show {sha}",
            "co {branch}",
            "open {file}",
            "add {files}",
            "x{files}",
        ] {
            assert!(
                expand(&split_arguments(args).unwrap(), &empty).is_err(),
                "{args}"
            );
        }
        let action = CustomAction {
            name: "Nothing".into(),
            ..CustomAction::default()
        };
        assert!(command_line(&action, &empty).is_err());
    }
}
