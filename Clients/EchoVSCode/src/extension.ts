/**
 * extension.ts — EchoAI VS Code Extension entry point.
 *
 * Activates on startup, creates GatewayClient + ConnectionManager + ChatViewProvider,
 * and wires them together. Persists per-workspace open-tab state via workspaceState.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { GatewayClient } from './gateway-client'
import { ConnectionManager } from './connection-manager'
import { ChatViewProvider } from './chat-view-provider'

const OPEN_TABS_KEY = 'echoai.openTabKeys'
const ACTIVE_TAB_KEY = 'echoai.activeTabKey'

let connectionManager: ConnectionManager | undefined

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('EchoAI')
  // Mirror logs to disk so we can read them after window reload.
  const logFile = path.join(context.logUri.fsPath, 'echoai.log')
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true }) } catch { /* */ }
  const log = (msg: string, ...args: unknown[]) => {
    const line = `[${new Date().toISOString()}] ${msg} ${args.map(String).join(' ')}`
    channel.appendLine(line)
    try { fs.appendFileSync(logFile, line + '\n') } catch { /* */ }
  }
  log(`Log file: ${logFile}`)

  log('EchoAI extension activating...')

  // Per-workspace persisted tab state
  const getRestoredTabs = (): { openTabKeys: string[]; activeTabKey: string | null } => ({
    openTabKeys: context.workspaceState.get<string[]>(OPEN_TABS_KEY, []),
    activeTabKey: context.workspaceState.get<string | null>(ACTIVE_TAB_KEY, null),
  })

  const persistTabs = (openTabKeys: string[], activeTabKey: string | null) => {
    context.workspaceState.update(OPEN_TABS_KEY, openTabKeys)
    context.workspaceState.update(ACTIVE_TAB_KEY, activeTabKey)
  }

  // Create gateway client
  const client = new GatewayClient(log)

  // Create view provider (will be resolved when sidebar is opened)
  const viewProvider = new ChatViewProvider(context.extensionUri, client, log, {
    getRestoredTabs,
    persistTabs,
  })

  // Create connection manager
  connectionManager = new ConnectionManager(client, {
    onStatusChange: (status) => {
      viewProvider.postMessage({ type: 'connection-status', status })
    },
    onError: (error) => {
      if (error) {
        viewProvider.postMessage({ type: 'connection-status', status: 'disconnected', error })
      }
    },
    onSessions: (sessions) => {
      // Filter by current workspace + emit restore hints
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      const filtered = workspacePath
        ? sessions.filter((s) => (s.workspace ?? '') === workspacePath)
        : sessions
      const { openTabKeys, activeTabKey } = getRestoredTabs()
      log(`[sessions] workspace=${workspacePath}; total=${sessions.length}; afterFilter=${filtered.length}; restoreTabs=${JSON.stringify(openTabKeys)}; restoreActive=${activeTabKey}`)
      viewProvider.postMessage({
        type: 'sessions',
        sessions: filtered,
        workspacePath,
        restoreTabKeys: openTabKeys,
        restoreActiveKey: activeTabKey,
      })
    },
    onModels: (models, defaultModel) => {
      viewProvider.postMessage({ type: 'models', models, defaultModel })
    },
    onChatEvent: (sessionKey, params) => {
      viewProvider.postMessage({ type: 'chat-event', sessionKey, params })
    },
    onReconnected: () => {
      viewProvider.resubscribeAll()
    },
  }, log)

  // Wire the circular reference
  viewProvider.setConnectionManager(connectionManager)

  // Register the webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      viewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  )

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('echoai.openChat', () => {
      vscode.commands.executeCommand('echoai.chatView.focus')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('echoai.newSession', () => {
      vscode.commands.executeCommand('echoai.chatView.focus')
      viewProvider.handleNewSession()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('echoai.sendSelection', () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const selection = editor.document.getText(editor.selection)
      if (!selection) return
      vscode.commands.executeCommand('echoai.chatView.focus')
      viewProvider.postMessage({
        type: 'chat-event',
        sessionKey: '__prefill__',
        params: { type: 'prefill', content: selection, file: editor.document.uri.fsPath },
      })
    }),
  )

  // Start connecting
  connectionManager.start().catch((err) => log('Start failed:', err))

  // Cleanup
  context.subscriptions.push({
    dispose: () => {
      connectionManager?.dispose()
    },
  })

  log('EchoAI extension activated.')
}

export function deactivate(): void {
  connectionManager?.dispose()
}
