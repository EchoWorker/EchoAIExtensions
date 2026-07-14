# EchoLens — app (Tauri desktop shell)

The desktop application for EchoLens: press a global hotkey → it perceives your
foreground window → a translucent overlay appears → ask a question → the answer
streams back from your EchoAI gateway.

This is **M2 + M3 + M4** built on top of the **M1** perception core
(`../echolens-perception`).

## Architecture

```
┌─────────────────────────── Tauri (Rust) ───────────────────────────┐
│  hotkey  ──capture(scope)──►  echolens-perception  ──►  cached ctx  │
│    │                                                          │     │
│    └─ (1) capture FIRST  ─► (2) uncloak overlay ─► (3) emit ──┘     │
│  tray · single-instance · DWM cloak (cloak.rs)                      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ invoke / events
┌──────────────────────────────▼─────────────────── Frontend (React) ┐
│  SpotlightOverlay  ─►  gateway-client (WS/JSON-RPC)  ─►  EchoAI     │
│    ├ ScopeSwitcher   ├ PerceptionPreview (privacy)                  │
│    ├ InputBar        ├ AnswerCard (streaming markdown)              │
│    └ SettingsPanel (hotkey / scope / model)                        │
└────────────────────────────────────────────────────────────────────┘
```

### Key design decisions
- **Capture before show** (`hotkey.rs`): the foreground window is captured
  *before* the overlay appears, so EchoLens perceives the user's app — never
  itself. This is the single most important timing rule.
- **DWM cloak, not show/hide** (`cloak.rs`): the overlay is created once and
  cloaked/uncloaked for instant, animation-free, focus-stable summon.
- **Purpose-built gateway client** (`src/core/gateway-client.ts`, ~190 lines):
  speaks the same wire protocol as EchoWork's `EchoBotClient` but implements
  only what EchoLens needs (auth → plugin.connect → chat.completions → stream),
  with zero coupling to EchoWork's skills/channels/history modules.
- **Privacy preview** (`PerceptionPreview.tsx`): the exact screen context is
  shown — and editable — before it's sent to the AI. Password fields are already
  blanked at the capture layer.

## Develop

Requires the EchoAI gateway running (start EchoWork once; it writes
`~/.echoai/gateway.lock`).

```bash
pnpm install
pnpm tauri dev        # run the app (hotkey: Ctrl+Shift+Space)
pnpm build            # frontend only (tsc + vite)
pnpm tauri build      # release installer (NSIS) in src-tauri/target/release/bundle
```

### Headless gateway probe
Verifies the AI path (auth → plugin.connect → chat.completions → streamed
answer) without the GUI, against the live gateway:

```bash
node scripts/gateway-probe.mjs
```

## Usage

1. Launch EchoLens (tray icon appears).
2. Switch to any app, press **Ctrl+Shift+Space**.
3. The overlay appears with a summary of what was perceived. Optionally expand
   **Screen context** to see/edit exactly what will be sent.
4. Type a question, Enter. The answer streams in. **Esc** dismisses.
5. Tray: left-click toggles the overlay, double-click opens settings.

## Status

| Milestone | Scope | Status |
|-----------|-------|--------|
| M1 | Perception core | ✅ |
| M2 | Hotkey + tray + overlay + cloak | ✅ |
| M3 | Gateway client + streaming answers | ✅ |
| M4 | Settings + scope switch + privacy preview | ✅ |
