import { EASING_OPTIONS } from '@/engine/easing'
import type { EasingType } from '@/types'

interface Props {
  easing: EasingType
  customBezier?: [number, number, number, number]
  onChange: (easing: EasingType, customBezier?: [number, number, number, number]) => void
}

export function EasingPicker({ easing, customBezier, onChange }: Props) {
  const bezier = customBezier ?? [0.42, 0, 0.58, 1]

  return (
    <div className="flex flex-col gap-2">
      <select
        className="bg-studio-panel2 border border-studio-border rounded-md text-sm px-2 py-1"
        value={easing}
        onChange={(e) => onChange(e.target.value as EasingType, customBezier)}
      >
        {EASING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {easing === 'bezier' && (
        <div className="grid grid-cols-4 gap-1">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((label, i) => (
            <label key={label} className="flex flex-col text-[10px] text-studio-muted">
              {label}
              <input
                type="number"
                step={0.05}
                className="bg-studio-panel2 border border-studio-border rounded px-1 py-0.5 text-xs w-full"
                value={bezier[i]}
                onChange={(e) => {
                  const next = [...bezier] as [number, number, number, number]
                  next[i] = Number(e.target.value)
                  onChange('bezier', next)
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
