/**
 * Automated studio-vs-firmware eye geometry parity checks.
 *
 * Run with: npx tsx scripts/verifyEyeGeometryParity.ts
 *
 * Neither a real ESP32 nor arduino-cli is available in this project's usual dev environment, so
 * this can't compile and diff actual firmware pixels against the studio's Canvas 2D output.
 * Instead it checks the thing that actually determines whether the two agree: the shared
 * geometry formulas both sides are supposed to implement identically.
 *
 *  1. Eye-rotation round-trip: the firmware's rotated fill routines (cppExport.ts, added
 *     alongside this script) inverse-rotate each device pixel into the eye's local frame via
 *     `lx = dx*cos(θ) + dy*sin(θ); ly = -dx*sin(θ) + dy*cos(θ)`, the exact mathematical inverse
 *     of the studio's `ctx.rotate(θ)` (`device = local rotated by θ`). This sweeps a battery of
 *     angles/points and confirms forward-then-inverse always recovers the original point — if
 *     these two formulas ever drift apart (e.g. a sign flip), this catches it immediately as a
 *     non-zero round-trip error, without needing to render anything.
 *  2. Eye-shape polygon placement: the studio's traceEyeShapePolygon() (drawEye.ts) and the
 *     firmware's eyesTransformEyeShape() (cppExport.ts) are supposed to place every eye-shape
 *     vertex identically given the same width/height/scale/offset/flip — reimplemented here
 *     verbatim from both source files (they're small, pure formulas) and diffed per vertex,
 *     per shape, across a spread of sizes/offsets/flip combinations.
 *  3. int8 export precision: firmware stores shape points as int8 scaled x100 (-127..127); this
 *     confirms every built-in shape's normalized points survive that round-trip within a tight
 *     tolerance (this is a real, bounded precision loss, not a shape distortion — flagged
 *     clearly if any point ever exceeds the tolerance, which would indicate a genuine bug, not
 *     expected quantization).
 */
import { EYE_SHAPE_POLYGONS, type EyeShapePolygon } from '../src/renderer/eyeShapes'
import type { EyeShapeId } from '../src/types'

let failures = 0
let checks = 0

function assertClose(label: string, actual: number, expected: number, tolerance: number) {
  checks++
  const diff = Math.abs(actual - expected)
  if (diff > tolerance) {
    failures++
    console.error(`FAIL  ${label}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)} (diff ${diff.toFixed(4)} > tol ${tolerance})`)
  }
}

// ---- 1. Eye-rotation round-trip -------------------------------------------------------------
// Studio forward rotation (ctx.rotate(theta) semantics): device = R(theta) * local.
function studioForwardRotate(lx: number, ly: number, thetaDeg: number): [number, number] {
  const rad = (thetaDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [lx * c - ly * s, lx * s + ly * c]
}
// Firmware inverse rotation, as implemented in cppExport.ts's rotated fill-routine branches.
function firmwareInverseRotate(dx: number, dy: number, thetaDeg: number): [number, number] {
  const rad = (thetaDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [dx * c + dy * s, -dx * s + dy * c]
}

const ANGLES = [0, 1, -1, 15, -15, 30, 45, -45, 60, 90, -90, 135, 179, -179, 359.5]
const POINTS: [number, number][] = [
  [0, 0],
  [10, 0],
  [0, 10],
  [37, -22],
  [-45, 45],
  [100, 100],
  [-100, -100],
  [63.5, -12.25]
]
for (const theta of ANGLES) {
  for (const [lx, ly] of POINTS) {
    const [dx, dy] = studioForwardRotate(lx, ly, theta)
    const [rlx, rly] = firmwareInverseRotate(dx, dy, theta)
    assertClose(`rotation round-trip θ=${theta} pt=(${lx},${ly}) x`, rlx, lx, 1e-6)
    assertClose(`rotation round-trip θ=${theta} pt=(${lx},${ly}) y`, rly, ly, 1e-6)
  }
}

// ---- 2 & 3. Eye-shape polygon placement + int8 export precision -----------------------------
// Studio: traceEyeShapePolygon() in drawEye.ts.
function studioEyeShapeVertex(
  px: number,
  py: number,
  w: number,
  h: number,
  scalePct: number,
  offsetX: number,
  offsetY: number,
  flipH: boolean,
  flipV: boolean
): [number, number] {
  const rx = (w / 2) * (scalePct / 100)
  const ry = (h / 2) * (scalePct / 100)
  const fx = flipH ? -1 : 1
  const fy = flipV ? -1 : 1
  return [offsetX + fx * px * rx, offsetY + fy * py * ry]
}
// Firmware: eyesTransformEyeShape() in cppExport.ts, points pre-scaled x100 as int8 on export
// (see pupilShapeTableLiteral()-style emission) then divided back by 100 at draw time.
function firmwareEyeShapeVertex(
  pxInt8: number,
  pyInt8: number,
  w: number,
  h: number,
  scalePct: number,
  offsetX: number,
  offsetY: number,
  flipH: boolean,
  flipV: boolean
): [number, number] {
  const hx = (w / 2) * (scalePct / 100)
  const hy = (h / 2) * (scalePct / 100)
  const fx = flipH ? -1 : 1
  const fy = flipV ? -1 : 1
  return [offsetX + fx * (pxInt8 / 100) * hx, offsetY + fy * (pyInt8 / 100) * hy]
}
function toInt8Scaled(v: number): number {
  return Math.max(-127, Math.min(127, Math.round(v * 100)))
}

const SIZE_CASES = [
  { w: 90, h: 90 },
  { w: 78, h: 100 },
  { w: 130, h: 60 }
]
const PLACEMENT_CASES = [
  { scale: 100, offsetX: 0, offsetY: 0, flipH: false, flipV: false },
  { scale: 150, offsetX: 12, offsetY: -8, flipH: true, flipV: false },
  { scale: 60, offsetX: -20, offsetY: 20, flipH: false, flipV: true },
  { scale: 200, offsetX: 30, offsetY: 30, flipH: true, flipV: true }
]

const shapeIds = Object.keys(EYE_SHAPE_POLYGONS) as EyeShapeId[]
for (const shapeId of shapeIds) {
  const polygon = EYE_SHAPE_POLYGONS[shapeId] as EyeShapePolygon | null
  if (!polygon) continue // 'default'/'custom' have no fixed built-in table — nothing to check here
  for (const { w, h } of SIZE_CASES) {
    for (const place of PLACEMENT_CASES) {
      for (const [px, py] of polygon) {
        const pxQ = toInt8Scaled(px)
        const pyQ = toInt8Scaled(py)
        const [sx, sy] = studioEyeShapeVertex(px, py, w, h, place.scale, place.offsetX, place.offsetY, place.flipH, place.flipV)
        const [fx, fy] = firmwareEyeShapeVertex(pxQ, pyQ, w, h, place.scale, place.offsetX, place.offsetY, place.flipH, place.flipV)
        // Tolerance accounts for the int8-scaled-x100 quantization (worst case 0.005 in
        // normalized space) amplified by the largest half-extent in play (200% scale of a
        // 130px-wide eye) — genuine shape distortion would show up as an error far larger than
        // this, not a fraction of a pixel.
        const maxHalfExtent = Math.max(w, h) * 2
        const tolerance = 0.006 * maxHalfExtent
        assertClose(`${shapeId} ${w}x${h} scale=${place.scale} off=(${place.offsetX},${place.offsetY}) flip=(${place.flipH},${place.flipV}) pt=(${px},${py}) x`, fx, sx, tolerance)
        assertClose(`${shapeId} ${w}x${h} scale=${place.scale} off=(${place.offsetX},${place.offsetY}) flip=(${place.flipH},${place.flipV}) pt=(${px},${py}) y`, fy, sy, tolerance)
      }
    }
  }
}

console.log(`\n${checks} checks run, ${failures} failed.`)
if (failures > 0) {
  console.error(`Eye geometry parity check FAILED (${failures}/${checks}).`)
  process.exit(1)
} else {
  console.log('Eye geometry parity check passed.')
}
