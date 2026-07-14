//! Live capture smoke test. Run on Windows:
//!
//! ```text
//! cargo run --example dump -- window     # default
//! cargo run --example dump -- focus
//! cargo run --example dump -- screen
//! ```
//!
//! Prints the perceived screen context as XML plus node/timing stats. This is a
//! manual smoke test, not a unit test (it needs a real desktop).

fn main() {
    let scope_arg = std::env::args().nth(1).unwrap_or_else(|| "window".to_string());

    #[cfg(windows)]
    {
        use echolens_perception::{capture, Scope};
        use std::time::Instant;

        let scope = Scope::parse(&scope_arg);
        println!("=== EchoLens perception dump: scope={scope:?} ===\n");

        let t0 = Instant::now();
        match capture(scope) {
            Ok(result) => {
                let elapsed = t0.elapsed();
                println!("{}", result.xml);
                println!("--- stats ---");
                println!("kept nodes : {}", result.node_count);
                println!("omitted    : {}", result.omitted);
                println!("elapsed    : {elapsed:?}");
            }
            Err(e) => {
                eprintln!("capture failed: {e}");
                std::process::exit(1);
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = scope_arg;
        eprintln!("This example only runs on Windows (perception is Windows-only in M1).");
        std::process::exit(1);
    }
}
