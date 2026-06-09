/**
 * gateway-client.test.ts — protocol conformance test for GatewayClient.
 *
 * Spins a mock EchoAI gateway (hand-rolled RFC6455 WS server, no deps), then:
 *   - asserts the client sends auth + plugin.connect{plugin_type:"channel"}
 *   - on chat.completions, streams back token/append deltas then turn/end
 *   - asserts GatewayClient.onReply fires once with the accumulated text
 *   - asserts subagent_task_id deltas are NOT included
 *
 * Run: node --test dist/gateway-client.test.js   (after build)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { Socket } from "node:net";

import { GatewayClient } from "./gateway-client.js";

function acceptKey(key: string): string {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}

function decodeFrame(buf: Buffer): string {
  const len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) off = 4;
  else if (len === 127) off = 10;
  const mask = buf.subarray(off, off + 4);
  off += 4;
  const data = buf.subarray(off);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ mask[i % 4];
  return out.toString("utf8");
}

function encodeFrame(str: string): Buffer {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else {
    header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.concat([header, payload]);
}

type MockGateway = {
  server: Server;
  url: string;
  seen: string[];
  close: () => void;
};

async function startMockGateway(): Promise<MockGateway> {
  const seen: string[] = [];
  const server = createServer();

  server.on("upgrade", (req, socket: Socket) => {
    const key = req.headers["sec-websocket-key"] as string;
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    const send = (obj: unknown) => socket.write(encodeFrame(JSON.stringify(obj)));

    socket.on("data", (chunk: Buffer) => {
      let text: string;
      try {
        text = decodeFrame(chunk);
      } catch {
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      const method = msg.method as string;
      const id = msg.id as number;
      seen.push(method);

      if (method === "auth") {
        send({ jsonrpc: "2.0", id, result: { ok: true } });
      } else if (method === "plugin.connect") {
        const params = msg.params as Record<string, unknown>;
        assert.equal(params.plugin_type, "channel", "must register as channel");
        send({ jsonrpc: "2.0", id, result: { status: "connected" } });
      } else if (method === "chat.completions") {
        const params = msg.params as Record<string, unknown>;
        const sk = params.session_key as string;
        send({ jsonrpc: "2.0", id, result: { session_key: sk, turn_id: "t1" } });
        // Stream: a subagent delta (must be ignored) + two main deltas, then end.
        send({ jsonrpc: "2.0", method: "chat.event", params: { type: "token", event: "append", content: "SUBAGENT", session_key: sk, subagent_task_id: "bg_1" } });
        send({ jsonrpc: "2.0", method: "chat.event", params: { type: "token", event: "append", content: "Hello ", session_key: sk } });
        send({ jsonrpc: "2.0", method: "chat.event", params: { type: "token", event: "append", content: "world", session_key: sk } });
        send({ jsonrpc: "2.0", method: "chat.event", params: { type: "turn", event: "end", turn_id: "t1", status: "done", session_key: sk } });
      }
    });
  });

  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    server,
    url: `ws://127.0.0.1:${port}`,
    seen,
    close: () => server.close(),
  };
}

test("GatewayClient: connect, submit, accumulate deltas, flush on turn end", async () => {
  const gw = await startMockGateway();
  const replies: Array<{ sessionKey: string; text: string }> = [];

  const client = new GatewayClient({
    url: gw.url,
    token: "test-token",
    pluginName: "channel.wechat.test",
    onReply: (r) => {
      replies.push(r);
    },
  });

  void client.start();

  // Wait until registered (plugin.connect seen), then submit.
  await waitFor(() => gw.seen.includes("plugin.connect"), 3000);
  await client.submit("peer-1", "hi");

  await waitFor(() => replies.length > 0, 3000);

  assert.equal(replies.length, 1, "exactly one reply");
  assert.equal(replies[0].sessionKey, "peer-1");
  assert.equal(replies[0].text, "Hello world", "subagent delta excluded, main deltas joined");
  assert.ok(gw.seen.includes("auth"), "sent auth");
  assert.ok(gw.seen.includes("plugin.connect"), "sent plugin.connect");

  client.close();
  gw.close();
});

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor: timed out");
}
