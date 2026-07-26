import type { Animation, DisplaySettings, EasingType, Expression, EyeColors, EyeParams, Project } from '@/types'
import { hexToRgb565, mixColors } from '@/lib/color'

// Ring thickness in device pixels — matches the BORDER_WIDTH constant in
// src/renderer/drawEye.ts so the preview and this export draw an identical width.
const BORDER_WIDTH_PX = 3

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
    Math.round(params.upperEyelid),
    Math.round(params.lowerEyelid),
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

function exportExpression(expr: Expression): string {
  const ident = toIdentifier(expr.name)
  return `const EyeFrame Expr_${ident} PROGMEM = \n${eyeFrameLiteral(expr.params, 0, 'linear')};`
}

function toRgb565Hex(hex: string): string {
  return `0x${hexToRgb565(hex).toString(16).toUpperCase().padStart(4, '0')}`
}

function exportColors(colors: EyeColors, display: DisplaySettings): string {
  // RGB565 has no alpha channel, so Border Opacity is pre-blended here into a single flat
  // color against the display background (matching the ring trick eyesDrawEye uses below):
  // 0% -> exactly the background color (invisible ring), 100% -> the pure border color.
  const borderBlend = mixColors(display.backgroundColor, colors.border, colors.borderOpacity / 100)
  return [
    `#define EYE_COLOR_BACKGROUND ${toRgb565Hex(display.backgroundColor)} // RGB565 — Display panel's background color`,
    `#define EYE_COLOR_SCLERA     ${toRgb565Hex(colors.sclera)}`,
    `#define EYE_COLOR_IRIS       ${toRgb565Hex(colors.iris)}`,
    `#define EYE_COLOR_PUPIL      ${toRgb565Hex(colors.pupil)}`,
    `#define EYE_COLOR_HIGHLIGHT  ${toRgb565Hex(colors.highlight)}`,
    `#define EYE_COLOR_SHADOW     ${toRgb565Hex(colors.shadow)}  // shadow arc, intensity ${Math.round(colors.shadowIntensity)}% (not encodable in RGB565 — blend in software)`,
    `#define EYE_COLOR_GLOW       ${toRgb565Hex(colors.glow)}  // outer glow, intensity ${Math.round(colors.glowIntensity)}%`,
    `#define EYE_COLOR_BORDER     ${toRgb565Hex(borderBlend)}  // border color pre-blended with background at ${Math.round(colors.borderOpacity)}% opacity`,
    `#define EYE_BORDER_WIDTH     ${BORDER_WIDTH_PX}  // ring thickness in pixels`
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
  float pupilX, pupilY;
  float upperEyelid, lowerEyelid;
  float highlightX, highlightY, highlightSize;
};

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
  r.upperEyelid = a.upperEyelid + (b.upperEyelid - a.upperEyelid) * t;
  r.lowerEyelid = a.lowerEyelid + (b.lowerEyelid - a.lowerEyelid) * t;
  r.highlightX = a.highlightX + (b.highlightX - a.highlightX) * t;
  r.highlightY = a.highlightY + (b.highlightY - a.highlightY) * t;
  r.highlightSize = a.highlightSize + (b.highlightSize - a.highlightSize) * t;
  return r;
}

// Adafruit_GFX has no fillEllipse — fill one via horizontal scanlines using the ellipse
// equation, same technique fillCircle() itself uses internally for a circle.
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
    float ySide = fabsf((float)dy);
    if (ySide > hy) continue;
    float xExtent;
    if (ry < 0.01f || ySide <= hy - ry) {
      xExtent = hx;
    } else {
      float t = (ySide - (hy - ry)) / ry;
      if (t > 1.0f) t = 1.0f;
      xExtent = (hx - rx) + rx * sqrtf(max(0.0f, 1.0f - t * t));
    }
    int16_t ix = (int16_t)xExtent;
    gfx.drawFastHLine(cx - ix, cy + dy, ix * 2 + 1, color);
  }
}

// ---- Drawing — flat-color layered render: sclera -> iris -> pupil -> highlight -> ----
// eyelids. \`T\` is a template (not \`Adafruit_GFX&\`) on purpose: fillRoundRect()/
// fillCircle() aren't virtual in Adafruit_GFX, so a buffered subclass like
// EyesBufferedDisplay below only gets called correctly when the concrete type is known at
// compile time. \`bgColor\` should match your Display panel's background so eyelids blend in.
template <typename T>
inline void eyesDrawEye(T& gfx, int16_t cx, int16_t cy, const LiveEye& e, bool mirror, uint16_t bgColor) {
  int16_t w = (int16_t)e.width, h = (int16_t)e.height;
  int16_t radius = (int16_t)e.radius;
  int16_t x = cx - w / 2, y = cy - h / 2;

  // Border — an outer stadium/oval shape EYE_BORDER_WIDTH larger on every side, in a color
  // already pre-blended toward the background by Border Opacity (see EYE_COLOR_BORDER
  // above). The sclera fill right after this covers everything except a thin ring, giving
  // an opaque border with no per-pixel alpha needed. Both fills go through
  // eyesFillRoundedRect() (elliptical corners) rather than Adafruit_GFX's own
  // fillRoundRect(), so a maxed-out Radius on a non-square eye renders as a smooth oval
  // here exactly like it does in the studio's preview.
  eyesFillRoundedRect(gfx, cx, cy, w + EYE_BORDER_WIDTH * 2, h + EYE_BORDER_WIDTH * 2,
                       radius + EYE_BORDER_WIDTH, EYE_COLOR_BORDER);

  eyesFillRoundedRect(gfx, cx, cy, w, h, radius, EYE_COLOR_SCLERA);

  int sign = mirror ? -1 : 1;
  int16_t px = cx + (int16_t)(sign * (e.pupilX / 100.0f) * (w / 2.0f));
  int16_t py = cy + (int16_t)((e.pupilY / 100.0f) * (h / 2.0f));

  int16_t irisRX = (int16_t)((e.irisWidth / 100.0f) * (w / 2.0f));
  int16_t irisRY = (int16_t)((e.irisHeight / 100.0f) * (h / 2.0f));
  int16_t pupilRX = (int16_t)((e.pupilWidth / 100.0f) * (w / 2.0f));
  int16_t pupilRY = (int16_t)((e.pupilHeight / 100.0f) * (h / 2.0f));

  if (irisRX > 0 && irisRY > 0) eyesFillEllipse(gfx, px, py, irisRX, irisRY, EYE_COLOR_IRIS);
  if (pupilRX > 0 && pupilRY > 0) eyesFillEllipse(gfx, px, py, pupilRX, pupilRY, EYE_COLOR_PUPIL);

  float hlBaseX = pupilRX > 0 ? pupilRX : irisRX;
  float hlBaseY = pupilRY > 0 ? pupilRY : irisRY;
  float hlBase = (hlBaseX + hlBaseY) / 2.0f;
  int16_t hR = (int16_t)((e.highlightSize / 100.0f) * hlBase);
  if (hR > 0 && hlBase > 0) {
    int16_t hx = px + (int16_t)(sign * (e.highlightX / 100.0f) * hlBaseX);
    int16_t hy = py + (int16_t)((e.highlightY / 100.0f) * hlBaseY);
    gfx.fillCircle(hx, hy, hR, EYE_COLOR_HIGHLIGHT);
  }

  if (e.upperEyelid > 0) {
    int16_t cover = (int16_t)((e.upperEyelid / 100.0f) * h);
    gfx.fillRect(x, y, w, cover, bgColor);
  }
  if (e.lowerEyelid > 0) {
    int16_t cover = (int16_t)((e.lowerEyelid / 100.0f) * h);
    gfx.fillRect(x, y + h - cover, w, cover, bgColor);
  }
}

template <typename T>
inline void eyesDrawEyePair(T& gfx, int16_t screenCx, int16_t screenCy, const LiveEye& e, uint16_t bgColor) {
  int16_t half = (int16_t)(e.distance / 2);
  eyesDrawEye(gfx, screenCx - half, screenCy, e, false, bgColor);
  eyesDrawEye(gfx, screenCx + half, screenCy, e, true, bgColor);
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

  // Blit the finished frame to the panel in a single windowed SPI burst.
  void present() { drawRGBBitmap(0, 0, canvas->getBuffer(), width(), height()); }

private:
  GFXcanvas16* canvas = nullptr;
};
#endif // __has_include(<Adafruit_GC9A01A.h>)

#endif // EYES_EYE_PLAYER_H
`

export function generateCppHeader(project: Project): string {
  const guard = `EYES_EYE_ANIMATIONS_${toIdentifier(project.name).toUpperCase() || 'PROJECT'}_H`
  const header = `/*
 * Generated by Eyes Eye Studio — do not hand-edit, re-export instead.
 * Project: ${project.name}
 * Generated: ${new Date().toISOString()}
 *
 * Field order in EyeFrame matches the studio's EyeParams model:
 *   width, height, radius, rotation, distance, irisWidth, irisHeight, pupilWidth,
 *   pupilHeight, pupilX, pupilY, upperEyelid, lowerEyelid, highlightX, highlightY,
 *   highlightSize, durationMs, easing, bezierX1, bezierY1, bezierX2, bezierY2
 * (bezier fields only matter when easing == EYE_EASE_BEZIER, scaled 0-100)
 *
 * Eye colors are exported below as RGB565 #defines (sclera/iris/pupil/highlight/shadow/
 * glow/border) matching the studio's Color panel. EYE_COLOR_BORDER already has Border
 * Opacity pre-blended into it (RGB565 has no alpha channel) — see eyesDrawEye() below.
 *
 * This file is plug-and-play: it also bundles the "player" (easing, interpolation, and
 * drawing) as inline functions, so you don't need a separate companion file. Minimal usage:
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
 *     eyesDrawEyePair(tft, 120, 120, live, EYE_COLOR_BACKGROUND);  // 120,120 = center of a 240x240 panel
 *     tft.present();
 *     delay(16);
 *   }
 *
 * Using TFT_eSPI/LovyanGFX instead of Adafruit_GC9A01A? Skip that #include — pass your own
 * sprite/canvas object as the template type to eyesDrawEyePair()/eyesDrawEye() instead;
 * they just need fillRoundRect/fillCircle/fillRect/drawFastHLine methods with the usual
 * Adafruit_GFX signatures.
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
  uint8_t upperEyelid, lowerEyelid;
  int8_t highlightX, highlightY;
  uint8_t highlightSize;
  uint16_t durationMs;
  uint8_t easing;
  int8_t bezierX1, bezierY1, bezierX2, bezierY2;
};

// ---- Colors -----------------------------------------------------------

${exportColors(project.colors, project.display)}

// ---- Player (easing, interpolation, drawing, playback) -----------------------

${PLAYER_CODE}

// ---- Animations -----------------------------------------------------------

${project.animations.map(exportAnimation).join('\n\n')}

// ---- Expressions (static poses) -------------------------------------------

${project.expressions.map(exportExpression).join('\n\n')}

#endif // ${guard}
`
  return header
}
