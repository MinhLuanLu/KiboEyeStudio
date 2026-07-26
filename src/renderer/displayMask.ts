import type { DisplayShape } from '@/types'

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
