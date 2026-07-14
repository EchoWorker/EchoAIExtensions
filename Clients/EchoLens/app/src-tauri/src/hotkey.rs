//! Global summon hotkey: registration + the capture-then-show handler.
//!
//! ★ Critical rule #1 — timing (docs/IMPLEMENTATION.md §3.4): we capture the
//! screen *before* showing the overlay, so we perceive the user's app and not
//! our own input box.
//!
//! ★ Critical rule #2 — never block the main thread. The hotkey handler runs on
//! the GUI (STA) main thread. UI Automation captures can take 70–300ms AND send
//! `WM_GETOBJECT` messages back to windows (including ours), which only the main
//! thread's message pump can answer. If we blocked the main thread waiting for a
//! capture, the pump would stall → "Not Responding" → deadlock (the capture
//! waits on our window, our window waits on the capture). So `capture_and_show`
//! dispatches the capture to a background task and returns immediately; the
//! overlay is shown and the event emitted back on the main thread when the
//! capture completes.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

use echolens_perception::Scope;

use crate::state::AppState;

/// Guards against overlapping captures (e.g. mashing the hotkey). While a
/// capture is in flight, extra triggers are ignored.
static CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Dispatch a capture for the configured scope WITHOUT blocking the calling
/// (main) thread, then show the overlay + notify the frontend on the main
/// thread once it completes. Safe to call from the hotkey handler or tray.
pub fn capture_and_show(app: &AppHandle) {
    // Drop the trigger if a capture is already running (don't queue/stack).
    if CAPTURE_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return;
    }

    let app = app.clone();
    let scope = current_scope(&app);

    // Run the (blocking) capture off the main thread. The actual UIA work still
    // happens on the dedicated MTA thread inside `run_capture`; spawn_blocking
    // just keeps THIS wait off the GUI thread so the message pump stays alive.
    tauri::async_runtime::spawn_blocking(move || {
        let result = crate::commands::run_capture(&app, scope);

        // Hop back to the main thread for all GUI work (show + emit).
        let _ = app.clone().run_on_main_thread(move || {
            match result {
                Ok(ctx) => {
                    crate::overlay::show(&app);
                    let _ = app.emit("perception-ready", ctx);
                }
                Err(e) => {
                    // Still show the overlay so the user can ask anyway.
                    crate::overlay::show(&app);
                    let _ = app.emit("perception-error", e);
                }
            }
            CAPTURE_IN_FLIGHT.store(false, Ordering::SeqCst);
        });
    });
}

fn current_scope(app: &AppHandle) -> Scope {
    let state = app.state::<AppState>();
    let label = state.settings.lock().unwrap().scope.clone();
    Scope::parse(&label)
}

/// Build the global-shortcut plugin with the summon handler wired in.
/// Concrete `Wry` runtime — the global-shortcut builder is desktop/Wry-specific.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut: &Shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                // Returns immediately; capture runs in the background.
                capture_and_show(app);
            }
        })
        .build()
}

/// Register the accelerator string as the summon hotkey.
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    app.global_shortcut()
        .register(accelerator)
        .map_err(|e| format!("failed to register hotkey '{accelerator}': {e}"))
}

/// Unregister the old accelerator and register a new one.
pub fn reregister(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    // Best-effort: clear all, then register the new one.
    let _ = app.global_shortcut().unregister_all();
    app.global_shortcut()
        .register(accelerator)
        .map_err(|e| format!("failed to register hotkey '{accelerator}': {e}"))
}
