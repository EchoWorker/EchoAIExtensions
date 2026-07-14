//! Runtime check for the COM-apartment fix.
//!
//! Reproduces the exact production scenario: the main thread is initialized as
//! STA (like Tauri/WebView2), which makes a direct `echolens_perception::capture`
//! fail with RPC_E_CHANGED_MODE. The `CaptureThread` (MTA) must succeed anyway.
//!
//! Run: `cargo run --example com_apartment_check`

#[cfg(windows)]
fn main() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};

    // 1) Make THIS (main) thread an STA, exactly like Tauri's GUI thread.
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        println!("main thread CoInitializeEx(STA): {hr:?}");
    }

    // 2) A direct capture on this STA thread should fail (the bug the user hit).
    match echolens_perception::capture(echolens_perception::Scope::Screen) {
        Ok(_) => println!("[unexpected] direct capture on STA succeeded"),
        Err(e) => println!("[expected] direct capture on STA failed: {e}"),
    }

    // 3) Capture via the dedicated MTA thread must succeed.
    let thread = echolens_lib::capture_thread_for_test();
    match thread.capture(echolens_perception::Scope::Screen) {
        Ok(r) => {
            println!(
                "[ok] MTA-thread capture succeeded: {} elements, {} omitted",
                r.node_count, r.omitted
            );
            assert!(r.node_count > 0, "expected a non-empty capture");
            assert!(r.xml.contains('<'), "expected XML output");
            println!("PASS");
        }
        Err(e) => {
            println!("[FAIL] MTA-thread capture failed: {e}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    println!("Windows-only check; skipping.");
}
