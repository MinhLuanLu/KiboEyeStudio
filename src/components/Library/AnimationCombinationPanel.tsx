import { useEffect } from 'react'
import { useStore } from '@/state/store'

/** Combination library management + playback transport — the actual clip *editing* (drag/trim/
 * reorder/copy/paste/multi-select) now lives in the shared bottom Timeline (Timeline.tsx),
 * which switches into "combo editing mode" automatically whenever a combo is selected here (see
 * isComboTimelineActive in state/store.ts). This panel's job mirrors how choosing *which*
 * animation to edit already works from the Animations tab sidebar, not from inside the
 * Timeline: create/select/rename/duplicate/delete a combo, plus the Play/Pause/Stop/Restart
 * preview transport, which isn't itself a timeline-editing concern. */
export function AnimationCombinationPanel() {
  const project = useStore((s) => s.project)
  const combos = project.animationCombos

  const selectedComboId = useStore((s) => s.selectedComboId)
  const selectedClipId = useStore((s) => s.selectedComboClipId)
  const loopPreview = useStore((s) => s.comboPreviewLoop)
  const playing = useStore((s) => s.comboPreviewPlaying)
  const previewTimeMs = useStore((s) => s.comboPreviewTimeMs)

  const selectAnimationCombo = useStore((s) => s.selectAnimationCombo)
  const selectAnimationComboClip = useStore((s) => s.selectAnimationComboClip)
  const setComboPreviewPlaying = useStore((s) => s.setComboPreviewPlaying)
  const setComboPreviewTimeMs = useStore((s) => s.setComboPreviewTimeMs)
  const setComboPreviewLoop = useStore((s) => s.setComboPreviewLoop)

  const addAnimationCombo = useStore((s) => s.addAnimationCombo)
  const duplicateAnimationCombo = useStore((s) => s.duplicateAnimationCombo)
  const renameAnimationCombo = useStore((s) => s.renameAnimationCombo)
  const deleteAnimationCombo = useStore((s) => s.deleteAnimationCombo)

  const selectedCombo = combos.find((combo) => combo.id === selectedComboId) ?? combos[0] ?? null
  useEffect(() => {
    if (!selectedComboId && combos[0]) selectAnimationCombo(combos[0].id)
    if (selectedCombo && selectedCombo.clips.length > 0 && !selectedCombo.clips.some((clip) => clip.id === selectedClipId)) {
      selectAnimationComboClip(selectedCombo.clips[0].id)
    }
  }, [combos, selectAnimationComboClip, selectAnimationCombo, selectedClipId, selectedCombo, selectedComboId])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-studio-border p-2">
        <span className="studio-label">Combinations</span>
        <button
          className="studio-btn"
          onClick={() => {
            const id = addAnimationCombo()
            selectAnimationCombo(id)
          }}
        >
          + New
        </button>
      </div>

      {/* Single stacked column — this panel lives in the narrow left sidebar (14-30% of window
          width), not the wide center panel. */}
      <div className="flex flex-col gap-2 p-2">
        <div className="rounded-md border border-studio-border bg-studio-panel2">
          <div className="border-b border-studio-border p-2 text-xs uppercase tracking-wide text-studio-muted">Library</div>
          <div className="max-h-40 overflow-y-auto p-1.5">
            {combos.length === 0 ? (
              <div className="p-2 text-sm text-studio-muted">No combinations yet.</div>
            ) : (
              combos.map((combo) => (
                <button
                  key={combo.id}
                  className={`mb-1 w-full rounded-md border px-2 py-1.5 text-left text-sm ${selectedCombo?.id === combo.id ? 'border-studio-accent bg-studio-accent/15' : 'border-transparent hover:border-studio-border hover:bg-studio-panel'}`}
                  onClick={() => selectAnimationCombo(combo.id)}
                >
                  <div className="font-medium truncate">{combo.name}</div>
                  <div className="text-xs text-studio-muted">{combo.clips.length} clips{combo.loop ? ' · loop' : ''}</div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-md border border-studio-border bg-studio-panel2 p-2 flex flex-col gap-2">
          <input
            className="w-full rounded border border-studio-border bg-studio-panel px-2 py-1 text-sm"
            value={selectedCombo?.name ?? ''}
            onChange={(e) => selectedCombo && renameAnimationCombo(selectedCombo.id, e.target.value)}
            placeholder="Combo name"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="studio-btn" disabled={!selectedCombo} onClick={() => selectedCombo && duplicateAnimationCombo(selectedCombo.id)}>
              Duplicate
            </button>
            <button className="studio-btn" disabled={!selectedCombo} onClick={() => selectedCombo && deleteAnimationCombo(selectedCombo.id)}>
              Delete
            </button>
            <label className="flex items-center gap-2 text-sm text-studio-muted">
              <input type="checkbox" checked={loopPreview} onChange={(e) => setComboPreviewLoop(e.target.checked)} />
              Loop preview
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="studio-btn" onClick={() => setComboPreviewPlaying(true)} disabled={!selectedCombo}>
              Play
            </button>
            <button className="studio-btn" onClick={() => setComboPreviewPlaying(false)} disabled={!selectedCombo}>
              Pause
            </button>
            <button className="studio-btn" onClick={() => { setComboPreviewTimeMs(0); setComboPreviewPlaying(true) }} disabled={!selectedCombo}>
              Resume
            </button>
            <button className="studio-btn" onClick={() => { setComboPreviewPlaying(false); setComboPreviewTimeMs(0) }} disabled={!selectedCombo}>
              Stop
            </button>
            <button className="studio-btn" onClick={() => { setComboPreviewTimeMs(0); setComboPreviewPlaying(true) }} disabled={!selectedCombo}>
              Restart
            </button>
            <button
              className="studio-btn"
              onClick={() => {
                const selectedClip = selectedCombo?.clips.find((clip) => clip.id === selectedClipId) ?? selectedCombo?.clips[0]
                if (selectedClip) setComboPreviewTimeMs(selectedClip.startTimeMs)
              }}
              disabled={!selectedCombo}
            >
              Preview from selected timeline position
            </button>
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-studio-muted">
            <span>
              Time: {Math.round(previewTimeMs)}ms{playing ? ' · playing' : ''}
            </span>
            <span>Preview shows in the center canvas. Drag/trim/copy/paste clips in the Timeline below — it switches to editing this combo automatically.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
