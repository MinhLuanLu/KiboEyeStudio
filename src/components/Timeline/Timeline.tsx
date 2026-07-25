import { useRef, useCallback } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import { animationDuration, keyframeStartTimes } from '@/engine/interpolate'
import { EasingPicker } from './EasingPicker'

const MIN_SEGMENT_MS = 16

export function Timeline() {
  const anim = useStore(() => getActiveAnimation())
  const selectedKeyframeId = useStore((s) => s.selectedKeyframeId)
  const selectKeyframe = useStore((s) => s.selectKeyframe)
  const addKeyframe = useStore((s) => s.addKeyframe)
  const duplicateKeyframe = useStore((s) => s.duplicateKeyframe)
  const deleteKeyframe = useStore((s) => s.deleteKeyframe)
  const updateKeyframeDuration = useStore((s) => s.updateKeyframeDuration)
  const updateKeyframeEasing = useStore((s) => s.updateKeyframeEasing)
  const checkpoint = useStore((s) => s.checkpoint)
  const seek = useStore((s) => s.seek)
  const pause = useStore((s) => s.pause)
  const setMode = useStore((s) => s.setMode)
  const playbackTimeMs = useStore((s) => s.playbackTimeMs)
  const mode = useStore((s) => s.mode)

  const trackRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ keyframeId: string; startPx: number; startDuration: number; prevDuration: number } | null>(null)

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

  const selected = anim.keyframes.find((k) => k.id === selectedKeyframeId)
  const playheadPx = msToPx(Math.min(playbackTimeMs, total))

  return (
    <div className="flex flex-col gap-3 p-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{anim.name}</span>
          <span className="text-studio-muted text-xs font-mono">{Math.round(total)}ms</span>
        </div>
        <div className="flex gap-1.5">
          <button className="studio-btn" onClick={() => addKeyframe(selectedKeyframeId ?? undefined)}>
            + Keyframe
          </button>
          <button className="studio-btn" disabled={!selected} onClick={() => selected && duplicateKeyframe(selected.id)}>
            Duplicate
          </button>
          <button
            className="studio-btn"
            disabled={!selected || anim.keyframes.length <= 1}
            onClick={() => selected && deleteKeyframe(selected.id)}
          >
            Delete
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="relative h-14 bg-studio-panel2 rounded-md border border-studio-border cursor-pointer"
        onClick={handleTrackClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
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

        {/* Keyframe diamonds */}
        {anim.keyframes.map((k, i) => (
          <button
            key={k.id}
            onPointerDown={(e) => handlePointerDown(e, k.id, i)}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-2 transition-colors ${
              selectedKeyframeId === k.id
                ? 'bg-studio-accent border-studio-accent'
                : 'bg-studio-panel border-studio-border2 hover:border-studio-accent'
            }`}
            style={{ left: msToPx(starts[i]) }}
            title={`Keyframe ${i + 1} — ${Math.round(starts[i])}ms`}
          />
        ))}
      </div>

      {selected && (
        <div className="flex items-center gap-4 studio-panel p-2.5">
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
      )}
    </div>
  )
}
