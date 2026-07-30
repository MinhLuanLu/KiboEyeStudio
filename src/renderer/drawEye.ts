import type { CustomEyeShape, CustomPupilShape, EyeColors, EyeParams } from '@/types'
import { DEFAULT_EYE_COLORS } from '@/types'
import { mixColors, shadeColor } from '@/lib/color'
import { PUPIL_SHAPE_POLYGONS, type PupilPolygon } from './pupilShapes'
import { EYE_SHAPE_POLYGONS, type EyeShapePolygon } from './eyeShapes'

export type EyeTheme = EyeColors

export const DEFAULT_EYE_THEME: EyeTheme = DEFAULT_EYE_COLORS

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
 */
export function drawEye(
  ctx: CanvasRenderingContext2D,
  params: EyeParams,
  theme: EyeTheme = DEFAULT_EYE_THEME,
  mirrorX = false,
  backgroundColor = '#000000',
  customShapes: CustomPupilShape[] = [],
  customEyeShapes: CustomEyeShape[] = []
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
    pupilShape,
    pupilCustomShapeId,
    pupilVisible,
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
    upperEyelidRoundness,
    lowerEyelidRoundness,
    upperEyelidStretchX,
    lowerEyelidStretchX,
    upperEyelidStretchY,
    lowerEyelidStretchY,
    upperEyelidSkew,
    lowerEyelidSkew,
    upperEyelidVisible,
    lowerEyelidVisible,
    highlightX,
    highlightY,
    highlightSize
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
      roundedRectPath(ctx, width + extraPx * 2, height + extraPx * 2, radius + extraPx)
    }
  }

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
    traceEyeBoundary()
    ctx.fill()
    // A couple of extra passes make the halo read as a soft glow rather than a single blur ring.
    ctx.fill()
    ctx.restore()
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
  if (theme.borderOpacity > 0 && theme.borderWidth > 0) {
    const ringColor = mixColors(backgroundColor, theme.border, theme.borderOpacity / 100)
    traceEyeBoundary(theme.borderWidth)
    ctx.fillStyle = ringColor
    ctx.fill()
  }

  traceEyeBoundary()
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
  //
  // Tilt is a *shear* (ctx.transform(1, slope, 0, 1, 0, 0), i.e. y' = y + slope*x), not a
  // rotation: rotating the covering shape around the eye's distant center reads as an
  // unnatural swoop for a small local feature like a lid, whereas shearing tilts the edge's
  // *angle* while keeping it anchored near the eye's own center — the standard technique for
  // this in 2D character rigs.
  //
  // The curved edge itself is a quartic "bump" — a border-radius-style taper, not a plain
  // parabola:
  //   taper(u) = (1 - u^2)^2      for u = x/halfW in [-1, 1]
  //   y(x)     = yBase + curveOffset * taper(u)
  // At x=0 (lid center) taper=1, giving the full curveOffset offset. Curvature ranges -100
  // (curved inward) to 100 (curved outward) through 0 (flat/neutral): a positive curveOffset
  // bulges the lid center further into the eye (more coverage there than at the flat sides);
  // a negative one pulls the center back toward less coverage instead. At x=±halfW (the
  // eye's own flat-side edge) taper AND its slope both reach exactly 0 regardless of sign,
  // so the curve blends into the flat sides — and from there into the eye's rounded corners
  // — with no kink, at any eye width/height/radius or curvature value. (A plain parabola
  // (1-u^2) reaches 0 at the edge but with a nonzero slope, which is what produced a visible
  // corner there; squaring the taper fixes that while keeping the same closed form.)
  //
  // Roundness/stretchX/stretchY/skew reshape this same taper — each one guaranteed to
  // preserve the "exactly 0, exactly zero-slope at u=±1" edge property above, so none of them
  // can ever reintroduce the corner kink the squared taper was chosen to avoid:
  //   - roundness (0-100) inserts a flat "plateau" of width `plateau` around u=0 where
  //     taper=1, then re-runs the same quartic taper over the *remaining* span out to u=±1
  //     (rescaled so it still lands on exactly 0 there) — this is what turns a single narrow
  //     peaked bump into a wider, flatter-topped dome that reads as a continuous rounded
  //     oval/egg arc. roundness=0 makes plateau=0, exactly reproducing the original formula.
  //   - stretchX (0-100%) is roundness's inverse-direction complement: it compresses the
  //     taper into a narrower portion of the remaining (non-plateau) span, leaving the rest
  //     flat at 0 — narrows the bump instead of widening it. 100% reproduces the original
  //     span exactly.
  //   - stretchY (0-200%) is a plain multiply on curveOffset — safe at any value since it
  //     never touches the taper's horizontal domain at all.
  //   - skew (-100 to 100) biases the plateau to be wider on one side than the other,
  //     shifting the bump's visual peak left/right instead of leaving it centered.
  // Canvas has no built-in primitive for this curve, so the path is built by sampling it at
  // one point per device pixel column and connecting with lineTo — with that many samples the
  // polyline is visually indistinguishable from a true smooth curve, and it guarantees this
  // preview evaluates the identical formula eyesFillEyelid() in the C++ export evaluates
  // per-column, so exported firmware renders the same lid shape.
  ctx.fillStyle = '#000000'
  const lidMargin = (width + height) * 2 // generous: keeps the lid's flat sides covering fully even after a 45° shear
  const halfW = width / 2
  const curveSamples = Math.max(32, Math.ceil(width))

  function eyelidCurvePoints(
    yBase: number,
    curveOffset: number,
    sign: 1 | -1,
    roundness: number,
    stretchX: number,
    stretchY: number,
    skew: number
  ): [number, number][] {
    const pts: [number, number][] = []
    if (halfW < 0.01) {
      pts.push([0, yBase])
      return pts
    }
    const roundFrac = Math.max(0, Math.min(100, roundness)) / 100
    const compress = Math.max(0.0001, Math.max(0, Math.min(100, stretchX)) / 100)
    const skewFrac = Math.max(-100, Math.min(100, skew)) / 100
    const offset = curveOffset * (Math.max(0, Math.min(200, stretchY)) / 100)
    for (let i = 0; i <= curveSamples; i++) {
      const x = halfW - (2 * halfW * i) / curveSamples
      const u = x / halfW
      const side = u >= 0 ? 1 : -1
      // Wider plateau on the side skew leans toward — always < 1 so a taper span always
      // remains, which is what keeps taper(u=±1) pinned at exactly 0 regardless of skew.
      const plateau = Math.max(0, Math.min(0.85, roundFrac * 0.7 * (1 + side * skewFrac * 0.6)))
      const au = Math.abs(u)
      let taper: number
      if (au <= plateau) {
        taper = 1
      } else {
        const span = Math.max((1 - plateau) * compress, 0.0001)
        const uu = Math.min((au - plateau) / span, 1)
        const t = 1 - uu * uu
        taper = t * t
      }
      pts.push([x, yBase + sign * offset * taper])
    }
    return pts
  }

  if (upperEyelidVisible && upperEyelid > 0) {
    const coverage = (upperEyelid / 100) * height
    const yBase = -height / 2 + coverage
    const curveOffset = (upperEyelidCurvature / 100) * height * 0.5
    const slope = Math.tan((upperEyelidTilt * Math.PI) / 180)
    ctx.save()
    ctx.transform(1, slope, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.moveTo(-lidMargin, -lidMargin)
    ctx.lineTo(lidMargin, -lidMargin)
    ctx.lineTo(lidMargin, yBase)
    for (const [x, y] of eyelidCurvePoints(yBase, curveOffset, 1, upperEyelidRoundness, upperEyelidStretchX, upperEyelidStretchY, upperEyelidSkew)) ctx.lineTo(x, y)
    ctx.lineTo(-lidMargin, yBase)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  if (lowerEyelidVisible && lowerEyelid > 0) {
    const coverage = (lowerEyelid / 100) * height
    const yBase = height / 2 - coverage
    const curveOffset = (lowerEyelidCurvature / 100) * height * 0.5
    const slope = Math.tan((lowerEyelidTilt * Math.PI) / 180)
    ctx.save()
    ctx.transform(1, slope, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.moveTo(-lidMargin, lidMargin)
    ctx.lineTo(lidMargin, lidMargin)
    ctx.lineTo(lidMargin, yBase)
    for (const [x, y] of eyelidCurvePoints(yBase, curveOffset, -1, lowerEyelidRoundness, lowerEyelidStretchX, lowerEyelidStretchY, lowerEyelidSkew)) ctx.lineTo(x, y)
    ctx.lineTo(-lidMargin, yBase)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}
