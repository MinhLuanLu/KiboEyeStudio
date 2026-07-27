import type { EyeColors, EyeParams } from '@/types'
import { DEFAULT_EYE_COLORS, EYE_PARAM_RANGES } from '@/types'
import { luminance01, saturation01, rgbToHex, shadeColor } from '@/lib/color'

export interface AnalysisResult {
  eyeParams: Partial<EyeParams>
  colors: EyeColors
}

/**
 * Heuristic reference-image analyzer. It assumes the caller has already cropped the image
 * down to roughly one open eye (see ReferenceImportDialog's crop marquee) — there is no
 * face/eye detector here, just pixel statistics on that crop:
 *   - pupil: weighted centroid of the darkest pixels near the crop's center, then radius
 *     via ray-marching outward until luminance rises back up
 *   - iris: color/radius of the ring around the pupil, using a "sclera-likeness" scan to
 *     find where the ring stops looking like iris and starts looking like sclera
 *   - sclera: average color outside the iris ring
 *   - highlight: the brightest small cluster within the iris/pupil, relative to pupil center
 * Eyelid coverage and eye rotation are NOT estimated (no reliable signal without a real
 * eyelid/eyelash segmentation) — they default to open/upright and are left for the user to
 * dial in by hand afterward.
 */
export function analyzeEyeImage(imageData: ImageData): AnalysisResult {
  const { width: W, height: H, data } = imageData
  const n = W * H

  const lum = new Float32Array(n)
  const sat = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    lum[i] = luminance01(r, g, b)
    sat[i] = saturation01(r, g, b)
  }

  const sortedLum = Float32Array.from(lum).sort()
  const darkThreshold = sortedLum[Math.floor(n * 0.12)] ?? 0.25

  // ---- Pupil: weighted centroid of dark pixels within the central 70% of the crop ----
  const marginX = W * 0.15
  const marginY = H * 0.15
  let wsum = 0
  let cx = W / 2
  let cy = H / 2
  {
    let sx = 0
    let sy = 0
    let sw = 0
    for (let y = marginY; y < H - marginY; y++) {
      for (let x = marginX; x < W - marginX; x++) {
        const i = y * W + x
        if (lum[i] < darkThreshold) {
          const w = darkThreshold - lum[i]
          sx += x * w
          sy += y * w
          sw += w
        }
      }
    }
    if (sw > 0) {
      cx = sx / sw
      cy = sy / sw
      wsum = sw
    }
  }

  const maxR = Math.min(W, H) / 2 - 1

  function rayMarch(fromR: number, stepPx: number, isMatch: (i: number) => boolean, requireConsecutiveFail: number): number {
    const rays = 16
    let total = 0
    let count = 0
    for (let a = 0; a < rays; a++) {
      const angle = (a / rays) * Math.PI * 2
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      let fails = 0
      let r = fromR
      for (; r < maxR; r += stepPx) {
        const x = Math.round(cx + dx * r)
        const y = Math.round(cy + dy * r)
        if (x < 0 || x >= W || y < 0 || y >= H) break
        const i = y * W + x
        if (isMatch(i)) {
          fails = 0
        } else {
          fails++
          if (fails >= requireConsecutiveFail) {
            r -= (fails - 1) * stepPx
            break
          }
        }
      }
      total += Math.min(r, maxR)
      count++
    }
    return count > 0 ? total / count : fromR
  }

  const pupilRpx = wsum > 0 ? Math.max(2, rayMarch(0.5, 1, (i) => lum[i] < darkThreshold, 3)) : Math.min(W, H) * 0.12

  function ringAverageColor(rMin: number, rMax: number, filter: (i: number) => boolean): [number, number, number] | null {
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    const samples = 48
    for (let ring = rMin; ring <= rMax; ring += Math.max(1, (rMax - rMin) / 6)) {
      for (let a = 0; a < samples; a++) {
        const angle = (a / samples) * Math.PI * 2
        const x = Math.round(cx + Math.cos(angle) * ring)
        const y = Math.round(cy + Math.sin(angle) * ring)
        if (x < 0 || x >= W || y < 0 || y >= H) continue
        const i = y * W + x
        if (!filter(i)) continue
        const o = i * 4
        r += data[o]
        g += data[o + 1]
        b += data[o + 2]
        count++
      }
    }
    return count > 0 ? [r / count, g / count, b / count] : null
  }

  const pupilColorRgb = ringAverageColor(0, pupilRpx * 0.6, () => true) ?? [10, 18, 32]

  // ---- Iris: scan outward rings until a majority look "sclera-like" (bright + desaturated) ----
  const scleraLike = (i: number) => lum[i] > 0.55 && sat[i] < 0.2
  let irisRpx = pupilRpx * 1.8
  {
    const samples = 32
    for (let ring = pupilRpx * 1.15; ring < maxR; ring += 1.5) {
      let scleraCount = 0
      let total = 0
      for (let a = 0; a < samples; a++) {
        const angle = (a / samples) * Math.PI * 2
        const x = Math.round(cx + Math.cos(angle) * ring)
        const y = Math.round(cy + Math.sin(angle) * ring)
        if (x < 0 || x >= W || y < 0 || y >= H) continue
        const i = y * W + x
        total++
        if (scleraLike(i)) scleraCount++
      }
      if (total > 0 && scleraCount / total > 0.55) {
        irisRpx = ring
        break
      }
    }
  }

  const irisColorRgb =
    ringAverageColor(pupilRpx * 1.15, Math.max(pupilRpx * 1.2, irisRpx * 0.9), (i) => lum[i] < 0.85 && lum[i] > 0.04) ?? [79, 168, 255]

  const scleraColorRgb = ringAverageColor(irisRpx * 1.1, maxR, (i) => lum[i] > 0.4) ?? [244, 250, 255]

  // ---- Highlight: brightest small cluster within the iris/pupil area ----
  // Deliberately searches only *inside* the iris (never out to the sclera boundary) and
  // thresholds relative to the local max luminance rather than a whole-image percentile —
  // a flat, large sclera region would otherwise dominate a global "top N%" cutoff and get
  // mistaken for the highlight (verified against a synthetic test case).
  let hlx = cx - irisRpx * 0.3
  let hly = cy - irisRpx * 0.3
  let hlCount = 0
  {
    const radius = Math.max(pupilRpx * 1.4, irisRpx * 0.88)
    let localMax = 0
    for (let y = Math.max(0, cy - radius); y < Math.min(H, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x < Math.min(W, cx + radius); x++) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy > radius * radius) continue
        const i = Math.round(y) * W + Math.round(x)
        if (lum[i] > localMax) localMax = lum[i]
      }
    }
    const hlThreshold = Math.max(localMax * 0.88, 0.7)

    let sx = 0
    let sy = 0
    let sw = 0
    for (let y = Math.max(0, cy - radius); y < Math.min(H, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x < Math.min(W, cx + radius); x++) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy > radius * radius) continue
        const i = Math.round(y) * W + Math.round(x)
        if (lum[i] >= hlThreshold) {
          const w = lum[i]
          sx += x * w
          sy += y * w
          sw += w
          hlCount++
        }
      }
    }
    if (sw > 0) {
      hlx = sx / sw
      hly = sy / sw
    }
  }

  const halfW = W / 2
  const halfH = H / 2
  const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v))

  const pupilOffsetX = clamp(((cx - halfW) / halfW) * 100, EYE_PARAM_RANGES.pupilX)
  const pupilOffsetY = clamp(((cy - halfH) / halfH) * 100, EYE_PARAM_RANGES.pupilY)
  const highlightBaseR = pupilRpx > 1 ? pupilRpx : irisRpx
  const highlightX = clamp(((hlx - cx) / highlightBaseR) * 100, EYE_PARAM_RANGES.highlightX)
  const highlightY = clamp(((hly - cy) / highlightBaseR) * 100, EYE_PARAM_RANGES.highlightY)
  const highlightSize = clamp((Math.sqrt(hlCount / Math.PI) / highlightBaseR) * 100, EYE_PARAM_RANGES.highlightSize)

  // Normalize the crop's own aspect ratio into our width/height range, keeping the pupil
  // and iris ratios (scale-invariant vs. crop resolution) so they transfer directly.
  const targetMax = 100
  const aspect = W / H
  const width = clamp(aspect >= 1 ? targetMax : targetMax * aspect, EYE_PARAM_RANGES.width)
  const height = clamp(aspect >= 1 ? targetMax / aspect : targetMax, EYE_PARAM_RANGES.height)
  const radius = clamp(Math.min(width, height) * 0.22, EYE_PARAM_RANGES.radius)

  // The detected pupil/iris are circular in crop-pixel space, but expressed here as a
  // fraction of each axis independently (matching the studio's irisWidth/irisHeight and
  // pupilWidth/pupilHeight sliders) — comes out perfectly round for a square crop, and
  // scales sensibly with the crop's own aspect ratio otherwise.
  const irisWidth = clamp((irisRpx / halfW) * 100, EYE_PARAM_RANGES.irisWidth)
  const irisHeight = clamp((irisRpx / halfH) * 100, EYE_PARAM_RANGES.irisHeight)
  const pupilWidth = clamp((pupilRpx / halfW) * 100, EYE_PARAM_RANGES.pupilWidth)
  const pupilHeight = clamp((pupilRpx / halfH) * 100, EYE_PARAM_RANGES.pupilHeight)

  const irisHex = rgbToHex(...irisColorRgb)

  return {
    eyeParams: {
      width,
      height,
      radius,
      rotation: 0,
      irisWidth,
      irisHeight,
      pupilWidth,
      pupilHeight,
      pupilX: pupilOffsetX,
      pupilY: pupilOffsetY,
      upperEyelid: 0,
      lowerEyelid: 0,
      highlightX,
      highlightY,
      highlightSize: highlightSize > 1 ? highlightSize : 18
    },
    colors: {
      sclera: rgbToHex(...scleraColorRgb),
      iris: irisHex,
      pupil: rgbToHex(...pupilColorRgb),
      highlight: '#ffffff',
      shadow: shadeColor(irisHex, -65),
      glow: shadeColor(irisHex, 15),
      border: '#ffffff',
      shadowIntensity: 20,
      glowIntensity: 20,
      borderOpacity: DEFAULT_EYE_COLORS.borderOpacity,
      borderWidth: DEFAULT_EYE_COLORS.borderWidth
    }
  }
}
