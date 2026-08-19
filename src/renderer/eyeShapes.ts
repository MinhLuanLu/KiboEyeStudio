import type { EyeShapeId } from '@/types'
import { DIAMOND, HEART, STAR, normalizePoints, type PupilPolygon } from './pupilShapes'

/**
 * The single shared definition of every non-'default' eye-outline silhouette, imported by both
 * the studio's Canvas 2D preview (drawEye.ts) and the C++ export (cppExport.ts) — same "compute
 * once, share everywhere" approach pupilShapes.ts already established, one level up: instead of
 * filling a polygon inside the eye's existing clip, these polygons BECOME the clip/boundary that
 * every other draw call (sclera/iris/pupil/eyelids/glow/border) relies on.
 *
 * Same normalized-polygon convention as pupilShapes.ts: closed [x, y] point lists centered on
 * their own bounding-box, scaled so the largest half-extent is exactly 1. Callers scale by the
 * eye's own width/height (further adjusted by eyeShapeScale), rotate by rotation, offset by
 * eyeShapeOffsetX/Y, and mirror by eyeShapeFlipH/V before translating to the eye's center.
 */
export type EyeShapePolygon = PupilPolygon

// Diamond/Star/Heart are the exact same tables pupilShapes.ts already defines — reused as-is,
// not redefined, so there is still exactly one diamond/star/heart shape in the whole codebase.
const EYE_DIAMOND: EyeShapePolygon = DIAMOND
const EYE_STAR: EyeShapePolygon = STAR
const EYE_HEART: EyeShapePolygon = HEART

// Regular hexagon, flat-topped (a point at each side rather than at top/bottom), inscribed in
// the unit circle — the one built-in shape geometrically trivial enough to need no hand-tuning.
const HEXAGON: EyeShapePolygon = (() => {
  const pts: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const angle = i * 60 * (Math.PI / 180)
    pts.push([Math.cos(angle), Math.sin(angle)])
  }
  return pts
})()

// Puffy cloud silhouette — lumpy rounded top, flatter bottom. Hand-plotted, not a reference
// asset — a reasonable first pass, same discipline HEART/STAR were originally hand-tuned
// without one; flagged as subject to visual iteration once seen rendered.
const CLOUD: EyeShapePolygon = normalizePoints([
  [-0.8, 0.4],
  [-0.9, 0.1],
  [-0.7, -0.2],
  [-0.75, -0.5],
  [-0.4, -0.7],
  [-0.1, -0.55],
  [0.15, -0.75],
  [0.5, -0.6],
  [0.6, -0.3],
  [0.85, -0.1],
  [0.8, 0.3],
  [0.5, 0.5],
  [-0.5, 0.5]
])

// Rounded drop, point up — a single tapered point at top blending into a full round bottom.
const TEARDROP: EyeShapePolygon = normalizePoints([
  [0, -1],
  [0.5, -0.35],
  [0.85, 0.15],
  [0.7, 0.6],
  [0.35, 0.9],
  [0, 1],
  [-0.35, 0.9],
  [-0.7, 0.6],
  [-0.85, 0.15],
  [-0.5, -0.35]
])

// Vesica/almond — pointed top and bottom, widest at the middle, symmetric left-right.
const LEAF: EyeShapePolygon = normalizePoints([
  [0, -1],
  [0.55, -0.5],
  [0.7, 0],
  [0.55, 0.5],
  [0, 1],
  [-0.55, 0.5],
  [-0.7, 0],
  [-0.55, -0.5]
])

// Kidney/bean — one concave notch on the lower-left breaks the otherwise-round silhouette.
const BEAN: EyeShapePolygon = normalizePoints([
  [0.3, -1],
  [0.8, -0.6],
  [0.9, 0],
  [0.6, 0.6],
  [0, 1],
  [-0.6, 0.6],
  [-0.3, 0.1],
  [-0.7, -0.3],
  [-0.5, -0.8]
])

// Crescent moon, opening to the right — an outer arc (radius 1, centered at origin) and an
// inner concave arc (radius 0.78, centered right of origin) walked in opposite directions so
// the even-odd/ray-casting fill this project's polygon routines use reads the inner arc as a
// bite taken out of the outer one. Computed (not hand-plotted) since an arc needs real sampling
// to read as round rather than faceted.
const CRESCENT: EyeShapePolygon = (() => {
  const pts: [number, number][] = []
  const outerR = 1
  const innerR = 0.78
  const innerCx = 0.45
  const SAMPLES = 14
  for (let i = 0; i <= SAMPLES; i++) {
    const a = (-80 + (160 * i) / SAMPLES) * (Math.PI / 180)
    pts.push([outerR * Math.cos(a), outerR * Math.sin(a)])
  }
  for (let i = 0; i <= SAMPLES; i++) {
    const a = (80 - (160 * i) / SAMPLES) * (Math.PI / 180)
    pts.push([innerCx + innerR * Math.cos(a), innerR * Math.sin(a)])
  }
  return normalizePoints(pts)
})()

// Happy Arc (⌒) — a thick rounded arch/bracket with ROUNDED end caps (not tapered points),
// matching the classic "closed happy eye" glyph: a constant-thickness stroke curving over the
// top, with a small semicircular cap at each end instead of pinching to a corner. Built from a
// centerline circular arc (radius R, spanning ±arcHalf from the top) offset by ±halfThick along
// its own radial direction to get the outer/inner boundary arcs, then two semicircular end caps
// connect them — the standard "stroke a curve with round caps" construction, sampled directly
// since this project's polygon fill has no stroke primitive of its own.
const HAPPY_ARC: EyeShapePolygon = (() => {
  const R = 1.3
  const peakDepth = 0.5
  const arcHalf = (65 * Math.PI) / 180
  const halfThick = 0.22
  const cx = 0
  const cy = R - peakDepth
  const radial = (t: number): [number, number] => [Math.sin(t), -Math.cos(t)]
  const tangent = (t: number): [number, number] => [Math.cos(t), Math.sin(t)]
  const centerline = (t: number): [number, number] => {
    const [rx, ry] = radial(t)
    return [cx + R * rx, cy + R * ry]
  }

  const pts: [number, number][] = []
  const ARC_SAMPLES = 12
  const CAP_SAMPLES = 8

  // Outer (top) edge, left to right.
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const t = -arcHalf + (2 * arcHalf * i) / ARC_SAMPLES
    const [rx, ry] = radial(t)
    pts.push([cx + (R + halfThick) * rx, cy + (R + halfThick) * ry])
  }

  // Right rounded cap: outer point -> outward tip -> inner point.
  {
    const [cxr, cyr] = centerline(arcHalf)
    const [ux, uy] = radial(arcHalf)
    const [vx, vy] = tangent(arcHalf) // outward direction, continuing past the arc's right end
    for (let i = 0; i <= CAP_SAMPLES; i++) {
      const beta = Math.PI / 2 - (Math.PI * i) / CAP_SAMPLES // 90deg -> -90deg
      const s = Math.sin(beta)
      const c = Math.cos(beta)
      pts.push([cxr + halfThick * (s * ux + c * vx), cyr + halfThick * (s * uy + c * vy)])
    }
  }

  // Inner (bottom) edge, right to left.
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const t = arcHalf - (2 * arcHalf * i) / ARC_SAMPLES
    const [rx, ry] = radial(t)
    pts.push([cx + (R - halfThick) * rx, cy + (R - halfThick) * ry])
  }

  // Left rounded cap: inner point -> outward tip -> outer point.
  {
    const [cxl, cyl] = centerline(-arcHalf)
    const [ux, uy] = radial(-arcHalf)
    const [tx, ty] = tangent(-arcHalf)
    const vx = -tx
    const vy = -ty // outward at the left end is the reverse tangent direction
    for (let i = 0; i <= CAP_SAMPLES; i++) {
      const beta = -Math.PI / 2 + (Math.PI * i) / CAP_SAMPLES // -90deg -> 90deg
      const s = Math.sin(beta)
      const c = Math.cos(beta)
      pts.push([cxl + halfThick * (s * ux + c * vx), cyl + halfThick * (s * uy + c * vy)])
    }
  }

  return normalizePoints(pts)
})()

// Narrow, diagonally-leaning pointed almond — a stylistic (not geometrically precise)
// interpretation, first-pass per the same reasoning as Cloud/Teardrop above.
const CAT_EYE: EyeShapePolygon = normalizePoints([
  [-1, 0.3],
  [-0.4, -0.6],
  [0.3, -0.9],
  [1, -0.5],
  [0.6, 0.2],
  [0, 0.6],
  [-0.5, 0.5]
])

// Tall almond with an upswept outer-top corner — stylistic interpretation, first-pass.
const ANIME_EYE: EyeShapePolygon = normalizePoints([
  [0, -1],
  [0.55, -0.85],
  [0.95, -0.35],
  [0.75, 0.35],
  [0.3, 0.85],
  [-0.2, 1],
  [-0.7, 0.7],
  [-0.9, 0.1],
  [-0.6, -0.6],
  [-0.15, -0.95]
])

// Flat-topped/bottomed rounded octagon — a simple "mechanical" silhouette, stylistic.
const ROBOT_EYE: EyeShapePolygon = normalizePoints([
  [-0.5, -1],
  [0.5, -1],
  [1, -0.5],
  [1, 0.5],
  [0.5, 1],
  [-0.5, 1],
  [-1, 0.5],
  [-1, -0.5]
])

// Mask Lens (Spider-Man-style) — a rounded triangle: a wide, gently-domed top narrowing to a
// soft point at the bottom, with all three corners and the edges bulged convex. Kept left/right
// symmetric so it reads as a mirrored pair on both eyes with no per-eye flip needed (use Eye
// Rotation / Eye Target flip for the exact inward-leaning mask angle). Hand-plotted, same
// discipline as Cloud/CatEye/AnimeEye above.
const MASK_LENS: EyeShapePolygon = normalizePoints([
  [-0.82, -0.78], // top-left corner (rounded)
  [-0.4, -0.95],
  [0.4, -0.95],
  [0.82, -0.78], // top-right corner (rounded)
  [0.95, -0.38],
  [0.72, 0.25], // right edge curving in toward the point
  [0.34, 0.78],
  [0.12, 0.96],
  [-0.12, 0.96], // bottom point (rounded, symmetric)
  [-0.34, 0.78],
  [-0.72, 0.25],
  [-0.95, -0.38] // left edge
])

/** `null` for 'default' (draws via the existing rounded-rect/ellipse path) and 'custom' (its
 * points live in Project.customEyeShapes, resolved by the caller via eyeCustomShapeId). */
export const EYE_SHAPE_POLYGONS: Partial<Record<EyeShapeId, EyeShapePolygon | null>> = {
  default: null,
  heart: EYE_HEART,
  star: EYE_STAR,
  diamond: EYE_DIAMOND,
  hexagon: HEXAGON,
  cloud: CLOUD,
  teardrop: TEARDROP,
  leaf: LEAF,
  bean: BEAN,
  crescent: CRESCENT,
  catEye: CAT_EYE,
  animeEye: ANIME_EYE,
  robotEye: ROBOT_EYE,
  happyArc: HAPPY_ARC,
  maskLens: MASK_LENS,
  custom: null
}

export { normalizePoints }
