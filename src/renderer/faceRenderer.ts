import type { EyeParams } from '@/types'
import { applyDisplayMask, drawBezel, type DisplayMaskOptions } from './displayMask'
import { drawEye, DEFAULT_EYE_THEME, type EyeTheme } from './drawEye'

export interface FaceRenderOptions extends DisplayMaskOptions {
  theme?: EyeTheme
}

/** Renders the full 240x240 (or `size`x`size`) round-display face: black background,
 * circular clip, mirrored left/right eye pair, optional bezel. Call once per animation frame. */
export function renderFace(ctx: CanvasRenderingContext2D, params: EyeParams, options: FaceRenderOptions): void {
  const { size, theme = DEFAULT_EYE_THEME } = options
  applyDisplayMask(ctx, options)

  const cx = size / 2
  const cy = size / 2
  const half = params.distance / 2

  ctx.save()
  ctx.translate(cx - half, cy)
  drawEye(ctx, params, theme, false)
  ctx.restore()

  ctx.save()
  ctx.translate(cx + half, cy)
  drawEye(ctx, params, theme, true)
  ctx.restore()

  ctx.restore() // lift the circular clip from applyDisplayMask
  drawBezel(ctx, options)
}
