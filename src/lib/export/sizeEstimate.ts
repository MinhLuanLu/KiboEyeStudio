import type { Project } from '@/types'
import { expressionShapeDiverges } from '@/types'

// Matches sizeof(EyeFrame) from cppExport.ts's struct layout, with typical compiler
// padding: 3x uint8 + 1x int8 + 1x uint8 + 2x uint8 (irisWidth/Height) + 2x uint8
// (pupilWidth/Height) + 2x int8 (pupilX/Y) = 11 bytes, then uint16 pupilRotation needs
// 2-byte alignment so 1 pad byte is inserted (-> offset 12) + 2 bytes = 14, + 2x uint8
// (eyelids) + 2x int8 (highlight X/Y) + 1x uint8 (highlightSize) = 19, then uint16
// durationMs needs 2-byte alignment so 1 more pad byte (-> offset 20) + 2 bytes = 22,
// + uint8 easing + 4x int8 bezier = 27, rounded up to 28 for the struct's own 2-byte
// alignment (from its uint16 members).
const EYE_FRAME_BYTES = 28

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
  const flashBytes = keyframeCount * EYE_FRAME_BYTES
  // Rough RAM estimate: one "current" and one "target" EyeFrame plus small player state,
  // since PROGMEM data itself doesn't consume RAM until copied out frame-by-frame.
  const ramBytes = EYE_FRAME_BYTES * 2 + 64
  return { keyframeCount, flashBytes, ramBytes }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} KB`
}
