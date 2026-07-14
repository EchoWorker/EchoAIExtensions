//! Dedicated MTA capture thread — isolates UI Automation's COM apartment from
//! Tauri's main (STA) thread.
//!
//! ★ Why this exists: `uiautomation::UIAutomation::new()` calls
//! `CoInitializeEx(COINIT_MULTITHREADED)` to put the calling thread in the COM
//! MTA. But Tauri's main thread is already a single-threaded apartment (STA) —
//! required by the GUI / WebView2 / window message pump. A thread's apartment
//! can't be changed once set, so calling capture on the main thread fails with
//! `RPC_E_CHANGED_MODE` ("Cannot change thread mode after it is set").
//!
//! Fix: run all UIA captures on a dedicated background thread that we initialize
//! as MTA exactly once. The main thread stays STA; capture lives in the MTA.
//! Requests/responses cross the thread boundary over channels.

use std::sync::mpsc::{self, Sender};
use std::thread;

use echolens_perception::{capture_with_budget, Budget, PerceptionError, PerceptionResult, Scope};

/// A capture job: the scope to capture plus a one-shot reply channel.
struct Job {
    scope: Scope,
    reply: Sender<Result<PerceptionResult, PerceptionError>>,
}

/// Handle to the capture thread. Cloneable; send jobs from any thread.
#[derive(Clone)]
pub struct CaptureThread {
    tx: Sender<Job>,
}

impl CaptureThread {
    /// Spawn the dedicated MTA capture thread. The thread initializes COM as MTA
    /// once, then serves capture requests until the app exits.
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel::<Job>();

        thread::Builder::new()
            .name("echolens-capture".into())
            .spawn(move || {
                // Initialize this thread's COM apartment as MTA, once. The
                // uiautomation crate's `UIAutomation::new()` also calls
                // CoInitializeEx(MTA) per instance, which is fine/no-op now that
                // the apartment is already MTA (it returns S_FALSE, not an error).
                #[cfg(windows)]
                init_mta();

                // Serve jobs until all senders drop (app shutdown).
                while let Ok(job) = rx.recv() {
                    let result = capture_with_budget(job.scope, &Budget::default());
                    // Ignore send errors: the requester may have given up.
                    let _ = job.reply.send(result);
                }
            })
            .expect("failed to spawn echolens capture thread");

        CaptureThread { tx }
    }

    /// Run a capture on the MTA thread and wait for the result.
    pub fn capture(&self, scope: Scope) -> Result<PerceptionResult, PerceptionError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Job { scope, reply: reply_tx })
            .map_err(|_| PerceptionError::Capture("capture thread is not running".into()))?;
        reply_rx
            .recv()
            .map_err(|_| PerceptionError::Capture("capture thread dropped the reply".into()))?
    }
}

/// Initialize the current thread's COM apartment as MTA. Tolerates "already
/// initialized as MTA" (S_FALSE); only a genuine apartment conflict is an error,
/// which can't happen here because this is a fresh thread.
#[cfg(windows)]
fn init_mta() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        // HRESULT: S_OK (first init) or S_FALSE (already MTA) are both fine.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}
