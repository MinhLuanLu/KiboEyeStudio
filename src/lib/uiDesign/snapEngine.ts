import type { UiSnapGuide } from '@/state/store'

// Alignment-guide / snap-to math for the UI Design Mode canvas — a pure, framework-free module
// (no React, no store reads) so WidgetRenderer's drag/resize handlers, a future automated test,
// and any other consumer can never disagree about what "snap" means. Mirrors this codebase's
// established "one shared geometry module" pattern (dataListLayout.ts, keyboardAdaptiveLayout.ts,
// canvasZoom.ts) rather than duplicating the math per call site.

export interface SnapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapCandidate {
  value: number
  /** Human-readable-ish source tag, e.g. 'display-center-x' | 'widget:<id>:left' | 'grid' — used
   * only to derive the "Centered horizontally"-style label, not shown verbatim in the UI. */
  source: string
}

export interface SnapToggles {
  grid: boolean
  center: boolean
  displayEdges: boolean
  safeArea: boolean
  parent: boolean
  widgets: boolean
}

export interface SnapContext {
  display: { width: number; height: number }
  safeAreaMargin: number
  /** null when the dragged widget is top-level (its own bounds ARE the display). */
  parentBounds: SnapRect | null
  /** Every other widget sharing the same parent as the one being dragged — never includes the
   * dragged widget itself. */
  siblingRects: { id: string; rect: SnapRect }[]
  gridSize: number
  snapDistance: number
  magneticStrength: number
  toggles: SnapToggles
}

export function computeSnapCandidatesX(ctx: SnapContext): SnapCandidate[] {
  const c: SnapCandidate[] = []
  if (ctx.toggles.center) c.push({ value: ctx.display.width / 2, source: 'display-center-x' })
  if (ctx.toggles.displayEdges) c.push({ value: 0, source: 'display-left' }, { value: ctx.display.width, source: 'display-right' })
  if (ctx.toggles.safeArea) c.push({ value: ctx.safeAreaMargin, source: 'safe-area-left' }, { value: ctx.display.width - ctx.safeAreaMargin, source: 'safe-area-right' })
  if (ctx.toggles.parent && ctx.parentBounds) {
    c.push({ value: ctx.parentBounds.x, source: 'parent-left' })
    c.push({ value: ctx.parentBounds.x + ctx.parentBounds.width, source: 'parent-right' })
    c.push({ value: ctx.parentBounds.x + ctx.parentBounds.width / 2, source: 'parent-center-x' })
  }
  if (ctx.toggles.widgets) {
    for (const s of ctx.siblingRects) {
      c.push({ value: s.rect.x, source: `widget:${s.id}:left` })
      c.push({ value: s.rect.x + s.rect.width, source: `widget:${s.id}:right` })
      c.push({ value: s.rect.x + s.rect.width / 2, source: `widget:${s.id}:center` })
    }
  }
  return c
}

export function computeSnapCandidatesY(ctx: SnapContext): SnapCandidate[] {
  const c: SnapCandidate[] = []
  if (ctx.toggles.center) c.push({ value: ctx.display.height / 2, source: 'display-center-y' })
  if (ctx.toggles.displayEdges) c.push({ value: 0, source: 'display-top' }, { value: ctx.display.height, source: 'display-bottom' })
  if (ctx.toggles.safeArea) c.push({ value: ctx.safeAreaMargin, source: 'safe-area-top' }, { value: ctx.display.height - ctx.safeAreaMargin, source: 'safe-area-bottom' })
  if (ctx.toggles.parent && ctx.parentBounds) {
    c.push({ value: ctx.parentBounds.y, source: 'parent-top' })
    c.push({ value: ctx.parentBounds.y + ctx.parentBounds.height, source: 'parent-bottom' })
    c.push({ value: ctx.parentBounds.y + ctx.parentBounds.height / 2, source: 'parent-center-y' })
  }
  if (ctx.toggles.widgets) {
    for (const s of ctx.siblingRects) {
      c.push({ value: s.rect.y, source: `widget:${s.id}:top` })
      c.push({ value: s.rect.y + s.rect.height, source: `widget:${s.id}:bottom` })
      c.push({ value: s.rect.y + s.rect.height / 2, source: `widget:${s.id}:center` })
    }
  }
  return c
}

interface AxisSnapResult {
  delta: number
  guide: UiSnapGuide | null
}

/** Checks the dragged rect's own min/center/max against every candidate (plus, separately, the
 * nearest grid line) within the magnetic-scaled catch radius, and returns the smallest delta
 * needed to snap the CLOSEST hit — never the sum of multiple hits, matching every other design
 * tool's snap behavior (one clean snap per axis per frame, not several stacking). */
function snapAxis(rectMin: number, rectSize: number, axis: 'x' | 'y', candidates: SnapCandidate[], ctx: SnapContext): AxisSnapResult {
  const catchRadius = ctx.snapDistance * (1 + ctx.magneticStrength / 100)
  const refPoints = [rectMin, rectMin + rectSize / 2, rectMin + rectSize]
  let best: { delta: number; dist: number; guide: UiSnapGuide } | null = null

  for (const ref of refPoints) {
    for (const c of candidates) {
      const dist = Math.abs(c.value - ref)
      if (dist <= catchRadius && (!best || dist < best.dist)) {
        best = { delta: c.value - ref, dist, guide: { axis, value: c.value, source: c.source } }
      }
    }
    if (ctx.toggles.grid && ctx.gridSize > 0) {
      const nearestGrid = Math.round(ref / ctx.gridSize) * ctx.gridSize
      const dist = Math.abs(nearestGrid - ref)
      if (dist <= catchRadius && (!best || dist < best.dist)) {
        best = { delta: nearestGrid - ref, dist, guide: { axis, value: nearestGrid, source: 'grid' } }
      }
    }
  }
  return best ? { delta: best.delta, guide: best.guide } : { delta: 0, guide: null }
}

export interface SnapResult {
  x: number
  y: number
  guides: UiSnapGuide[]
}

/** The one entry point WidgetRenderer's drag/resize handlers call — snaps `rect` in place
 * (width/height untouched, only x/y) and returns which guide(s) to render. Adds the spec's
 * "Centered horizontally"/"Centered vertically"/"Screen center" label once the snap actually
 * lands the widget exactly centered on that axis. */
export function applySnap(rect: SnapRect, ctx: SnapContext): SnapResult {
  const candidatesX = computeSnapCandidatesX(ctx)
  const candidatesY = computeSnapCandidatesY(ctx)
  const snapX = snapAxis(rect.x, rect.width, 'x', candidatesX, ctx)
  const snapY = snapAxis(rect.y, rect.height, 'y', candidatesY, ctx)

  const x = rect.x + snapX.delta
  const y = rect.y + snapY.delta
  const guides: UiSnapGuide[] = []

  const centeredX = snapX.guide?.source === 'display-center-x'
  const centeredY = snapY.guide?.source === 'display-center-y'
  if (snapX.guide) guides.push({ ...snapX.guide, label: centeredX && centeredY ? undefined : centeredX ? 'Centered horizontally' : undefined })
  if (snapY.guide) guides.push({ ...snapY.guide, label: centeredX && centeredY ? undefined : centeredY ? 'Centered vertically' : undefined })
  if (centeredX && centeredY) guides.push({ axis: 'x', value: x + rect.width / 2, source: 'screen-center', label: 'Screen center' })

  return { x, y, guides }
}

export interface SpacingIndicator {
  axis: 'x' | 'y'
  distancePx: number
  x: number
  y: number
}

/** For each axis, finds the nearest non-overlapping sibling edge and reports the gap in px —
 * "smart spacing indicators" from the spec. Only reports a gap when the rects don't overlap on
 * the OTHER axis (i.e. they're plausible visual neighbors), matching how design tools only show
 * a spacing badge between things that actually look adjacent. */
export function computeSpacingIndicators(rect: SnapRect, siblingRects: { id: string; rect: SnapRect }[]): SpacingIndicator[] {
  const out: SpacingIndicator[] = []
  let bestRight: { gap: number; midY: number } | null = null
  let bestLeft: { gap: number; midY: number } | null = null
  let bestBelow: { gap: number; midX: number } | null = null
  let bestAbove: { gap: number; midX: number } | null = null

  for (const { rect: s } of siblingRects) {
    const verticalOverlap = rect.y < s.y + s.height && s.y < rect.y + rect.height
    const horizontalOverlap = rect.x < s.x + s.width && s.x < rect.x + rect.width

    if (verticalOverlap) {
      if (s.x >= rect.x + rect.width) {
        const gap = s.x - (rect.x + rect.width)
        if (!bestRight || gap < bestRight.gap) bestRight = { gap, midY: (Math.max(rect.y, s.y) + Math.min(rect.y + rect.height, s.y + s.height)) / 2 }
      } else if (s.x + s.width <= rect.x) {
        const gap = rect.x - (s.x + s.width)
        if (!bestLeft || gap < bestLeft.gap) bestLeft = { gap, midY: (Math.max(rect.y, s.y) + Math.min(rect.y + rect.height, s.y + s.height)) / 2 }
      }
    }
    if (horizontalOverlap) {
      if (s.y >= rect.y + rect.height) {
        const gap = s.y - (rect.y + rect.height)
        if (!bestBelow || gap < bestBelow.gap) bestBelow = { gap, midX: (Math.max(rect.x, s.x) + Math.min(rect.x + rect.width, s.x + s.width)) / 2 }
      } else if (s.y + s.height <= rect.y) {
        const gap = rect.y - (s.y + s.height)
        if (!bestAbove || gap < bestAbove.gap) bestAbove = { gap, midX: (Math.max(rect.x, s.x) + Math.min(rect.x + rect.width, s.x + s.width)) / 2 }
      }
    }
  }

  if (bestRight) out.push({ axis: 'x', distancePx: bestRight.gap, x: rect.x + rect.width + bestRight.gap / 2, y: bestRight.midY })
  if (bestLeft) out.push({ axis: 'x', distancePx: bestLeft.gap, x: rect.x - bestLeft.gap / 2, y: bestLeft.midY })
  if (bestBelow) out.push({ axis: 'y', distancePx: bestBelow.gap, x: bestBelow.midX, y: rect.y + rect.height + bestBelow.gap / 2 })
  if (bestAbove) out.push({ axis: 'y', distancePx: bestAbove.gap, x: bestAbove.midX, y: rect.y - bestAbove.gap / 2 })
  return out
}
