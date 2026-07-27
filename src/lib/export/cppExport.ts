import type { Animation, EasingType, Expression, EyeColors, EyeParams, Project } from '@/types'
import {
  clampFps,
  expressionLeftParams,
  expressionRightParams,
  expressionShapeDiverges,
  leftEyeColors,
  rightEyeColors
} from '@/types'
import { hexToRgb565, mixColors } from '@/lib/color'

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

function eyeFrameLiteral(params: EyeParams, durationMs: number, easing: EasingType, bezier?: [number, number, number, number]): string {
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
    Math.round(by2)
  ]
  return `  { ${fields.join(', ')} }`
}

function exportAnimation(anim: Animation): string {
  const ident = toIdentifier(anim.name)
  const lines = anim.keyframes.map((k) => eyeFrameLiteral(k.params, k.duration, k.easing, k.customBezier))
  return [
    `// ${anim.name}${anim.loop ? ' (loops)' : ' (plays once)'}`,
    `const EyeFrame Anim_${ident}[] PROGMEM = {`,
    lines.join(',\n'),
    `};`,
    `const uint16_t Anim_${ident}_count = ${anim.keyframes.length};`,
    `const bool Anim_${ident}_loop = ${anim.loop ? 'true' : 'false'};`
  ].join('\n')
}

// Expressions carry independent left/right shape only when they actually differ (Eye
// Target: Left/Right editing at Save time) — otherwise a single shared constant is emitted,
// exactly as before this feature existed, so existing (non-diverged) expressions export
// identically to how they always have.
function exportExpression(expr: Expression): string {
  const ident = toIdentifier(expr.name)
  if (!expressionShapeDiverges(expr)) {
    return `const EyeFrame Expr_${ident} PROGMEM = \n${eyeFrameLiteral(expr.params, 0, 'linear')};`
  }
  return [
    `// "${expr.name}" has different left/right eye shapes`,
    `const EyeFrame Expr_${ident}_L PROGMEM = \n${eyeFrameLiteral(expressionLeftParams(expr), 0, 'linear')};`,
    `const EyeFrame Expr_${ident}_R PROGMEM = \n${eyeFrameLiteral(expressionRightParams(expr), 0, 'linear')};`
  ].join('\n')
}

function toRgb565Hex(hex: string): string {
  return `0x${hexToRgb565(hex).toString(16).toUpperCase().padStart(4, '0')}`
}

// RGB565 has no alpha channel, so Border Opacity is pre-blended here into a single flat
// color against the display background (matching the ring trick eyesDrawEye uses below):
// 0% -> exactly the background color (invisible ring), 100% -> the pure border color.
function colorSetLiteral(colors: EyeColors, backgroundColor: string): string {
  const borderBlend = mixColors(backgroundColor, colors.border, colors.borderOpacity / 100)
  const fields = [
    toRgb565Hex(colors.sclera),
    toRgb565Hex(colors.iris),
    toRgb565Hex(colors.pupil),
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
    `// sclera, iris, pupil, highlight, shadow, glow, border, borderWidth (border already has`,
    `// Border Opacity pre-blended in — RGB565 has no alpha channel)`,
    `const EyeColorSet EYE_COLORS_LEFT = ${colorSetLiteral(left, display.backgroundColor)};`
  ]
  if (same) {
    lines.push(`const EyeColorSet& EYE_COLORS_RIGHT = EYE_COLORS_LEFT;  // identical to the left eye — shared, no duplicate data`)
  } else {
    lines.push(`const EyeColorSet EYE_COLORS_RIGHT = ${colorSetLiteral(right, display.backgroundColor)};`)
  }
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

// ---- Drawing — flat-color layered render: sclera -> iris -> pupil -> highlight -> ----
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
  // (0deg); the pupil uses its own independent Pupil Rotation.
  if (irisRX > 0 && irisRY > 0) eyesFillEllipseInEye(gfx, cx, cy, w, h, radius, px, py, irisRX, irisRY, 0.0f, colors.iris);
  if (pupilRX > 0 && pupilRY > 0) eyesFillEllipseInEye(gfx, cx, cy, w, h, radius, px, py, pupilRX, pupilRY, e.pupilRotation, colors.pupil);

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

// Opt-in ready-to-flash setup()/loop(): plays the project's first animation as an "idle"
// filler, then crossfades (eyesLerpFrame) through every expression that has one shared
// left/right shape, holding each briefly, then loops back to idle — the same demo pattern
// used to verify the studio's own test sketches. Guarded behind #ifdef EYES_ENABLE_DEMO so
// it only compiles in (and only then needs the TFT_* pin macros) when the user actually
// wants it; left off by default so it never collides with a hand-written setup()/loop().
// All identifiers are prefixed eyesDemo* to avoid clashing with the user's own globals even
// when both are compiled together.
function exportDemo(project: Project): string {
  const idleAnim = project.animations[0]
  const idleIdent = idleAnim ? toIdentifier(idleAnim.name) : null
  const hasIdle = idleIdent !== null

  // Expressions with a diverged Eye Target: Left/Right shape export as two constants
  // (Expr_X_L / Expr_X_R) instead of one — eyesDrawEyePair() needs a single shared LiveEye
  // pose per frame, so those are left out of the auto-demo cycle (still fully usable by
  // hand, just not auto-cycled here).
  const demoExpressions = project.expressions.filter((e) => !expressionShapeDiverges(e))
  const hasExpressions = demoExpressions.length > 0
  const skippedDiverged = project.expressions.length - demoExpressions.length

  const TRANSITION_MS = 400
  const HOLD_MS = 2000
  const IDLE_MS = 3000

  if (!hasIdle && !hasExpressions) {
    return [
      '// ---- Demo (opt-in) ------------------------------------------------------',
      '// This project has no animations and no single-shape expressions to demo (expressions',
      "// with a diverged Eye Target: Left/Right shape aren't included — eyesDrawEyePair() needs",
      '// one shared pose per frame). Add one in the studio and re-export to get a ready-to-',
      '// flash EYES_ENABLE_DEMO setup()/loop().'
    ].join('\n')
  }

  const lines: string[] = []
  lines.push('// ---- Demo (opt-in) ------------------------------------------------------')
  lines.push('// Define EYES_ENABLE_DEMO and the five TFT_* pin macros before #include "eyes.h" to get')
  lines.push("// a ready-to-flash setup()/loop() below -- no other code needed in your .ino. Example:")
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
  lines.push("// Leave EYES_ENABLE_DEMO undefined and write your own setup()/loop() instead (see the")
  lines.push('// "Minimal usage" comment above) if you want to drive the eyes yourself.')
  if (skippedDiverged > 0) {
    lines.push(
      `// (${skippedDiverged} expression${skippedDiverged === 1 ? '' : 's'} with a diverged left/right shape ${skippedDiverged === 1 ? 'is' : 'are'} not included in this auto-cycle.)`
    )
  }
  lines.push('#ifdef EYES_ENABLE_DEMO')
  lines.push('EyesBufferedDisplay eyesDemoTft(TFT_CS, TFT_DC, TFT_RST);')

  if (hasIdle) {
    lines.push('unsigned long eyesDemoAnimStart = 0;')
    lines.push('uint16_t eyesDemoFrameIndex = 0;')
  }

  if (hasExpressions) {
    lines.push(`const EyeFrame* const eyesDemoExpressions[] = { ${demoExpressions.map((e) => `&Expr_${toIdentifier(e.name)}`).join(', ')} };`)
    lines.push(`const char* const eyesDemoExpressionNames[] = { ${demoExpressions.map((e) => JSON.stringify(e.name)).join(', ')} };`)
    lines.push(`const int eyesDemoExpressionCount = ${demoExpressions.length};`)
  }

  const usesPhaseMachine = hasExpressions
  if (usesPhaseMachine) {
    if (hasIdle) {
      lines.push('enum EyesDemoPhase { EYES_DEMO_PHASE_IDLE, EYES_DEMO_PHASE_TRANSITION, EYES_DEMO_PHASE_HOLD };')
    } else {
      lines.push('enum EyesDemoPhase { EYES_DEMO_PHASE_TRANSITION, EYES_DEMO_PHASE_HOLD };')
    }
    lines.push(`EyesDemoPhase eyesDemoPhase = ${hasIdle ? 'EYES_DEMO_PHASE_IDLE' : 'EYES_DEMO_PHASE_TRANSITION'};`)
    lines.push('unsigned long eyesDemoPhaseStart = 0;')
    lines.push('int eyesDemoExprIndex = 0;')
    lines.push('const EyeFrame* eyesDemoFromFrame = eyesDemoExpressions[0];')
    lines.push('')
    lines.push('void eyesDemoEnterPhase(EyesDemoPhase p) {')
    lines.push('  eyesDemoPhase = p;')
    lines.push('  eyesDemoPhaseStart = millis();')
    lines.push('}')
  }

  lines.push('')
  lines.push('void setup() {')
  lines.push('  Serial.begin(115200);')
  lines.push('  SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);')
  lines.push('  eyesDemoTft.begin();')
  lines.push('  eyesDemoTft.setRotation(0);')
  if (hasIdle) lines.push('  eyesDemoAnimStart = millis();')
  if (usesPhaseMachine) lines.push(`  eyesDemoEnterPhase(${hasIdle ? 'EYES_DEMO_PHASE_IDLE' : 'EYES_DEMO_PHASE_TRANSITION'});`)
  lines.push('}')
  lines.push('')
  lines.push('void loop() {')
  if (usesPhaseMachine) lines.push('  unsigned long now = millis();')
  lines.push('  LiveEye live;')
  lines.push('')

  if (hasIdle && hasExpressions) {
    lines.push('  switch (eyesDemoPhase) {')
    lines.push('    case EYES_DEMO_PHASE_IDLE:')
    lines.push(`      eyesPlayAnimation(Anim_${idleIdent}, Anim_${idleIdent}_count, Anim_${idleIdent}_loop, eyesDemoAnimStart, eyesDemoFrameIndex, live);`)
    lines.push(`      if (now - eyesDemoPhaseStart >= ${IDLE_MS}) {`)
    lines.push('        eyesDemoExprIndex = 0;')
    lines.push('        Serial.print("Expression: ");')
    lines.push('        Serial.println(eyesDemoExpressionNames[eyesDemoExprIndex]);')
    lines.push('        eyesDemoEnterPhase(EYES_DEMO_PHASE_TRANSITION);')
    lines.push('      }')
    lines.push('      break;')
    lines.push('')
    lines.push('    case EYES_DEMO_PHASE_TRANSITION: {')
    lines.push(`      float t = (float)(now - eyesDemoPhaseStart) / ${TRANSITION_MS}.0f;`)
    lines.push('      if (t >= 1.0f) t = 1.0f;')
    lines.push('      live = eyesLerpFrame(*eyesDemoFromFrame, *eyesDemoExpressions[eyesDemoExprIndex], t);')
    lines.push('      if (t >= 1.0f) eyesDemoEnterPhase(EYES_DEMO_PHASE_HOLD);')
    lines.push('      break;')
    lines.push('    }')
    lines.push('')
    lines.push('    case EYES_DEMO_PHASE_HOLD:')
    lines.push('      live = eyesLerpFrame(*eyesDemoExpressions[eyesDemoExprIndex], *eyesDemoExpressions[eyesDemoExprIndex], 0);')
    lines.push(`      if (now - eyesDemoPhaseStart >= ${HOLD_MS}) {`)
    lines.push('        eyesDemoFromFrame = eyesDemoExpressions[eyesDemoExprIndex];')
    lines.push('        eyesDemoExprIndex++;')
    lines.push('        if (eyesDemoExprIndex >= eyesDemoExpressionCount) {')
    lines.push('          eyesDemoAnimStart = millis();  // resync idle animation timing before resuming it')
    lines.push('          eyesDemoEnterPhase(EYES_DEMO_PHASE_IDLE);')
    lines.push('        } else {')
    lines.push('          Serial.print("Expression: ");')
    lines.push('          Serial.println(eyesDemoExpressionNames[eyesDemoExprIndex]);')
    lines.push('          eyesDemoEnterPhase(EYES_DEMO_PHASE_TRANSITION);')
    lines.push('        }')
    lines.push('      }')
    lines.push('      break;')
    lines.push('  }')
  } else if (hasIdle) {
    lines.push(`  eyesPlayAnimation(Anim_${idleIdent}, Anim_${idleIdent}_count, Anim_${idleIdent}_loop, eyesDemoAnimStart, eyesDemoFrameIndex, live);`)
  } else {
    // hasExpressions only -- cycle forever, no idle phase
    lines.push('  switch (eyesDemoPhase) {')
    lines.push('    case EYES_DEMO_PHASE_TRANSITION: {')
    lines.push(`      float t = (float)(now - eyesDemoPhaseStart) / ${TRANSITION_MS}.0f;`)
    lines.push('      if (t >= 1.0f) t = 1.0f;')
    lines.push('      live = eyesLerpFrame(*eyesDemoFromFrame, *eyesDemoExpressions[eyesDemoExprIndex], t);')
    lines.push('      if (t >= 1.0f) eyesDemoEnterPhase(EYES_DEMO_PHASE_HOLD);')
    lines.push('      break;')
    lines.push('    }')
    lines.push('')
    lines.push('    case EYES_DEMO_PHASE_HOLD:')
    lines.push('      live = eyesLerpFrame(*eyesDemoExpressions[eyesDemoExprIndex], *eyesDemoExpressions[eyesDemoExprIndex], 0);')
    lines.push(`      if (now - eyesDemoPhaseStart >= ${HOLD_MS}) {`)
    lines.push('        eyesDemoFromFrame = eyesDemoExpressions[eyesDemoExprIndex];')
    lines.push('        eyesDemoExprIndex = (eyesDemoExprIndex + 1) % eyesDemoExpressionCount;')
    lines.push('        Serial.print("Expression: ");')
    lines.push('        Serial.println(eyesDemoExpressionNames[eyesDemoExprIndex]);')
    lines.push('        eyesDemoEnterPhase(EYES_DEMO_PHASE_TRANSITION);')
    lines.push('      }')
    lines.push('      break;')
    lines.push('  }')
  }

  lines.push('')
  lines.push('  eyesDemoTft.fillScreen(EYE_COLOR_BACKGROUND);')
  lines.push('  eyesDrawEyePair(eyesDemoTft, 120, 120, live, EYE_COLOR_BACKGROUND, EYE_COLORS_LEFT, EYE_COLORS_RIGHT);')
  lines.push('  eyesDemoTft.present();')
  lines.push('  delay(EYE_FRAME_DELAY_MS);')
  lines.push('}')
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
 *   highlightSize, durationMs, easing, bezierX1, bezierY1, bezierX2, bezierY2
 * (bezier fields only matter when easing == EYE_EASE_BEZIER, scaled 0-100)
 *
 * Pupil X/Y can reach +-100 (the pupil's center can travel all the way to the eye's own
 * edge) and Pupil Rotation spins the pupil ellipse 0-360deg independent of the eye's own
 * rotation. Both are clipped to the eye's silhouette in eyesFillEllipseInEye() below, so the
 * pupil never paints outside the eye no matter how far it's pushed or rotated — matching the
 * studio preview, which gets the same clipping for free from its canvas clip path.
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
 * Opacity pre-blended into it (RGB565 has no alpha channel) — see eyesDrawEye() below.
 *
 * EYE_TARGET_FPS / EYE_FRAME_DELAY_MS match the Display FPS set in the studio's Display
 * panel. eyesPlayAnimation() itself is time-based (millis()-driven), so it always plays at
 * the correct speed regardless of loop() rate — EYE_FRAME_DELAY_MS only paces how often a
 * frame is drawn/presented, i.e. the actual "frames per second" on the panel.
 *
 * This file is plug-and-play: it also bundles the "player" (easing, interpolation, and
 * drawing) as inline functions, so you don't need a separate companion file. It also bundles
 * a ready-to-flash demo setup()/loop() at the bottom (see "Demo (opt-in)" below) that cycles
 * the idle animation and every expression -- define EYES_ENABLE_DEMO before including this
 * header to use it as-is with no other code. Rolling your own instead? Minimal usage:
 *
 *   #include <Adafruit_GC9A01A.h>  // <- put this BEFORE the line below, in your .ino itself
 *   #include "eyes.h"              //    (Arduino's auto-library-discovery only scans your
 *                                  //     .ino's own #include lines, not ones nested inside
 *                                  //     a conditional #if in an included header — so this
 *                                  //     explicit line is what makes EyesBufferedDisplay
 *                                  //     below actually get defined; omit it and it's
 *                                  //     silently skipped instead of failing to compile)
 *
 *   EyesBufferedDisplay tft(TFT_CS, TFT_DC, TFT_RST);  // flicker-free buffered display
 *   unsigned long animStart = 0;
 *   uint16_t frameIndex = 0;
 *
 *   void setup() {
 *     tft.begin();
 *     tft.setRotation(0);
 *     animStart = millis();
 *   }
 *
 *   void loop() {
 *     LiveEye live;
 *     eyesPlayAnimation(Anim_Idle, Anim_Idle_count, Anim_Idle_loop, animStart, frameIndex, live);
 *     tft.fillScreen(EYE_COLOR_BACKGROUND);
 *     eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND, EYE_COLORS_LEFT, EYE_COLORS_RIGHT);
 *     tft.present();
 *     delay(EYE_FRAME_DELAY_MS);  // paces drawing to EYE_TARGET_FPS
 *   }
 *
 * EYE_COLORS_LEFT/EYE_COLORS_RIGHT are always both defined -- pass both to eyesDrawEyePair()
 * every time. When the studio's two eyes have identical colors, EYE_COLORS_RIGHT is just a
 * reference to EYE_COLORS_LEFT (no duplicate data); when Eye Target: Left/Right editing gave
 * them different colors, both are real, distinct structs. Static poses saved with a
 * left/right shape divergence export as two constants instead of one, e.g. Expr_Blink_L /
 * Expr_Blink_R rather than a plain Expr_Blink.
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
};

// One eye's full color palette (RGB565) plus its border thickness — the studio's Eye
// Target: Left/Right editing lets the two eyes end up with different palettes (and
// different border widths, via Visual Reference per-eye overrides), so this is a value
// passed to the drawing functions rather than fixed macros.
struct EyeColorSet {
  uint16_t sclera, iris, pupil, highlight, shadow, glow, border;
  uint8_t borderWidth; // ring thickness in pixels
};

// ---- Colors -----------------------------------------------------------

${exportColors(project)}

// ---- Timing -------------------------------------------------------------

${exportTiming(project.display)}

// ---- Player (easing, interpolation, drawing, playback) -----------------------

${PLAYER_CODE}

// ---- Animations -----------------------------------------------------------

${project.animations.map(exportAnimation).join('\n\n')}

// ---- Expressions (static poses) -------------------------------------------

${project.expressions.map(exportExpression).join('\n\n')}

${exportDemo(project)}

#endif // ${guard}
`
  return header
}
