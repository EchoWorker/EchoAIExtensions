/**
 * chat-view-provider.ts — WebviewViewProvider for the EchoAI chat panel.
 *
 * Creates and manages the sidebar webview. Bridges messages between
 * the extension host (GatewayClient / ConnectionManager) and the
 * React webview UI.
 */

import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import type { GatewayClient } from './gateway-client'
import type { ConnectionManager } from './connection-manager'
import type { HostMessage, WebviewMessage } from './bridge'
import type { SessionInfo, Turn, Step } from './protocol'

export interface TabStateOptions {
  getRestoredTabs(): { openTabKeys: string[]; activeTabKey: string | null }
  persistTabs(openTabKeys: string[], activeTabKey: string | null): void
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'echoai.chatView'

  private view: vscode.WebviewView | undefined
  private pendingMessages: HostMessage[] = []
  private webviewReady = false

  /** Session keys that are currently open in tabs (for subscribe on reconnect). */
  private openedSessionKeys = new Set<string>()

  private _connectionManager: ConnectionManager | undefined
  private readonly tabState: TabStateOptions

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: GatewayClient,
    private readonly log: (msg: string, ...args: unknown[]) => void,
    tabState: TabStateOptions,
  ) {
    this.tabState = tabState
  }

  setConnectionManager(cm: ConnectionManager): void {
    this._connectionManager = cm
  }

  private get connectionManager(): ConnectionManager {
    if (!this._connectionManager) {
      throw new Error('ConnectionManager not initialized. Call setConnectionManager() first.')
    }
    return this._connectionManager
  }

  // ── WebviewViewProvider ─────────────────────────────────────────────────

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    }

    // Retain DOM when hidden
    webviewView.onDidChangeVisibility(() => {
      // nothing needed — retainContextWhenHidden handles it
    })

    webviewView.onDidDispose(() => {
      this.view = undefined
      this.webviewReady = false
    })

    // Listen for messages from webview
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      this.handleWebviewMessage(msg)
    })

    // Set HTML content
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview)

    // Flush any messages that arrived before webview was ready
    // (actual flush happens when webview sends 'ready')
  }

  // ── Post to webview ─────────────────────────────────────────────────────

  postMessage(msg: HostMessage): void {
    if (this.view && this.webviewReady) {
      this.view.webview.postMessage(msg)
    } else {
      this.pendingMessages.push(msg)
    }
  }

  // ── Handle webview messages ─────────────────────────────────────────────

  private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'ready':
          this.onWebviewReady()
          break

        case 'new-session':
          this.handleNewSession()
          break

        case 'send':
          await this.handleSend(msg)
          break

        case 'enqueue':
          await this.client.enqueueMessage(msg.sessionKey, msg.text, msg.steerId, msg.attachments)
          break

        case 'cancel':
          await this.client.cancelTurn(msg.sessionKey)
          break

        case 'switch-session':
          await this.handleSwitchSession(msg.sessionKey)
          break

        case 'subscribe-session':
          if (!this.openedSessionKeys.has(msg.sessionKey)) {
            this.openedSessionKeys.add(msg.sessionKey)
            await this.connectionManager.subscribeSession(msg.sessionKey)
          }
          break

        case 'close-session':
          this.openedSessionKeys.delete(msg.sessionKey)
          try { await this.connectionManager.unsubscribeSession(msg.sessionKey) } catch { /* ok */ }
          try { await this.client.closeSession(msg.sessionKey) } catch { /* ok */ }
          break

        case 'delete-session':
          this.openedSessionKeys.delete(msg.sessionKey)
          try { await this.connectionManager.unsubscribeSession(msg.sessionKey) } catch { /* ok */ }
          try { await this.client.deleteSession(msg.sessionKey) } catch { /* ok */ }
          break

        case 'rename-session':
          await this.client.renameSession(msg.sessionKey, msg.title)
          break

        case 'set-model':
          await this.client.setModel(msg.sessionKey, msg.model)
          break

        case 'answer-question':
          await this.client.answerQuestion(msg.sessionKey, msg.questionId, msg.answers)
          break

        case 'load-older':
          await this.handleLoadOlder(msg.sessionKey, msg.cursor)
          break

        case 'cancel-bg-task':
          await this.client.cancelBackgroundTask(msg.sessionKey, msg.taskId)
          break

        case 'persist-tabs':
          this.tabState.persistTabs(msg.openTabKeys, msg.activeTabKey)
          break
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      this.log('Webview message error:', errorMsg)
      this.postMessage({ type: 'error', message: errorMsg })
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────

  private onWebviewReady(): void {
    this.webviewReady = true
    // Flush pending messages
    this.log(`Webview ready. Flushing ${this.pendingMessages.length} pending messages.`)
    const toFlush = [...this.pendingMessages]
    this.pendingMessages = []
    for (const msg of toFlush) {
      this.view!.webview.postMessage(msg)
    }

    // Send workspace info
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
    this.view!.webview.postMessage({ type: 'workspace', path: workspacePath })
  }

  handleNewSession(): void {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
    const tempKey = `vsc_pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    this.openedSessionKeys.add(tempKey)
    this.postMessage({
      type: 'session-created',
      sessionKey: tempKey,
      title: 'New Chat',
      workspacePath,
    })
  }

  private async handleSend(msg: Extract<WebviewMessage, { type: 'send' }>): Promise<void> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
    const activeEditor = vscode.window.activeTextEditor
    const selectedFile = activeEditor?.document.uri.fsPath ?? ''

    const result = await this.client.chatCompletions(msg.sessionKey, msg.text, {
      media: msg.attachments,
      selectedFile,
      workspace: workspacePath,
      model: msg.model,
      modes: msg.modes,
      userMsgId: msg.userMsgId ?? `vsc_${Date.now()}`,
      slashCommand: msg.slashCommand,
      slashBlocks: msg.slashBlocks,
    })

    // Subscribe to the (possibly new) session
    if (!this.openedSessionKeys.has(result.session_key)) {
      this.openedSessionKeys.add(result.session_key)
      await this.connectionManager.subscribeSession(result.session_key)
    }

    // If session key changed (first message → server assigned real key)
    if (result.session_key !== msg.sessionKey) {
      this.openedSessionKeys.delete(msg.sessionKey)
      this.openedSessionKeys.add(result.session_key)
      const title = msg.text.slice(0, 30) || 'New Chat'
      this.postMessage({
        type: 'session-replaced',
        oldKey: msg.sessionKey,
        newKey: result.session_key,
        title,
      })
    }

    this.postMessage({
      type: 'turn-started',
      sessionKey: result.session_key,
      turnId: result.turn_id,
    })
  }

  private async handleSwitchSession(sessionKey: string): Promise<void> {
    if (!this.openedSessionKeys.has(sessionKey)) {
      this.openedSessionKeys.add(sessionKey)
      await this.connectionManager.subscribeSession(sessionKey)
    }
    await this.handleLoadOlder(sessionKey, '')
  }

  private async handleLoadOlder(sessionKey: string, cursor: string): Promise<void> {
    try {
      const result = await this.client.getHistory(sessionKey, cursor || undefined)
      this.postMessage({
        type: 'history',
        sessionKey,
        turns: result.turns,
        hasMore: result.has_more,
        cursor: result.next_cursor,
      })
    } catch (err) {
      this.log('Load history failed:', err)
    }
  }

  /** Re-subscribe all opened sessions (call after reconnect). */
  async resubscribeAll(): Promise<void> {
    const keys = Array.from(this.openedSessionKeys)
    if (keys.length > 0) {
      try {
        await this.client.subscribeSessions(keys)
      } catch (err) {
        this.log('Resubscribe failed:', err)
      }
    }
  }

  // ── HTML ────────────────────────────────────────────────────────────────

  private getHtmlForWebview(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    const distPath = distUri.fsPath

    // Try to read the built index.html and rewrite asset paths
    const indexPath = path.join(distPath, 'index.html')
    if (fs.existsSync(indexPath)) {
      // Generate a nonce for CSP
      const nonce = this.getNonce()

      // Build the script URI
      const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'assets', 'index.js'))

      // Inject CSP
      const csp = [
        `default-src 'none'`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
        `font-src ${webview.cspSource}`,
        `img-src ${webview.cspSource} data:`,
      ].join('; ')

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EchoAI</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
    }

    // Fallback: development mode (no built assets yet)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EchoAI</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .msg { text-align: center; opacity: 0.7; }
  </style>
</head>
<body>
  <div class="msg">
    <p>EchoAI Chat</p>
    <p style="font-size:12px;">Run <code>npm run build:webview</code> first.</p>
  </div>
</body>
</html>`
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
}
