//! System tray: left-click toggles the overlay, double-click opens settings,
//! right-click menu has Settings / Quit.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit EchoLens", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

    TrayIconBuilder::with_id("echolens-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("EchoLens — press the summon hotkey to ask about your screen")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                crate::overlay::show(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                    crate::overlay::toggle(app);
                }
                TrayIconEvent::DoubleClick { .. } => {
                    crate::overlay::show(app);
                    let _ = app.emit("open-settings", ());
                }
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}
