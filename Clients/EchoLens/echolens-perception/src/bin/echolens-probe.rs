//! EchoLens Screen Perception Probe (M1 experience tool).
//!
//! There is no GUI yet (that's M2 — hotkey + tray + overlay). This binary lets
//! you *experience* the M1 perception core directly: run it, switch to any
//! window, and it prints the structured UI tree EchoLens would feed to the AI.
//!
//! Usage:
//!   echolens-probe                 # interactive: 3s countdown, capture foreground window, loop
//!   echolens-probe focus           # scope = focused element + neighborhood
//!   echolens-probe screen          # scope = shallow overview of all top windows
//!   echolens-probe --once          # single capture, no countdown/loop (scripting/smoke)
//!   echolens-probe --delay 5       # change the countdown seconds
//!   echolens-probe --full          # print the full XML to stdout (not truncated)
//!
//! ASCII-only output to stay legible on legacy Windows consoles (conhost/GBK).

use std::io::{self, Write};
use std::time::{Duration, Instant};

use echolens_perception::{capture_with_budget, Budget, PerceptionResult, Scope};

struct Args {
    scope: Scope,
    once: bool,
    delay_secs: u64,
    full_xml: bool,
}

fn parse_args() -> Args {
    let mut scope = Scope::Window;
    let mut once = false;
    let mut delay_secs = 3u64;
    let mut full_xml = false;

    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--once" => once = true,
            "--full" => full_xml = true,
            "--delay" => {
                if let Some(v) = it.next() {
                    delay_secs = v.parse().unwrap_or(3);
                }
            }
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            "focus" | "window" | "screen" => scope = Scope::parse(a.as_str()),
            other => {
                eprintln!("unknown argument: {other} (try --help)");
                std::process::exit(2);
            }
        }
    }
    Args { scope, once, delay_secs, full_xml }
}

fn print_help() {
    println!(
        "EchoLens perception probe (M1)\n\n\
         Shows the structured UI tree EchoLens would feed to the AI.\n\n\
         USAGE:\n  \
         echolens-probe [scope] [--once] [--delay N] [--full]\n\n\
         SCOPE (default: window):\n  \
         focus    focused element + its neighborhood\n  \
         window   the whole foreground window\n  \
         screen   shallow overview of every top-level window\n\n\
         FLAGS:\n  \
         --once     capture once, no countdown/loop (for scripts)\n  \
         --delay N  countdown seconds before capture (default 3)\n  \
         --full     print full XML to stdout (default: first 40 lines)\n  \
         -h, --help this message"
    );
}

fn main() {
    let args = parse_args();

    print_banner(args.scope);

    if args.once {
        run_capture(args.scope, args.full_xml);
        return;
    }

    // Interactive loop: countdown → capture → pause → repeat.
    loop {
        println!();
        println!(">> Switch to ANY app you want to inspect (browser, editor, settings...).");
        countdown(args.delay_secs);
        run_capture(args.scope, args.full_xml);

        println!();
        print!("Press Enter to capture again, or close this window / Ctrl+C to quit... ");
        let _ = io::stdout().flush();
        let mut line = String::new();
        if io::stdin().read_line(&mut line).unwrap_or(0) == 0 {
            break; // EOF (e.g. piped) — don't spin forever
        }
    }
}

fn print_banner(scope: Scope) {
    println!("==================================================");
    println!("   EchoLens -- Screen Perception Probe  (M1)");
    println!("==================================================");
    println!("This shows what EchoLens \"sees\": the structured UI");
    println!("tree it would hand to the AI for a screen-aware answer.");
    println!();
    println!("Scope: {}", scope_label(scope));
    println!("(no GUI yet -- the hotkey/overlay app is milestone M2)");
}

fn scope_label(scope: Scope) -> &'static str {
    match scope {
        Scope::Focus => "focus   (focused element + neighborhood)",
        Scope::Window => "window  (the whole foreground window)",
        Scope::Screen => "screen  (overview of all top-level windows)",
    }
}

fn countdown(secs: u64) {
    print!("   Capturing in ");
    let _ = io::stdout().flush();
    for n in (1..=secs).rev() {
        print!("{n}... ");
        let _ = io::stdout().flush();
        std::thread::sleep(Duration::from_secs(1));
    }
    println!("now!");
}

fn run_capture(scope: Scope, full_xml: bool) {
    let t0 = Instant::now();
    match capture_with_budget(scope, &Budget::default()) {
        Ok(result) => {
            let elapsed = t0.elapsed();
            print_result(&result, elapsed, full_xml);
        }
        Err(e) => {
            println!();
            println!("   capture failed: {e}");
            println!("   (tip: some apps -- e.g. certain browsers -- expose little");
            println!("    accessibility info; try 'window' scope or another app.)");
        }
    }
}

fn print_result(result: &PerceptionResult, elapsed: Duration, full_xml: bool) {
    let title = first_window_name(&result.xml).unwrap_or_else(|| "(unnamed)".to_string());

    println!();
    println!("+------------------ Captured ------------------");
    println!("| Window : {title}");
    println!("| Kept   : {} elements", result.node_count);
    println!("| Omitted: {} (pruned to fit the AI token budget)", result.omitted);
    println!("| Time   : {} ms", elapsed.as_millis());
    println!("+----------------------------------------------");
    println!();

    // Write the full XML next to a temp file so big trees stay readable.
    let xml_path = std::env::temp_dir().join("echolens-capture.xml");
    let wrote = std::fs::write(&xml_path, &result.xml).is_ok();

    if full_xml {
        println!("{}", result.xml);
    } else {
        let lines: Vec<&str> = result.xml.lines().collect();
        let show = lines.len().min(40);
        for l in &lines[..show] {
            println!("{l}");
        }
        if lines.len() > show {
            println!("... ({} more lines)", lines.len() - show);
        }
    }

    if wrote {
        println!();
        println!("Full XML written to: {}", xml_path.display());
    }
}

/// Pull the first `name="..."` out of the XML (the top window's title), if any.
fn first_window_name(xml: &str) -> Option<String> {
    let start = xml.find("name=\"")? + 6;
    let rest = &xml[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}
