import { decompressFrames, parseGIF } from 'gifuct-js'
import type { StickerSvgMeta } from '@/types'
import { parseSvgMeta } from '@/lib/svgRecolor'

/** Thrown for any file that can't become a sticker asset — caught at the call site and shown
 * to the user as a plain-language error rather than crashing the import flow. */
export class StickerImportError extends Error {}

/** Cap on the RGBA pixel data stored per frame (see DecodedStickerAsset.frameRgba) — bounds
 * worst-case project-file bloat from a many-frame GIF (raw RGBA is far larger than the
 * equivalent compressed PNG data URL) while staying far above what a 240x240 display's
 * stickers ever actually need at full resolution. */
const MAX_RGBA_DIM = 64

export interface CappedRgba {
  width: number
  height: number
  data: number[]
}

export interface DecodedStickerAsset {
  frames: string[] // data URLs, one per frame — used for studio preview (drawImage)
  frameDelaysMs: number[] // same length as frames
  frameRgba: CappedRgba[] // same length as frames — used for the (synchronous, DOM-free) C++ export
  naturalWidth: number
  naturalHeight: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new StickerImportError('Could not decode that image file.'))
    img.src = src
  })
}

/** Reads back a canvas's pixels, downsizing first if it exceeds MAX_RGBA_DIM in either
 * dimension — see MAX_RGBA_DIM's own comment for why this cap exists. */
export function extractCappedRgba(source: HTMLCanvasElement): CappedRgba {
  let canvas = source
  if (source.width > MAX_RGBA_DIM || source.height > MAX_RGBA_DIM) {
    const scale = Math.min(MAX_RGBA_DIM / source.width, MAX_RGBA_DIM / source.height)
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(source.width * scale))
    small.height = Math.max(1, Math.round(source.height * scale))
    const smallCtx = small.getContext('2d')
    if (smallCtx) {
      smallCtx.drawImage(source, 0, 0, small.width, small.height)
      canvas = small
    }
  }
  const ctx = canvas.getContext('2d')
  const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: imageData ? Array.from(imageData.data) : [] }
}

/** Decodes a PNG (or any static browser-supported raster format) into a single-frame sticker
 * asset — drawn once to an offscreen canvas to normalize to a plain data URL, same technique
 * ReferenceImportPanel.tsx already uses for its own (non-persisted) image preview. */
export async function decodePngSticker(file: File): Promise<DecodedStickerAsset> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new StickerImportError('Could not read that image.')
    ctx.drawImage(img, 0, 0)
    return {
      frames: [canvas.toDataURL('image/png')],
      frameDelaysMs: [100],
      frameRgba: [extractCappedRgba(canvas)],
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Target raster size (px, longest side) for imported SVG stickers — SVGs are vector and have
 * no natural pixel size, so this picks a resolution sharp enough for a 240x240 display sticker
 * regardless of the source SVG's own width/height/viewBox (which might be a tiny 24x24 icon or
 * a huge illustration). The resulting bitmap still passes through extractCappedRgba's own
 * MAX_RGBA_DIM downscale for the exported RGBA copy, same as PNG/GIF. */
const SVG_RASTER_TARGET = 200

/** Reads an SVG's own width/height or viewBox to compute an aspect-preserving raster size —
 * shared by decodeSvgSticker (initial import) and rasterizeSvgText (every subsequent recolor),
 * so a recolored instance's bitmap always matches the original import's resolution/aspect
 * ratio exactly, never drifting between the two call sites. */
function svgRasterSize(svgText: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svgEl = doc.documentElement
  let vw = parseFloat(svgEl.getAttribute('width') ?? '')
  let vh = parseFloat(svgEl.getAttribute('height') ?? '')
  if (!vw || !vh) {
    const viewBox = svgEl.getAttribute('viewBox')
    const parts = viewBox?.trim().split(/[\s,]+/).map(Number) ?? []
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      vw = parts[2]
      vh = parts[3]
    }
  }
  if (!vw || !vh || !Number.isFinite(vw) || !Number.isFinite(vh)) {
    vw = 128
    vh = 128
  }
  const scale = SVG_RASTER_TARGET / Math.max(vw, vh)
  return { width: Math.max(1, Math.round(vw * scale)), height: Math.max(1, Math.round(vh * scale)) }
}

/** Rasterizes SVG markup (already recolored, or not) into a single raster frame — the shared
 * primitive both the initial import (decodeSvgSticker, below) and every later per-instance
 * recolor (svgRecolor.ts's output, resolved by the Sticker Manager whenever an instance's
 * tint/colorMode changes) go through, so "what you see" always comes from this one rasterizer.
 * Transparency survives automatically: the canvas starts fully transparent and nothing fills a
 * background before drawImage(), so unpainted SVG regions stay alpha=0 all the way through to
 * the PNG data URL and the capped RGBA copy. */
export async function rasterizeSvgText(svgText: string): Promise<{ dataUrl: string; rgba: CappedRgba; width: number; height: number }> {
  const { width, height } = svgRasterSize(svgText)
  const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = await loadImage(blobUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new StickerImportError('Could not rasterize that SVG.')
    ctx.drawImage(img, 0, 0, width, height)
    return { dataUrl: canvas.toDataURL('image/png'), rgba: extractCappedRgba(canvas), width, height }
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

/** Decodes an SVG into a vector-preserving sticker asset: the raw markup is kept verbatim
 * (`svgSource`) — this is what preserves hierarchy/transforms/viewBox, since the original text
 * already has them and nothing here re-derives a lossier representation — alongside a parsed
 * `svgMeta` summary and a natural-colors raster preview (frames[0], for the Sticker Manager
 * thumbnail and as a same-shape fallback anywhere a plain `DecodedStickerAsset` is expected).
 * Actual color customization happens later, per placed *instance* — see svgRecolor.ts and
 * StickerInstance.resolvedSvg — not here at import time, since a color choice doesn't exist
 * yet when there's no instance to attach it to. This project's only other SVG handling (pupil/
 * eye-shape import, src/lib/svgShapeImport.ts) samples path outlines into a polygon instead,
 * since those shapes are drawn as fills, not blitted images — not reusable here. */
export async function decodeSvgSticker(file: File): Promise<DecodedStickerAsset & { svgSource: string; svgMeta: StickerSvgMeta }> {
  const text = await file.text()
  const meta = parseSvgMeta(text)
  if (meta.rasterizedFallback && !text.includes('<svg')) throw new StickerImportError('That file is not a valid SVG.')
  const raster = await rasterizeSvgText(text)
  return {
    frames: [raster.dataUrl],
    frameDelaysMs: [100],
    frameRgba: [raster.rgba],
    naturalWidth: raster.width,
    naturalHeight: raster.height,
    svgSource: text,
    svgMeta: meta
  }
}

/**
 * Decodes an animated GIF into its individual frames (as data URLs) plus each frame's native
 * delay, preserving the source's own animation timing. GIF frames are usually delta-encoded —
 * each frame patch only covers the sub-region that changed from the previous one — so this
 * composites every frame patch onto a persistent full-size canvas across the whole decode,
 * honoring each frame's disposal method (2 = clear the patch region back to transparent
 * before the next frame, 3 = restore whatever was there before this frame, anything else =
 * leave it and let the next patch draw over it), the standard GIF-to-frames algorithm.
 */
export async function decodeGifSticker(file: File): Promise<DecodedStickerAsset> {
  const buffer = await file.arrayBuffer()
  let gif: ReturnType<typeof parseGIF>
  try {
    gif = parseGIF(buffer)
  } catch {
    throw new StickerImportError('That file is not a valid GIF.')
  }
  const parsedFrames = decompressFrames(gif, true)
  if (parsedFrames.length === 0) throw new StickerImportError('That GIF has no frames.')

  const width = gif.lsd.width
  const height = gif.lsd.height
  const fullCanvas = document.createElement('canvas')
  fullCanvas.width = width
  fullCanvas.height = height
  const fullCtx = fullCanvas.getContext('2d')
  if (!fullCtx) throw new StickerImportError('Could not decode that GIF.')

  const frames: string[] = []
  const frameDelaysMs: number[] = []
  const frameRgba: CappedRgba[] = []
  let savedForRestore: ImageData | null = null

  for (const frame of parsedFrames) {
    if (frame.disposalType === 3) {
      savedForRestore = fullCtx.getImageData(0, 0, width, height)
    }

    const patchCanvas = document.createElement('canvas')
    patchCanvas.width = frame.dims.width
    patchCanvas.height = frame.dims.height
    const patchCtx = patchCanvas.getContext('2d')
    if (patchCtx) {
      const imageData = patchCtx.createImageData(frame.dims.width, frame.dims.height)
      imageData.data.set(frame.patch)
      patchCtx.putImageData(imageData, 0, 0)
      fullCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top)
    }

    frames.push(fullCanvas.toDataURL('image/png'))
    frameRgba.push(extractCappedRgba(fullCanvas))
    // Some GIFs encode a 0ms delay (browsers/tools traditionally clamp this to a sane
    // minimum, e.g. 100ms, rather than treating it as "as fast as possible").
    frameDelaysMs.push(frame.delay > 0 ? frame.delay : 100)

    if (frame.disposalType === 2) {
      fullCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height)
    } else if (frame.disposalType === 3 && savedForRestore) {
      fullCtx.putImageData(savedForRestore, 0, 0)
    }
  }

  return { frames, frameDelaysMs, frameRgba, naturalWidth: width, naturalHeight: height }
}
