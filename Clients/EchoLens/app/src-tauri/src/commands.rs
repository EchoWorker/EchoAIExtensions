//! Tauri commands invoked from the frontend, plus the shared capture helper used
//! by the global-shortcut handler.

use tauri::{AppHandle, Manager, State};

use echolens_perception::Scope;

use crate::state::{first_window_name, save_settings, AppState, CapturedContext, Settings};

/// Run a perception capture for `scope` and store it as the latest context.
/// Shared by the hotkey handler (Rust) and the `capture_perception` command
/// (frontend re-capture on scope change).
///
/// The actual UIA capture runs on the dedicated MTA thread (COM apartment
/// isolation — Tauri's main thread is STA and can't host the MTA-based
/// uiautomation client).
pub fn run_capture(app: &AppHandle, scope: Scope) -> Result<CapturedContext, String> {
    let state = app.state::<AppState>();
    let result = state.capture.capture(scope).map_err(|e| e.to_string())?;
    let ctx = CapturedContext {
        title: first_window_name(&result.xml),
        xml: result.xml,
        node_count: result.node_count,
        omitted: result.omitted,
        scope: scope_label(scope).to_string(),
    };
    *state.last_capture.lock().unwrap() = Some(ctx.clone());
    Ok(ctx)
}

fn scope_label(scope: Scope) -> &'static str {
    match scope {
        Scope::Focus => "focus",
        Scope::Window => "window",
        Scope::Screen => "screen",
    }
}

/// Re-capture for a given scope (frontend calls this when the user switches
/// scope inside the overlay). Returns the fresh context.
///
/// ★ This is `async` on purpose. Tauri runs sync commands on the main (UI)
/// thread; if we blocked there waiting on the MTA capture, the UI message pump
/// would stall — and because UIA sends `WM_GETOBJECT` back to the (now visible)
/// overlay window, which only the main thread can answer, it deadlocks ("Not
/// Responding"). An async command runs off the main thread, so the blocking
/// wait is safe and the pump keeps servicing UIA.
#[tauri::command]
pub async fn capture_perception(
    app: AppHandle,
    scope: String,
) -> Result<CapturedContext, String> {
    tauri::async_runtime::spawn_blocking(move || run_capture(&app, Scope::parse(&scope)))
        .await
        .map_err(|e| format!("capture task failed: {e}"))?
}

/// Return the most recent capture (taken by the hotkey handler before the
/// overlay was shown). The frontend reads this on `perception-ready`.
#[tauri::command]
pub fn get_cached_perception(state: State<AppState>) -> Option<CapturedContext> {
    state.last_capture.lock().unwrap().clone()
}

/// Hide (cloak) the overlay. Bound to Esc and the "send done / dismiss" flow.
#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    crate::overlay::hide(&app);
}

/// Toggle the overlay (used by the tray's left click).
#[tauri::command]
pub fn toggle_overlay(app: AppHandle) {
    crate::overlay::toggle(&app);
}

/// Read the EchoAI gateway lock (`~/.echoai/gateway.lock`) to discover the
/// WebSocket URL + auth token. Returns `{ url, token }` or an error string.
#[tauri::command]
pub fn read_gateway_lock() -> Result<serde_json::Value, String> {
    let candidates = gateway_lock_candidates();
    for path in &candidates {
        if let Ok(text) = std::fs::read_to_string(path) {
            let v: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("invalid gateway.lock: {e}"))?;
            // Validate it has a url before accepting.
            if v.get("url").and_then(|u| u.as_str()).is_some() {
                return Ok(v);
            }
        }
    }
    Err(format!(
        "gateway.lock not found (looked in: {})",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Candidate gateway.lock locations: release (`~/.echoai`) then dev
/// (`~/.echoai.dev`), plus an explicit `ECHOAI_CONFIG_DIR` override.
fn gateway_lock_candidates() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(dir) = std::env::var("ECHOAI_CONFIG_DIR") {
        out.push(std::path::PathBuf::from(dir).join("gateway.lock"));
    }
    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".echoai").join("gateway.lock"));
        out.push(home.join(".echoai.dev").join("gateway.lock"));
    }
    out
}

/// Read current settings.
#[tauri::command]
pub fn read_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

/// Persist settings. The hotkey is re-registered separately by the frontend
/// asking us to (see `set_summon_hotkey`).
#[tauri::command]
pub fn write_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    save_settings(&settings)?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

/// Change the global summon hotkey: unregister the old accelerator, register the
/// new one, and persist it. Returns an error string if the accelerator is
/// invalid or already taken.
#[tauri::command]
pub fn set_summon_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    crate::hotkey::reregister(&app, &accelerator)?;
    let state = app.state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    s.hotkey = accelerator;
    save_settings(&s)
}
