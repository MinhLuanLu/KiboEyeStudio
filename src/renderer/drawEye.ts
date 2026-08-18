import type { CustomEyeShape, CustomPupilShape, EyeColors, EyeParams } from '@/types'
import { DEFAULT_EYE_COLORS } from '@/types'
import { mixColors, shadeColor, quantizeToRgb565 } from '@/lib/color'
import { PUPIL_SHAPE_POLYGONS, type PupilPolygon } from './pupilShapes'
import { EYE_SHAPE_POLYGONS, type EyeShapePolygon } from './eyeShapes'
import { eyelidTaper, type EyelidCurveShape } from './eyelidCurve'

export type EyeTheme = EyeColors

export const DEFAULT_EYE_THEME: EyeTheme = DEFAULT_EYE_COLORS

/** Rounds every color field in a theme to what the real RGB565 display can actually show —
 * used by drawEye()'s `firmwareSim` mode (ESP32 Export Preview) so the studio's own full
 * 24-bit palette doesn't hide the real color-banding the exported firmware will have. Only the
 * 7 hex-color fields are touched; numeric style fields (opacity/intensity/width) pass through
 * unchanged since they're not colors and RGB565 doesn't affect them. */
function quantizeThemeToRgb565(theme: EyeTheme): EyeTheme {
  return {
    ...theme,
    sclera: quantizeToRgb565(theme.sclera),
    iris: quantizeToRgb565(theme.iris),
    pupil: quantizeToRgb565(theme.pupil),
    highlight: quantizeToRgb565(theme.highlight),
    shadow: quantizeToRgb565(theme.shadow),
    glow: quantizeToRgb565(theme.glow),
    border: quantizeToRgb565(theme.border)
  }
}

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
function roundedRectPath(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number, offsetX = 0, offsetY = 0): void {
  const hx = w / 2
  const hy = h / 2
  const rx = Math.max(0, Math.min(radius, hx))
  const ry = Math.max(0, Math.min(radius, hy))
  const cx = offsetX
  const cy = offsetY
  ctx.beginPath()
  if (rx < 0.01 || ry < 0.01) {
    ctx.rect(cx - hx, cy - hy, w, h)
    ctx.closePath()
    return
  }
  ctx.moveTo(cx - hx + rx, cy - hy)
  ctx.lineTo(cx + hx - rx, cy - hy)
  ctx.ellipse(cx + hx - rx, cy - hy + ry, rx, ry, 0, -Math.PI / 2, 0)
  ctx.lineTo(cx + hx, cy + hy - ry)
  ctx.ellipse(cx + hx - rx, cy + hy - ry, rx, ry, 0, 0, Math.PI / 2)
  ctx.lineTo(cx - hx + rx, cy + hy)
  ctx.ellipse(cx - hx + rx, cy + hy - ry, rx, ry, 0, Math.PI / 2, Math.PI)
  ctx.lineTo(cx - hx, cy - hy + ry)
  ctx.ellipse(cx - hx + rx, cy - hy + ry, rx, ry, 0, Math.PI, (3 * Math.PI) / 2)
  ctx.closePath()
}

/**
 * Traces a normalized [-1,1]-space polygon (see pupilShapes.ts) into the current path via a
 * scale+rotate+translate transform — the same set of steps the pupil ellipse below already
 * applies via ctx.scale()/ctx.arc(), just for a fixed point list instead of a unit circle, so
 * a polygon pupil respects pupilWidth/Height/X/Y/Rotation exactly like the ellipse does.
 */
function tracePolygonPath(ctx: CanvasRenderingContext2D, polygon: PupilPolygon, cx: number, cy: number, rx: number, ry: number, rotationDeg: number): void {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  ctx.beginPath()
  polygon.forEach(([px, py], i) => {
    // Rotate in normalized space first, then scale by rx/ry — matches how the exported
    // firmware's eyesFillPolygonInEye() transforms each vertex, so preview and export always
    // agree on where a rotated non-uniform (rx != ry) polygon's corners land.
    const rxp = px * cos - py * sin
    const ryp = px * sin + py * cos
    const x = cx + rxp * rx
    const y = cy + ryp * ry
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

/**
 * Traces a normalized [-1,1]-space eye-shape polygon (see eyeShapes.ts) into the current path.
 * The eye's own `rotation` is already applied to the canvas via ctx.rotate() before any of this
 * module's path-tracing helpers run (see the top of drawEye() below), so — unlike
 * tracePolygonPath()'s pupil case, which needs its own independent rotationDeg — this only
 * scales, offsets, and flips: extraPx grows the traced silhouette uniformly in normalized-space
 * units (used to size the border ring's outer edge; 0 for glow/the main clip, which reuse the
 * eye's own true size).
 */
function traceEyeShapePolygon(
  ctx: CanvasRenderingContext2D,
  polygon: EyeShapePolygon,
  w: number,
  h: number,
  scalePct: number,
  offsetX: number,
  offsetY: number,
  flipH: boolean,
  flipV: boolean,
  extraPx = 0
): void {
  const rx = (w / 2) * (scalePct / 100) + extraPx
  const ry = (h / 2) * (scalePct / 100) + extraPx
  const fx = flipH ? -1 : 1
  const fy = flipV ? -1 : 1
  ctx.beginPath()
  polygon.forEach(([px, py], i) => {
    const x = offsetX + fx * px * rx
    const y = offsetY + fy * py * ry
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

/**
 * Draws a single eye centered at the current canvas origin (caller translates first).
 * `mirrorX` flips rotation/pupil/highlight horizontally so a left/right eye pair reads as
 * looking in the same world direction rather than toward/away from each other.
 *
 * `firmwareSim`: the ESP32 Export Preview mode. This still calls the exact same geometry code
 * as the normal render (same shape/rotation/scale/clip/eyelid math — there's no second renderer
 * to drift out of sync with this one), but swaps in the specific approximations the real
 * exported firmware has to make that Canvas 2D doesn't: colors are rounded to what RGB565 can
 * actually display (quantizeThemeToRgb565), the iris's smooth radial gradient is replaced by
 * eyesFillIrisGradient()'s own 6 concentric flat-color rings (cppExport.ts), and the glow's
 * ctx.shadowBlur halo is replaced by eyesFillGlow()'s own 4 concentric alpha-stepped rings —
 * matching cppExport.ts's actual algorithms line-for-line, not just its visual impression.
 * Sclera/eyelid/pupil/border/shape-boundary rendering is identical in both modes since firmware
 * computes those the same way, per-row/continuously, that Canvas 2D already does. Genuine
 * unsimulated gaps: real hardware has no anti-aliasing at all on primitive fills (Canvas 2D
 * paths are always anti-aliased) — flagged here rather than attempting a faithful per-pixel
 * rasterizer, which would need a second full software renderer to get right.
 */
export function drawEye(
  ctx: CanvasRenderingContext2D,
  params: EyeParams,
  theme: EyeTheme = DEFAULT_EYE_THEME,
  mirrorX = false,
  backgroundColor = '#000000',
  customShapes: CustomPupilShape[] = [],
  customEyeShapes: CustomEyeShape[] = [],
  firmwareSim = false
): void {
  if (firmwareSim) theme = quantizeThemeToRgb565(theme)
  const {
    width,
    height,
    radius,
    rotation,
    irisWidth,
    irisHeight,
    irisVisible,
    pupilWidth,
    pupilHeight,
    pupilX,
    pupilY,
    pupilRotation,
    pupilShape,
    pupilCustomShapeId,
    pupilVisible,
    highlightVisible,
    eyeShape,
    eyeCustomShapeId,
    eyeShapeScale,
    eyeShapeOffsetX,
    eyeShapeOffsetY,
    eyeShapeFlipH,
    eyeShapeFlipV,
    eyeShapeVisible,
    upperEyelid,
    lowerEyelid,
    upperEyelidTilt,
    lowerEyelidTilt,
    upperEyelidCurvature,
    lowerEyelidCurvature,
    upperEyelidLeftRoundness,
    upperEyelidRightRoundness,
    lowerEyelidLeftRoundness,
    lowerEyelidRightRoundness,
    upperEyelidStretchX,
    lowerEyelidStretchX,
    upperEyelidStretchY,
    lowerEyelidStretchY,
    upperEyelidSkew,
    lowerEyelidSkew,
    upperEyelidCenterDepth,
    lowerEyelidCenterDepth,
    upperEyelidCenterY,
    lowerEyelidCenterY,
    upperEyelidSmoothness,
    lowerEyelidSmoothness,
    upperEyelidTension,
    lowerEyelidTension,
    upperEyelidThickness,
    lowerEyelidThickness,
    upperEyelidVisible,
    lowerEyelidVisible,
    disableEyelid,
    highlightX,
    highlightY,
    highlightSize,
    extraHighlights
  } = params
  const sign = mirrorX ? -1 : 1

  // Layers panel: eyeShapeVisible=false falls back to the eye's own default rounded-rect
  // boundary without discarding the actual eyeShape/eyeCustomShapeId assignment (see the
  // comment on EyeParams.eyeShapeVisible in types/index.ts). Resolved once here since every
  // boundary-tracing call site below (glow/border/main clip) needs the same answer.
  const effectiveEyeShape = eyeShapeVisible ? eyeShape : 'default'
  const eyeShapePolygon: EyeShapePolygon | null =
    effectiveEyeShape === 'custom'
      ? (customEyeShapes.find((s) => s.id === eyeCustomShapeId)?.points ?? null)
      : (EYE_SHAPE_POLYGONS[effectiveEyeShape] ?? null)
  const traceEyeBoundary = (extraPx = 0): void => {
    if (eyeShapePolygon) {
      // sign mirrors offsetX for the right eye — same convention pupilX/highlightX already
      // use — so a shape leaning e.g. outward reads as outward on both eyes, not the same
      // absolute direction on both.
      traceEyeShapePolygon(ctx, eyeShapePolygon, width, height, eyeShapeScale, sign * eyeShapeOffsetX, eyeShapeOffsetY, eyeShapeFlipH, eyeShapeFlipV, extraPx)
    } else {
      // Same sign-mirroring convention as the polygon branch above (and pupilX/highlightX
      // elsewhere) — a shape nudged e.g. outward reads as outward on both eyes, not the same
      // absolute direction on both.
      roundedRectPath(ctx, width + extraPx * 2, height + extraPx * 2, radius + extraPx, sign * eyeShapeOffsetX, eyeShapeOffsetY)
    }
  }

  ctx.save()
  ctx.rotate((rotation * sign * Math.PI) / 180)

  // Outer glow — painted *before* the eye-shape clip so the blur can bleed outside the
  // rounded-rect silhouette (drawn on the round-display canvas behind everything else).
  // Skipped when "Disable Eyelid" is on: like the border ring below, the glow halo sits OUTSIDE
  // the eye shape and so outside the eyelid clip, leaving a lit rim around the eyelid-covered
  // part of the eye. Disable Eyelid renders only the inner-eye elements (sclera/iris/pupil/
  // highlight), so both outer decorations (glow + border) are suppressed.
  if (!disableEyelid && theme.glowIntensity > 0) {
    if (firmwareSim) {
      // Matches eyesFillGlow() in cppExport.ts exactly: 4 concentric grown-boundary rings,
      // largest/faintest first, each a flat color blended toward the background — Adafruit_GFX
      // has no blur primitive, so this stepped-ring falloff (not ctx.shadowBlur) is genuinely
      // what real hardware draws.
      const RINGS = 4
      const maxBlur = 4 + (theme.glowIntensity / 100) * 22
      const baseAlpha = 0.25 + (theme.glowIntensity / 100) * 0.55
      for (let i = RINGS; i >= 1; i--) {
        const t = i / RINGS
        const expand = maxBlur * t
        let alpha = baseAlpha * (1 - t) * 1.3
        if (alpha > 1) alpha = 1
        if (alpha <= 0.02) continue
        ctx.fillStyle = mixColors(backgroundColor, theme.glow, alpha)
        traceEyeBoundary(expand)
        ctx.fill()
      }
    } else {
      ctx.save()
      ctx.shadowColor = theme.glow
      ctx.shadowBlur = 4 + (theme.glowIntensity / 100) * 22
      ctx.globalAlpha = 0.25 + (theme.glowIntensity / 100) * 0.55
      ctx.fillStyle = theme.glow
      traceEyeBoundary()
      ctx.fill()
      // A couple of extra passes make the halo read as a soft glow rather than a single blur ring.
      ctx.fill()
      ctx.restore()
    }
  }

  // Border — an outer rounded-rect one theme.borderWidth larger, filled with the border color
  // pre-blended toward the display background by borderOpacity. The eye shape drawn on top
  // right after this covers everything except a thin ring, so opacity needs no real alpha
  // compositing (RGB565 on the actual panel has none) — at 100% the ring is the pure border
  // color. At 0% we skip painting the ring at all rather than trusting the blend to land on
  // an exact background-colored no-op: two adjacent same-color arc fills can still leave a
  // faint antialiased seam on some canvas backends/display scale factors, and not drawing
  // anything is the only way to guarantee zero artifact. theme.borderWidth is a Visual
  // Reference style field (see types/index.ts) — matches EYE_BORDER_WIDTH in the C++ export
  // exactly, so preview and firmware always draw an identical ring thickness.
  // "Disable Eyelid" (disableEyelid): skip the border ring entirely. The ring is drawn OUTSIDE
  // the eye shape (one borderWidth larger) and thus outside the eyelid clip below, so it would
  // otherwise stay visible around the eyelid-covered part of the eye — a full outline around the
  // "hidden" region. Skipping it leaves only the eyelid-clipped sclera/iris/pupil/highlight.
  if (!disableEyelid && theme.borderOpacity > 0 && theme.borderWidth > 0) {
    const ringColor = mixColors(backgroundColor, theme.border, theme.borderOpacity / 100)
    traceEyeBoundary(theme.borderWidth)
    ctx.fillStyle = ringColor
    ctx.fill()
  }

  traceEyeBoundary()
  ctx.clip()

  // "Disable Eyelid": clip the eye CONTENTS to the region the eyelids leave EXPOSED, so the
  // covered part of the eye stays pure background. Without this, the sclera is drawn all the way
  // to the eye's silhouette edge and the lid then covers it — but Canvas anti-aliases that shared
  // edge, leaving a ~1px light outline hugging the covered top/bottom arc of the eye (the seam the
  // border/glow suppression can't remove, because it's the eye's own edge). Clipping the contents
  // to just below the upper lid / above the lower lid means no sclera reaches the covered edge, so
  // there is nothing there to anti-alias. Studio-only: the ESP32 renders flat pixels with no AA,
  // so its covered region is already clean (see cppExport.ts). Uses the SAME curve math as the
  // eyelid fill (drawEyelid below), with the tilt shear applied per-point (y += slope*x) rather
  // than via ctx.transform — a transform would need a save/restore, and restore would drop the
  // clip along with it.
  if (disableEyelid) {
    const clipToExposedSide = (
      sign: 1 | -1,
      coveragePct: number,
      curvaturePct: number,
      tiltDeg: number,
      shape: EyelidCurveShape,
      centerYPct: number,
      stretchYPct: number
    ): void => {
      const halfW = width / 2
      if (coveragePct <= 0 || halfW < 0.01) return
      const samples = Math.max(32, Math.ceil(width))
      const coverage = (coveragePct / 100) * height
      const yBase = sign === 1 ? -height / 2 + coverage : height / 2 - coverage
      const curveOffset =
        (curvaturePct / 100) * height * 0.5 * (Math.max(0, Math.min(200, stretchYPct)) / 100)
      const slope = Math.tan((tiltDeg * Math.PI) / 180)
      const centerYOffset = (Math.max(-100, Math.min(100, centerYPct)) / 100) * height * 0.25
      const y0 = yBase + sign * centerYOffset
      const big = (width + height) * 2
      const exposedFarY = sign === 1 ? big : -big
      const endLeftY = y0 + sign * curveOffset * eyelidTaper(-1, shape) + slope * -halfW
      const endRightY = y0 + sign * curveOffset * eyelidTaper(1, shape) + slope * halfW
      ctx.beginPath()
      for (let i = 0; i <= samples; i++) {
        const x = -halfW + (2 * halfW * i) / samples
        const y = y0 + sign * curveOffset * eyelidTaper(x / halfW, shape) + slope * x
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineTo(big, endRightY)
      ctx.lineTo(big, exposedFarY)
      ctx.lineTo(-big, exposedFarY)
      ctx.lineTo(-big, endLeftY)
      ctx.closePath()
      ctx.clip()
    }
    if (upperEyelidVisible && upperEyelid > 0) {
      clipToExposedSide(1, upperEyelid, upperEyelidCurvature, upperEyelidTilt, {
        leftRoundness: upperEyelidLeftRoundness,
        rightRoundness: upperEyelidRightRoundness,
        width: upperEyelidStretchX,
        centerDepth: upperEyelidCenterDepth,
        centerX: upperEyelidSkew,
        smoothness: upperEyelidSmoothness,
        tension: upperEyelidTension
      }, upperEyelidCenterY, upperEyelidStretchY)
    }
    if (lowerEyelidVisible && lowerEyelid > 0) {
      clipToExposedSide(-1, lowerEyelid, lowerEyelidCurvature, lowerEyelidTilt, {
        leftRoundness: lowerEyelidLeftRoundness,
        rightRoundness: lowerEyelidRightRoundness,
        width: lowerEyelidStretchX,
        centerDepth: lowerEyelidCenterDepth,
        centerX: lowerEyelidSkew,
        smoothness: lowerEyelidSmoothness,
        tension: lowerEyelidTension
      }, lowerEyelidCenterY, lowerEyelidStretchY)
    }
  }

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
  // (canvas gradients are otherwise always circular). Skipped entirely when irisVisible is false
  // (Eye Controls toggle) without discarding the iris's size/colour settings.
  if (irisVisible && irisRX > 0.1 && irisRY > 0.1) {
    if (firmwareSim) {
      // Matches eyesFillIrisGradient() in cppExport.ts exactly: 6 concentric flat-color rings
      // (largest/darkest first, smallest/lightest on top), the same t>=0.75 breakpoint between
      // the light->base and base->dark blend ranges — Adafruit_GFX has no gradient fill, so
      // this stepped-ring approximation (not a true radial gradient) is what real hardware
      // draws, and the step edges are genuinely visible at this eye's actual pixel size.
      const RINGS = 6
      for (let i = RINGS; i >= 1; i--) {
        const t = i / RINGS
        const color = t >= 0.75 ? mixColors(theme.iris, shadeColor(theme.iris, -22), (t - 0.75) / 0.25) : mixColors(shadeColor(theme.iris, 12), theme.iris, t / 0.75)
        const ringRX = irisRX * t
        const ringRY = irisRY * t
        if (ringRX <= 0 || ringRY <= 0) continue
        ctx.beginPath()
        ctx.fillStyle = color
        ctx.ellipse(pcx, pcy, ringRX, ringRY, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
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
  }

  // Pupil — rotates around its own center independent of the eye's own `rotation`. Like the
  // eye clip above, this is automatically confined inside the eye shape by the ctx.clip()
  // already in effect, however far Pupil X/Y push it toward (or past) the edge. 'circle' and
  // 'oval' both keep the original ellipse path (RGB565 firmware has no alpha, so opacity is
  // pre-blended into a flat color here too, matching the highlight's alpha look below and the
  // border/glow "pre-blend at render/export time" pattern used throughout this renderer).
  if (pupilVisible && pupilRX > 0.1 && pupilRY > 0.1) {
    const pupilFill = mixColors(theme.iris, theme.pupil, theme.pupilOpacity / 100)
    const polygon =
      pupilShape === 'custom'
        ? (customShapes.find((s) => s.id === pupilCustomShapeId)?.points ?? null)
        : PUPIL_SHAPE_POLYGONS[pupilShape]
    ctx.fillStyle = pupilFill
    if (polygon) {
      tracePolygonPath(ctx, polygon, pcx, pcy, pupilRX, pupilRY, pupilRotation)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.ellipse(pcx, pcy, pupilRX, pupilRY, (pupilRotation * Math.PI) / 180, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Highlight glint, positioned relative to the pupil (or iris if the pupil is hidden, whether
  // by size or by the Layers panel's pupilVisible toggle) — stays a simple circle even when the
  // iris/pupil are stretched into ellipses.
  const highlightBaseX = pupilVisible && pupilRX > 0.1 ? pupilRX : irisRX
  const highlightBaseY = pupilVisible && pupilRY > 0.1 ? pupilRY : irisRY
  const highlightBase = (highlightBaseX + highlightBaseY) / 2
  // The primary highlight plus every extra glint (see EyeParams.extraHighlights) all draw the same
  // way: same base sizing, same sign-mirroring for the right eye, same shared color + 92% alpha.
  const drawHighlight = (hx100: number, hy100: number, size: number, visible: boolean) => {
    const hR = Math.max(0, (size / 100) * highlightBase)
    if (!visible || hR <= 0.1 || highlightBase <= 0.1) return
    const hx = pcx + sign * (hx100 / 100) * highlightBaseX
    const hy = pcy + (hy100 / 100) * highlightBaseY
    ctx.beginPath()
    ctx.fillStyle = theme.highlight
    ctx.globalAlpha = 0.92
    ctx.arc(hx, hy, hR, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  drawHighlight(highlightX, highlightY, highlightSize, highlightVisible)
  for (const h of extraHighlights ?? []) drawHighlight(h.x, h.y, h.size, h.visible)

  // Eyelids — slide in from top/bottom, softly curved, clipped to the eye shape. Always
  // matches the display's black background so it reads as the lid occluding the eye.
  //
  // Tilt is a *shear* (ctx.transform(1, slope, 0, 1, 0, 0), i.e. y' = y + slope*x), not a
  // rotation: rotating the covering shape around the eye's distant center reads as an
  // unnatural swoop for a small local feature like a lid, whereas shearing tilts the edge's
  // *angle* while keeping it anchored near the eye's own center — the standard technique for
  // this in 2D character rigs.
  //
  // The curved edge's SHAPE (0..1 height fraction per horizontal position) comes from the
  // shared eyelidTaper() in eyelidCurve.ts — see that file's own doc comment for the full
  // derivation of why it's C1-continuous everywhere. Here that shape is just scaled by
  // curveOffset (curvature% * eye height * 0.5 * stretchY%) and added to yBase:
  //   y(x) = yBase + sign*centerYOffset + curveOffset * eyelidTaper(x/halfW, shape)
  // Unlike the old single-plateau design, taper(u=±1) is no longer pinned to 0 — Left/Right
  // End Roundness now directly sets each edge's OWN height (0 = flush with the flat side, 100
  // = the curve reaches full amplitude right at that corner, i.e. "tall and fully rounded").
  // That means the two "wall" segments below (which extend the lid's flat sides off past the
  // eye's own clip, purely so the fill never leaves a gap at the true corner) have to reach
  // whatever height the curve's own edge sits at — hard-coding them to yBase, like the old
  // formula could get away with, would draw a visible seam whenever an edge's roundness is
  // nonzero, since the curve would start partway up/down from where the wall left off.
  // Per-lid Color + Opacity replace the old hardcoded '#000000' occlusion (default #000000/100%
  // reproduces it exactly). The curved edge is drawn as a smooth Catmull-Rom spline (not straight
  // lineTo segments) so it reads as one continuous arc with no visible facets at any openness.
  const lidMargin = (width + height) * 2 // generous: keeps the lid's flat sides covering fully even after a 45° shear
  const halfW = width / 2
  const curveSamples = Math.max(32, Math.ceil(width))

  function eyelidCurvePoints(
    yBase: number,
    curveOffset: number,
    sign: 1 | -1,
    shape: EyelidCurveShape,
    centerYPct: number
  ): { pts: [number, number][]; edgeYLeft: number; edgeYRight: number } {
    const centerYOffset = (Math.max(-100, Math.min(100, centerYPct)) / 100) * height * 0.25
    const y0 = yBase + sign * centerYOffset
    if (halfW < 0.01) return { pts: [[0, y0]], edgeYLeft: y0, edgeYRight: y0 }
    const pts: [number, number][] = []
    for (let i = 0; i <= curveSamples; i++) {
      const x = halfW - (2 * halfW * i) / curveSamples
      const u = x / halfW
      pts.push([x, y0 + sign * curveOffset * eyelidTaper(u, shape)])
    }
    return {
      pts,
      edgeYRight: y0 + sign * curveOffset * eyelidTaper(1, shape),
      edgeYLeft: y0 + sign * curveOffset * eyelidTaper(-1, shape)
    }
  }

  // Extends the current subpath through `pts` as a Catmull-Rom spline (converted to cubic
  // Béziers) — passes exactly through every sampled taper point while staying C1-continuous, so
  // the lid edge has no straight-segment facets even when few samples land inside the eye. The
  // end points clamp their virtual neighbors so both ends stay smooth.
  function curveThroughPoints(pts: [number, number][]) {
    if (pts.length === 0) return
    ctx.lineTo(pts[0][0], pts[0][1])
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1]
      const c1x = p1[0] + (p2[0] - p0[0]) / 6
      const c1y = p1[1] + (p2[1] - p0[1]) / 6
      const c2x = p2[0] - (p3[0] - p1[0]) / 6
      const c2y = p2[1] - (p3[1] - p1[1]) / 6
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1])
    }
  }

  function drawEyelid(
    sign: 1 | -1,
    yBase: number,
    curveOffset: number,
    slope: number,
    shape: EyelidCurveShape,
    centerYPct: number,
    thickness: number,
    color: string,
    opacityPct: number
  ) {
    const { pts, edgeYLeft, edgeYRight } = eyelidCurvePoints(yBase, curveOffset, sign, shape, centerYPct)
    // Defensive fallbacks: a theme that predates the per-lid Color/Opacity fields (e.g. a project
    // object still in memory from before those fields existed) would hand us `undefined`/`NaN`
    // here, which would set fillStyle to nothing and globalAlpha to NaN — silently drawing no lid
    // at all. Fall back to the original hardcoded occlusion (#000000, fully opaque) so the eyelid
    // always renders, matching the pre-Color/Opacity behavior exactly.
    const fillColor = typeof color === 'string' && color ? color : '#000000'
    const alpha = Number.isFinite(opacityPct) ? Math.max(0, Math.min(1, opacityPct / 100)) : 1
    const rim = Number.isFinite(thickness) ? thickness : 0
    const wallY = sign === 1 ? -lidMargin : lidMargin
    ctx.save()
    ctx.transform(1, slope, 0, 1, 0, 0)
    ctx.globalAlpha = alpha
    ctx.fillStyle = fillColor
    ctx.beginPath()
    ctx.moveTo(-lidMargin, wallY)
    ctx.lineTo(lidMargin, wallY)
    ctx.lineTo(lidMargin, edgeYRight)
    curveThroughPoints(pts)
    ctx.lineTo(-lidMargin, edgeYLeft)
    ctx.closePath()
    ctx.fill()
    // Optional soft rim/crease line along the curved edge (the lid's Thickness control).
    if (rim > 0 && pts.length > 1) {
      ctx.lineWidth = rim
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = shadeColor(fillColor, -35)
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      curveThroughPoints(pts)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  if (upperEyelidVisible && upperEyelid > 0) {
    const coverage = (upperEyelid / 100) * height
    const yBase = -height / 2 + coverage
    const curveOffset = (upperEyelidCurvature / 100) * height * 0.5 * (Math.max(0, Math.min(200, upperEyelidStretchY)) / 100)
    const slope = Math.tan((upperEyelidTilt * Math.PI) / 180)
    const shape: EyelidCurveShape = {
      leftRoundness: upperEyelidLeftRoundness,
      rightRoundness: upperEyelidRightRoundness,
      width: upperEyelidStretchX,
      centerDepth: upperEyelidCenterDepth,
      centerX: upperEyelidSkew,
      smoothness: upperEyelidSmoothness,
      tension: upperEyelidTension
    }
    drawEyelid(1, yBase, curveOffset, slope, shape, upperEyelidCenterY, upperEyelidThickness, theme.upperEyelidColor, theme.upperEyelidOpacity)
  }
  if (lowerEyelidVisible && lowerEyelid > 0) {
    const coverage = (lowerEyelid / 100) * height
    const yBase = height / 2 - coverage
    const curveOffset = (lowerEyelidCurvature / 100) * height * 0.5 * (Math.max(0, Math.min(200, lowerEyelidStretchY)) / 100)
    const slope = Math.tan((lowerEyelidTilt * Math.PI) / 180)
    const shape: EyelidCurveShape = {
      leftRoundness: lowerEyelidLeftRoundness,
      rightRoundness: lowerEyelidRightRoundness,
      width: lowerEyelidStretchX,
      centerDepth: lowerEyelidCenterDepth,
      centerX: lowerEyelidSkew,
      smoothness: lowerEyelidSmoothness,
      tension: lowerEyelidTension
    }
    drawEyelid(-1, yBase, curveOffset, slope, shape, lowerEyelidCenterY, lowerEyelidThickness, theme.lowerEyelidColor, theme.lowerEyelidOpacity)
  }

  ctx.restore()
}
