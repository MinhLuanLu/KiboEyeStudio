import type { EyeParams } from '@/types'

export interface EyeTheme {
  eyeColorInner: string
  eyeColorOuter: string
  pupilColor: string
  highlightColor: string
  lidColor: string
}

export const DEFAULT_EYE_THEME: EyeTheme = {
  eyeColorInner: '#f4faff',
  eyeColorOuter: '#bfe0ff',
  pupilColor: '#0a1220',
  highlightColor: '#ffffff',
  lidColor: '#000000'
}

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
  const { width, height, radius, rotation, pupilSize, pupilX, pupilY, upperEyelid, lowerEyelid, highlightX, highlightY, highlightSize } = params
  const sign = mirrorX ? -1 : 1

  ctx.save()
  ctx.rotate((rotation * sign * Math.PI) / 180)

  roundedRectPath(ctx, width, height, radius)
  ctx.clip()

  // Eye base — soft vertical gradient for a premium glassy look
  const grad = ctx.createLinearGradient(0, -height / 2, 0, height / 2)
  grad.addColorStop(0, theme.eyeColorInner)
  grad.addColorStop(1, theme.eyeColorOuter)
  ctx.fillStyle = grad
  ctx.fillRect(-width / 2, -height / 2, width, height)

  // Pupil
  const halfSpan = Math.min(width, height) / 2
  const pupilR = Math.max(0, (pupilSize / 100) * halfSpan)
  const pcx = sign * (pupilX / 100) * (width / 2)
  const pcy = (pupilY / 100) * (height / 2)
  if (pupilR > 0.1) {
    ctx.beginPath()
    ctx.fillStyle = theme.pupilColor
    ctx.arc(pcx, pcy, pupilR, 0, Math.PI * 2)
    ctx.fill()

    // Highlight glint, positioned relative to the pupil
    const hR = Math.max(0, (highlightSize / 100) * pupilR)
    if (hR > 0.1) {
      const hx = pcx + sign * (highlightX / 100) * pupilR
      const hy = pcy + (highlightY / 100) * pupilR
      ctx.beginPath()
      ctx.fillStyle = theme.highlightColor
      ctx.globalAlpha = 0.92
      ctx.arc(hx, hy, hR, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  // Eyelids — slide in from top/bottom, softly curved, clipped to the eye shape
  ctx.fillStyle = theme.lidColor
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
