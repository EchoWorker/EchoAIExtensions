//! Overlay window lifecycle — show / hide / toggle via DWM cloak.
//!
//! The overlay is created once (declared in `tauri.conf.json`, `visible:false`)
//! and kept alive. We never destroy it; "showing" = uncloak + focus, "hiding" =
//! cloak. This module owns that policy so the rest of the app just calls
//! `show`/`hide`/`toggle`.

use tauri::{AppHandle, Manager};

use crate::cloak::set_cloaked;

const OVERLAY_LABEL: &str = "overlay";

/// Whether the overlay is currently visible (tracked via window visibility).
pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(OVERLAY_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
        && !is_cloaked(app)
}

// We track cloak state ourselves since DWM cloak isn't reflected by is_visible.
use std::sync::atomic::{AtomicBool, Ordering};
static CLOAKED: AtomicBool = AtomicBool::new(true);

fn is_cloaked(_app: &AppHandle) -> bool {
    CLOAKED.load(Ordering::SeqCst)
}

/// Cloak the overlay on startup (called once after the window is built).
pub fn init_cloaked(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = w.show(); // make it "visible" so uncloak later actually paints
        if let Ok(h) = w.hwnd() {
            set_cloaked(h.0 as isize, true);
        }
        CLOAKED.store(true, Ordering::SeqCst);
    }
}

/// Show (uncloak + focus) the overlay. Caller is responsible for having captured
/// the screen *before* this — showing the overlay steals focus.
pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = w.center();
        if let Ok(h) = w.hwnd() {
            set_cloaked(h.0 as isize, false);
        }
        CLOAKED.store(false, Ordering::SeqCst);
        let _ = w.set_focus();
    }
}

/// Hide (cloak) the overlay.
pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        if let Ok(h) = w.hwnd() {
            set_cloaked(h.0 as isize, true);
        }
        CLOAKED.store(true, Ordering::SeqCst);
    }
}

/// Toggle visibility. When showing from the tray (no fresh capture), we capture
/// the current foreground first so the overlay still has context.
pub fn toggle(app: &AppHandle) {
    if is_visible(app) {
        hide(app);
    } else {
        // Capture before showing (tray path). Best-effort; ignore errors.
        crate::hotkey::capture_and_show(app);
    }
}
