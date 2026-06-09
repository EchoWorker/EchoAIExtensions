#!/usr/bin/env node
/**
 * echo-wechat — WeChat channel for EchoAI.
 *
 * Subcommands:
 *   login   Interactive QR login (run in a terminal). Saves the bot token.
 *   start   Connect to the EchoAI gateway and run. Spawned headless by EchoAI.
 *
 * Run with no subcommand → prints help.
 */

import { runLogin } from "./commands/login.js";
import { runStart } from "./commands/start.js";

function printHelp(): void {
  process.stdout.write(
    [
      "echo-wechat — WeChat channel for EchoAI",
      "",
      "Usage:",
      "  echo-wechat login    Interactive QR login (scan in a terminal); saves the bot token.",
      "  echo-wechat start    Connect to the EchoAI gateway and run (spawned by EchoAI).",
      "",
      "Env (read by `start`, injected by EchoAI):",
      "  ECHOAI_GATEWAY_URL    gateway WebSocket url",
      "  ECHOAI_GATEWAY_TOKEN  gateway auth token",
      "  ECHOAI_PLUGIN_NAME    plugin name to register with",
      "",
      "Optional env:",
      "  ECHO_WECHAT_STATE_DIR   override state dir (default ~/.echoai/channels/wechat)",
      "  ECHO_WECHAT_SESSION_KEY  session key template, e.g. 'wechat:{from_user}' (default: per-peer)",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "login":
      await runLogin();
      break;
    case "start":
      await runStart();
      break;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printHelp();
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n`);
      printHelp();
      process.exitCode = 2;
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
