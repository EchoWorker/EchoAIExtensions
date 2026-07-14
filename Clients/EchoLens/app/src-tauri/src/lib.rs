//! EchoLens — Windows screen-perception AI assistant (Tauri shell).
//!
//! Press a global hotkey → capture the foreground window's UI tree (via
//! `echolens-perception`) → summon a translucent overlay → ask a question →
//! the answer streams back from the EchoAI gateway.
//!
//! Module layout:
//! - `cloak`    — DWM cloak (instant hide/show of the overlay)
//! - `overlay`  — overlay window lifecycle (show/hide/toggle)
//! - `hotkey`   — global summon hotkey + the capture-then-show handler
//! - `tray`     — system tray icon + menu
//! - `state`    — cached capture + persisted settings
//! - `commands` — Tauri commands invoked from the frontend

mod capture_thread;
mod cloak;
mod commands;
mod hotkey;
mod overlay;
mod state;
mod tray;

use tauri::Manager;

use state::{load_settings, AppState};

/// Test-only helper: spawn a standalone capture thread (used by the
/// `com_apartment_check` example to verify COM apartment isolation).
#[doc(hidden)]
pub fn capture_thread_for_test() -> capture_thread::CaptureThread {
    capture_thread::CaptureThread::spawn()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings();
    let summon_hotkey = settings.hotkey.clone();

    // Spawn the dedicated MTA capture thread before anything captures.
    let capture = capture_thread::CaptureThread::spawn();

    tauri::Builder::default()
        // Single instance: a second launch just re-summons the overlay.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            crate::overlay::toggle(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        // Global summon hotkey (handler captures-then-shows, see hotkey.rs).
        .plugin(hotkey::plugin())
        .manage(AppState::new(settings, capture))
        .invoke_handler(tauri::generate_handler![
            commands::capture_perception,
            commands::get_cached_perception,
            commands::hide_overlay,
            commands::toggle_overlay,
            commands::read_gateway_lock,
            commands::read_settings,
            commands::write_settings,
            commands::set_summon_hotkey,
        ])
        .setup(move |app| {
            let handle = app.handle();

            // Build the tray.
            tray::build(handle)?;

            // Cloak the overlay window so it's hidden until summoned.
            overlay::init_cloaked(handle);

            // Apply window vibrancy (acrylic) to the overlay for a frosted look.
            #[cfg(windows)]
            if let Some(win) = app.get_webview_window("overlay") {
                use window_vibrancy::apply_acrylic;
                let _ = apply_acrylic(&win, Some((18, 22, 28, 180)));
            }

            // Register the summon hotkey.
            if let Err(e) = hotkey::register(handle, &summon_hotkey) {
                eprintln!("EchoLens: {e}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running EchoLens");
}
