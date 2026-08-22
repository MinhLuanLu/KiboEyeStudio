// Renders frames from the exported eyes.h exactly the way the generated sketch's loop() does.
//
//   argv[1]  path to write frames to (a %d in the name is replaced by the sample index)
//   argv[2..] timestamps in ms to sample, relative to the start call
//
// EYES_START_CALL is injected by the harness (-D) so any combo/animation/expression can be driven
// without editing this file.
#include "host_gfx.h"

unsigned long g_hostMillis = 0;
HostSerial Serial;

#include "eyes_under_test.h"

#ifndef EYES_START_CALL
#define EYES_START_CALL
#endif

static HostCanvas eyesFrame(EYE_DISPLAY_WIDTH, EYE_DISPLAY_HEIGHT);

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: render <out%%d.ppm> <ms>...\n"); return 1; }
  g_hostMillis = 0;
  EYES_START_CALL;

  for (int i = 2; i < argc; i++) {
    // Step the virtual clock forward in frame-sized ticks rather than jumping straight to the
    // sample time: the player advances state per call (frame index, combo clip, transitions), so
    // teleporting the clock would skip the state machine and mis-report anything time-dependent.
    unsigned long target = (unsigned long)strtoul(argv[i], nullptr, 10);
    while (g_hostMillis < target) {
      unsigned long step = target - g_hostMillis;
      if (step > EYE_FRAME_DELAY_MS) step = EYE_FRAME_DELAY_MS;
      g_hostMillis += step;
      UpdateEyes();
      UpdateEyesRight();
    }
    LiveEye live = UpdateEyes();
    LiveEye liveRight = UpdateEyesRight();
    eyesFrame.fillScreen(EYE_COLOR_BACKGROUND);
    eyesDrawEyePair(eyesFrame, EYE_DISPLAY_WIDTH / 2, EYE_DISPLAY_HEIGHT / 2, live, liveRight,
                    EYE_COLOR_BACKGROUND, eyesPlayer.colorsLeft, eyesPlayer.colorsRight);
    char path[1024];
    snprintf(path, sizeof(path), argv[1], i - 2);
    eyesFrame.writePPM(path);
  }
  return 0;
}
