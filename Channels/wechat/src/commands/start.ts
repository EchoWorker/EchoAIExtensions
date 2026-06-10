/**
 * `echo-wechat start` — connect to the EchoAI gateway and run the channel.
 *
 * Spawned headless by EchoAI's ChannelSupervisor, which injects:
 *   ECHOAI_GATEWAY_URL / ECHOAI_GATEWAY_TOKEN / ECHOAI_PLUGIN_NAME
 *
 * Reads the WeChat bot token saved by `login`, opens the gateway connection,
 * validates --model (if given) against `model.list` from the gateway,
 * prints a startup banner, and runs the long-poll orchestrator until stopped.
 */

import fs from "node:fs";
import path from "node:path";

import {
  listWeixinAccountIds,
  resolveWeixinAccount,
} from "../protocol/auth/accounts.js";
import { logger } from "../protocol/util/logger.js";
import { GatewayClient } from "../gateway-client.js";
import { Orchestrator } from "../orchestrator.js";

export type StartOptions = {
  /** EchoAI session_key for this bot. Defaults to `wechat:<accountId>`. */
  sessionKey?: string;
  /** EchoAI model id; validated against `model.list` at startup. */
  model?: string;
  /** Absolute workspace path; validated to exist + isDir at startup. */
  workspace?: string;
};

export async function runStart(opts: StartOptions = {}): Promise<void> {
  const gatewayUrl = process.env.ECHOAI_GATEWAY_URL?.trim();
  const gatewayToken = process.env.ECHOAI_GATEWAY_TOKEN?.trim() ?? "";
  const pluginName = process.env.ECHOAI_PLUGIN_NAME?.trim() || "channel.wechat";

  if (!gatewayUrl) {
    process.stderr.write("echo-wechat start: ECHOAI_GATEWAY_URL not set — cannot connect to gateway.\n");
    process.stderr.write("(This command is normally spawned by EchoAI, which injects the gateway env.)\n");
    process.exitCode = 1;
    return;
  }

  // Resolve the logged-in WeChat account.
  const accountIds = listWeixinAccountIds();
  if (accountIds.length === 0) {
    process.stderr.write("echo-wechat start: no logged-in WeChat account. Run `echo-wechat login` first.\n");
    process.exitCode = 1;
    return;
  }
  // Use the most recently registered account.
  const accountId = accountIds[accountIds.length - 1];
  const account = resolveWeixinAccount(accountId);
  if (!account.configured || !account.token) {
    process.stderr.write(`echo-wechat start: account ${accountId} has no token. Run \`echo-wechat login\` again.\n`);
    process.exitCode = 1;
    return;
  }

  // Validate --workspace (cheap, local — do it before opening the gateway).
  const workspace = opts.workspace?.trim();
  if (workspace) {
    if (!path.isAbsolute(workspace)) {
      process.stderr.write(`echo-wechat start: --workspace must be an absolute path (got: ${workspace}).\n`);
      process.exitCode = 1;
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(workspace);
    } catch (e) {
      process.stderr.write(`echo-wechat start: --workspace does not exist: ${workspace}\n  (${String(e)})\n`);
      process.exitCode = 1;
      return;
    }
    if (!stat.isDirectory()) {
      process.stderr.write(`echo-wechat start: --workspace is not a directory: ${workspace}\n`);
      process.exitCode = 1;
      return;
    }
  }

  // session_key: a WeChat bot account only ever talks to one fixed peer, so
  // we use a single process-lifetime session_key. Default = wechat:<accountId>.
  const sessionKey = opts.sessionKey?.trim() || `wechat:${account.accountId}`;
  const model = opts.model?.trim() || "";

  // Build the gateway client first; we need it before validating --model.
  let orchestrator: Orchestrator;
  const gateway = new GatewayClient({
    url: gatewayUrl,
    token: gatewayToken,
    pluginName,
    onReply: (reply) => orchestrator.onGatewayReply(reply),
  });

  // Start the gateway connection (auto-reconnects). Then validate --model
  // before we hand off to the long-poll loop — better to exit-1 here than
  // burn a real WeChat message on a typo'd model id.
  void gateway.start();

  if (model) {
    try {
      await gateway.waitConnected(15_000);
    } catch (e) {
      process.stderr.write(`echo-wechat start: gateway not reachable (${String(e)})\n`);
      gateway.close();
      process.exitCode = 1;
      return;
    }
    try {
      const { models, default_model } = await gateway.listModels();
      const ids = models.map((m) => m.id);
      if (!ids.includes(model)) {
        process.stderr.write(`\n❌ model "${model}" is not available.\n\n`);
        if (ids.length > 0) {
          process.stderr.write("Available models:\n");
          for (const id of [...ids].sort()) {
            process.stderr.write(`  - ${id}\n`);
          }
        } else {
          process.stderr.write("(gateway returned no models)\n");
        }
        if (default_model) {
          process.stderr.write(`\nDefault model: ${default_model}\n`);
        }
        process.stderr.write("\nPass --model <one of the above> or omit --model to use the session/default.\n");
        gateway.close();
        process.exitCode = 1;
        return;
      }
    } catch (e) {
      // RPC failure ≠ wrong model — don't block startup. EchoAI will surface
      // the real error on the first chat.completions call if it matters.
      logger.warn(`start: model.list failed, skipping --model validation (${String(e)})`);
    }
  }

  // ── Startup banner ────────────────────────────────────────────────
  const lines = [
    `echo-wechat: account=${account.accountId}`,
    `  session: ${sessionKey}`,
    `  workspace: ${workspace || "(none, agent will use EchoAI default cwd)"}`,
    `  model: ${model ? `${model} ✓` : "(session default)"}`,
    `  gateway: ${gatewayUrl}`,
    `  plugin: ${pluginName}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);

  orchestrator = new Orchestrator({
    accountId: account.accountId,
    baseUrl: account.baseUrl,
    cdnBaseUrl: account.cdnBaseUrl,
    token: account.token,
    gateway,
    sessionKey,
    defaultModel: model || undefined,
    defaultWorkspace: workspace || undefined,
  });

  // Graceful shutdown.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`start: received ${signal}, shutting down`);
    try {
      await orchestrator.stop();
    } catch {
      // best-effort
    }
    gateway.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Long-poll loop.
  await orchestrator.start();
}
