/**
 * Bridge to the Rust perception commands + screen-context prompt assembly.
 */

import { invoke } from '@tauri-apps/api/core'

export interface CapturedContext {
  xml: string
  node_count: number
  omitted: number
  scope: string
  title: string
}

export interface GatewayCreds {
  url: string
  token: string
}

export interface Settings {
  hotkey: string
  scope: string
  model: string
}

/** Read the capture taken by the hotkey handler before the overlay was shown. */
export function getCachedPerception(): Promise<CapturedContext | null> {
  return invoke('get_cached_perception')
}

/** Re-capture for a new scope (when the user switches scope in the overlay). */
export function capturePerception(scope: string): Promise<CapturedContext> {
  return invoke('capture_perception', { scope })
}

export function hideOverlay(): Promise<void> {
  return invoke('hide_overlay')
}

export function readGatewayLock(): Promise<GatewayCreds> {
  return invoke('read_gateway_lock')
}

export function readSettings(): Promise<Settings> {
  return invoke('read_settings')
}

export function writeSettings(settings: Settings): Promise<void> {
  return invoke('write_settings', { settings })
}

export function setSummonHotkey(accelerator: string): Promise<void> {
  return invoke('set_summon_hotkey', { accelerator })
}

/**
 * Assemble the AI-facing user message: the (possibly user-edited) screen context
 * wrapped in `<screen_context>`, followed by the user's question.
 */
export function buildPrompt(ctx: CapturedContext, contextXml: string, question: string): string {
  const header =
    `<screen_context scope="${ctx.scope}" elements="${ctx.node_count}"` +
    ` omitted="${ctx.omitted}">`
  return `${header}\n${contextXml}\n</screen_context>\n\n${question}`
}
