import type { EyeParams } from '@/types'

/** View limits for the preview zoom. */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Snap a value to the nearest grid multiple. `grid <= 0` disables snapping. */
export function snap(value: number, grid: number): number {
  if (grid <= 0) return value
  return Math.round(value / grid) * grid
}

export interface Box {
  cx: number
  cy: number
  hw: number
  hh: number
}

/**
 * Axis-aligned hit box for one eye, in DISPLAY-CENTER coordinates (origin = display centre), matching
 * faceRenderer.ts: left eye centre = (-distance/2 + eyePosX, eyePosY), right eye centre =
 * (+distance/2 - eyePosX, eyePosY); box size = width × height.
 */
export function eyeHitBox(params: EyeParams, side: 'left' | 'right'): Box {
  const half = params.distance / 2
  const cx = side === 'left' ? -half + params.eyePosX : half - params.eyePosX
  return { cx, cy: params.eyePosY, hw: params.width / 2, hh: params.height / 2 }
}

export function pointInBox(x: number, y: number, b: Box): boolean {
  return x >= b.cx - b.hw && x <= b.cx + b.hw && y >= b.cy - b.hh && y <= b.cy + b.hh
}

/**
 * Convert a SCREEN-space delta (display px; +x = right, +y = down) into a new eyePosX/eyePosY for the
 * given eye, clamped to the parameter range. The right eye mirrors X (screen-right ⇒ smaller eyePosX),
 * exactly the sign convention faceRenderer.ts uses, so dragging either eye moves it the way the cursor
 * moves. `dx`/`dy` may already be snapped by the caller.
 */
export function screenDeltaToEyePos(
  side: 'left' | 'right',
  start: { eyePosX: number; eyePosY: number },
  dx: number,
  dy: number,
  range: { x: [number, number]; y: [number, number] }
): { eyePosX: number; eyePosY: number } {
  const signX = side === 'right' ? -1 : 1
  return {
    eyePosX: clamp(start.eyePosX + signX * dx, range.x[0], range.x[1]),
    eyePosY: clamp(start.eyePosY + dy, range.y[0], range.y[1])
  }
}

/**
 * Zoom by `factor` toward a viewport-local cursor point, adjusting `pan` so the display point under the
 * cursor stays fixed. `pan` is the stage's translate (px), `zoom` its scale. Stage coord under the
 * cursor is `(cursor - pan) / zoom`; keeping it invariant gives `pan' = cursor - k·(cursor - pan)`.
 */
export function zoomAtPoint(
  zoom: number,
  pan: { x: number; y: number },
  cursor: { x: number; y: number },
  factor: number
): { zoom: number; pan: { x: number; y: number } } {
  const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
  const k = newZoom / zoom
  return {
    zoom: newZoom,
    pan: { x: cursor.x - k * (cursor.x - pan.x), y: cursor.y - k * (cursor.y - pan.y) }
  }
}

/**
 * Zoom/pan that fits a `contentW × contentH` display, centred, inside a `viewportW × viewportH` area
 * with `padding` px of margin. Used by "Fit to View".
 */
export function fitToView(
  contentW: number,
  contentH: number,
  viewportW: number,
  viewportH: number,
  padding = 24
): { zoom: number; pan: { x: number; y: number } } {
  const availW = Math.max(1, viewportW - padding * 2)
  const availH = Math.max(1, viewportH - padding * 2)
  const zoom = clamp(Math.min(availW / contentW, availH / contentH), MIN_ZOOM, MAX_ZOOM)
  return {
    zoom,
    pan: { x: (viewportW - contentW * zoom) / 2, y: (viewportH - contentH * zoom) / 2 }
  }
}

/** Centre the display at `zoom` (default 1) inside the viewport — used by "Reset to 100%". */
export function centerView(
  contentW: number,
  contentH: number,
  viewportW: number,
  viewportH: number,
  zoom = 1
): { zoom: number; pan: { x: number; y: number } } {
  return {
    zoom,
    pan: { x: (viewportW - contentW * zoom) / 2, y: (viewportH - contentH * zoom) / 2 }
  }
}
