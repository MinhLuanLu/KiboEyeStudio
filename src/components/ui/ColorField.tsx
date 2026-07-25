import { useEffect, useState } from 'react'

interface ColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  onCommitStart?: () => void
}

export function ColorField({ label, value, onChange, onCommitStart }: ColorFieldProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  const commitDraft = () => {
    if (/^#[0-9a-fA-F]{6}$/.test(draft)) onChange(draft)
    else setDraft(value)
  }

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="studio-label">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="color"
          className="w-7 h-7 rounded-md border border-studio-border bg-transparent cursor-pointer p-0"
          value={value}
          onPointerDown={onCommitStart}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className="w-20 bg-studio-panel2 border border-studio-border rounded px-1.5 py-1 text-xs font-mono uppercase"
          value={draft}
          onFocus={onCommitStart}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </span>
    </label>
  )
}
