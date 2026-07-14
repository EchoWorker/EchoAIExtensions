//! DWM "cloak" helper — instantly hide/show the overlay window without the
//! rebuild/animation/focus-jitter of `show()`/`hide()`.
//!
//! The overlay window is created once and kept alive; cloaking it makes it
//! vanish instantly (no minimize animation, no taskbar flicker) and uncloaking
//! brings it back. See docs/IMPLEMENTATION.md §3.6.1.
//!
//! No-op on non-Windows targets (EchoLens is Windows-only for now).

#[cfg(windows)]
pub fn set_cloaked(hwnd: isize, cloak: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK};
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    // DWMWA_CLOAK expects a BOOL (a 4-byte int) by pointer: 1 = cloak, 0 = show.
    let value: i32 = if cloak { 1 } else { 0 };
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CLOAK,
            &value as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
        if cloak {
            // Sink to the bottom of the Z-order so a cloaked window never
            // intercepts clicks meant for the app behind it.
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
                0,
                0,
                0,
                0,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn set_cloaked(_hwnd: isize, _cloak: bool) {}
