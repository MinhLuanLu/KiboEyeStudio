import type { DisplayShape, UiDisplayShape } from '@/types'

/** Adapts UI Design Mode's own shape enum ('round'|'square'|'rectangle'|'custom') to Eye
 * Studio's ('circle'|'square'|'rounded') so rectFitsDisplayShape/clampRectToDisplayShape below
 * can be reused as-is for UI Design Mode widgets — only a circle actually constrains a rect
 * (see rectFitsDisplayShape's own comment), so 'square'/'rectangle'/'custom' all safely map to
 * the same "unconstrained" bucket ('square') without needing a third code path. */
export function uiDisplayShapeToDisplayShape(shape: UiDisplayShape): DisplayShape {
  return shape === 'round' ? 'circle' : 'square'
}

export interface DisplayMaskOptions {
  width: number
  height: number
  shape: DisplayShape
  cornerRadius: number
  backgroundColor: string
  showBezel: boolean
}

function shapePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shape: DisplayShape, cornerRadius: number): void {
  ctx.beginPath()
  if (shape === 'circle') {
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2)
  } else {
    const r = shape === 'rounded' ? Math.max(0, Math.min(cornerRadius, w / 2, h / 2)) : 0
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
  }
  ctx.closePath()
}

/** Clears the canvas, fills it with the configured background color, and clips all
 * subsequent drawing to the configured display shape (circle/square/rounded). Caller must
 * ctx.restore() (or rely on a fresh frame) to lift the clip. */
export function applyDisplayMask(ctx: CanvasRenderingContext2D, opts: DisplayMaskOptions): void {
  const { width, height, backgroundColor, shape, cornerRadius } = opts
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, width, height)
  shapePath(ctx, 0, 0, width, height, shape, cornerRadius)
  ctx.clip()
}

export function drawBezel(ctx: CanvasRenderingContext2D, opts: DisplayMaskOptions): void {
  if (!opts.showBezel) return
  const { width, height, shape, cornerRadius } = opts
  const inset = 3
  ctx.save()

  shapePath(ctx, inset, inset, width - inset * 2, height - inset * 2, shape, Math.max(0, cornerRadius - inset))
  ctx.lineWidth = 6
  const grad = ctx.createLinearGradient(0, 0, width, height)
  grad.addColorStop(0, '#4a4a52')
  grad.addColorStop(0.5, '#232327')
  grad.addColorStop(1, '#1a1a1d')
  ctx.strokeStyle = grad
  ctx.stroke()

  shapePath(ctx, 0.5, 0.5, width - 1, height - 1, shape, Math.max(0, cornerRadius - 0.5))
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.stroke()
  ctx.restore()
}

/** Fits a project's display config into a small square-ish thumbnail box, preserving
 * aspect ratio and shape (used by expression thumbnails / reference-import preview). */
export function fitDisplayToBox(display: DisplayMaskOptions, box: number): DisplayMaskOptions {
  const scale = box / Math.max(display.width, display.height)
  return {
    ...display,
    width: display.width * scale,
    height: display.height * scale,
    cornerRadius: display.cornerRadius * scale,
    showBezel: false
  }
}

export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

/** True if every corner of `rect` (in display-local px, origin at the display's top-left,
 * same coordinate space UI Design Mode widgets are positioned in) falls inside the display's
 * visible shape. Only 'circle'/'oval' actually constrain anything here — a rect already IS an
 * axis-aligned box, so 'square'/'rounded' displays never reject a rect purely for being a
 * rectangle (rounded corners aside, which this pass doesn't additionally constrain). */
export function rectFitsDisplayShape(display: Pick<DisplayMaskOptions, 'width' | 'height' | 'shape'>, rect: DisplayRect): boolean {
  if (display.shape !== 'circle') return true
  const cx = display.width / 2
  const cy = display.height / 2
  const rx = display.width / 2
  const ry = display.height / 2
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height]
  ]
  return corners.every(([px, py]) => {
    const nx = rx > 0 ? (px - cx) / rx : 0
    const ny = ry > 0 ? (py - cy) / ry : 0
    return nx * nx + ny * ny <= 1
  })
}

/** Soft-clamps a widget's position so it stays inside a circular display — used on
 * drag/resize pointer-up (see UiDesign/WidgetRenderer.tsx), not enforced continuously, so a
 * widget already placed outside (e.g. via `allowOutsideBounds`) never gets silently yanked
 * back mid-render. Approximates the "keep every corner inside the ellipse" constraint by
 * clamping the rect's *center* to an ellipse eroded by the rect's own half-width/height — exact
 * for a circle, a reasonable approximation for a non-square oval, and standard technique for
 * convex-region containment (Minkowski erosion). Width/height are never changed, only x/y.
 * Returns the original rect's x/y unchanged if it already fits, or shape !== 'circle'. */
export type UiWidgetVisibilityStatus = 'fully-visible' | 'partially-clipped' | 'outside-safe-area' | 'outside-display'

function isPointInDisplay(display: Pick<DisplayMaskOptions, 'width' | 'height' | 'shape'>, x: number, y: number): boolean {
  if (display.shape !== 'circle') return x >= 0 && x <= display.width && y >= 0 && y <= display.height
  const cx = display.width / 2
  const cy = display.height / 2
  const rx = display.width / 2
  const ry = display.height / 2
  const nx = rx > 0 ? (x - cx) / rx : 0
  const ny = ry > 0 ? (y - cy) / ry : 0
  return nx * nx + ny * ny <= 1
}

/** Classifies a widget's rect against the display boundary and an eroded "safe area" inset by
 * `safeAreaMargin` px on every side — the four states the spec asks for while dragging: fully
 * inside the safe area, fully inside the display but reaching into the margin, some corners
 * outside the display shape entirely, or the whole rect outside it. Reuses the exact same
 * corner-in-ellipse test `rectFitsDisplayShape` already established (generalized here to also
 * cover square/rectangle displays via a plain bounding-box check), so this can never disagree
 * with the existing "does it fit" check used elsewhere. */
export function classifyWidgetVisibility(display: Pick<DisplayMaskOptions, 'width' | 'height' | 'shape'>, rect: DisplayRect, safeAreaMargin: number): UiWidgetVisibilityStatus {
  const corners: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height]
  ]
  const insideDisplay = corners.map(([x, y]) => isPointInDisplay(display, x, y))
  const allInsideDisplay = insideDisplay.every(Boolean)
  const noneInsideDisplay = insideDisplay.every((v) => !v)
  if (!allInsideDisplay) return noneInsideDisplay ? 'outside-display' : 'partially-clipped'

  const safeDisplay = { width: Math.max(0, display.width - safeAreaMargin * 2), height: Math.max(0, display.height - safeAreaMargin * 2), shape: display.shape }
  const allInsideSafeArea = corners.every(([x, y]) => isPointInDisplay(safeDisplay, x - safeAreaMargin, y - safeAreaMargin))
  return allInsideSafeArea ? 'fully-visible' : 'outside-safe-area'
}

export function clampRectToDisplayShape(display: Pick<DisplayMaskOptions, 'width' | 'height' | 'shape'>, rect: DisplayRect): { x: number; y: number } {
  if (display.shape !== 'circle' || rectFitsDisplayShape(display, rect)) return { x: rect.x, y: rect.y }

  const cx = display.width / 2
  const cy = display.height / 2
  const rx = Math.max(0, display.width / 2 - rect.width / 2)
  const ry = Math.max(0, display.height / 2 - rect.height / 2)
  const rectCx = rect.x + rect.width / 2
  const rectCy = rect.y + rect.height / 2

  if (rx === 0 || ry === 0) return { x: cx - rect.width / 2, y: cy - rect.height / 2 }

  const nx = (rectCx - cx) / rx
  const ny = (rectCy - cy) / ry
  const dist = Math.sqrt(nx * nx + ny * ny)
  if (dist <= 1) return { x: rect.x, y: rect.y }

  const clampedCx = cx + (nx / dist) * rx
  const clampedCy = cy + (ny / dist) * ry
  return { x: clampedCx - rect.width / 2, y: clampedCy - rect.height / 2 }
}
