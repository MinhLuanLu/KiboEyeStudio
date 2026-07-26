import type { EyeParams } from '@/types'
import { applyDisplayMask, drawBezel, type DisplayMaskOptions } from './displayMask'
import { drawEye, DEFAULT_EYE_THEME, type EyeTheme } from './drawEye'

export interface FaceRenderOptions extends DisplayMaskOptions {
  theme?: EyeTheme
}

/** Renders the full display face onto a `width`x`height` canvas: background fill, shape
 * clip (circle/square/rounded), mirrored left/right eye pair, optional bezel. Call once
 * per animation frame. */
export function renderFace(ctx: CanvasRenderingContext2D, params: EyeParams, options: FaceRenderOptions): void {
  const { width, height, theme = DEFAULT_EYE_THEME, backgroundColor } = options
  applyDisplayMask(ctx, options)

  const cx = width / 2
  const cy = height / 2
  const half = params.distance / 2

  ctx.save()
  ctx.translate(cx - half, cy)
  drawEye(ctx, params, theme, false, backgroundColor)
  ctx.restore()

  ctx.save()
  ctx.translate(cx + half, cy)
  drawEye(ctx, params, theme, true, backgroundColor)
  ctx.restore()

  ctx.restore() // lift the shape clip from applyDisplayMask
  drawBezel(ctx, options)
}
