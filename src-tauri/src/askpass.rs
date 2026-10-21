//! Credential prompts from Git and ssh, shown as Tylia dialogs (ARCHITECTURE §5.13).
//!
//! Tylia's own executable is Git's and ssh's askpass helper. Started that way
//! ([`client::run_if_helper`]), it connects to the [`Askpass`] server of the running app on
//! the loopback interface, authenticates with a random per-session token, sends the prompt
//! and prints the answer. The server classifies the prompt, shows it through a
//! [`PromptSink`] (a Tauri event in the app) and writes back the answer given to
//! [`Askpass::respond`], or "cancelled".
//!
//! Answers are never logged, stored or put in errors: they only pass from the dialog to the
//! helper that asked.

mod classify;
pub mod client;

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, UserAttentionType};
use ts_rs::TS;

pub use classify::{AskpassKind, Classified, classify};

/// Address of the app's askpass server (`127.0.0.1:port`).
pub const ENV_ADDR: &str = "TYLIA_ASKPASS_ADDR";
/// The per-session token the helper must present.
pub const ENV_TOKEN: &str = "TYLIA_ASKPASS_TOKEN";
/// The operation the prompting Git process belongs to.
pub const ENV_OP: &str = "TYLIA_ASKPASS_OP";
/// Set for background operations: the helper declines every prompt without asking.
pub const ENV_DENY: &str = "TYLIA_ASKPASS_DENY";

/// Event carrying an [`AskpassPrompt`] to the frontend.
pub const PROMPT_EVENT: &str = "askpass-prompt";
/// Event carrying the id of a prompt that no longer wants an answer (its operation ended,
/// or the asking process went away).
pub const CLOSED_EVENT: &str = "askpass-closed";

/// Largest request a helper may send (the prompt is a few lines).
const MAX_REQUEST: usize = 64 * 1024;
/// Time a helper has to send its request, and the server to write the answer.
const IO_TIMEOUT: Duration = Duration::from_secs(5);
/// How often a waiting prompt checks that its helper is still there.
const POLL: Duration = Duration::from_millis(250);
/// Connections served at once; more are refused.
const MAX_CONNECTIONS: usize = 32;

/// A prompt shown to the user.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AskpassPrompt {
    /// Pass to `askpass_respond`.
    pub id: u32,
    pub operation_id: u32,
    /// The repository the operation runs in (None for clone).
    pub repo: Option<String>,
    pub kind: AskpassKind,
    /// The prompt text as Git or ssh wrote it.
    pub prompt: String,
    /// Server the credential is for.
    pub host: Option<String>,
    /// Username, key path or host-key fingerprint, depending on `kind`.
    pub detail: Option<String>,
    /// The answer must be masked.
    pub secret: bool,
}

/// Where prompts are shown. The app uses [`EventSink`]; tests use a channel.
pub trait PromptSink: Send + Sync + 'static {
    /// Shows a prompt; false if it can't be shown (no window), which cancels it.
    fn show(&self, prompt: &AskpassPrompt) -> bool;
    /// The prompt no longer wants an answer: hide it.
    fn close(&self, id: u32);
}

/// Shows prompts in the main window via [`PROMPT_EVENT`] / [`CLOSED_EVENT`].
pub struct EventSink(pub AppHandle);

impl PromptSink for EventSink {
    fn show(&self, prompt: &AskpassPrompt) -> bool {
        let Some(window) = self.0.get_webview_window("main") else {
            return false;
        };
        if window.emit(PROMPT_EVENT, prompt).is_err() {
            return false;
        }
        if !window.is_focused().unwrap_or(true) {
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        }
        true
    }

    fn close(&self, id: u32) {
        let _ = self.0.emit(CLOSED_EVENT, id);
    }
}

/// The prompt bridge. One per app; lives in `AppState`. `Default` is a disabled bridge
/// (no prompts reach the UI; Git fails with its usual authentication error).
#[derive(Default)]
pub struct Askpass {
    server: Option<Arc<Server>>,
}

struct Server {
    addr: SocketAddr,
    token: String,
    /// The askpass helper: Tylia's own executable.
    helper: String,
    sink: Box<dyn PromptSink>,
    state: Mutex<State>,
    connections: AtomicUsize,
}

#[derive(Default)]
struct State {
    /// Operations that may prompt, with their repository label.
    operations: HashMap<u32, Option<String>>,
    pending: HashMap<u32, Pending>,
    last_id: u32,
}

struct Pending {
    operation_id: u32,
    answer: SyncSender<Option<String>>,
}

/// Helper → server: one JSON line. The connection stays open until the answer comes back
/// (closing it early cancels the prompt).
#[derive(Serialize, Deserialize)]
struct Request {
    token: String,
    op: u32,
    prompt: String,
    /// ssh's `SSH_ASKPASS_PROMPT`.
    hint: Option<String>,
}

/// Server → helper: one JSON line; `answer: null` means cancelled.
#[derive(Serialize, Deserialize)]
struct Response {
    answer: Option<String>,
}

impl Askpass {
    /// Starts the server, with this executable as the helper.
    pub fn start(sink: impl PromptSink) -> io::Result<Self> {
        Self::start_with_helper(sink, &std::env::current_exe()?)
    }

    /// Starts the server with `helper` as the askpass program (tests use the built binary).
    pub fn start_with_helper(sink: impl PromptSink, helper: &Path) -> io::Result<Self> {
        let helper = helper
            .to_str()
            .ok_or_else(|| io::Error::other("the executable path isn't valid Unicode"))?
            .to_owned();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let server = Arc::new(Server {
            addr: listener.local_addr()?,
            token: new_token()?,
            helper,
            sink: Box::new(sink),
            state: Mutex::default(),
            connections: AtomicUsize::new(0),
        });
        let accepting = server.clone();
        thread::Builder::new()
            .name("askpass".into())
            .spawn(move || accepting.accept(listener))?;
        Ok(Self {
            server: Some(server),
        })
    }

    /// Environment for a Git process run as part of operation `operation_id`, so its
    /// credential and ssh prompts reach the UI. `repo` labels the prompt (None for clone).
    pub fn env(&self, operation_id: u32, repo: Option<&str>) -> Vec<(String, String)> {
        let Some(server) = &self.server else {
            return Vec::new();
        };
        lock(&server.state)
            .operations
            .insert(operation_id, repo.map(str::to_owned));
        let mut env = helper_env(&server.helper);
        env.extend([
            (ENV_ADDR.to_owned(), server.addr.to_string()),
            (ENV_TOKEN.to_owned(), server.token.clone()),
            (ENV_OP.to_owned(), operation_id.to_string()),
        ]);
        env
    }

    /// Environment for background operations: prompts are declined without asking (the
    /// helper exits without contacting the app), so nothing pops up unasked.
    pub fn env_quiet(&self) -> Vec<(String, String)> {
        let helper = match &self.server {
            Some(server) => server.helper.clone(),
            None => match std::env::current_exe()
                .ok()
                .and_then(|p| p.to_str().map(str::to_owned))
            {
                Some(exe) => exe,
                None => return Vec::new(),
            },
        };
        let mut env = helper_env(&helper);
        env.extend([
            (ENV_DENY.to_owned(), "1".to_owned()),
            // Git Credential Manager would otherwise show its own sign-in window.
            ("GCM_INTERACTIVE".to_owned(), "never".to_owned()),
        ]);
        env
    }

    /// Answers every open prompt of the operation with "cancelled"; called when it is
    /// cancelled and when it ends. Later prompts of the operation are cancelled too.
    pub fn end_operation(&self, operation_id: u32) {
        let Some(server) = &self.server else { return };
        let ended: Vec<u32> = {
            let mut state = lock(&server.state);
            state.operations.remove(&operation_id);
            let ids: Vec<u32> = state
                .pending
                .iter()
                .filter(|(_, p)| p.operation_id == operation_id)
                .map(|(id, _)| *id)
                .collect();
            for id in &ids {
                if let Some(p) = state.pending.remove(id) {
                    let _ = p.answer.send(None);
                }
            }
            ids
        };
        for id in ended {
            server.sink.close(id);
        }
    }

    /// The user's answer to prompt `id`; `None` cancels. Unknown ids (already answered or
    /// cancelled) are ignored.
    pub fn respond(&self, id: u32, answer: Option<String>) {
        let Some(server) = &self.server else { return };
        if let Some(p) = lock(&server.state).pending.remove(&id) {
            let _ = p.answer.send(answer);
        }
    }
}

impl Server {
    fn accept(self: Arc<Self>, listener: TcpListener) {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            if self.connections.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                self.connections.fetch_sub(1, Ordering::SeqCst);
                continue;
            }
            // One thread per helper: a slow or hung one only holds up its own prompt.
            let server = self.clone();
            let spawned = thread::Builder::new()
                .name("askpass-conn".into())
                .spawn(move || {
                    server.serve(stream);
                    server.connections.fetch_sub(1, Ordering::SeqCst);
                });
            if spawned.is_err() {
                self.connections.fetch_sub(1, Ordering::SeqCst);
            }
        }
    }

    fn serve(&self, mut stream: TcpStream) {
        let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
        let Some(request) = read_request(&mut stream) else {
            return;
        };
        if !constant_time_eq(request.token.as_bytes(), self.token.as_bytes()) {
            return;
        }
        let answer = self.ask(&request, &stream);
        let Ok(mut line) = serde_json::to_vec(&Response { answer }) else {
            return;
        };
        line.push(b'\n');
        let _ = stream.write_all(&line);
    }

    /// Shows the prompt and waits for the answer; `None` if cancelled.
    fn ask(&self, request: &Request, stream: &TcpStream) -> Option<String> {
        let (tx, rx) = mpsc::sync_channel(1);
        let prompt = {
            let mut state = lock(&self.state);
            // Only operations that are running may ask.
            let repo = state.operations.get(&request.op)?.clone();
            state.last_id = state.last_id.wrapping_add(1).max(1);
            let id = state.last_id;
            state.pending.insert(
                id,
                Pending {
                    operation_id: request.op,
                    answer: tx,
                },
            );
            let c = classify(&request.prompt, request.hint.as_deref());
            AskpassPrompt {
                id,
                operation_id: request.op,
                repo,
                kind: c.kind,
                prompt: request.prompt.clone(),
                host: c.host,
                detail: c.detail,
                secret: c.secret,
            }
        };
        let id = prompt.id;
        if !self.sink.show(&prompt) {
            lock(&self.state).pending.remove(&id);
            return None;
        }
        loop {
            match rx.recv_timeout(POLL) {
                Ok(answer) => return answer,
                Err(RecvTimeoutError::Disconnected) => return None,
                Err(RecvTimeoutError::Timeout) => {
                    if peer_gone(stream) {
                        if lock(&self.state).pending.remove(&id).is_some() {
                            self.sink.close(id);
                        }
                        return None;
                    }
                }
            }
        }
    }
}

/// `GIT_ASKPASS` / `SSH_ASKPASS` pointing at `helper`.
fn helper_env(helper: &str) -> Vec<(String, String)> {
    let mut env = vec![
        ("GIT_ASKPASS".to_owned(), helper.to_owned()),
        ("SSH_ASKPASS".to_owned(), helper.to_owned()),
        // OpenSSH 8.4+: use the helper even when a terminal is available.
        ("SSH_ASKPASS_REQUIRE".to_owned(), "force".to_owned()),
    ];
    // Older OpenSSH only uses SSH_ASKPASS when DISPLAY is set. It only checks that the
    // variable exists; ":0" names the local display, so nothing ever connects over the
    // network because of it. An existing DISPLAY is left alone.
    if cfg!(unix) && std::env::var_os("DISPLAY").is_none() {
        env.push(("DISPLAY".to_owned(), ":0".to_owned()));
    }
    env
}

/// Reads the helper's request line, giving up after [`IO_TIMEOUT`] or [`MAX_REQUEST`]
/// bytes, so a stalled or hostile client is dropped quickly.
fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let deadline = Instant::now() + IO_TIMEOUT;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    while !buf.contains(&b'\n') {
        let left = deadline.checked_duration_since(Instant::now())?;
        stream
            .set_read_timeout(Some(left.max(Duration::from_millis(1))))
            .ok()?;
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_REQUEST {
            return None;
        }
    }
    let end = buf.iter().position(|&b| b == b'\n')?;
    serde_json::from_slice(&buf[..end]).ok()
}

/// Whether the helper closed its end (it exits, or ssh killed it).
fn peer_gone(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return true;
    }
    let mut byte = [0u8; 1];
    let gone = match stream.peek(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(e) => e.kind() != io::ErrorKind::WouldBlock,
    };
    let _ = stream.set_nonblocking(false);
    gone
}

/// 32 random bytes from the OS, hex-encoded.
fn new_token() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Compares without an early exit, so timing reveals nothing about the token.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(diff) == 0
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Test support: a sink that hands prompts to a channel.
pub mod testing {
    use std::sync::Mutex;
    use std::sync::mpsc::{Receiver, Sender, channel};

    use super::{AskpassPrompt, PromptSink};

    /// What a [`ChannelSink`] saw.
    #[derive(Debug)]
    pub enum SinkEvent {
        Shown(AskpassPrompt),
        Closed(u32),
    }

    pub struct ChannelSink(Mutex<Sender<SinkEvent>>);

    impl ChannelSink {
        pub fn new() -> (Self, Receiver<SinkEvent>) {
            let (tx, rx) = channel();
            (Self(Mutex::new(tx)), rx)
        }
    }

    impl PromptSink for ChannelSink {
        fn show(&self, prompt: &AskpassPrompt) -> bool {
            super::lock(&self.0)
                .send(SinkEvent::Shown(prompt.clone()))
                .is_ok()
        }

        fn close(&self, id: u32) {
            let _ = super::lock(&self.0).send(SinkEvent::Closed(id));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader};

    use super::testing::{ChannelSink, SinkEvent};
    use super::*;

    fn start() -> (Askpass, std::sync::mpsc::Receiver<SinkEvent>) {
        let (sink, rx) = ChannelSink::new();
        let askpass = Askpass::start_with_helper(sink, Path::new("tylia")).unwrap();
        (askpass, rx)
    }

    fn var<'a>(env: &'a [(String, String)], key: &str) -> &'a str {
        &env.iter().find(|(k, _)| k == key).unwrap().1
    }

    /// Sends a request like the helper does; returns the open connection.
    fn send(env: &[(String, String)], token: &str, prompt: &str) -> TcpStream {
        let mut stream = TcpStream::connect(var(env, ENV_ADDR)).unwrap();
        let request = Request {
            token: token.to_owned(),
            op: var(env, ENV_OP).parse().unwrap(),
            prompt: prompt.to_owned(),
            hint: None,
        };
        let mut line = serde_json::to_vec(&request).unwrap();
        line.push(b'\n');
        stream.write_all(&line).unwrap();
        stream
    }

    fn reply(stream: TcpStream) -> Option<Option<String>> {
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).ok()?;
        let response: Response = serde_json::from_str(&line).ok()?;
        Some(response.answer)
    }

    fn shown(rx: &std::sync::mpsc::Receiver<SinkEvent>) -> AskpassPrompt {
        match rx.recv_timeout(Duration::from_secs(5)).unwrap() {
            SinkEvent::Shown(p) => p,
            other => panic!("expected a prompt, got {other:?}"),
        }
    }

    #[test]
    fn env_points_git_and_ssh_at_the_helper() {
        let (askpass, _rx) = start();
        let env = askpass.env(3, Some("/r"));
        assert_eq!(var(&env, "GIT_ASKPASS"), "tylia");
        assert_eq!(var(&env, "SSH_ASKPASS"), "tylia");
        assert_eq!(var(&env, "SSH_ASKPASS_REQUIRE"), "force");
        assert_eq!(var(&env, ENV_OP), "3");
        assert_eq!(var(&env, ENV_TOKEN).len(), 64);
        assert!(var(&env, ENV_ADDR).starts_with("127.0.0.1:"));

        let quiet = askpass.env_quiet();
        assert_eq!(var(&quiet, "GIT_ASKPASS"), "tylia");
        assert_eq!(var(&quiet, ENV_DENY), "1");
        assert!(!quiet.iter().any(|(k, _)| k == ENV_TOKEN || k == ENV_ADDR));
    }

    #[test]
    fn round_trip() {
        let (askpass, rx) = start();
        let env = askpass.env(7, Some("/home/ada/tylia"));
        let token = var(&env, ENV_TOKEN).to_owned();
        let stream = send(&env, &token, "Password for 'https://ada@github.com': ");
        let prompt = shown(&rx);
        assert_eq!(prompt.operation_id, 7);
        assert_eq!(prompt.repo.as_deref(), Some("/home/ada/tylia"));
        assert_eq!(prompt.kind, AskpassKind::Password);
        assert_eq!(prompt.host.as_deref(), Some("github.com"));
        assert!(prompt.secret);
        askpass.respond(prompt.id, Some("s3cret".into()));
        assert_eq!(reply(stream), Some(Some("s3cret".into())));
    }

    #[test]
    fn wrong_token_is_rejected_without_a_prompt() {
        let (askpass, rx) = start();
        let env = askpass.env(1, None);
        let stream = send(&env, &"0".repeat(64), "Username for 'https://x': ");
        // The server closes the connection without answering or showing anything.
        assert_eq!(reply(stream), None);
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn ended_and_unknown_operations_are_cancelled() {
        let (askpass, rx) = start();
        let env = askpass.env(2, None);
        let token = var(&env, ENV_TOKEN).to_owned();
        let stream = send(&env, &token, "Username for 'https://x': ");
        let prompt = shown(&rx);
        askpass.end_operation(2);
        assert_eq!(reply(stream), Some(None));
        assert!(matches!(rx.recv().unwrap(), SinkEvent::Closed(id) if id == prompt.id));
        // The operation is over: new prompts from it are cancelled without showing.
        let stream = send(&env, &token, "Password for 'https://x': ");
        assert_eq!(reply(stream), Some(None));
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn helper_going_away_closes_its_prompt() {
        let (askpass, rx) = start();
        let env = askpass.env(4, None);
        let token = var(&env, ENV_TOKEN).to_owned();
        let stream = send(&env, &token, "Confirm user presence");
        let prompt = shown(&rx);
        drop(stream);
        match rx.recv_timeout(Duration::from_secs(5)).unwrap() {
            SinkEvent::Closed(id) => assert_eq!(id, prompt.id),
            other => panic!("expected close, got {other:?}"),
        }
        // A late answer is ignored.
        askpass.respond(prompt.id, Some("x".into()));
    }

    #[test]
    fn a_silent_client_does_not_block_others() {
        let (askpass, rx) = start();
        let env = askpass.env(5, None);
        let token = var(&env, ENV_TOKEN).to_owned();
        let _silent = TcpStream::connect(var(&env, ENV_ADDR)).unwrap();
        let stream = send(&env, &token, "Username for 'https://x': ");
        let prompt = shown(&rx);
        askpass.respond(prompt.id, Some("ada".into()));
        assert_eq!(reply(stream), Some(Some("ada".into())));
    }

    #[test]
    fn disabled_bridge_adds_nothing() {
        let askpass = Askpass::default();
        assert!(askpass.env(1, None).is_empty());
        askpass.end_operation(1);
        askpass.respond(1, None);
    }

    #[test]
    fn token_comparison() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }
}
