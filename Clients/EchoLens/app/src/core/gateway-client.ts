/**
 * EchoLens gateway client — a purpose-built, minimal JSON-RPC-over-WebSocket
 * client for the EchoAI gateway.
 *
 * It speaks the SAME wire protocol as EchoWork's `EchoBotClient`, but implements
 * only what EchoLens needs (connect → auth → plugin.connect → chat.completions →
 * streamed `chat.event`). We deliberately do NOT reuse EchoWork's 770-line client
 * to avoid pulling in its skills/channels/history/session-tab coupling.
 *
 * Wire protocol:
 *   Request:      {"jsonrpc":"2.0","method":"...","params":{...},"id":N}
 *   Response:     {"jsonrpc":"2.0","result":{...},"id":N}
 *   Notification: {"jsonrpc":"2.0","method":"chat.event","params":{...}}
 */

export interface GatewayCredentials {
  url: string
  token: string
}

export interface AskCallbacks {
  /** A chunk of streamed assistant text (append to the current answer). */
  onText(delta: string): void
  /** The turn finished (status: "done" | "cancelled" | "error"). */
  onEnd(status: string): void
  /** An error was raised mid-turn. */
  onError(message: string): void
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer: number }

const REQUEST_TIMEOUT = 30_000
const PLUGIN_NAME = 'echolens'

export class GatewayClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private connected = false

  /** Active turns keyed by turn_id → callbacks (for streaming dispatch). */
  private turns = new Map<string, AskCallbacks>()
  /** Most recent turn id (so cancel() works without the caller tracking it). */
  private lastTurnId: string | null = null

  get isConnected(): boolean {
    return this.connected
  }

  /** Connect, authenticate, and register as a client plugin. */
  async connect(creds: GatewayCredentials): Promise<void> {
    await this.openSocket(creds.url)
    await this.rpc('auth', { token: creds.token })
    await this.rpc('plugin.connect', {
      plugin_name: PLUGIN_NAME,
      plugin_type: 'client',
      workspace: '',
    })
    this.connected = true
  }

  private openSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url)
        this.ws = ws
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('failed to connect to EchoAI gateway'))
        ws.onclose = () => {
          this.connected = false
          this.failAllPending(new Error('gateway connection closed'))
        }
        ws.onmessage = (ev) => this.onMessage(ev.data as string)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /**
   * Send a question. Returns the turn id; text streams via `cb.onText`.
   * @param sessionKey stable per-conversation key (reused for follow-ups)
   * @param content    the full user message (already includes screen_context)
   */
  async ask(
    sessionKey: string,
    content: string,
    cb: AskCallbacks,
    opts?: { model?: string },
  ): Promise<string> {
    const params: Record<string, unknown> = {
      session_key: sessionKey,
      content,
      plugin_name: PLUGIN_NAME,
    }
    if (opts?.model) params.model = opts.model

    const result = (await this.rpc('chat.completions', params)) as {
      session_key: string
      turn_id: string
    }
    this.turns.set(result.turn_id, cb)
    this.lastTurnId = result.turn_id
    return result.turn_id
  }

  /** Cancel the most recent (or a specific) turn. */
  cancel(turnId?: string): void {
    const id = turnId ?? this.lastTurnId
    if (id && this.connected) {
      this.rpc('chat.cancel', { turn_id: id }).catch(() => {})
    }
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('gateway not connected'))
        return
      }
      const id = this.nextId++
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request timed out: ${method}`))
      }, REQUEST_TIMEOUT)
      this.pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
    })
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // Notification (chat.event stream).
    if (msg.method === 'chat.event' && msg.params) {
      this.onChatEvent(msg.params as Record<string, unknown>)
      return
    }

    // RPC response.
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) {
        const err = msg.error as { message?: string }
        p.reject(new Error(err.message ?? 'gateway error'))
      } else {
        p.resolve(msg.result)
      }
    }
  }

  /**
   * Dispatch a streamed chat.event. v0.2 protocol uses (type, event) pairs.
   * EchoLens only cares about streamed text, turn end, and errors.
   */
  private onChatEvent(params: Record<string, unknown>): void {
    const type = params.type as string | undefined
    const event = params.event as string | undefined
    const turnId = params.turn_id as string | undefined
    const cb = turnId ? this.turns.get(turnId) : undefined
    if (!cb) return

    if ((type === 'token' || type === 'text') && event === 'append') {
      const delta = (params.content ?? params.delta ?? '') as string
      if (delta) cb.onText(delta)
    } else if (type === 'error' && event === 'raise') {
      const message = (params.message ?? params.content ?? 'unknown error') as string
      cb.onError(message)
    } else if (type === 'turn' && event === 'end') {
      const status = (params.status ?? 'done') as string
      cb.onEnd(status)
      if (turnId) this.turns.delete(turnId)
    }
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}
