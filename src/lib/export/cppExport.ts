import type {
  Animation,
  BuiltinStickerId,
  CustomPupilShape,
  EasingType,
  Expression,
  EyeColors,
  EyeParams,
  Project,
  PupilShapeId,
  StickerAsset,
  StickerInstance
} from '@/types'
import {
  clampFps,
  expressionLeftColors,
  expressionLeftParams,
  expressionRightColors,
  expressionRightParams,
  expressionShapeDiverges,
  leftEyeColors,
  rightEyeColors
} from '@/types'
import { hexToRgb565, mixColors, shadeColor } from '@/lib/color'
import { PUPIL_SHAPE_POLYGONS } from '@/renderer/pupilShapes'
import { sampleAnimationEye } from '@/engine/interpolate'

const EASING_ENUM: Record<EasingType, string> = {
  linear: 'EYE_EASE_LINEAR',
  easeIn: 'EYE_EASE_IN',
  easeOut: 'EYE_EASE_OUT',
  easeInOut: 'EYE_EASE_INOUT',
  bounce: 'EYE_EASE_BOUNCE',
  elastic: 'EYE_EASE_ELASTIC',
  bezier: 'EYE_EASE_BEZIER'
}

function toIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim()
  const parts = cleaned.split(' ').filter(Boolean)
  const pascal = parts.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal
}

function clampByte(v: number): number {
  return Math.max(-127, Math.min(127, Math.round(v)))
}

function clampDegrees(v: number): number {
  return Math.round(((v % 360) + 360) % 360)
}

// 'circle'/'oval' both map to EYE_PUPIL_SHAPE_ELLIPSE — see EyeParams.pupilShape's doc
// comment in types/index.ts: they render identically, so the firmware only needs one enum
// value between them.
const PUPIL_SHAPE_ENUM: Record<PupilShapeId, string> = {
  circle: 'EYE_PUPIL_SHAPE_ELLIPSE',
  oval: 'EYE_PUPIL_SHAPE_ELLIPSE',
  heart: 'EYE_PUPIL_SHAPE_HEART',
  star: 'EYE_PUPIL_SHAPE_STAR',
  diamond: 'EYE_PUPIL_SHAPE_DIAMOND',
  square: 'EYE_PUPIL_SHAPE_SQUARE',
  triangle: 'EYE_PUPIL_SHAPE_TRIANGLE',
  custom: 'EYE_PUPIL_SHAPE_CUSTOM'
}

// Resolves pupilCustomShapeId to its position in project.customPupilShapes (exported as the
// PUPIL_CUSTOM_SHAPES/PUPIL_CUSTOM_SHAPE_POINT_COUNTS tables — see exportPupilShapes()) so
// eyesFillPupilShape() can index straight into them at runtime. 0 for a null/unmatched id is
// safe even when it happens to collide with a real shape 0, because that field is only ever
// read when pupilShape is actually 'custom' — eyeFrameLiteral() emits the correct
// EYE_PUPIL_SHAPE_CUSTOM enum value alongside it in that case, and unmatched ids (e.g. a
// custom shape deleted after being selected) are guarded at draw time exactly like the
// studio preview's own fallback-to-ellipse in drawEye.ts.
function resolveCustomShapeIndex(id: string | null, customShapes: CustomPupilShape[]): number {
  if (!id) return 0
  const index = customShapes.findIndex((s) => s.id === id)
  return index >= 0 ? index : 0
}

function eyeFrameLiteral(
  params: EyeParams,
  durationMs: number,
  easing: EasingType,
  customShapes: CustomPupilShape[],
  bezier?: [number, number, number, number]
): string {
  const [bx1, by1, bx2, by2] = bezier ?? [42, 0, 58, 100]
  const fields = [
    Math.round(params.width),
    Math.round(params.height),
    Math.round(params.radius),
    clampByte(params.rotation),
    Math.round(params.distance),
    Math.round(params.irisWidth),
    Math.round(params.irisHeight),
    Math.round(params.pupilWidth),
    Math.round(params.pupilHeight),
    clampByte(params.pupilX),
    clampByte(params.pupilY),
    clampDegrees(params.pupilRotation),
    Math.round(params.upperEyelid),
    Math.round(params.lowerEyelid),
    clampByte(params.upperEyelidTilt),
    clampByte(params.lowerEyelidTilt),
    clampByte(params.upperEyelidCurvature),
    clampByte(params.lowerEyelidCurvature),
    clampByte(params.highlightX),
    clampByte(params.highlightY),
    Math.round(params.highlightSize),
    Math.round(durationMs),
    EASING_ENUM[easing],
    Math.round(bx1),
    Math.round(by1),
    Math.round(bx2),
    Math.round(by2),
    PUPIL_SHAPE_ENUM[params.pupilShape],
    resolveCustomShapeIndex(params.pupilCustomShapeId, customShapes)
  ]
  return `  { ${fields.join(', ')} }`
}

interface BakedFrame {
  durationMs: number
  easing: EasingType
  customBezier?: [number, number, number, number]
  leftParams: EyeParams
  rightParams: EyeParams
}

/** Every keyframe time across all 5 of an Animation's independently-timed tracks (pose/
 * leftEye/rightEye/pupils/eyelids), sorted/deduped, clamped to [0, durationMs] — the "sample
 * points" bakeAnimationFrames() below flattens the whole animation down to. Between any two
 * adjacent breakpoints, every track is guaranteed to be mid-segment (never mid-transition
 * between two of its own keyframes), since a breakpoint exists at every point any track's
 * segment could change — this is what keeps the pre-baked EyeFrame array numerically faithful
 * to the studio preview's merged sampling for however many tracks were actually authored. */
export function collectAnimationBreakpoints(anim: Animation): number[] {
  const set = new Set<number>([0, anim.durationMs])
  for (const k of anim.keyframes) set.add(k.timeMs)
  for (const k of anim.leftEyeKeyframes) set.add(k.timeMs)
  for (const k of anim.rightEyeKeyframes) set.add(k.timeMs)
  for (const k of anim.pupilKeyframes) set.add(k.timeMs)
  for (const k of anim.eyelidKeyframes) set.add(k.timeMs)
  return Array.from(set)
    .filter((t) => t >= 0 && t <= anim.durationMs)
    .sort((a, b) => a - b)
}

/** Flattens an Animation's independently-timed tracks into the single duration-based EyeFrame
 * array the firmware's eyesPlayAnimation() plays back (Phase 1 export strategy — see the
 * Animation Editor's timeline plan: the merge/sample math runs once here rather than needing a
 * multi-track-aware firmware runtime). Each breakpoint samples sampleAnimationEye() for both
 * eyes; the per-frame easing/bezier is taken from whichever pose-track segment is active at
 * that breakpoint (the pose track is the required baseline every other track merges onto — see
 * sampleAnimationEye) — a segment where only a leftEye/rightEye/pupils/eyelids track actually
 * changes will still transition smoothly (the breakpoint spacing captures that motion), but if
 * that track's own authored easing differs from the pose track's, the exported firmware
 * interpolates that field using the pose segment's easing instead of its own; a documented
 * Phase-1 simplification, not a silent data loss (every field's actual authored *values* are
 * preserved exactly at every breakpoint). */
// Which pose-track keyframe a baked frame at exactly `t` should borrow its easing/bezier from
// — deliberately NOT sampleTrack()'s own segmentIndex, whose boundary convention (at t exactly
// equal to a keyframe's timeMs) picks the segment *ending* there, which is right for sampling a
// pose value (identical either way) but wrong here: a baked frame at a breakpoint needs the
// segment *departing* from it (i.e. governing the transition forward to the next breakpoint).
// Finds the last pose keyframe at-or-before `t`, matching every keyframe track's own "duration
// is this keyframe's own outgoing transition" convention.
function poseSegmentAt(anim: Animation, t: number): { easing: EasingType; customBezier?: [number, number, number, number] } {
  const kfs = anim.keyframes
  if (kfs.length === 0) return { easing: 'linear' }
  let idx = 0
  for (let i = 0; i < kfs.length; i++) {
    if (kfs[i].timeMs <= t) idx = i
    else break
  }
  return { easing: kfs[idx].easing, customBezier: kfs[idx].customBezier }
}

function bakeAnimationFrames(anim: Animation): BakedFrame[] {
  const breakpoints = collectAnimationBreakpoints(anim)
  return breakpoints.map((t, i) => {
    const segment = poseSegmentAt(anim, t)
    const isLast = i === breakpoints.length - 1
    const durationMs = isLast ? (anim.loop ? Math.max(0, anim.durationMs - t) : 0) : breakpoints[i + 1] - t
    return {
      durationMs,
      easing: segment.easing,
      customBezier: segment.customBezier,
      leftParams: sampleAnimationEye(anim, t, 'left'),
      rightParams: sampleAnimationEye(anim, t, 'right')
    }
  })
}

// Emits the baked keyframe array(s) plus count/loop flag (for anyone who wants direct/
// low-level access), this animation's own sticker array (visible only while it's playing —
// see the Stickers comment above), AND a single `EyeAnimation` wrapper bundling all of it —
// that wrapper is what PlayAnimation() below takes, so playing an animation is just
// `PlayAnimation(Anim_X)` instead of threading several separate globals through
// eyesPlayAnimation() by hand. A second `_framesRight` array (and non-null `EyeAnimation.
// framesRight`) is only emitted when this animation actually authored leftEye/rightEye track
// keyframes — the overwhelmingly common case (no divergence) still exports exactly one shared
// array, identical output to before this feature existed.
function exportAnimation(
  anim: Animation,
  customShapes: CustomPupilShape[],
  assetsById: Map<string, StickerAsset>,
  rasterIndexByAssetId: Map<string, number>
): string {
  const ident = toIdentifier(anim.name)
  const baked = bakeAnimationFrames(anim)
  const diverges = anim.leftEyeKeyframes.length > 0 || anim.rightEyeKeyframes.length > 0
  const stickers = anim.stickers.filter((s) => s.visible)

  const lines = [
    `// ${anim.name}${anim.loop ? ' (loops)' : ' (plays once)'}`,
    `const EyeFrame Anim_${ident}_frames[] PROGMEM = {`,
    baked.map((f) => eyeFrameLiteral(f.leftParams, f.durationMs, f.easing, customShapes, f.customBezier)).join(',\n'),
    `};`
  ]
  let framesRightIdent = 'nullptr'
  if (diverges) {
    framesRightIdent = `Anim_${ident}_framesRight`
    lines.push(
      `const EyeFrame ${framesRightIdent}[] PROGMEM = {`,
      baked.map((f) => eyeFrameLiteral(f.rightParams, f.durationMs, f.easing, customShapes, f.customBezier)).join(',\n'),
      `};`
    )
  }
  lines.push(
    `const uint16_t Anim_${ident}_count = ${baked.length};`,
    `const bool Anim_${ident}_loop = ${anim.loop ? 'true' : 'false'};`,
    ...stickerArrayLiteral(stickers, `Anim_${ident}_Stickers`, assetsById, rasterIndexByAssetId),
    `const EyeAnimation Anim_${ident} = { Anim_${ident}_frames, Anim_${ident}_count, Anim_${ident}_loop, ${framesRightIdent}, Anim_${ident}_Stickers, Anim_${ident}_Stickers_Count };`
  )
  return lines.join('\n')
}

// Expressions carry independent left/right *shape* only when they actually differ (Eye
// Target: Left/Right editing at Save time) — colors are handled separately (an expression can
// have divergent left/right colors independent of whether its shape diverges, so
// Expr_X_ColorsLeft/Right are always emitted as a pair regardless — see EYE_COLORS_LEFT/RIGHT's
// own "shared if identical" comment for the same pattern applied here). When shape doesn't
// diverge, everything bundles into one `EyeExpression` so SetExpression(Expr_X) also switches
// this expression's own colors and stickers, not just its pose — matching the studio, where
// applying an expression can change all three. When shape *does* diverge, SetExpression() can't
// take it (it needs one shared pose) — colors/stickers still export for manual
// eyesDrawEye()/eyesDrawStickers() use, per the existing Expr_X_L/Expr_X_R pattern.
function exportExpression(
  expr: Expression,
  customShapes: CustomPupilShape[],
  backgroundColor: string,
  assetsById: Map<string, StickerAsset>,
  rasterIndexByAssetId: Map<string, number>
): string {
  const ident = toIdentifier(expr.name)
  const leftColors = expressionLeftColors(expr)
  const rightColors = expressionRightColors(expr)
  const colorsSame = JSON.stringify(leftColors) === JSON.stringify(rightColors)
  const stickers = expr.stickers.filter((s) => s.visible)

  const colorLines = [`const EyeColorSet Expr_${ident}_ColorsLeft = ${colorSetLiteral(leftColors, backgroundColor)};`]
  if (colorsSame) {
    colorLines.push(`const EyeColorSet& Expr_${ident}_ColorsRight = Expr_${ident}_ColorsLeft;`)
  } else {
    colorLines.push(`const EyeColorSet Expr_${ident}_ColorsRight = ${colorSetLiteral(rightColors, backgroundColor)};`)
  }
  const stickerLines = stickerArrayLiteral(stickers, `Expr_${ident}_Stickers`, assetsById, rasterIndexByAssetId)

  if (!expressionShapeDiverges(expr)) {
    return [
      `const EyeFrame Expr_${ident}_Frame PROGMEM = \n${eyeFrameLiteral(expr.params, 0, 'linear', customShapes)};`,
      ...colorLines,
      ...stickerLines,
      `const EyeExpression Expr_${ident} = { &Expr_${ident}_Frame, &Expr_${ident}_ColorsLeft, &Expr_${ident}_ColorsRight, Expr_${ident}_Stickers, Expr_${ident}_Stickers_Count };`
    ].join('\n')
  }
  return [
    `// "${expr.name}" has different left/right eye shapes -- SetExpression() needs a single`,
    `// shared pose, so this exports as separate pieces for manual eyesDrawEye()/`,
    `// eyesDrawStickers() use instead of one bundled EyeExpression (see the Quick Reference`,
    `// below).`,
    `const EyeFrame Expr_${ident}_L PROGMEM = \n${eyeFrameLiteral(expressionLeftParams(expr), 0, 'linear', customShapes)};`,
    `const EyeFrame Expr_${ident}_R PROGMEM = \n${eyeFrameLiteral(expressionRightParams(expr), 0, 'linear', customShapes)};`,
    ...colorLines,
    ...stickerLines
  ].join('\n')
}

function toRgb565Hex(hex: string): string {
  return `0x${hexToRgb565(hex).toString(16).toUpperCase().padStart(4, '0')}`
}

// RGB565 has no alpha channel, so everything the studio preview draws as a gradient, a soft
// blur, or a partial-alpha overlay is pre-computed here into flat colors eyesDrawEye() can
// paint directly:
//   - Border Opacity: blended against the display background (matching the ring trick
//     eyesDrawEye uses) — 0% -> exactly the background color (invisible ring), 100% -> the
//     pure border color.
//   - Pupil Opacity: blended against the iris (what the pupil visually sits on top of) — 0% ->
//     the pupil becomes invisible against the iris, 100% -> the pure pupil color.
//   - Sclera/Iris: the studio draws a soft vertical gradient (sclera) and radial gradient
//     (iris) via shadeColor() — scleraTop/Bottom and irisLight/Dark are those exact shaded
//     endpoints, RGB565-packed; eyesFillEyeSclera()/eyesFillIrisGradient() (PLAYER_CODE)
//     approximate the gradients from these (scanline blend for sclera, concentric rings for
//     iris — Adafruit_GFX has no gradient primitive).
//   - Highlight: the studio draws it at a fixed 92% alpha over the pupil (matching pupilBlend
//     above) — highlightBlend is that exact blend, pre-baked the same way pupil opacity is.
//   - shadowIntensity/glowIntensity: passed through as-is (0-100) — eyesDrawEye() computes the
//     studio's exact alpha-ramp formulas from these at draw time, since (unlike the above) the
//     shadow/glow bands cover a *range* of alphas across many pixels, not one flat blend.
function colorSetLiteral(colors: EyeColors, backgroundColor: string): string {
  const borderBlend = mixColors(backgroundColor, colors.border, colors.borderOpacity / 100)
  const pupilBlend = mixColors(colors.iris, colors.pupil, colors.pupilOpacity / 100)
  const highlightBlend = mixColors(pupilBlend, colors.highlight, 0.92)
  const scleraTop = shadeColor(colors.sclera, 6)
  const scleraBottom = shadeColor(colors.sclera, -10)
  const irisLight = shadeColor(colors.iris, 12)
  const irisDark = shadeColor(colors.iris, -22)
  const fields = [
    toRgb565Hex(colors.sclera),
    toRgb565Hex(colors.iris),
    toRgb565Hex(pupilBlend),
    toRgb565Hex(colors.highlight),
    toRgb565Hex(colors.shadow),
    toRgb565Hex(colors.glow),
    toRgb565Hex(borderBlend),
    Math.round(colors.borderWidth),
    Math.max(0, Math.min(100, Math.round(colors.shadowIntensity))),
    Math.max(0, Math.min(100, Math.round(colors.glowIntensity))),
    toRgb565Hex(scleraTop),
    toRgb565Hex(scleraBottom),
    toRgb565Hex(irisLight),
    toRgb565Hex(irisDark),
    toRgb565Hex(highlightBlend)
  ]
  return `{ ${fields.join(', ')} }`
}

// Eye Target (Left/Right editing) lets the two eyes' colors diverge — EYE_COLORS_LEFT and
// EYE_COLORS_RIGHT are always both emitted so eyesDrawEyePair() always has two color sets to
// draw with, but when the eyes are identical, EYE_COLORS_RIGHT is just a reference to
// EYE_COLORS_LEFT rather than a duplicate struct, per "shared config to avoid duplicate code."
function exportColors(project: Project): string {
  const { display } = project
  const left = leftEyeColors(project)
  const right = rightEyeColors(project)
  const same = JSON.stringify(left) === JSON.stringify(right)
  const lines = [
    `#define EYE_COLOR_BACKGROUND ${toRgb565Hex(display.backgroundColor)} // RGB565 — Display panel's background color`,
    ``,
    `// sclera, iris, pupil, highlight, shadow, glow, border, borderWidth, shadowIntensity,`,
    `// glowIntensity, scleraTop, scleraBottom, irisLight, irisDark, highlightBlend — see the`,
    `// comment above colorSetLiteral() in the studio's cppExport.ts for what each precomputed`,
    `// field is for (border/pupil/highlight opacity and the sclera/iris gradients all have no`,
    `// RGB565 alpha channel to work with, so they're pre-blended here).`,
    `const EyeColorSet EYE_COLORS_LEFT = ${colorSetLiteral(left, display.backgroundColor)};`
  ]
  if (same) {
    lines.push(`const EyeColorSet& EYE_COLORS_RIGHT = EYE_COLORS_LEFT;  // identical to the left eye — shared, no duplicate data`)
  } else {
    lines.push(`const EyeColorSet EYE_COLORS_RIGHT = ${colorSetLiteral(right, display.backgroundColor)};`)
  }
  return lines.join('\n')
}

// Must be >= the largest point count any pupil polygon can have: the built-in shapes in
// pupilShapes.ts top out at HEART_SAMPLES (40), and custom SVG imports are always exactly
// SAMPLE_COUNT (48) points (see svgShapeImport.ts) — 48 covers both with room to spare. Sized
// once here rather than per-shape so eyesFillPolygonInEye()'s fixed-size scratch buffers
// (PLAYER_CODE) have one constant to agree with.
const MAX_PUPIL_POLYGON_POINTS = 48

// Built-in polygon shapes (everything in PUPIL_SHAPE_POLYGONS except the null entries —
// circle/oval draw via the existing ellipse path, and custom shapes come from the project's
// own library instead), keyed by the identifier suffix used in both the enum and table names.
const BUILTIN_POLYGON_SHAPES: { key: string; polygon: readonly (readonly [number, number])[] }[] = (
  ['heart', 'star', 'diamond', 'square', 'triangle'] as const
).map((key) => ({ key, polygon: PUPIL_SHAPE_POLYGONS[key]! }))

// Normalized [-1,1] points scaled ×100 into int8_t range (matching the byte-oriented
// convention already used for pupilX/pupilY etc.) — every point in every shape here is
// guaranteed within that range by construction (normalizePoints() caps the largest half-
// extent at exactly 1), so clampByte() below never actually needs to clamp, just round.
function pupilShapeTableLiteral(name: string, points: readonly (readonly [number, number])[]): string {
  const rows = points.map(([x, y]) => `  { ${clampByte(x * 100)}, ${clampByte(y * 100)} }`)
  return [`const int8_t ${name}[][2] PROGMEM = {`, rows.join(',\n'), `};`, `const uint8_t ${name}_COUNT = ${points.length};`].join('\n')
}

// Every non-ellipse pupil shape (built-in and custom) as a fixed-size int8_t point table,
// plus the enum eyeFrameLiteral() emits into EyeFrame.pupilShape. Placed before PLAYER_CODE
// in the generated header (see generateCppHeader()) since eyesFillPupilShape() there
// references these tables directly — C++ needs them declared first, same as every struct/
// #define PLAYER_CODE already depends on.
function exportPupilShapes(project: Project): string {
  const customShapes = project.customPupilShapes
  const lines: string[] = [
    'enum EyePupilShape : uint8_t {',
    '  EYE_PUPIL_SHAPE_ELLIPSE = 0,',
    '  EYE_PUPIL_SHAPE_HEART,',
    '  EYE_PUPIL_SHAPE_STAR,',
    '  EYE_PUPIL_SHAPE_DIAMOND,',
    '  EYE_PUPIL_SHAPE_SQUARE,',
    '  EYE_PUPIL_SHAPE_TRIANGLE,',
    '  EYE_PUPIL_SHAPE_CUSTOM',
    '};',
    '',
    `#define EYE_MAX_PUPIL_POLYGON_POINTS ${MAX_PUPIL_POLYGON_POINTS}`,
    ''
  ]
  for (const { key, polygon } of BUILTIN_POLYGON_SHAPES) {
    lines.push(`// ${key[0].toUpperCase()}${key.slice(1)} pupil shape`)
    lines.push(pupilShapeTableLiteral(`PUPIL_SHAPE_${key.toUpperCase()}`, polygon))
    lines.push('')
  }

  lines.push('// Custom pupil shapes imported in the studio (Pupil Shape picker -> Import SVG).')
  if (customShapes.length > 0) {
    customShapes.forEach((s, i) => {
      lines.push(`// "${s.name}"`)
      lines.push(pupilShapeTableLiteral(`PUPIL_CUSTOM_SHAPE_${i}`, s.points))
    })
    lines.push(`const int8_t (* const PUPIL_CUSTOM_SHAPES[])[2] = { ${customShapes.map((_, i) => `PUPIL_CUSTOM_SHAPE_${i}`).join(', ')} };`)
    lines.push(
      `const uint8_t PUPIL_CUSTOM_SHAPE_POINT_COUNTS[] = { ${customShapes.map((_, i) => `PUPIL_CUSTOM_SHAPE_${i}_COUNT`).join(', ')} };`
    )
  } else {
    lines.push('// (none in this project — these stay empty/unused; eyesFillPupilShape() never')
    lines.push('// indexes into them unless EyeFrame.pupilCustomShapeIndex < PUPIL_CUSTOM_SHAPE_COUNT.)')
    lines.push('const int8_t (* const PUPIL_CUSTOM_SHAPES[])[2] = { nullptr };')
    lines.push('const uint8_t PUPIL_CUSTOM_SHAPE_POINT_COUNTS[] = { 0 };')
  }
  lines.push(`const uint8_t PUPIL_CUSTOM_SHAPE_COUNT = ${customShapes.length};`)

  return lines.join('\n')
}

// ---- Stickers -------------------------------------------------------------------------
//
// Scope for this pass: only Project.stickers (the project-wide, "always visible" scope)
// exports to firmware — Expression.stickers/Animation.stickers stay studio-preview-only for
// now (they're a real feature there, applied to the effective sticker list the same way).
// Wiring per-expression/per-animation stickers into SetExpression()/PlayAnimation() would
// mean tracking a *second* time base per active pose and cross-referencing it against
// whichever expression/animation is currently live — a meaningfully separate chunk of player
// state beyond what this pass covers. Flagging this here the same way SVG/sprite-sheet
// import were flagged as deferred in the plan, rather than silently under-delivering it.
//
// Built-in procedural stickers: all 14 have a hand-ported C++ drawer below
// (eyesDrawSticker_Rain/Snow/Zzz/... in PLAYER_CODE), each a direct port of the matching
// drawer in the studio's builtinStickers.ts — same closed-form math/seeds, so firmware and
// studio preview lay out identically. A few use a fixed-polygon approximation of a curve the
// studio draws with quadratic beziers (tears, fire — Adafruit_GFX has no curve-fill
// primitive); noted on those two drawers individually.
//
// Raster (imported PNG/GIF) stickers export in full: each frame's already-capped (<=64x64,
// see stickerImport.ts) RGBA data quantizes to RGB565 here, with a reserved magenta sentinel
// marking below-threshold-alpha source pixels so the firmware draw loop simply skips them —
// binary transparency, the same RGB565-has-no-alpha workaround this project has used
// repeatedly (border/pupil opacity). Per-instance width/height scaling happens at *draw* time
// in the firmware (nearest-neighbor, see eyesDrawStickerRaster in PLAYER_CODE) rather than
// being pre-resized per instance at export time, so multiple instances of the same imported
// asset at different sizes share one exported pixel table instead of duplicating it.
//
// Per-instance opacity (including the fade-in/out envelope and pulseOpacity) is a *visibility
// threshold* in firmware, not a smooth per-pixel blend: for front-layer stickers, whatever's
// underneath (already-drawn eyes) is arbitrary and unknown at sticker-draw time, so there's no
// fixed color to alpha-blend against the way border/pupil opacity blend against a known
// background/iris. The studio preview still shows the true smooth fade — this is a firmware-
// only simplification, noted directly in the generated header. Per-instance tint is fully
// respected for procedural stickers (their drawers already take a solid fill color, so tinting
// is just passing a different one — no blending needed); raster stickers ignore tint in
// firmware for the same "no known destination to blend against" reason and draw their
// authored colors as-is.

const STICKER_TRANSPARENT_RGB565 = 0xf81f // bright magenta — chosen as a sentinel because it's
// extremely unlikely to occur in real sticker art; an opaque source pixel that happens to
// quantize to exactly this value gets its LSB flipped (see rgbaFrameToRgb565Table below) so it
// never gets mistaken for a transparent one.

const STICKER_BUILTIN_ENUM_ORDER: BuiltinStickerId[] = [
  'rain',
  'snow',
  'zzz',
  'stars',
  'hearts',
  'sparkles',
  'clouds',
  'tears',
  'fire',
  'smoke',
  'lightning',
  'burstLines',
  'expandingCircles',
  'confetti'
]

function stickerBuiltinEnumName(id: BuiltinStickerId): string {
  return `STICKER_BUILTIN_${id.replace(/([A-Z])/g, '_$1').toUpperCase()}`
}

// Every built-in now has a real C++ drawer (see eyesDrawStickerProcedural() in PLAYER_CODE) —
// kept as a set (rather than deleting the "unported" check in exportStickers() below) so a
// future built-in that's added without a firmware port yet still gets flagged instead of
// silently drawing nothing. Exported so validateStickers.ts can report the same thing per
// sticker in the Export dialog's checklist, instead of only as a header comment.
export const STICKER_BUILTINS_WITH_FIRMWARE_DRAWER: ReadonlySet<BuiltinStickerId> = new Set(STICKER_BUILTIN_ENUM_ORDER)

// RGBA (0-255 per channel) -> RGB565, with alpha < 128 mapped to the reserved transparent
// sentinel instead of a real color — see STICKER_TRANSPARENT_RGB565's own comment.
function rgbaFrameToRgb565Table(frame: { width: number; height: number; data: number[] }): number[] {
  const out: number[] = []
  const pixelCount = frame.width * frame.height
  for (let i = 0; i < pixelCount; i++) {
    const r = frame.data[i * 4] ?? 0
    const g = frame.data[i * 4 + 1] ?? 0
    const b = frame.data[i * 4 + 2] ?? 0
    const a = frame.data[i * 4 + 3] ?? 0
    if (a < 128) {
      out.push(STICKER_TRANSPARENT_RGB565)
      continue
    }
    let rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    if (rgb565 === STICKER_TRANSPARENT_RGB565) rgb565 ^= 0x0001
    out.push(rgb565)
  }
  return out
}

function stickerDefLiteral(s: StickerInstance, asset: StickerAsset | undefined, rasterIndexByAssetId: Map<string, number>): string {
  const isRaster = asset?.kind === 'raster'
  const kind = isRaster ? 'STICKER_KIND_RASTER' : 'STICKER_KIND_PROCEDURAL'
  const assetIndex = isRaster
    ? String(rasterIndexByAssetId.get(asset!.id) ?? 0)
    : stickerBuiltinEnumName(asset?.builtinId ?? 'rain')
  const anim = s.anim
  const fields = [
    kind,
    assetIndex,
    s.layer === 'front' ? 'STICKER_LAYER_FRONT' : 'STICKER_LAYER_BEHIND',
    Math.round(s.x),
    Math.round(s.y),
    Math.max(0, Math.round(s.width)),
    Math.max(0, Math.round(s.height)),
    Math.max(0, Math.round(s.scale)),
    Math.round(s.rotation),
    Math.max(0, Math.min(100, Math.round(s.opacity))),
    toRgb565Hex(s.tint ?? '#ffffff'),
    s.flipH ? 'true' : 'false',
    s.flipV ? 'true' : 'false',
    Math.max(0, Math.round(anim.speed)),
    anim.fps === null ? -1 : Math.round(anim.fps),
    Math.max(0, Math.round(anim.startDelayMs)),
    anim.loopMode === 'once' ? 'STICKER_LOOP_ONCE' : anim.loopMode === 'pingpong' ? 'STICKER_LOOP_PINGPONG' : 'STICKER_LOOP_LOOP',
    anim.reverse ? 'true' : 'false',
    Math.max(0, Math.round(anim.fadeInMs)),
    Math.max(0, Math.round(anim.fadeOutMs)),
    Math.max(0, Math.round(anim.startTimeMs)),
    anim.endTimeMs === null ? -1 : Math.round(anim.endTimeMs),
    Math.round(anim.driftX),
    Math.round(anim.driftY),
    Math.round(anim.spin),
    Math.max(0, Math.min(100, Math.round(anim.pulseScale))),
    Math.max(0, Math.min(100, Math.round(anim.pulseOpacity)))
  ]
  return `  { ${fields.join(', ')} }`
}

// Emits one scope's `const StickerDef <ident>[] PROGMEM = {...}; const uint8_t <ident>_Count = N;`
// pair (or an empty-array fallback when there are none) — shared by Project/Expression/
// Animation scope export so all three use the exact same literal format and the exact same
// (already-built, cross-scope) rasterIndexByAssetId, so a raster asset used in more than one
// scope still shares a single exported pixel table (see exportStickers() below). Each entry
// gets a `// "name" (layer)` comment right above it — StickerDef itself carries no name field
// (nothing at runtime needs one), but without this a human reading the generated header has no
// way to tell which raw struct came from which named sticker in the studio, which makes "did
// my sticker actually export" impossible to check by eye.
function stickerArrayLiteral(
  stickers: StickerInstance[],
  ident: string,
  assetsById: Map<string, StickerAsset>,
  rasterIndexByAssetId: Map<string, number>
): string[] {
  if (stickers.length === 0) {
    return [`const StickerDef ${ident}[] = {};`, `const uint8_t ${ident}_Count = 0;`]
  }
  return [
    `const StickerDef ${ident}[] PROGMEM = {`,
    stickers
      .map((s) => `  // "${s.name}" (${s.layer})\n${stickerDefLiteral(s, assetsById.get(s.assetId), rasterIndexByAssetId)}`)
      .join(',\n'),
    `};`,
    `const uint8_t ${ident}_Count = ${stickers.length};`
  ]
}

// Every scope's sticker instances (project + every expression + every animation), each already
// filtered to `visible` — collected once so the raster-asset table (below) is built from every
// scope a raster sticker could appear in, not just Project.stickers, and so the "no firmware
// drawer yet" check (also below) covers every scope too.
function allStickerScopes(project: Project): { label: string; stickers: StickerInstance[] }[] {
  return [
    { label: 'project', stickers: project.stickers.filter((s) => s.visible) },
    ...project.expressions.map((e) => ({ label: `expression "${e.name}"`, stickers: e.stickers.filter((s) => s.visible) })),
    ...project.animations.map((a) => ({ label: `animation "${a.name}"`, stickers: a.stickers.filter((s) => s.visible) }))
  ]
}

// Exports the sticker enums/structs, the (cross-scope, deduped) raster asset pixel tables, and
// Project.stickers itself (PROJECT_STICKERS) — Expression/Animation scopes export their own
// StickerDef arrays from exportExpression()/exportAnimation() via stickerArrayLiteral() above,
// reusing the assetsById/rasterIndexByAssetId this returns so every scope shares one raster
// pixel table instead of duplicating it per scope.
function exportStickers(project: Project): { code: string; assetsById: Map<string, StickerAsset>; rasterIndexByAssetId: Map<string, number> } {
  const scopes = allStickerScopes(project)
  const projectStickers = scopes[0].stickers
  const assetsById = new Map(project.stickerAssets.map((a) => [a.id, a]))

  const usedRasterAssets: StickerAsset[] = []
  const rasterIndexByAssetId = new Map<string, number>()
  for (const { stickers } of scopes) {
    for (const s of stickers) {
      const asset = assetsById.get(s.assetId)
      if (asset && asset.kind === 'raster' && asset.frameRgba && !rasterIndexByAssetId.has(asset.id)) {
        rasterIndexByAssetId.set(asset.id, usedRasterAssets.length)
        usedRasterAssets.push(asset)
      }
    }
  }

  const lines: string[] = [
    `#define STICKER_TRANSPARENT_COLOR 0x${STICKER_TRANSPARENT_RGB565.toString(16).toUpperCase()}`,
    '',
    'enum StickerKind : uint8_t { STICKER_KIND_PROCEDURAL = 0, STICKER_KIND_RASTER };',
    'enum StickerLayerId : uint8_t { STICKER_LAYER_BEHIND = 0, STICKER_LAYER_FRONT };',
    'enum StickerLoopModeId : uint8_t { STICKER_LOOP_ONCE = 0, STICKER_LOOP_LOOP, STICKER_LOOP_PINGPONG };',
    'enum StickerBuiltinId : uint8_t {',
    STICKER_BUILTIN_ENUM_ORDER.map((id, i) => `  ${stickerBuiltinEnumName(id)}${i === 0 ? ' = 0' : ''}`).join(',\n'),
    '};',
    '',
    '// One placed sticker (Project.stickers export as PROJECT_STICKERS below; each Expression',
    '// and Animation exports its own array the same way — see exportExpression()/',
    '// exportAnimation() and their _Stickers/_Stickers_Count constants).',
    'struct StickerDef {',
    '  uint8_t kind;        // StickerKind',
    '  uint8_t assetIndex;  // StickerBuiltinId when kind==PROCEDURAL; index into STICKER_RASTER_ASSETS when kind==RASTER',
    '  uint8_t layer;       // StickerLayerId',
    '  int16_t x, y;',
    '  uint16_t width, height;',
    '  uint16_t scale;      // %',
    '  int16_t rotation;    // degrees, base (before spin)',
    '  uint8_t opacity;     // 0-100, base (before fade/pulse) — see the visibility-threshold comment above',
    '  uint16_t tintColor;  // RGB565 — procedural only, see comment above',
    '  bool flipH, flipV;',
    '  uint16_t animSpeed;  // % raster frame-advance speed',
    '  int16_t animFps;     // -1 = use the raster asset\'s own per-frame delays',
    '  uint16_t startDelayMs;',
    '  uint8_t loopMode;    // StickerLoopModeId',
    '  bool reverse;',
    '  uint16_t fadeInMs, fadeOutMs;',
    '  uint32_t startTimeMs;',
    '  int32_t endTimeMs;   // -1 = never ends',
    '  int16_t driftX, driftY; // px/s',
    '  int16_t spin;           // deg/s',
    '  uint8_t pulseScale, pulseOpacity; // 0-100',
    '};',
    '',
    '// One imported raster (PNG/GIF) sticker asset\'s pixel data — frames are RGB565 with',
    '// STICKER_TRANSPARENT_COLOR marking skipped pixels, at the asset\'s own captured',
    '// resolution (<=64x64); eyesDrawStickerRaster() below scales to each instance\'s actual',
    '// width/height at draw time.',
    'struct StickerRasterAsset {',
    '  const uint16_t* const* frames;',
    '  const uint16_t* frameDelaysMs;',
    '  uint8_t frameCount;',
    '  uint8_t width, height;',
    '};',
    ''
  ]

  if (usedRasterAssets.length > 0) {
    usedRasterAssets.forEach((asset, i) => {
      const ident = `StickerRaster_${i}`
      const frames = asset.frameRgba ?? []
      lines.push(`// "${asset.name}"`)
      frames.forEach((frame, fi) => {
        const pixels = rgbaFrameToRgb565Table(frame)
        lines.push(`const uint16_t ${ident}_frame${fi}[] PROGMEM = { ${pixels.join(', ')} };`)
      })
      lines.push(`const uint16_t* const ${ident}_frames[] = { ${frames.map((_, fi) => `${ident}_frame${fi}`).join(', ')} };`)
      const delays = asset.frameDelaysMs && asset.frameDelaysMs.length === frames.length ? asset.frameDelaysMs : frames.map(() => 100)
      lines.push(`const uint16_t ${ident}_frameDelaysMs[] = { ${delays.map((d) => Math.max(1, Math.round(d))).join(', ')} };`)
      lines.push('')
    })
    const rows = usedRasterAssets.map((asset, i) => {
      const w = asset.frameRgba?.[0]?.width ?? 0
      const h = asset.frameRgba?.[0]?.height ?? 0
      const count = asset.frameRgba?.length ?? 0
      return `  { StickerRaster_${i}_frames, StickerRaster_${i}_frameDelaysMs, ${count}, ${w}, ${h} }`
    })
    lines.push(`const StickerRasterAsset STICKER_RASTER_ASSETS[] = {\n${rows.join(',\n')}\n};`)
  } else {
    lines.push('// (no imported raster stickers used anywhere in this project)')
    lines.push('const StickerRasterAsset STICKER_RASTER_ASSETS[] = { { nullptr, nullptr, 0, 0, 0 } };')
  }
  lines.push(`const uint8_t STICKER_RASTER_ASSET_COUNT = ${usedRasterAssets.length};`)
  lines.push('')

  lines.push('// kind, assetIndex, layer, x, y, width, height, scale, rotation, opacity, tintColor,')
  lines.push('// flipH, flipV, animSpeed, animFps, startDelayMs, loopMode, reverse, fadeInMs, fadeOutMs,')
  lines.push('// startTimeMs, endTimeMs, driftX, driftY, spin, pulseScale, pulseOpacity')
  lines.push('// Project-wide stickers — always visible. Each Expression/Animation below exports its own')
  lines.push('// _Stickers array the same way; eyesDrawEyePair() merges whichever is currently active with')
  lines.push('// this one at draw time (see the Stickers comment above and eyesDrawEyePair() in PLAYER_CODE).')
  lines.push(...stickerArrayLiteral(projectStickers, 'PROJECT_STICKERS', assetsById, rasterIndexByAssetId))

  const unported = new Set<string>()
  for (const { label, stickers } of scopes) {
    for (const s of stickers) {
      const asset = assetsById.get(s.assetId)
      if (asset?.kind === 'procedural' && asset.builtinId && !STICKER_BUILTINS_WITH_FIRMWARE_DRAWER.has(asset.builtinId)) {
        unported.add(`"${s.name}" (${label})`)
      }
    }
  }
  if (unported.size > 0) {
    lines.push('')
    lines.push('// NOTE: the following stickers use a built-in that has no firmware drawer yet (see the')
    lines.push('// Stickers comment above) and will draw nothing on real hardware, though they render')
    lines.push('// correctly in the studio preview:')
    for (const s of unported) lines.push(`//   ${s}`)
  }

  return { code: lines.join('\n'), assetsById, rasterIndexByAssetId }
}

// eyesPlayAnimation() itself is time-based (reads millis(), not a per-call frame counter),
// so it already plays back at the correct speed no matter how often loop() runs — Display
// FPS only controls how often a frame gets drawn/presented. EYE_FRAME_DELAY_MS is the
// delay() the usage example below uses to hit that rate.
function exportTiming(display: Project['display']): string {
  const fps = clampFps(display.fps)
  const frameDelayMs = Math.max(1, Math.round(1000 / fps))
  return [
    `#define EYE_TARGET_FPS       ${fps}  // Display FPS, set in the studio's Display panel`,
    `#define EYE_FRAME_DELAY_MS   ${frameDelayMs}  // delay() per loop() to render at EYE_TARGET_FPS`
  ].join('\n')
}

// Bundled "player": easing + interpolation + drawing + playback, so the export is
// plug-and-play — no separate companion file needed. Own nested include guard so two
// exported headers (different projects) can both be #included in the same sketch without
// a duplicate-definition error; only the outer EYES_EYE_ANIMATIONS_* guard differs per file.
const PLAYER_CODE = `#ifndef EYES_EYE_PLAYER_H
#define EYES_EYE_PLAYER_H

#include <math.h>

// ---- Easing — same curves as the studio's Easing picker ----
inline float eyesEase(float t, uint8_t type, int8_t bx1, int8_t by1, int8_t bx2, int8_t by2) {
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  switch (type) {
    case EYE_EASE_LINEAR:
      return t;
    case EYE_EASE_IN:
      return t * t * t;
    case EYE_EASE_OUT: {
      float u = 1 - t;
      return 1 - u * u * u;
    }
    case EYE_EASE_INOUT:
      return t < 0.5f ? 4 * t * t * t : 1 - powf(-2 * t + 2, 3) / 2;
    case EYE_EASE_BOUNCE: {
      const float n1 = 7.5625f, d1 = 2.75f;
      float x = t;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) { x -= 1.5f / d1; return n1 * x * x + 0.75f; }
      if (x < 2.5f / d1) { x -= 2.25f / d1; return n1 * x * x + 0.9375f; }
      x -= 2.625f / d1;
      return n1 * x * x + 0.984375f;
    }
    case EYE_EASE_ELASTIC: {
      if (t <= 0 || t >= 1) return t;
      const float c4 = (2 * PI) / 3;
      return powf(2, -10 * t) * sinf((t * 10 - 0.75f) * c4) + 1;
    }
    case EYE_EASE_BEZIER: {
      float x1 = bx1 / 100.0f, y1 = by1 / 100.0f, x2 = bx2 / 100.0f, y2 = by2 / 100.0f;
      float cx = 3 * x1, bxc = 3 * (x2 - x1) - cx, ax = 1 - cx - bxc;
      float cy = 3 * y1, byc = 3 * (y2 - y1) - cy, ay = 1 - cy - byc;
      float u = t;
      for (int i = 0; i < 6; i++) {
        float x = ((ax * u + bxc) * u + cx) * u - t;
        float d = (3 * ax * u + 2 * bxc) * u + cx;
        if (fabsf(d) < 1e-4f) break;
        u -= x / d;
      }
      return ((ay * u + byc) * u + cy) * u;
    }
  }
  return t;
}

// ---- Live (interpolated) eye pose ----
struct LiveEye {
  float width, height, radius, distance;
  float irisWidth, irisHeight, pupilWidth, pupilHeight;
  float pupilX, pupilY, pupilRotation;
  float upperEyelid, lowerEyelid;
  float upperEyelidTilt, lowerEyelidTilt;
  float upperEyelidCurvature, lowerEyelidCurvature;
  float highlightX, highlightY, highlightSize;
  // Not numeric, so not lerped like the fields above — eyesLerpFrame()/eyesLerpLive() step
  // these at t=0.5 instead (see the studio's lerpParams() in interpolate.ts, same rule).
  uint8_t pupilShape;
  uint8_t pupilCustomShapeIndex;
};

// Shortest-path interpolation between two angles in degrees, wrapping through 0/360 rather
// than always going the "long way" (e.g. 350deg -> 10deg at t=0.5 gives 0deg, not 180deg).
// Kept in sync with lerpAngleDeg() in src/engine/interpolate.ts so the studio's preview and
// this exported firmware animate pupil rotation identically.
inline float eyesLerpAngleDeg(float a, float b, float t) {
  float diff = fmodf(b - a + 180.0f, 360.0f);
  if (diff < 0) diff += 360.0f;
  diff -= 180.0f;
  float result = fmodf(a + diff * t, 360.0f);
  if (result < 0) result += 360.0f;
  return result;
}

inline LiveEye eyesLerpFrame(const EyeFrame& a, const EyeFrame& b, float t) {
  LiveEye r;
  r.width = a.width + (b.width - a.width) * t;
  r.height = a.height + (b.height - a.height) * t;
  r.radius = a.radius + (b.radius - a.radius) * t;
  r.distance = a.distance + (b.distance - a.distance) * t;
  r.irisWidth = a.irisWidth + (b.irisWidth - a.irisWidth) * t;
  r.irisHeight = a.irisHeight + (b.irisHeight - a.irisHeight) * t;
  r.pupilWidth = a.pupilWidth + (b.pupilWidth - a.pupilWidth) * t;
  r.pupilHeight = a.pupilHeight + (b.pupilHeight - a.pupilHeight) * t;
  r.pupilX = a.pupilX + (b.pupilX - a.pupilX) * t;
  r.pupilY = a.pupilY + (b.pupilY - a.pupilY) * t;
  r.pupilRotation = eyesLerpAngleDeg(a.pupilRotation, b.pupilRotation, t);
  r.upperEyelid = a.upperEyelid + (b.upperEyelid - a.upperEyelid) * t;
  r.lowerEyelid = a.lowerEyelid + (b.lowerEyelid - a.lowerEyelid) * t;
  r.upperEyelidTilt = a.upperEyelidTilt + (b.upperEyelidTilt - a.upperEyelidTilt) * t;
  r.lowerEyelidTilt = a.lowerEyelidTilt + (b.lowerEyelidTilt - a.lowerEyelidTilt) * t;
  r.upperEyelidCurvature = a.upperEyelidCurvature + (b.upperEyelidCurvature - a.upperEyelidCurvature) * t;
  r.lowerEyelidCurvature = a.lowerEyelidCurvature + (b.lowerEyelidCurvature - a.lowerEyelidCurvature) * t;
  r.highlightX = a.highlightX + (b.highlightX - a.highlightX) * t;
  r.highlightY = a.highlightY + (b.highlightY - a.highlightY) * t;
  r.highlightSize = a.highlightSize + (b.highlightSize - a.highlightSize) * t;
  r.pupilShape = t < 0.5f ? a.pupilShape : b.pupilShape;
  r.pupilCustomShapeIndex = t < 0.5f ? a.pupilCustomShapeIndex : b.pupilCustomShapeIndex;
  return r;
}

// Same as eyesLerpFrame above, but both endpoints are already-interpolated LiveEye poses
// rather than raw keyframes — used by SetExpression()'s crossfade below, which needs to
// blend FROM whatever's currently on screen (which might itself be mid-animation, not a
// single keyframe).
inline LiveEye eyesLerpLive(const LiveEye& a, const LiveEye& b, float t) {
  LiveEye r;
  r.width = a.width + (b.width - a.width) * t;
  r.height = a.height + (b.height - a.height) * t;
  r.radius = a.radius + (b.radius - a.radius) * t;
  r.distance = a.distance + (b.distance - a.distance) * t;
  r.irisWidth = a.irisWidth + (b.irisWidth - a.irisWidth) * t;
  r.irisHeight = a.irisHeight + (b.irisHeight - a.irisHeight) * t;
  r.pupilWidth = a.pupilWidth + (b.pupilWidth - a.pupilWidth) * t;
  r.pupilHeight = a.pupilHeight + (b.pupilHeight - a.pupilHeight) * t;
  r.pupilX = a.pupilX + (b.pupilX - a.pupilX) * t;
  r.pupilY = a.pupilY + (b.pupilY - a.pupilY) * t;
  r.pupilRotation = eyesLerpAngleDeg(a.pupilRotation, b.pupilRotation, t);
  r.upperEyelid = a.upperEyelid + (b.upperEyelid - a.upperEyelid) * t;
  r.lowerEyelid = a.lowerEyelid + (b.lowerEyelid - a.lowerEyelid) * t;
  r.upperEyelidTilt = a.upperEyelidTilt + (b.upperEyelidTilt - a.upperEyelidTilt) * t;
  r.lowerEyelidTilt = a.lowerEyelidTilt + (b.lowerEyelidTilt - a.lowerEyelidTilt) * t;
  r.upperEyelidCurvature = a.upperEyelidCurvature + (b.upperEyelidCurvature - a.upperEyelidCurvature) * t;
  r.lowerEyelidCurvature = a.lowerEyelidCurvature + (b.lowerEyelidCurvature - a.lowerEyelidCurvature) * t;
  r.highlightX = a.highlightX + (b.highlightX - a.highlightX) * t;
  r.highlightY = a.highlightY + (b.highlightY - a.highlightY) * t;
  r.highlightSize = a.highlightSize + (b.highlightSize - a.highlightSize) * t;
  r.pupilShape = t < 0.5f ? a.pupilShape : b.pupilShape;
  r.pupilCustomShapeIndex = t < 0.5f ? a.pupilCustomShapeIndex : b.pupilCustomShapeIndex;
  return r;
}

// Adafruit_GFX has no fillEllipse — fill one via horizontal scanlines using the ellipse
// equation, same technique fillCircle() itself uses internally for a circle. Kept as a
// simple, unclipped primitive; eyesFillEllipseInEye() below is what iris/pupil actually use.
template <typename T>
inline void eyesFillEllipse(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, uint16_t color) {
  if (rx <= 0 || ry <= 0) return;
  for (int16_t dy = -ry; dy <= ry; dy++) {
    float t = (float)dy / (float)ry;
    float span = sqrtf(max(0.0f, 1.0f - t * t));
    int16_t dx = (int16_t)(rx * span);
    gfx.drawFastHLine(cx - dx, cy + dy, dx * 2 + 1, color);
  }
}

// The eye's own half-width at vertical offset \`dy\` from its center — the boundary
// eyesFillRoundedRect() traces (a rounded-rect with elliptical corners), factored out so
// eyesFillEllipseInEye() below can clip iris/pupil fills to the same silhouette. Returns -1
// for rows entirely above/below the eye (no intersection).
inline float eyesEyeHalfWidthAt(float dy, float hx, float hy, float rx, float ry) {
  float ySide = fabsf(dy);
  if (ySide > hy) return -1.0f;
  if (ry < 0.01f || ySide <= hy - ry) return hx;
  float t = (ySide - (hy - ry)) / ry;
  if (t > 1.0f) t = 1.0f;
  return (hx - rx) + rx * sqrtf(max(0.0f, 1.0f - t * t));
}

// The eye's own half-height at horizontal offset \`dx\` from its center — the column-
// parameterized twin of eyesEyeHalfWidthAt() above (identical rounded-rect-with-elliptical-
// corners boundary, x/y roles swapped): \`hy\` for columns within the flat vertical span
// (|dx| <= hx-rx), narrowing toward \`hy-ry\` as dx approaches the corner band's outer edge
// (|dx| -> hx). eyesFillEyelid() below uses this to confine its fill to the eye's TRUE
// silhouette per column instead of a fixed margin, so the eyelid's edge follows the eye's own
// rounded corners exactly (matching the studio preview's ctx.clip()) rather than cutting a
// flat/straight edge through them. Returns -1 for columns entirely left/right of the eye.
inline float eyesEyeHalfHeightAt(float dx, float hx, float hy, float rx, float ry) {
  float xSide = fabsf(dx);
  if (xSide > hx) return -1.0f;
  if (rx < 0.01f || xSide <= hx - rx) return hy;
  float t = (xSide - (hx - rx)) / rx;
  if (t > 1.0f) t = 1.0f;
  return (hy - ry) + ry * sqrtf(max(0.0f, 1.0f - t * t));
}

// Fills a rounded-rect whose corners are quarter-*ellipses* (independent x/y radii), via
// horizontal scanlines — Adafruit_GFX's own fillRoundRect() only supports a single circular
// corner radius clamped by the *smaller* of w/h, which leaves flat straight edges on the
// longer axis even at max radius on a non-square eye. Here rx = min(radius, w/2) and
// ry = min(radius, h/2) clamp independently, so at radius >= max(w/2, h/2) both saturate
// (rx=w/2, ry=h/2), every flat segment shrinks to zero, and the shape is a true ellipse —
// matching roundedRectPath() in the studio's Canvas 2D preview exactly.
template <typename T>
inline void eyesFillRoundedRect(T& gfx, int16_t cx, int16_t cy, int16_t w, int16_t h, int16_t radius, uint16_t color) {
  if (w <= 0 || h <= 0) return;
  float hx = w / 2.0f;
  float hy = h / 2.0f;
  float rx = radius < hx ? (float)radius : hx;
  float ry = radius < hy ? (float)radius : hy;
  int16_t halfH = (int16_t)ceilf(hy);
  for (int16_t dy = -halfH; dy <= halfH; dy++) {
    float xExtent = eyesEyeHalfWidthAt((float)dy, hx, hy, rx, ry);
    if (xExtent < 0) continue;
    int16_t ix = (int16_t)xExtent;
    gfx.drawFastHLine(cx - ix, cy + dy, ix * 2 + 1, color);
  }
}

// Fills an ellipse (optionally rotated by \`rotationDeg\`) clipped to the enclosing eye's own
// rounded-rect silhouette (eyeCx/eyeCy/eyeW/eyeH/eyeRadius) — this is what lets Pupil X/Y
// push all the way out to +-100 (or the pupil spin via Pupil Rotation) without ever painting
// outside the eye on real hardware. The studio's preview gets this for free from the
// ctx.clip() already in effect when it draws the eye; Adafruit_GFX has no equivalent shaped
// clip, so this recomputes the same eye boundary (eyesEyeHalfWidthAt) per scanline row and
// intersects it with the ellipse's own row span, solved via the general conic quadratic —
// at rotationDeg=0 this reduces to the same formula eyesFillEllipse() uses.
template <typename T>
inline void eyesFillEllipseInEye(T& gfx, int16_t eyeCx, int16_t eyeCy, int16_t eyeW, int16_t eyeH, int16_t eyeRadius,
                                  int16_t ecx, int16_t ecy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color) {
  if (rx <= 0 || ry <= 0) return;
  float eyeHx = eyeW / 2.0f, eyeHy = eyeH / 2.0f;
  float eyeRx = eyeRadius < eyeHx ? (float)eyeRadius : eyeHx;
  float eyeRy = eyeRadius < eyeHy ? (float)eyeRadius : eyeHy;

  float rad = rotationDeg * (float)PI / 180.0f;
  float c = cosf(rad), s = sinf(rad);
  float invRx2 = 1.0f / ((float)rx * (float)rx);
  float invRy2 = 1.0f / ((float)ry * (float)ry);
  float A = c * c * invRx2 + s * s * invRy2;

  int16_t maxExtent = (int16_t)ceilf((float)max(rx, ry)) + 1;
  for (int16_t dy = -maxExtent; dy <= maxExtent; dy++) {
    float dy0 = (float)dy;
    float B = 2.0f * dy0 * c * s * (invRx2 - invRy2);
    float C = dy0 * dy0 * (s * s * invRx2 + c * c * invRy2) - 1.0f;
    float disc = B * B - 4.0f * A * C;
    if (disc < 0) continue;
    float sq = sqrtf(disc);
    float dxA = (-B - sq) / (2.0f * A);
    float dxB = (-B + sq) / (2.0f * A);
    float xLo = ecx + (dxA < dxB ? dxA : dxB);
    float xHi = ecx + (dxA < dxB ? dxB : dxA);

    int16_t worldY = ecy + dy;
    float eyeHalfW = eyesEyeHalfWidthAt((float)(worldY - eyeCy), eyeHx, eyeHy, eyeRx, eyeRy);
    if (eyeHalfW < 0) continue; // this row falls entirely outside the eye's own silhouette

    float clipLo = max(xLo, (float)eyeCx - eyeHalfW);
    float clipHi = min(xHi, (float)eyeCx + eyeHalfW);
    if (clipHi < clipLo) continue;

    int16_t ixLo = (int16_t)(clipLo + 0.5f);
    int16_t ixHi = (int16_t)(clipHi + 0.5f);
    if (ixHi < ixLo) continue;
    gfx.drawFastHLine(ixLo, worldY, ixHi - ixLo + 1, color);
  }
}

// Fills a normalized [-1,1]-space polygon (int8_t points scaled x100 — see
// pupilShapeTableLiteral() in the studio's cppExport.ts) transformed by rotationDeg/rx/ry/
// ecx/ecy and clipped to the enclosing eye's own silhouette — the non-ellipse-shape
// counterpart to eyesFillEllipseInEye() above, used for every pupil shape except the
// circle/oval ellipse. Every shape here (built-in or a custom SVG import) is a simple,
// non-self-intersecting closed polygon, so a standard even-odd scanline fill is exact: each
// row's edge crossings are found, sorted, and filled pairwise, with each resulting span
// additionally clipped to the eye's own boundary exactly like eyesFillEllipseInEye() does.
// Vertices are transformed (rotate in normalized space, then scale by rx/ry, then translate
// to ecx/ecy) once up front into fixed-size stack buffers — matches tracePolygonPath() in the
// studio's drawEye.ts exactly, so preview and firmware always agree on where a rotated
// non-uniform (rx != ry) polygon's corners land.
template <typename T>
inline void eyesFillPolygonInEye(T& gfx, int16_t eyeCx, int16_t eyeCy, int16_t eyeW, int16_t eyeH, int16_t eyeRadius,
                                  int16_t ecx, int16_t ecy, int16_t rx, int16_t ry, float rotationDeg,
                                  const int8_t points[][2], uint8_t count, uint16_t color) {
  if (count < 3 || rx <= 0 || ry <= 0) return;
  if (count > EYE_MAX_PUPIL_POLYGON_POINTS) count = EYE_MAX_PUPIL_POLYGON_POINTS;

  float eyeHx = eyeW / 2.0f, eyeHy = eyeH / 2.0f;
  float eyeRx = eyeRadius < eyeHx ? (float)eyeRadius : eyeHx;
  float eyeRy = eyeRadius < eyeHy ? (float)eyeRadius : eyeHy;

  float rad = rotationDeg * (float)PI / 180.0f;
  float c = cosf(rad), s = sinf(rad);

  float wx[EYE_MAX_PUPIL_POLYGON_POINTS];
  float wy[EYE_MAX_PUPIL_POLYGON_POINTS];
  float minY = 1e9f, maxY = -1e9f;
  for (uint8_t i = 0; i < count; i++) {
    float nx = points[i][0] / 100.0f;
    float ny = points[i][1] / 100.0f;
    float rxp = nx * c - ny * s;
    float ryp = nx * s + ny * c;
    wx[i] = ecx + rxp * rx;
    wy[i] = ecy + ryp * ry;
    if (wy[i] < minY) minY = wy[i];
    if (wy[i] > maxY) maxY = wy[i];
  }

  int16_t yStart = (int16_t)floorf(minY);
  int16_t yEnd = (int16_t)ceilf(maxY);
  float xs[EYE_MAX_PUPIL_POLYGON_POINTS];
  for (int16_t y = yStart; y <= yEnd; y++) {
    float scanY = y + 0.5f;
    uint8_t xCount = 0;
    for (uint8_t i = 0; i < count; i++) {
      uint8_t j = (i + 1) % count;
      float y1 = wy[i], y2 = wy[j];
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        float t = (scanY - y1) / (y2 - y1);
        xs[xCount++] = wx[i] + t * (wx[j] - wx[i]);
      }
    }
    // Insertion sort — xCount is always small (at most one crossing per edge).
    for (uint8_t i = 1; i < xCount; i++) {
      float key = xs[i];
      int16_t k = (int16_t)i - 1;
      while (k >= 0 && xs[k] > key) { xs[k + 1] = xs[k]; k--; }
      xs[k + 1] = key;
    }

    float eyeHalfW = eyesEyeHalfWidthAt((float)(y - eyeCy), eyeHx, eyeHy, eyeRx, eyeRy);
    if (eyeHalfW < 0) continue;

    for (uint8_t i = 0; (uint16_t)i + 1 < xCount; i += 2) {
      float xLo = max(xs[i], (float)eyeCx - eyeHalfW);
      float xHi = min(xs[i + 1], (float)eyeCx + eyeHalfW);
      if (xHi < xLo) continue;
      int16_t ixLo = (int16_t)(xLo + 0.5f);
      int16_t ixHi = (int16_t)(xHi + 0.5f);
      if (ixHi < ixLo) continue;
      gfx.drawFastHLine(ixLo, y, ixHi - ixLo + 1, color);
    }
  }
}

// Dispatches to the right pupil fill for a given EyePupilShape — ellipse (circle/oval) keeps
// the analytic eyesFillEllipseInEye() path unchanged; every other shape looks up its point
// table (built-in, or the project's own PUPIL_CUSTOM_SHAPES library for EYE_PUPIL_SHAPE_CUSTOM)
// and fills it via eyesFillPolygonInEye() above. A custom shape whose index no longer exists
// (e.g. deleted in the studio after this pose was saved) falls back to the ellipse rather than
// skip drawing the pupil entirely — same fallback the studio preview's drawEye.ts uses.
template <typename T>
inline void eyesFillPupilShape(T& gfx, int16_t eyeCx, int16_t eyeCy, int16_t eyeW, int16_t eyeH, int16_t eyeRadius,
                                int16_t ecx, int16_t ecy, int16_t rx, int16_t ry, float rotationDeg,
                                uint8_t shape, uint8_t customIndex, uint16_t color) {
  if (shape == EYE_PUPIL_SHAPE_ELLIPSE) {
    eyesFillEllipseInEye(gfx, eyeCx, eyeCy, eyeW, eyeH, eyeRadius, ecx, ecy, rx, ry, rotationDeg, color);
    return;
  }
  const int8_t (*points)[2] = nullptr;
  uint8_t count = 0;
  switch (shape) {
    case EYE_PUPIL_SHAPE_HEART: points = PUPIL_SHAPE_HEART; count = PUPIL_SHAPE_HEART_COUNT; break;
    case EYE_PUPIL_SHAPE_STAR: points = PUPIL_SHAPE_STAR; count = PUPIL_SHAPE_STAR_COUNT; break;
    case EYE_PUPIL_SHAPE_DIAMOND: points = PUPIL_SHAPE_DIAMOND; count = PUPIL_SHAPE_DIAMOND_COUNT; break;
    case EYE_PUPIL_SHAPE_SQUARE: points = PUPIL_SHAPE_SQUARE; count = PUPIL_SHAPE_SQUARE_COUNT; break;
    case EYE_PUPIL_SHAPE_TRIANGLE: points = PUPIL_SHAPE_TRIANGLE; count = PUPIL_SHAPE_TRIANGLE_COUNT; break;
    case EYE_PUPIL_SHAPE_CUSTOM:
      if (customIndex < PUPIL_CUSTOM_SHAPE_COUNT) {
        points = PUPIL_CUSTOM_SHAPES[customIndex];
        count = PUPIL_CUSTOM_SHAPE_POINT_COUNTS[customIndex];
      }
      break;
  }
  // count < 3 falls back too (not just points == nullptr) -- a degenerate/empty point table
  // (shouldn't happen via the studio's own import path, but a hand-edited or corrupted
  // project file could produce one) would otherwise reach eyesFillPolygonInEye() and silently
  // draw nothing at all, leaving the pupil invisible instead of falling back to the ellipse
  // like the studio preview's drawEye.ts does for the same case.
  if (points && count >= 3) {
    eyesFillPolygonInEye(gfx, eyeCx, eyeCy, eyeW, eyeH, eyeRadius, ecx, ecy, rx, ry, rotationDeg, points, count, color);
  } else {
    eyesFillEllipseInEye(gfx, eyeCx, eyeCy, eyeW, eyeH, eyeRadius, ecx, ecy, rx, ry, rotationDeg, color);
  }
}

// Fills one eyelid: a background-colored region from the eye's own TRUE rounded-rect boundary
// down to a cutoff line that combines a linear tilt (shear) and a symmetric curvature offset —
//   taper(x)  = (1 - (x/halfW)^2)^2      for |x| <= halfW, else 0
//   yCutoff(x) = yBase + slope*x + curveOffset * taper(x)
// curvaturePct ranges -100 (curved inward) to 100 (curved outward) through 0 (flat/neutral):
// at x=0 (lid center) taper is 1, so a positive curveOffset bulges the center further into
// the eye (more coverage there than at the flat sides) while a negative one pulls it back
// toward less coverage instead. The taper is a border-radius-style bump, not a plain
// parabola: at x=±halfW (the eye's own flat-side edge) it reaches 0 WITH zero slope, so the
// curve blends smoothly into the flat sides — and from there into the eye's rounded corners
// — with no kink, at any eye width/height/radius or curvature value. This taper/cutoff math
// is mathematically identical to what the studio's preview draws (see the comment above the
// eyelid block in drawEye.ts) — deliberately NOT radius-aware itself, same as the studio.
//
// What differs from a naive port: the studio gets its eyelid's OUTER edge trimmed to the
// eye's true rounded-corner silhouette for free from the ctx.clip() already in effect when it
// draws the eye — the "flat past yCutoff" that a naive column sweep would draw all the way up
// to a fixed top/bottom margin gets cut off by that clip near the corners, so what's actually
// visible there follows the corner's own curve. Adafruit_GFX has no equivalent clip, so this
// recomputes the exact same eye boundary (eyesEyeHalfHeightAt, the column-parameterized twin
// of eyesEyeHalfWidthAt() the sclera/iris/pupil fills already clip against) per column and
// uses THAT as the far bound instead of a fixed margin — without this, the eyelid would paint
// a flat/straight edge through the rounded corner, extending past the true eye boundary and
// overpainting the border's own corner curve, exactly the defect this fixes. Filled
// column-by-column (drawFastVLine) since the cutoff is naturally a function of x, not y.
template <typename T>
inline void eyesFillEyelid(T& gfx, int16_t cx, int16_t cy, int16_t w, int16_t h, int16_t radius, bool isUpper,
                            float coveragePct, float tiltDeg, float curvaturePct, uint16_t color) {
  if (coveragePct <= 0) return;
  float hx = w / 2.0f;
  float hy = h / 2.0f;
  float rx = radius < hx ? (float)radius : hx;
  float ry = radius < hy ? (float)radius : hy;
  float coverage = (coveragePct / 100.0f) * h;
  float yBase = isUpper ? (-hy + coverage) : (hy - coverage);
  float curveOffset = (curvaturePct / 100.0f) * h * 0.5f;
  float slope = tanf(tiltDeg * (float)PI / 180.0f);

  int16_t halfWi = (int16_t)ceilf(hx);
  for (int16_t dx = -halfWi; dx <= halfWi; dx++) {
    float eyeHalfHeight = eyesEyeHalfHeightAt((float)dx, hx, hy, rx, ry);
    if (eyeHalfHeight < 0) continue; // this column falls entirely outside the eye's own silhouette

    float u = hx > 0.01f ? (float)dx / hx : 0.0f;
    if (u > 1.0f) u = 1.0f;
    if (u < -1.0f) u = -1.0f;
    float t = 1.0f - u * u;
    float taper = t * t;
    float yCutoff = yBase + slope * (float)dx + curveOffset * taper;
    // Clamp the curve itself to the eye's true silhouette too — without this, a large
    // negative curvature/tilt could compute a yCutoff *beyond* the corner's own boundary,
    // which would flip yTop/yBottom's usual ordering meaning near the corner instead of just
    // clipping cleanly to it.
    if (yCutoff > eyeHalfHeight) yCutoff = eyeHalfHeight;
    if (yCutoff < -eyeHalfHeight) yCutoff = -eyeHalfHeight;
    int16_t worldX = cx + dx;
    int16_t yTop, yBottom;
    if (isUpper) {
      yTop = cy - (int16_t)ceilf(eyeHalfHeight);
      yBottom = cy + (int16_t)roundf(yCutoff);
    } else {
      yTop = cy + (int16_t)roundf(yCutoff);
      yBottom = cy + (int16_t)ceilf(eyeHalfHeight);
    }
    if (yBottom < yTop) continue;
    gfx.drawFastVLine(worldX, yTop, yBottom - yTop + 1, color);
  }
}

// ---- Stickers — see the "Stickers" comment in the studio's cppExport.ts for the exported ----
// scope/simplifications this player implements (project-wide only; opacity is a visibility
// threshold, not a smooth blend). Declared before eyesDrawEyePair() below since it calls
// eyesDrawStickers() directly as an ordinary
// (non-dependent-lookup) name.

// Deterministic pseudo-random in [0,1) — must match hash01() in the studio's
// builtinStickers.ts exactly (same formula) so a particle sticker's layout in firmware matches
// its studio preview.
inline float eyesStickerHash01(float seed) {
  float x = sinf(seed * 12.9898f) * 43758.5453f;
  return x - floorf(x);
}

// Fills a polygon already given in absolute screen-space integer points — a simpler, unclipped
// sibling of eyesFillPolygonInEye() above (stickers aren't confined to an eye's silhouette).
// Standard even-odd scanline fill, exact for the simple non-self-intersecting shapes used here.
template <typename T>
inline void eyesFillPolygonScreen(T& gfx, const int16_t* xs, const int16_t* ys, uint8_t count, uint16_t color) {
  if (count < 3) return;
  int16_t minY = ys[0], maxY = ys[0];
  for (uint8_t i = 1; i < count; i++) {
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  float cross[EYE_MAX_PUPIL_POLYGON_POINTS];
  for (int16_t y = minY; y <= maxY; y++) {
    float scanY = y + 0.5f;
    uint8_t n = 0;
    for (uint8_t i = 0; i < count; i++) {
      uint8_t j = (i + 1) % count;
      float y1 = ys[i], y2 = ys[j];
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        float t = (scanY - y1) / (y2 - y1);
        if (n < EYE_MAX_PUPIL_POLYGON_POINTS) cross[n++] = xs[i] + t * (xs[j] - xs[i]);
      }
    }
    for (uint8_t i = 1; i < n; i++) {
      float key = cross[i];
      int16_t k = (int16_t)i - 1;
      while (k >= 0 && cross[k] > key) { cross[k + 1] = cross[k]; k--; }
      cross[k + 1] = key;
    }
    for (uint8_t i = 0; (uint16_t)i + 1 < n; i += 2) {
      int16_t xLo = (int16_t)(cross[i] + 0.5f);
      int16_t xHi = (int16_t)(cross[i + 1] + 0.5f);
      if (xHi < xLo) continue;
      gfx.drawFastHLine(xLo, y, xHi - xLo + 1, color);
    }
  }
}

// ---- 4 ported built-in procedural stickers — direct hand-ports of the matching drawer in ----
// the studio's builtinStickers.ts (same formulas, same eyesStickerHash01()/hash01() seeds), so
// firmware and studio preview lay out identically. cx/cy = sticker's live screen-space center,
// rx/ry = live half-extents in px (negative to flip), rotationDeg = live total rotation.
template <typename T>
inline void eyesDrawSticker_Stars(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  for (uint8_t i = 0; i < 4; i++) {
    float x = -0.7f + 1.4f * eyesStickerHash01(i * 9 + 1);
    float y = -0.7f + 1.4f * eyesStickerHash01(i * 9 + 2);
    float pr = 0.16f + 0.05f * eyesStickerHash01(i * 9 + 3);
    int16_t wx[EYE_MAX_PUPIL_POLYGON_POINTS], wy[EYE_MAX_PUPIL_POLYGON_POINTS];
    uint8_t count = PUPIL_SHAPE_STAR_COUNT;
    for (uint8_t v = 0; v < count; v++) {
      float vx = PUPIL_SHAPE_STAR[v][0] / 100.0f;
      float vy = PUPIL_SHAPE_STAR[v][1] / 100.0f;
      float lx = x + vx * pr;
      float ly = y + vy * pr;
      wx[v] = cx + (int16_t)roundf((lx * oc - ly * os) * rx);
      wy[v] = cy + (int16_t)roundf((lx * os + ly * oc) * ry);
    }
    eyesFillPolygonScreen(gfx, wx, wy, count, color);
  }
}

template <typename T>
inline void eyesDrawSticker_Hearts(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  for (uint8_t i = 0; i < 2; i++) {
    float xBase = -0.4f + 0.8f * i;
    float bob = 0.06f * sinf(t * 2.0f + i * 3.0f);
    float x = xBase, y = -0.1f + bob;
    float pr = 0.32f;
    int16_t wx[EYE_MAX_PUPIL_POLYGON_POINTS], wy[EYE_MAX_PUPIL_POLYGON_POINTS];
    uint8_t count = PUPIL_SHAPE_HEART_COUNT;
    for (uint8_t v = 0; v < count; v++) {
      float vx = PUPIL_SHAPE_HEART[v][0] / 100.0f;
      float vy = PUPIL_SHAPE_HEART[v][1] / 100.0f;
      float lx = x + vx * pr;
      float ly = y + vy * pr;
      wx[v] = cx + (int16_t)roundf((lx * oc - ly * os) * rx);
      wy[v] = cy + (int16_t)roundf((lx * os + ly * oc) * ry);
    }
    eyesFillPolygonScreen(gfx, wx, wy, count, color);
  }
}

template <typename T>
inline void eyesDrawSticker_Rain(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  for (uint8_t i = 0; i < 6; i++) {
    float phase = eyesStickerHash01(i * 7 + 1);
    float xBase = -0.8f + 1.6f * eyesStickerHash01(i * 3 + 2);
    float speed = 0.9f;
    float local = fmodf(t * speed + phase, 1.0f);
    if (local < 0) local += 1.0f;
    float y = local * 2.2f - 1.1f;
    float x1 = xBase, y1 = y;
    float x2 = xBase - 0.08f, y2 = y + 0.3f;
    int16_t wx1 = cx + (int16_t)roundf((x1 * oc - y1 * os) * rx);
    int16_t wy1 = cy + (int16_t)roundf((x1 * os + y1 * oc) * ry);
    int16_t wx2 = cx + (int16_t)roundf((x2 * oc - y2 * os) * rx);
    int16_t wy2 = cy + (int16_t)roundf((x2 * os + y2 * oc) * ry);
    gfx.drawLine(wx1, wy1, wx2, wy2, color);
  }
}

template <typename T>
inline void eyesDrawSticker_Confetti(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  for (uint8_t i = 0; i < 7; i++) {
    float phase = eyesStickerHash01(i * 53 + 1);
    float xBase = -0.85f + 1.7f * eyesStickerHash01(i * 19 + 2);
    float speed = 0.4f + 0.2f * eyesStickerHash01(i * 23 + 3);
    float local = fmodf(t * speed + phase, 1.0f);
    if (local < 0) local += 1.0f;
    float y = local * 2.2f - 1.1f;
    float x = xBase + 0.15f * sinf(t * 3.0f + i);
    float spin = t * (2.0f + eyesStickerHash01(i * 29 + 4) * 3.0f) + i;
    float pc = cosf(spin), ps = sinf(spin);
    float pr = 0.08f;
    uint16_t particleColor = (i % 2 == 0) ? color : (uint16_t)0xFFFF;
    int16_t wx[4], wy[4];
    for (uint8_t v = 0; v < 4; v++) {
      float vx = PUPIL_SHAPE_DIAMOND[v][0] / 100.0f;
      float vy = PUPIL_SHAPE_DIAMOND[v][1] / 100.0f;
      float lx = x + (vx * pc - vy * ps) * pr;
      float ly = y + (vx * ps + vy * pc) * pr;
      wx[v] = cx + (int16_t)roundf((lx * oc - ly * os) * rx);
      wy[v] = cy + (int16_t)roundf((lx * os + ly * oc) * ry);
    }
    eyesFillPolygonScreen(gfx, wx, wy, 4, particleColor);
  }
}

template <typename T>
inline void eyesDrawSticker_Snow(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  float rMag = (fabsf((float)rx) + fabsf((float)ry)) * 0.5f;
  for (uint8_t i = 0; i < 7; i++) {
    float phase = eyesStickerHash01(i * 5 + 3);
    float xBase = -0.8f + 1.6f * eyesStickerHash01(i * 11 + 4);
    float speed = 0.35f + 0.1f * eyesStickerHash01(i * 13 + 5);
    float local = fmodf(t * speed + phase, 1.0f);
    if (local < 0) local += 1.0f;
    float y = local * 2.2f - 1.1f;
    float x = xBase + 0.12f * sinf(t * 2.0f + i);
    float pr = 0.05f + 0.03f * eyesStickerHash01(i * 17 + 6);
    int16_t wx = cx + (int16_t)roundf((x * oc - y * os) * rx);
    int16_t wy = cy + (int16_t)roundf((x * os + y * oc) * ry);
    int16_t wr = (int16_t)roundf(pr * rMag);
    if (wr > 0) gfx.fillCircle(wx, wy, wr, color);
  }
}

template <typename T>
inline void eyesDrawSticker_Zzz(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  const float period = 2.4f;
  for (uint8_t i = 0; i < 3; i++) {
    float local = fmodf(t + i * (period / 3.0f), period) / period;
    if (local < 0) local += 1.0f;
    float zcx = -0.6f + local * 1.3f;
    float zcy = 0.7f - local * 1.6f;
    float r = 0.14f + 0.08f * i;
    float px[4] = { -r, r, -r, r };
    float py[4] = { -r, -r, r, r };
    int16_t wx[4], wy[4];
    for (uint8_t v = 0; v < 4; v++) {
      float lx = zcx + px[v];
      float ly = zcy + py[v];
      wx[v] = cx + (int16_t)roundf((lx * oc - ly * os) * rx);
      wy[v] = cy + (int16_t)roundf((lx * os + ly * oc) * ry);
    }
    gfx.drawLine(wx[0], wy[0], wx[1], wy[1], color);
    gfx.drawLine(wx[1], wy[1], wx[2], wy[2], color);
    gfx.drawLine(wx[2], wy[2], wx[3], wy[3], color);
  }
}

template <typename T>
inline void eyesDrawSticker_Sparkles(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  static const float SPARK_X[8] = { 0.0f, 0.18f, 1.0f, 0.18f, 0.0f, -0.18f, -1.0f, -0.18f };
  static const float SPARK_Y[8] = { -1.0f, -0.18f, 0.0f, 0.18f, 1.0f, 0.18f, 0.0f, -0.18f };
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  for (uint8_t i = 0; i < 5; i++) {
    float x = -0.75f + 1.5f * eyesStickerHash01(i * 21 + 1);
    float y = -0.75f + 1.5f * eyesStickerHash01(i * 21 + 2);
    float phase = eyesStickerHash01(i * 21 + 3) * (float)PI * 2.0f;
    float twinkle = sinf(t * 3.0f + phase);
    if (twinkle < 0) twinkle = 0;
    if (twinkle < 0.05f) continue;
    float pr = 0.12f * twinkle + 0.04f;
    float prot = t * 0.5f + i;
    float pc = cosf(prot), ps = sinf(prot);
    int16_t wx[8], wy[8];
    for (uint8_t v = 0; v < 8; v++) {
      float lx = x + (SPARK_X[v] * pc - SPARK_Y[v] * ps) * pr;
      float ly = y + (SPARK_X[v] * ps + SPARK_Y[v] * pc) * pr;
      wx[v] = cx + (int16_t)roundf((lx * oc - ly * os) * rx);
      wy[v] = cy + (int16_t)roundf((lx * os + ly * oc) * ry);
    }
    eyesFillPolygonScreen(gfx, wx, wy, 8, color);
  }
}

template <typename T>
inline void eyesDrawSticker_Clouds(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  float rMag = (fabsf((float)rx) + fabsf((float)ry)) * 0.5f;
  float dx = 0.05f * sinf(t * 0.3f);
  static const float PUFF_X[4] = { -0.35f, 0.0f, 0.4f, -0.05f };
  static const float PUFF_Y[4] = { 0.1f, -0.05f, 0.1f, 0.25f };
  static const float PUFF_R[4] = { 0.32f, 0.4f, 0.3f, 0.28f };
  for (uint8_t i = 0; i < 4; i++) {
    float x = PUFF_X[i] + dx;
    float y = PUFF_Y[i];
    int16_t wx = cx + (int16_t)roundf((x * oc - y * os) * rx);
    int16_t wy = cy + (int16_t)roundf((x * os + y * oc) * ry);
    int16_t wr = (int16_t)roundf(PUFF_R[i] * rMag);
    if (wr > 0) gfx.fillCircle(wx, wy, wr, color);
  }
}

// Approximates drawTeardrop()'s quadratic-bezier outline in the studio as a fixed 6-point
// polygon (Adafruit_GFX has no curve-fill primitive) — visually close at sticker sizes.
template <typename T>
inline void eyesDrawSticker_Tears(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  static const float TEAR_X[6] = { 0.0f, 0.75f, 0.45f, 0.0f, -0.45f, -0.75f };
  static const float TEAR_Y[6] = { -1.0f, 0.2f, 0.85f, 1.0f, 0.85f, 0.2f };
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  for (uint8_t i = 0; i < 2; i++) {
    float xBase = -0.3f + 0.6f * i;
    float phase = eyesStickerHash01(i * 31 + 1);
    float local = fmodf(t * 0.4f + phase, 1.0f);
    if (local < 0) local += 1.0f;
    float y = local * 1.6f - 0.6f;
    float pr = 0.16f;
    int16_t wx[6], wy[6];
    for (uint8_t v = 0; v < 6; v++) {
      float lx = xBase + TEAR_X[v] * pr;
      float ly = y + TEAR_Y[v] * pr;
      wx[v] = cx + (int16_t)roundf((lx * oc - ly * os) * rx);
      wy[v] = cy + (int16_t)roundf((lx * os + ly * oc) * ry);
    }
    eyesFillPolygonScreen(gfx, wx, wy, 6, color);
  }
}

// Approximates fire()'s quadratic-bezier flame silhouette as a fixed 8-point polygon, with
// the flicker applied to the tip (the dominant visual wobble) rather than every curve segment.
template <typename T>
inline void eyesDrawSticker_Fire(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  static const float FLAME_X[8] = { 0.0f, 0.5f, 0.32f, 0.2f, 0.0f, -0.2f, -0.32f, -0.5f };
  static const float FLAME_Y[8] = { -1.0f, -0.2f, 0.4f, 0.9f, 1.0f, 0.9f, 0.4f, -0.2f };
  float flick = 0.08f * sinf(t * 9.0f) + 0.05f * sinf(t * 17.0f + 1.0f);
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  int16_t wx[8], wy[8];
  for (uint8_t v = 0; v < 8; v++) {
    float lx = FLAME_X[v];
    float ly = FLAME_Y[v] + (v == 0 ? -flick : 0.0f);
    wx[v] = cx + (int16_t)roundf((lx * oc - ly * os) * rx);
    wy[v] = cy + (int16_t)roundf((lx * os + ly * oc) * ry);
  }
  eyesFillPolygonScreen(gfx, wx, wy, 8, color);
}

template <typename T>
inline void eyesDrawSticker_Smoke(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  float rMag = (fabsf((float)rx) + fabsf((float)ry)) * 0.5f;
  for (uint8_t i = 0; i < 4; i++) {
    float phase = eyesStickerHash01(i * 41 + 1);
    float local = fmodf(t * 0.3f + phase, 1.0f);
    if (local < 0) local += 1.0f;
    float y = 0.9f - local * 1.8f;
    float x = 0.15f * sinf(t * 1.5f + i * 2.0f);
    float pr = 0.12f + local * 0.22f;
    int16_t wx = cx + (int16_t)roundf((x * oc - y * os) * rx);
    int16_t wy = cy + (int16_t)roundf((x * os + y * oc) * ry);
    int16_t wr = (int16_t)roundf(pr * rMag);
    if (wr > 0) gfx.fillCircle(wx, wy, wr, color);
  }
}

// The studio's lightning fades between two alpha levels (1.0, then 0.4) before going fully
// invisible — collapsed here into one visible window (no partial-alpha step in firmware, see
// the opacity comment above) rather than a three-way alpha cut.
template <typename T>
inline void eyesDrawSticker_Lightning(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  static const float BOLT_X[6] = { 0.15f, -0.25f, 0.05f, -0.15f, 0.35f, 0.05f };
  static const float BOLT_Y[6] = { -1.0f, 0.05f, 0.05f, 1.0f, -0.1f, -0.1f };
  float cycle = fmodf(t, 1.6f);
  if (cycle < 0) cycle += 1.6f;
  if (cycle >= 0.22f) return;
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  int16_t wx[6], wy[6];
  for (uint8_t v = 0; v < 6; v++) {
    wx[v] = cx + (int16_t)roundf((BOLT_X[v] * oc - BOLT_Y[v] * os) * rx);
    wy[v] = cy + (int16_t)roundf((BOLT_X[v] * os + BOLT_Y[v] * oc) * ry);
  }
  eyesFillPolygonScreen(gfx, wx, wy, 6, color);
}

template <typename T>
inline void eyesDrawSticker_BurstLines(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  float rad = rotationDeg * (float)PI / 180.0f;
  float oc = cosf(rad), os = sinf(rad);
  float pulse = 0.7f + 0.3f * sinf(t * 4.0f);
  const uint8_t N = 8;
  for (uint8_t i = 0; i < N; i++) {
    float angle = ((float)i / N) * 2.0f * (float)PI;
    float ca = cosf(angle), sa = sinf(angle);
    float inner = 0.35f;
    float outer = 0.35f + 0.6f * pulse;
    float x1 = ca * inner, y1 = sa * inner;
    float x2 = ca * outer, y2 = sa * outer;
    int16_t wx1 = cx + (int16_t)roundf((x1 * oc - y1 * os) * rx);
    int16_t wy1 = cy + (int16_t)roundf((x1 * os + y1 * oc) * ry);
    int16_t wx2 = cx + (int16_t)roundf((x2 * oc - y2 * os) * rx);
    int16_t wy2 = cy + (int16_t)roundf((x2 * os + y2 * oc) * ry);
    gfx.drawLine(wx1, wy1, wx2, wy2, color);
  }
}

template <typename T>
inline void eyesDrawSticker_ExpandingCircles(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, float rotationDeg, uint16_t color, float t) {
  (void)rotationDeg; // rings are rotation-invariant
  float rMag = (fabsf((float)rx) + fabsf((float)ry)) * 0.5f;
  const uint8_t N = 3;
  for (uint8_t i = 0; i < N; i++) {
    float local = fmodf(t * 0.6f + (float)i / N, 1.0f);
    if (local < 0) local += 1.0f;
    int16_t wr = (int16_t)roundf(local * rMag);
    if (wr > 0) gfx.drawCircle(cx, cy, wr, color);
  }
}

// Dispatches to the matching built-in drawer. All 14 built-ins have a firmware drawer.
template <typename T>
inline void eyesDrawStickerProcedural(T& gfx, uint8_t builtinId, int16_t cx, int16_t cy, int16_t rx, int16_t ry,
                                       float rotationDeg, uint16_t color, float t) {
  switch (builtinId) {
    case STICKER_BUILTIN_RAIN: eyesDrawSticker_Rain(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_SNOW: eyesDrawSticker_Snow(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_ZZZ: eyesDrawSticker_Zzz(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_STARS: eyesDrawSticker_Stars(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_HEARTS: eyesDrawSticker_Hearts(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_SPARKLES: eyesDrawSticker_Sparkles(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_CLOUDS: eyesDrawSticker_Clouds(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_TEARS: eyesDrawSticker_Tears(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_FIRE: eyesDrawSticker_Fire(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_SMOKE: eyesDrawSticker_Smoke(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_LIGHTNING: eyesDrawSticker_Lightning(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_BURST_LINES: eyesDrawSticker_BurstLines(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_EXPANDING_CIRCLES: eyesDrawSticker_ExpandingCircles(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    case STICKER_BUILTIN_CONFETTI: eyesDrawSticker_Confetti(gfx, cx, cy, rx, ry, rotationDeg, color, t); break;
    default: break;
  }
}

// Blits one raster sticker frame, nearest-neighbor-scaled from the asset's own captured
// resolution up/down to (w, h) and rotated about (cx, cy) — forward source-to-destination
// mapping (iterate source pixels, compute where each lands), so it's exact at rotationDeg==0
// and may leave small gaps between plotted pixels when scaling up a lot at a non-zero
// rotation; stickers are small decorations at modest sizes, so this trade-off (simplicity and
// speed over perfect coverage in that specific combination) is acceptable here. Pixels equal
// to STICKER_TRANSPARENT_COLOR are skipped (binary transparency — see the comment above).
template <typename T>
inline void eyesDrawStickerRaster(T& gfx, const StickerRasterAsset& asset, uint8_t frameIndex,
                                   int16_t cx, int16_t cy, int16_t w, int16_t h, float rotationDeg, bool flipH, bool flipV) {
  if (frameIndex >= asset.frameCount || asset.width == 0 || asset.height == 0) return;
  const uint16_t* pixels = asset.frames[frameIndex];
  float rad = rotationDeg * (float)PI / 180.0f;
  float c = cosf(rad), s = sinf(rad);
  float sx = ((float)w / (float)asset.width) * (flipH ? -1.0f : 1.0f);
  float sy = ((float)h / (float)asset.height) * (flipV ? -1.0f : 1.0f);
  for (uint8_t py = 0; py < asset.height; py++) {
    for (uint8_t px = 0; px < asset.width; px++) {
      uint16_t pixel = pixels[(uint16_t)py * asset.width + px];
      if (pixel == STICKER_TRANSPARENT_COLOR) continue;
      float lx = ((float)px - asset.width / 2.0f) * sx;
      float ly = ((float)py - asset.height / 2.0f) * sy;
      float wx = cx + lx * c - ly * s;
      float wy = cy + lx * s + ly * c;
      gfx.drawPixel((int16_t)roundf(wx), (int16_t)roundf(wy), pixel);
    }
  }
}

// A sticker's computed-for-this-frame transform/visibility, evaluated as a closed-form
// function of elapsed time from StickerDef's parametric animation fields — see the "one
// deliberate simplification" note in the studio's Stickers plan (no per-sticker keyframes).
struct StickerLive {
  bool visible;
  int16_t cx, cy;
  int16_t rx, ry;
  float rotationDeg;
};

inline StickerLive eyesComputeStickerLive(const StickerDef& s, unsigned long elapsedMs) {
  StickerLive live;
  live.visible = false;
  live.cx = live.cy = live.rx = live.ry = 0;
  live.rotationDeg = 0;
  if (elapsedMs < s.startDelayMs) return live;
  unsigned long localMs = elapsedMs - s.startDelayMs;
  if (localMs < (unsigned long)s.startTimeMs) return live;
  if (s.endTimeMs >= 0 && localMs > (unsigned long)s.endTimeMs) return live;

  float tSec = localMs / 1000.0f;
  float opacity = s.opacity;
  unsigned long sinceStart = localMs - (unsigned long)s.startTimeMs;
  if (s.fadeInMs > 0 && sinceStart < (unsigned long)s.fadeInMs) {
    opacity *= (float)sinceStart / (float)s.fadeInMs;
  }
  if (s.endTimeMs >= 0 && s.fadeOutMs > 0) {
    unsigned long untilEnd = (unsigned long)s.endTimeMs > localMs ? (unsigned long)s.endTimeMs - localMs : 0;
    if (untilEnd < (unsigned long)s.fadeOutMs) {
      opacity *= (float)untilEnd / (float)s.fadeOutMs;
    }
  }
  if (s.pulseOpacity > 0) {
    float pulse = sinf(tSec * 2.0f * (float)PI);
    opacity *= 1.0f - (s.pulseOpacity / 100.0f) * (0.5f - 0.5f * pulse);
  }
  // Below this, treated as fully invisible rather than partially blended — see the opacity
  // comment in the studio's cppExport.ts (RGB565 has no alpha to blend a front-layer sticker
  // against whatever's already drawn beneath it).
  if (opacity < 35.0f) return live;

  float scale = s.scale / 100.0f;
  if (s.pulseScale > 0) {
    float pulse = sinf(tSec * 2.0f * (float)PI);
    scale *= 1.0f + (s.pulseScale / 100.0f) * 0.3f * pulse;
  }
  live.rx = (int16_t)roundf((s.width / 2.0f) * scale) * (s.flipH ? -1 : 1);
  live.ry = (int16_t)roundf((s.height / 2.0f) * scale) * (s.flipV ? -1 : 1);
  live.cx = s.x + (int16_t)roundf(s.driftX * tSec);
  live.cy = s.y + (int16_t)roundf(s.driftY * tSec);
  live.rotationDeg = s.rotation + s.spin * tSec;
  live.visible = true;
  return live;
}

// Picks the current raster frame from a sticker's live-elapsed time (unaffected by
// startDelayMs, already subtracted by the caller), honoring animSpeed/animFps override/
// loopMode/reverse — mirrors pickRasterFrame() in the studio's drawSticker.ts.
inline uint8_t eyesPickStickerFrame(const StickerRasterAsset& asset, const StickerDef& s, unsigned long localMs) {
  if (asset.frameCount <= 1) return 0;
  unsigned long totalMs = 0;
  for (uint8_t i = 0; i < asset.frameCount; i++) {
    unsigned long d = s.animFps > 0 ? (unsigned long)(1000 / s.animFps) : asset.frameDelaysMs[i];
    if (d == 0) d = 1;
    totalMs += d;
  }
  if (totalMs == 0) return 0;

  unsigned long scaledMs = (unsigned long)(localMs * (s.animSpeed / 100.0f));
  unsigned long pos;
  if (s.loopMode == STICKER_LOOP_PINGPONG) {
    unsigned long cycle = totalMs * 2;
    unsigned long m = scaledMs % cycle;
    pos = m < totalMs ? m : (cycle - m);
  } else if (s.loopMode == STICKER_LOOP_LOOP) {
    pos = scaledMs % totalMs;
  } else {
    pos = scaledMs < totalMs ? scaledMs : totalMs - 1;
  }
  if (s.reverse) pos = totalMs - 1 - pos;

  unsigned long acc = 0;
  for (uint8_t i = 0; i < asset.frameCount; i++) {
    unsigned long d = s.animFps > 0 ? (unsigned long)(1000 / s.animFps) : asset.frameDelaysMs[i];
    if (d == 0) d = 1;
    acc += d;
    if (pos < acc) return i;
  }
  return asset.frameCount - 1;
}

// Draws every sticker on the given layer. eyesDrawEyePair() below already calls this
// automatically (STICKER_LAYER_BEHIND before the eyes, STICKER_LAYER_FRONT after) — call it
// directly yourself only if you're not using eyesDrawEyePair() (e.g. drawing each eye
// separately via eyesDrawEye()), passing the same screenCx/screenCy you use there.
// \`stickers\`/\`rasterAssets\` are always PROJECT_STICKERS/STICKER_RASTER_ASSETS from the
// generated header; \`elapsedMs\` should be a free-running clock (e.g. millis() since boot) —
// stickers animate independently of whatever expression/animation the eyes are currently
// playing. \`screenCx\`/\`screenCy\` is the display's own center pixel (e.g. 120,120 on a
// 240x240 panel) — StickerDef.x/y (and thus live.cx/live.cy from eyesComputeStickerLive()) are
// offsets *from that center*, matching the studio's own coordinate convention
// (faceRenderer.ts translates to the display center before drawing stickers) — without adding
// it here, every sticker draws at (x, y) as if it were an absolute top-left-origin pixel
// coordinate instead, landing it off-canvas unless x/y happens to be within a few pixels of
// (0, 0). This is the sticker-position analogue of eyesDrawEye() already receiving cx/cy
// (pre-offset) from eyesDrawEyePair() below for the exact same reason.
template <typename T>
inline void eyesDrawStickers(T& gfx, const StickerDef* stickers, uint8_t count,
                              const StickerRasterAsset* rasterAssets, uint8_t rasterCount,
                              uint8_t layer, unsigned long elapsedMs, int16_t screenCx, int16_t screenCy) {
  for (uint8_t i = 0; i < count; i++) {
    StickerDef s = stickers[i];
    if (s.layer != layer) continue;
    StickerLive live = eyesComputeStickerLive(s, elapsedMs);
    if (!live.visible) continue;
    unsigned long localMs = elapsedMs > s.startDelayMs ? elapsedMs - s.startDelayMs : 0;
    int16_t drawCx = screenCx + live.cx;
    int16_t drawCy = screenCy + live.cy;
    if (s.kind == STICKER_KIND_PROCEDURAL) {
      eyesDrawStickerProcedural(gfx, s.assetIndex, drawCx, drawCy, live.rx, live.ry, live.rotationDeg, s.tintColor, localMs / 1000.0f);
    } else if (s.assetIndex < rasterCount) {
      const StickerRasterAsset& asset = rasterAssets[s.assetIndex];
      uint8_t frame = eyesPickStickerFrame(asset, s, localMs);
      eyesDrawStickerRaster(gfx, asset, frame, drawCx, drawCy, (int16_t)(live.rx < 0 ? -live.rx : live.rx) * 2,
                             (int16_t)(live.ry < 0 ? -live.ry : live.ry) * 2, live.rotationDeg, s.flipH, s.flipV);
    }
  }
}

// ---- Playback — call every loop() with the same (frames, count, loop, startMillis, ----
// frameIndex) variables; advances state in-place and fills \`outLive\`. Returns true while
// still playing, false once a non-looping animation has finished.
inline bool eyesPlayAnimation(const EyeFrame frames[], uint16_t count, bool loop,
                               unsigned long& startMillis, uint16_t& frameIndex, LiveEye& outLive) {
  if (count == 0) return false;
  if (count == 1) {
    outLive = eyesLerpFrame(frames[0], frames[0], 0);
    frameIndex = 0;
    return false;
  }

  unsigned long elapsed = millis() - startMillis;
  uint16_t segments = loop ? count : (count - 1);
  unsigned long acc = 0;

  for (uint16_t i = 0; i < segments; i++) {
    unsigned long dur = frames[i].durationMs;
    if (dur == 0) dur = 1;
    uint16_t next = (i + 1) % count;
    bool lastSegment = (i == segments - 1);

    if (elapsed <= acc + dur || lastSegment) {
      float t = (float)(elapsed - acc) / (float)dur;
      if (t > 1) t = 1;
      if (t < 0) t = 0;
      bool finished = !loop && lastSegment && elapsed >= acc + dur;
      float eased = eyesEase(t, frames[i].easing, frames[i].bezierX1, frames[i].bezierY1, frames[i].bezierX2, frames[i].bezierY2);
      outLive = eyesLerpFrame(frames[i], frames[next], eased);
      frameIndex = i;
      return !finished;
    }
    acc += dur;
  }

  if (loop) {
    startMillis += acc;
    return eyesPlayAnimation(frames, count, loop, startMillis, frameIndex, outLive);
  }
  outLive = eyesLerpFrame(frames[count - 1], frames[count - 1], 0);
  return false;
}

// Same as above, bundled into one EyeAnimation argument instead of three loose ones — what
// PlayAnimation()/UpdateEyes() below use internally. Call this instead if you want manual
// control (your own timing/state variables) without the SetExpression()/PlayAnimation()
// convenience layer. Only ever advances/reads \`anim.frames\` — see eyesPlayAnimationPair()
// below for an animation that authored Left Eye/Right Eye track divergence.
inline bool eyesPlayAnimation(const EyeAnimation& anim, unsigned long& startMillis, uint16_t& frameIndex, LiveEye& outLive) {
  return eyesPlayAnimation(anim.frames, anim.count, anim.loop, startMillis, frameIndex, outLive);
}

// Two-eye counterpart of eyesPlayAnimation() above — plays \`framesLeft\`/\`framesRight\` in
// lockstep (same shared elapsed-time/segment resolution, since both arrays always have the
// same per-frame durationMs — see the EyeAnimation comment) and fills both outLeft/outRight.
// \`framesRight == nullptr\` mirrors framesLeft into outRight, matching EyeAnimation.framesRight's
// own null convention. Deliberately a separate function (not a refactor of the single-eye
// eyesPlayAnimation() above) so that existing single-eye call sites/behavior stay byte-for-byte
// unchanged — this is purely additive.
inline bool eyesPlayAnimationPair(const EyeFrame framesLeft[], const EyeFrame framesRight[], uint16_t count, bool loop,
                                    unsigned long& startMillis, uint16_t& frameIndex, LiveEye& outLeft, LiveEye& outRight) {
  if (count == 0) return false;
  const EyeFrame* right = framesRight ? framesRight : framesLeft;
  if (count == 1) {
    outLeft = eyesLerpFrame(framesLeft[0], framesLeft[0], 0);
    outRight = eyesLerpFrame(right[0], right[0], 0);
    frameIndex = 0;
    return false;
  }

  unsigned long elapsed = millis() - startMillis;
  uint16_t segments = loop ? count : (count - 1);
  unsigned long acc = 0;

  for (uint16_t i = 0; i < segments; i++) {
    unsigned long dur = framesLeft[i].durationMs;
    if (dur == 0) dur = 1;
    uint16_t next = (i + 1) % count;
    bool lastSegment = (i == segments - 1);

    if (elapsed <= acc + dur || lastSegment) {
      float t = (float)(elapsed - acc) / (float)dur;
      if (t > 1) t = 1;
      if (t < 0) t = 0;
      bool finished = !loop && lastSegment && elapsed >= acc + dur;
      float eased = eyesEase(t, framesLeft[i].easing, framesLeft[i].bezierX1, framesLeft[i].bezierY1, framesLeft[i].bezierX2, framesLeft[i].bezierY2);
      outLeft = eyesLerpFrame(framesLeft[i], framesLeft[next], eased);
      outRight = eyesLerpFrame(right[i], right[next], eased);
      frameIndex = i;
      return !finished;
    }
    acc += dur;
  }

  if (loop) {
    startMillis += acc;
    return eyesPlayAnimationPair(framesLeft, framesRight, count, loop, startMillis, frameIndex, outLeft, outRight);
  }
  outLeft = eyesLerpFrame(framesLeft[count - 1], framesLeft[count - 1], 0);
  outRight = eyesLerpFrame(right[count - 1], right[count - 1], 0);
  return false;
}

inline bool eyesPlayAnimationPair(const EyeAnimation& anim, unsigned long& startMillis, uint16_t& frameIndex, LiveEye& outLeft, LiveEye& outRight) {
  return eyesPlayAnimationPair(anim.frames, anim.framesRight, anim.count, anim.loop, startMillis, frameIndex, outLeft, outRight);
}

// ---- Easy player: SetExpression() / PlayAnimation() / UpdateEyes() -------------------
// The simplest way to drive the eyes. Call SetExpression()/PlayAnimation() any time you
// want to change what's showing — from a button press, sensor reading, timer, or serial
// command — then call UpdateEyes() once per loop() to advance and get the pose to draw.
// Switching expressions crossfades smoothly over EYES_BLEND_MS; switching (or restarting)
// an animation cuts over immediately, since the animation's own first keyframe already
// eases in on its own. Declared before "Drawing" below since eyesDrawEyePair() reads
// eyesPlayer directly (to merge in whichever expression's/animation's own stickers are
// currently active — see the Stickers comment further up) as an ordinary, non-dependent name.
const unsigned long EYES_BLEND_MS = 250;

struct EyesPlayerState {
  bool playingAnimation;
  const EyeExpression* expression;
  EyeAnimation animation;
  unsigned long animStart;
  uint16_t frameIndex;
  LiveEye live;
  // Right eye's pose, only ever different from \`live\` while playing an animation whose
  // EyeAnimation.framesRight is non-null (see UpdateEyes()/UpdateEyesRight()) — mirrors \`live\`
  // for static expressions, matching the studio's own "expressions/idle never diverge per eye
  // during Animate playback" behavior (only Design mode's live pose and animations with an
  // authored Left Eye/Right Eye track ever do).
  LiveEye liveRight;
  LiveEye blendFrom;
  unsigned long blendStart;
  bool blending;
  EyeColorSet colorsLeft;
  EyeColorSet colorsRight;
};
static EyesPlayerState eyesPlayer = { false, nullptr, { nullptr, 0, false, nullptr, nullptr, 0 }, 0, 0, {}, {}, {}, 0, false, EYE_COLORS_LEFT, EYE_COLORS_RIGHT };

// Shows a static expression, crossfading smoothly from whatever's currently on screen —
// call it with any Expr_* constant, e.g. SetExpression(Expr_Happy). Also switches this
// expression's own color palette and stickers, matching the studio (applying an expression
// there can change all three — see the EyeExpression comment above).
inline void SetExpression(const EyeExpression& expression) {
  eyesPlayer.blendFrom = eyesPlayer.live;
  eyesPlayer.blendStart = millis();
  eyesPlayer.blending = true;
  eyesPlayer.playingAnimation = false;
  eyesPlayer.expression = &expression;
  eyesPlayer.colorsLeft = *expression.colorsLeft;
  eyesPlayer.colorsRight = *expression.colorsRight;
}

// Plays (or restarts) an animation from its first keyframe — call it with any Anim_*
// constant, e.g. PlayAnimation(Anim_Blink). Colors are left untouched (matching the studio,
// where Animate mode never changes the color theme — only expressions can).
inline void PlayAnimation(const EyeAnimation& animation) {
  eyesPlayer.playingAnimation = true;
  eyesPlayer.animation = animation;
  eyesPlayer.animStart = millis();
  eyesPlayer.frameIndex = 0;
  eyesPlayer.blending = false;
}

// Advances whatever's currently playing and returns the pose to draw this frame. Call this
// once per loop(), after at least one SetExpression()/PlayAnimation() call in setup() —
// with neither ever called, there's nothing to show yet. See UpdateEyesRight() for the right
// eye's pose (identical unless the currently-playing animation authored real left/right
// divergence).
inline LiveEye UpdateEyes() {
  if (eyesPlayer.blending) {
    float t = (float)(millis() - eyesPlayer.blendStart) / (float)EYES_BLEND_MS;
    if (t >= 1.0f) { t = 1.0f; eyesPlayer.blending = false; }
    LiveEye target = eyesLerpFrame(*eyesPlayer.expression->frame, *eyesPlayer.expression->frame, 0);
    eyesPlayer.live = eyesLerpLive(eyesPlayer.blendFrom, target, t);
    eyesPlayer.liveRight = eyesPlayer.live;
  } else if (eyesPlayer.playingAnimation) {
    eyesPlayAnimationPair(eyesPlayer.animation, eyesPlayer.animStart, eyesPlayer.frameIndex, eyesPlayer.live, eyesPlayer.liveRight);
  } else if (eyesPlayer.expression) {
    eyesPlayer.live = eyesLerpFrame(*eyesPlayer.expression->frame, *eyesPlayer.expression->frame, 0);
    eyesPlayer.liveRight = eyesPlayer.live;
  }
  return eyesPlayer.live;
}

// The right eye's counterpart to UpdateEyes()'s return value — call after UpdateEyes() (which
// does the actual advancing) to also get the right eye's pose for eyesDrawEyePair()'s two-
// LiveEye overload. Identical to UpdateEyes()'s return value unless the currently-playing
// animation authored real Left Eye/Right Eye track divergence in the studio.
inline LiveEye UpdateEyesRight() {
  return eyesPlayer.liveRight;
}

// ---- Drawing — flat-color layered render: border -> sclera -> iris -> pupil -> highlight -> ----
// eyelids. \`T\` is a template (not \`Adafruit_GFX&\`) on purpose: fillRoundRect()/
// fillCircle() aren't virtual in Adafruit_GFX, so a buffered subclass like
// EyesBufferedDisplay below only gets called correctly when the concrete type is known at
// compile time. \`bgColor\` should match your Display panel's background so eyelids blend in.
// \`colors\` is passed in (not hardcoded macros) so the two eyes can use different palettes
// when Eye Target: Left/Right editing gave them different colors in the studio.
// Blends two RGB565 colors channel-by-channel; t=0 -> a, t=1 -> b — the RGB565 counterpart to
// the studio's mixColors()/shadeColor(), used by the gradient/glow/shadow approximations below
// to combine two *already-exported* flat colors at a runtime-computed ratio (something
// colorSetLiteral() can't precompute, since it varies per scanline row, not per project).
inline uint16_t eyesBlendRgb565(uint16_t a, uint16_t b, float t) {
  if (t <= 0.0f) return a;
  if (t >= 1.0f) return b;
  uint8_t ar = (a >> 11) & 0x1F, ag = (a >> 5) & 0x3F, ab = a & 0x1F;
  uint8_t br = (b >> 11) & 0x1F, bg = (b >> 5) & 0x3F, bb = b & 0x1F;
  uint8_t rr = (uint8_t)roundf(ar + (br - ar) * t);
  uint8_t rg = (uint8_t)roundf(ag + (bg - ag) * t);
  uint8_t rb = (uint8_t)roundf(ab + (bb - ab) * t);
  return ((uint16_t)rr << 11) | ((uint16_t)rg << 5) | rb;
}

// Fills the sclera as a top-to-bottom gradient (scleraTop -> scleraBottom) via horizontal
// scanlines, the RGB565 equivalent of the studio's ctx.createLinearGradient() sclera fill —
// same eyesEyeHalfWidthAt() boundary eyesFillRoundedRect() uses, so the silhouette matches
// exactly. If shadowIntensity > 0, additionally blends in the ambient shadow color across the
// eye's top ~32% (matching drawEye.ts's shadow gradient band exactly: alpha 0 at the shadow
// band's own bottom edge, ramping up toward the eye's top edge, scaled by the studio's
// 0.15 + intensity/100*0.45 formula) — composited per-row on top of the sclera gradient
// color already computed for that row, since RGB565 can't layer two semi-transparent fills
// the way Canvas 2D does.
template <typename T>
inline void eyesFillEyeSclera(T& gfx, int16_t cx, int16_t cy, int16_t w, int16_t h, int16_t radius,
                               uint16_t scleraTop, uint16_t scleraBottom, uint16_t shadowColor, uint8_t shadowIntensity) {
  if (w <= 0 || h <= 0) return;
  float hx = w / 2.0f;
  float hy = h / 2.0f;
  float rx = radius < hx ? (float)radius : hx;
  float ry = radius < hy ? (float)radius : hy;
  int16_t halfH = (int16_t)ceilf(hy);
  float shadowH = h * 0.32f;
  float shadowAlpha = 0.15f + (shadowIntensity / 100.0f) * 0.45f;
  for (int16_t dy = -halfH; dy <= halfH; dy++) {
    float xExtent = eyesEyeHalfWidthAt((float)dy, hx, hy, rx, ry);
    if (xExtent < 0) continue;
    float t = (dy + hy) / (float)h;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    uint16_t rowColor = eyesBlendRgb565(scleraTop, scleraBottom, t);
    if (shadowIntensity > 0) {
      float distFromTop = dy + hy;
      if (distFromTop < shadowH) {
        float localAlpha = shadowAlpha * (1.0f - distFromTop / shadowH);
        rowColor = eyesBlendRgb565(rowColor, shadowColor, localAlpha);
      }
    }
    int16_t ix = (int16_t)xExtent;
    gfx.drawFastHLine(cx - ix, cy + dy, ix * 2 + 1, rowColor);
  }
}

// Approximates the studio's 3-stop radial iris gradient (light center -> base color at 75% ->
// dark edge) with RINGS concentric ellipses, largest/darkest drawn first and smallest/lightest
// drawn last (on top) — Adafruit_GFX has no gradient fill, so nested flat-color shapes is the
// standard MCU-graphics approximation. Clipped to the eye's own silhouette via
// eyesFillEllipseInEye() exactly like the flat iris fill this replaces.
template <typename T>
inline void eyesFillIrisGradient(T& gfx, int16_t eyeCx, int16_t eyeCy, int16_t eyeW, int16_t eyeH, int16_t eyeRadius,
                                  int16_t ecx, int16_t ecy, int16_t rx, int16_t ry,
                                  uint16_t irisLight, uint16_t irisBase, uint16_t irisDark) {
  const uint8_t RINGS = 6;
  for (int8_t i = RINGS; i >= 1; i--) {
    float t = (float)i / (float)RINGS;
    uint16_t color;
    if (t >= 0.75f) {
      color = eyesBlendRgb565(irisBase, irisDark, (t - 0.75f) / 0.25f);
    } else {
      color = eyesBlendRgb565(irisLight, irisBase, t / 0.75f);
    }
    int16_t ringRx = (int16_t)roundf(rx * t);
    int16_t ringRy = (int16_t)roundf(ry * t);
    if (ringRx <= 0 || ringRy <= 0) continue;
    eyesFillEllipseInEye(gfx, eyeCx, eyeCy, eyeW, eyeH, eyeRadius, ecx, ecy, ringRx, ringRy, 0.0f, color);
  }
}

// Approximates the studio's outer glow halo (a blurred, semi-transparent copy of the eye
// shape bleeding outward past the border) with RINGS concentric enlarged rounded-rects, each
// blended toward the background color — Adafruit_GFX has no blur/shadow primitive, so this is
// a soft-edged-looking ring falloff rather than a true gaussian blur; genuinely the closest
// achievable approximation on this hardware, not a pixel-identical match (see the Colors
// comment in generateCppHeader() below for the equivalent studio-vs-firmware caveat). Drawn
// *before* the border/sclera, same order as the studio, so the border still paints cleanly on
// top of it.
template <typename T>
inline void eyesFillGlow(T& gfx, int16_t cx, int16_t cy, int16_t w, int16_t h, int16_t radius,
                          uint16_t bgColor, uint16_t glowColor, uint8_t glowIntensity) {
  if (glowIntensity == 0) return;
  const uint8_t RINGS = 4;
  float maxBlur = 4.0f + (glowIntensity / 100.0f) * 22.0f;
  float baseAlpha = 0.25f + (glowIntensity / 100.0f) * 0.55f;
  for (int8_t i = RINGS; i >= 1; i--) {
    float t = (float)i / (float)RINGS;
    float expand = maxBlur * t;
    float alpha = baseAlpha * (1.0f - t) * 1.3f;
    if (alpha > 1.0f) alpha = 1.0f;
    if (alpha <= 0.02f) continue;
    uint16_t ringColor = eyesBlendRgb565(bgColor, glowColor, alpha);
    eyesFillRoundedRect(gfx, cx, cy, w + (int16_t)(expand * 2), h + (int16_t)(expand * 2), radius + (int16_t)expand, ringColor);
  }
}

template <typename T>
inline void eyesDrawEye(T& gfx, int16_t cx, int16_t cy, const LiveEye& e, bool mirror, uint16_t bgColor, const EyeColorSet& colors) {
  int16_t w = (int16_t)e.width, h = (int16_t)e.height;
  int16_t radius = (int16_t)e.radius;

  // Glow — a soft halo bleeding outward past the eye's own edge (and past the border ring
  // below), drawn first so everything else paints over it. See eyesFillGlow()'s own comment
  // for the approximation this makes (no true blur on this hardware).
  eyesFillGlow(gfx, cx, cy, w, h, radius, bgColor, colors.glow, colors.glowIntensity);

  // Border — an outer stadium/oval shape colors.borderWidth larger on every side, in a color
  // already pre-blended toward the background by Border Opacity (see EYE_COLORS_LEFT/RIGHT
  // above). The sclera fill right after this covers everything except a thin ring, giving
  // an opaque border with no per-pixel alpha needed. Both fills go through
  // eyesFillRoundedRect() (elliptical corners) rather than Adafruit_GFX's own
  // fillRoundRect(), so a maxed-out Radius on a non-square eye renders as a smooth oval
  // here exactly like it does in the studio's preview. borderWidth lives on EyeColorSet
  // (not a single global #define) so left/right eyes can have different ring thicknesses,
  // matching the studio's per-eye Visual Reference overrides.
  if (colors.borderWidth > 0) {
    eyesFillRoundedRect(gfx, cx, cy, w + colors.borderWidth * 2, h + colors.borderWidth * 2,
                         radius + colors.borderWidth, colors.border);
  }

  // Sclera — vertical gradient (scleraTop -> scleraBottom) with the ambient shadow band
  // blended in — see eyesFillEyeSclera()'s own comment.
  eyesFillEyeSclera(gfx, cx, cy, w, h, radius, colors.scleraTop, colors.scleraBottom, colors.shadow, colors.shadowIntensity);

  int sign = mirror ? -1 : 1;
  int16_t px = cx + (int16_t)(sign * (e.pupilX / 100.0f) * (w / 2.0f));
  int16_t py = cy + (int16_t)((e.pupilY / 100.0f) * (h / 2.0f));

  int16_t irisRX = (int16_t)((e.irisWidth / 100.0f) * (w / 2.0f));
  int16_t irisRY = (int16_t)((e.irisHeight / 100.0f) * (h / 2.0f));
  int16_t pupilRX = (int16_t)((e.pupilWidth / 100.0f) * (w / 2.0f));
  int16_t pupilRY = (int16_t)((e.pupilHeight / 100.0f) * (h / 2.0f));

  // Both clipped to the eye's own silhouette (see eyesFillEllipseInEye) since Pupil X/Y can
  // now push the shared iris/pupil center out toward the eye's edge. The iris never rotates
  // (0deg) and gets the radial-gradient approximation (eyesFillIrisGradient — see its own
  // comment); the pupil uses its own independent Pupil Rotation and whatever shape
  // e.pupilShape selects — see eyesFillPupilShape() above.
  if (irisRX > 0 && irisRY > 0) {
    eyesFillIrisGradient(gfx, cx, cy, w, h, radius, px, py, irisRX, irisRY, colors.irisLight, colors.iris, colors.irisDark);
  }
  if (pupilRX > 0 && pupilRY > 0) {
    eyesFillPupilShape(gfx, cx, cy, w, h, radius, px, py, pupilRX, pupilRY, e.pupilRotation, e.pupilShape, e.pupilCustomShapeIndex, colors.pupil);
  }

  float hlBaseX = pupilRX > 0 ? pupilRX : irisRX;
  float hlBaseY = pupilRY > 0 ? pupilRY : irisRY;
  float hlBase = (hlBaseX + hlBaseY) / 2.0f;
  int16_t hR = (int16_t)((e.highlightSize / 100.0f) * hlBase);
  if (hR > 0 && hlBase > 0) {
    int16_t hx = px + (int16_t)(sign * (e.highlightX / 100.0f) * hlBaseX);
    int16_t hy = py + (int16_t)((e.highlightY / 100.0f) * hlBaseY);
    // colors.highlightBlend is the highlight pre-blended 92% over the pupil color, matching
    // the studio's fixed-alpha look (RGB565 can't do the real per-pixel alpha blend here).
    gfx.fillCircle(hx, hy, hR, colors.highlightBlend);
  }

  eyesFillEyelid(gfx, cx, cy, w, h, radius, true, e.upperEyelid, e.upperEyelidTilt, e.upperEyelidCurvature, bgColor);
  eyesFillEyelid(gfx, cx, cy, w, h, radius, false, e.lowerEyelid, e.lowerEyelidTilt, e.lowerEyelidCurvature, bgColor);
}

// Draws both eyes — from independent left/right LiveEye poses (only actually different when
// the currently-playing animation authored real Left Eye/Right Eye track divergence in the
// studio; UpdateEyes()/UpdateEyesRight() give you both — see the single-LiveEye overload below
// for the plain mirrored case) — plus every currently-active sticker (behind-layer first, then
// the eyes, then front-layer) — Project.stickers (always active) merged with whichever
// Expression/Animation is currently active via eyesPlayer (see SetExpression()/
// PlayAnimation() above), matching the studio's effectiveStickers(). So this one call is
// genuinely everything needed to draw a frame, matching the "Minimal usage" example at the
// top of this file. Stickers animate off millis() directly (a free-running clock since boot)
// since there's no other natural "since when" reference for a call site with no extra state
// of its own — see the Stickers comment further up for what this covers/doesn't. Pass
// EYE_COLORS_LEFT/EYE_COLORS_RIGHT (or, if you want per-expression colors — see the Colors
// comment above — eyesPlayer.colorsLeft/colorsRight) — when the studio's two eyes have
// identical colors, EYE_COLORS_RIGHT is just a reference to EYE_COLORS_LEFT (see above), so
// this always works whether or not the eyes actually differ.
template <typename T>
inline void eyesDrawEyePair(T& gfx, int16_t screenCx, int16_t screenCy, const LiveEye& left, const LiveEye& right, uint16_t bgColor,
                             const EyeColorSet& leftColors, const EyeColorSet& rightColors) {
  int16_t half = (int16_t)(left.distance / 2);
  unsigned long stickersMs = millis();
  const StickerDef* activeStickers = nullptr;
  uint8_t activeStickerCount = 0;
  if (eyesPlayer.playingAnimation) {
    activeStickers = eyesPlayer.animation.stickers;
    activeStickerCount = eyesPlayer.animation.stickerCount;
  } else if (eyesPlayer.expression) {
    activeStickers = eyesPlayer.expression->stickers;
    activeStickerCount = eyesPlayer.expression->stickerCount;
  }
  eyesDrawStickers(gfx, PROJECT_STICKERS, PROJECT_STICKERS_Count, STICKER_RASTER_ASSETS, STICKER_RASTER_ASSET_COUNT, STICKER_LAYER_BEHIND, stickersMs, screenCx, screenCy);
  eyesDrawStickers(gfx, activeStickers, activeStickerCount, STICKER_RASTER_ASSETS, STICKER_RASTER_ASSET_COUNT, STICKER_LAYER_BEHIND, stickersMs, screenCx, screenCy);
  eyesDrawEye(gfx, screenCx - half, screenCy, left, false, bgColor, leftColors);
  eyesDrawEye(gfx, screenCx + half, screenCy, right, true, bgColor, rightColors);
  eyesDrawStickers(gfx, PROJECT_STICKERS, PROJECT_STICKERS_Count, STICKER_RASTER_ASSETS, STICKER_RASTER_ASSET_COUNT, STICKER_LAYER_FRONT, stickersMs, screenCx, screenCy);
  eyesDrawStickers(gfx, activeStickers, activeStickerCount, STICKER_RASTER_ASSETS, STICKER_RASTER_ASSET_COUNT, STICKER_LAYER_FRONT, stickersMs, screenCx, screenCy);
}

// Single-LiveEye convenience overload — draws both eyes mirrored from one shared pose (the
// original contract, kept byte-for-byte compatible for every existing sketch/example calling
// it this way). Prefer the two-LiveEye overload above (with UpdateEyes()/UpdateEyesRight())
// when playing an animation that authored real Left Eye/Right Eye track divergence.
template <typename T>
inline void eyesDrawEyePair(T& gfx, int16_t screenCx, int16_t screenCy, const LiveEye& e, uint16_t bgColor,
                             const EyeColorSet& leftColors, const EyeColorSet& rightColors) {
  eyesDrawEyePair(gfx, screenCx, screenCy, e, e, bgColor, leftColors, rightColors);
}

// ---- Optional: flicker-free buffered display for Adafruit_GC9A01A. Only defined if ----
// that library is actually installed (checked via __has_include), so this header never
// forces the dependency on projects using TFT_eSPI/LovyanGFX/etc. — pass your own
// sprite/canvas type as T to eyesDrawEyePair() instead in that case.
#if __has_include(<Adafruit_GC9A01A.h>)
#include <Adafruit_GC9A01A.h>
class EyesBufferedDisplay : public Adafruit_GC9A01A {
public:
  using Adafruit_GC9A01A::Adafruit_GC9A01A;
  ~EyesBufferedDisplay() { delete canvas; }

  void begin(uint32_t freq = 0) {
    Adafruit_GC9A01A::begin(freq);
    canvas = new GFXcanvas16(width(), height());
  }

  // The offscreen canvas is a single ~(width*height*2)-byte heap allocation (e.g. ~112KB
  // for 240x240) made in begin() — check this before drawing. Every draw call below is a
  // null-pointer dereference (instant crash) if the allocation failed, so on constrained
  // boards, check this and fall back / halt with a clear message rather than crash blind.
  bool canvasReady() const { return canvas != nullptr && canvas->getBuffer() != nullptr; }

  void fillScreen(uint16_t color) { canvas->fillScreen(color); }
  void fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
    canvas->fillRoundRect(x, y, w, h, r, color);
  }
  void fillCircle(int16_t x, int16_t y, int16_t r, uint16_t color) { canvas->fillCircle(x, y, r, color); }
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) { canvas->fillRect(x, y, w, h, color); }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) { canvas->drawFastHLine(x, y, w, color); }
  // eyesFillEyelid() fills each eyelid column-by-column via drawFastVLine — without this
  // override those calls fall through to Adafruit_SPITFT's own drawFastVLine, which writes
  // straight to the live panel (unbuffered) instead of the offscreen canvas, so the eyelids
  // flash directly onto the screen for an instant before present() overwrites them with the
  // correct buffered frame. That was the flicker.
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) { canvas->drawFastVLine(x, y, h, color); }
  // Same reasoning as drawFastVLine above — eyesDrawStickerRaster()/eyesDrawSticker_Rain()
  // (stickers) call drawPixel()/drawLine() directly, which would otherwise fall through to
  // Adafruit_SPITFT's own unbuffered versions and flicker straight onto the live panel.
  void drawPixel(int16_t x, int16_t y, uint16_t color) { canvas->drawPixel(x, y, color); }
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) { canvas->drawLine(x0, y0, x1, y1, color); }
  // Same reasoning again — eyesDrawSticker_ExpandingCircles() calls drawCircle() (stroked,
  // not filled) directly.
  void drawCircle(int16_t x, int16_t y, int16_t r, uint16_t color) { canvas->drawCircle(x, y, r, color); }

  // Blit the finished frame to the panel in a single windowed SPI burst.
  void present() { drawRGBBitmap(0, 0, canvas->getBuffer(), width(), height()); }

private:
  GFXcanvas16* canvas = nullptr;
};
#endif // __has_include(<Adafruit_GC9A01A.h>)

#endif // EYES_EYE_PLAYER_H
`

// Lists every identifier SetExpression()/PlayAnimation() actually accept, so you don't have
// to go hunting through the generated data below to find the right name.
function exportQuickReference(project: Project): string {
  const singleExpressions = project.expressions.filter((e) => !expressionShapeDiverges(e))
  const divergedExpressions = project.expressions.filter((e) => expressionShapeDiverges(e))

  const lines: string[] = []
  lines.push('// ---- Quick Reference --------------------------------------------------------')
  lines.push('// Everything you can pass to PlayAnimation(...) / SetExpression(...) below.')
  lines.push('//')
  if (project.animations.length > 0) {
    lines.push('// Animations:')
    for (const a of project.animations) lines.push(`//   PlayAnimation(Anim_${toIdentifier(a.name)});`)
  } else {
    lines.push('// Animations: (this project has none yet)')
  }
  lines.push('//')
  if (singleExpressions.length > 0) {
    lines.push('// Expressions:')
    for (const e of singleExpressions) lines.push(`//   SetExpression(Expr_${toIdentifier(e.name)});`)
  } else {
    lines.push('// Expressions: (this project has none yet)')
  }
  if (divergedExpressions.length > 0) {
    lines.push('//')
    lines.push('// These expressions have different left/right eye shapes, so they export as a pair of')
    lines.push('// constants instead of one — SetExpression() needs a single shared pose, so draw these')
    lines.push('// two halves yourself with eyesDrawEye() instead:')
    for (const e of divergedExpressions) {
      const ident = toIdentifier(e.name)
      lines.push(`//   Expr_${ident}_L, Expr_${ident}_R`)
    }
  }
  return lines.join('\n')
}

// Opt-in ready-to-flash example: starts on the project's first animation, then cycles
// through every expression that has one shared left/right shape a few seconds apart.
// Guarded behind #ifdef EYES_ENABLE_DEMO so it only compiles in (and only then needs the
// TFT_* pin macros) when you actually want it — left off by default so it never collides
// with your own setup()/loop(). All that's specific to *this* project is which Anim_ and
// Expr_ constants get called — SetExpression()/PlayAnimation()/UpdateEyes() do all the work,
// so swapping in a different expression or animation is exactly one line, anywhere.
function exportDemo(project: Project): string {
  const idleAnim = project.animations[0]
  const idleIdent = idleAnim ? toIdentifier(idleAnim.name) : null
  const hasIdle = idleIdent !== null

  // Expressions with a diverged Eye Target: Left/Right shape export as two constants
  // (Expr_X_L / Expr_X_R) instead of one — SetExpression() needs a single shared pose, so
  // those are left out of the auto-cycle below (still fully usable by hand, via eyesDrawEye()
  // directly — see the Quick Reference above).
  const demoExpressions = project.expressions.filter((e) => !expressionShapeDiverges(e))
  const hasExpressions = demoExpressions.length > 0

  const HOLD_MS = 2500

  const lines: string[] = []
  lines.push('// ---- Example (opt-in) --------------------------------------------------------')
  lines.push('// Define EYES_ENABLE_DEMO and the five TFT_* pin macros before #include "eyes.h" to get')
  lines.push('// a ready-to-flash sketch below — no other code needed. Example:')
  lines.push('//')
  lines.push('//   #define EYES_ENABLE_DEMO')
  lines.push('//   #define TFT_CS   2')
  lines.push('//   #define TFT_DC   4')
  lines.push('//   #define TFT_RST  5')
  lines.push('//   #define TFT_SCLK 6')
  lines.push('//   #define TFT_MOSI 7')
  lines.push('//   #include <SPI.h>')
  lines.push('//   #include <Adafruit_GC9A01A.h>')
  lines.push('//   #include "eyes.h"')
  lines.push('//')
  lines.push("// Leave EYES_ENABLE_DEMO undefined and write your own setup()/loop() instead — that's")
  lines.push('// the whole point of SetExpression()/PlayAnimation()/UpdateEyes() above: your sketch only')
  lines.push('// needs to be this short (see "Minimal usage" at the top of this file for the full copy-')
  lines.push('// paste version).')

  if (!hasIdle && !hasExpressions) {
    lines.push('//')
    lines.push('// This project has no animations and no single-shape expressions to demo yet — add one')
    lines.push('// in the studio and re-export to get a ready-to-flash EYES_ENABLE_DEMO sketch.')
    return lines.join('\n')
  }

  lines.push('#ifdef EYES_ENABLE_DEMO')
  lines.push('')
  lines.push('// ---- Initialization -----------------------------------------------------------')
  lines.push('EyesBufferedDisplay tft(TFT_CS, TFT_DC, TFT_RST);')
  lines.push('')

  if (hasExpressions) {
    lines.push('// ---- Expression control ---------------------------------------------------------')
    lines.push('// Cycles through every expression a few seconds apart, purely to show them off.')
    lines.push('// Replace this timer with your own trigger — a button, a sensor, a serial command,')
    lines.push('// anything — that calls SetExpression() whenever you actually want the eyes to change.')
    lines.push(`const EyeExpression* const demoExpressions[] = { ${demoExpressions.map((e) => `&Expr_${toIdentifier(e.name)}`).join(', ')} };`)
    lines.push(`const char* const demoExpressionNames[] = { ${demoExpressions.map((e) => JSON.stringify(e.name)).join(', ')} };`)
    lines.push(`const int demoExpressionCount = ${demoExpressions.length};`)
    lines.push('int demoExprIndex = -1;')
    lines.push('unsigned long demoExprCycleStart = 0;')
    lines.push('')
    lines.push('void demoCycleExpressions() {')
    lines.push(`  if (millis() - demoExprCycleStart < ${HOLD_MS}) return;`)
    lines.push('  demoExprCycleStart = millis();')
    lines.push('  demoExprIndex = (demoExprIndex + 1) % demoExpressionCount;')
    lines.push('  Serial.print("Expression: ");')
    lines.push('  Serial.println(demoExpressionNames[demoExprIndex]);')
    lines.push('  SetExpression(*demoExpressions[demoExprIndex]);')
    lines.push('}')
    lines.push('')
  }

  if (hasIdle) {
    lines.push('// ---- Animation control ---------------------------------------------------------')
    lines.push(`// Starts the eyes off playing "${idleAnim!.name}" as an idle filler below. Call`)
    lines.push('// PlayAnimation(Anim_Whatever) any time you want to switch to a different animation —')
    lines.push('// see the Quick Reference above for every name this project exports.')
    lines.push('')
  }

  lines.push('// ---- Main update loop ---------------------------------------------------------')
  lines.push('void setup() {')
  lines.push('  Serial.begin(115200);')
  lines.push('  SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);')
  lines.push('  tft.begin();')
  lines.push('  tft.setRotation(0);')
  if (hasIdle) {
    lines.push(`  PlayAnimation(Anim_${idleIdent});`)
  } else {
    lines.push(`  SetExpression(Expr_${toIdentifier(demoExpressions[0].name)});`)
  }
  if (hasExpressions) lines.push('  demoExprCycleStart = millis();')
  lines.push('}')
  lines.push('')
  lines.push('void loop() {')
  if (hasExpressions) {
    lines.push('  demoCycleExpressions();')
    lines.push('')
  }
  lines.push('  LiveEye live = UpdateEyes();')
  lines.push('  tft.fillScreen(EYE_COLOR_BACKGROUND);')
  lines.push(
    "  eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND, eyesPlayer.colorsLeft, eyesPlayer.colorsRight);  // also draws this project's/the active expression's/animation's stickers, and the active expression's own colors"
  )
  lines.push('  tft.present();')
  lines.push('  delay(EYE_FRAME_DELAY_MS);')
  lines.push('}')
  lines.push('')
  lines.push('#endif // EYES_ENABLE_DEMO')

  return lines.join('\n')
}

export function generateCppHeader(project: Project): string {
  const guard = `EYES_EYE_ANIMATIONS_${toIdentifier(project.name).toUpperCase() || 'PROJECT'}_H`
  // Computed once up front: builds the cross-scope raster-asset table (project + every
  // expression + every animation) so exportAnimation()/exportExpression() below can each emit
  // their own sticker array against the same shared STICKER_RASTER_ASSETS table instead of
  // duplicating pixel data per scope — see exportStickers()'s own comment.
  const stickersExport = exportStickers(project)
  const header = `/*
 * Generated by Eyes Eye Studio — do not hand-edit, re-export instead.
 * Project: ${project.name}
 * Generated: ${new Date().toISOString()}
 *
 * Field order in EyeFrame matches the studio's EyeParams model:
 *   width, height, radius, rotation, distance, irisWidth, irisHeight, pupilWidth,
 *   pupilHeight, pupilX, pupilY, pupilRotation, upperEyelid, lowerEyelid, upperEyelidTilt,
 *   lowerEyelidTilt, upperEyelidCurvature, lowerEyelidCurvature, highlightX, highlightY,
 *   highlightSize, durationMs, easing, bezierX1, bezierY1, bezierX2, bezierY2, pupilShape,
 *   pupilCustomShapeIndex
 * (bezier fields only matter when easing == EYE_EASE_BEZIER, scaled 0-100)
 *
 * Pupil X/Y can reach +-100 (the pupil's center can travel all the way to the eye's own
 * edge) and Pupil Rotation spins the pupil 0-360deg independent of the eye's own rotation.
 * Both are clipped to the eye's silhouette (eyesFillEllipseInEye()/eyesFillPolygonInEye()
 * below), so the pupil never paints outside the eye no matter how far it's pushed or
 * rotated — matching the studio preview, which gets the same clipping for free from its
 * canvas clip path.
 *
 * Pupil Shape (EyePupilShape, see "Pupil Shapes" further down) picks what outline the pupil
 * draws as: an ellipse (circle/oval — the default) or one of heart/star/diamond/square/
 * triangle/a custom SVG import, each a fixed point table filled via eyesFillPolygonInEye().
 * It isn't numerically interpolatable, so a keyframe transition between two different shapes
 * snaps at the transition's midpoint rather than blending (see eyesLerpFrame()/eyesLerpLive()
 * below) — everything else about the pupil (size, position, rotation) keeps animating
 * smoothly through that snap exactly as it always has.
 *
 * Eyelid Tilt (-45..45deg) shears each lid's covering edge independently of the other; Eyelid
 * Curvature (-100..100) controls how pronounced its soft rounded edge is: 0 is flat/neutral,
 * negative values curve the lid inward, positive values curve it outward, blending smoothly
 * into the eye's own rounded corners like a border-radius either way. The curve is a
 * closed-form quartic taper;
 * eyesFillEyelid() below evaluates the exact same
 * yCutoff(x) formula the studio's preview draws, so the two always render identically.
 *
 * Eye colors are exported below as RGB565 #defines (sclera/iris/pupil/highlight/shadow/
 * glow/border) matching the studio's Color panel. EYE_COLOR_BORDER already has Border
 * Opacity pre-blended into it, and the pupil color already has Pupil Opacity pre-blended
 * against the iris (RGB565 has no alpha channel) — see eyesDrawEye() below.
 *
 * EYE_TARGET_FPS / EYE_FRAME_DELAY_MS match the Display FPS set in the studio's Display
 * panel. eyesPlayAnimation() itself is time-based (millis()-driven), so it always plays at
 * the correct speed regardless of loop() rate — EYE_FRAME_DELAY_MS only paces how often a
 * frame is drawn/presented, i.e. the actual "frames per second" on the panel.
 *
 * This file is plug-and-play: it also bundles the "player" (easing, interpolation, and
 * drawing) as inline functions, so you don't need a separate companion file — including a
 * high-level SetExpression()/PlayAnimation()/UpdateEyes() API, so changing what's on screen
 * is exactly one line of code, from anywhere in your own sketch. Minimal usage:
 *
 *   #include <SPI.h>
 *   #include <Adafruit_GC9A01A.h>  // <- put both of these BEFORE the line below, in your
 *   #include "eyes.h"              //    .ino itself (Arduino's auto-library-discovery only
 *                                  //     scans your .ino's own #include lines, not ones
 *                                  //     nested inside a conditional #if in an included
 *                                  //     header — so these explicit lines are what make
 *                                  //     EyesBufferedDisplay below actually get defined;
 *                                  //     omit them and it's silently skipped instead of
 *                                  //     failing to compile)
 *
 *   #define TFT_CS   2   // <- your own wiring
 *   #define TFT_DC   4
 *   #define TFT_RST  5
 *   #define TFT_SCLK 6
 *   #define TFT_MOSI 7
 *
 *   EyesBufferedDisplay tft(TFT_CS, TFT_DC, TFT_RST);  // flicker-free buffered display
 *
 *   void setup() {
 *     SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);  // required on boards with no fixed
 *                                                  // default SPI pins (e.g. ESP32-C6) —
 *                                                  // harmless to include even if yours does
 *     tft.begin();
 *     tft.setRotation(0);
 *     PlayAnimation(Anim_Idle);        // or: SetExpression(Expr_Neutral); — substitute
 *                                      // whichever of your own Anim_ or Expr_ names actually
 *                                      // exist; see "Quick Reference" further down
 *   }
 *
 *   void loop() {
 *     LiveEye live = UpdateEyes();
 *     tft.fillScreen(EYE_COLOR_BACKGROUND);
 *     eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND, eyesPlayer.colorsLeft, eyesPlayer.colorsRight);
 *     tft.present();
 *     delay(EYE_FRAME_DELAY_MS);  // paces drawing to EYE_TARGET_FPS
 *   }
 *
 * That's the whole sketch — change what's showing from anywhere else in your code (a button
 * handler, a sensor reading, a serial command) with one line:
 *
 *   SetExpression(Expr_Happy);
 *   PlayAnimation(Anim_Blink);
 *
 * See "Quick Reference" further down for every Expr_ and Anim_ name this project exports,
 * and "Example (opt-in)" at the very bottom for a complete ready-to-flash sketch using them.
 *
 * eyesPlayer.colorsLeft/colorsRight always hold whichever color palette should currently be
 * showing: EYE_COLORS_LEFT/RIGHT (the project's shared base) until the first SetExpression()
 * call, then that expression's own colors from then on (expressions can have their own colors,
 * distinct from the shared base — see "Colors" further down) — PlayAnimation() never changes
 * them, matching the studio (Animate mode always shows the project's currently-active color
 * theme, never a per-animation one, since animations/keyframes don't carry colors at all).
 * When an expression's own left/right colors are identical, colorsRight after SetExpression()
 * is just a copy of colorsLeft — same "shared if identical" idea EYE_COLORS_LEFT/RIGHT use.
 * Static poses saved with a left/right shape divergence export as two constants instead of
 * one, e.g. Expr_Blink_L / Expr_Blink_R rather than a plain Expr_Blink — SetExpression() needs
 * a single shared pose, so those two aren't included in it; draw them yourself with
 * eyesDrawEye() per eye instead (their own Expr_Blink_ColorsLeft/Right and
 * Expr_Blink_Stickers/_Stickers_Count still export normally for this manual path).
 *
 * Want lower-level control? eyesPlayAnimation(Anim_X, ...) and eyesLerpFrame(*Expr_X.frame,
 * ...) are both still here and work exactly as before — SetExpression()/PlayAnimation()/
 * UpdateEyes() are a convenience layer built on top of them, not a replacement. (Expr_X is an
 * EyeExpression now, not a bare EyeFrame — see "Colors"/"Stickers" further down for why —
 * .frame is the pose eyesLerpFrame()/eyesDrawEye() themselves want.)
 *
 * If this project has any Stickers (studio's Stickers tab), eyesDrawEyePair() above already
 * draws them too — no separate call needed, and this includes Project-wide stickers, the
 * currently-active Expression's own stickers, and the currently-playing Animation's own
 * stickers, merged automatically — see "Stickers" further down for exactly what exports.
 *
 * *** NOT EXPORTED: Idle mode / Personality ***
 * The studio's "Idle" playback mode runs a procedural behavior engine (gaze drift, blink
 * timing, micro-movement, breathing) driven by the 9 Personality sliders (Blink Frequency,
 * Curiosity, Energy, Confidence, Sleepiness, Movement Speed, Random Eye Drift, Micro
 * Movement, Idle Delay) plus Global Timing's Breathing Amount. None of that behavior is in
 * this file — this export only ever gives you fixed Animations/Expressions, never the
 * randomized/continuous procedural motion Idle mode previews. There's no static
 * Anim_/Expr_ equivalent to fall back to automatically, so nothing is substituted in its
 * place; if your firmware needs idle-style behavior, either build an Animation in the studio
 * that approximates it (a looping blink/drift cycle) and PlayAnimation() that, or write your
 * own timer-driven logic calling SetExpression()/eyesLerpFrame() directly. This is a real,
 * intentionally-scoped gap (a full behavior-engine port is a substantially different task
 * from the rendering/data export this file does), not an oversight.
 *
 * Using TFT_eSPI/LovyanGFX instead of Adafruit_GC9A01A? Skip that #include — pass your own
 * sprite/canvas object as the template type to eyesDrawEyePair()/eyesDrawEye() instead;
 * they just need drawFastHLine/drawFastVLine/fillCircle methods with the usual Adafruit_GFX
 * signatures. If your object is a buffered/offscreen canvas wrapper, make sure ALL THREE are
 * overridden to draw into the buffer — a method left un-overridden silently falls through to
 * a live/unbuffered draw straight to the panel, which shows up as flicker (only the eyelids
 * needing drawFastVLine, so this is easy to miss if you copy an older buffered-wrapper class).
 */
#ifndef ${guard}
#define ${guard}

#include <stdint.h>
#if defined(__AVR__)
#include <avr/pgmspace.h> // only classic AVR boards need this; ESP32/ESP8266/SAMD/RP2040 cores already define PROGMEM
#endif

${exportQuickReference(project)}

enum EyeEasing : uint8_t {
  EYE_EASE_LINEAR = 0,
  EYE_EASE_IN,
  EYE_EASE_OUT,
  EYE_EASE_INOUT,
  EYE_EASE_BOUNCE,
  EYE_EASE_ELASTIC,
  EYE_EASE_BEZIER
};

struct EyeFrame {
  uint8_t width, height, radius;
  int8_t rotation;
  uint8_t distance;
  uint8_t irisWidth, irisHeight;
  uint8_t pupilWidth, pupilHeight;
  int8_t pupilX, pupilY;
  uint16_t pupilRotation; // degrees, 0-360
  uint8_t upperEyelid, lowerEyelid;
  int8_t upperEyelidTilt, lowerEyelidTilt; // degrees, -45..45
  int8_t upperEyelidCurvature, lowerEyelidCurvature; // -100 (inward) to 100 (outward), 0 = flat
  int8_t highlightX, highlightY;
  uint8_t highlightSize;
  uint16_t durationMs;
  uint8_t easing;
  int8_t bezierX1, bezierY1, bezierX2, bezierY2;
  uint8_t pupilShape; // an EyePupilShape value — see the enum + shape tables below
  uint8_t pupilCustomShapeIndex; // index into PUPIL_CUSTOM_SHAPES, only meaningful when pupilShape == EYE_PUPIL_SHAPE_CUSTOM
};

// One eye's full color palette (RGB565) plus its border thickness — the studio's Eye
// Target: Left/Right editing lets the two eyes end up with different palettes (and
// different border widths, via Visual Reference per-eye overrides), so this is a value
// passed to the drawing functions rather than fixed macros. sclera/iris/pupil/highlight/
// shadow/glow/border are the raw or opacity-blended colors (see colorSetLiteral() in the
// studio's cppExport.ts); scleraTop/Bottom, irisLight/Dark, and highlightBlend are additional
// precomputed values the gradient/glow/shadow drawing routines below use, approximating what
// the studio preview renders as true Canvas 2D gradients/blur (Adafruit_GFX has neither).
struct EyeColorSet {
  uint16_t sclera, iris, pupil, highlight, shadow, glow, border;
  uint8_t borderWidth; // ring thickness in pixels
  uint8_t shadowIntensity, glowIntensity; // 0-100, straight from the Color panel
  uint16_t scleraTop, scleraBottom; // sclera gradient endpoints
  uint16_t irisLight, irisDark; // iris radial-gradient endpoints (iris itself is the midpoint)
  uint16_t highlightBlend; // highlight pre-blended 92% over the pupil, matching the studio's fixed-alpha look
};

// ---- Colors -----------------------------------------------------------

${exportColors(project)}

// ---- Timing -------------------------------------------------------------

${exportTiming(project.display)}

// ---- Pupil Shapes -------------------------------------------------------

${exportPupilShapes(project)}

// ---- Stickers -------------------------------------------------------------
//
// Every scope exports: Project.stickers (PROJECT_STICKERS, always visible), and each
// Expression/Animation's own stickers (visible only while that expression/animation is
// active — bundled into its EyeExpression/EyeAnimation below). All 14 built-ins draw on real
// hardware. No extra code needed to draw any of this — eyesDrawEyePair() (see the Player
// section) already merges and draws whichever stickers are currently active automatically,
// behind-layer before the eyes and front-layer after, every time it's called.

${stickersExport.code}

// One playable animation, bundled into a single value so PlayAnimation() below only needs
// one argument instead of the several eyesPlayAnimation()/eyesDrawStickers() themselves need.
// stickers/stickerCount are this animation's own Stickers-tab stickers (visible only while
// it's playing — see the Stickers comment above); an animation with none still gets a valid
// (empty, count 0) array here, never a null pointer.
// framesRight is only non-null for an animation that actually authored Left Eye/Right Eye
// track keyframes in the studio (Timeline eye-target divergence) — nullptr means "mirrors
// frames", the same convention EYE_COLORS_LEFT/RIGHT's "shared reference when identical" idiom
// uses. frames/framesRight always have the same \`count\` and matching per-frame durationMs
// (they're baked from the same breakpoints — see the studio's bakeAnimationFrames()), so a
// single frameIndex/elapsed-time computation drives both arrays in lockstep.
struct EyeAnimation {
  const EyeFrame* frames;
  uint16_t count;
  bool loop;
  const EyeFrame* framesRight;
  const StickerDef* stickers;
  uint8_t stickerCount;
};

// One static expression, bundled the same way EyeAnimation is: SetExpression(Expr_X) switches
// pose, color palette, AND stickers all at once, matching the studio (applying an expression
// there can change all three — see applyExpression()/saveExpression() in the studio's
// state/store.ts). Only emitted for expressions whose left/right *shape* doesn't diverge —
// see exportExpression()'s own comment in the studio's cppExport.ts for the diverged case.
struct EyeExpression {
  const EyeFrame* frame;
  const EyeColorSet* colorsLeft;
  const EyeColorSet* colorsRight;
  const StickerDef* stickers;
  uint8_t stickerCount;
};

// ---- Player (easing, interpolation, drawing, playback) -----------------------

${PLAYER_CODE}

// ---- Animations -----------------------------------------------------------

${project.animations.map((a) => exportAnimation(a, project.customPupilShapes, stickersExport.assetsById, stickersExport.rasterIndexByAssetId)).join('\n\n')}

// ---- Expressions (static poses) -------------------------------------------

${project.expressions
  .map((e) => exportExpression(e, project.customPupilShapes, project.display.backgroundColor, stickersExport.assetsById, stickersExport.rasterIndexByAssetId))
  .join('\n\n')}

${exportDemo(project)}

#endif // ${guard}
`
  return header
}
