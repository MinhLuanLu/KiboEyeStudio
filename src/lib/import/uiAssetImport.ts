/** Thrown for any file that can't become a UI Design Mode image asset — caught at the call
 * site and shown to the user as a plain-language error rather than crashing the import flow. */
export class UiAssetImportError extends Error {}

/** UI Design Mode images can be up to the full display resolution (240px) — unlike
 * stickerImport.ts's MAX_RGBA_DIM=64 cap, which is tuned for small procedural-scale sticker
 * effects, a background/logo/icon image in a real screen legitimately wants to fill a large
 * chunk of a 240x240 display. */
const MAX_ASSET_DIM = 240

export interface DecodedUiAsset {
  dataUrl: string
  naturalWidth: number
  naturalHeight: number
  sourceFormat: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new UiAssetImportError('Could not decode that image file.'))
    img.src = src
  })
}

function drawToCanvas(img: HTMLImageElement, naturalWidth: number, naturalHeight: number, sourceFormat: string): DecodedUiAsset {
  const scale = Math.min(1, MAX_ASSET_DIM / Math.max(naturalWidth, naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new UiAssetImportError('Could not read that image.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/png'), naturalWidth, naturalHeight, sourceFormat }
}

/** Guesses the human-readable original format from the file's MIME type (preferred) or its
 * extension (fallback, since some browsers/OSes report an empty/generic type for less common
 * formats like BMP/WebP) — display-only metadata, see UiAsset.sourceFormat's own comment. */
function guessSourceFormat(file: File): string {
  const fromMime = file.type.split('/')[1]
  if (fromMime) return fromMime.toUpperCase()
  const ext = file.name.split('.').pop()
  return ext ? ext.toUpperCase() : 'IMAGE'
}

/** Decodes any static raster format the browser's own <img> can display — PNG/JPG/BMP/WebP —
 * via the same <img>+canvas route for all of them. GIF is routed to `decodeGifAsset` instead
 * (see its own comment): drawing an animated GIF into a canvas only ever captures whichever
 * single frame happened to be current at draw time, which would silently strip the animation. */
export async function decodeUiImageAsset(file: File): Promise<DecodedUiAsset> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    return drawToCanvas(img, img.naturalWidth, img.naturalHeight, guessSourceFormat(file))
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function isGifFile(file: File): boolean {
  return file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new UiAssetImportError('Could not read that image file.'))
    reader.readAsDataURL(file)
  })
}

/** GIF files keep their real, unmodified bytes as the asset's `dataUrl` instead of going through
 * `drawToCanvas()` like every other format — `ctx.drawImage()` + `toDataURL()` only ever captures
 * one frame (whichever was current at draw time), which would silently rasterize an animated GIF
 * into a static PNG. Preserving the original GIF bytes means `<img src=...>`/CSS
 * `background-image` (both already used by WidgetRenderer.tsx to render asset references) play
 * it back natively — no new rendering code needed, exactly like any other <img>-hosted GIF on the
 * web. Also not resized to `MAX_ASSET_DIM` like other formats: resizing an animated GIF through a
 * canvas would flatten it to a single frame for the same reason drawToCanvas can't be used at
 * all — an oversized GIF is a save-file-size tradeoff surfaced via the Asset Manager's byte-size
 * readout, matching this project's existing "large assets bloat the save file, noted in the UI,
 * not silently resolved" precedent already established for custom sticker imports. */
async function decodeGifAsset(file: File): Promise<DecodedUiAsset> {
  const dataUrl = await readFileAsDataUrl(file)
  const img = await loadImage(dataUrl)
  return { dataUrl, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, sourceFormat: 'GIF' }
}

/** Rasterizes an SVG file to a bitmap — genuinely new code, not a reuse of the existing SVG
 * handling elsewhere in this codebase (svgShapeImport.ts, used for custom pupil shapes, is
 * vector point-sampling via getPointAtLength(), not rasterization). This is the accepted
 * simplification for this pass: an imported SVG becomes a fixed-resolution bitmap asset, same
 * as every other embedded-rendering asset in this project (no vector renderer exists on the
 * ESP32 target either way). Reads the SVG's own width/height (falling back to a 240px square)
 * so simple icon SVGs without an explicit size still rasterize sensibly. */
export async function decodeSvgAsset(file: File): Promise<DecodedUiAsset> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new UiAssetImportError('That file is not valid SVG.')
  const svgEl = doc.documentElement
  const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number)
  const naturalWidth = Number(svgEl.getAttribute('width')) || viewBox?.[2] || MAX_ASSET_DIM
  const naturalHeight = Number(svgEl.getAttribute('height')) || viewBox?.[3] || MAX_ASSET_DIM

  const svgBlob = new Blob([text], { type: 'image/svg+xml' })
  const objectUrl = URL.createObjectURL(svgBlob)
  try {
    const img = await loadImage(objectUrl)
    return drawToCanvas(img, naturalWidth, naturalHeight, 'SVG')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function decodeUiAssetFile(file: File): Promise<DecodedUiAsset> {
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) return decodeSvgAsset(file)
  if (isGifFile(file)) return decodeGifAsset(file)
  return decodeUiImageAsset(file)
}

export interface DecodedRgbaFrame {
  width: number
  height: number
  data: number[]
}

/** Decodes a stored UiAsset's dataUrl (already a PNG, from import time) back into raw RGBA
 * pixels — used only at LVGL export time, never cached on the asset itself. Unlike
 * StickerAsset (capped at 64x64, small enough to keep a permanent frameRgba cache in the
 * project JSON), UiAsset images can be up to the full 240px display — persisting a decoded
 * RGBA array for those would bloat every save file by hundreds of KB per asset, so this
 * decodes fresh, on demand, only when actually exporting. */
export async function decodeDataUrlToRgba(dataUrl: string): Promise<DecodedRgbaFrame> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new UiAssetImportError('Could not read that image.')
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: Array.from(imageData.data) }
}
