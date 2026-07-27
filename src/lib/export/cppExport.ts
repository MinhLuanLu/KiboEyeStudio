import type { Animation, CustomPupilShape, EasingType, Expression, EyeColors, EyeParams, Project, PupilShapeId } from '@/types'
import {
  clampFps,
  expressionLeftParams,
  expressionRightParams,
  expressionShapeDiverges,
  leftEyeColors,
  rightEyeColors
} from '@/types'
import { hexToRgb565, mixColors } from '@/lib/color'
import { PUPIL_SHAPE_POLYGONS } from '@/renderer/pupilShapes'

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

// Emits the raw keyframe array plus its count/loop flag (for anyone who wants direct/
// low-level access) AND a single `EyeAnimation` wrapper bundling all three — that wrapper
// is what PlayAnimation() below takes, so playing an animation is just `PlayAnimation(Anim_X)`
// instead of threading three separate globals through eyesPlayAnimation() by hand.
function exportAnimation(anim: Animation, customShapes: CustomPupilShape[]): string {
  const ident = toIdentifier(anim.name)
  const lines = anim.keyframes.map((k) => eyeFrameLiteral(k.params, k.duration, k.easing, customShapes, k.customBezier))
  return [
    `// ${anim.name}${anim.loop ? ' (loops)' : ' (plays once)'}`,
    `const EyeFrame Anim_${ident}_frames[] PROGMEM = {`,
    lines.join(',\n'),
    `};`,
    `const uint16_t Anim_${ident}_count = ${anim.keyframes.length};`,
    `const bool Anim_${ident}_loop = ${anim.loop ? 'true' : 'false'};`,
    `const EyeAnimation Anim_${ident} = { Anim_${ident}_frames, Anim_${ident}_count, Anim_${ident}_loop };`
  ].join('\n')
}

// Expressions carry independent left/right shape only when they actually differ (Eye
// Target: Left/Right editing at Save time) — otherwise a single shared constant is emitted,
// exactly as before this feature existed, so existing (non-diverged) expressions export
// identically to how they always have.
function exportExpression(expr: Expression, customShapes: CustomPupilShape[]): string {
  const ident = toIdentifier(expr.name)
  if (!expressionShapeDiverges(expr)) {
    return `const EyeFrame Expr_${ident} PROGMEM = \n${eyeFrameLiteral(expr.params, 0, 'linear', customShapes)};`
  }
  return [
    `// "${expr.name}" has different left/right eye shapes`,
    `const EyeFrame Expr_${ident}_L PROGMEM = \n${eyeFrameLiteral(expressionLeftParams(expr), 0, 'linear', customShapes)};`,
    `const EyeFrame Expr_${ident}_R PROGMEM = \n${eyeFrameLiteral(expressionRightParams(expr), 0, 'linear', customShapes)};`
  ].join('\n')
}

function toRgb565Hex(hex: string): string {
  return `0x${hexToRgb565(hex).toString(16).toUpperCase().padStart(4, '0')}`
}

// RGB565 has no alpha channel, so Border Opacity and Pupil Opacity are both pre-blended here
// into single flat colors: border against the display background (matching the ring trick
// eyesDrawEye uses below) — 0% -> exactly the background color (invisible ring), 100% -> the
// pure border color; pupil against the iris (what it visually sits on top of) — 0% -> the
// pupil becomes invisible against the iris, 100% -> the pure pupil color, same idea Highlight
// uses in the studio preview (drawn at a fixed 92% alpha over whatever's beneath it).
function colorSetLiteral(colors: EyeColors, backgroundColor: string): string {
  const borderBlend = mixColors(backgroundColor, colors.border, colors.borderOpacity / 100)
  const pupilBlend = mixColors(colors.iris, colors.pupil, colors.pupilOpacity / 100)
  const fields = [
    toRgb565Hex(colors.sclera),
    toRgb565Hex(colors.iris),
    toRgb565Hex(pupilBlend),
    toRgb565Hex(colors.highlight),
    toRgb565Hex(colors.shadow),
    toRgb565Hex(colors.glow),
    toRgb565Hex(borderBlend),
    Math.round(colors.borderWidth)
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
    `// sclera, iris, pupil, highlight, shadow, glow, border, borderWidth (border and pupil`,
    `// already have Border/Pupil Opacity pre-blended in — RGB565 has no alpha channel).`,
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
  if (points) {
    eyesFillPolygonInEye(gfx, eyeCx, eyeCy, eyeW, eyeH, eyeRadius, ecx, ecy, rx, ry, rotationDeg, points, count, color);
  } else {
    eyesFillEllipseInEye(gfx, eyeCx, eyeCy, eyeW, eyeH, eyeRadius, ecx, ecy, rx, ry, rotationDeg, color);
  }
}

// Fills one eyelid: a background-colored region from the eye's own top/bottom edge down to
// a cutoff line that combines a linear tilt (shear) and a symmetric curvature offset —
//   taper(x)  = (1 - (x/halfW)^2)^2      for |x| <= halfW, else 0
//   yCutoff(x) = yBase + slope*x + curveOffset * taper(x)
// curvaturePct ranges -100 (curved inward) to 100 (curved outward) through 0 (flat/neutral):
// at x=0 (lid center) taper is 1, so a positive curveOffset bulges the center further into
// the eye (more coverage there than at the flat sides) while a negative one pulls it back
// toward less coverage instead. The taper is a border-radius-style bump, not a plain
// parabola: at x=±halfW (the eye's own flat-side edge) it reaches 0 WITH zero slope, so the
// curve blends smoothly into the flat sides — and from there into the eye's rounded corners
// — with no kink, at any eye width/height/radius or curvature value.
// This is mathematically identical to what the studio's preview draws: it samples this exact
// formula one point per pixel column and connects the dots (see the comment above the eyelid
// block in drawEye.ts). Filled column-by-column (drawFastVLine) since the cutoff is
// naturally a function of x, not y, which also makes the curve inherently smooth — no
// per-pixel corner cases, so no sharp edges regardless of how extreme the tilt/curvature
// values are.
template <typename T>
inline void eyesFillEyelid(T& gfx, int16_t cx, int16_t cy, int16_t w, int16_t h, bool isUpper,
                            float coveragePct, float tiltDeg, float curvaturePct, uint16_t color) {
  if (coveragePct <= 0) return;
  float halfW = w / 2.0f;
  float coverage = (coveragePct / 100.0f) * h;
  float yBase = isUpper ? (-h / 2.0f + coverage) : (h / 2.0f - coverage);
  float curveOffset = (curvaturePct / 100.0f) * h * 0.5f;
  float slope = tanf(tiltDeg * (float)PI / 180.0f);
  int16_t edgeMargin = (int16_t)ceilf(h / 2.0f) + 2; // a couple px past the eye's own top/bottom, safely covers the flat side

  int16_t halfWi = (int16_t)ceilf(halfW);
  for (int16_t dx = -halfWi; dx <= halfWi; dx++) {
    float u = halfW > 0.01f ? (float)dx / halfW : 0.0f;
    if (u > 1.0f) u = 1.0f;
    if (u < -1.0f) u = -1.0f;
    float t = 1.0f - u * u;
    float taper = t * t;
    float yCutoff = yBase + slope * (float)dx + curveOffset * taper;
    int16_t worldX = cx + dx;
    int16_t yTop, yBottom;
    if (isUpper) {
      yTop = cy - edgeMargin;
      yBottom = cy + (int16_t)roundf(yCutoff);
    } else {
      yTop = cy + (int16_t)roundf(yCutoff);
      yBottom = cy + edgeMargin;
    }
    if (yBottom < yTop) continue;
    gfx.drawFastVLine(worldX, yTop, yBottom - yTop + 1, color);
  }
}

// ---- Drawing — flat-color layered render: border -> sclera -> iris -> pupil -> highlight -> ----
// eyelids. \`T\` is a template (not \`Adafruit_GFX&\`) on purpose: fillRoundRect()/
// fillCircle() aren't virtual in Adafruit_GFX, so a buffered subclass like
// EyesBufferedDisplay below only gets called correctly when the concrete type is known at
// compile time. \`bgColor\` should match your Display panel's background so eyelids blend in.
// \`colors\` is passed in (not hardcoded macros) so the two eyes can use different palettes
// when Eye Target: Left/Right editing gave them different colors in the studio.
template <typename T>
inline void eyesDrawEye(T& gfx, int16_t cx, int16_t cy, const LiveEye& e, bool mirror, uint16_t bgColor, const EyeColorSet& colors) {
  int16_t w = (int16_t)e.width, h = (int16_t)e.height;
  int16_t radius = (int16_t)e.radius;

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

  eyesFillRoundedRect(gfx, cx, cy, w, h, radius, colors.sclera);

  int sign = mirror ? -1 : 1;
  int16_t px = cx + (int16_t)(sign * (e.pupilX / 100.0f) * (w / 2.0f));
  int16_t py = cy + (int16_t)((e.pupilY / 100.0f) * (h / 2.0f));

  int16_t irisRX = (int16_t)((e.irisWidth / 100.0f) * (w / 2.0f));
  int16_t irisRY = (int16_t)((e.irisHeight / 100.0f) * (h / 2.0f));
  int16_t pupilRX = (int16_t)((e.pupilWidth / 100.0f) * (w / 2.0f));
  int16_t pupilRY = (int16_t)((e.pupilHeight / 100.0f) * (h / 2.0f));

  // Both clipped to the eye's own silhouette (see eyesFillEllipseInEye) since Pupil X/Y can
  // now push the shared iris/pupil center out toward the eye's edge. The iris never rotates
  // (0deg) and stays a plain ellipse; the pupil uses its own independent Pupil Rotation and
  // whatever shape e.pupilShape selects — see eyesFillPupilShape() above.
  if (irisRX > 0 && irisRY > 0) eyesFillEllipseInEye(gfx, cx, cy, w, h, radius, px, py, irisRX, irisRY, 0.0f, colors.iris);
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
    gfx.fillCircle(hx, hy, hR, colors.highlight);
  }

  eyesFillEyelid(gfx, cx, cy, w, h, true, e.upperEyelid, e.upperEyelidTilt, e.upperEyelidCurvature, bgColor);
  eyesFillEyelid(gfx, cx, cy, w, h, false, e.lowerEyelid, e.lowerEyelidTilt, e.lowerEyelidCurvature, bgColor);
}

// Draws both eyes from one shared LiveEye pose (the common case: animations always play
// back mirrored). Pass EYE_COLORS_LEFT/EYE_COLORS_RIGHT — when the studio's two eyes have
// identical colors, EYE_COLORS_RIGHT is just a reference to EYE_COLORS_LEFT (see above), so
// this always works whether or not the eyes actually differ.
template <typename T>
inline void eyesDrawEyePair(T& gfx, int16_t screenCx, int16_t screenCy, const LiveEye& e, uint16_t bgColor,
                             const EyeColorSet& leftColors, const EyeColorSet& rightColors) {
  int16_t half = (int16_t)(e.distance / 2);
  eyesDrawEye(gfx, screenCx - half, screenCy, e, false, bgColor, leftColors);
  eyesDrawEye(gfx, screenCx + half, screenCy, e, true, bgColor, rightColors);
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
// convenience layer.
inline bool eyesPlayAnimation(const EyeAnimation& anim, unsigned long& startMillis, uint16_t& frameIndex, LiveEye& outLive) {
  return eyesPlayAnimation(anim.frames, anim.count, anim.loop, startMillis, frameIndex, outLive);
}

// ---- Easy player: SetExpression() / PlayAnimation() / UpdateEyes() -------------------
// The simplest way to drive the eyes. Call SetExpression()/PlayAnimation() any time you
// want to change what's showing — from a button press, sensor reading, timer, or serial
// command — then call UpdateEyes() once per loop() to advance and get the pose to draw.
// Switching expressions crossfades smoothly over EYES_BLEND_MS; switching (or restarting)
// an animation cuts over immediately, since the animation's own first keyframe already
// eases in on its own.
const unsigned long EYES_BLEND_MS = 250;

struct EyesPlayerState {
  bool playingAnimation;
  const EyeFrame* expression;
  EyeAnimation animation;
  unsigned long animStart;
  uint16_t frameIndex;
  LiveEye live;
  LiveEye blendFrom;
  unsigned long blendStart;
  bool blending;
};
static EyesPlayerState eyesPlayer = { false, nullptr, { nullptr, 0, false }, 0, 0, {}, {}, 0, false };

// Shows a static expression, crossfading smoothly from whatever's currently on screen —
// call it with any Expr_* constant, e.g. SetExpression(Expr_Happy).
inline void SetExpression(const EyeFrame& expression) {
  eyesPlayer.blendFrom = eyesPlayer.live;
  eyesPlayer.blendStart = millis();
  eyesPlayer.blending = true;
  eyesPlayer.playingAnimation = false;
  eyesPlayer.expression = &expression;
}

// Plays (or restarts) an animation from its first keyframe — call it with any Anim_*
// constant, e.g. PlayAnimation(Anim_Blink).
inline void PlayAnimation(const EyeAnimation& animation) {
  eyesPlayer.playingAnimation = true;
  eyesPlayer.animation = animation;
  eyesPlayer.animStart = millis();
  eyesPlayer.frameIndex = 0;
  eyesPlayer.blending = false;
}

// Advances whatever's currently playing and returns the pose to draw this frame. Call this
// once per loop(), after at least one SetExpression()/PlayAnimation() call in setup() —
// with neither ever called, there's nothing to show yet.
inline LiveEye UpdateEyes() {
  if (eyesPlayer.blending) {
    float t = (float)(millis() - eyesPlayer.blendStart) / (float)EYES_BLEND_MS;
    if (t >= 1.0f) { t = 1.0f; eyesPlayer.blending = false; }
    LiveEye target = eyesLerpFrame(*eyesPlayer.expression, *eyesPlayer.expression, 0);
    eyesPlayer.live = eyesLerpLive(eyesPlayer.blendFrom, target, t);
  } else if (eyesPlayer.playingAnimation) {
    eyesPlayAnimation(eyesPlayer.animation, eyesPlayer.animStart, eyesPlayer.frameIndex, eyesPlayer.live);
  } else if (eyesPlayer.expression) {
    eyesPlayer.live = eyesLerpFrame(*eyesPlayer.expression, *eyesPlayer.expression, 0);
  }
  return eyesPlayer.live;
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
    lines.push(`const EyeFrame* const demoExpressions[] = { ${demoExpressions.map((e) => `&Expr_${toIdentifier(e.name)}`).join(', ')} };`)
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
  lines.push('  eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND, EYE_COLORS_LEFT, EYE_COLORS_RIGHT);')
  lines.push('  tft.present();')
  lines.push('  delay(EYE_FRAME_DELAY_MS);')
  lines.push('}')
  lines.push('')
  lines.push('#endif // EYES_ENABLE_DEMO')

  return lines.join('\n')
}

export function generateCppHeader(project: Project): string {
  const guard = `EYES_EYE_ANIMATIONS_${toIdentifier(project.name).toUpperCase() || 'PROJECT'}_H`
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
 *     eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND, EYE_COLORS_LEFT, EYE_COLORS_RIGHT);
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
 * EYE_COLORS_LEFT/EYE_COLORS_RIGHT are always both defined -- pass both to eyesDrawEyePair()
 * every time. When the studio's two eyes have identical colors, EYE_COLORS_RIGHT is just a
 * reference to EYE_COLORS_LEFT (no duplicate data); when Eye Target: Left/Right editing gave
 * them different colors, both are real, distinct structs. Static poses saved with a
 * left/right shape divergence export as two constants instead of one, e.g. Expr_Blink_L /
 * Expr_Blink_R rather than a plain Expr_Blink — SetExpression() needs a single shared pose,
 * so those two aren't included in it; draw them yourself with eyesDrawEye() per eye instead.
 *
 * Want lower-level control? eyesPlayAnimation(Anim_X, ...) and eyesLerpFrame(Expr_X, ...)
 * are both still here and work exactly as before — SetExpression()/PlayAnimation()/
 * UpdateEyes() are a convenience layer built on top of them, not a replacement.
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
// passed to the drawing functions rather than fixed macros.
struct EyeColorSet {
  uint16_t sclera, iris, pupil, highlight, shadow, glow, border;
  uint8_t borderWidth; // ring thickness in pixels
};

// One playable animation, bundled into a single value so PlayAnimation() below only needs
// one argument instead of the three (frames, count, loop) eyesPlayAnimation() itself needs.
struct EyeAnimation {
  const EyeFrame* frames;
  uint16_t count;
  bool loop;
};

// ---- Colors -----------------------------------------------------------

${exportColors(project)}

// ---- Timing -------------------------------------------------------------

${exportTiming(project.display)}

// ---- Pupil Shapes -------------------------------------------------------

${exportPupilShapes(project)}

// ---- Player (easing, interpolation, drawing, playback) -----------------------

${PLAYER_CODE}

// ---- Animations -----------------------------------------------------------

${project.animations.map((a) => exportAnimation(a, project.customPupilShapes)).join('\n\n')}

// ---- Expressions (static poses) -------------------------------------------

${project.expressions.map((e) => exportExpression(e, project.customPupilShapes)).join('\n\n')}

${exportQuickReference(project)}

${exportDemo(project)}

#endif // ${guard}
`
  return header
}
