import type { Project } from '@/types'
import { expressionShapeDiverges } from '@/types'
import { collectAnimationBreakpoints } from './cppExport'

// Matches sizeof(EyeFrame) from cppExport.ts's struct layout, with typical compiler padding.
// Recomputed field-by-field from the struct's current (full) member list, not incrementally
// patched — the previous version of this comment predated several fields (pupilVisible,
// eyeShape/eyeCustomShapeIndex/eyeShapeScale/eyeShapeOffsetX/Y/eyeShapeFlipH/V,
// upperEyelidVisible/lowerEyelidVisible) and had drifted out of sync with the real struct.
// width/height/radius/rotation/distance/eyePosX/eyePosY/irisWidth/irisHeight/pupilWidth/
// pupilHeight/pupilX/pupilY = 13 single-byte fields -> offset 13; pupilRotation (uint16) needs
// 2-byte alignment, so 1 pad byte -> offset 14, +2 bytes -> offset 16; upperEyelid through
// highlightSize = 27 more single-byte fields (upperEyelidLeftRoundness/RightRoundness and
// lowerEyelidLeftRoundness/RightRoundness replaced the old single upperEyelidRoundness/
// lowerEyelidRoundness pair, +2 fields net; upperEyelidCenterDepth/lowerEyelidCenterDepth/
// upperEyelidCenterY/lowerEyelidCenterY/upperEyelidSmoothness/lowerEyelidSmoothness/
// upperEyelidTension/lowerEyelidTension are the new eyelid-curve-model fields, +8 more) ->
// offset 43; durationMs (uint16) needs 2-byte alignment, so 1 pad byte -> offset 44, +2 bytes
// -> offset 46; easing through lowerEyelidVisible = 17 more single-byte fields -> offset 63;
// rounded up to the struct's own 2-byte alignment (from its uint16 members) -> 64.
const EYE_FRAME_BYTES = 64

// Pupil Shapes section flash cost (see exportPupilShapes() in cppExport.ts) — separate from
// EYE_FRAME_BYTES since it's per-project, not per-keyframe: the 5 built-in shape tables
// (heart/star/diamond/square/triangle) are always emitted, roughly 2 bytes/point at up to 40
// points each; each custom SVG import adds one more table at a fixed 48 points.
const BUILTIN_PUPIL_SHAPE_TABLE_BYTES = 400
const CUSTOM_PUPIL_SHAPE_TABLE_BYTES = 48 * 2

// Same purpose as the pupil-shape constants above, one level up — 13 built-in eye-shape point
// tables (heart/star/diamond reuse the pupil ones at runtime but still get their own emitted
// eye-shape table, since firmware indexes them via a separate EyeShapeId enum) plus a per-
// custom-import term.
const BUILTIN_EYE_SHAPE_TABLE_BYTES = 1040
const CUSTOM_EYE_SHAPE_TABLE_BYTES = 48 * 2

// Matches sizeof(StickerDef) from cppExport.ts's struct (see exportStickers()), with typical
// compiler padding: the largest members are the two uint32 fields (startTimeMs/endTimeMs,
// 4-byte aligned), so the struct rounds up to a multiple of 4 — roughly 56 bytes across
// kind/assetIndex/layer/x/y/width/height/scale/rotation/opacity/tintColor/flipH/flipV/
// animSpeed/animFps/startDelayMs/loopMode/reverse/fadeInMs/fadeOutMs/startTimeMs/endTimeMs/
// driftX/driftY/spin/pulseScale/pulseOpacity plus alignment gaps. Project, Expression, and
// Animation stickers all export to firmware (see the Stickers comment in cppExport.ts), so
// this counts every scope's own StickerDef array, not just project.stickers.
const STICKER_DEF_BYTES = 56

// A raster sticker frame's flash cost is exact (width*height*2 bytes RGB565, PROGMEM) rather
// than an approximation like the constants above, since cppExport.ts emits every pixel.
const STICKER_FRAME_WARN_DIM = 48 // px, in either dimension — larger costs meaningfully more flash and per-pixel draw time on a 240x240 panel
const STICKER_WARN_FRAME_COUNT = 20 // frames — more than this per raster asset adds up in flash and is usually more than a decorative sticker needs

export interface SizeEstimate {
  keyframeCount: number
  /** Visible stickers across every scope (project + every expression + every animation) —
   * matches what exportStickers() actually emits, see estimateProjectSize(). */
  stickerCount: number
  flashBytes: number
  ramBytes: number
  /** Human-readable warnings for oversized/too-many-frame raster stickers — surfaced in the
   * Dev Mode overlay so oversized imports get noticed before export, not after a slow-flashing
   * or dropped-frame surprise on real hardware. */
  stickerWarnings: string[]
}

export function estimateProjectSize(project: Project): SizeEstimate {
  // A diverged expression (Eye Target: Left/Right saved with different shapes) exports two
  // EyeFrame constants instead of one — count it as 2 "keyframe-equivalents" for the flash
  // estimate so per-eye divergence doesn't quietly under-report the exported size.
  const expressionFrameCount = project.expressions.reduce((sum, e) => sum + (expressionShapeDiverges(e) ? 2 : 1), 0)
  // Matches exportAnimation()'s own bakeAnimationFrames() logic in cppExport.ts: every
  // animation exports one EyeFrame per breakpoint (the union of all 5 tracks' keyframe times,
  // not just the pose track's own count), doubled when it authored Left Eye/Right Eye track
  // divergence (a second _framesRight array) — otherwise this would under-report flash usage
  // for any animation using the new multi-track keyframing.
  const animationFrameCount = project.animations.reduce((sum, a) => {
    const breakpointCount = collectAnimationBreakpoints(a).length
    const diverges = a.leftEyeKeyframes.length > 0 || a.rightEyeKeyframes.length > 0
    return sum + breakpointCount * (diverges ? 2 : 1)
  }, 0)
  const keyframeCount = animationFrameCount + expressionFrameCount
  const pupilShapeBytes = BUILTIN_PUPIL_SHAPE_TABLE_BYTES + project.customPupilShapes.length * CUSTOM_PUPIL_SHAPE_TABLE_BYTES
  const eyeShapeBytes = BUILTIN_EYE_SHAPE_TABLE_BYTES + project.customEyeShapes.length * CUSTOM_EYE_SHAPE_TABLE_BYTES

  // Mirrors exportStickers()'s own "every scope's visible stickers, raster assets deduped by
  // id across all of them" logic in cppExport.ts, so this estimate matches what actually gets
  // exported (Project.stickers + every Expression's + every Animation's own stickers).
  const allScopeStickers = [
    ...project.stickers,
    ...project.expressions.flatMap((e) => e.stickers),
    ...project.animations.flatMap((a) => a.stickers)
  ]
  const visibleStickers = allScopeStickers.filter((s) => s.visible)
  const assetsById = new Map(project.stickerAssets.map((a) => [a.id, a]))
  const usedRasterAssetIds = new Set<string>()
  const stickerWarnings: string[] = []
  let stickerRasterBytes = 0
  for (const s of visibleStickers) {
    const asset = assetsById.get(s.assetId)
    if (!asset || asset.kind !== 'raster' || !asset.frameRgba || usedRasterAssetIds.has(asset.id)) continue
    usedRasterAssetIds.add(asset.id)
    stickerRasterBytes += asset.frameRgba.reduce((sum, f) => sum + f.width * f.height * 2, 0)
    const maxDim = asset.frameRgba.reduce((m, f) => Math.max(m, f.width, f.height), 0)
    if (maxDim > STICKER_FRAME_WARN_DIM) {
      stickerWarnings.push(`"${asset.name}" is ${maxDim}px — consider resizing before export (adds flash + slows the frame draw).`)
    }
    if (asset.frameRgba.length > STICKER_WARN_FRAME_COUNT) {
      stickerWarnings.push(`"${asset.name}" has ${asset.frameRgba.length} frames — consider trimming (adds flash per frame).`)
    }
  }
  const stickerBytes = visibleStickers.length * STICKER_DEF_BYTES + stickerRasterBytes

  const flashBytes = keyframeCount * EYE_FRAME_BYTES + pupilShapeBytes + eyeShapeBytes + stickerBytes
  // Rough RAM estimate: one "current" and one "target" EyeFrame plus small player state,
  // since PROGMEM data itself doesn't consume RAM until copied out frame-by-frame.
  const ramBytes = EYE_FRAME_BYTES * 2 + 64
  return { keyframeCount, stickerCount: visibleStickers.length, flashBytes, ramBytes, stickerWarnings }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} KB`
}
