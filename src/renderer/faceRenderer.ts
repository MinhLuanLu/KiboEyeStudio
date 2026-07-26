import type { EyeParams } from '@/types'
import { applyDisplayMask, drawBezel, type DisplayMaskOptions } from './displayMask'
import { drawEye, DEFAULT_EYE_THEME, type EyeTheme } from './drawEye'

export interface FaceRenderOptions extends DisplayMaskOptions {
  /** Left eye's theme (also the right eye's, unless rightTheme is given). */
  theme?: EyeTheme
  /** Right eye's shape, when it differs from `params` (Eye Target: Left/Right editing). If
   * omitted, the right eye mirrors `params` exactly like before per-eye overrides existed. */
  rightParams?: EyeParams
  /** Right eye's theme, when it differs from `theme`. Omit to mirror `theme`. */
  rightTheme?: EyeTheme
}

/** Renders the full display face onto a `width`x`height` canvas: background fill, shape
 * clip (circle/square/rounded), left/right eye pair, optional bezel. Call once per
 * animation frame. The left eye uses `params`/`theme`; the right eye uses `rightParams`/
 * `rightTheme` if given, otherwise mirrors the left — so callers that don't care about
 * per-eye divergence (animations, idle, reference-image preview) can ignore the right*
 * options entirely and get the old symmetric-pair behavior unchanged. */
export function renderFace(ctx: CanvasRenderingContext2D, params: EyeParams, options: FaceRenderOptions): void {
  const { width, height, theme = DEFAULT_EYE_THEME, backgroundColor, rightParams = params, rightTheme = theme } = options
  applyDisplayMask(ctx, options)

  const cx = width / 2
  const cy = height / 2
  const halfLeft = params.distance / 2
  const halfRight = rightParams.distance / 2

  ctx.save()
  ctx.translate(cx - halfLeft, cy)
  drawEye(ctx, params, theme, false, backgroundColor)
  ctx.restore()

  ctx.save()
  ctx.translate(cx + halfRight, cy)
  drawEye(ctx, rightParams, rightTheme, true, backgroundColor)
  ctx.restore()

  ctx.restore() // lift the shape clip from applyDisplayMask
  drawBezel(ctx, options)
}
