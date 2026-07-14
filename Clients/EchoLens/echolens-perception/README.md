# echolens-perception

The core "eyes" of **EchoLens** — extracts a structured UI Automation tree from
the Windows desktop, prunes it to a token budget, and serializes it as compact
XML for an LLM. This is the only net-new crate in the EchoLens MVP (everything
else is reused from EchoWork — see [`../docs/IMPLEMENTATION.md`](../docs/IMPLEMENTATION.md)).

> **Status:** M1 — perception crate. Builds + unit-tested. Not yet wired into a
> Tauri shell (that's M2).

## What it does

```text
Scope (Focus / Window / Screen)
  → capture: UI Automation → owned VisualNode tree   (Windows, ~48ms/150 nodes)
  → prune:   collapse containers · merge text · elide long text
  → select:  best-first under a TOKEN budget (not node count)
  → serialize: compact XML with element ids + omission hints
  → PerceptionResult { xml, node_count, omitted }
```

## Layering (why it's testable)

- **`model`** — platform-independent `VisualNode` tree (owned, no OS/COM handles).
- **`capture`** — platform-specific extraction. `capture/windows.rs` is the only
  module that touches `uiautomation`; gated behind `#[cfg(windows)]`.
- **`builder`** — platform-independent `prune → score → select → serialize`.
  Pure algorithms over `VisualNode`, so the whole builder is unit-tested with
  hand-built trees on **any** OS.

## Usage

```rust
use echolens_perception::{capture, Scope};

let result = capture(Scope::Window)?;   // Windows only
println!("{}", result.xml);             // feed inside <screen_context>
```

## Develop

```bash
cargo build                       # compiles everywhere (capture is a no-op off-Windows)
cargo test                        # builder unit tests (cross-platform)
cargo run --example dump -- window   # live smoke test (Windows only)
```

## Design notes (borrowed in spirit, not code, from Sylinko/Everywhere, BSL-1.1)

- **Token budget, not node count** — one rich text node can be worth 50 empty
  panels; budgeting by tokens is what actually fits the LLM context window.
- **Best-first scoring** — four directions (parent / prev-sibling / next-sibling /
  child), dual distance (global from anchor, local from origin); sibling
  directions deliberately **don't** multiply by type weight (a weak sibling must
  not truncate the sibling scan).
- **Capture blind spots handled** — password fields are blanked (never sent to
  the LLM), ControlView walker drops decorative nodes, ids are per-capture
  (UIA RuntimeId is reused after element destruction and isn't stable).

The proven capture recipe (`build_updated_cache(Subtree)` + local recursion)
comes from the spike in [`../spike/`](../spike/).

## License

AGPL-3.0-or-later. Depends only on `uiautomation` (Apache-2.0) on Windows.
