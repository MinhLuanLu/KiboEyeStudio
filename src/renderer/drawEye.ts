import type { EyeColors, EyeParams } from '@/types'
import { DEFAULT_EYE_COLORS } from '@/types'
import { shadeColor } from '@/lib/color'

export type EyeTheme = EyeColors

export const DEFAULT_EYE_THEME: EyeTheme = DEFAULT_EYE_COLORS

function roundedRectPath(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number): void {
  const r = Math.min(radius, w / 2, h / 2)
  const x = -w / 2
  const y = -h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * Draws a single eye centered at the current canvas origin (caller translates first).
 * `mirrorX` flips rotation/pupil/highlight horizontally so a left/right eye pair reads as
 * looking in the same world direction rather than toward/away from each other.
 */
export function drawEye(
  ctx: CanvasRenderingContext2D,
  params: EyeParams,
  theme: EyeTheme = DEFAULT_EYE_THEME,
  mirrorX = false
): void {
  const {
    width,
    height,
    radius,
    rotation,
    irisWidth,
    irisHeight,
    pupilWidth,
    pupilHeight,
    pupilX,
    pupilY,
    upperEyelid,
    lowerEyelid,
    highlightX,
    highlightY,
    highlightSize
  } = params
  const sign = mirrorX ? -1 : 1

  ctx.save()
  ctx.rotate((rotation * sign * Math.PI) / 180)

  // Outer glow — painted *before* the eye-shape clip so the blur can bleed outside the
  // rounded-rect silhouette (drawn on the round-display canvas behind everything else).
  if (theme.glowIntensity > 0) {
    ctx.save()
    ctx.shadowColor = theme.glow
    ctx.shadowBlur = 4 + (theme.glowIntensity / 100) * 22
    ctx.globalAlpha = 0.25 + (theme.glowIntensity / 100) * 0.55
    ctx.fillStyle = theme.glow
    roundedRectPath(ctx, width, height, radius)
    ctx.fill()
    // A couple of extra passes make the halo read as a soft glow rather than a single blur ring.
    ctx.fill()
    ctx.restore()
  }

  roundedRectPath(ctx, width, height, radius)
  ctx.clip()

  // Sclera — soft vertical gradient derived from the single "sclera" color for a glassy look.
  const grad = ctx.createLinearGradient(0, -height / 2, 0, height / 2)
  grad.addColorStop(0, shadeColor(theme.sclera, 6))
  grad.addColorStop(1, shadeColor(theme.sclera, -10))
  ctx.fillStyle = grad
  ctx.fillRect(-width / 2, -height / 2, width, height)

  // Ambient shadow arc under the (implied) upper lid crease, for depth.
  if (theme.shadowIntensity > 0) {
    const shadowH = height * 0.32
    const shadowGrad = ctx.createLinearGradient(0, -height / 2, 0, -height / 2 + shadowH)
    shadowGrad.addColorStop(0, theme.shadow)
    shadowGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.save()
    ctx.globalAlpha = 0.15 + (theme.shadowIntensity / 100) * 0.45
    ctx.fillStyle = shadowGrad
    ctx.fillRect(-width / 2, -height / 2, width, shadowH)
    ctx.restore()
  }

  // Iris/pupil radii scale independently per axis off the eye's own width/height, mirroring
  // how the eye shape itself is controlled (not a single shared "size" like older versions).
  const irisRX = Math.max(0, (irisWidth / 100) * (width / 2))
  const irisRY = Math.max(0, (irisHeight / 100) * (height / 2))
  const pupilRX = Math.max(0, (pupilWidth / 100) * (width / 2))
  const pupilRY = Math.max(0, (pupilHeight / 100) * (height / 2))
  const pcx = sign * (pupilX / 100) * (width / 2)
  const pcy = (pupilY / 100) * (height / 2)

  // Iris — drawn via a scale transform so the radial gradient stretches into a true ellipse
  // (canvas gradients are otherwise always circular).
  if (irisRX > 0.1 && irisRY > 0.1) {
    ctx.save()
    ctx.translate(pcx, pcy)
    ctx.scale(irisRX, irisRY)
    const irisGrad = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 1)
    irisGrad.addColorStop(0, shadeColor(theme.iris, 12))
    irisGrad.addColorStop(0.75, theme.iris)
    irisGrad.addColorStop(1, shadeColor(theme.iris, -22))
    ctx.beginPath()
    ctx.fillStyle = irisGrad
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // Pupil
  if (pupilRX > 0.1 && pupilRY > 0.1) {
    ctx.beginPath()
    ctx.fillStyle = theme.pupil
    ctx.ellipse(pcx, pcy, pupilRX, pupilRY, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Highlight glint, positioned relative to the pupil (or iris if the pupil is hidden) —
  // stays a simple circle even when the iris/pupil are stretched into ellipses.
  const highlightBaseX = pupilRX > 0.1 ? pupilRX : irisRX
  const highlightBaseY = pupilRY > 0.1 ? pupilRY : irisRY
  const highlightBase = (highlightBaseX + highlightBaseY) / 2
  const hR = Math.max(0, (highlightSize / 100) * highlightBase)
  if (hR > 0.1 && highlightBase > 0.1) {
    const hx = pcx + sign * (highlightX / 100) * highlightBaseX
    const hy = pcy + (highlightY / 100) * highlightBaseY
    ctx.beginPath()
    ctx.fillStyle = theme.highlight
    ctx.globalAlpha = 0.92
    ctx.arc(hx, hy, hR, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Eyelids — slide in from top/bottom, softly curved, clipped to the eye shape. Always
  // matches the display's black background so it reads as the lid occluding the eye.
  ctx.fillStyle = '#000000'
  if (upperEyelid > 0) {
    const coverage = (upperEyelid / 100) * height
    const y = -height / 2 + coverage
    ctx.beginPath()
    ctx.moveTo(-width / 2 - 2, -height / 2 - 2)
    ctx.lineTo(width / 2 + 2, -height / 2 - 2)
    ctx.lineTo(width / 2 + 2, y)
    ctx.quadraticCurveTo(0, y + height * 0.05, -width / 2 - 2, y)
    ctx.closePath()
    ctx.fill()
  }
  if (lowerEyelid > 0) {
    const coverage = (lowerEyelid / 100) * height
    const y = height / 2 - coverage
    ctx.beginPath()
    ctx.moveTo(-width / 2 - 2, height / 2 + 2)
    ctx.lineTo(width / 2 + 2, height / 2 + 2)
    ctx.lineTo(width / 2 + 2, y)
    ctx.quadraticCurveTo(0, y - height * 0.05, -width / 2 - 2, y)
    ctx.closePath()
    ctx.fill()
  }

  ctx.restore()
}
