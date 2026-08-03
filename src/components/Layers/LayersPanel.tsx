import { useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import type { EyeLayerKind, LayerKind } from '@/state/store'
import { effectiveEyeColors, effectiveEyeParams, effectiveStickers } from '@/types'

const ROWS: { kind: LayerKind; label: string }[] = [
  { kind: 'eyeShape', label: 'Eye Shape' },
  { kind: 'upperEyelid', label: 'Upper Eyelid' },
  { kind: 'lowerEyelid', label: 'Lower Eyelid' },
  { kind: 'pupil', label: 'Pupil' },
  { kind: 'stickers', label: 'Stickers' },
  { kind: 'effects', label: 'Effects' }
]

// Which object (EyeParams vs. EyeColors) owns this kind's *Visible/*Locked pair — always the
// same object for both fields within a kind (see types/index.ts's own field placement).
const EYE_LAYER_OBJ: Record<EyeLayerKind, 'params' | 'colors'> = {
  eyeShape: 'params',
  upperEyelid: 'params',
  lowerEyelid: 'params',
  pupil: 'params',
  effects: 'colors'
}
const VISIBLE_FIELD: Record<EyeLayerKind, string> = {
  eyeShape: 'eyeShapeVisible',
  upperEyelid: 'upperEyelidVisible',
  lowerEyelid: 'lowerEyelidVisible',
  pupil: 'pupilVisible',
  effects: 'effectsVisible'
}
const LOCKED_FIELD: Record<EyeLayerKind, string> = {
  eyeShape: 'eyeShapeLocked',
  upperEyelid: 'upperEyelidLocked',
  lowerEyelid: 'lowerEyelidLocked',
  pupil: 'pupilLocked',
  effects: 'effectsLocked'
}

const BTN = 'text-studio-muted hover:text-studio-text text-xs px-1.5 py-0.5 rounded border border-studio-border hover:border-studio-accent'
const SELECT_CLASS = 'bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs'

/** Six fixed rows (Eye Shape / Upper Eyelid / Lower Eyelid / Pupil / Stickers / Effects), each
 * with hide/lock/duplicate-to-other-eye/copy/paste/apply-to-all/reset — the Layers panel from
 * the M2e milestone. Five rows are thin views over a handful of EyeParams/EyeColors fields (see
 * store.ts's LAYER_*_FIELD tables); Stickers is the one list-based row, driving the same
 * effectiveStickers()/current-scope list the Sticker Manager tab already edits. */
export function LayersPanel() {
  const project = useStore((s) => s.project)
  const eyeTarget = useStore((s) => s.eyeTarget)
  const selectedExpressionId = useStore((s) => s.selectedExpressionId)
  const activeAnimationId = useStore((s) => s.activeAnimationId)
  const checkpoint = useStore((s) => s.checkpoint)
  const layerClipboard = useStore((s) => s.layerClipboard)
  const setLayerVisible = useStore((s) => s.setLayerVisible)
  const setLayerLocked = useStore((s) => s.setLayerLocked)
  const duplicateLayerToOtherEye = useStore((s) => s.duplicateLayerToOtherEye)
  const copyLayerToClipboard = useStore((s) => s.copyLayerToClipboard)
  const pasteLayerFromClipboard = useStore((s) => s.pasteLayerFromClipboard)
  const applyLayerToAllExpressions = useStore((s) => s.applyLayerToAllExpressions)
  const resetLayerToDefault = useStore((s) => s.resetLayerToDefault)

  const [pasteTarget, setPasteTarget] = useState<Record<string, string>>({})

  const params = effectiveEyeParams(project, eyeTarget)
  const colors = effectiveEyeColors(project, eyeTarget)
  const activeExpression = project.expressions.find((e) => e.id === selectedExpressionId) ?? null
  const activeAnimation = getActiveAnimation() ?? null
  const stickers = effectiveStickers(project, activeExpression, activeAnimation)
  void activeAnimationId

  const rowState = (kind: LayerKind): { visible: boolean; locked: boolean; mixed: boolean } => {
    if (kind === 'stickers') {
      if (stickers.length === 0) return { visible: true, locked: false, mixed: false }
      const allVisible = stickers.every((s) => s.visible)
      const noneVisible = stickers.every((s) => !s.visible)
      const allLocked = stickers.every((s) => s.locked)
      const noneLocked = stickers.every((s) => !s.locked)
      return { visible: allVisible, locked: allLocked, mixed: !allVisible && !noneVisible ? true : !allLocked && !noneLocked }
    }
    const obj = (EYE_LAYER_OBJ[kind] === 'params' ? params : colors) as unknown as Record<string, unknown>
    return {
      visible: Boolean(obj[VISIBLE_FIELD[kind]]),
      locked: Boolean(obj[LOCKED_FIELD[kind]]),
      mixed: false
    }
  }

  const doDuplicate = (kind: LayerKind) => {
    checkpoint()
    duplicateLayerToOtherEye(kind)
  }
  const doCopy = (kind: LayerKind) => {
    copyLayerToClipboard(kind)
  }
  const doPaste = (kind: LayerKind) => {
    checkpoint()
    pasteLayerFromClipboard(kind, pasteTarget[kind] ?? 'base')
  }
  const doApplyAll = (kind: LayerKind) => {
    checkpoint()
    applyLayerToAllExpressions(kind)
  }
  const doReset = (kind: LayerKind) => {
    checkpoint()
    resetLayerToDefault(kind)
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
      <p className="text-[11px] text-studio-muted">
        Editing {eyeTarget === 'both' ? 'Both Eyes' : eyeTarget === 'left' ? 'Left Eye' : 'Right Eye'} — switch Eye Target in the Controls tab to
        edit a single side (required for "Duplicate to Other Eye").
      </p>
      {ROWS.map(({ kind, label }) => {
        const state = rowState(kind)
        const canDuplicate = kind === 'stickers' || eyeTarget !== 'both'
        const hasClipboard = layerClipboard?.kind === kind
        return (
          <div key={kind} className="rounded-md border border-studio-border bg-studio-panel2 p-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium flex-1">{label}</span>
              {state.mixed && <span className="text-[10px] text-studio-muted italic">mixed</span>}
              <button
                title={state.visible ? 'Hide' : 'Show'}
                className={BTN}
                onClick={() => {
                  checkpoint()
                  setLayerVisible(kind, !state.visible)
                }}
              >
                {state.visible ? '◉' : '○'}
              </button>
              <button
                title={state.locked ? 'Unlock' : 'Lock'}
                className={BTN}
                onClick={() => {
                  checkpoint()
                  setLayerLocked(kind, !state.locked)
                }}
              >
                {state.locked ? '🔒' : '🔓'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button title="Copy this eye's/side's current value to the other eye" disabled={!canDuplicate} className={`${BTN} disabled:opacity-40 disabled:cursor-not-allowed`} onClick={() => doDuplicate(kind)}>
                Duplicate → Other Eye
              </button>
              <button title="Copy to clipboard" className={BTN} onClick={() => doCopy(kind)}>
                Copy
              </button>
              <select
                className={SELECT_CLASS}
                value={pasteTarget[kind] ?? 'base'}
                onChange={(e) => setPasteTarget((p) => ({ ...p, [kind]: e.target.value }))}
              >
                <option value="base">Base pose</option>
                {project.expressions.map((expr) => (
                  <option key={expr.id} value={expr.id}>
                    {expr.name}
                  </option>
                ))}
              </select>
              <button title="Paste clipboard onto the selected target" disabled={!hasClipboard} className={`${BTN} disabled:opacity-40 disabled:cursor-not-allowed`} onClick={() => doPaste(kind)}>
                Paste
              </button>
              <button title="Apply this layer's current values to every expression" className={BTN} onClick={() => doApplyAll(kind)}>
                Apply to All Expressions
              </button>
              <button title="Reset to default" className={BTN} onClick={() => doReset(kind)}>
                Reset
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
