import type { EyeColors, EyeParams } from '@/types'
import { DEFAULT_EYE_COLORS } from '@/types'
import { mixColors, shadeColor } from '@/lib/color'

export type EyeTheme = EyeColors

export const DEFAULT_EYE_THEME: EyeTheme = DEFAULT_EYE_COLORS

// Ring thickness in device pixels — matches the constant baked into the C++ export
// (EYE_BORDER_WIDTH in cppExport.ts) so preview and firmware draw an identical width.
const BORDER_WIDTH = 3

/**
 * Traces a rounded-rect whose corners are quarter-*ellipses* (independent x/y radii)
 * rather than plain circular arcTo() corners. A single shared `radius` clamps
 * independently against half-width and half-height (rx = min(radius, w/2), ry = min(radius,
 * h/2)), so on a non-square eye the two clamps hit their ceiling at different radius values.
 * At the true maximum (radius >= max(w/2, h/2)) both rx and ry saturate at w/2 and h/2, every
 * flat edge segment shrinks to zero length, and the four corner arcs are literally four
 * quarters of the same ellipse — i.e. a smooth oval, not a rounded rectangle with flat
 * sides left over on the shorter axis (which is what a single circular corner radius,
 * clamped only by the smaller dimension, used to leave behind).
 */
function roundedRectPath(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number): void {
  const hx = w / 2
  const hy = h / 2
  const rx = Math.max(0, Math.min(radius, hx))
  const ry = Math.max(0, Math.min(radius, hy))
  ctx.beginPath()
  if (rx < 0.01 || ry < 0.01) {
    ctx.rect(-hx, -hy, w, h)
    ctx.closePath()
    return
  }
  ctx.moveTo(-hx + rx, -hy)
  ctx.lineTo(hx - rx, -hy)
  ctx.ellipse(hx - rx, -hy + ry, rx, ry, 0, -Math.PI / 2, 0)
  ctx.lineTo(hx, hy - ry)
  ctx.ellipse(hx - rx, hy - ry, rx, ry, 0, 0, Math.PI / 2)
  ctx.lineTo(-hx + rx, hy)
  ctx.ellipse(-hx + rx, hy - ry, rx, ry, 0, Math.PI / 2, Math.PI)
  ctx.lineTo(-hx, -hy + ry)
  ctx.ellipse(-hx + rx, -hy + ry, rx, ry, 0, Math.PI, (3 * Math.PI) / 2)
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
  mirrorX = false,
  backgroundColor = '#000000'
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
    pupilRotation,
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

  // Border — an outer rounded-rect one BORDER_WIDTH larger, filled with the border color
  // pre-blended toward the display background by borderOpacity. The eye shape drawn on top
  // right after this covers everything except a thin ring, so opacity needs no real alpha
  // compositing (RGB565 on the actual panel has none) — at 100% the ring is the pure border
  // color. At 0% we skip painting the ring at all rather than trusting the blend to land on
  // an exact background-colored no-op: two adjacent same-color arc fills can still leave a
  // faint antialiased seam on some canvas backends/display scale factors, and not drawing
  // anything is the only way to guarantee zero artifact.
  if (theme.borderOpacity > 0) {
    const ringColor = mixColors(backgroundColor, theme.border, theme.borderOpacity / 100)
    roundedRectPath(ctx, width + BORDER_WIDTH * 2, height + BORDER_WIDTH * 2, radius + BORDER_WIDTH)
    ctx.fillStyle = ringColor
    ctx.fill()
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

  // Pupil — rotates around its own center independent of the eye's own `rotation`. Like the
  // eye clip above, this is automatically confined inside the eye shape by the ctx.clip()
  // already in effect, however far Pupil X/Y push it toward (or past) the edge.
  if (pupilRX > 0.1 && pupilRY > 0.1) {
    ctx.beginPath()
    ctx.fillStyle = theme.pupil
    ctx.ellipse(pcx, pcy, pupilRX, pupilRY, (pupilRotation * Math.PI) / 180, 0, Math.PI * 2)
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
