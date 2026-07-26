/** Parses `#rgb`/`#rrggbb` into 0-255 channel values. Falls back to black on bad input. */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = parseInt(full, 16)
  if (Number.isNaN(num) || full.length !== 6) return [0, 0, 0]
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Lightens (positive) or darkens (negative) a hex color by `percent` (-100..100). */
export function shadeColor(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex)
  const t = percent < 0 ? 0 : 255
  const p = Math.abs(percent) / 100
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p)
}

/** Linearly blends two hex colors; t=0 -> a, t=1 -> b. Used to pre-bake an opacity-like
 * effect into a single flat color for targets (Canvas 2D ring trick, RGB565 firmware) that
 * either shouldn't or can't do real per-pixel alpha compositing. */
export function mixColors(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const clamped = Math.max(0, Math.min(1, t))
  return rgbToHex(ar + (br - ar) * clamped, ag + (bg - ag) * clamped, ab + (bb - ab) * clamped)
}

export function luminance01(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export function saturation01(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  if (max === min) return 0
  const d = max - min
  return l > 0.5 ? d / (2 - max - min) : d / (max + min)
}

/** RGB565 packing for GC9A01 firmware color constants. */
export function hexToRgb565(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
}
