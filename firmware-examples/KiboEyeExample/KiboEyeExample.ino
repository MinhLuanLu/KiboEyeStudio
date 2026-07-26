/*
 * KiboEyeExample.ino
 *
 * Minimal ESP32 + GC9A01 example that plays a Kibo Eye Studio animation, using
 * KiboBufferedDisplay for flicker-free rendering (draws into an offscreen buffer, then
 * blits it in one SPI burst — see the comment above KiboBufferedDisplay in
 * KiboEyePlayer.h for why plain Adafruit_GC9A01A flickers without this).
 *
 * SETUP:
 *   1. Export a C++ Header from Kibo Eye Studio and save it into THIS folder as "eyes.h"
 *      (Export... -> C++ Header -> Save to File...).
 *   2. Install "Adafruit GC9A01A" and "Adafruit GFX Library" via Library Manager.
 *   3. Fix TFT_CS/TFT_DC/TFT_RST (and TFT_SCLK/TFT_MOSI if you're calling SPI.begin()
 *      with custom pins) for your wiring.
 *   4. Pick which exported animation to play at the bottom of loop() (defaults to Anim_Idle).
 *
 * Using TFT_eSPI or LovyanGFX instead? Skip KiboBufferedDisplay and pass your own
 * sprite/canvas object as the template type to kiboDrawEyePair() — those libraries have
 * their own buffered-sprite equivalents.
 */
#include "eyes.h"           // <- your exported header, renamed to eyes.h in this folder
#include "KiboEyePlayer.h"  // <- the player/draw helpers + KiboBufferedDisplay

#define TFT_CS   5
#define TFT_DC   6
#define TFT_RST  7

KiboBufferedDisplay tft(TFT_CS, TFT_DC, TFT_RST);

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
  tft.setRotation(0);
  playAnimation(Anim_Idle, Anim_Idle_count, Anim_Idle_loop);
}

void loop() {
  LiveEye live;
  bool stillPlaying = kiboPlayAnimation(activeFrames, activeCount, activeLoop, animStart, frameIndex, live);

  tft.fillScreen(BG_COLOR);
  kiboDrawEyePair(tft, 120, 120, live, BG_COLOR);  // 120,120 = center of a 240x240 panel
  tft.present();  // <- blit the buffered frame; nothing reaches the panel before this

  // Example: once a one-shot animation (e.g. a blink) finishes, drop back to Idle.
  if (!stillPlaying && activeFrames != Anim_Idle) {
    playAnimation(Anim_Idle, Anim_Idle_count, Anim_Idle_loop);
  }

  delay(16);  // ~60fps cap — replace with a proper millis()-based limiter if you like
}

/*
 * NOTE on PROGMEM: unlike classic AVR Arduino, the ESP32 core already treats PROGMEM as a
 * no-op and its flash is memory-mapped, so you can index Anim_Idle[i] directly — no
 * pgm_read_byte()/memcpy_P() needed.
 *
 * NOTE on RAM: KiboBufferedDisplay allocates one GFXcanvas16 sized to your panel
 * (240x240x16bit = ~112KB) — fine on most ESP32 variants, but check you have headroom
 * alongside WiFi/BLE stacks etc. If it's too tight, fall back to plain Adafruit_GC9A01A
 * (drop the "Buffered" and the present() call) and accept some flicker, or shrink the
 * Display panel's resolution in the studio before re-exporting.
 */
