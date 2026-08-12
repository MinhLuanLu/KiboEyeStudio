import { useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import type { KeyframeTrackKind } from '@/state/store'
import { EasingPicker } from './EasingPicker'
import { ExpressionThumb, EXPRESSION_THUMB_BOX } from '@/components/Library/ExpressionLibraryPanel'
import { msToFrame } from './timelineMath'

function formatFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

function keyframeListForKind(anim: NonNullable<ReturnType<typeof getActiveAnimation>>, trackKind: KeyframeTrackKind) {
  switch (trackKind) {
    case 'pose':
      return anim.keyframes
    case 'leftEye':
      return anim.leftEyeKeyframes
    case 'rightEye':
      return anim.rightEyeKeyframes
    case 'pupils':
      return anim.pupilKeyframes
    case 'eyelids':
      return anim.eyelidKeyframes
  }
}

/** The Timeline's bottom detail panel — shows and edits whatever the single selected timeline
 * item is (a keyframe on any track, a sticker clip's timing, a Combination clip's loop/speed/
 * transition settings, or a marker). Multi-selections just show a count, matching the old
 * single-keyframe Timeline's "nothing to show" behavior for anything more complex than one
 * item. Full sticker property editing (position/scale/rotation/entry-exit/loop/...) stays in
 * StickerControls (the Stickers right panel) — selecting a sticker clip here already drives
 * that panel too, via syncPrimarySelection in the store, so this panel only needs to surface
 * clip *timing* for quick access without duplicating it. */
export function TimelineInspector() {
  const anim = useStore(() => getActiveAnimation())
  const selection = useStore((s) => s.timelineSelection)
  const fps = useStore((s) => s.project.display.fps)
  const expressions = useStore((s) => s.project.expressions)
  const animations = useStore((s) => s.project.animations)
  const animationCombos = useStore((s) => s.project.animationCombos)
  const checkpoint = useStore((s) => s.checkpoint)
  const setKeyframeTime = useStore((s) => s.setKeyframeTime)
  const updateTrackKeyframeEasing = useStore((s) => s.updateTrackKeyframeEasing)
  const applyExpressionToKeyframe = useStore((s) => s.applyExpressionToKeyframe)
  const saveKeyframeAsExpression = useStore((s) => s.saveKeyframeAsExpression)
  const setLeftTab = useStore((s) => s.setLeftTab)
  const resizeStickerClip = useStore((s) => s.resizeStickerClip)
  const updateSticker = useStore((s) => s.updateSticker)
  const playbackTimeMs = useStore((s) => s.playbackTimeMs)
  const addStickerKeyframe = useStore((s) => s.addStickerKeyframe)
  const updateStickerKeyframe = useStore((s) => s.updateStickerKeyframe)
  const setStickerKeyframeTime = useStore((s) => s.setStickerKeyframeTime)
  const setStickerKeyframeEasing = useStore((s) => s.setStickerKeyframeEasing)
  const deleteStickerKeyframe = useStore((s) => s.deleteStickerKeyframe)
  const setTimelineSelection = useStore((s) => s.setTimelineSelection)
  const updateMarker = useStore((s) => s.updateMarker)
  const setRightTab = useStore((s) => s.setRightTab)
  const updateAnimationComboClip = useStore((s) => s.updateAnimationComboClip)
  const deleteAnimationComboClip = useStore((s) => s.deleteAnimationComboClip)

  const [exprPickerOpen, setExprPickerOpen] = useState(false)
  const [exprSearch, setExprSearch] = useState('')
  // Inline name entry for "Save as Expression". Electron doesn't support window.prompt(), so we can't
  // use it here — this small popup collects the name instead.
  const [saveExprOpen, setSaveExprOpen] = useState(false)
  const [saveExprName, setSaveExprName] = useState('')
  // Default to "Replace all" so adding an expression captures a COMPLETE snapshot of it (pose +
  // position/rotation + colours), i.e. the keyframe looks exactly like the expression. "Preserve
  // overrides" (styleOnly) stays available for applying just the shared visual style onto a
  // keyframe that already has its own movement/overrides.
  const [exprMode, setExprMode] = useState<'styleOnly' | 'replace'>('replace')

  if (selection.length === 1 && selection[0].kind === 'comboClip') {
    const item = selection[0]
    const combo = animationCombos.find((c) => c.id === item.trackId)
    const clip = combo?.clips.find((c) => c.id === item.id)
    if (!combo || !clip) return null
    const clipAnim = animations.find((a) => a.id === clip.animationId)
    return (
      <div className="flex flex-col gap-2.5 studio-panel p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{clipAnim?.name ?? 'Missing animation'}</span>
          <button
            className="studio-btn px-2 py-1 text-xs"
            onClick={() => {
              checkpoint()
              deleteAnimationComboClip(combo.id, clip.id)
            }}
          >
            Delete
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <label className="flex flex-col gap-1">
            <span className="studio-label">Start (ms)</span>
            <input
              type="number"
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
              value={clip.startTimeMs}
              onFocus={checkpoint}
              onChange={(e) => updateAnimationComboClip(combo.id, clip.id, { startTimeMs: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="studio-label">Loops</span>
            <input
              type="number"
              min={1}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
              value={clip.loopCount}
              onFocus={checkpoint}
              onChange={(e) => updateAnimationComboClip(combo.id, clip.id, { loopCount: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="studio-label">Speed %</span>
            <input
              type="number"
              min={1}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
              value={clip.playbackSpeed}
              onFocus={checkpoint}
              onChange={(e) => updateAnimationComboClip(combo.id, clip.id, { playbackSpeed: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="studio-label">Transition ms</span>
            <input
              type="number"
              min={0}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
              value={clip.transitionMs}
              onFocus={checkpoint}
              onChange={(e) => updateAnimationComboClip(combo.id, clip.id, { transitionMs: Number(e.target.value) })}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="studio-label">End delay ms</span>
            <input
              type="number"
              min={0}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
              value={clip.endDelayMs}
              onFocus={checkpoint}
              onChange={(e) => updateAnimationComboClip(combo.id, clip.id, { endDelayMs: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>
    )
  }

  if (!anim) return null

  if (selection.length === 0) {
    return <div className="text-xs text-studio-muted px-2 py-3">Select a keyframe, sticker clip, Combination clip, or marker to edit it here.</div>
  }
  if (selection.length > 1) {
    return <div className="text-xs text-studio-muted px-2 py-3">{selection.length} items selected.</div>
  }

  const item = selection[0]

  if (item.kind === 'keyframe') {
    const trackKind = item.trackId as KeyframeTrackKind
    const list = keyframeListForKind(anim, trackKind)
    const idx = list.findIndex((k) => k.id === item.id)
    const kf = list[idx]
    if (!kf) return null
    const isPinned = trackKind === 'pose' && idx === 0
    // Case-insensitive partial-name filter. Short-circuits when the box is empty so we skip the
    // per-item toLowerCase pass entirely — keeps typing smooth in large projects.
    const q = exprSearch.trim().toLowerCase()
    const filteredExpressions = q ? expressions.filter((e) => e.name.toLowerCase().includes(q)) : expressions
    const nudgeKeyframeTime = (deltaMs: number) => {
      checkpoint()
      setKeyframeTime(trackKind, kf.id, kf.timeMs + deltaMs)
    }

    return (
      <div className="flex flex-col gap-2.5 studio-panel p-2.5">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="studio-label">Time (ms)</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step={1}
                inputMode="numeric"
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-24 disabled:opacity-50"
                min={0}
                disabled={isPinned}
                value={Math.round(kf.timeMs)}
                onChange={(e) => {
                  checkpoint()
                  setKeyframeTime(trackKind, kf.id, Number(e.target.value))
                }}
                title={isPinned ? 'The first Expression keyframe is always pinned at 0ms' : undefined}
              />
              <button
                type="button"
                className="studio-btn px-2 py-1 text-xs disabled:opacity-50"
                disabled={isPinned}
                onClick={() => nudgeKeyframeTime(-1)}
                title="Decrease by 1ms"
              >
                -1
              </button>
              <button
                type="button"
                className="studio-btn px-2 py-1 text-xs disabled:opacity-50"
                disabled={isPinned}
                onClick={() => nudgeKeyframeTime(1)}
                title="Increase by 1ms"
              >
                +1
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="studio-label">Frame</span>
            <input
              type="number"
              step={1}
              inputMode="numeric"
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-20 disabled:opacity-50"
              min={0}
              disabled={isPinned}
              value={msToFrame(kf.timeMs, fps)}
              onChange={(e) => {
                checkpoint()
                setKeyframeTime(trackKind, kf.id, (Number(e.target.value) / fps) * 1000)
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="studio-label">Easing (out to next keyframe)</span>
            <EasingPicker
              easing={kf.easing}
              customBezier={kf.customBezier}
              onChange={(easing, bezier) => {
                checkpoint()
                updateTrackKeyframeEasing(trackKind, kf.id, easing, bezier)
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-studio-muted border-t border-studio-border pt-2">
          <span>
            {trackKind} keyframe {idx + 1} · Frame {msToFrame(kf.timeMs, fps)} · {Math.round(kf.timeMs)} ms
            {kf.styleOverrides.length > 0 && <> · Overrides: {kf.styleOverrides.map(formatFieldLabel).join(', ')}</>}
          </span>
          {trackKind === 'pose' && (
            <div className="flex items-center gap-1.5">
            <div className="relative">
              <button
                className="studio-btn text-xs px-2 py-1"
                title="Save this keyframe's current look as a new reusable Expression"
                onClick={() => {
                  setSaveExprName('')
                  setSaveExprOpen((v) => !v)
                }}
              >
                Save as Expression...
              </button>
              {saveExprOpen && (
                <div className="absolute right-0 bottom-full mb-1 w-64 studio-panel border border-studio-border rounded-md shadow-lg z-20 p-2 flex flex-col gap-2">
                  <span className="studio-label">New Expression from this keyframe</span>
                  <input
                    autoFocus
                    className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
                    placeholder="Expression name..."
                    value={saveExprName}
                    onChange={(e) => setSaveExprName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const name = saveExprName.trim()
                        if (!name) return
                        checkpoint()
                        saveKeyframeAsExpression(kf.id, name)
                        setSaveExprOpen(false)
                        setLeftTab('expressions')
                      } else if (e.key === 'Escape') setSaveExprOpen(false)
                    }}
                  />
                  <div className="flex justify-end gap-1">
                    <button className="studio-btn text-xs px-2 py-1" onClick={() => setSaveExprOpen(false)}>
                      Cancel
                    </button>
                    <button
                      className="studio-btn-primary text-xs px-2 py-1"
                      disabled={!saveExprName.trim()}
                      onClick={() => {
                        const name = saveExprName.trim()
                        if (!name) return
                        checkpoint()
                        saveKeyframeAsExpression(kf.id, name)
                        setSaveExprOpen(false)
                        setLeftTab('expressions') // reveal it in the Expressions panel
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <button className="studio-btn text-xs px-2 py-1" onClick={() => setExprPickerOpen((v) => !v)}>
                Use Existing Expression...
              </button>
              {exprPickerOpen && (
                <div className="absolute right-0 bottom-full mb-1 w-72 studio-panel border border-studio-border rounded-md shadow-lg z-20 p-2 flex flex-col gap-2">
                  <input
                    autoFocus
                    className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
                    placeholder="Search expressions..."
                    value={exprSearch}
                    onChange={(e) => setExprSearch(e.target.value)}
                  />
                  <div className="flex gap-1">
                    <button
                      className={`studio-tab text-xs px-2 py-1 flex-1 ${exprMode === 'styleOnly' ? 'studio-tab-active' : ''}`}
                      onClick={() => setExprMode('styleOnly')}
                      title="Preserve this keyframe's pupil/eyelid movement and overrides — only copy shared visual style"
                    >
                      Preserve overrides
                    </button>
                    <button
                      className={`studio-tab text-xs px-2 py-1 flex-1 ${exprMode === 'replace' ? 'studio-tab-active' : ''}`}
                      onClick={() => setExprMode('replace')}
                      title="Replace all of this keyframe's pose values with the expression's"
                    >
                      Replace all
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto flex flex-col gap-0.5">
                    {filteredExpressions.length === 0 && <span className="text-xs text-studio-muted p-2">No results found</span>}
                    {filteredExpressions.map((expr) => (
                      <button
                        key={expr.id}
                        className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-studio-panel2 text-left"
                        onClick={() => {
                          checkpoint()
                          applyExpressionToKeyframe(kf.id, expr.id, exprMode)
                          setExprPickerOpen(false)
                          setExprSearch('')
                        }}
                      >
                        <div style={{ width: EXPRESSION_THUMB_BOX, height: EXPRESSION_THUMB_BOX }} className="shrink-0">
                          <ExpressionThumb expr={expr} />
                        </div>
                        <span className="text-sm truncate">{expr.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (item.kind === 'sticker') {
    const sticker = anim.stickers.find((s) => s.id === item.id)
    if (!sticker) return null
    return (
      <div className="flex flex-col gap-2.5 studio-panel p-2.5">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="studio-label">Start (ms)</span>
            <input
              type="number"
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-24"
              min={0}
              value={Math.round(sticker.anim.startTimeMs)}
              onChange={(e) => {
                checkpoint()
                resizeStickerClip(sticker.id, 'start', Number(e.target.value))
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="studio-label">End (ms)</span>
            <input
              type="number"
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-24 disabled:opacity-50"
              min={0}
              disabled={sticker.anim.endTimeMs === null}
              value={sticker.anim.endTimeMs === null ? '' : Math.round(sticker.anim.endTimeMs)}
              placeholder="never"
              onChange={(e) => {
                checkpoint()
                resizeStickerClip(sticker.id, 'end', Number(e.target.value))
              }}
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={sticker.anim.endTimeMs === null}
              onChange={(e) => {
                checkpoint()
                updateSticker(sticker.id, {
                  anim: { ...sticker.anim, endTimeMs: e.target.checked ? null : sticker.anim.startTimeMs + 500 }
                })
              }}
            />
            Never ends
          </label>
        </div>
        <div className="flex items-center justify-between text-xs text-studio-muted border-t border-studio-border pt-2 gap-2 flex-wrap">
          <span>
            Sticker "{sticker.name}" · {(sticker.keyframes?.length ?? 0)} keyframe{(sticker.keyframes?.length ?? 0) === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              className="studio-btn text-xs px-2 py-1"
              title="Capture this sticker's current look as a keyframe at the playhead"
              onClick={() => {
                checkpoint()
                const id = addStickerKeyframe(sticker.id, playbackTimeMs)
                if (id) setTimelineSelection([{ kind: 'stickerKeyframe', trackId: sticker.id, id }])
              }}
            >
              + Keyframe
            </button>
            <button className="studio-btn text-xs px-2 py-1" onClick={() => setRightTab('stickers')}>
              Edit Full Properties...
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (item.kind === 'stickerKeyframe') {
    const sticker = anim.stickers.find((s) => s.id === item.trackId)
    const kf = sticker?.keyframes?.find((k) => k.id === item.id)
    if (!sticker || !kf) return null
    const num = (label: string, value: number, key: 'x' | 'y' | 'width' | 'height' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity', min: number, max: number, step = 1) => (
      <div className="flex flex-col gap-1">
        <span className="studio-label">{label}</span>
        <input
          type="number"
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-20"
          min={min}
          max={max}
          step={step}
          value={Math.round(value * 100) / 100}
          onChange={(e) => {
            checkpoint()
            updateStickerKeyframe(sticker.id, kf.id, { [key]: Math.max(min, Math.min(max, Number(e.target.value))) })
          }}
        />
      </div>
    )
    return (
      <div className="flex flex-col gap-2.5 studio-panel p-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="studio-label">Frame</span>
            <input
              type="number"
              step={1}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-20"
              min={0}
              value={msToFrame(kf.timeMs, fps)}
              onChange={(e) => {
                checkpoint()
                setStickerKeyframeTime(sticker.id, kf.id, (Number(e.target.value) / fps) * 1000)
              }}
            />
          </div>
          {num('X (px)', kf.x, 'x', -240, 240)}
          {num('Y (px)', kf.y, 'y', -240, 240)}
          {num('Width (px)', kf.width, 'width', 0, 240)}
          {num('Height (px)', kf.height, 'height', 0, 240)}
          {num('Scale X (%)', kf.scaleX, 'scaleX', 0, 500)}
          {num('Scale Y (%)', kf.scaleY, 'scaleY', 0, 500)}
          {num('Rotation (°)', kf.rotation, 'rotation', -360, 360)}
          {num('Opacity (%)', kf.opacity, 'opacity', 0, 100)}
          <div className="flex flex-col gap-1">
            <span className="studio-label">Color</span>
            <div className="flex items-center gap-1">
              <input
                type="color"
                className="h-7 w-8 bg-studio-panel2 border border-studio-border rounded cursor-pointer"
                value={kf.tint ?? '#ffffff'}
                onChange={(e) => {
                  checkpoint()
                  updateStickerKeyframe(sticker.id, kf.id, { tint: e.target.value })
                }}
              />
              {kf.tint !== null && (
                <button
                  className="text-xs text-studio-muted hover:text-studio-text"
                  title="Use the sticker's native colours (no tint)"
                  onClick={() => {
                    checkpoint()
                    updateStickerKeyframe(sticker.id, kf.id, { tint: null })
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="studio-label">Easing (out to next)</span>
            <EasingPicker
              easing={kf.easing}
              customBezier={kf.customBezier}
              onChange={(easing, bezier) => {
                checkpoint()
                setStickerKeyframeEasing(sticker.id, kf.id, easing, bezier)
              }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-studio-muted border-t border-studio-border pt-2">
          <span>
            {sticker.name} keyframe · Frame {msToFrame(kf.timeMs, fps)} · {Math.round(kf.timeMs)}ms
          </span>
          <button
            className="studio-btn text-xs px-2 py-1 hover:text-studio-danger"
            onClick={() => {
              checkpoint()
              deleteStickerKeyframe(sticker.id, kf.id)
              setTimelineSelection([])
            }}
          >
            Delete Keyframe
          </button>
        </div>
      </div>
    )
  }

  // marker
  const marker = anim.markers.find((m) => m.id === item.id)
  if (!marker) return null
  return (
    <div className="flex items-center gap-4 flex-wrap studio-panel p-2.5">
      <div className="flex flex-col gap-1">
        <span className="studio-label">Label</span>
        <input
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-40"
          value={marker.label}
          onChange={(e) => updateMarker(marker.id, { label: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="studio-label">Color</span>
        <input
          type="color"
          className="bg-studio-panel2 border border-studio-border rounded h-8 w-14"
          value={marker.color}
          onChange={(e) => updateMarker(marker.id, { color: e.target.value })}
        />
      </div>
      <span className="text-xs text-studio-muted">{Math.round(marker.timeMs)} ms</span>
    </div>
  )
}
