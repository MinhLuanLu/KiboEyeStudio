/*
 * KiboEyePlayer.h — companion "player" for headers exported from Kibo Eye Studio.
 *
 * The exported header (e.g. "eyes.h") only contains DATA: the EyeFrame struct, the
 * EyeEasing enum, PROGMEM keyframe arrays (Anim_*), and RGB565 color #defines
 * (EYE_COLOR_*). This file is the missing "draw it on a real display" half:
 *   - kiboEase()         mirrors the studio's easing curves (linear/in/out/inOut/bounce/
 *                         elastic/custom-bezier)
 *   - kiboLerpFrame()     interpolates every numeric field between two keyframes
 *   - kiboDrawEye() /
 *     kiboDrawEyePair()   draws one interpolated eye pair with Adafruit_GFX primitives
 *   - kiboPlayAnimation() call every loop() with millis() timing; advances through an
 *                         Anim_* array and hands you back the live interpolated pose
 *
 * Works with any Adafruit_GFX-derived display driver (Adafruit_GC9A01A, ST77xx, etc.).
 * If you use TFT_eSPI or LovyanGFX instead, the fillRoundRect/fillCircle/fillRect calls
 * below have the same signatures, so this should port with minimal changes.
 *
 * IMPORTANT: kiboDrawEye()/kiboDrawEyePair() are templates (`template<typename T>`), not
 * functions taking `Adafruit_GFX&`. This matters because fillRoundRect()/fillCircle() are
 * NOT virtual in Adafruit_GFX — the exact same reason RoboEyes_M's own
 * GC9A01A_RoboEyesDisplay class has to be handed to RoboEyes<GC9A01A_RoboEyesDisplay> as a
 * template parameter rather than through a base-class reference. Pass your concrete
 * display type (or the buffered wrapper below) and the calls resolve correctly at compile
 * time; going through Adafruit_GFX& would silently skip any offscreen-buffer subclass.
 *
 * Include your exported header BEFORE this one, e.g.:
 *   #include "eyes.h"
 *   #include "KiboEyePlayer.h"
 */
#pragma once
#include <Adafruit_GFX.h>
#include <Adafruit_GC9A01A.h>
#include <math.h>

// ---------------------------------------------------------------------------
// Easing — mirrors src/engine/easing.ts exactly (same curves, same bezier solve)
// ---------------------------------------------------------------------------
inline float kiboEase(float t, uint8_t type, int8_t bx1, int8_t by1, int8_t bx2, int8_t by2) {
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

// ---------------------------------------------------------------------------
// Live (interpolated) eye pose — float versions of the EyeFrame fields
// ---------------------------------------------------------------------------
struct LiveEye {
  float width, height, radius, distance;
  float irisWidth, irisHeight, pupilWidth, pupilHeight;
  float pupilX, pupilY;
  float upperEyelid, lowerEyelid;
  float highlightX, highlightY, highlightSize;
};

inline LiveEye kiboLerpFrame(const EyeFrame& a, const EyeFrame& b, float t) {
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
inline void kiboFillEllipse(T& gfx, int16_t cx, int16_t cy, int16_t rx, int16_t ry, uint16_t color) {
  if (rx <= 0 || ry <= 0) return;
  for (int16_t dy = -ry; dy <= ry; dy++) {
    float t = (float)dy / (float)ry;
    float span = sqrtf(max(0.0f, 1.0f - t * t));
    int16_t dx = (int16_t)(rx * span);
    gfx.drawFastHLine(cx - dx, cy + dy, dx * 2 + 1, color);
  }
}

// ---------------------------------------------------------------------------
// Drawing — flat-color simplification of the studio's layered renderer (sclera ->
// iris -> pupil -> highlight -> eyelids). No gradients/blur/rotation here since plain
// Adafruit_GFX has no gradient or rotated-shape primitives; note EYE_COLOR_* fills come
// straight from your exported header. `bgColor` should match your Display panel's
// background color (RGB565) so eyelids blend in correctly.
// ---------------------------------------------------------------------------
template <typename T>
inline void kiboDrawEye(T& gfx, int16_t cx, int16_t cy, const LiveEye& e, bool mirror, uint16_t bgColor) {
  int16_t w = (int16_t)e.width, h = (int16_t)e.height;
  int16_t r = (int16_t)min(e.radius, (float)min(w, h) / 2.0f);
  int16_t x = cx - w / 2, y = cy - h / 2;

  gfx.fillRoundRect(x, y, w, h, r, EYE_COLOR_SCLERA);

  // Iris/pupil scale independently per axis off the eye's own width/height (an ellipse
  // when width != height), matching the studio's Iris Width/Height and Pupil Width/Height
  // sliders — drawn via kiboFillEllipse() above.
  int sign = mirror ? -1 : 1;
  int16_t px = cx + (int16_t)(sign * (e.pupilX / 100.0f) * (w / 2.0f));
  int16_t py = cy + (int16_t)((e.pupilY / 100.0f) * (h / 2.0f));

  int16_t irisRX = (int16_t)((e.irisWidth / 100.0f) * (w / 2.0f));
  int16_t irisRY = (int16_t)((e.irisHeight / 100.0f) * (h / 2.0f));
  int16_t pupilRX = (int16_t)((e.pupilWidth / 100.0f) * (w / 2.0f));
  int16_t pupilRY = (int16_t)((e.pupilHeight / 100.0f) * (h / 2.0f));

  if (irisRX > 0 && irisRY > 0) kiboFillEllipse(gfx, px, py, irisRX, irisRY, EYE_COLOR_IRIS);
  if (pupilRX > 0 && pupilRY > 0) kiboFillEllipse(gfx, px, py, pupilRX, pupilRY, EYE_COLOR_PUPIL);

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
inline void kiboDrawEyePair(T& gfx, int16_t screenCx, int16_t screenCy, const LiveEye& e, uint16_t bgColor) {
  int16_t half = (int16_t)(e.distance / 2);
  kiboDrawEye(gfx, screenCx - half, screenCy, e, false, bgColor);
  kiboDrawEye(gfx, screenCx + half, screenCy, e, true, bgColor);
}

// ---------------------------------------------------------------------------
// Optional: flicker-free buffered display for Adafruit_GC9A01A. Plain Adafruit_GC9A01A
// streams every fillRoundRect/fillCircle/fillRect call straight to the panel as its own
// SPI transaction, so redrawing a whole frame is visibly progressive (flicker). This
// wrapper draws into an offscreen GFXcanvas16 instead and blits it in one burst via
// present() — same technique your RoboEyes_M library's GC9A01A_RoboEyesDisplay uses
// internally. Use it as the `T` in kiboDrawEyePair<KiboBufferedDisplay>(...).
//
// NOTE: fillRoundRect/fillCircle aren't virtual in Adafruit_GFX, so they're redeclared
// (shadowed) here rather than overridden — that only works when called through this
// concrete type, which is exactly what the kiboDraw*() templates do.
// ---------------------------------------------------------------------------
class KiboBufferedDisplay : public Adafruit_GC9A01A {
public:
  using Adafruit_GC9A01A::Adafruit_GC9A01A;
  ~KiboBufferedDisplay() { delete canvas; }

  void begin(uint32_t freq = 0) {
    Adafruit_GC9A01A::begin(freq);
    canvas = new GFXcanvas16(width(), height());
  }

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

// ---------------------------------------------------------------------------
// Playback — call every loop() with the same (frames, count, loop, startMillis,
// frameIndex) arguments; it advances state in-place and fills `outLive`.
// Returns true while still playing, false once a non-looping animation has finished
// (outLive is left holding the final pose).
// ---------------------------------------------------------------------------
inline bool kiboPlayAnimation(const EyeFrame frames[], uint16_t count, bool loop,
                               unsigned long& startMillis, uint16_t& frameIndex, LiveEye& outLive) {
  if (count == 0) return false;
  if (count == 1) {
    outLive = kiboLerpFrame(frames[0], frames[0], 0);
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
      float eased = kiboEase(t, frames[i].easing, frames[i].bezierX1, frames[i].bezierY1, frames[i].bezierX2, frames[i].bezierY2);
      outLive = kiboLerpFrame(frames[i], frames[next], eased);
      frameIndex = i;
      return !finished;
    }
    acc += dur;
  }

  // Looping animation ran past its total duration — wrap the clock and retry.
  if (loop) {
    startMillis += acc;
    return kiboPlayAnimation(frames, count, loop, startMillis, frameIndex, outLive);
  }
  outLive = kiboLerpFrame(frames[count - 1], frames[count - 1], 0);
  return false;
}
