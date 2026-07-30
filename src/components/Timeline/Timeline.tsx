import { useEffect, useRef, useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import type { KeyframeTrackKind } from '@/state/store'
import type { Animation, SelectionItem, TrackKind } from '@/types'
import { TimelineToolbar } from './TimelineToolbar'
import { TimelineRuler } from './TimelineRuler'
import { TrackRow } from './TrackRow'
import { TimelineInspector } from './TimelineInspector'
import {
  MIN_PX_PER_MS,
  MAX_PX_PER_MS,
  TRACK_HEADER_WIDTH_PX,
  TRACK_ROW_HEIGHT_PX,
  computeFitPxPerMs,
  msToFrame,
  pxToMs,
  buildSnapCandidates,
  snapMs
} from './timelineMath'

const RULER_HEIGHT_PX = 24
const SNAP_TOLERANCE_PX = 8

function keyframeListForKind(anim: Animation, trackKind: KeyframeTrackKind) {
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

function itemKey(item: SelectionItem): string {
  return `${item.kind}:${item.trackId}:${item.id}`
}

/** Every keyframe/sticker/marker's own time on the active animation right now — used to build
 * snap candidates (excluding whatever's being dragged) and to find the previous/next keyframe
 * or clip edge for the toolbar's jump buttons. */
function collectAllTimes(anim: Animation, excludeKeys: Set<string>): number[] {
  const times: number[] = []
  const pushKfList = (trackId: string, list: { id: string; timeMs: number }[]) => {
    for (const k of list) if (!excludeKeys.has(`keyframe:${trackId}:${k.id}`)) times.push(k.timeMs)
  }
  pushKfList('pose', anim.keyframes)
  pushKfList('leftEye', anim.leftEyeKeyframes)
  pushKfList('rightEye', anim.rightEyeKeyframes)
  pushKfList('pupils', anim.pupilKeyframes)
  pushKfList('eyelids', anim.eyelidKeyframes)
  for (const s of anim.stickers) {
    if (!excludeKeys.has(`sticker:${s.trackId}:${s.id}`)) {
      times.push(s.anim.startTimeMs)
      if (s.anim.endTimeMs != null) times.push(s.anim.endTimeMs)
    }
  }
  for (const m of anim.markers) if (!excludeKeys.has(`marker:marker:${m.id}`)) times.push(m.timeMs)
  return times
}

function selectRangeOnTrack(anim: Animation, from: SelectionItem, to: SelectionItem): SelectionItem[] {
  if (from.kind !== to.kind || from.trackId !== to.trackId) return [to]
  if (to.kind === 'keyframe') {
    const list = keyframeListForKind(anim, to.trackId as KeyframeTrackKind)
    const t1 = list.find((k) => k.id === from.id)?.timeMs
    const t2 = list.find((k) => k.id === to.id)?.timeMs
    if (t1 == null || t2 == null) return [to]
    const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1]
    return list.filter((k) => k.timeMs >= lo && k.timeMs <= hi).map((k) => ({ kind: 'keyframe' as const, trackId: to.trackId, id: k.id }))
  }
  if (to.kind === 'sticker') {
    const list = anim.stickers.filter((s) => s.trackId === to.trackId)
    const t1 = list.find((s) => s.id === from.id)?.anim.startTimeMs
    const t2 = list.find((s) => s.id === to.id)?.anim.startTimeMs
    if (t1 == null || t2 == null) return [to]
    const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1]
    return list.filter((s) => s.anim.startTimeMs >= lo && s.anim.startTimeMs <= hi).map((s) => ({ kind: 'sticker' as const, trackId: s.trackId, id: s.id }))
  }
  const list = anim.markers
  const t1 = list.find((m) => m.id === from.id)?.timeMs
  const t2 = list.find((m) => m.id === to.id)?.timeMs
  if (t1 == null || t2 == null) return [to]
  const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1]
  return list.filter((m) => m.timeMs >= lo && m.timeMs <= hi).map((m) => ({ kind: 'marker' as const, trackId: 'marker', id: m.id }))
}

interface DragState {
  kind: 'move' | 'resize' | 'marquee'
  pointerId: number
  startClientX: number
  startClientY: number
  anchorTimeMs: number
  singleKeyframe?: { trackKind: KeyframeTrackKind; keyframeId: string }
  stickerId?: string
  edge?: 'start' | 'end'
  snapCandidates: number[]
  marqueeOriginX: number
  marqueeOriginY: number
}

/** The Animation Editor's CapCut-style multi-track timeline: a fixed toolbar, a scrollable
 * ruler+tracks area (Expression/Left Eye/Right Eye/Pupils/Eyelids/one-or-more Sticker tracks/
 * Markers), and a bottom inspector for whatever's currently selected. Owns all interaction
 * state (zoom, selection-drag, marquee) locally/via the store's timeline actions — see
 * state/store.ts's "timeline (multi-track)" section for the underlying data operations this
 * wires up. */
export function Timeline() {
  const anim = useStore(() => getActiveAnimation())
  const selection = useStore((s) => s.timelineSelection)
  const clipboard = useStore((s) => s.timelineClipboard)
  const snappingEnabled = useStore((s) => s.snappingEnabled)
  const fps = useStore((s) => s.project.display.fps)
  const playbackTimeMs = useStore((s) => s.playbackTimeMs)
  const mode = useStore((s) => s.mode)

  const checkpoint = useStore((s) => s.checkpoint)
  const seek = useStore((s) => s.seek)
  const pause = useStore((s) => s.pause)
  const setMode = useStore((s) => s.setMode)
  const setTimelineSelection = useStore((s) => s.setTimelineSelection)
  const toggleTimelineSelection = useStore((s) => s.toggleTimelineSelection)
  const clearTimelineSelection = useStore((s) => s.clearTimelineSelection)
  const setSnappingEnabled = useStore((s) => s.setSnappingEnabled)
  const setKeyframeTime = useStore((s) => s.setKeyframeTime)
  const moveSelectionByDelta = useStore((s) => s.moveSelectionByDelta)
  const resizeStickerClip = useStore((s) => s.resizeStickerClip)
  const splitClipAt = useStore((s) => s.splitClipAt)
  const copySelection = useStore((s) => s.copySelection)
  const pasteSelectionAt = useStore((s) => s.pasteSelectionAt)
  const duplicateSelection = useStore((s) => s.duplicateSelection)
  const deleteSelection = useStore((s) => s.deleteSelection)
  const addTrack = useStore((s) => s.addTrack)
  const removeTrack = useStore((s) => s.removeTrack)
  const setTrackVisible = useStore((s) => s.setTrackVisible)
  const setTrackLocked = useStore((s) => s.setTrackLocked)
  const reorderTrack = useStore((s) => s.reorderTrack)
  const renameTrack = useStore((s) => s.renameTrack)
  const detachTrackFromPose = useStore((s) => s.detachTrackFromPose)
  const addMarker = useStore((s) => s.addMarker)
  const addKeyframeAt = useStore((s) => s.addKeyframeAt)
  const addStickerToTrack = useStore((s) => s.addStickerToTrack)

  const contentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const lastPrimaryRef = useRef<SelectionItem | null>(null)

  const [pxPerMs, setPxPerMs] = useState(0.08)
  const [marqueeRect, setMarqueeRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // The yellow CapCut-style hover/scrub line — separate from the committed (orange) playhead
  // below. Tracks the mouse across the whole ruler+tracks area (not just the ruler strip), so
  // it works as a placement guide while dragging too (see handlePointerMove). Cleared on mouse
  // leave, but only when nothing is being dragged, so the drop-position guide doesn't vanish
  // mid-drag if the pointer briefly leaves the content area under pointer capture.
  const [hoverMs, setHoverMs] = useState<number | null>(null)

  // Zoom-to-fit once whenever the active animation changes (a fresh, sensible starting zoom
  // per animation, same spirit as the old Timeline always filling its container at 100%).
  const activeAnimId = anim?.id
  useEffect(() => {
    if (!anim || !contentRef.current) return
    const width = contentRef.current.parentElement?.getBoundingClientRect().width ?? 600
    setPxPerMs(computeFitPxPerMs(anim.durationMs, width - TRACK_HEADER_WIDTH_PX))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnimId])

  const isSelected = (kind: SelectionItem['kind'], trackId: string, id: string) => selection.some((i) => i.kind === kind && i.trackId === trackId && i.id === id)

  if (!anim) {
    return <div className="p-4 text-sm text-studio-muted">No animation selected.</div>
  }
  const activeAnim: Animation = anim

  const sortedTracks = [...activeAnim.tracks].sort((a, b) => a.order - b.order)
  const durationMs = Math.max(1, activeAnim.durationMs)

  function zoomToFit() {
    const width = contentRef.current?.parentElement?.getBoundingClientRect().width ?? 600
    setPxPerMs(computeFitPxPerMs(durationMs, width - TRACK_HEADER_WIDTH_PX))
  }

  function maybeSnap(rawMs: number, e: { altKey: boolean }): number {
    const drag = dragRef.current
    if (!drag || !snappingEnabled || e.altKey) return rawMs
    return snapMs(rawMs, drag.snapCandidates, pxToMs(SNAP_TOLERANCE_PX, pxPerMs))
  }

  function msFromClientX(clientX: number): number {
    if (!contentRef.current) return 0
    const rect = contentRef.current.getBoundingClientRect()
    return pxToMs(clientX - rect.left - TRACK_HEADER_WIDTH_PX, pxPerMs)
  }

  // The hover line snaps to frame boundaries (not the full clip/keyframe/playhead candidate
  // list a drag snaps to — there's nothing being placed yet, just the cursor) whenever
  // snapping is enabled, same Alt-to-disable-temporarily convention as every other drag/snap
  // interaction in the Timeline.
  function snapHoverMs(rawMs: number, altKey: boolean): number {
    if (!snappingEnabled || altKey) return rawMs
    const frameMs = 1000 / fps
    return Math.round(rawMs / frameMs) * frameMs
  }

  function handleContentMouseMove(e: React.MouseEvent) {
    const clamped = Math.max(0, Math.min(durationMs, msFromClientX(e.clientX)))
    setHoverMs(snapHoverMs(clamped, e.altKey))
  }

  function handleContentMouseLeave() {
    // Don't clear mid-drag — the pointer can leave contentRef briefly under pointer capture,
    // and the line should keep showing the drag's exact drop position until it ends.
    if (!dragRef.current) setHoverMs(null)
  }

  function updateSelectionOnClick(item: SelectionItem, e: React.PointerEvent) {
    const additive = e.ctrlKey || e.metaKey
    const range = e.shiftKey && lastPrimaryRef.current
    if (range && lastPrimaryRef.current) {
      setTimelineSelection(selectRangeOnTrack(activeAnim, lastPrimaryRef.current, item))
    } else if (additive) {
      toggleTimelineSelection(item, true)
    } else {
      const already = selection.some((i) => i.kind === item.kind && i.trackId === item.trackId && i.id === item.id)
      if (!already || selection.length <= 1) setTimelineSelection([item])
      // else: clicking an already-selected item within a larger group preserves the group,
      // so dragging one of several selected items moves all of them together.
    }
    lastPrimaryRef.current = item
  }

  function beginMoveDrag(item: SelectionItem, currentTimeMs: number, e: React.PointerEvent) {
    e.stopPropagation()
    updateSelectionOnClick(item, e)
    const resultingSelection = useStore.getState().timelineSelection
    checkpoint()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const excludeKeys = new Set(resultingSelection.map(itemKey))
    const single = resultingSelection.length === 1 && resultingSelection[0].kind === 'keyframe' ? resultingSelection[0] : null
    dragRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      anchorTimeMs: currentTimeMs,
      singleKeyframe: single ? { trackKind: single.trackId as KeyframeTrackKind, keyframeId: single.id } : undefined,
      snapCandidates: buildSnapCandidates(collectAllTimes(activeAnim, excludeKeys), playbackTimeMs, fps, durationMs),
      marqueeOriginX: 0,
      marqueeOriginY: 0
    }
  }

  function beginResizeDrag(stickerId: string, edge: 'start' | 'end', currentTimeMs: number, e: React.PointerEvent) {
    e.stopPropagation()
    const item: SelectionItem = { kind: 'sticker', trackId: activeAnim.stickers.find((s) => s.id === stickerId)?.trackId ?? '', id: stickerId }
    setTimelineSelection([item])
    checkpoint()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      anchorTimeMs: currentTimeMs,
      stickerId,
      edge,
      snapCandidates: buildSnapCandidates(collectAllTimes(activeAnim, new Set([itemKey(item)])), playbackTimeMs, fps, durationMs),
      marqueeOriginX: 0,
      marqueeOriginY: 0
    }
  }

  function beginMarquee(e: React.PointerEvent) {
    if (!contentRef.current) return
    const rect = contentRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) clearTimelineSelection()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'marquee',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      anchorTimeMs: 0,
      snapCandidates: [],
      marqueeOriginX: x,
      marqueeOriginY: y
    }
    setMarqueeRect({ x0: x, y0: y, x1: x, y1: y })
  }

  function applyMarqueeSelection(x0: number, y0: number, x1: number, y1: number) {
    const msLo = pxToMs(Math.min(x0, x1) - TRACK_HEADER_WIDTH_PX, pxPerMs)
    const msHi = pxToMs(Math.max(x0, x1) - TRACK_HEADER_WIDTH_PX, pxPerMs)
    const rowLo = Math.floor((Math.min(y0, y1) - RULER_HEIGHT_PX) / TRACK_ROW_HEIGHT_PX)
    const rowHi = Math.floor((Math.max(y0, y1) - RULER_HEIGHT_PX) / TRACK_ROW_HEIGHT_PX)
    const items: SelectionItem[] = []
    sortedTracks.forEach((track, rowIndex) => {
      if (rowIndex < rowLo || rowIndex > rowHi) return
      if (track.kind === 'sticker') {
        for (const s of activeAnim.stickers.filter((st) => st.trackId === track.id)) {
          const end = s.anim.endTimeMs ?? durationMs
          if (end >= msLo && s.anim.startTimeMs <= msHi) items.push({ kind: 'sticker', trackId: track.id, id: s.id })
        }
      } else if (track.kind === 'marker') {
        for (const m of activeAnim.markers) if (m.timeMs >= msLo && m.timeMs <= msHi) items.push({ kind: 'marker', trackId: 'marker', id: m.id })
      } else {
        for (const k of keyframeListForKind(activeAnim, track.kind as KeyframeTrackKind)) {
          if (k.timeMs >= msLo && k.timeMs <= msHi) items.push({ kind: 'keyframe', trackId: track.kind, id: k.id })
        }
      }
    })
    setTimelineSelection(items)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === 'marquee') {
      if (!contentRef.current) return
      const rect = contentRef.current.getBoundingClientRect()
      const x1 = e.clientX - rect.left
      const y1 = e.clientY - rect.top
      setMarqueeRect({ x0: drag.marqueeOriginX, y0: drag.marqueeOriginY, x1, y1 })
      applyMarqueeSelection(drag.marqueeOriginX, drag.marqueeOriginY, x1, y1)
      return
    }
    const deltaPx = e.clientX - drag.startClientX
    const rawMs = drag.anchorTimeMs + pxToMs(deltaPx, pxPerMs)
    const newMs = maybeSnap(rawMs, e)
    // The yellow line doubles as the drag's exact drop-position guide while moving/resizing —
    // separate from the committed (orange) playhead, which doesn't move until the drag ends.
    setHoverMs(Math.max(0, Math.min(durationMs, newMs)))
    if (drag.kind === 'resize' && drag.stickerId && drag.edge) {
      resizeStickerClip(drag.stickerId, drag.edge, newMs)
    } else if (drag.kind === 'move') {
      if (drag.singleKeyframe) {
        setKeyframeTime(drag.singleKeyframe.trackKind, drag.singleKeyframe.keyframeId, newMs)
      } else {
        moveSelectionByDelta(newMs - drag.anchorTimeMs)
      }
    }
  }

  function handlePointerUp() {
    dragRef.current = null
    setMarqueeRect(null)
  }

  function handleAddKeyframeFromToolbar() {
    const trackKind: KeyframeTrackKind = selection.length === 1 && selection[0].kind === 'keyframe' ? (selection[0].trackId as KeyframeTrackKind) : 'pose'
    addKeyframeAt(trackKind, playbackTimeMs)
  }

  function jumpToKeyframe(direction: 'prev' | 'next') {
    const times = Array.from(new Set(collectAllTimes(activeAnim, new Set()))).sort((a, b) => a - b)
    if (times.length === 0) return
    const current = playbackTimeMs
    const target =
      direction === 'next'
        ? times.find((t) => t > current + 0.5) ?? times[times.length - 1]
        : [...times].reverse().find((t) => t < current - 0.5) ?? times[0]
    pause()
    seek(target)
  }

  const hasSelection = selection.length > 0
  const canPaste = clipboard.length > 0

  function handleSplit() {
    if (selection.length === 0) return
    for (const item of selection) splitClipAt(item, playbackTimeMs)
  }

  function handleCut() {
    copySelection()
    deleteSelection()
  }

  function handlePaste() {
    pasteSelectionAt(playbackTimeMs)
  }

  const existingTrackKinds = new Set<TrackKind>(activeAnim.tracks.map((t) => t.kind))

  function handleStickerDrop(trackId: string, e: React.DragEvent) {
    e.preventDefault()
    const assetId = e.dataTransfer.getData('application/x-kibo-sticker-asset')
    if (!assetId) return
    const ms = msFromClientX(e.clientX)
    addStickerToTrack(trackId, assetId, Math.max(0, ms))
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 h-full min-h-0">
      <TimelineToolbar
        animName={anim.name}
        durationMs={durationMs}
        playbackTimeMs={playbackTimeMs}
        fps={fps}
        pxPerMs={pxPerMs}
        onZoomChange={(v) => setPxPerMs(Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, v)))}
        onZoomToFit={zoomToFit}
        snappingEnabled={snappingEnabled}
        onToggleSnapping={() => setSnappingEnabled(!snappingEnabled)}
        existingTrackKinds={existingTrackKinds}
        onAddTrack={(kind) => addTrack(kind)}
        onAddKeyframe={handleAddKeyframeFromToolbar}
        hasSelection={hasSelection}
        canPaste={canPaste}
        onSplit={handleSplit}
        onCopy={copySelection}
        onCut={handleCut}
        onPaste={handlePaste}
        onDuplicate={duplicateSelection}
        onDelete={deleteSelection}
        onJumpPrevKeyframe={() => jumpToKeyframe('prev')}
        onJumpNextKeyframe={() => jumpToKeyframe('next')}
      />

      <div className="flex-1 min-h-0 overflow-auto studio-panel">
        <div
          ref={contentRef}
          className="relative"
          style={{ width: TRACK_HEADER_WIDTH_PX + durationMs * pxPerMs }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onMouseMove={handleContentMouseMove}
          onMouseLeave={handleContentMouseLeave}
        >
          <div className="sticky top-0 z-20 flex bg-studio-panel">
            <div className="sticky left-0 z-30 shrink-0 border-r border-b border-studio-border bg-studio-panel" style={{ width: TRACK_HEADER_WIDTH_PX, height: RULER_HEIGHT_PX }} />
            <TimelineRuler
              durationMs={durationMs}
              pxPerMs={pxPerMs}
              onSeek={() => {
                if (mode !== 'animate') setMode('animate')
                pause()
                seek(hoverMs ?? 0)
              }}
            />
          </div>

          {sortedTracks.map((track) => {
            if (track.kind === 'sticker') {
              return (
                <div
                  key={track.id}
                  onPointerDown={beginMarquee}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }}
                  onDrop={(e) => handleStickerDrop(track.id, e)}
                >
                  <TrackRow
                    track={track}
                    pxPerMs={pxPerMs}
                    durationMs={durationMs}
                    fps={fps}
                    stickers={anim.stickers.filter((s) => s.trackId === track.id)}
                    isSelected={(id) => isSelected('sticker', track.id, id)}
                    onStickerBodyPointerDown={(id, e) => beginMoveDrag({ kind: 'sticker', trackId: track.id, id }, anim.stickers.find((s) => s.id === id)!.anim.startTimeMs, e)}
                    onStickerHandlePointerDown={(id, edge, e) => {
                      const s = anim.stickers.find((st) => st.id === id)!
                      beginResizeDrag(id, edge, edge === 'start' ? s.anim.startTimeMs : s.anim.endTimeMs ?? durationMs, e)
                    }}
                    onToggleVisible={() => setTrackVisible(track.id, !track.visible)}
                    onToggleLocked={() => setTrackLocked(track.id, !track.locked)}
                    onRemove={() => removeTrack(track.id)}
                    onRename={(name) => renameTrack(track.id, name)}
                    onMoveUp={track.order > 0 ? () => reorderTrack(track.id, track.order - 1) : undefined}
                    onMoveDown={track.order < sortedTracks.length - 1 ? () => reorderTrack(track.id, track.order + 1) : undefined}
                    onAddStickerAsset={(assetId) => addStickerToTrack(track.id, assetId, playbackTimeMs)}
                  />
                </div>
              )
            }
            if (track.kind === 'marker') {
              return (
                <div
                  key={track.id}
                  onPointerDown={beginMarquee}
                  onDoubleClick={(e) => {
                    if (!contentRef.current) return
                    const rect = contentRef.current.getBoundingClientRect()
                    const ms = pxToMs(e.clientX - rect.left - TRACK_HEADER_WIDTH_PX, pxPerMs)
                    addMarker(Math.max(0, ms))
                  }}
                >
                  <TrackRow
                    track={track}
                    pxPerMs={pxPerMs}
                    durationMs={durationMs}
                    fps={fps}
                    markers={anim.markers}
                    isSelected={(id) => isSelected('marker', 'marker', id)}
                    onMarkerPointerDown={(id, e) => beginMoveDrag({ kind: 'marker', trackId: 'marker', id }, anim.markers.find((m) => m.id === id)!.timeMs, e)}
                    onToggleVisible={() => setTrackVisible(track.id, !track.visible)}
                    onToggleLocked={() => setTrackLocked(track.id, !track.locked)}
                    onRemove={() => removeTrack(track.id)}
                    onMoveUp={track.order > 0 ? () => reorderTrack(track.id, track.order - 1) : undefined}
                    onMoveDown={track.order < sortedTracks.length - 1 ? () => reorderTrack(track.id, track.order + 1) : undefined}
                  />
                </div>
              )
            }
            const trackKind = track.kind as KeyframeTrackKind
            const keyframes = keyframeListForKind(anim, trackKind)
            const canDetach = trackKind !== 'pose'
            return (
              <div
                key={track.id}
                onPointerDown={beginMarquee}
                onDoubleClick={(e) => {
                  if (!contentRef.current) return
                  const rect = contentRef.current.getBoundingClientRect()
                  const ms = pxToMs(e.clientX - rect.left - TRACK_HEADER_WIDTH_PX, pxPerMs)
                  addKeyframeAt(trackKind, Math.max(0, ms))
                }}
              >
                <TrackRow
                  track={track}
                  pxPerMs={pxPerMs}
                  durationMs={durationMs}
                  fps={fps}
                  keyframes={keyframes}
                  isSelected={(id) => isSelected('keyframe', trackKind, id)}
                  onKeyframePointerDown={(tk, id, t, e) => beginMoveDrag({ kind: 'keyframe', trackId: tk, id }, t, e)}
                  onToggleVisible={() => setTrackVisible(track.id, !track.visible)}
                  onToggleLocked={() => setTrackLocked(track.id, !track.locked)}
                  onRemove={canDetach ? () => removeTrack(track.id) : undefined}
                  onMoveUp={track.order > 0 ? () => reorderTrack(track.id, track.order - 1) : undefined}
                  onMoveDown={track.order < sortedTracks.length - 1 ? () => reorderTrack(track.id, track.order + 1) : undefined}
                  canDetach={canDetach}
                  onDetach={canDetach ? () => detachTrackFromPose(anim.id, trackKind as Exclude<KeyframeTrackKind, 'pose'>) : undefined}
                />
              </div>
            )
          })}

          {/* Playhead — spans the full ruler+tracks height, drawn last so it's always on top. */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-studio-warn pointer-events-none z-40"
            style={{ left: TRACK_HEADER_WIDTH_PX + Math.min(playbackTimeMs, durationMs) * pxPerMs }}
          />

          {/* Yellow CapCut-style hover/scrub line — a mouse-position and drag-placement guide,
              distinct from the (orange) playhead above: it never moves the playhead itself,
              it just shows where a click or drop would land. Spans the full height like the
              playhead so it reads clearly across every track, not just the ruler. */}
          {hoverMs !== null && (
            <div className="absolute top-0 bottom-0 w-px bg-yellow-400 pointer-events-none z-50" style={{ left: TRACK_HEADER_WIDTH_PX + hoverMs * pxPerMs }}>
              <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[10px] font-mono text-yellow-400 whitespace-nowrap bg-studio-panel border border-studio-border rounded px-1 py-0.5 leading-tight text-center">
                {Math.round(hoverMs)} ms
                <br />
                Frame {msToFrame(hoverMs, fps)}
              </span>
            </div>
          )}

          {marqueeRect && (
            <div
              className="absolute border border-studio-accent bg-studio-accent/15 pointer-events-none z-40"
              style={{
                left: Math.min(marqueeRect.x0, marqueeRect.x1),
                top: Math.min(marqueeRect.y0, marqueeRect.y1),
                width: Math.abs(marqueeRect.x1 - marqueeRect.x0),
                height: Math.abs(marqueeRect.y1 - marqueeRect.y0)
              }}
            />
          )}
        </div>
      </div>

      <TimelineInspector />
    </div>
  )
}
