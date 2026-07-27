import type { PupilShapeId } from '@/types'

/**
 * The single shared definition of every non-ellipse pupil outline, imported by both the
 * studio's Canvas 2D preview (drawEye.ts) and the C++ export (cppExport.ts) so there is
 * exactly one heart/star/diamond/square/triangle shape in the whole codebase — the same
 * "compute once, share everywhere" approach used for glow/shadow/gradient work earlier this
 * project, which is what keeps the preview and firmware from ever silently drifting apart.
 *
 * Every shape here (including imported custom SVGs — see normalizePoints()) is a closed
 * polygon of [x, y] points normalized to a [-1, 1]-centered bounding box: centered on its own
 * bounding-box center, scaled so its largest half-extent (x or y) is exactly 1. Callers scale
 * by the live pupilWidth/pupilHeight-derived radii, rotate by pupilRotation, and translate to
 * the pupil's own center — the exact same transform already applied to the ellipse pupil, so
 * a polygon shape sits in precisely the position/size/rotation the sliders describe.
 */
export type PupilPolygon = readonly (readonly [number, number])[]

/** Centers `points` on their own bounding-box center and scales so the larger half-extent
 * (x or y) is exactly 1 — the normalization every built-in shape below already satisfies by
 * construction, and what custom SVG import (ReferenceImportPanel-style file read + native
 * SVGGeometryElement point sampling) must also produce before a shape is usable here. */
export function normalizePoints(points: readonly (readonly [number, number])[]): [number, number][] {
  if (points.length === 0) return []
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const halfExtent = Math.max(maxX - minX, maxY - minY) / 2 || 1
  return points.map(([x, y]) => [(x - cx) / halfExtent, (y - cy) / halfExtent])
}

const SQUARE: PupilPolygon = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1]
]

const DIAMOND: PupilPolygon = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
]

// Equilateral, apex-up, inscribed in the unit circle.
const TRIANGLE: PupilPolygon = [
  [0, -1],
  [0.866, 0.5],
  [-0.866, 0.5]
]

// Standard 10-vertex alternating outer/inner-radius star. 0.45 (rather than the "true"
// regular-pentagram ratio of ~0.382) gives visibly thicker points that stay legible at the
// small pixel sizes a pupil actually renders at on a 240x240 round display.
const STAR: PupilPolygon = (() => {
  const outer = 1
  const inner = 0.45
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const angle = (-90 + i * 36) * (Math.PI / 180)
    const r = i % 2 === 0 ? outer : inner
    pts.push([r * Math.cos(angle), r * Math.sin(angle)])
  }
  return pts
})()

// Classic parametric heart curve, sampled at HEART_SAMPLES points then normalized like every
// other shape here. y is negated so the two lobes land at the top and the point at the
// bottom in screen space (the raw formula's +y-up convention is the opposite of canvas/
// firmware's +y-down).
const HEART: PupilPolygon = (() => {
  const HEART_SAMPLES = 40
  const raw: [number, number][] = []
  for (let i = 0; i < HEART_SAMPLES; i++) {
    const t = (i / HEART_SAMPLES) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    raw.push([x, -y])
  }
  return normalizePoints(raw)
})()

/** `null` for 'circle'/'oval' (both draw via the existing ellipse path) and 'custom' (its
 * points live in Project.customPupilShapes, resolved by the caller via pupilCustomShapeId). */
export const PUPIL_SHAPE_POLYGONS: Record<PupilShapeId, PupilPolygon | null> = {
  circle: null,
  oval: null,
  square: SQUARE,
  diamond: DIAMOND,
  triangle: TRIANGLE,
  star: STAR,
  heart: HEART,
  custom: null
}
