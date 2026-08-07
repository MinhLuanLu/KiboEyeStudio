# IMPORTANT — Eye Animation Rendering: Root Cause, Fix, and Architecture Rules

**Read this before porting the eyes to a different ESP32 module or display, or before
"optimizing" the renderer.** It documents a real, diagnosed bug that froze eye‑shape movement,
the exact root cause, the fix, and the rules that keep the animation smooth. Ignoring these will
reintroduce the freeze.

---

## 1. The symptom (what "broken" looked like)

On an **ESP32‑C6 + GC9A01A 240×240 round SPI TFT**, most eye animations were smooth:

- Blinking, eyelids, loading spinner, pupil, iris, and eye *resize* all animated correctly.

But **movement of the eye shape itself** (up / down / left / right, and any tilt) behaved wrongly:

- The eye appeared to **freeze in place** during the movement, then **jump straight to the final
  position** when the next animation began. Intermediate frames were never shown.

It looked like eye position "wasn't interpolating," but it was — see below.

---

## 2. The exact root cause (measured, not assumed)

There were **two facts** that combined to produce the bug. Both were confirmed with on‑device
Serial timing (per‑frame `millis()` around each render stage), not guessed.

### 2a. The primary cause: per‑pixel floating‑point rotation on a chip with no FPU

The rasterizer draws a normal (upright) eye with a **fast per‑scanline path** (integer spans, very
little floating‑point). But the instant an eye has **any non‑zero rotation** — even `0.1°` — it
switches to a **per‑pixel path** that, *for every pixel of the eye*, does an inverse rotation with
`cosf()` / `sinf()` and float multiplies.

The **ESP32‑C6 has no hardware floating‑point unit (FPU)**. It is a RISC‑V core whose toolchain
emulates every `float` operation in software (roughly 10–100× slower than a hardware FPU). So:

| Frame type | Render path | Measured time on C6 |
|---|---|---|
| `rotation == 0` | fast scanline | ~22 ms (~20 FPS baseline) |
| `rotation != 0` | per‑pixel `cosf`/`sinf` | **~1,800 ms (one frame took 1.8 seconds)** |

Every movement animation also animated `rotation` (a slight tilt), so every "move" frame hit the
1.8‑second path. Serial proof of the stall:

```
*** SPIKE totalMs=1794  updateMs=0  drawMs=1794  invalidateMs=0
```

`updateMs=0` (animation math is instant) and `drawMs=1794` (100% of the time is in the rasterizer)
pinned it to rendering, and the only variable on the slow frame was `rot != 0`.

### 2b. The amplifier: time‑based interpolation turns a stall into a *jump*

The animation player is **time‑based**: each frame it samples the pose at the current `millis()`.
That is correct for matching editor timing, **but it is not resilient to slow frames.** While one
frame is blocked for 1.8 s, animation *time* keeps advancing. When the next frame finally renders,
it samples 1.8 s later in the timeline — so the eye **skips the entire in‑between motion and snaps
to the end**. Freeze → jump.

> Contrast with FluxGarage RoboEyes / RoboEyes_M, which tween **per frame**
> (`current = (current + next) / 2` every draw). A slow frame there just makes a *smaller* step —
> it slows down smoothly and never jumps. That resilience is why simple eye libraries look fluid
> even on weak MCUs.

---

## 3. Why blink / eyelids / loading / pupil / iris were smooth but movement froze

Nothing special about "position" was broken. The difference is **which render path each field
touches**:

- Blink, eyelids, loading, pupil, iris, and eye width/height are all drawn with the **fast
  scanline path** and change the eye's *internal* appearance at a fixed center. They never trigger
  per‑pixel rotation, so their frames stayed ~22 ms → smooth.
- Eye‑shape *movement* animations in this project also animated **`rotation`**, which flipped the
  renderer into the **per‑pixel float path** → 1.8 s frames → freeze/jump.

So it was never "position doesn't interpolate." Position interpolates fine; the *rotation that
rode along with the movement keyframes* is what killed the frame rate, and time‑based sampling
turned that into a visible jump.

---

## 4. How it was fixed

Rotation is only cheap on a chip with an FPU. The fix makes the renderer **skip the per‑pixel
rotation path on soft‑float chips**, while keeping full rotation on chips that can afford it.

`rotRad` in `eyesDrawEye()` (in `eyes.h`, and in the studio exporter's player template) is now
guarded:

```cpp
#if defined(EYES_NO_ROTATION)
  float rotRad = 0.0f;                       // force OFF (any chip)
#elif defined(EYES_FORCE_ROTATION)
  float rotRad = e.rotation * (mirror ? -1.0f : 1.0f) * (float)PI / 180.0f; // force ON
#elif defined(__riscv) && !defined(__riscv_flen)   // RISC-V with no hardware float => C6/C3
  float rotRad = 0.0f;                       // auto-OFF on soft-float
#else
  float rotRad = e.rotation * (mirror ? -1.0f : 1.0f) * (float)PI / 180.0f; // ON (has FPU)
#endif
```

- `__riscv_flen` is defined by the compiler **only when hardware float is present**. Its absence on
  a RISC‑V target means soft‑float → auto‑disable rotation.
- This board's `Kibo.ino` also sets `#define EYES_NO_ROTATION` explicitly, as a guaranteed override.

**Tradeoff:** on the C6 the eye no longer *tilts*. Every other channel (position, size, eyelids,
pupil, iris, highlights) animates fully and smoothly. On an ESP32‑S3 / classic ESP32, remove
`EYES_NO_ROTATION` and rotation returns automatically (they have FPUs and render it fine).

The display flush was **also** switched from Adafruit's blocking blit to LovyanGFX async DMA (see
§5); that removed a separate ~11–15 ms/frame stall but was not the cause of the *rotation* freeze.

---

## 5. The rendering architecture that MUST be followed

This is the correct, proven architecture. Do not replace it with "draw directly to the panel" or
"move an LVGL object."

```
  Animation player (time-based)         ── produces a LiveEye pose every frame
        │
        ▼
  Offscreen RAM framebuffer             ── GFXcanvas16 (Adafruit_GFX), 240×240 RGB565
   (fillScreen + draw eye INTO it)         The eye is PIXELS redrawn at its new position,
        │                                  NOT an LVGL object being moved.
        ▼
  LVGL lv_canvas on lv_layer_top()      ── shows that buffer; survives UI screen switches
        │
        ▼
  Single windowed SPI flush (DMA)       ── LovyanGFX pushImageDMA(), asynchronous
```

Key invariants:

1. **Draw the whole frame into an offscreen buffer, then blit once.** Never let a drawing primitive
   write straight to the panel mid‑frame (that causes flicker and blows the frame budget). This is
   the same pattern RoboEyes_M uses via its `GC9A01A_RoboEyesDisplay` wrapper.
2. **The eye is redrawn into the buffer at its interpolated position every frame.** Position is
   *not* an LVGL widget coordinate and must not be animated by moving an `lv_obj`.
3. **Flush must be non‑blocking (DMA) when possible.** Blocking blits stall the loop for the whole
   transfer every frame.
4. **Eyes live on `lv_layer_top()`**, not on a screen, so `UI.showXScreen()` (which rebuilds/deletes
   screens) doesn't delete the eye canvas.

Reference flush + render loop:

```cpp
// Asynchronous DMA flush — returns immediately; loop keeps running during the transfer.
static void ui_disp_flush(lv_display_t* disp, const lv_area_t* area, uint8_t* px_map) {
  tft.pushImageDMA(area->x1, area->y1,
                   lv_area_get_width(area), lv_area_get_height(area),
                   reinterpret_cast<lgfx::rgb565_t*>(px_map));
  lv_display_flush_ready(disp);
}

// Two LVGL draw buffers so rendering pipelines against the DMA transfer:
lv_display_set_buffers(disp, s_buf1, s_buf2, sizeof(s_buf1), LV_DISPLAY_RENDER_MODE_PARTIAL);

// Per-frame eye render (runs from an lv_timer):
LiveEye live = UpdateEyes();               // interpolate pose for millis() now
s_canvas->fillScreen(EYE_COLOR_BACKGROUND);
eyesDrawEyePair(*s_canvas, 120, 120, live, liveRight, ...);  // eye drawn at live.eyePos
lv_obj_invalidate(s_obj);                  // whole canvas re-flushed
```

---

## 6. Performance considerations (ESP32 + SPI TFT)

- **A 240×240 RGB565 frame is 115,200 bytes.** At 80 MHz SPI that's ~11–12 ms just to transfer,
  every frame. With a *blocking* driver that time is added to `loop()`; with DMA it overlaps
  compute. Always prefer DMA (LovyanGFX / TFT_eSPI) on a display that changes every frame.
- **Per‑frame budget:** 30 FPS = 33 ms, 60 FPS = 16 ms. Raster + flush must fit inside it.
- **Two draw buffers** are required to actually pipeline DMA; a single buffer forces LVGL to wait.
- **Floating point is the hidden cost.** Gradients, glow, soft shadows, `sqrt` boundary math, and
  especially per‑pixel rotation are all float‑heavy. On an FPU chip they're cheap; on a soft‑float
  chip they dominate the frame.
- **SPI clock:** GC9A01 panels run 40 MHz reliably and usually 80 MHz. Drop to 40 MHz if you see
  pixel corruption on long/noisy wiring.

---

## 7. ESP32‑specific limitations & optimization techniques

### FPU presence by module (decisive for float‑heavy rendering)

| Module | Core | Hardware FPU? | Rotation / heavy float |
|---|---|---|---|
| ESP32 (classic) | Xtensa LX6 ×2 @240 | **Yes** | fine |
| ESP32‑S2 | Xtensa LX7 ×1 @240 | **Yes** | fine |
| ESP32‑S3 | Xtensa LX7 ×2 @240 | **Yes** | fine (best choice for rich eyes) |
| **ESP32‑C3** | RISC‑V ×1 @160 | **No** | avoid per‑pixel float |
| **ESP32‑C6** | RISC‑V ×1 @160 | **No** | avoid per‑pixel float (this board) |
| ESP32‑H2 | RISC‑V ×1 @96 | **No** | avoid per‑pixel float |

**Rule of thumb:** for the full rich visual style (gradients + glow + rotation) at a solid
30–60 FPS, use an **FPU chip (S3 / classic ESP32)**. On a soft‑float C‑series chip, keep rotation
off and prefer flatter styling — it will be smooth but capped lower (this project idles ~20 FPS on
the C6 even with rotation off, because the remaining gradient/glow float is still emulated).

### Optimizations, in order of impact
1. **Don't hit the per‑pixel rotation path on soft‑float chips** (the guard in §4).
2. **DMA flush + two buffers** (non‑blocking transfer).
3. **Reduce per‑pixel float** where you can: disable glow, use flat sclera instead of a gradient,
   thin/no border. This is what makes simple eye libraries fast.
4. **Move to an FPU chip** if the rich style at high FPS is a hard requirement.

---

## 8. Common mistakes to avoid

- ❌ **Animating `rotation` on a soft‑float board.** It silently switches to per‑pixel `cosf/sinf`
  and can take >1 s/frame. This is the exact bug this document exists for.
- ❌ **Assuming "position doesn't interpolate."** It does. A freeze‑then‑jump almost always means a
  *slow frame* + *time‑based sampling*, not a broken interpolation.
- ❌ **Blocking full‑frame blits** (`drawRGBBitmap` / `pushColors` without DMA) every frame.
- ❌ **Moving the eye by repositioning an LVGL object.** The eye is buffer pixels; move it by
  redrawing, not by `lv_obj_set_pos`.
- ❌ **Parenting the eye canvas to a screen.** `UI.showXScreen()` will delete it. Use
  `lv_layer_top()`.
- ❌ **A single LVGL draw buffer** when using DMA (kills the pipelining).
- ❌ **Adding `delay()` to "pace" animation.** Pace with the frame timer; time‑based interpolation
  already handles wall‑clock speed.
- ❌ **Editing the generated `eyes.h` / `ui.h` by hand and forgetting they get overwritten on
  re‑export.** Put durable changes in the studio exporter, or in `Kibo.ino`/`config.h`.

---

## 9. Best practices for smooth 30–60 FPS eye animation

- Keep the **render path branch‑light**: the common case (upright eye) must stay on the fast
  integer scanline path.
- Prefer **fields that interpolate numerically** for motion — position, width/height, eyelids,
  pupil — over discrete/expensive effects.
- Make playback **resilient to slow frames**: cap how far animation time may advance in a single
  frame, or tween per‑frame toward a target (RoboEyes style), so one heavy frame can't cause a jump.
- **Match the visual style to the silicon.** Rich (gradients/glow/rotation) → FPU chip. Soft‑float
  chip → flatter style, rotation off.
- **Measure, don't guess.** Keep the timing‑instrumentation pattern from §10 handy.

---

## 10. Troubleshooting checklist (new board / new display)

Work top to bottom; each step isolates a layer.

1. **Confirm the build is fresh.** Re‑flash and verify you're running the code you think you are
   (generated headers can silently revert to defaults). Check animation names actually exist.
2. **Add per‑frame Serial timing** to the render function and watch it:
   ```cpp
   uint32_t t0 = millis();
   LiveEye live = UpdateEyes();      uint32_t tU = millis();
   /* draw */                        uint32_t tD = millis();
   /* invalidate */
   if (tD - t0 > 100) { Serial.printf("SPIKE total=%lu update=%lu draw=%lu\n",
                                       millis()-t0, tU-t0, tD-tU); }
   ```
3. **Read the spike breakdown:**
   - `draw` huge → rasterizer. Check for **rotation on a soft‑float chip** first; then glow /
     gradient cost.
   - `update` huge → animation/combo logic (a pathological duration or loop).
   - both small but **FPS still low** → the flush is blocking, or the whole style is too heavy for
     the chip.
4. **Check the chip's FPU** (§7). No FPU → ensure rotation is off (`EYES_NO_ROTATION` or the
   auto‑detect) and expect a lower FPS ceiling.
5. **Check the flush is DMA + two buffers** (§5).
6. **If motion jumps but per‑field values change smoothly in the log** → it's a slow‑frame +
   time‑based‑sampling jump, not an interpolation bug. Fix the slow frame (or cap time advance).
7. **Colors wrong after a driver swap:** photo‑negative → `cfg.invert = false`; red/blue swapped →
   `cfg.rgb_order = true` (or cast the flush pointer to `lgfx::swap565_t*`).

---

## 11. TL;DR

The eye‑movement freeze was **per‑pixel `cosf/sinf` rotation running in software‑emulated float on
an FPU‑less ESP32‑C6** (~1.8 s/frame), turned into a visible *jump* by **time‑based interpolation**.
Fixed by **auto‑disabling rotation on soft‑float chips** (keeping it on FPU chips). Keep the
**offscreen‑buffer + single DMA blit** architecture, keep the upright eye on the **fast scanline
path**, and **match the visual richness to whether the chip has an FPU.**
