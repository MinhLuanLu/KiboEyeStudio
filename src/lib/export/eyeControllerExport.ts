// Generates `eyeController.h` — a small arbitration layer emitted ALONGSIDE `eyes.h` (see
// generateCppHeader in cppExport.ts). It is deliberately project-independent: it references only
// the generic player symbols eyes.h always exports, so its text is the same for every project and
// stays valid as long as eyes.h keeps that public API. Kept in its own module (not stitched into
// the giant eyes.h template) so the two files download as two separate entries in the export zip.
//
// Style note: matches the exported eyes.h — Allman braces, heavy header comments, and plain
// (non-`inline`, non-namespaced) globals, since the Arduino sketch is a single translation unit and
// eyes.h already relies on that. No C++17 `inline` variables / namespaces are used here either.

/** The full text of the companion `eyeController.h`. Returns a self-contained header that
 * `#include "eyes.h"` and arbitrates the single eyes playback slot between prioritized input
 * sources. Takes no project data — the file is identical across projects. */
export function generateEyeControllerHeader(): string {
  return `#ifndef EYE_CONTROLLER_H
#define EYE_CONTROLLER_H

/*
 * eyeController.h - a tiny arbitration layer on top of eyes.h.
 *
 * The eyes have exactly ONE playback slot: the last Combo() / PlayAnimation() /
 * PlayMultipleCombos() call wins and cuts off whatever was playing. When several inputs want the
 * eyes at once - a resting idle loop, a tilt/look sensor, a "shake" reaction - calling those
 * functions directly makes them fight (a reaction gets stomped by the idle loop one frame later,
 * and so on). This controller gives every input source a PRIORITY and one place to ASK for the
 * eyes, so higher-priority sources win, lower ones are ignored until the eyes are free, and a
 * "locked" clip is allowed to finish before an equal-priority source can cut in.
 *
 * It stores no animation data and never touches the display: it only reads eyes.h's own player
 * state and drives it through the same Combo() / PlayAnimation() / PlayMultipleCombos() you would
 * call by hand. Drop it next to eyes.h; it includes eyes.h itself.
 *
 * -- Wiring: call EyeControllerUpdate() once per loop(), right after UpdateEyes() ----------------
 *
 *   void loop()
 *   {
 *     UpdateEyes();            // eyes.h: advance the animation/combo player + draw
 *     EyeControllerUpdate();   // free the eyes the moment the current one-shot clip finishes
 *     // ... poll your sensors / buttons / network below and issue requests ...
 *   }
 *
 * -- How a source asks for the eyes -------------------------------------------------------------
 *
 *   // Resting idle: lowest priority, loops forever (a loop never blocks anything).
 *   EyeControllerRequestCombo(Idle, EYE_PRIORITY_IDLE, true);
 *
 *   // Tilt look-tracking: medium priority, plays once. Re-request whenever the target moves.
 *   if (tiltChanged)
 *     EyeControllerRequestCombo(LookUp, EYE_PRIORITY_SENSOR);
 *
 *   // Shake reaction: highest priority, LOCKED so nothing equal/lower interrupts it mid-clip
 *   // (the trailing "true" is the lock argument).
 *   if (shakeDetected)
 *     EyeControllerRequestAnimation(Surprised, EYE_PRIORITY_REACTION, true);
 *
 * -- Adding a new sensor (three lines) ----------------------------------------------------------
 *
 *   if (myButtonPressed())                                   // 1. read your input
 *     EyeControllerRequestCombo(Wink, EYE_PRIORITY_SENSOR);  // 2. request it at a priority
 *   // 3. done - if something higher owns the eyes, the request is ignored automatically.
 *
 * -- Sharing the screen with an LVGL UI (see the UI export) --------------------------------------
 *
 *   When the eyes hand the display over to an LVGL screen, the eye render timer is PAUSED, so a
 *   clip can never finish and any sensor still calling EyeControllerRequest* would mutate a frozen
 *   player. Call EyeControllerSetSuspended(true) while the eyes are hidden so every request is
 *   refused; call EyeControllerSetSuspended(false) once they are shown again. The eyes then resume
 *   exactly where they left off. The UI export's mode-switch glue does this for you in the right
 *   order (suspend -> EyesLvgl::Pause; EyesLvgl::Resume -> unsuspend).
 */

#include "eyes.h"
#include <initializer_list>

// Input-source priority. Higher wins. Assign each of your sources one of these; you can add your
// own values (the raw numeric order is all the comparisons below rely on).
enum EyePriority
{
    EYE_PRIORITY_NONE     = 0,  // nothing owns the eyes
    EYE_PRIORITY_IDLE     = 1,  // resting / autonomous idle
    EYE_PRIORITY_SENSOR   = 2,  // look tracking (tilt, etc.)
    EYE_PRIORITY_REACTION = 3   // one-shot reactions (shake, loud sound)
};

// Who currently owns the eyes, and whether their clip is "locked" (must finish before an
// equal-priority source may cut in). Plain globals, matching eyes.h's own non-inline globals.
EyePriority eyeControllerActive = EYE_PRIORITY_NONE;
bool        eyeControllerLocked = false;

// Suspend gate. While true, EyeControllerCanControl() returns false, so EVERY EyeControllerRequest*
// is refused and the eyes player is never touched. Set this true whenever the eyes are hidden
// behind an LVGL UI screen (EyesLvgl::Pause()): the eye render timer is paused then, so a one-shot
// clip would otherwise never reach "finished" and could wedge this controller, and any sensor still
// requesting a clip would mutate a frozen player and make the eyes jump on return. Suspending
// freezes arbitration so the eyes resume EXACTLY where they left off. Flip it via
// EyeControllerSetSuspended() from your display-mode switch (see the "Wiring" note up top).
bool eyeControllerSuspended = false;

void EyeControllerSetSuspended(bool s)
{
    eyeControllerSuspended = s;
}

bool EyeControllerIsSuspended()
{
    return eyeControllerSuspended;
}

// True only while a ONE-SHOT clip is still transitioning. A looping clip (a looping combo or a
// looping animation) is a resting state - it never ends, so it must never block arbitration - and
// so reports false. Reads eyes.h's player state directly (see eyes.h for these symbols).
bool EyeControllerIsPlaying()
{
    if (ComboPlaying())
    {
        // A combo owns the eyes. A one-shot combo counts as playing until ComboPlaying() itself
        // goes false; a looping combo is a resting state and never blocks.
        return !eyesPlayer.comboLoop;
    }
    if (eyesPlayer.playingAnimation)
    {
        if (eyesPlayer.animation.loop) return false;  // looping animation = resting state
        return (millis() - eyesPlayer.animStart) < eyesAnimationDurationMs(eyesPlayer.animation);
    }
    return false;
}

// Call once per loop(), right after UpdateEyes(). When the active one-shot clip has finished (or
// only a loop/idle is left), release ownership so the next request of ANY priority is accepted.
void EyeControllerUpdate()
{
    if (eyeControllerActive != EYE_PRIORITY_NONE && !EyeControllerIsPlaying())
    {
        eyeControllerActive = EYE_PRIORITY_NONE;
        eyeControllerLocked = false;
    }
}

// Can a source of priority p take the eyes right now?
//   - free (nobody owns them, or the current clip already finished) -> yes
//   - locked   -> only a STRICTLY higher priority may interrupt
//   - unlocked -> an equal-or-higher priority may take over
bool EyeControllerCanControl(EyePriority p)
{
    if (eyeControllerSuspended) return false;   // eyes are hidden -> refuse every request
    if (eyeControllerActive == EYE_PRIORITY_NONE || !EyeControllerIsPlaying())
        return true;
    if (eyeControllerLocked)
        return p > eyeControllerActive;
    return p >= eyeControllerActive;
}

// The priority that currently owns the eyes (EYE_PRIORITY_NONE if free).
EyePriority EyeControllerCurrentPriority()
{
    return eyeControllerActive;
}

// True while a source owns the eyes with a clip still playing.
bool EyeControllerBusy()
{
    return eyeControllerActive != EYE_PRIORITY_NONE && EyeControllerIsPlaying();
}

// Force-release ownership. Does NOT stop the eyes (the current clip keeps playing/looping); it
// just lets any priority take over on the next request.
void EyeControllerRelease()
{
    eyeControllerActive = EYE_PRIORITY_NONE;
    eyeControllerLocked = false;
}

// -- Requests -----------------------------------------------------------------------------------
// Each returns true and starts the clip if priority p is allowed to take the eyes right now;
// otherwise it returns false and plays nothing. loop = repeat forever (a resting state); lock =
// this clip must finish before an equal/lower priority source can cut in.

bool EyeControllerRequestCombo(const AnimationCombo& c, EyePriority p, bool loop = false, bool lock = false)
{
    if (!EyeControllerCanControl(p)) return false;
    Combo(c, loop);
    eyeControllerActive = p;
    eyeControllerLocked = lock;
    return true;
}

bool EyeControllerRequestAnimation(const EyeAnimation& a, EyePriority p, bool lock = false)
{
    if (!EyeControllerCanControl(p)) return false;
    PlayAnimation(a);
    eyeControllerActive = p;
    eyeControllerLocked = lock;
    return true;
}

bool EyeControllerRequestCombos(std::initializer_list<const AnimationCombo*> combos, EyePriority p, bool loop = false, bool lock = false)
{
    if (!EyeControllerCanControl(p)) return false;
    PlayMultipleCombos(combos, loop);
    eyeControllerActive = p;
    eyeControllerLocked = lock;
    return true;
}

#endif // EYE_CONTROLLER_H
`
}
