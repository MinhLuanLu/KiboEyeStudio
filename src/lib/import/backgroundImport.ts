import type { DisplayBackgroundImage } from '@/types'

/** Thrown for a file that can't become a background image — caught at the call site and shown as a
 * plain-language message. */
export class BackgroundImportError extends Error {}

/** Pixel cap for the exported RGBA copy of a background (longest side). Larger than the sticker cap
 * (64) because a background fills the whole display — but still bounded so the RGB565 PROGMEM table
 * a full-display image bakes to stays reasonable (200x200x2 ≈ 78 KB). The studio preview always
 * uses the full-resolution `dataUrl`, so this only affects on-device sharpness. */
const MAX_BG_DIM = 200

/** SVG raster target (longest side) — SVGs are vector with no intrinsic pixel size, so pick a crisp
 * resolution for the preview bitmap and the exported copy alike. */
const SVG_RASTER_TARGET = 200

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new BackgroundImportError('Could not decode that image file.'))
    img.src = src
  })
}

/** Reads a canvas's pixels, downscaling first if it exceeds MAX_BG_DIM in either dimension. */
function extractRgba(source: HTMLCanvasElement): { width: number; height: number; data: number[] } {
  let canvas = source
  if (source.width > MAX_BG_DIM || source.height > MAX_BG_DIM) {
    const scale = Math.min(MAX_BG_DIM / source.width, MAX_BG_DIM / source.height)
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(source.width * scale))
    small.height = Math.max(1, Math.round(source.height * scale))
    const sctx = small.getContext('2d')
    if (sctx) {
      sctx.drawImage(source, 0, 0, small.width, small.height)
      canvas = small
    }
  }
  const ctx = canvas.getContext('2d')
  const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: imageData ? Array.from(imageData.data) : [] }
}

/** The placement defaults a freshly-uploaded background starts with: fill the display, no nudge,
 * full opacity, visible. */
function defaultPlacement(): Pick<DisplayBackgroundImage, 'fitMode' | 'x' | 'y' | 'scale' | 'opacity' | 'lockAspect' | 'visible'> {
  return { fitMode: 'cover', x: 0, y: 0, scale: 100, opacity: 100, lockAspect: true, visible: true }
}

function svgRasterSize(svgText: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const el = doc.documentElement
  let vw = parseFloat(el.getAttribute('width') ?? '')
  let vh = parseFloat(el.getAttribute('height') ?? '')
  if (!vw || !vh) {
    const parts = el.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number) ?? []
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

/** Decodes a user-selected PNG or SVG file into a ready-to-use DisplayBackgroundImage (with default
 * placement). Rejects anything else with a plain-language BackgroundImportError. */
export async function decodeBackgroundImageFile(file: File): Promise<DisplayBackgroundImage> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name)
  if (!isSvg && !isPng) throw new BackgroundImportError('Only PNG and SVG background images are supported.')

  if (isSvg) {
    const svgSource = await file.text()
    const { width, height } = svgRasterSize(svgSource)
    const blobUrl = URL.createObjectURL(new Blob([svgSource], { type: 'image/svg+xml' }))
    try {
      const img = await loadImage(blobUrl)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new BackgroundImportError('Could not rasterize that SVG.')
      ctx.drawImage(img, 0, 0, width, height)
      return {
        name: file.name,
        kind: 'svg',
        dataUrl: canvas.toDataURL('image/png'),
        rgba: extractRgba(canvas),
        naturalWidth: width,
        naturalHeight: height,
        svgSource,
        width,
        height,
        ...defaultPlacement()
      }
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new BackgroundImportError('Could not read that image.')
    ctx.drawImage(img, 0, 0)
    return {
      name: file.name,
      kind: 'raster',
      dataUrl: canvas.toDataURL('image/png'),
      rgba: extractRgba(canvas),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      width: img.naturalWidth,
      height: img.naturalHeight,
      ...defaultPlacement()
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
