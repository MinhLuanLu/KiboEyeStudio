// Host-side Arduino/GFX shim so the EXPORTED eyes.h can be compiled and executed on a PC.
//
// Why this exists: the eye code in eyes.h is a template over a graphics object and touches only
// six drawing primitives, no pgm_read_*, no String/F(). That makes it portable to a desktop
// compiler almost verbatim -- so the parity harness can render ACTUAL firmware pixels instead of
// re-implementing the firmware's formulas in TypeScript and comparing a model against a model.
// Every studio/device divergence found so far lived precisely in that modelling gap.
//
// millis() is a virtual clock the harness drives, so animations, transitions and combo timing can
// be sampled deterministically at any instant -- no sleeping, no frame races, reproducible runs.
#pragma once
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <cstdio>
#include <algorithm>

#define PROGMEM
#ifndef PI
#define PI 3.14159265358979323846
#endif
// Arduino exposes min/max as macros, and eyes.h calls them unqualified with mixed float literals.
// Defined after <algorithm> so the standard headers parse first; nothing here calls std::min/max.
#ifndef max
#define max(a, b) ((a) > (b) ? (a) : (b))
#endif
#ifndef min
#define min(a, b) ((a) < (b) ? (a) : (b))
#endif
#ifndef constrain
#define constrain(a, l, h) ((a) < (l) ? (l) : ((a) > (h) ? (h) : (a)))
#endif
#ifndef map
#define map(x, il, ih, ol, oh) (((x) - (il)) * ((oh) - (ol)) / ((ih) - (il)) + (ol))
#endif

extern unsigned long g_hostMillis;
inline unsigned long millis() { return g_hostMillis; }
inline void delay(unsigned long) {}   // the harness advances g_hostMillis instead

struct HostSerial {
  void begin(long) {}
  void println() {}
  template <class T> void print(const T&) {}
  template <class T> void println(const T&) {}
};
extern HostSerial Serial;

// 16-bit RGB565 framebuffer implementing exactly the six primitives eyes.h calls, plus the
// sprite lifecycle the generated sketch uses. Bresenham/midpoint rasterisation is deliberately
// plain: the point is to reproduce what the panel receives, not to be fast.
class HostCanvas {
public:
  int W, H;
  uint16_t* buf;
  HostCanvas(int w, int h) : W(w), H(h) { buf = new uint16_t[w * h](); }
  ~HostCanvas() { delete[] buf; }

  int16_t width() const { return (int16_t)W; }
  int16_t height() const { return (int16_t)H; }
  void setColorDepth(int) {}
  bool createSprite(int, int) { return true; }
  void pushSprite(int, int) {}
  void fillScreen(uint16_t c) { for (int i = 0; i < W * H; i++) buf[i] = c; }

  inline void drawPixel(int16_t x, int16_t y, uint16_t c) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    buf[(int)y * W + (int)x] = c;
  }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) {
    if (w < 0) { x = (int16_t)(x + w); w = (int16_t)-w; }
    for (int16_t i = 0; i < w; i++) drawPixel((int16_t)(x + i), y, c);
  }
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) {
    if (h < 0) { y = (int16_t)(y + h); h = (int16_t)-h; }
    for (int16_t i = 0; i < h; i++) drawPixel(x, (int16_t)(y + i), c);
  }
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) {
    int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    int dy = -std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (;;) {
      drawPixel((int16_t)x0, (int16_t)y0, c);
      if (x0 == x1 && y0 == y1) break;
      int e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 = (int16_t)(x0 + sx); }
      if (e2 <= dx) { err += dx; y0 = (int16_t)(y0 + sy); }
    }
  }
  void fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t c) {
    for (int y = -r; y <= r; y++)
      for (int x = -r; x <= r; x++)
        if (x * x + y * y <= (int)r * r) drawPixel((int16_t)(x0 + x), (int16_t)(y0 + y), c);
  }
  void drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t c) {
    for (int a = 0; a < 1440; a++) {
      double t = a * PI / 720.0;
      drawPixel((int16_t)lround(x0 + r * cos(t)), (int16_t)lround(y0 + r * sin(t)), c);
    }
  }

  // P6 PPM, RGB565 -> RGB888 with the usual bit-replication expansion.
  void writePPM(const char* path) const {
    FILE* f = fopen(path, "wb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(2); }
    fprintf(f, "P6\n%d %d\n255\n", W, H);
    for (int i = 0; i < W * H; i++) {
      uint16_t v = buf[i];
      unsigned char r = (unsigned char)(((v >> 11) & 0x1F) * 255 / 31);
      unsigned char g = (unsigned char)(((v >> 5) & 0x3F) * 255 / 63);
      unsigned char b = (unsigned char)((v & 0x1F) * 255 / 31);
      fputc(r, f); fputc(g, f); fputc(b, f);
    }
    fclose(f);
  }
};
