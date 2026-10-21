//! Long network operations (clone, fetch, pull, push): cancellable by id, with credential
//! prompts routed to the UI.

use tauri::ipc::Channel;
use tokio::sync::oneshot;
use tylia_git::{OpContext, Progress};

use crate::state::{AppState, lock};

/// A running operation. Registers its cancel handle under the frontend-chosen id; dropping
/// it unregisters the id and closes any credential prompt still open.
pub struct Operation<'a> {
    state: &'a AppState,
    id: u32,
    cancel: Option<oneshot::Receiver<()>>,
    env: Vec<(String, String)>,
    progress: Channel<Progress>,
}

impl<'a> Operation<'a> {
    /// `repo` labels credential prompts (None for clone). `quiet` operations (background
    /// fetch) never prompt: credentials Git can't find on its own make them fail.
    pub fn start(
        state: &'a AppState,
        id: u32,
        repo: Option<&str>,
        quiet: bool,
        progress: Channel<Progress>,
    ) -> Self {
        let (tx, rx) = oneshot::channel();
        lock(&state.operations).insert(id, tx);
        let env = if quiet {
            state.askpass.env_quiet()
        } else {
            state.askpass.env(id, repo)
        };
        Self {
            state,
            id,
            cancel: Some(rx),
            env,
            progress,
        }
    }

    /// The context to pass to one Git call. `report` must come from [`Operation::reporter`].
    pub fn context<'b>(
        &'b mut self,
        report: &'b mut (dyn FnMut(Progress) + Send),
    ) -> OpContext<'b> {
        let cancel = self.cancel.take().expect("one Git call per operation");
        OpContext::new(cancel, report).with_env(&self.env)
    }

    /// Forwards progress to the frontend.
    pub fn reporter(&self) -> impl FnMut(Progress) + Send + use<> {
        let channel = self.progress.clone();
        move |p| {
            let _ = channel.send(p);
        }
    }
}

impl Drop for Operation<'_> {
    fn drop(&mut self) {
        lock(&self.state.operations).remove(&self.id);
        self.state.askpass.end_operation(self.id);
    }
}
