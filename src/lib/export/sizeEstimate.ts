import type { Project } from '@/types'
import { expressionShapeDiverges } from '@/types'

// Matches sizeof(EyeFrame) from cppExport.ts's struct layout, with typical compiler
// padding: 3x uint8 + 1x int8 + 1x uint8 + 2x uint8 (irisWidth/Height) + 2x uint8
// (pupilWidth/Height) + 2x int8 (pupilX/Y) = 11 bytes, then uint16 pupilRotation needs
// 2-byte alignment so 1 pad byte is inserted (-> offset 12) + 2 bytes = 14, + 2x uint8
// (eyelids) + 2x int8 (eyelid tilt) + 2x int8 (eyelid curvature) + 2x int8 (highlight X/Y)
// + 1x uint8 (highlightSize) = 23 (all packed tightly, no further padding since offset 14
// was already 2-byte aligned), then uint16 durationMs needs 2-byte alignment so 1 more pad
// byte (-> offset 24) + 2 bytes = 26, + uint8 easing + 4x int8 bezier = 31, + uint8 pupilShape
// + uint8 pupilCustomShapeIndex = 33, rounded up to 34 for the struct's own 2-byte alignment
// (from its uint16 members).
const EYE_FRAME_BYTES = 34

// Pupil Shapes section flash cost (see exportPupilShapes() in cppExport.ts) — separate from
// EYE_FRAME_BYTES since it's per-project, not per-keyframe: the 5 built-in shape tables
// (heart/star/diamond/square/triangle) are always emitted, roughly 2 bytes/point at up to 40
// points each; each custom SVG import adds one more table at a fixed 48 points.
const BUILTIN_PUPIL_SHAPE_TABLE_BYTES = 400
const CUSTOM_PUPIL_SHAPE_TABLE_BYTES = 48 * 2

export interface SizeEstimate {
  keyframeCount: number
  flashBytes: number
  ramBytes: number
}

export function estimateProjectSize(project: Project): SizeEstimate {
  // A diverged expression (Eye Target: Left/Right saved with different shapes) exports two
  // EyeFrame constants instead of one — count it as 2 "keyframe-equivalents" for the flash
  // estimate so per-eye divergence doesn't quietly under-report the exported size.
  const expressionFrameCount = project.expressions.reduce((sum, e) => sum + (expressionShapeDiverges(e) ? 2 : 1), 0)
  const keyframeCount = project.animations.reduce((sum, a) => sum + a.keyframes.length, 0) + expressionFrameCount
  const pupilShapeBytes = BUILTIN_PUPIL_SHAPE_TABLE_BYTES + project.customPupilShapes.length * CUSTOM_PUPIL_SHAPE_TABLE_BYTES
  const flashBytes = keyframeCount * EYE_FRAME_BYTES + pupilShapeBytes
  // Rough RAM estimate: one "current" and one "target" EyeFrame plus small player state,
  // since PROGMEM data itself doesn't consume RAM until copied out frame-by-frame.
  const ramBytes = EYE_FRAME_BYTES * 2 + 64
  return { keyframeCount, flashBytes, ramBytes }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} KB`
}
