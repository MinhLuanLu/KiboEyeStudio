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
 *   // Tilt look-tracking: medium priority, loops if Loop is on for LookUp in the studio.
 *   if (tiltChanged)
 *     EyeControllerRequestCombo(LookUp, EYE_PRIORITY_SENSOR);
 *
 *   // Shake reaction: highest priority, LOCKED so nothing equal/lower interrupts it mid-clip
 *   // (the trailing "true" is the lock argument).
 *   if (shakeDetected)
 *     EyeControllerRequestAnimation(Surprised, EYE_PRIORITY_REACTION, true);
 *
 * -- Which request to use -----------------------------------------------------------------------
 *
 *   one combo                     EyeControllerRequestCombo(LookUp, EYE_PRIORITY_SENSOR, true);
 *   a list of combos              EyeControllerRequestCombos({ &Idle, &IdleNormal }, EYE_PRIORITY_IDLE, true);
 *   one animation                 EyeControllerRequestAnimation(Anim_IdleLookUp, EYE_PRIORITY_SENSOR);
 *   a saved transition            EyeControllerRequestTransitionByName("Look Down To Look Left", EYE_PRIORITY_SENSOR);
 *   animation, THEN combos        EyeControllerRequestAnimationThenCombos(Anim_LookUpToIdle, EYE_PRIORITY_SENSOR,
 *                                     { &Idle, &IdleNormal }, EYE_PRIORITY_IDLE, true);
 *
 *   Never call two requests back to back for "this then that". Both run in the same loop pass, so
 *   the second replaces the first before it draws a single frame. Use
 *   EyeControllerRequestAnimationThenCombos() instead.
 *
 *   Make requests when something CHANGES (a new tilt, a button press), not every loop. Asking for
 *   the same clip every loop restarts it from frame 0 each time, so it looks frozen.
 *
 * -- Example: reacting to a tilt change ---------------------------------------------------------
 *
 *   if (currentPosition == CENTER) {
 *     switch (newPosition) {
 *       case DOWN:
 *         EyeControllerRequestCombo(LookDown, EYE_PRIORITY_SENSOR, true);
 *         break;
 *       case UP:
 *         EyeControllerRequestAnimationThenCombos(
 *             Anim_IdleLookUp, EYE_PRIORITY_SENSOR,
 *             { &LookUp }, EYE_PRIORITY_SENSOR,
 *             true);
 *         break;
 *     }
 *   }
 *
 * -- lock vs waitToFinish -----------------------------------------------------------------------
 *
 *   Both stop an equal-priority request from cutting a clip off. The difference is what happens to
 *   the request that arrives while the clip is still playing:
 *
 *     lock = true          the request is REFUSED and lost
 *     waitToFinish = true  the request is HELD and plays the moment the clip ends
 *
 *   Only the newest held request is kept, so a tilt that changes three times during a clip plays
 *   just the last one. A STRICTLY higher priority still interrupts immediately either way, so a
 *   shake reaction is never delayed. On a looping clip, waitToFinish waits for the end of the
 *   current loop cycle (or the end of the combo currently playing in a list) and switches there.
 *
 *   // Let the transition play out completely even if the keychain is tilted again mid-way
 *   EyeControllerRequestAnimation(Anim_LookUpToIdle, EYE_PRIORITY_SENSOR, false, true);
 *
 * -- How to use waitToFinish --------------------------------------------------------------------
 *
 *   waitToFinish is the LAST argument of every request function:
 *
 *     EyeControllerRequestCombo(combo, priority, loop, lock, waitToFinish);
 *     EyeControllerRequestAnimation(animation, priority, lock, waitToFinish);
 *     EyeControllerRequestCombos({ &a, &b }, priority, loop, lock, waitToFinish);
 *     EyeControllerRequestAnimationThenCombos(animation, priority, { &a, &b }, nextPriority,
 *                                             loop, lock, nextLock, waitToFinish);
 *
 *   C++ cannot skip arguments, so to set waitToFinish you must also write every argument before it
 *   (pass false for the ones you do not want).
 *
 *   Example - UP to CENTER, the look-down transition always plays to the end:
 *
 *     EyeControllerRequestAnimationThenCombos(
 *         Anim_LookUpToIdle, EYE_PRIORITY_SENSOR,
 *         { &Idle, &IdleNormal },
 *         EYE_PRIORITY_IDLE,
 *         true,    // loop the idle combos
 *         false,   // lock
 *         false,   // nextLock
 *         true     // waitToFinish
 *     );
 *
 *   Example - RELAXING to UP, the look-up animation always plays to the end:
 *
 *     EyeControllerRequestAnimationThenCombos(
 *         Anim_IdleLookUp, EYE_PRIORITY_SENSOR,
 *         { &LookUp },
 *         EYE_PRIORITY_SENSOR,
 *         true,    // loop LookUp
 *         false,   // lock
 *         false,   // nextLock
 *         true     // waitToFinish
 *     );
 *
 *   Example - a single animation or combo:
 *
 *     EyeControllerRequestAnimation(Anim_LookUpToIdle, EYE_PRIORITY_SENSOR, false, true);  // lock, waitToFinish
 *     EyeControllerRequestCombo(Shy, EYE_PRIORITY_SENSOR, false, false, true);            // loop, lock, waitToFinish
 *
 *   What you will see - the keychain is put down, Anim_LookUpToIdle starts, and it is picked up
 *   again halfway through:
 *
 *     without waitToFinish  the look-up cuts in immediately; the look-down stops halfway
 *     with waitToFinish     the look-down finishes first, THEN the look-up plays
 *                           (the chained idle combos are skipped, the newer request replaces them)
 *
 *   A shake or anything at EYE_PRIORITY_REACTION still cuts in immediately, because it is a higher
 *   priority.
 *
 *   On a LOOP (the LookUp loop, the idle loop) waitToFinish holds the change until the current
 *   cycle ends, or until the combo currently playing in a list ends, then switches. The switch then
 *   lands on the pose the loop naturally returns to instead of snapping mid-movement. A long clip
 *   means a longer wait, so leave waitToFinish off a loop that must react instantly.
 *
 *   waitToFinish protects the clip it is set ON, not the one before it. If the clip on screen was
 *   requested without it, the next request still cuts it off immediately.
 *
 *   Every switch blends: eyes.h eases from the pose on screen into the new clip's first frame over
 *   EYES_TRANSITION_MS (set in the studio's Transition Simulator, or SetTransition() at runtime;
 *   0 = hard cut). A blending one-shot counts as playing, so it is protected like the clip itself.
 *   waitToFinish still decides WHEN the switch happens; the transition decides how it looks.
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

// Who currently owns the eyes, whether their clip is "locked" (must finish before an
// equal-priority source may cut in), and whether it is "wait to finish" (equal/lower requests are
// held until it ends instead of refused). Plain globals, matching eyes.h's own non-inline globals.
EyePriority eyeControllerActive = EYE_PRIORITY_NONE;
bool        eyeControllerLocked = false;
bool        eyeControllerWait   = false;

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

// EyeControllerIsPlaying()
//   Low-level check used by everything below. You rarely need it; prefer EyeControllerBusy().
// True only while a ONE-SHOT clip is still transitioning. A looping clip (a looping combo, a looping
// combo list, or a looping animation) is a resting state - it never ends, so it must never block
// arbitration - and so reports false. Reads eyes.h's player state directly (see eyes.h for these
// symbols).
bool EyeControllerIsPlaying()
{
    if (ComboPlaying())
    {
        // A looping PlayMultipleCombos() list plays each combo with loop=false and wraps the index
        // itself, so comboLoop alone would report it as a one-shot that blocks forever.
        if (eyesPlayer.comboSequencePlaying && eyesPlayer.comboSequenceLoop) return false;
        return !eyesPlayer.comboLoop;
    }
    if (eyesPlayer.playingAnimation)
    {
        if (eyesPlayer.animation.loop) return false;  // looping animation = resting state
        if (EyesTransitioning()) return true;          // still blending in; its clock starts after
        return (millis() - eyesPlayer.animStart) < eyesAnimationDurationMs(eyesPlayer.animation);
    }
    return false;
}

// -- Jobs ---------------------------------------------------------------------------------------
// Every request is stored as a job: an optional animation that plays first, then an optional list
// of combos. Storing them this way lets a request be held (waitToFinish) or chained (animation then
// combos) and started later from EyeControllerUpdate().

struct EyeControllerJob
{
    const EyeAnimation*   animation = nullptr;
    const EyeTransition*  transition = nullptr;  // a saved transition (plays instead of animation/combos)
    const AnimationCombo* combos[EYES_MAX_ANIMATION_SEQUENCE] = {};
    uint8_t     comboCount   = 0;
    bool        singleCombo  = false;  // true -> Combo(), false -> combo list
    bool        loop         = false;  // applies to the combos
    EyePriority priority     = EYE_PRIORITY_NONE;
    EyePriority nextPriority = EYE_PRIORITY_NONE;  // combos' priority when they follow an animation
    bool        lock         = false;
    bool        nextLock     = false;
    bool        wait         = false;
};

// A request held because the current clip is waitToFinish. Newest replaces older.
EyeControllerJob eyeControllerDeferred;
bool             eyeControllerDeferredPending = false;

// Combos queued behind the animation currently playing.
EyeControllerJob eyeControllerNext;
bool             eyeControllerNextPending = false;

void eyeControllerPlayCombos(const EyeControllerJob& job)
{
    if (job.singleCombo)
    {
        Combo(*job.combos[0], job.loop);
        return;
    }

    // Same as PlayMultipleCombos(), which only takes an initializer_list
    for (uint8_t i = 0; i < job.comboCount; i++)
        eyesPlayer.comboSequence[i] = job.combos[i];

    eyesPlayer.sequencePlaying      = false;
    eyesPlayer.playingAnimation     = false;
    eyesPlayer.comboSequenceCount   = job.comboCount;
    eyesPlayer.comboSequenceIndex   = 0;
    eyesPlayer.comboSequenceLoop    = job.loop;
    eyesPlayer.comboSequencePlaying = true;
    eyesStartCombo(*eyesPlayer.comboSequence[0], false);
}

// -- Loop boundaries ----------------------------------------------------------------------------
// A loop never finishes, so waitToFinish on a loop means "switch at the end of the current cycle"
// (or, for a combo list, the end of the combo currently playing). Switching there starts the new
// clip from the pose the loop naturally returns to, instead of snapping away from the middle of a
// movement.

// True while the eyes are showing a looping clip
bool eyeControllerLooping()
{
    if (ComboPlaying())
        return eyesPlayer.comboLoop ||
               (eyesPlayer.comboSequencePlaying && eyesPlayer.comboSequenceLoop);
    if (eyesPlayer.playingAnimation)
        return eyesPlayer.animation.loop;
    return false;
}

// Where playback is: a start time plus a cycle number. Either changes exactly when a new cycle or
// a new combo in a list begins.
void eyeControllerCyclePosition(unsigned long& start, unsigned long& cycle)
{
    start = 0;
    cycle = 0;

    if (ComboPlaying())
    {
        start = eyesPlayer.comboStart;
        if (eyesPlayer.comboSequencePlaying)
        {
            cycle = eyesPlayer.comboSequenceIndex;   // comboStart also changes on every advance
        }
        else if (eyesPlayer.comboLoop)
        {
            // While blending in, comboStart is still in the future: the first cycle hasn't begun
            unsigned long d = eyesComboDurationMs(*eyesPlayer.combo);
            if (d > 0 && !EyesTransitioning()) cycle = (millis() - eyesPlayer.comboStart) / d;
        }
        return;
    }

    if (eyesPlayer.playingAnimation)
    {
        start = eyesPlayer.animStart;
        unsigned long d = eyesAnimationDurationMs(eyesPlayer.animation);
        if (d > 0 && !EyesTransitioning()) cycle = (millis() - eyesPlayer.animStart) / d;
    }
}

unsigned long eyeControllerLastStart = 0;
unsigned long eyeControllerLastCycle = 0;

// Remembers the current position. Returns true if a new cycle or combo began since the last call.
bool eyeControllerCycleBoundary()
{
    unsigned long start, cycle;
    eyeControllerCyclePosition(start, cycle);

    bool changed = (start != eyeControllerLastStart) || (cycle != eyeControllerLastCycle);
    eyeControllerLastStart = start;
    eyeControllerLastCycle = cycle;
    return changed;
}

void eyeControllerStart(const EyeControllerJob& job)
{
    // Whatever was waiting belonged to the clip being replaced
    eyeControllerDeferredPending = false;
    eyeControllerNextPending = false;

    eyeControllerWait = job.wait;

    if (job.transition != nullptr)
    {
        PlayTransition(*job.transition);
        eyeControllerActive = job.priority;
        eyeControllerLocked = job.lock;
        eyeControllerCycleBoundary();
        return;
    }

    if (job.animation != nullptr)
    {
        PlayAnimation(*job.animation);
        eyeControllerActive = job.priority;
        eyeControllerLocked = job.lock;

        if (job.comboCount > 0)
        {
            eyeControllerNext = job;
            eyeControllerNext.animation = nullptr;
            eyeControllerNext.priority  = job.nextPriority;
            eyeControllerNext.lock      = job.nextLock;
            eyeControllerNextPending    = true;
        }

        // Starting a clip is not a boundary of the new clip
        eyeControllerCycleBoundary();
        return;
    }

    if (job.comboCount == 0) return;

    eyeControllerPlayCombos(job);
    eyeControllerActive = job.priority;
    eyeControllerLocked = job.lock;
    eyeControllerCycleBoundary();
}

// ===============================================================================================
// EyeControllerUpdate()
// ===============================================================================================
// WHAT IT DOES
//   Checks whether the current one-shot clip has finished. When it has, it starts whatever was
//   waiting for it, in this order:
//     1. a request held by waitToFinish (the newest one)
//     2. the combos chained behind an animation by EyeControllerRequestAnimationThenCombos()
//     3. nothing waiting -> releases the eyes so ANY priority can take them next
//   For a waitToFinish LOOP, a held request starts at the end of the current loop cycle (or the
//   end of the combo currently playing in a list), so the switch lands on a natural pose.
//
// HOW TO USE
//   Call it once every loop(), right after UpdateEyes(). Without it, chained combos and held
//   requests never start, and the eyes freeze on the last frame of the animation.
//
//     void loop() {
//       LiveEye live = UpdateEyes();
//       LiveEye liveRight = UpdateEyesRight();
//       EyeControllerUpdate();          // <- here
//       ...
//     }
void EyeControllerUpdate()
{
    if (eyeControllerSuspended) return;

    // Tracked every frame so the frame a cycle ends is never missed
    bool boundary = eyeControllerCycleBoundary();

    if (EyeControllerIsPlaying()) return;

    bool waitingLoop = eyeControllerWait && eyeControllerLooping();

    if (eyeControllerDeferredPending)
    {
        // A waitToFinish loop is still mid-cycle: keep holding the request
        if (waitingLoop && !boundary) return;

        // A newer request beats the old plan chained behind the clip that just ended
        eyeControllerStart(eyeControllerDeferred);
        return;
    }

    if (eyeControllerNextPending)
    {
        eyeControllerStart(eyeControllerNext);
        return;
    }

    // A waitToFinish loop keeps ownership, so later requests are held instead of cutting it off
    if (waitingLoop) return;

    if (eyeControllerActive != EYE_PRIORITY_NONE)
    {
        eyeControllerActive = EYE_PRIORITY_NONE;
        eyeControllerLocked = false;
        eyeControllerWait   = false;
    }
}

// ===============================================================================================
// EyeControllerCanControl(priority)
// ===============================================================================================
// WHAT IT DOES
//   Answers "could a request at this priority start RIGHT NOW?" without playing anything.
//     - eyes free (nobody owns them, or the clip already finished) -> true
//     - current clip is locked or waitToFinish -> true only for a STRICTLY higher priority
//     - otherwise -> true for an equal or higher priority
//   The Request functions call this for you; you only need it to check before doing extra work.
//
// HOW TO USE
//   if (EyeControllerCanControl(EYE_PRIORITY_SENSOR)) { /* e.g. start a sound with the look */ }
bool EyeControllerCanControl(EyePriority p)
{
    if (eyeControllerSuspended) return false;   // eyes are hidden -> refuse every request
    if (eyeControllerActive == EYE_PRIORITY_NONE || !EyeControllerIsPlaying())
        return true;
    if (eyeControllerLocked || eyeControllerWait)
        return p > eyeControllerActive;
    return p >= eyeControllerActive;
}

// The priority that currently owns the eyes (EYE_PRIORITY_NONE if free).
EyePriority EyeControllerCurrentPriority()
{
    return eyeControllerActive;
}

// EyeControllerBusy()
//   True while someone owns the eyes AND their one-shot clip is still playing. False while a loop
//   is running, because loops never block anyone.
//     if (!EyeControllerBusy()) { /* eyes are free, safe to start something new */ }
bool EyeControllerBusy()
{
    return eyeControllerActive != EYE_PRIORITY_NONE && EyeControllerIsPlaying();
}

// EyeControllerHasWaiting()
//   True while a request is being held until a waitToFinish clip ends. Handy for debugging:
//     Serial.println(EyeControllerHasWaiting() ? "request waiting" : "nothing waiting");
bool EyeControllerHasWaiting()
{
    return eyeControllerDeferredPending;
}

// EyeControllerRelease()
//   Emergency reset. Forgets who owns the eyes and drops anything waiting or chained. It does NOT
//   stop what is on screen; the current clip keeps playing. The next request of any priority wins.
//     EyeControllerRelease();
//     EyeControllerRequestCombos({ &Idle, &IdleNormal }, EYE_PRIORITY_IDLE, true);
void EyeControllerRelease()
{
    eyeControllerActive = EYE_PRIORITY_NONE;
    eyeControllerLocked = false;
    eyeControllerWait   = false;
    eyeControllerDeferredPending = false;
    eyeControllerNextPending = false;
}

// Plays the job now, holds it behind a waitToFinish clip, or refuses it.
bool eyeControllerSubmit(const EyeControllerJob& job)
{
    if (eyeControllerSuspended) return false;

    // Equal or lower priority arriving during a waitToFinish clip (one-shot or loop): hold it rather
    // than drop it or cut the clip off. Checked before CanControl, which would refuse it.
    bool waitingClip = eyeControllerWait &&
                       eyeControllerActive != EYE_PRIORITY_NONE &&
                       (EyeControllerIsPlaying() || eyeControllerLooping());

    if (waitingClip && job.priority <= eyeControllerActive)
    {
        eyeControllerDeferred = job;
        eyeControllerDeferredPending = true;
        return true;
    }

    if (!EyeControllerCanControl(job.priority)) return false;

    eyeControllerStart(job);
    return true;
}

// Copies an initializer_list of combo pointers into a job, skipping nulls
void eyeControllerSetCombos(EyeControllerJob& job, std::initializer_list<const AnimationCombo*> combos)
{
    job.comboCount = 0;
    for (const AnimationCombo* combo : combos)
    {
        if (job.comboCount >= EYES_MAX_ANIMATION_SEQUENCE) break;
        if (combo == nullptr) continue;
        job.combos[job.comboCount++] = combo;
    }
}

// ===============================================================================================
// REQUESTS - the functions you call to make the eyes do something
// ===============================================================================================
// Always use these instead of Combo() / PlayAnimation() / PlayMultipleCombos() directly, so
// priorities are respected.
//
// RETURN VALUE
//   true  -> started now, or held and will play once a waitToFinish clip ends
//   false -> refused (something higher/locked owns the eyes); it will never play
//
// ARGUMENTS (same meaning in every Request function)
//   priority      who is asking: EYE_PRIORITY_IDLE < EYE_PRIORITY_SENSOR < EYE_PRIORITY_REACTION
//   loop          true = repeat forever. A loop never blocks other requests.
//   lock          true = must finish; equal/lower requests meanwhile are REFUSED (lost)
//   waitToFinish  true = must finish; equal/lower requests meanwhile are HELD and play after it
//
//   A strictly higher priority always interrupts, even a locked or waitToFinish clip.
//   Pass the global Anim_* / combo constants, never a temporary copy: they are kept by pointer.

// -----------------------------------------------------------------------------------------------
// EyeControllerRequestCombo(combo, priority, loop, lock, waitToFinish)
// -----------------------------------------------------------------------------------------------
// Plays ONE combo.
//
//   EyeControllerRequestCombo(LookUp, EYE_PRIORITY_SENSOR);                     // Loop as set in the studio
//   EyeControllerRequestCombo(LookUp, EYE_PRIORITY_SENSOR, true);               // loop forever
//   EyeControllerRequestCombo(Dizzy,  EYE_PRIORITY_REACTION, false, true);      // once, locked
//   EyeControllerRequestCombo(Shy,    EYE_PRIORITY_SENSOR, false, false, true); // once, wait to finish
bool EyeControllerRequestCombo(const AnimationCombo& c, EyePriority p, bool loop, bool lock = false, bool waitToFinish = false)
{
    EyeControllerJob job;
    job.combos[0]   = &c;
    job.comboCount  = 1;
    job.singleCombo = true;
    job.loop        = loop;
    job.priority    = p;
    job.lock        = lock;
    job.wait        = waitToFinish;
    return eyeControllerSubmit(job);
}

// -----------------------------------------------------------------------------------------------
// EyeControllerRequestAnimation(animation, priority, lock, waitToFinish)
// -----------------------------------------------------------------------------------------------
// Plays ONE animation (Anim_*). There is no loop argument: whether it loops is baked into the
// animation. When a one-shot animation ends the eyes hold its last frame, so if you want something
// to play afterwards use EyeControllerRequestAnimationThenCombos() instead.
//
//   EyeControllerRequestAnimation(Anim_IdleLookUp, EYE_PRIORITY_SENSOR);              // play
//   EyeControllerRequestAnimation(Anim_IdleLookUp, EYE_PRIORITY_SENSOR, true);        // locked
//   EyeControllerRequestAnimation(Anim_IdleLookUp, EYE_PRIORITY_SENSOR, false, true); // wait to finish
bool EyeControllerRequestAnimation(const EyeAnimation& a, EyePriority p, bool lock = false, bool waitToFinish = false)
{
    EyeControllerJob job;
    job.animation = &a;
    job.priority  = p;
    job.lock      = lock;
    job.wait      = waitToFinish;
    return eyeControllerSubmit(job);
}

// -----------------------------------------------------------------------------------------------
// EyeControllerRequestCombos({ &combo1, &combo2, ... }, priority, loop, lock, waitToFinish)
// -----------------------------------------------------------------------------------------------
// Plays SEVERAL combos one after another. Note the & in front of each name. With loop = true the
// whole list repeats from the first combo after the last one ends.
//
//   EyeControllerRequestCombos({ &Idle, &IdleNormal }, EYE_PRIORITY_IDLE, true);         // idle loop
//   EyeControllerRequestCombos({ &Shy, &Idle }, EYE_PRIORITY_SENSOR, false, false, true); // once, wait
bool EyeControllerRequestCombos(std::initializer_list<const AnimationCombo*> combos, EyePriority p, bool loop = false, bool lock = false, bool waitToFinish = false)
{
    EyeControllerJob job;
    eyeControllerSetCombos(job, combos);
    job.loop     = loop;
    job.priority = p;
    job.lock     = lock;
    job.wait     = waitToFinish;
    return eyeControllerSubmit(job);
}

// -----------------------------------------------------------------------------------------------
// EyeControllerRequestAnimationThenCombos(animation, priority, { &combos }, nextPriority,
//                                         loop, lock, nextLock, waitToFinish)
// -----------------------------------------------------------------------------------------------
// Plays an animation FIRST, then the combos once the animation has finished. Use this for a
// transition followed by a resting state.
//
// Do NOT call RequestAnimation() and RequestCombos() back to back for this. Both run in the same
// loop pass, so the combos replace the animation before it ever draws a frame.
//
//   priority      priority while the animation plays
//   nextPriority  priority once the combos take over (often lower, e.g. IDLE)
//   loop          loop the combos
//   lock          lock the animation
//   nextLock      lock the combos
//   waitToFinish  applies to both the animation and the combos
//
// If another request is held (waitToFinish) when the animation ends, that newer request plays
// instead of the chained combos.
//
//   // Look back down to idle, then loop the idle combos
//   EyeControllerRequestAnimationThenCombos(
//       Anim_LookUpToIdle, EYE_PRIORITY_SENSOR,
//       { &Idle, &IdleNormal }, EYE_PRIORITY_IDLE,
//       true);                               // loop
//
//   // Same, but the look-down transition always plays to the end
//   EyeControllerRequestAnimationThenCombos(
//       Anim_LookUpToIdle, EYE_PRIORITY_SENSOR,
//       { &Idle, &IdleNormal }, EYE_PRIORITY_IDLE,
//       true, false, false, true);           // loop, lock, nextLock, waitToFinish
bool EyeControllerRequestAnimationThenCombos(
    const EyeAnimation& a, EyePriority p,
    std::initializer_list<const AnimationCombo*> combos, EyePriority nextPriority,
    bool loop = false, bool lock = false, bool nextLock = false, bool waitToFinish = false)
{
    EyeControllerJob job;
    job.animation = &a;
    eyeControllerSetCombos(job, combos);
    job.loop         = loop;
    job.priority     = p;
    job.nextPriority = nextPriority;
    job.lock         = lock;
    job.nextLock     = nextLock;
    job.wait         = waitToFinish;
    return eyeControllerSubmit(job);
}


// -----------------------------------------------------------------------------------------------
// EyeControllerRequestTransition(transition, priority, lock, waitToFinish)
// EyeControllerRequestTransitionByName("Name", priority, lock, waitToFinish)
// -----------------------------------------------------------------------------------------------
// Plays a saved transition (studio Transitions panel): its target animation or combination starts
// from whatever is on screen with the transition's own blend. Whether it loops is saved with the
// transition. ByName returns false for an unknown name.
//
//   EyeControllerRequestTransitionByName("Look Down To Look Left", EYE_PRIORITY_SENSOR);
//   EyeControllerRequestTransition(Trans_LookDownToLookLeft, EYE_PRIORITY_SENSOR, false, true);  // wait to finish
bool EyeControllerRequestTransition(const EyeTransition& t, EyePriority p, bool lock = false, bool waitToFinish = false)
{
    EyeControllerJob job;
    job.transition = &t;
    job.loop       = t.loop;
    job.priority   = p;
    job.lock       = lock;
    job.wait       = waitToFinish;
    return eyeControllerSubmit(job);
}

bool EyeControllerRequestTransitionByName(const char* name, EyePriority p, bool lock = false, bool waitToFinish = false)
{
    const EyeTransition* t = FindTransition(name);
    return t != nullptr && EyeControllerRequestTransition(*t, p, lock, waitToFinish);
}

// Shorthands with a priority — the same as the two functions above, so a sensor handler can write:
//   PlayTransition(Trans_IdleToLookUp, EYE_PRIORITY_SENSOR);
//   playTransition("Idle To Look Up", EYE_PRIORITY_SENSOR);
bool PlayTransition(const EyeTransition& t, EyePriority p, bool lock = false, bool waitToFinish = false)
{
    return EyeControllerRequestTransition(t, p, lock, waitToFinish);
}

bool PlayTransition(const char* name, EyePriority p, bool lock = false, bool waitToFinish = false)
{
    return EyeControllerRequestTransitionByName(name, p, lock, waitToFinish);
}

bool playTransition(const char* name, EyePriority p, bool lock = false, bool waitToFinish = false)
{
    return EyeControllerRequestTransitionByName(name, p, lock, waitToFinish);
}

// EyeControllerRequestCombo(combo, priority) with no loop argument uses the Loop setting saved in the
// studio for that combination, exactly like Combo(combo).
bool EyeControllerRequestCombo(const AnimationCombo& c, EyePriority p)
{
    return EyeControllerRequestCombo(c, p, c.loop);
}


/* EXAMPEL USE ///
    EyeControllerRequestCombos(
    { &Idle, &IdleNormal, &CuriousGlance, &IdleNormal, &IdleNormal, &LookingAround, &Idle, &IdleNormal, &Suspicious,  &Idle, &IdleNormal, &Shy, &Idle, &IdleNormal },
    EYE_PRIORITY_IDLE,
    true    // loop the whole list
    );
*/

#endif // EYE_CONTROLLER_H
`
}
