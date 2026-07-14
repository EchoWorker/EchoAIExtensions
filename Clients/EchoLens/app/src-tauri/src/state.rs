//! Shared application state: the most recent perception capture, the current
//! scope, and persisted user settings.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// User-tunable settings, persisted to `~/.echolens/settings.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Global summon hotkey accelerator (e.g. "Ctrl+Shift+Space").
    pub hotkey: String,
    /// Default perception scope: "focus" | "window" | "screen".
    pub scope: String,
    /// Optional model id override for the gateway (empty = gateway default).
    pub model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            hotkey: "Ctrl+Shift+Space".to_string(),
            scope: "window".to_string(),
            model: String::new(),
        }
    }
}

/// A capture result, flattened for the frontend (mirrors
/// `echolens_perception::PerceptionResult` plus a derived window title).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CapturedContext {
    pub xml: String,
    pub node_count: usize,
    pub omitted: usize,
    pub scope: String,
    /// Best-effort window title (first `name="..."` in the XML).
    pub title: String,
}

/// Process-wide state behind a mutex (Tauri-managed).
pub struct AppState {
    pub last_capture: Mutex<Option<CapturedContext>>,
    pub settings: Mutex<Settings>,
    /// Dedicated MTA thread that runs UI Automation captures (COM apartment
    /// isolation — see `capture_thread.rs`).
    pub capture: crate::capture_thread::CaptureThread,
}

impl AppState {
    pub fn new(settings: Settings, capture: crate::capture_thread::CaptureThread) -> Self {
        AppState {
            last_capture: Mutex::new(None),
            settings: Mutex::new(settings),
            capture,
        }
    }
}

// ── Settings persistence ──────────────────────────────────────────────────────

fn settings_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".echolens").join("settings.json"))
}

/// Load settings from disk, or defaults if absent/corrupt.
pub fn load_settings() -> Settings {
    let Some(path) = settings_path() else {
        return Settings::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

/// Persist settings to disk (best-effort; returns an error string on failure).
pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path().ok_or_else(|| "no home directory".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Extract the first `name="..."` from an XML string (the top window's title).
pub fn first_window_name(xml: &str) -> String {
    if let Some(start) = xml.find("name=\"") {
        let rest = &xml[start + 6..];
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    "(unnamed)".to_string()
}
