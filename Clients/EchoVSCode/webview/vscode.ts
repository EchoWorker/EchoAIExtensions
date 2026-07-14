/**
 * vscode.ts — Typed wrapper around acquireVsCodeApi().
 */

import type { HostMessage, WebviewMessage } from '../shared/bridge'

interface VsCodeApi {
  postMessage(msg: WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

// acquireVsCodeApi can only be called once
let api: VsCodeApi | undefined

export function getVsCodeApi(): VsCodeApi {
  if (!api) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api = (window as any).acquireVsCodeApi()
  }
  return api!
}

/** Post a message to the extension host. */
export function postToHost(msg: WebviewMessage): void {
  getVsCodeApi().postMessage(msg)
}
