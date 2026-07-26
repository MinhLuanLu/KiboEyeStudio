/*
 * KiboEyeExample.ino
 *
 * Minimal ESP32 + GC9A01 example that plays a Kibo Eye Studio animation.
 *
 * SETUP:
 *   1. Export a C++ Header from Kibo Eye Studio and save it into THIS folder as "eyes.h"
 *      (Export... -> C++ Header -> Save to File...).
 *   2. Install "Adafruit GC9A01A" and "Adafruit GFX Library" via Library Manager
 *      (swap for TFT_eSPI/LovyanGFX below if that's what you already use).
 *   3. Fix TFT_CS/TFT_DC/TFT_RST for your wiring.
 *   4. Pick which exported animation to play at the bottom of loop() (defaults to Anim_Idle).
 */
#include <Adafruit_GC9A01A.h>
#include "eyes.h"           // <- your exported header, renamed to eyes.h in this folder
#include "KiboEyePlayer.h"  // <- the player/draw helpers that ship alongside this sketch

#define TFT_CS   5
#define TFT_DC   6
#define TFT_RST  7

Adafruit_GC9A01A tft(TFT_CS, TFT_DC, TFT_RST);

// Match this to the Display panel's background color in the studio (default black).
const uint16_t BG_COLOR = GC9A01A_BLACK;

// Playback state for whichever animation is currently active.
const EyeFrame* activeFrames = Anim_Idle;
uint16_t activeCount = Anim_Idle_count;
bool activeLoop = Anim_Idle_loop;
unsigned long animStart = 0;
uint16_t frameIndex = 0;

void playAnimation(const EyeFrame frames[], uint16_t count, bool loop) {
  activeFrames = frames;
  activeCount = count;
  activeLoop = loop;
  animStart = millis();
  frameIndex = 0;
}

void setup() {
  tft.begin();
  tft.fillScreen(BG_COLOR);
  playAnimation(Anim_Idle, Anim_Idle_count, Anim_Idle_loop);
}

void loop() {
  LiveEye live;
  bool stillPlaying = kiboPlayAnimation(activeFrames, activeCount, activeLoop, animStart, frameIndex, live);

  tft.fillScreen(BG_COLOR);  // simplest possible approach — see note below about flicker
  kiboDrawEyePair(tft, 120, 120, live, BG_COLOR);  // 120,120 = center of a 240x240 panel

  // Example: once a one-shot animation (e.g. a blink) finishes, drop back to Idle.
  if (!stillPlaying && activeFrames != Anim_Idle) {
    playAnimation(Anim_Idle, Anim_Idle_count, Anim_Idle_loop);
  }

  delay(16);  // ~60fps cap — replace with a proper millis()-based limiter if you like
}

/*
 * NOTE on flicker: this example clears and redraws the whole screen every frame, which
 * will visibly flicker on real hardware (no double buffering). For smooth results, draw
 * into an off-screen buffer instead and push it in one go — e.g. Adafruit_GFX's
 * GFXcanvas16 (240x240x16bit = ~112KB RAM, fine on ESP32 boards with PSRAM, tight
 * otherwise), or your board's own framebuffer if you're already running LVGL.
 *
 * NOTE on PROGMEM: unlike classic AVR Arduino, the ESP32 core already treats PROGMEM as a
 * no-op and its flash is memory-mapped, so you can index Anim_Idle[i] directly — no
 * pgm_read_byte()/memcpy_P() needed.
 */
