/**
 * gateway-client.ts — EchoAI gateway protocol layer.
 *
 * Talks to the EchoAI gateway over JSON-RPC/WebSocket:
 *   - auth + plugin.connect{plugin_type:"channel"}
 *   - chat.completions to start a turn for an inbound message
 *   - chat.enqueue (with steer_id) to inject into an in-flight turn
 *   - consumes the chat.event stream, accumulates assistant text per session,
 *     and emits a single reply when the turn ends
 *   - handles plugin.message (agent-initiated sends)
 *
 * Wire format verified against EchoAI:
 *   - every chat.event notification carries flattened {..., turn_id, session_key}
 *     (dispatch.rs injects them)
 *   - token/append → delta in `content`; carries `subagent_task_id` when from a
 *     subagent (we skip those — internal chatter shouldn't reach the platform)
 *   - turn/end → {type:"turn", event:"end", turn_id, status}
 *
 * Mirrors the reference EchoAI/channels/echo-channel/echo-channel.mjs.
 */

import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

import { logger } from "./protocol/util/logger.js";

export type OutboundAttachment = {
  /** absolute local file path to send */
  path: string;
};

/** A reply ready to deliver to the platform (WeChat). */
export type GatewayReply = {
  sessionKey: string;
  text: string;
  /** Absolute local file paths to deliver as media (from agent send_message). */
  media?: string[];
};

export type GatewayClientOptions = {
  url: string;
  token?: string;
  pluginName: string;
  /** Called when an assistant turn completes with accumulated text. */
  onReply: (reply: GatewayReply) => void | Promise<void>;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

const RPC_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** session_key → accumulated assistant text for the in-flight turn. */
  private readonly turnText = new Map<string, string>();
  private connected = false;
  private closing = false;
  private reconnectAttempts = 0;

  constructor(private readonly opts: GatewayClientOptions) {}

  /** Connect, auth, and register as a channel. Auto-reconnects until close(). */
  async start(): Promise<void> {
    await this.connectLoop();
  }

  close(): void {
    this.closing = true;
    this.ws?.close();
    this.ws = null;
  }

  /** Whether a turn is currently running for this session. */
  isTurnActive(sessionKey: string): boolean {
    return this.turnText.has(sessionKey);
  }

  // ── inbound → agent ─────────────────────────────────────────────────────

  /** Optional per-call overrides on chat.completions. */
  public submitOpts: {
    /** EchoAI model id; persisted to session if non-empty. */
    model?: string;
    /** Absolute workspace path; sets agent cwd. */
    workspace?: string;
  } = {};

  /**
   * Submit an inbound platform message. Starts a new turn, or steers the
   * running one if a turn is already active for this session.
   */
  async submit(sessionKey: string, content: string, attachments?: OutboundAttachment[]): Promise<void> {
    if (this.turnText.has(sessionKey)) {
      // A turn is running → steer it (C2: steer_id required).
      try {
        await this.rpc("chat.enqueue", {
          session_key: sessionKey,
          message: content,
          steer_id: randomUUID(),
        });
        return;
      } catch (e) {
        logger.warn(`gateway: chat.enqueue failed, falling back to new turn: ${String(e)}`);
        // fall through to a fresh completion
      }
    }

    this.turnText.set(sessionKey, "");
    try {
      // headless=true: this channel has no UI to answer tool-approval / plan-
      // review prompts, so let EchoCode auto-approve them (synthetic_auto_answer).
      const params: Record<string, unknown> = {
        session_key: sessionKey,
        content,
        headless: true,
      };
      if (this.submitOpts.model) params.model = this.submitOpts.model;
      if (this.submitOpts.workspace) params.workspace = this.submitOpts.workspace;
      if (attachments && attachments.length > 0) {
        params.attachments = attachments.map((a) => a.path);
      }
      await this.rpc("chat.completions", params);
    } catch (e) {
      this.turnText.delete(sessionKey);
      throw e;
    }
  }

  /** List EchoAI's available models + default. Used for --model validation at startup. */
  async listModels(): Promise<{ models: Array<{ id: string }>; default_model: string }> {
    const result = (await this.rpc("model.list", {})) as
      | { models?: Array<{ id?: string }>; default_model?: string }
      | undefined;
    const models = (result?.models ?? [])
      .map((m) => ({ id: String(m.id ?? "") }))
      .filter((m) => m.id !== "");
    return { models, default_model: result?.default_model ?? "" };
  }

  /** Resolve when plugin.connect has succeeded. Used to gate startup-time RPCs. */
  async waitConnected(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.connected) {
      if (this.closing) throw new Error("gateway: client closed before connection");
      if (Date.now() > deadline) throw new Error(`gateway: not connected after ${timeoutMs}ms`);
      await delay(50);
    }
  }

  // ── connection lifecycle ────────────────────────────────────────────────

  private async connectLoop(): Promise<void> {
    while (!this.closing) {
      try {
        await this.connectOnce();
        this.reconnectAttempts = 0;
        // connectOnce resolves only when the socket closes.
      } catch (e) {
        logger.warn(`gateway: connection error: ${String(e)}`);
      }
      if (this.closing) break;

      const backoff = Math.min(
        RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
        RECONNECT_CAP_MS,
      );
      this.reconnectAttempts++;
      logger.info(`gateway: reconnecting in ${backoff}ms (attempt ${this.reconnectAttempts})`);
      await delay(backoff);
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      let opened = false;

      ws.on("open", () => {
        opened = true;
        void this.onOpen().catch((e) => {
          logger.error(`gateway: handshake failed: ${String(e)}`);
          ws.close();
        });
      });

      ws.on("message", (data) => this.onMessage(data.toString()));

      ws.on("close", () => {
        this.connected = false;
        // Reject all pending RPCs so callers don't hang.
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error("gateway connection closed"));
        }
        this.pending.clear();
        // Drop in-flight turn accumulation (server will restart turns).
        this.turnText.clear();
        logger.info("gateway: connection closed");
        resolve();
      });

      ws.on("error", (err) => {
        logger.warn(`gateway: ws error: ${String(err)}`);
        if (!opened) reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private async onOpen(): Promise<void> {
    if (this.opts.token) {
      await this.rpc("auth", { token: this.opts.token });
    }
    // Note: headless is set per-turn on chat.completions (the only place it
    // actually drives synthetic_auto_answer in EchoAI's agent_loop). The
    // headless flag on plugin.connect doesn't influence chat path — so we
    // omit it here to avoid implying it does.
    await this.rpc("plugin.connect", {
      plugin_name: this.opts.pluginName,
      plugin_type: "channel",
      disable_questions: true,
    });
    this.connected = true;
    logger.info(`gateway: connected & registered as "${this.opts.pluginName}"`);
  }

  // ── message dispatch ────────────────────────────────────────────────────

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    // RPC response?
    const id = msg.id as number | undefined;
    if (id != null && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg.error) {
        const err = msg.error as { message?: string };
        p.reject(new Error(err.message ?? JSON.stringify(msg.error)));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // Server notification
    const method = msg.method as string | undefined;
    const params = (msg.params as Record<string, unknown>) ?? {};
    if (method === "chat.event") {
      this.onChatEvent(params);
    } else if (method === "plugin.message") {
      void this.onPluginMessage(params);
    }
  }

  private onChatEvent(params: Record<string, unknown>): void {
    const type = params.type as string | undefined;
    const event = params.event as string | undefined;
    const sessionKey = params.session_key as string | undefined;
    if (!sessionKey) return;

    // Skip subagent internal chatter — only the main agent's output goes out.
    if (params.subagent_task_id) return;

    if (type === "token" && event === "append") {
      const delta = (params.content as string | undefined) ?? "";
      this.turnText.set(sessionKey, (this.turnText.get(sessionKey) ?? "") + delta);
    } else if (type === "turn" && event === "end") {
      const text = (this.turnText.get(sessionKey) ?? "").trim();
      this.turnText.delete(sessionKey);
      if (text) {
        void Promise.resolve(this.opts.onReply({ sessionKey, text })).catch((e) =>
          logger.error(`gateway: onReply failed: ${String(e)}`),
        );
      }
    } else if (type === "error" && event === "raise") {
      const message = (params.message as string | undefined) ?? "unknown error";
      logger.warn(`gateway: turn error for ${sessionKey}: ${message}`);
      this.turnText.delete(sessionKey);
    }
  }

  /** Agent-initiated send (send_message tool) — deliver directly, with media. */
  private async onPluginMessage(params: Record<string, unknown>): Promise<void> {
    const sessionKey = (params.session_key as string | undefined) ?? "";
    const content = (params.content as string | undefined) ?? (params.text as string | undefined) ?? "";
    const mediaRaw = params.media as unknown;
    const media = Array.isArray(mediaRaw)
      ? mediaRaw.filter((m): m is string => typeof m === "string" && m.trim() !== "")
      : [];
    if (!sessionKey) return;
    if (!content && media.length === 0) return;
    await this.opts.onReply({ sessionKey, text: content, media: media.length ? media : undefined });
  }

  // ── JSON-RPC ────────────────────────────────────────────────────────────

  private rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`gateway: not connected (cannot ${method})`));
    }
    const id = this.nextId++;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`gateway: rpc ${method} timed out`));
        }
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
