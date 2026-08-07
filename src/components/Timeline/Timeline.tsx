import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, getActiveAnimation, isComboTimelineActive } from '@/state/store'
import type { KeyframeTrackKind } from '@/state/store'
import type { Animation, SelectionItem, TrackKind } from '@/types'
import { computeComboTimeline, sampleCombo, type ComboTimeline } from '@/engine/comboPlayback'
import { TimelineToolbar } from './TimelineToolbar'
import { TimelineRuler } from './TimelineRuler'
import { TrackRow, type ComboClipLayout } from './TrackRow'
import { TimelineInspector } from './TimelineInspector'
import {
  TRACK_HEADER_WIDTH_PX,
  TRACK_ROW_HEIGHT_PX,
  computeFitPxPerMs,
  clampPxPerMs,
  msToFrame,
  pxToMs,
  buildSnapCandidates,
  snapMs
} from './timelineMath'

const RULER_HEIGHT_PX = 24
const SNAP_TOLERANCE_PX = 8
/** Pixels the pointer must travel after pressing a keyframe/clip before it starts moving —
 * a plain click (below this) only selects, so keyframes never shift when the user just meant
 * to select one. */
const DRAG_THRESHOLD_PX = 5
/** Auto-scroll while dragging: how close (px) to the visible track area's left/right edge the
 * pointer must get before the timeline starts scrolling, and the max scroll speed (px/frame). */
const EDGE_SCROLL_ZONE_PX = 44
const EDGE_SCROLL_MAX_PX = 22

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

/** Every Combination clip's own start/end on the combo's timeline right now — the comboClip
 * counterpart of collectAllTimes above, used to build snap candidates while dragging a clip in
 * combo-editing mode. `excludeClipIds` are plain clip ids (not full itemKey()s — a combo's
 * clips are unique by id within their own combo, so there's no need for the kind/trackId
 * prefix collectAllTimes' keys use for keyframes-across-tracks). */
function collectComboClipTimes(timeline: ComboTimeline, excludeClipIds: Set<string>): number[] {
  const times: number[] = []
  for (const entry of timeline.clips) {
    if (excludeClipIds.has(entry.clip.id)) continue
    times.push(entry.start, entry.end)
  }
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
  /** False until the pointer has passed DRAG_THRESHOLD_PX — a move drag applies nothing (and
   * takes no undo checkpoint) while unarmed, so a click that never crosses the threshold is a
   * pure selection. Resize/marquee arm immediately (deliberate handle/box gestures). */
  armed: boolean
  /** Last committed snapped time for a multi-select move — moveSelectionByDelta is applied as
   * the *increment* since this value (not the total since drag start), so repeated calls (incl.
   * auto-scroll frames) never accumulate and relative spacing between keyframes is preserved. */
  lastMs: number
  singleKeyframe?: { trackKind: KeyframeTrackKind; keyframeId: string }
  stickerId?: string
  comboClipId?: string
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
  const snapIntervalMs = useStore((s) => s.snapIntervalMs)
  const fps = useStore((s) => s.project.display.fps)
  const playbackTimeMs = useStore((s) => s.playbackTimeMs)
  const mode = useStore((s) => s.mode)
  const playbackState = useStore((s) => s.playbackState)
  const leftTab = useStore((s) => s.leftTab)
  const selectedComboId = useStore((s) => s.selectedComboId)
  const combos = useStore((s) => s.project.animationCombos)
  const animations = useStore((s) => s.project.animations)
  const comboPreviewTimeMs = useStore((s) => s.comboPreviewTimeMs)
  const comboPreviewLoop = useStore((s) => s.comboPreviewLoop)

  const checkpoint = useStore((s) => s.checkpoint)
  const seek = useStore((s) => s.seek)
  const pause = useStore((s) => s.pause)
  const setMode = useStore((s) => s.setMode)
  const setTimelineSelection = useStore((s) => s.setTimelineSelection)
  const toggleTimelineSelection = useStore((s) => s.toggleTimelineSelection)
  const clearTimelineSelection = useStore((s) => s.clearTimelineSelection)
  const setSnappingEnabled = useStore((s) => s.setSnappingEnabled)
  const setSnapIntervalMs = useStore((s) => s.setSnapIntervalMs)
  const setAnimationDuration = useStore((s) => s.setAnimationDuration)
  const setKeyframeTime = useStore((s) => s.setKeyframeTime)
  const moveSelectionByDelta = useStore((s) => s.moveSelectionByDelta)
  const resizeStickerClip = useStore((s) => s.resizeStickerClip)
  const resizeComboClip = useStore((s) => s.resizeComboClip)
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
  const setComboPreviewTimeMs = useStore((s) => s.setComboPreviewTimeMs)
  const setComboPreviewLoop = useStore((s) => s.setComboPreviewLoop)
  const selectAnimationComboClip = useStore((s) => s.selectAnimationComboClip)
  const addAnimationComboClip = useStore((s) => s.addAnimationComboClip)

  const contentRef = useRef<HTMLDivElement>(null)
  // The scrollable viewport around the ruler+tracks — used for Ctrl+wheel zoom-around-cursor
  // and for auto-scrolling while a drag nears either edge.
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const lastPrimaryRef = useRef<SelectionItem | null>(null)
  // rAF handle for the active edge-auto-scroll loop, the pointer's last position (so the loop
  // can keep the dragged item under the cursor as content scrolls), and a one-shot scrollLeft
  // to apply right after a Ctrl+wheel zoom re-renders at the new pxPerMs (keeps the cursor's
  // time fixed on screen).
  const edgeRafRef = useRef<number | null>(null)
  const lastPointerRef = useRef<{ clientX: number; altKey: boolean }>({ clientX: 0, altKey: false })
  const pendingScrollRef = useRef<number | null>(null)

  const [pxPerMs, setPxPerMs] = useState(0.08)
  const [marqueeRect, setMarqueeRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // The yellow CapCut-style hover/scrub line — separate from the committed (orange) playhead
  // below. Tracks the mouse across the whole ruler+tracks area (not just the ruler strip), so
  // it works as a placement guide while dragging too (see handlePointerMove). Cleared on mouse
  // leave, but only when nothing is being dragged, so the drop-position guide doesn't vanish
  // mid-drag if the pointer briefly leaves the content area under pointer capture.
  const [hoverMs, setHoverMs] = useState<number | null>(null)

  // Single source of truth for "is this Timeline currently editing a Combination instead of
  // the active Animation" — the exact same predicate PreviewCanvas uses to decide what the
  // shared center canvas renders, so the bottom Timeline and the canvas can never disagree
  // about which mode is active (see isComboTimelineActive's own comment in store.ts).
  const comboMode = isComboTimelineActive({ leftTab, selectedComboId, mode, playbackState })
  const combo = comboMode ? (combos.find((c) => c.id === selectedComboId) ?? null) : null
  const comboTimeline = combo ? computeComboTimeline(combo, animations) : null
  // The active clip — whichever one sampleCombo() says is currently playing — computed via the
  // exact same function PreviewCanvas's rAF loop samples from, so the Timeline's highlighted
  // clip can never drift out of sync with what's actually rendering on screen.
  const comboActiveClipId = comboTimeline ? (sampleCombo(comboTimeline, comboPreviewTimeMs, combo?.loop ?? false)?.clipId ?? null) : null

  // Zoom-to-fit once whenever the active animation OR the active combo changes (a fresh,
  // sensible starting zoom per thing-being-edited, same spirit as the old Timeline always
  // filling its container at 100%).
  const activeAnimId = anim?.id
  useEffect(() => {
    if (!contentRef.current) return
    if (comboMode && !comboTimeline) return
    if (!comboMode && !anim) return
    const width = contentRef.current.parentElement?.getBoundingClientRect().width ?? 600
    const fitDurationMs = comboMode && comboTimeline ? comboTimeline.total : (anim?.durationMs ?? 1)
    setPxPerMs(computeFitPxPerMs(fitDurationMs, width - TRACK_HEADER_WIDTH_PX))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnimId, comboMode, selectedComboId])

  // Belt-and-suspenders: selectAnimationCombo already clears timelineSelection/timelineClipboard
  // when a combo is explicitly selected, but leftTab can also flip (e.g. clicking back to the
  // Animations tab) without a fresh selectAnimationCombo call — clearing here on every comboMode
  // transition guarantees a stale keyframe-kind or comboClip-kind selection never survives a
  // mode switch either direction.
  useEffect(() => {
    clearTimelineSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboMode])

  // Ctrl/Cmd + mouse wheel over the timeline zooms in/out around the cursor (keeping whatever
  // time is under the pointer fixed on screen), while a plain wheel keeps scrolling normally.
  // Attached natively with { passive: false } so preventDefault actually suppresses the browser
  // zoom/scroll — React's synthetic onWheel can't guarantee a non-passive listener.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorViewportX = e.clientX - rect.left
      const contentX = el.scrollLeft + cursorViewportX
      const msAtCursor = pxToMs(contentX - TRACK_HEADER_WIDTH_PX, pxPerMs)
      const factor = Math.exp(-e.deltaY * 0.0015)
      const next = clampPxPerMs(pxPerMs * factor)
      if (next === pxPerMs) return
      // Keep msAtCursor under the same viewport x after the re-render at the new scale.
      pendingScrollRef.current = TRACK_HEADER_WIDTH_PX + msAtCursor * next - cursorViewportX
      setPxPerMs(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pxPerMs])

  // Apply the one-shot scrollLeft computed by a Ctrl+wheel zoom, after the re-render has laid
  // out the content at the new width — so the zoom stays anchored on the cursor.
  useLayoutEffect(() => {
    if (pendingScrollRef.current != null && scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, pendingScrollRef.current)
      pendingScrollRef.current = null
    }
  }, [pxPerMs])

  // Stop any in-flight edge auto-scroll loop if the Timeline unmounts mid-drag.
  useEffect(() => {
    return () => {
      if (edgeRafRef.current != null) cancelAnimationFrame(edgeRafRef.current)
    }
  }, [])

  const isSelected = (kind: SelectionItem['kind'], trackId: string, id: string) => selection.some((i) => i.kind === kind && i.trackId === trackId && i.id === id)

  // `anim` is required unconditionally, even in combo mode — every project always has at least
  // one animation in practice (mirrors the assumption AnimationCombinationPanel's own animation
  // picker already makes), so keeping this guard simple/non-null avoids threading optional
  // chaining through every animation-mode-only code path below (all of which are unreachable,
  // not merely unused, while comboMode is true).
  if (!anim) {
    return <div className="p-4 text-sm text-studio-muted">No animation selected.</div>
  }
  const activeAnim: Animation = anim

  const sortedTracks = [...activeAnim.tracks].sort((a, b) => a.order - b.order)
  const durationMs = comboMode && comboTimeline ? Math.max(1, comboTimeline.total) : Math.max(1, activeAnim.durationMs)
  // The single playhead position the ruler/tracks/toolbar all read — Animate-mode's own
  // playbackTimeMs while editing an animation, or the combo's own separate preview clock while
  // editing a Combination (see comboPreviewTimeMs's own comment in store.ts for why it's kept
  // deliberately separate from playbackTimeMs).
  const playheadMs = comboMode ? comboPreviewTimeMs : playbackTimeMs

  function zoomToFit() {
    const width = contentRef.current?.parentElement?.getBoundingClientRect().width ?? 600
    setPxPerMs(computeFitPxPerMs(durationMs, width - TRACK_HEADER_WIDTH_PX))
  }

  /** Seeks the currently-relevant playhead — Animate-mode's shared seek() (which also stops
   * playback and switches `mode`) while editing an animation, or just comboPreviewTimeMs while
   * editing a Combination (deliberately leaves `mode`/`playbackState` untouched, matching how
   * combo preview has always been independent of Animate-mode playback). */
  function seekPlayhead(ms: number) {
    if (comboMode) {
      setComboPreviewTimeMs(ms)
    } else {
      if (mode !== 'animate') setMode('animate')
      pause()
      seek(ms)
    }
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
    const gridMs = snapIntervalMs > 0 ? snapIntervalMs : 1000 / fps
    return Math.round(rawMs / gridMs) * gridMs
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
    // Shift-click range-select isn't implemented for combo clips this pass (only single-click,
    // Ctrl/Cmd-click-additive, and marquee) — selectRangeOnTrack's track-position math is
    // keyframe/sticker/marker-specific (keyed off Animation track order), so combo mode simply
    // falls through to the additive/single branches below instead.
    const range = !comboMode && e.shiftKey && lastPrimaryRef.current
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
    // No checkpoint here — a move drag is only committed (and only checkpointed) once the
    // pointer actually passes DRAG_THRESHOLD_PX (see handlePointerMove), so a plain click that
    // just selects a keyframe never creates an undo entry or nudges its time.
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const excludeKeys = new Set(resultingSelection.map(itemKey))
    const single = resultingSelection.length === 1 && resultingSelection[0].kind === 'keyframe' ? resultingSelection[0] : null
    const snapCandidates =
      comboMode && comboTimeline
        ? buildSnapCandidates(
            collectComboClipTimes(comboTimeline, new Set(resultingSelection.filter((i) => i.kind === 'comboClip').map((i) => i.id))),
            playheadMs,
            fps,
            durationMs,
            snapIntervalMs
          )
        : buildSnapCandidates(collectAllTimes(activeAnim, excludeKeys), playbackTimeMs, fps, durationMs, snapIntervalMs)
    dragRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      anchorTimeMs: currentTimeMs,
      armed: false,
      lastMs: currentTimeMs,
      singleKeyframe: single ? { trackKind: single.trackId as KeyframeTrackKind, keyframeId: single.id } : undefined,
      snapCandidates,
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
      armed: true,
      lastMs: currentTimeMs,
      stickerId,
      edge,
      snapCandidates: buildSnapCandidates(collectAllTimes(activeAnim, new Set([itemKey(item)])), playbackTimeMs, fps, durationMs, snapIntervalMs),
      marqueeOriginX: 0,
      marqueeOriginY: 0
    }
  }

  /** The combo-editing sibling of beginResizeDrag — same shape, sourced from the combo's own
   * clips instead of an Animation's stickers, and calling resizeComboClip (see its own comment
   * in store.ts for the loop-count-based "trim" semantics) instead of resizeStickerClip. */
  function beginComboClipResizeDrag(clipId: string, edge: 'start' | 'end', currentTimeMs: number, e: React.PointerEvent) {
    if (!combo) return
    e.stopPropagation()
    const item: SelectionItem = { kind: 'comboClip', trackId: combo.id, id: clipId }
    setTimelineSelection([item])
    checkpoint()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      anchorTimeMs: currentTimeMs,
      armed: true,
      lastMs: currentTimeMs,
      comboClipId: clipId,
      edge,
      snapCandidates: comboTimeline ? buildSnapCandidates(collectComboClipTimes(comboTimeline, new Set([clipId])), playheadMs, fps, durationMs, snapIntervalMs) : [],
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
      armed: true,
      lastMs: 0,
      snapCandidates: [],
      marqueeOriginX: x,
      marqueeOriginY: y
    }
    setMarqueeRect({ x0: x, y0: y, x1: x, y1: y })
  }

  function applyMarqueeSelection(x0: number, y0: number, x1: number, y1: number) {
    const msLo = pxToMs(Math.min(x0, x1) - TRACK_HEADER_WIDTH_PX, pxPerMs)
    const msHi = pxToMs(Math.max(x0, x1) - TRACK_HEADER_WIDTH_PX, pxPerMs)
    if (comboMode) {
      // Only ever one synthetic row in combo mode, so no row-index bounds check is needed —
      // any clip whose [start,end] overlaps the marquee's horizontal span is a match.
      if (!combo || !comboTimeline) {
        setTimelineSelection([])
        return
      }
      const comboItems: SelectionItem[] = []
      for (const entry of comboTimeline.clips) {
        if (entry.end >= msLo && entry.start <= msHi) comboItems.push({ kind: 'comboClip', trackId: combo.id, id: entry.clip.id })
      }
      setTimelineSelection(comboItems)
      return
    }
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

  /** Applies one move/resize step at the given pointer X. Factored out so both live pointer
   * moves and the edge auto-scroll rAF loop drive the drag through exactly the same math. */
  function applyDragAt(clientX: number, altKey: boolean) {
    const drag = dragRef.current
    if (!drag || drag.kind === 'marquee') return
    const deltaPx = clientX - drag.startClientX
    const rawMs = drag.anchorTimeMs + pxToMs(deltaPx, pxPerMs)
    const newMs = maybeSnap(rawMs, { altKey })
    // The yellow line doubles as the drag's exact drop-position guide while moving/resizing —
    // separate from the committed (orange) playhead, which doesn't move until the drag ends.
    setHoverMs(Math.max(0, Math.min(durationMs, newMs)))
    if (drag.kind === 'resize' && drag.stickerId && drag.edge) {
      resizeStickerClip(drag.stickerId, drag.edge, newMs)
    } else if (drag.kind === 'resize' && drag.comboClipId && drag.edge && combo) {
      resizeComboClip(combo.id, drag.comboClipId, drag.edge, newMs)
    } else if (drag.kind === 'move') {
      if (drag.singleKeyframe) {
        setKeyframeTime(drag.singleKeyframe.trackKind, drag.singleKeyframe.keyframeId, newMs)
      } else {
        // Apply only the increment since the last committed position (not the total since the
        // grab) so repeated calls never accumulate — this keeps multi-select spacing exact and
        // makes the auto-scroll loop's extra calls harmless.
        moveSelectionByDelta(newMs - drag.lastMs)
      }
      drag.lastMs = newMs
    }
  }

  /** Starts (if not already running) the rAF loop that scrolls the timeline while an armed
   * move/resize drag holds the pointer near either edge of the visible track area, re-applying
   * the drag each scrolled frame so the item keeps following the cursor across a long animation
   * without the user having to stop and scroll by hand. Self-terminates when the drag ends. */
  function ensureEdgeScroll() {
    if (edgeRafRef.current != null) return
    const step = () => {
      const drag = dragRef.current
      const el = scrollRef.current
      if (!drag || drag.kind === 'marquee' || !drag.armed || !el) {
        edgeRafRef.current = null
        return
      }
      const rect = el.getBoundingClientRect()
      const x = lastPointerRef.current.clientX
      // The left EDGE_SCROLL_ZONE begins just past the sticky track-header column, which always
      // overlays the viewport's left edge.
      const leftBound = rect.left + TRACK_HEADER_WIDTH_PX + EDGE_SCROLL_ZONE_PX
      const rightBound = rect.right - EDGE_SCROLL_ZONE_PX
      let dx = 0
      if (x < leftBound) dx = -Math.min(1, (leftBound - x) / EDGE_SCROLL_ZONE_PX) * EDGE_SCROLL_MAX_PX
      else if (x > rightBound) dx = Math.min(1, (x - rightBound) / EDGE_SCROLL_ZONE_PX) * EDGE_SCROLL_MAX_PX
      if (dx !== 0) {
        const before = el.scrollLeft
        el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + dx))
        if (el.scrollLeft !== before) applyDragAt(x, lastPointerRef.current.altKey)
      }
      edgeRafRef.current = requestAnimationFrame(step)
    }
    edgeRafRef.current = requestAnimationFrame(step)
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
    lastPointerRef.current = { clientX: e.clientX, altKey: e.altKey }
    if (!drag.armed) {
      // A move drag doesn't start until the pointer travels past the threshold — below it, the
      // press was just a selection (already applied on pointer-down).
      const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
      if (dist < DRAG_THRESHOLD_PX) return
      drag.armed = true
      checkpoint()
    }
    ensureEdgeScroll()
    applyDragAt(e.clientX, e.altKey)
  }

  function handlePointerUp() {
    if (edgeRafRef.current != null) {
      cancelAnimationFrame(edgeRafRef.current)
      edgeRafRef.current = null
    }
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
    pasteSelectionAt(playheadMs)
  }

  const existingTrackKinds = new Set<TrackKind>(activeAnim.tracks.map((t) => t.kind))

  function handleStickerDrop(trackId: string, e: React.DragEvent) {
    e.preventDefault()
    const assetId = e.dataTransfer.getData('application/x-kibo-sticker-asset')
    if (!assetId) return
    const ms = msFromClientX(e.clientX)
    addStickerToTrack(trackId, assetId, Math.max(0, ms))
  }

  /** The Timeline's own "+ Clip" control for combo mode (mirrors "+ Keyframe" for animation
   * mode) — appends a new clip referencing `animationId` right after the combo's current last
   * clip, at that animation's own default duration (see addAnimationComboClip's own comment),
   * then selects it so it's immediately visible/editable in the Inspector below. */
  function handleAddComboClip(animationId: string) {
    if (!combo || !animationId) return
    checkpoint()
    const newId = addAnimationComboClip(combo.id, animationId)
    setTimelineSelection([{ kind: 'comboClip', trackId: combo.id, id: newId }])
    selectAnimationComboClip(newId)
  }

  const comboClipLayouts: ComboClipLayout[] = comboTimeline
    ? comboTimeline.clips.map((entry) => ({
        id: entry.clip.id,
        startMs: entry.start,
        durationMs: entry.dur,
        label: `${entry.anim?.name ?? 'Missing animation'} — ${Math.round(entry.start)}ms · ${Math.round(entry.dur)}ms · x${entry.clip.loopCount} · ${entry.clip.playbackSpeed}%`,
        active: entry.clip.id === comboActiveClipId
      }))
    : []
  // Synthetic, non-persisted Track — a Combination has no Track[]/lane concept of its own (see
  // TrackKind's own comment), so this is built fresh each render purely for TrackRow/ClipView's
  // shared rendering path.
  const comboTrack = combo ? { id: combo.id, kind: 'comboClip' as const, name: combo.name, order: 0, visible: true, locked: false } : null

  return (
    <div className="flex flex-col gap-1.5 p-2 h-full min-h-0">
      <TimelineToolbar
        variant={comboMode ? 'combo' : 'animation'}
        animName={comboMode ? (combo?.name ?? 'Combination') : anim.name}
        durationMs={durationMs}
        playbackTimeMs={playheadMs}
        fps={fps}
        pxPerMs={pxPerMs}
        onDurationChange={(ms) => setAnimationDuration(ms)}
        onZoomChange={(v) => setPxPerMs(clampPxPerMs(v))}
        onZoomToFit={zoomToFit}
        snappingEnabled={snappingEnabled}
        snapIntervalMs={snapIntervalMs}
        onSnapChange={(modeStr) => {
          if (modeStr === 'off') {
            setSnappingEnabled(false)
          } else {
            setSnappingEnabled(true)
            setSnapIntervalMs(modeStr === 'frame' ? 0 : Number(modeStr))
          }
        }}
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
        comboAnimations={comboMode ? animations : undefined}
        onAddComboClip={comboMode ? handleAddComboClip : undefined}
        comboLoop={comboMode ? comboPreviewLoop : undefined}
        onToggleComboLoop={comboMode ? () => setComboPreviewLoop(!comboPreviewLoop) : undefined}
      />

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto studio-panel">
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
            <TimelineRuler durationMs={durationMs} pxPerMs={pxPerMs} onSeek={() => seekPlayhead(hoverMs ?? 0)} />
          </div>

          {comboMode && comboTrack && (
            <div key={comboTrack.id} onPointerDown={beginMarquee}>
              <TrackRow
                track={comboTrack}
                pxPerMs={pxPerMs}
                durationMs={durationMs}
                fps={fps}
                comboClips={comboClipLayouts}
                isSelected={(id) => isSelected('comboClip', comboTrack.id, id)}
                onComboClipBodyPointerDown={(id, e) => beginMoveDrag({ kind: 'comboClip', trackId: comboTrack.id, id }, comboClipLayouts.find((c) => c.id === id)?.startMs ?? 0, e)}
                onComboClipHandlePointerDown={(id, edge, e) => {
                  const c = comboClipLayouts.find((cc) => cc.id === id)
                  beginComboClipResizeDrag(id, edge, edge === 'start' ? (c?.startMs ?? 0) : (c ? c.startMs + c.durationMs : 0), e)
                }}
                onToggleVisible={() => {}}
                onToggleLocked={() => {}}
              />
            </div>
          )}

          {!comboMode && sortedTracks.map((track) => {
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

          {/* Playhead — spans the full ruler+tracks height, drawn last so it's always on top.
              Position tracks playheadMs (playbackTimeMs in animation mode, comboPreviewTimeMs
              in combo mode), so it's always the same clock the shared center canvas is
              rendering from. */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-studio-warn pointer-events-none z-40"
            style={{ left: TRACK_HEADER_WIDTH_PX + Math.min(playheadMs, durationMs) * pxPerMs }}
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
