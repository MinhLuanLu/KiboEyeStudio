import type { StickerAnimSettings, StickerAsset, StickerInstance } from '@/types'
import { BUILTIN_STICKER_DRAWERS } from './builtinStickers'

const PULSE_HZ = 1 // fixed frequency for the scale/opacity "pulse" parametric controls

/** Lazily loads and caches an `<img>` per data URL — drawImage() needs a loaded
 * HTMLImageElement, and re-creating one every frame would re-decode the image constantly.
 * Images not yet loaded are simply skipped for a frame or two until `onload` fires and a
 * later frame picks them up (no promise plumbing needed — the render loop just runs again). */
const imageCache = new Map<string, HTMLImageElement>()
function getImage(dataUrl: string): HTMLImageElement | null {
  let img = imageCache.get(dataUrl)
  if (!img) {
    img = new Image()
    img.src = dataUrl
    imageCache.set(dataUrl, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

interface LiveVisibility {
  visible: boolean
  alpha: number
  /** ms of the sticker's own animation clock (after startTimeMs + startDelayMs), used for
   * drift/spin/pulse phase and raster frame selection. */
  animMs: number
}

/** Resolves startTimeMs/endTimeMs/fadeInMs/fadeOutMs/startDelayMs into whether this sticker
 * should draw at all right now, its fade-envelope alpha, and its own local animation clock. */
function computeVisibility(anim: StickerAnimSettings, elapsedMs: number): LiveVisibility {
  const localMs = elapsedMs - anim.startTimeMs
  if (localMs < 0) return { visible: false, alpha: 0, animMs: 0 }
  const windowMs = anim.endTimeMs != null ? Math.max(0, anim.endTimeMs - anim.startTimeMs) : null
  if (windowMs != null && localMs > windowMs) return { visible: false, alpha: 0, animMs: 0 }

  let alpha = 1
  if (anim.fadeInMs > 0) alpha = Math.min(alpha, localMs / anim.fadeInMs)
  if (windowMs != null && anim.fadeOutMs > 0) alpha = Math.min(alpha, (windowMs - localMs) / anim.fadeOutMs)
  alpha = Math.max(0, Math.min(1, alpha))

  return { visible: alpha > 0, alpha, animMs: Math.max(0, localMs - anim.startDelayMs) }
}

/** Picks which raster frame is current, honoring speed/fps override/loopMode/reverse — a
 * compact time-based frame player, same spirit as the eye animation's own time-based
 * eyesPlayAnimation() in the C++ export (no per-tick counter to keep in sync). */
function pickRasterFrame(asset: StickerAsset, animMs: number, anim: StickerAnimSettings): number {
  const frames = asset.frames ?? []
  if (frames.length <= 1) return 0
  const delays = anim.fps ? frames.map(() => 1000 / anim.fps!) : (asset.frameDelaysMs ?? frames.map(() => 100))
  const totalMs = delays.reduce((a, b) => a + b, 0) || 100
  const speed = Math.max(0.01, anim.speed / 100)
  let t = animMs * speed

  if (anim.loopMode === 'once') {
    t = Math.min(t, totalMs - 0.001)
  } else if (anim.loopMode === 'pingpong') {
    const cycle = t % (totalMs * 2)
    t = cycle < totalMs ? cycle : totalMs * 2 - cycle
  } else {
    t = t % totalMs
  }
  if (anim.reverse) t = totalMs - t

  let acc = 0
  for (let i = 0; i < delays.length; i++) {
    acc += delays[i]
    if (t < acc) return i
  }
  return delays.length - 1
}

/** Draws one sticker's raster frame tinted to `tint` via the standard canvas
 * draw-then-source-atop-fill trick (no per-pixel manipulation needed) — `tint` null skips the
 * fill entirely and draws the frame's native colors unmodified. */
function drawTintedImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, hw: number, hh: number, tint: string | null) {
  ctx.drawImage(img, -hw, -hh, hw * 2, hh * 2)
  if (tint) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = tint
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2)
    ctx.restore()
  }
}

/**
 * Draws one sticker instance at `elapsedMs` (time since the owning expression/animation
 * started, same clock PreviewCanvas.tsx already tracks per mode). Handles the full live
 * transform (drift/spin/pulse/fade/visibility window), dispatches to either the asset's
 * procedural drawer (built-in) or drawImage() on its current raster frame (custom import),
 * and applies opacity/tint/flip. No-ops cleanly if the asset is missing (deleted after this
 * instance referenced it) or a raster frame hasn't finished loading yet.
 */
export function drawSticker(ctx: CanvasRenderingContext2D, instance: StickerInstance, asset: StickerAsset | undefined, elapsedMs: number): void {
  if (!instance.visible || !asset) return
  const { visible, alpha, animMs } = computeVisibility(instance.anim, elapsedMs)
  if (!visible) return

  const tSec = animMs / 1000
  const { anim } = instance
  const liveX = instance.x + anim.driftX * tSec
  const liveY = instance.y + anim.driftY * tSec
  const liveRotation = instance.rotation + anim.spin * tSec
  const pulseScale = 1 + (anim.pulseScale / 100) * Math.sin(tSec * PULSE_HZ * Math.PI * 2)
  const pulseOpacityMul = 1 + (anim.pulseOpacity / 100) * Math.sin(tSec * PULSE_HZ * Math.PI * 2 + 1) // phase-offset from scale so they don't lock in sync
  const liveScale = (instance.scale / 100) * Math.max(0, pulseScale)
  const liveOpacity = Math.max(0, Math.min(1, (instance.opacity / 100) * Math.max(0, pulseOpacityMul))) * alpha
  if (liveOpacity <= 0.002) return

  const hw = (instance.width / 2) * liveScale
  const hh = (instance.height / 2) * liveScale
  if (hw <= 0 || hh <= 0) return

  ctx.save()
  ctx.translate(liveX, liveY)
  ctx.rotate((liveRotation * Math.PI) / 180)
  ctx.scale(instance.flipH ? -1 : 1, instance.flipV ? -1 : 1)
  ctx.globalAlpha = liveOpacity

  if (asset.kind === 'procedural' && asset.builtinId) {
    const drawer = BUILTIN_STICKER_DRAWERS[asset.builtinId]
    ctx.save()
    ctx.scale(hw, hh) // drawer operates in [-1,1] unit space
    drawer(ctx, tSec, instance.tint ?? '#ffffff')
    ctx.restore()
  } else if (asset.kind === 'raster' && asset.frames && asset.frames.length > 0) {
    const frameIndex = pickRasterFrame(asset, animMs, anim)
    const img = getImage(asset.frames[frameIndex])
    if (img) drawTintedImage(ctx, img, hw, hh, instance.tint)
  }

  ctx.restore()
}
