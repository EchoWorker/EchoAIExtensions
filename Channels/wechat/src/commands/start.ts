/**
 * `echo-wechat start` — connect to the EchoAI gateway and run the channel.
 *
 * Spawned headless by EchoAI's ChannelSupervisor, which injects:
 *   ECHOAI_GATEWAY_URL / ECHOAI_GATEWAY_TOKEN / ECHOAI_PLUGIN_NAME
 *
 * Reads the WeChat bot token saved by `login`, opens the gateway connection,
 * and runs the long-poll orchestrator until the process is stopped.
 */

import {
  listWeixinAccountIds,
  resolveWeixinAccount,
} from "../protocol/auth/accounts.js";
import { logger } from "../protocol/util/logger.js";
import { GatewayClient } from "../gateway-client.js";
import { Orchestrator } from "../orchestrator.js";

export async function runStart(): Promise<void> {
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

  logger.info(`start: account=${accountId} gateway=${gatewayUrl} plugin=${pluginName}`);

  const sessionKeyTemplate = process.env.ECHO_WECHAT_SESSION_KEY?.trim();

  // Build the gateway client + orchestrator and cross-wire them.
  let orchestrator: Orchestrator;
  const gateway = new GatewayClient({
    url: gatewayUrl,
    token: gatewayToken,
    pluginName,
    onReply: (reply) => orchestrator.onGatewayReply(reply),
  });

  orchestrator = new Orchestrator({
    accountId: account.accountId,
    baseUrl: account.baseUrl,
    cdnBaseUrl: account.cdnBaseUrl,
    token: account.token,
    gateway,
    sessionKeyTemplate,
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

  // Start the gateway connection (auto-reconnects) and the WeChat long-poll loop.
  void gateway.start();
  await orchestrator.start();
}
