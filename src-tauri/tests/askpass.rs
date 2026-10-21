//! The askpass bridge end to end: real Git starts the real `tylia` binary as its askpass
//! helper. `git credential fill` with no credential helper asks for a username and a
//! password through GIT_ASKPASS without any network access.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::mpsc::Receiver;
use std::thread;
use std::time::Duration;

use tylia_lib::askpass::testing::{ChannelSink, SinkEvent};
use tylia_lib::askpass::{Askpass, AskpassKind, AskpassPrompt};

fn start() -> (Askpass, Receiver<SinkEvent>) {
    start_with(Path::new(env!("CARGO_BIN_EXE_tylia")))
}

fn start_with(helper: &Path) -> (Askpass, Receiver<SinkEvent>) {
    let (sink, rx) = ChannelSink::new();
    (Askpass::start_with_helper(sink, helper).unwrap(), rx)
}

/// Runs `git credential fill` for https://example.com with `env`, isolated from the user's
/// configuration (no credential helper, no Git Credential Manager).
fn credential_fill(env: Vec<(String, String)>) -> Output {
    let home = tempfile::tempdir().unwrap();
    let global = home.path().join("gitconfig");
    std::fs::write(&global, "").unwrap();
    let mut child = Command::new("git")
        .args(["-c", "credential.helper=", "credential", "fill"])
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", &global)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("git runs");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"protocol=https\nhost=example.com\n\n")
        .unwrap();
    child.wait_with_output().unwrap()
}

fn next_prompt(rx: &Receiver<SinkEvent>) -> AskpassPrompt {
    match rx.recv_timeout(Duration::from_secs(20)).expect("a prompt") {
        SinkEvent::Shown(p) => p,
        SinkEvent::Closed(id) => panic!("prompt {id} closed unexpectedly"),
    }
}

#[test]
fn git_asks_through_tylia() {
    let (askpass, rx) = start();
    fill_username_and_password(&askpass, &rx);
}

/// Release builds on Windows use the GUI subsystem (no console). The helper must still
/// write its answer to the pipe Git gave it as stdout. The debug binary is a console
/// program; a copy with the PE header's subsystem switched to GUI is what
/// `windows_subsystem = "windows"` produces (Rust keeps the same entry point).
#[cfg(windows)]
#[test]
fn gui_subsystem_helper_answers_git() {
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("tylia-gui.exe");
    let mut bytes = std::fs::read(env!("CARGO_BIN_EXE_tylia")).unwrap();
    let pe = u32::from_le_bytes(bytes[0x3C..0x40].try_into().unwrap()) as usize;
    assert_eq!(&bytes[pe..pe + 4], b"PE\0\0");
    // Signature (4) + COFF header (20) + offset of Subsystem in the optional header (68).
    let subsystem = pe + 4 + 20 + 68;
    const CONSOLE: u16 = 3;
    const GUI: u16 = 2;
    assert_eq!(
        u16::from_le_bytes([bytes[subsystem], bytes[subsystem + 1]]),
        CONSOLE
    );
    bytes[subsystem..subsystem + 2].copy_from_slice(&GUI.to_le_bytes());
    std::fs::write(&exe, bytes).unwrap();

    let (askpass, rx) = start_with(&exe);
    fill_username_and_password(&askpass, &rx);
}

fn fill_username_and_password(askpass: &Askpass, rx: &Receiver<SinkEvent>) {
    let env = askpass.env(11, Some("/work/demo"));
    let git = thread::spawn(move || credential_fill(env));

    let user = next_prompt(rx);
    assert_eq!(user.kind, AskpassKind::Username);
    assert_eq!(user.host.as_deref(), Some("example.com"));
    assert_eq!(user.repo.as_deref(), Some("/work/demo"));
    assert_eq!(user.operation_id, 11);
    askpass.respond(user.id, Some("ada".into()));

    let pass = next_prompt(rx);
    assert_eq!(pass.kind, AskpassKind::Password);
    assert_eq!(pass.host.as_deref(), Some("example.com"));
    assert_eq!(pass.detail.as_deref(), Some("ada"));
    assert!(pass.secret);
    askpass.respond(pass.id, Some("tok3n with spaces".into()));

    let out = git.join().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(stdout.contains("username=ada\n"), "{stdout}");
    assert!(stdout.contains("password=tok3n with spaces\n"), "{stdout}");
    askpass.end_operation(11);
}

#[test]
fn cancelling_makes_git_fail() {
    let (askpass, rx) = start();
    let env = askpass.env(12, None);
    let git = thread::spawn(move || credential_fill(env));
    let user = next_prompt(&rx);
    askpass.respond(user.id, None);
    let out = git.join().unwrap();
    assert!(!out.status.success());
    assert!(!String::from_utf8_lossy(&out.stdout).contains("password="));
}

#[test]
fn ending_the_operation_cancels_its_prompt() {
    let (askpass, rx) = start();
    let env = askpass.env(13, None);
    let git = thread::spawn(move || credential_fill(env));
    let user = next_prompt(&rx);
    askpass.end_operation(13);
    assert!(matches!(rx.recv().unwrap(), SinkEvent::Closed(id) if id == user.id));
    assert!(!git.join().unwrap().status.success());
}

#[test]
fn quiet_env_declines_without_asking() {
    let (askpass, rx) = start();
    let out = credential_fill(askpass.env_quiet());
    assert!(!out.status.success());
    assert!(!String::from_utf8_lossy(&out.stdout).contains("password="));
    assert!(rx.try_recv().is_err(), "no prompt may be shown");
}
