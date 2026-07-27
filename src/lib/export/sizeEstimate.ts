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

// Matches sizeof(StickerDef) from cppExport.ts's struct (see exportStickers()), with typical
// compiler padding: the largest members are the two uint32 fields (startTimeMs/endTimeMs,
// 4-byte aligned), so the struct rounds up to a multiple of 4 — roughly 56 bytes across
// kind/assetIndex/layer/x/y/width/height/scale/rotation/opacity/tintColor/flipH/flipV/
// animSpeed/animFps/startDelayMs/loopMode/reverse/fadeInMs/fadeOutMs/startTimeMs/endTimeMs/
// driftX/driftY/spin/pulseScale/pulseOpacity plus alignment gaps. Only project-scope stickers
// export to firmware today (see the Stickers comment in cppExport.ts), so this only counts
// project.stickers, not Expression/Animation-scoped ones.
const STICKER_DEF_BYTES = 56

// A raster sticker frame's flash cost is exact (width*height*2 bytes RGB565, PROGMEM) rather
// than an approximation like the constants above, since cppExport.ts emits every pixel.
const STICKER_FRAME_WARN_DIM = 48 // px, in either dimension — larger costs meaningfully more flash and per-pixel draw time on a 240x240 panel
const STICKER_WARN_FRAME_COUNT = 20 // frames — more than this per raster asset adds up in flash and is usually more than a decorative sticker needs

export interface SizeEstimate {
  keyframeCount: number
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
  const keyframeCount = project.animations.reduce((sum, a) => sum + a.keyframes.length, 0) + expressionFrameCount
  const pupilShapeBytes = BUILTIN_PUPIL_SHAPE_TABLE_BYTES + project.customPupilShapes.length * CUSTOM_PUPIL_SHAPE_TABLE_BYTES

  // Mirrors exportStickers()'s own "visible project stickers, raster assets deduped by id"
  // logic in cppExport.ts, so this estimate matches what actually gets exported.
  const visibleStickers = project.stickers.filter((s) => s.visible)
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

  const flashBytes = keyframeCount * EYE_FRAME_BYTES + pupilShapeBytes + stickerBytes
  // Rough RAM estimate: one "current" and one "target" EyeFrame plus small player state,
  // since PROGMEM data itself doesn't consume RAM until copied out frame-by-frame.
  const ramBytes = EYE_FRAME_BYTES * 2 + 64
  return { keyframeCount, flashBytes, ramBytes, stickerWarnings }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} KB`
}
