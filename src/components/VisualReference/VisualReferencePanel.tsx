import { useEffect, useState } from 'react'
import { useStore } from '@/state/store'
import type { ApplyVisualReferenceOptions } from '@/state/store'
import { ControlsPanel } from '@/components/Controls/ControlsPanel'
import { ColorPanel } from '@/components/Colors/ColorPanel'
import { DisplayPanel } from '@/components/Display/DisplayPanel'
import { ReferenceImportPanel } from '@/components/Import/ReferenceImportPanel'
import { PanelTabs } from '@/components/ui/PanelTabs'

// This tab doesn't duplicate its own Shape/Colors/Display sliders — it reuses the exact same
// ControlsPanel/ColorPanel/DisplayPanel components the rest of the app already edits the live
// design pose with, just pointed at project.visualReference instead (via the editTarget prop
// on Controls/Colors — Display is already a single global project.display value shared by
// everything, so it needs no such switch). 'Apply' and 'Import Image' are the only things
// unique to Visual Reference, so they're the only tabs with real content of their own here.
type VRTab = 'controls' | 'colors' | 'display' | 'apply' | 'import'

const VR_TABS: { value: VRTab; label: string }[] = [
  { value: 'controls', label: 'Controls' },
  { value: 'colors', label: 'Colors' },
  { value: 'display', label: 'Display' },
  { value: 'apply', label: 'Apply' },
  { value: 'import', label: 'Import Image' }
]

function RadioRow<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`studio-tab text-xs px-2 py-1 ${value === opt.value ? 'studio-tab-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function VisualReferencePanel() {
  const project = useStore((s) => s.project)
  const applyVisualReference = useStore((s) => s.applyVisualReference)
  const checkpoint = useStore((s) => s.checkpoint)
  const referenceImportOpen = useStore((s) => s.referenceImportOpen)
  const setReferenceImportOpen = useStore((s) => s.setReferenceImportOpen)

  const [tab, setTab] = useState<VRTab>('controls')
  const [scope, setScope] = useState<ApplyVisualReferenceOptions['scope']>('all')
  const [eyeTargetOpt, setEyeTargetOpt] = useState<ApplyVisualReferenceOptions['eyeTarget']>('both')
  const [overrideMode, setOverrideMode] = useState<ApplyVisualReferenceOptions['overrideMode']>('preserve')
  const [status, setStatus] = useState<string | null>(null)

  // Toolbar's "Import Reference..." button sets this one-shot signal (and switches the right
  // panel here) to jump straight to the Import Image tab; consume it immediately so it fires
  // again next time the button is clicked even if this tab is already open.
  useEffect(() => {
    if (referenceImportOpen) {
      setTab('import')
      setReferenceImportOpen(false)
    }
  }, [referenceImportOpen, setReferenceImportOpen])

  const overrideCountInScope = (): number => {
    let count = 0
    if (scope === 'all' || scope === 'expressions') {
      count += project.expressions.reduce((sum, e) => sum + e.styleOverrides.length, 0)
    } else if (scope === 'selected') {
      const expr = project.expressions.find((e) => e.id === useStore.getState().selectedExpressionId)
      if (expr) count += expr.styleOverrides.length
    }
    if (scope === 'all' || scope === 'animations') {
      count += project.animations.reduce((sum, a) => sum + a.keyframes.reduce((s2, k) => s2 + k.styleOverrides.length, 0), 0)
    } else if (scope === 'selected') {
      const anim = project.animations.find((a) => a.id === useStore.getState().activeAnimationId)
      if (anim) count += anim.keyframes.reduce((sum, k) => sum + k.styleOverrides.length, 0)
    }
    return count
  }

  // Apply runs as one synchronous Immer producer (see applyVisualReference in store.ts) — it
  // finishes before this function returns, there's no async step or delay to wait out. What
  // can look like "nothing happened" is usually Preserve mode correctly skipping a field
  // that's pinned as a custom override (e.g. Happy's height/radius, Angry's tilt) — by
  // design, so a blink stays a blink. This summary reports exactly what changed so that's
  // never ambiguous.
  const handleApply = () => {
    if (overrideMode === 'replace') {
      const count = overrideCountInScope()
      const proceed = window.confirm(
        `Replace mode will clear ${count} custom style override${count === 1 ? '' : 's'} in the selected scope and reset ` +
          'every style field (colors, eye/pupil size, corner radius, eyelid curvature, highlight) to the Visual ' +
          'Reference. Movement, timing, keyframe positions, and other behavioral settings are never affected either way. ' +
          'This can be undone with Undo. Continue?'
      )
      if (!proceed) return
    }

    let exprCount = 0
    if (scope === 'all' || scope === 'expressions') exprCount = project.expressions.length
    else if (scope === 'selected' && useStore.getState().selectedExpressionId) exprCount = 1

    let animCount = 0
    if (scope === 'all' || scope === 'animations') animCount = project.animations.length
    else if (scope === 'selected' && useStore.getState().activeAnimationId) animCount = 1

    checkpoint()
    applyVisualReference({ scope, eyeTarget: eyeTargetOpt, overrideMode })

    const parts: string[] = []
    if (exprCount > 0) parts.push(`${exprCount} expression${exprCount === 1 ? '' : 's'}`)
    if (animCount > 0) parts.push(`${animCount} animation${animCount === 1 ? '' : 's'}`)
    setStatus(
      `Applied instantly — checked ${parts.join(' and ') || 'nothing in scope'}. Fields pinned as custom overrides were left unchanged.`
    )
    setTimeout(() => setStatus(null), 4500)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {tab !== 'apply' && tab !== 'import' && (
        <div className="p-3 pb-0">
          <p className="text-[11px] text-studio-accent">
            ↑ Live preview is the main canvas above — it switches to showing this Visual Reference while this tab is
            open, at full display size with the bezel.
          </p>
        </div>
      )}

      <PanelTabs tabs={VR_TABS} active={tab} onChange={setTab} />

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'controls' && <ControlsPanel editTarget="visual-reference" />}
        {tab === 'colors' && <ColorPanel editTarget="visual-reference" />}
        {tab === 'display' && <DisplayPanel />}

        {tab === 'apply' && (
          <div className="h-full overflow-y-auto p-3 flex flex-col gap-2.5">
            <p className="text-xs text-studio-muted leading-relaxed">
              Applying updates every expression and animation's matching shared-style fields, without touching their
              movement, timing, or emotion-specific customizations.
            </p>
            <RadioRow
              label="Apply to"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'expressions', label: 'Expressions only' },
                { value: 'animations', label: 'Animations only' },
                { value: 'selected', label: 'Selected item' }
              ]}
            />
            <RadioRow
              label="Eyes"
              value={eyeTargetOpt}
              onChange={setEyeTargetOpt}
              options={[
                { value: 'both', label: 'Both eyes' },
                { value: 'left', label: 'Left eye only' },
                { value: 'right', label: 'Right eye only' }
              ]}
            />
            <p className="text-[11px] text-studio-muted -mt-1">Left/right only affects expressions — animation keyframes always share one pose.</p>
            <RadioRow
              label="Custom overrides"
              value={overrideMode}
              onChange={setOverrideMode}
              options={[
                { value: 'preserve', label: 'Preserve (recommended)' },
                { value: 'replace', label: 'Replace' }
              ]}
            />
            <button className="studio-btn-primary self-start" onClick={handleApply}>
              Apply Visual Reference
            </button>
            {status && <p className="text-xs text-green-400">{status}</p>}
          </div>
        )}

        {tab === 'import' && (
          <div className="h-full overflow-y-auto p-3">
            <ReferenceImportPanel />
          </div>
        )}
      </div>
    </div>
  )
}
