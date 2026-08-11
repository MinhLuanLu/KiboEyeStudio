import type { BuiltinStickerId, StickerAsset } from '@/types'
import { PUPIL_SHAPE_POLYGONS } from './pupilShapes'

/**
 * Built-in sticker art, drawn procedurally rather than as bitmaps — this app has never used
 * raster assets (glow/shadow, pupil shapes, everything else is small parametric Canvas 2D
 * drawing), and sourcing real PNG/GIF art for 14 presets isn't practical here. Every drawer
 * operates in the same [-1,1]-normalized "unit box" space pupilShapes.ts uses, so the caller
 * (drawSticker.ts) only ever needs one transform (translate + scale by the instance's
 * width/height/scale, rotate) regardless of which sticker it's drawing — and the exact same
 * closed-form math can be re-expressed in C++ for export (see the Stickers plan, §6) with no
 * risk of preview/firmware drift, the pattern this project has proven out twice already.
 *
 * `t` is seconds elapsed (wraps as each drawer likes — most use `t % period`), so a drawer is
 * a pure function of time: no internal state, nothing to reset when a sticker starts/stops.
 */
/** Optional per-instance drawer options. `strokeScale` is the line width in the [-1,1] unit box
 * (default per drawer); `loop` is false when the sticker's Loop Mode is "No Loop", so an animated
 * drawer plays its cycle once and then holds/fades to nothing instead of repeating. Drawers that
 * don't use strokes or don't animate simply ignore these. */
export interface StickerDrawOpts {
  strokeScale?: number
  loop?: boolean
}
export type StickerDrawer = (ctx: CanvasRenderingContext2D, t: number, tint: string, opts?: StickerDrawOpts) => void

// Deterministic pseudo-random in [0,1) from an integer seed — NOT Math.random(): particle
// layouts must be exactly reproducible so the C++ port (sinf/floorf, same formula) lays out
// identically to the preview.
function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function setAlpha(ctx: CanvasRenderingContext2D, a: number) {
  ctx.globalAlpha = Math.max(0, Math.min(1, a))
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], cx: number, cy: number, r: number, rot = 0) {
  const c = Math.cos(rot),
    s = Math.sin(rot)
  ctx.beginPath()
  points.forEach(([px, py], i) => {
    const x = cx + (px * c - py * s) * r
    const y = cy + (px * s + py * c) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.fill()
}

const STAR = PUPIL_SHAPE_POLYGONS.star!
const HEART = PUPIL_SHAPE_POLYGONS.heart!
const DIAMOND = PUPIL_SHAPE_POLYGONS.diamond!

// ---- rain: N diagonal drops looping downward -------------------------------------------
const rain: StickerDrawer = (ctx, t, tint) => {
  const N = 6
  ctx.strokeStyle = tint
  ctx.lineWidth = 0.06
  ctx.lineCap = 'round'
  for (let i = 0; i < N; i++) {
    const phase = hash01(i * 7 + 1)
    const xBase = -0.8 + 1.6 * hash01(i * 3 + 2)
    const speed = 0.9
    const y = ((t * speed + phase) % 1) * 2.2 - 1.1
    setAlpha(ctx, 0.5 + 0.5 * (1 - Math.abs(y)))
    ctx.beginPath()
    ctx.moveTo(xBase, y)
    ctx.lineTo(xBase - 0.08, y + 0.3)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ---- snow: N dots drifting down with a gentle horizontal sway ----------------------------
const snow: StickerDrawer = (ctx, t, tint) => {
  const N = 7
  ctx.fillStyle = tint
  for (let i = 0; i < N; i++) {
    const phase = hash01(i * 5 + 3)
    const xBase = -0.8 + 1.6 * hash01(i * 11 + 4)
    const speed = 0.35 + 0.1 * hash01(i * 13 + 5)
    const y = ((t * speed + phase) % 1) * 2.2 - 1.1
    const x = xBase + 0.12 * Math.sin(t * 2 + i)
    const r = 0.05 + 0.03 * hash01(i * 17 + 6)
    setAlpha(ctx, 0.85)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ---- zzz: three "Z" glyphs rising and fading in sequence ----------------------------------
function drawZ(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(cx - r, cy - r)
  ctx.lineTo(cx + r, cy - r)
  ctx.lineTo(cx - r, cy + r)
  ctx.lineTo(cx + r, cy + r)
  ctx.stroke()
}
const zzz: StickerDrawer = (ctx, t, tint) => {
  ctx.strokeStyle = tint
  ctx.lineWidth = 0.1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const period = 2.4
  for (let i = 0; i < 3; i++) {
    const local = ((t + i * (period / 3)) % period) / period // 0..1
    const cx = -0.6 + local * 1.3
    const cy = 0.7 - local * 1.6
    const r = 0.14 + 0.08 * i
    setAlpha(ctx, local < 0.15 ? local / 0.15 : local > 0.8 ? (1 - local) / 0.2 : 1)
    drawZ(ctx, cx, cy, r)
  }
  ctx.globalAlpha = 1
}

// ---- stars: a few gently twinkling stars ---------------------------------------------------
const stars: StickerDrawer = (ctx, t, tint) => {
  ctx.fillStyle = tint
  const N = 4
  for (let i = 0; i < N; i++) {
    const x = -0.7 + 1.4 * hash01(i * 9 + 1)
    const y = -0.7 + 1.4 * hash01(i * 9 + 2)
    const twinkle = 0.55 + 0.45 * Math.sin(t * (2 + hash01(i) * 2) + i * 10)
    setAlpha(ctx, twinkle)
    fillPolygon(ctx, STAR, x, y, 0.16 + 0.05 * hash01(i * 9 + 3))
  }
  ctx.globalAlpha = 1
}

// ---- hearts: reuses the pupil-shape heart polygon, gentle bob ------------------------------
const hearts: StickerDrawer = (ctx, t, tint) => {
  ctx.fillStyle = tint
  const N = 2
  for (let i = 0; i < N; i++) {
    const xBase = -0.4 + 0.8 * i
    const bob = 0.06 * Math.sin(t * 2 + i * 3)
    setAlpha(ctx, 0.9)
    fillPolygon(ctx, HEART, xBase, -0.1 + bob, 0.32)
  }
  ctx.globalAlpha = 1
}

// ---- sparkles: small twinkling 4-point spark shapes ----------------------------------------
const SPARK: readonly (readonly [number, number])[] = [
  [0, -1],
  [0.18, -0.18],
  [1, 0],
  [0.18, 0.18],
  [0, 1],
  [-0.18, 0.18],
  [-1, 0],
  [-0.18, -0.18]
]
const sparkles: StickerDrawer = (ctx, t, tint) => {
  ctx.fillStyle = tint
  const N = 5
  for (let i = 0; i < N; i++) {
    const x = -0.75 + 1.5 * hash01(i * 21 + 1)
    const y = -0.75 + 1.5 * hash01(i * 21 + 2)
    const phase = hash01(i * 21 + 3) * Math.PI * 2
    const twinkle = Math.max(0, Math.sin(t * 3 + phase))
    if (twinkle < 0.05) continue
    setAlpha(ctx, twinkle)
    fillPolygon(ctx, SPARK, x, y, 0.12 * twinkle + 0.04, t * 0.5 + i)
  }
  ctx.globalAlpha = 1
}

// ---- clouds: a cloud made of overlapping soft circles, gentle horizontal drift -------------
const clouds: StickerDrawer = (ctx, t, tint) => {
  ctx.fillStyle = tint
  setAlpha(ctx, 0.9)
  const dx = 0.05 * Math.sin(t * 0.3)
  const puffs: [number, number, number][] = [
    [-0.35, 0.1, 0.32],
    [0, -0.05, 0.4],
    [0.4, 0.1, 0.3],
    [-0.05, 0.25, 0.28]
  ]
  for (const [px, py, pr] of puffs) {
    ctx.beginPath()
    ctx.arc(px + dx, py, pr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ---- tears: two teardrops slowly sliding down and fading, looping --------------------------
function drawTeardrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.quadraticCurveTo(cx + r, cy + r * 0.2, cx, cy + r)
  ctx.quadraticCurveTo(cx - r, cy + r * 0.2, cx, cy - r)
  ctx.closePath()
  ctx.fill()
}
const tears: StickerDrawer = (ctx, t, tint) => {
  ctx.fillStyle = tint
  const N = 2
  for (let i = 0; i < N; i++) {
    const xBase = -0.3 + 0.6 * i
    const phase = hash01(i * 31 + 1)
    const y = ((t * 0.4 + phase) % 1) * 1.6 - 0.6
    setAlpha(ctx, 0.85 * (1 - Math.max(0, y - 0.6) / 0.4))
    drawTeardrop(ctx, xBase, y, 0.16)
  }
  ctx.globalAlpha = 1
}

// ---- fire: a flickering flame silhouette (wavy triangle) -----------------------------------
const fire: StickerDrawer = (ctx, t, tint) => {
  ctx.fillStyle = tint
  const flick = 0.08 * Math.sin(t * 9) + 0.05 * Math.sin(t * 17 + 1)
  ctx.beginPath()
  ctx.moveTo(0, -1 - flick)
  ctx.quadraticCurveTo(0.5, -0.2, 0.32, 0.4)
  ctx.quadraticCurveTo(0.2, 0.9, 0, 1)
  ctx.quadraticCurveTo(-0.2, 0.9, -0.32, 0.4)
  ctx.quadraticCurveTo(-0.5, -0.2, 0, -1 - flick)
  ctx.closePath()
  ctx.fill()
}

// ---- smoke: soft circles drifting up and fading, looping -----------------------------------
const smoke: StickerDrawer = (ctx, t, tint) => {
  ctx.fillStyle = tint
  const N = 4
  for (let i = 0; i < N; i++) {
    const phase = hash01(i * 41 + 1)
    const local = (t * 0.3 + phase) % 1
    const y = 0.9 - local * 1.8
    const x = 0.15 * Math.sin(t * 1.5 + i * 2)
    const r = 0.12 + local * 0.22
    setAlpha(ctx, 0.5 * (1 - local))
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ---- lightning: a jagged bolt that flashes on periodically ---------------------------------
const BOLT: readonly (readonly [number, number])[] = [
  [0.15, -1],
  [-0.25, 0.05],
  [0.05, 0.05],
  [-0.15, 1],
  [0.35, -0.1],
  [0.05, -0.1]
]
const lightning: StickerDrawer = (ctx, t, tint) => {
  const cycle = t % 1.6
  const flash = cycle < 0.12 ? 1 : cycle < 0.22 ? 0.4 : 0
  if (flash <= 0) return
  ctx.fillStyle = tint
  setAlpha(ctx, flash)
  ctx.beginPath()
  BOLT.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
}

// ---- burstLines: radiating comic-style impact lines, brief pulse ---------------------------
const burstLines: StickerDrawer = (ctx, t, tint) => {
  const N = 8
  const pulse = 0.7 + 0.3 * Math.sin(t * 4)
  ctx.strokeStyle = tint
  ctx.lineWidth = 0.06
  ctx.lineCap = 'round'
  setAlpha(ctx, 0.85)
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2
    const inner = 0.35
    const outer = 0.35 + 0.6 * pulse
    ctx.beginPath()
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ---- expandingCircles: concentric rings expanding outward and fading, looping --------------
const expandingCircles: StickerDrawer = (ctx, t, tint, opts) => {
  const N = 3
  ctx.strokeStyle = tint
  ctx.lineWidth = opts?.strokeScale ?? 0.05 // customizable stroke thickness (0.05 = original)
  const loop = opts?.loop ?? true
  for (let i = 0; i < N; i++) {
    // "No Loop" (loop=false): don't wrap, so once each ring passes local>=1 its alpha (1-local)
    // clamps to 0 and it stops drawing — the effect plays once, then holds nothing.
    const raw = t * 0.6 + i / N
    const local = loop ? raw % 1 : raw
    setAlpha(ctx, 1 - local)
    ctx.beginPath()
    ctx.arc(0, 0, local * 1, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ---- confetti: small rotating squares/diamonds falling, looping ----------------------------
const confetti: StickerDrawer = (ctx, t, tint) => {
  const N = 7
  for (let i = 0; i < N; i++) {
    const phase = hash01(i * 53 + 1)
    const xBase = -0.85 + 1.7 * hash01(i * 19 + 2)
    const speed = 0.4 + 0.2 * hash01(i * 23 + 3)
    const y = ((t * speed + phase) % 1) * 2.2 - 1.1
    const x = xBase + 0.15 * Math.sin(t * 3 + i)
    const spin = t * (2 + hash01(i * 29 + 4) * 3) + i
    ctx.fillStyle = i % 2 === 0 ? tint : '#ffffff'
    setAlpha(ctx, 0.9)
    fillPolygon(ctx, DIAMOND, x, y, 0.08, spin)
  }
  ctx.globalAlpha = 1
}

export const BUILTIN_STICKER_DRAWERS: Record<BuiltinStickerId, StickerDrawer> = {
  rain,
  snow,
  zzz,
  stars,
  hearts,
  sparkles,
  clouds,
  tears,
  fire,
  smoke,
  lightning,
  burstLines,
  expandingCircles,
  confetti
}

const BUILTIN_STICKER_NAMES: Record<BuiltinStickerId, string> = {
  rain: 'Rain',
  snow: 'Snow',
  zzz: 'Zzz',
  stars: 'Stars',
  hearts: 'Hearts',
  sparkles: 'Sparkles',
  clouds: 'Clouds',
  tears: 'Tears',
  fire: 'Fire',
  smoke: 'Smoke',
  lightning: 'Lightning',
  burstLines: 'Burst Lines',
  expandingCircles: 'Expanding Circles',
  confetti: 'Confetti'
}

/** Which built-ins animate (drive off `t`) vs. render a fixed pose — used by the Sticker
 * Manager's static/animated badge and to decide whether the preview loop even needs to keep
 * re-rendering a given sticker. `clouds`/`hearts` still take `t` (for their gentle drift/bob)
 * but read as "mostly static" — listed here as animated too since they do change over time. */
export const BUILTIN_STICKER_ANIMATED: Record<BuiltinStickerId, boolean> = {
  rain: true,
  snow: true,
  zzz: true,
  stars: true,
  hearts: true,
  sparkles: true,
  clouds: true,
  tears: true,
  fire: true,
  smoke: true,
  lightning: true,
  burstLines: true,
  expandingCircles: true,
  confetti: true
}

/** One StickerAsset per built-in id, always present in Project.stickerAssets — see
 * normalizeStickerAssets() in persistence.ts and createDefaultProject() in state/store.ts. */
export const BUILTIN_STICKER_ASSETS: StickerAsset[] = (Object.keys(BUILTIN_STICKER_DRAWERS) as BuiltinStickerId[]).map((id) => ({
  id: `builtin-${id}`,
  name: BUILTIN_STICKER_NAMES[id],
  kind: 'procedural',
  builtinId: id
}))
