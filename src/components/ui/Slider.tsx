import { useEffect, useRef, useState } from 'react'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onCommitStart?: () => void
  suffix?: string
}

const clampTo = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
/** Display rounding — mirrors the old read-out (2 decimals) so the typed field reads cleanly. */
const format = (v: number) => String(Math.round(v * 100) / 100)

/**
 * A labelled range slider paired with a numeric input, so every property can be adjusted quickly by
 * dragging OR typed exactly. The two stay in sync: dragging the slider updates the field, and typing
 * (or the field's arrow keys / spinners) updates the slider and preview live. Out-of-range typed
 * values are clamped for what's committed to the store (preview never breaks) while the field keeps
 * showing what you typed until it loses focus, then it reformats to the clamped value. Decimals are
 * allowed wherever the property's `step` is fractional (and typed decimals pass through regardless).
 */
export function Slider({ label, value, min, max, step = 1, onChange, onCommitStart, suffix = '' }: SliderProps) {
  const [text, setText] = useState(() => format(value))
  const [focused, setFocused] = useState(false)
  // One undo checkpoint per editing burst (matches the slider taking one on pointer-down).
  const committedRef = useRef(false)

  // Keep the field in sync with external changes (slider drag, canvas drag, undo, expression switch)
  // whenever the user isn't actively typing in it.
  useEffect(() => {
    if (!focused) setText(format(value))
  }, [value, focused])

  const emit = (n: number) => {
    if (!committedRef.current) {
      onCommitStart?.()
      committedRef.current = true
    }
    onChange(clampTo(n, min, max))
  }

  return (
    <label className="flex flex-col gap-1 select-none">
      <span className="flex items-center justify-between gap-2">
        <span className="studio-label">{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            className="w-16 bg-studio-panel2 border border-studio-border rounded px-1 py-0.5 text-xs font-mono text-right text-studio-text/90 tabular-nums focus:border-studio-accent outline-none"
            min={min}
            max={max}
            step={step}
            value={text}
            onFocus={() => {
              setFocused(true)
              committedRef.current = false
            }}
            onChange={(e) => {
              setText(e.target.value)
              const n = Number(e.target.value)
              // Ignore empty/partial input ("", "-", "1e") — don't push NaN/0 into the preview.
              if (e.target.value.trim() !== '' && Number.isFinite(n)) emit(n)
            }}
            onBlur={() => {
              setFocused(false)
              committedRef.current = false
              const n = Number(text)
              const final = text.trim() !== '' && Number.isFinite(n) ? clampTo(n, min, max) : value
              onChange(final) // guarantee the store holds a valid, clamped number
              setText(format(final))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          {suffix && <span className="text-xs text-studio-muted w-4 shrink-0">{suffix}</span>}
        </span>
      </span>
      <input
        type="range"
        className="studio-input-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onCommitStart}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
