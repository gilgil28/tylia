//! The helper side: Git and ssh start Tylia's executable with the prompt as the only
//! argument and read the answer from its stdout. Exit code 0 means "answered"; any other
//! code makes Git and ssh fail as if the user had cancelled.
//!
//! This runs before anything of the app is initialised. On Windows release builds the
//! executable uses the GUI subsystem, which has no console but still inherits the standard
//! handles Git passes (Git starts the helper with `STARTF_USESTDHANDLES` and a pipe as
//! stdout), so writing to stdout reaches Git.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use super::{ENV_ADDR, ENV_DENY, ENV_OP, ENV_TOKEN, Request, Response};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// If this process was started as the askpass helper, answers the prompt and returns the
/// exit code; returns `None` for a normal app start.
pub fn run_if_helper() -> Option<i32> {
    let deny = std::env::var_os(ENV_DENY).is_some();
    if !deny && std::env::var_os(ENV_TOKEN).is_none() {
        return None;
    }
    if deny {
        return Some(1);
    }
    Some(match ask().and_then(print) {
        Some(()) => 0,
        None => 1,
    })
}

/// Asks the app; `None` if cancelled or anything failed.
fn ask() -> Option<String> {
    let addr: SocketAddr = std::env::var(ENV_ADDR).ok()?.parse().ok()?;
    if !addr.ip().is_loopback() {
        return None;
    }
    let request = Request {
        token: std::env::var(ENV_TOKEN).ok()?,
        op: std::env::var(ENV_OP).ok()?.parse().ok()?,
        prompt: std::env::args_os().nth(1)?.to_string_lossy().into_owned(),
        hint: std::env::var("SSH_ASKPASS_PROMPT").ok(),
    };
    let mut line = serde_json::to_vec(&request).ok()?;
    line.push(b'\n');

    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).ok()?;
    stream.set_write_timeout(Some(CONNECT_TIMEOUT)).ok()?;
    stream.write_all(&line).ok()?;
    // No read timeout: the user may take a while. The write half stays open; closing it
    // would tell the server this helper has gone away.
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).ok()?;
    serde_json::from_str::<Response>(&reply).ok()?.answer
}

fn print(answer: String) -> Option<()> {
    let mut out = std::io::stdout().lock();
    out.write_all(answer.as_bytes()).ok()?;
    out.write_all(b"\n").ok()?;
    out.flush().ok()
}
