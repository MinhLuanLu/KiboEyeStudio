import type { TrackKind } from '@/types'

/** Pixels-per-millisecond <-> millisecond conversions, all pure — shared by the ruler, every
 * track body, drag math, and snapping so "where is X on screen" is computed exactly once. All
 * of these are relative to the scrollable track content's own left edge (x=0 is t=0ms), not
 * the viewport — callers add/subtract scroll offset themselves where relevant (see
 * useTimelineDrag, which reads clientX directly against a track-content bounding rect). */
export function msToPx(ms: number, pxPerMs: number): number {
  return ms * pxPerMs
}

export function pxToMs(px: number, pxPerMs: number): number {
  return pxPerMs > 0 ? px / pxPerMs : 0
}

export function frameToMs(frame: number, fps: number): number {
  return fps > 0 ? (frame / fps) * 1000 : 0
}

export function msToFrame(ms: number, fps: number): number {
  return fps > 0 ? Math.round((ms / 1000) * fps) : 0
}

export const MIN_PX_PER_MS = 0.02
export const MAX_PX_PER_MS = 2

/** The pxPerMs the zoom readout calls "100%" — a comfortable 0.1px/ms (10px per 100ms). With
 * the MIN/MAX above this maps the usable zoom range to roughly 20%–2000%, comfortably covering
 * the 25/50/100/200/400/800% ladder the zoom buttons step through. */
export const BASE_PX_PER_MS = 0.1
/** Preset zoom percentages the [-]/[+] buttons step between (Ctrl+wheel stays continuous). */
export const ZOOM_PRESETS = [25, 50, 100, 200, 400, 800] as const

export function clampPxPerMs(pxPerMs: number): number {
  return Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, pxPerMs))
}
export function pxPerMsToPercent(pxPerMs: number): number {
  return Math.round((pxPerMs / BASE_PX_PER_MS) * 100)
}
export function percentToPxPerMs(percent: number): number {
  return clampPxPerMs((percent / 100) * BASE_PX_PER_MS)
}
/** Next zoom level for the [-]/[+] buttons: steps to the neighboring preset on the ladder, or
 * doubles/halves once past either end, always clamped to the supported range. */
export function steppedZoom(pxPerMs: number, dir: 'in' | 'out'): number {
  const pct = pxPerMsToPercent(pxPerMs)
  if (dir === 'in') {
    const next = ZOOM_PRESETS.find((p) => p > pct + 1)
    return percentToPxPerMs(next ?? pct * 2)
  }
  const prev = [...ZOOM_PRESETS].reverse().find((p) => p < pct - 1)
  return percentToPxPerMs(prev ?? pct / 2)
}

/** "Zoom to fit" — the largest pxPerMs that fits `durationMs` (plus a little breathing room at
 * the end) inside `containerWidthPx`, clamped to the supported zoom range. */
export function computeFitPxPerMs(durationMs: number, containerWidthPx: number): number {
  const safeDuration = Math.max(1, durationMs)
  const fit = (containerWidthPx * 0.94) / safeDuration
  return Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, fit))
}

/** Builds the sorted candidate list a drag can snap to, per the spec's priority: playhead,
 * every *other* (non-dragged) clip/keyframe/marker edge across all tracks, frame boundaries,
 * and 0/durationMs. Built once at drag-start (not per pointermove) for performance — see
 * useTimelineDrag. `excludeIds` lets the dragged item(s) exclude their own current position(s)
 * from the candidate list so an item can't "snap to itself". */
export function buildSnapCandidates(otherTimes: number[], playheadMs: number, fps: number, durationMs: number, snapIntervalMs = 0): number[] {
  const set = new Set<number>()
  set.add(playheadMs)
  set.add(0)
  set.add(durationMs)
  for (const t of otherTimes) set.add(t)
  // Grid boundaries across the whole animation (deduped/sorted/binary-searched, so cheap even
  // for a several-second animation): a fixed ms interval when one is chosen (Snap: 10/25/50/
  // 100ms), otherwise every frame boundary — the default behavior.
  const gridMs = snapIntervalMs > 0 ? snapIntervalMs : frameToMs(1, fps)
  if (gridMs > 0) {
    for (let t = 0; t <= durationMs; t += gridMs) set.add(Math.round(t))
  }
  return Array.from(set).sort((a, b) => a - b)
}

/** Finds the nearest candidate to `rawMs` within `toleranceMs`, else returns `rawMs` unchanged.
 * Candidates must be pre-sorted ascending (buildSnapCandidates already returns them that way). */
export function snapMs(rawMs: number, candidates: number[], toleranceMs: number): number {
  if (candidates.length === 0) return rawMs
  // Binary search for the insertion point, then compare the immediate neighbors — candidate
  // lists here are at most a few thousand entries (frame boundaries dominate), so this is
  // comfortably fast without needing anything fancier.
  let lo = 0
  let hi = candidates.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (candidates[mid] < rawMs) lo = mid + 1
    else hi = mid
  }
  const candidatesToCheck = [candidates[lo - 1], candidates[lo], candidates[lo + 1]].filter((v): v is number => v !== undefined)
  let best = rawMs
  let bestDist = toleranceMs
  for (const c of candidatesToCheck) {
    const dist = Math.abs(c - rawMs)
    if (dist <= bestDist) {
      best = c
      bestDist = dist
    }
  }
  return best
}

/** Tailwind color-class pairs (dot/fill, border) per track kind — used consistently by
 * TrackHeader, keyframe diamonds, and sticker clips so a given track reads as one visual
 * "lane" regardless of which component is drawing it. */
export function trackAccentClasses(kind: TrackKind): { dot: string; border: string; text: string } {
  switch (kind) {
    case 'pose':
      return { dot: 'bg-studio-accent', border: 'border-studio-accent', text: 'text-studio-accent' }
    case 'leftEye':
    case 'rightEye':
      return { dot: 'bg-studio-accent2', border: 'border-studio-accent2', text: 'text-studio-accent2' }
    case 'pupils':
    case 'eyelids':
      return { dot: 'bg-studio-warn', border: 'border-studio-warn', text: 'text-studio-warn' }
    case 'sticker':
      return { dot: 'bg-emerald-400', border: 'border-emerald-400', text: 'text-emerald-400' }
    case 'marker':
      return { dot: 'bg-studio-danger', border: 'border-studio-danger', text: 'text-studio-danger' }
    case 'comboClip':
      return { dot: 'bg-studio-accent2', border: 'border-studio-accent2', text: 'text-studio-accent2' }
  }
}

export const TRACK_ROW_HEIGHT_PX = 40
export const TRACK_HEADER_WIDTH_PX = 148
