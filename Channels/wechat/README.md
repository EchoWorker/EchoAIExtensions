# echo-wechat — WeChat channel for EchoAI

Connects a personal WeChat account to an EchoAI agent. You scan a QR code once to
log in; after that, messages your WeChat receives are forwarded to your EchoAI
agent and the agent's replies are sent back — text **and** images/files.

It is a **channel** in EchoAI's channel system: a standalone process that EchoAI's
gateway spawns and supervises. See `../../../EchoWork/docs/CHANNELS.md`.

## How it works

```
WeChat (iLink)  ◄──protocol/──►  echo-wechat  ◄──gateway-client──►  EchoAI gateway  ◄─►  Agent
```

- **`src/protocol/`** — the WeChat iLink protocol layer (long-poll, send, QR login,
  CDN media, AES). Vendored from `@tencent-weixin/openclaw-weixin` (MIT) with the
  openclaw host dependency removed. See `NOTICE.md`.
- **`src/gateway-client.ts`** — talks to the EchoAI gateway (`plugin.connect` as a
  channel → `chat.completions` → consume `chat.event` stream). *(W3)*
- **`src/orchestrator.ts`** — glue: WeChat message in → ask the agent → reply out;
  per-conversation sessions; media. *(W4–W5)*
- **`src/cli.ts`** — `login` / `start` subcommands. *(W2/W4)*

## Usage

### 1. Install & build

```bash
cd EchoAIExtensions/Channels/wechat
npm install
npm run build
```

### 2. Log in (one-time, interactive — needs a terminal to scan)

```bash
npm run login          # or: node dist/cli.js login
```

Scan the QR code printed in the terminal with the WeChat account you want to use as
the bot. The login token is saved under `~/.echoai/channels/wechat/`.

> ⚠️ This uses the iLink protocol (an unofficial automation interface). **Use a
> secondary/burner WeChat account** — automation carries a ban risk.

### 3. Register as an EchoAI channel

In EchoWork's 📡 Channels panel → **Add channel**:

| field | value |
|-------|-------|
| name | `WeChat` |
| command | `node` |
| args | `["<abs-path>/EchoAIExtensions/Channels/wechat/dist/cli.js", "start"]` |
| enabled | ✓ |

Then **Start**. EchoAI spawns `echo-wechat start`, which reads its gateway URL/token
from the injected env (`ECHOAI_GATEWAY_URL` / `ECHOAI_GATEWAY_TOKEN` /
`ECHOAI_PLUGIN_NAME`), connects, and goes ● online.

## State / files

Everything lives under `~/.echoai/channels/wechat/` (override with
`ECHO_WECHAT_STATE_DIR`):

```
accounts-index/accounts.json          # registered account ids
accounts-index/accounts/<id>.json     # per-account token (chmod 600)
accounts-index/accounts/<id>.sync.json # getUpdates cursor
logs/wechat-YYYY-MM-DD.log
```

## Status

- [x] **W1** — scaffold + protocol layer vendored & de-openclaw'd (typechecks clean)
- [ ] **W2** — `login` subcommand (terminal QR)
- [ ] **W3** — `gateway-client.ts` (EchoAI protocol)
- [ ] **W4** — `orchestrator.ts` + `start` subcommand
- [ ] **W5** — media (inbound attachments + outbound files)
- [ ] **W6** — end-to-end

## License

This package: MIT. Vendored protocol layer: MIT (see `NOTICE.md`).
