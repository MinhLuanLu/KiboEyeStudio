import type { DisplayBackgroundImage } from '@/types'

/** The one place that turns a DisplayBackgroundImage + the image's intrinsic size + the display
 * size into a destination rectangle (top-left x/y and w/h, in display pixels). BOTH the studio
 * preview (faceRenderer.ts) and the C++ export (cppExport.ts) call this, so a background is placed
 * identically on-screen and on-device. Every mode centers the result and then applies the x/y nudge
 * and the uniform aspect-preserving `scale`. `fill` is the only mode that ignores aspect ratio (it
 * stretches to the exact display size); the rest keep the image's own aspect. Overflow (cover, big
 * scale, nudged off-center) is left to the caller's display-shape clip. */
export function computeBackgroundRect(
  bg: DisplayBackgroundImage,
  imgW: number,
  imgH: number,
  dispW: number,
  dispH: number
): { x: number; y: number; w: number; h: number } {
  const iw = imgW > 0 ? imgW : 1
  const ih = imgH > 0 ? imgH : 1
  let w: number
  let h: number
  switch (bg.fitMode) {
    case 'fill':
      w = dispW
      h = dispH
      break
    case 'contain': {
      const s = Math.min(dispW / iw, dispH / ih)
      w = iw * s
      h = ih * s
      break
    }
    case 'cover': {
      const s = Math.max(dispW / iw, dispH / ih)
      w = iw * s
      h = ih * s
      break
    }
    case 'fitWidth': {
      const s = dispW / iw
      w = dispW
      h = ih * s
      break
    }
    case 'fitHeight': {
      const s = dispH / ih
      w = iw * s
      h = dispH
      break
    }
    case 'original':
      w = iw
      h = ih
      break
    case 'custom':
      w = bg.width
      h = bg.height
      break
    default:
      w = dispW
      h = dispH
  }
  const s = (bg.scale > 0 ? bg.scale : 100) / 100
  w *= s
  h *= s
  const x = (dispW - w) / 2 + bg.x
  const y = (dispH - h) / 2 + bg.y
  return { x, y, w, h }
}
