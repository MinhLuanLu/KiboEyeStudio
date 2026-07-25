import type { Project } from '@/types'

// Matches sizeof(EyeFrame) from cppExport.ts's struct layout, with typical compiler
// padding: 3x uint8 + 1x int8 + 1x uint8 + 1x uint8 (irisSize) + 1x uint8 (pupilSize) +
// 2x int8 + 2x uint8 + 2x int8 + 1x uint8 (14 bytes) + uint16 durationMs (needs 2-byte
// alignment -> +1 pad) + uint8 easing + 4x int8 bezier = 14 + 1 pad + 2 + 1 + 4 = 22,
// rounded up to 24 for struct alignment.
const EYE_FRAME_BYTES = 24

export interface SizeEstimate {
  keyframeCount: number
  flashBytes: number
  ramBytes: number
}

export function estimateProjectSize(project: Project): SizeEstimate {
  const keyframeCount = project.animations.reduce((sum, a) => sum + a.keyframes.length, 0) + project.expressions.length
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
