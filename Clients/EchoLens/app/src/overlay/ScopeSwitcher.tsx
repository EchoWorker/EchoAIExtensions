const SCOPES: { id: string; label: string; hint: string }[] = [
  { id: 'focus', label: 'Focus', hint: 'Focused element + its neighborhood' },
  { id: 'window', label: 'Window', hint: 'The whole foreground window' },
  { id: 'screen', label: 'Screen', hint: 'Overview of all top-level windows' },
]

interface Props {
  scope: string
  onChange(scope: string): void
}

/** Segmented control for the three perception scopes. */
export function ScopeSwitcher({ scope, onChange }: Props) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-white/5 p-0.5">
      {SCOPES.map((s) => (
        <button
          key={s.id}
          title={s.hint}
          onClick={() => onChange(s.id)}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            scope === s.id
              ? 'bg-accent/90 text-black'
              : 'text-white/60 hover:text-white'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
