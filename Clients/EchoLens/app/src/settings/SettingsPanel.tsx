import { useState, type KeyboardEvent } from 'react'
import { useSettings } from '@/stores/settings'

interface Props {
  onClose(): void
}

/**
 * In-overlay settings panel: summon hotkey, default scope, optional model.
 * Kept inside the overlay (no separate window) for MVP simplicity.
 */
export function SettingsPanel({ onClose }: Props) {
  const settings = useSettings()
  const [capturing, setCapturing] = useState(false)
  const [hotkeyError, setHotkeyError] = useState<string | null>(null)
  const [model, setModel] = useState(settings.model)

  // Capture a key chord into a Tauri accelerator string (e.g. "Ctrl+Shift+Space").
  function onHotkeyKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!capturing) return
    e.preventDefault()
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.shiftKey) parts.push('Shift')
    if (e.altKey) parts.push('Alt')
    if (e.metaKey) parts.push('Super')
    const key = normalizeKey(e.key)
    // Ignore lone modifier presses; wait for a real key.
    if (key && !['Ctrl', 'Shift', 'Alt', 'Super'].includes(key)) {
      parts.push(key)
      const accel = parts.join('+')
      setCapturing(false)
      applyHotkey(accel)
    }
  }

  async function applyHotkey(accel: string) {
    const err = await settings.setHotkey(accel)
    setHotkeyError(err)
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="mb-4 flex items-center">
        <h2 className="text-sm font-semibold text-white">Settings</h2>
        <div className="flex-1" />
        <button className="text-xs text-white/50 hover:text-white" onClick={onClose}>
          Close
        </button>
      </div>

      {/* Hotkey */}
      <Field label="Summon hotkey" hint="The global shortcut that opens EchoLens.">
        <input
          readOnly
          value={capturing ? 'Press a key combo…' : settings.hotkey}
          onKeyDown={onHotkeyKeyDown}
          onClick={() => {
            setCapturing(true)
            setHotkeyError(null)
          }}
          className="w-56 cursor-pointer rounded bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-accent"
        />
        {hotkeyError && <p className="mt-1 text-xs text-red-300">{hotkeyError}</p>}
      </Field>

      {/* Default scope */}
      <Field label="Default scope" hint="What EchoLens perceives when summoned.">
        <div className="flex gap-1">
          {['focus', 'window', 'screen'].map((s) => (
            <button
              key={s}
              onClick={() => settings.setScope(s)}
              className={`rounded px-3 py-1 text-xs capitalize ${
                settings.scope === s
                  ? 'bg-accent/90 text-black'
                  : 'bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      {/* Model override */}
      <Field label="Model (optional)" hint="Leave blank to use the gateway default.">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => settings.setModel(model)}
          placeholder="e.g. claude-sonnet-4-6"
          className="w-56 rounded bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-accent"
        />
      </Field>

      <p className="mt-6 text-xs text-white/30">
        EchoLens runs locally and only sends a question + the screen context you
        approve to your EchoAI gateway.
      </p>
    </div>
  )
}

function Field(props: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <label className="mb-1 block text-xs font-medium text-white/80">{props.label}</label>
      <p className="mb-2 text-xs text-white/40">{props.hint}</p>
      {props.children}
    </div>
  )
}

function normalizeKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}
