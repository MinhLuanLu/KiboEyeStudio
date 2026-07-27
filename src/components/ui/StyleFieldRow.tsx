import type { ReactNode } from 'react'

/** Wraps one style-eligible control (a Slider or ColorField row) with an inherited/custom
 * indicator and a Reset-to-Visual-Reference link — only rendered while editing a specific
 * Expression or Keyframe (see ControlsPanel/ColorPanel's `editingContext`), since the live
 * "Both Eyes" base pose isn't itself an overridable, named thing with inheritance to track. */
export function StyleFieldRow({
  active,
  overridden,
  onReset,
  children
}: {
  /** False when there's no expression/keyframe selected — renders children with no chrome. */
  active: boolean
  overridden: boolean
  onReset: () => void
  children: ReactNode
}) {
  if (!active) return <>{children}</>
  return (
    <div>
      {children}
      <div className="flex items-center justify-end gap-1.5 -mt-0.5">
        <span className={`text-[10px] ${overridden ? 'text-studio-warn' : 'text-studio-muted/70'}`}>
          {overridden ? '● Custom' : '○ Inherited'}
        </span>
        {overridden && (
          <button type="button" onClick={onReset} className="text-[10px] text-studio-accent hover:underline">
            Reset to Visual Reference
          </button>
        )}
      </div>
    </div>
  )
}
