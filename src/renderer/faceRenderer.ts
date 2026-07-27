import type { CustomPupilShape, EyeParams, StickerAsset, StickerInstance } from '@/types'
import { applyDisplayMask, drawBezel, type DisplayMaskOptions } from './displayMask'
import { drawEye, DEFAULT_EYE_THEME, type EyeTheme } from './drawEye'
import { drawSticker } from './drawSticker'

export interface FaceRenderOptions extends DisplayMaskOptions {
  /** Left eye's theme (also the right eye's, unless rightTheme is given). */
  theme?: EyeTheme
  /** Right eye's shape, when it differs from `params` (Eye Target: Left/Right editing). If
   * omitted, the right eye mirrors `params` exactly like before per-eye overrides existed. */
  rightParams?: EyeParams
  /** Right eye's theme, when it differs from `theme`. Omit to mirror `theme`. */
  rightTheme?: EyeTheme
  /** project.customPupilShapes — resolved by pupilCustomShapeId when either eye's pupilShape
   * is 'custom'. Omit (defaults to []) wherever a custom pupil shape can't apply — drawEye
   * falls back to a circle for 'custom' with no match, so this is safe to leave out. */
  customShapes?: CustomPupilShape[]
  /** Stickers to draw this frame — already merged/sorted by layer+order, see
   * effectiveStickers() in types/index.ts. Omit for no stickers. */
  stickers?: StickerInstance[]
  /** project.stickerAssets — resolved by each sticker's assetId. Omit alongside `stickers`. */
  stickerAssets?: StickerAsset[]
  /** Elapsed ms since the active expression/animation started — drives sticker drift/spin/
   * pulse/fade and raster frame playback. Ignored if `stickers` is omitted/empty. */
  stickerElapsedMs?: number
}

/** Renders the full display face onto a `width`x`height` canvas: background fill, shape
 * clip (circle/square/rounded), left/right eye pair, optional bezel. Call once per
 * animation frame. The left eye uses `params`/`theme`; the right eye uses `rightParams`/
 * `rightTheme` if given, otherwise mirrors the left — so callers that don't care about
 * per-eye divergence (animations, idle, reference-image preview) can ignore the right*
 * options entirely and get the old symmetric-pair behavior unchanged. */
export function renderFace(ctx: CanvasRenderingContext2D, params: EyeParams, options: FaceRenderOptions): void {
  const {
    width,
    height,
    theme = DEFAULT_EYE_THEME,
    backgroundColor,
    rightParams = params,
    rightTheme = theme,
    customShapes = [],
    stickers = [],
    stickerAssets = [],
    stickerElapsedMs = 0
  } = options
  applyDisplayMask(ctx, options)

  const cx = width / 2
  const cy = height / 2
  const halfLeft = params.distance / 2
  const halfRight = rightParams.distance / 2

  const assetsById = new Map(stickerAssets.map((a) => [a.id, a]))
  const drawLayer = (layer: 'behind' | 'front') => {
    if (stickers.length === 0) return
    ctx.save()
    ctx.translate(cx, cy)
    for (const inst of stickers) {
      if (inst.layer !== layer) continue
      drawSticker(ctx, inst, assetsById.get(inst.assetId), stickerElapsedMs)
    }
    ctx.restore()
  }

  // Stickers are drawn relative to the display's own center (cx, cy) — independent of each
  // eye's own translate below — since a sticker isn't attached to either eye's coordinate
  // space, it's placed anywhere on the display.
  drawLayer('behind')

  ctx.save()
  ctx.translate(cx - halfLeft, cy)
  drawEye(ctx, params, theme, false, backgroundColor, customShapes)
  ctx.restore()

  ctx.save()
  ctx.translate(cx + halfRight, cy)
  drawEye(ctx, rightParams, rightTheme, true, backgroundColor, customShapes)
  ctx.restore()

  drawLayer('front')

  ctx.restore() // lift the shape clip from applyDisplayMask
  drawBezel(ctx, options)
}
