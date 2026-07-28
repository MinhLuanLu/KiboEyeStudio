import { useRef, useCallback, useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import { animationDuration, keyframeStartTimes, MIN_SEGMENT_MS } from '@/engine/interpolate'
import { EasingPicker } from './EasingPicker'
import { ExpressionThumb, EXPRESSION_THUMB_BOX } from '@/components/Library/ExpressionLibraryPanel'

function formatFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps)
}

export function Timeline() {
  const anim = useStore(() => getActiveAnimation())
  const selectedKeyframeId = useStore((s) => s.selectedKeyframeId)
  const selectKeyframe = useStore((s) => s.selectKeyframe)
  const addKeyframe = useStore((s) => s.addKeyframe)
  const duplicateKeyframe = useStore((s) => s.duplicateKeyframe)
  const deleteKeyframe = useStore((s) => s.deleteKeyframe)
  const updateKeyframeDuration = useStore((s) => s.updateKeyframeDuration)
  const updateKeyframeEasing = useStore((s) => s.updateKeyframeEasing)
  const setKeyframeAbsoluteTime = useStore((s) => s.setKeyframeAbsoluteTime)
  const copyKeyframe = useStore((s) => s.copyKeyframe)
  const pasteKeyframeAt = useStore((s) => s.pasteKeyframeAt)
  const keyframeClipboard = useStore((s) => s.keyframeClipboard)
  const applyExpressionToKeyframe = useStore((s) => s.applyExpressionToKeyframe)
  const expressions = useStore((s) => s.project.expressions)
  const fps = useStore((s) => s.project.display.fps)
  const checkpoint = useStore((s) => s.checkpoint)
  const seek = useStore((s) => s.seek)
  const pause = useStore((s) => s.pause)
  const setMode = useStore((s) => s.setMode)
  const playbackTimeMs = useStore((s) => s.playbackTimeMs)
  const mode = useStore((s) => s.mode)

  const trackRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ keyframeId: string; startPx: number; startDuration: number; prevDuration: number } | null>(null)

  const [exprPickerOpen, setExprPickerOpen] = useState(false)
  const [exprSearch, setExprSearch] = useState('')
  const [exprMode, setExprMode] = useState<'styleOnly' | 'replace'>('styleOnly')
  const [hoverMs, setHoverMs] = useState<number | null>(null)

  if (!anim) {
    return <div className="p-4 text-sm text-studio-muted">No animation selected.</div>
  }

  const total = Math.max(1, animationDuration(anim))
  const starts = keyframeStartTimes(anim)
  const trackWidth = () => trackRef.current?.getBoundingClientRect().width ?? 600

  const msToPx = (ms: number) => (ms / total) * trackWidth()
  const pxToMs = (px: number) => (px / trackWidth()) * total

  const handlePointerDown = (e: React.PointerEvent, keyframeId: string, index: number) => {
    e.stopPropagation()
    selectKeyframe(keyframeId)
    if (mode !== 'animate') setMode('animate')
    pause()
    seek(starts[index])
    if (index === 0) return // first keyframe is pinned at t=0
    checkpoint()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragState.current = {
      keyframeId,
      startPx: e.clientX,
      startDuration: anim.keyframes[index - 1].duration,
      prevDuration: anim.keyframes[index - 1].duration
    }
  }

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragState.current
      if (!drag) return
      const deltaPx = e.clientX - drag.startPx
      const deltaMs = pxToMs(deltaPx)
      const newDuration = Math.max(MIN_SEGMENT_MS, Math.round(drag.startDuration + deltaMs))
      const idx = anim.keyframes.findIndex((k) => k.id === drag.keyframeId)
      if (idx > 0) updateKeyframeDuration(anim.keyframes[idx - 1].id, newDuration)
    },
    [anim, updateKeyframeDuration]
  )

  const handlePointerUp = () => {
    dragState.current = null
  }

  const handleTrackClick = (e: React.MouseEvent) => {
    if (mode !== 'animate') setMode('animate')
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const ms = ((e.clientX - rect.left) / rect.width) * total
    seek(Math.max(0, Math.min(total, ms)))
  }

  // CapCut-style scrub preview: a thin line that follows the cursor while hovering the track,
  // showing exactly where a click would seek to — separate from the actual (orange) playhead.
  // Hidden while a keyframe is being dragged so it doesn't compete with the drag itself.
  const handleTrackMouseMove = (e: React.MouseEvent) => {
    if (dragState.current) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const ms = ((e.clientX - rect.left) / rect.width) * total
    setHoverMs(Math.max(0, Math.min(total, ms)))
  }

  const handleTrackMouseLeave = () => setHoverMs(null)

  const selected = anim.keyframes.find((k) => k.id === selectedKeyframeId)
  const selectedIndex = selected ? anim.keyframes.findIndex((k) => k.id === selected.id) : -1
  const selectedStartMs = selectedIndex >= 0 ? starts[selectedIndex] : 0
  const playheadPx = msToPx(Math.min(playbackTimeMs, total))

  const filteredExpressions = expressions.filter((e) => e.name.toLowerCase().includes(exprSearch.toLowerCase()))

  const handleCopy = () => {
    if (selected) copyKeyframe(selected.id)
  }

  const handlePaste = () => {
    if (!keyframeClipboard) return
    checkpoint()
    pasteKeyframeAt(playbackTimeMs)
  }

  return (
    <div className="flex flex-col gap-3 p-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{anim.name}</span>
          <span className="text-studio-muted text-xs font-mono">{Math.round(total)}ms</span>
        </div>
        <div className="flex gap-1.5">
          <button
            className="studio-btn"
            onClick={() => {
              checkpoint()
              addKeyframe(selectedKeyframeId ?? undefined)
            }}
          >
            + Keyframe
          </button>
          <button className="studio-btn" disabled={!selected} onClick={handleCopy} title="Copy Keyframe (Ctrl/Cmd+C)">
            Copy
          </button>
          <button
            className="studio-btn"
            disabled={!keyframeClipboard}
            onClick={handlePaste}
            title="Paste Keyframe at playhead (Ctrl/Cmd+V)"
          >
            Paste
          </button>
          <button
            className="studio-btn"
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              checkpoint()
              duplicateKeyframe(selected.id)
            }}
            title="Duplicate Keyframe (Ctrl/Cmd+D)"
          >
            Duplicate
          </button>
          <button
            className="studio-btn"
            disabled={!selected || anim.keyframes.length <= 1}
            onClick={() => {
              if (!selected) return
              checkpoint()
              deleteKeyframe(selected.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="relative h-14 mb-4 bg-studio-panel2 rounded-md border border-studio-border cursor-pointer overflow-visible"
        onClick={handleTrackClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseMove={handleTrackMouseMove}
        onMouseLeave={handleTrackMouseLeave}
      >
        {/* Segment connectors */}
        {starts.slice(0, -1).map((s, i) => (
          <div
            key={`seg-${anim.keyframes[i].id}`}
            className="absolute top-1/2 h-0.5 bg-studio-border2 -translate-y-1/2"
            style={{ left: msToPx(s), width: msToPx(starts[i + 1] - s) }}
          />
        ))}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-studio-warn pointer-events-none z-10"
          style={{ left: playheadPx }}
        />

        {/* Hover scrub preview line (CapCut-style) — follows the cursor, shows the exact ms it
            would seek to, distinct from the committed playhead above. */}
        {hoverMs !== null && (
          <div className="absolute top-0 bottom-0 w-px bg-yellow-400 pointer-events-none z-20" style={{ left: msToPx(hoverMs) }}>
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-yellow-400 whitespace-nowrap bg-studio-panel border border-studio-border rounded px-1">
              {Math.round(hoverMs)} ms
            </span>
          </div>
        )}

        {/* Keyframe diamonds + always-visible ms labels */}
        {anim.keyframes.map((k, i) => (
          <div key={k.id} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: msToPx(starts[i]) }}>
            <button
              onPointerDown={(e) => handlePointerDown(e, k.id, i)}
              className={`w-4 h-4 rotate-45 border-2 transition-colors ${
                selectedKeyframeId === k.id
                  ? 'bg-studio-accent border-studio-accent'
                  : 'bg-studio-panel border-studio-border2 hover:border-studio-accent'
              }`}
              title={`Keyframe ${i + 1} — Frame ${msToFrame(starts[i], fps)} · ${Math.round(starts[i])}ms`}
            />
            <span
              className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[10px] font-mono whitespace-nowrap ${
                selectedKeyframeId === k.id ? 'text-studio-accent' : 'text-studio-muted'
              }`}
            >
              {Math.round(starts[i])} ms
            </span>
          </div>
        ))}
      </div>

      {selected && (
        <div className="flex flex-col gap-2.5 studio-panel p-2.5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <span className="studio-label">Time (ms)</span>
              <input
                type="number"
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-24 disabled:opacity-50"
                min={0}
                disabled={selectedIndex === 0}
                value={Math.round(selectedStartMs)}
                onChange={(e) => setKeyframeAbsoluteTime(selected.id, Number(e.target.value))}
                title={selectedIndex === 0 ? 'The first keyframe is always pinned at 0ms' : undefined}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="studio-label">Frame</span>
              <input
                type="number"
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-20 disabled:opacity-50"
                min={0}
                disabled={selectedIndex === 0}
                value={msToFrame(selectedStartMs, fps)}
                onChange={(e) => setKeyframeAbsoluteTime(selected.id, (Number(e.target.value) / fps) * 1000)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="studio-label">Duration (ms)</span>
              <input
                type="number"
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-24"
                min={MIN_SEGMENT_MS}
                value={selected.duration}
                onChange={(e) => updateKeyframeDuration(selected.id, Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="studio-label">Easing (out to next keyframe)</span>
              <EasingPicker
                easing={selected.easing}
                customBezier={selected.customBezier}
                onChange={(easing, bezier) => updateKeyframeEasing(selected.id, easing, bezier)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-studio-muted border-t border-studio-border pt-2">
            <span>
              Keyframe {selectedIndex + 1} · Frame {msToFrame(selectedStartMs, fps)} · {Math.round(selectedStartMs)} ms
              {selected.styleOverrides.length > 0 && (
                <> · Overrides: {selected.styleOverrides.map(formatFieldLabel).join(', ')}</>
              )}
            </span>
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
                    {filteredExpressions.length === 0 && (
                      <span className="text-xs text-studio-muted p-2">No matching expressions.</span>
                    )}
                    {filteredExpressions.map((expr) => (
                      <button
                        key={expr.id}
                        className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-studio-panel2 text-left"
                        onClick={() => {
                          checkpoint()
                          applyExpressionToKeyframe(selected.id, expr.id, exprMode)
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
        </div>
      )}
    </div>
  )
}
