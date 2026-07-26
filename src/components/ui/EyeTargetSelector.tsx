import { useStore } from '@/state/store'
import type { EyeSide } from '@/types'

const OPTIONS: { value: EyeSide; label: string }[] = [
  { value: 'both', label: 'Both Eyes' },
  { value: 'left', label: 'Left Eye' },
  { value: 'right', label: 'Right Eye' }
]

/** Shared Both/Left/Right segmented control — backed by the one store-level `eyeTarget`,
 * so it reads the same regardless of which panel (Controls, Colors) renders it. Switching
 * it never touches project data by itself; only a subsequent slider/color edit does. */
export function EyeTargetSelector({ disabled = false }: { disabled?: boolean }) {
  const eyeTarget = useStore((s) => s.eyeTarget)
  const setEyeTarget = useStore((s) => s.setEyeTarget)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="studio-label">Eye Target</span>
      <div
        className={`flex items-center bg-studio-panel2 rounded-md p-0.5 border border-studio-border ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            className={`studio-tab flex-1 ${eyeTarget === o.value ? 'studio-tab-active' : ''}`}
            onClick={() => setEyeTarget(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {!disabled && eyeTarget !== 'both' && (
        <p className="text-[11px] text-studio-warn leading-snug">
          Editing the {eyeTarget} eye only — changes here won't affect the other eye.
        </p>
      )}
    </div>
  )
}
