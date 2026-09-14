/**
 * Clip-transition parity: Transition Simulator (studio) vs the exported eyes.h player.
 *
 * Run with: npx tsx --tsconfig tsconfig.web.json scripts/verifyTransitionParity.ts
 *          (or: npm run verify:transitions)   — needs g++ on PATH.
 *
 * Builds a small project (a one-shot, a looping and a coloured animation plus two combinations),
 * exports eyes.h, and compiles it into a native test program with a fake millis(). Every scenario
 * (animation->animation, animation->combination, combination->animation, combination->combination,
 * a rapid interruption chain, bezier/bounce easing, a restart and a 0 ms hard cut) is replayed on
 * both sides at 20 ms steps and every sampled eye field and colour is diffed. It also checks that
 * a blended switch never moves any field more per frame than a hard cut would.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultProject } from '../src/state/store'
import { anim, kf } from '../src/data/helpers'
import { DEFAULT_EYE_COLORS, DEFAULT_TRANSITION_INTERPOLATION } from '../src/types'
import type { Animation, AnimationCombo, ClipTransition, EasingType, EyeParams, TransitionClipRef, TransitionInterpolation } from '../src/types'
import { generateCppHeader } from '../src/lib/export/cppExport'
import { generateEyeControllerHeader } from '../src/lib/export/eyeControllerExport'
import { computeComboTimeline } from '../src/engine/comboPlayback'
import {
  clipRefOf,
  quantizeBezier,
  settingsOfTransition,
  simulateTransitions,
  type ClipEvent,
  type PlayerFrame,
  type TransitionSettings
} from '../src/engine/transitionPlayback'
import { hexToRgb565 } from '../src/lib/color'

function fail(msg: string): never {
  console.error('FAIL: ' + msg)
  process.exit(1)
}

// ---- Project ---------------------------------------------------------------------------------
const project = createDefaultProject('TransitionParity')
const lookLeft = anim('LookLeft', false, [kf(400, 'easeOut'), kf(0, 'linear', { eyePosX: -30, pupilX: -20, upperEyelid: 20 })])
const breathe = anim('Breathe', true, [kf(500, 'easeInOut', { height: 80 }), kf(500, 'easeInOut', { height: 110, pupilY: 12 })])
const angry = anim('Angry', false, [
  kf(300, 'linear', { upperEyelid: 45, upperEyelidTilt: 20, width: 90 }),
  kf(0, 'linear', { upperEyelid: 55, upperEyelidTilt: 25, width: 95, eyePosY: 10 })
])
for (const k of angry.keyframes) k.colors = { ...DEFAULT_EYE_COLORS, sclera: '#ffd0d0', iris: '#cc2222' }
const animations: Animation[] = [lookLeft, breathe, angry]
project.animations = animations
project.expressions = []

function combo(name: string, loop: boolean, clips: { anim: Animation; loopCount?: number; transitionMs?: number; endDelayMs?: number }[]): AnimationCombo {
  const c: AnimationCombo = { id: name, name, loop, clips: [] }
  for (const [i, spec] of clips.entries()) {
    c.clips.push({
      id: `${name}-${i}`,
      animationId: spec.anim.id,
      startTimeMs: computeComboTimeline(c, animations).total,
      loopCount: spec.loopCount ?? 1,
      playbackSpeed: 100,
      transitionMs: spec.transitionMs ?? 0,
      endDelayMs: spec.endDelayMs ?? 0
    })
  }
  return c
}
const lookAround = combo('LookAround', true, [{ anim: breathe, loopCount: 2, transitionMs: 150 }, { anim: lookLeft, endDelayMs: 200 }])
const mad = combo('Mad', false, [{ anim: lookLeft, transitionMs: 120 }, { anim: angry }])
project.animationCombos = [lookAround, mad]

// Saved transitions (Transitions panel) — one per source/target type, with different
// interpolation settings, played on the device with playTransition("Name").
const aRef = (a: Animation): TransitionClipRef => ({ kind: 'animation', id: a.id, loop: false })
const cRef = (c: AnimationCombo, loop: boolean): TransitionClipRef => ({ kind: 'combo', id: c.id, loop })
function saved(
  name: string,
  source: TransitionClipRef,
  target: TransitionClipRef,
  durationMs: number,
  easing: EasingType,
  interp: Partial<TransitionInterpolation> = {},
  bezier: [number, number, number, number] = [0.42, 0, 0.58, 1]
): ClipTransition {
  return { id: name, name, source, target, durationMs, easing, bezier, interpolation: { ...DEFAULT_TRANSITION_INTERPOLATION, ...interp }, previewSwitchAfterMs: 1000, previewHoldMs: 1500 }
}
const tAA = saved('Breathe To Look Left', aRef(breathe), aRef(lookLeft), 280, 'easeOut')
const tAC = saved('Look Left To Look Around', aRef(lookLeft), cRef(lookAround, true), 400, 'linear', { position: false, switchAtPct: 30 })
const tCA = saved('Look Around To Angry', cRef(lookAround, true), aRef(angry), 350, 'easeInOut', { colors: false, eyelids: false, switchAtPct: 70 })
const tCC = saved('Mad To Look Around', cRef(mad, false), cRef(lookAround, true), 300, 'bezier', { pupil: false, shape: false }, [0.3, 0, 0.2, 1])
project.transitions = [tAA, tAC, tCA, tCC]

// ---- Scenarios -------------------------------------------------------------------------------
type Play =
  | { kind: 'animation'; a: Animation }
  | { kind: 'combo'; c: AnimationCombo; loop: boolean }
  | { kind: 'transition'; t: ClipTransition; viaController?: boolean }
interface Scenario {
  name: string
  settings: TransitionSettings
  events: { at: number; play: Play }[]
  endMs: number
  extraSamples?: number[]
}
const A = (a: Animation): Play => ({ kind: 'animation', a })
const C = (c: AnimationCombo, loop: boolean): Play => ({ kind: 'combo', c, loop })
const T = (t: ClipTransition, viaController = false): Play => ({ kind: 'transition', t, viaController })
const S = (durationMs: number, easing: EasingType, bezier: [number, number, number, number] = [0.42, 0, 0.58, 1]): TransitionSettings => ({ durationMs, easing, bezier })

const scenarios: Scenario[] = [
  { name: 'animation -> animation (mid-breath)', settings: S(300, 'easeInOut'), events: [{ at: 0, play: A(breathe) }, { at: 730, play: A(lookLeft) }], endMs: 1600 },
  { name: 'animation -> combination (mid-movement)', settings: S(300, 'easeInOut'), events: [{ at: 0, play: A(lookLeft) }, { at: 250, play: C(lookAround, true) }], endMs: 3600 },
  { name: 'combination -> animation (coloured target)', settings: S(300, 'easeInOut'), events: [{ at: 0, play: C(lookAround, true) }, { at: 1330, play: A(angry) }], endMs: 2400 },
  { name: 'combination -> combination', settings: S(300, 'easeInOut'), events: [{ at: 0, play: C(mad, false) }, { at: 600, play: C(lookAround, true) }], endMs: 2600 },
  {
    name: 'rapid interruptions (bounce)',
    settings: S(400, 'bounce'),
    events: [{ at: 0, play: A(breathe) }, { at: 700, play: A(lookLeft) }, { at: 820, play: C(mad, false) }, { at: 900, play: A(breathe) }],
    endMs: 2200
  },
  { name: 'bezier easing', settings: S(350, 'bezier', [0.2, 0.9, 0.3, 1.2]), events: [{ at: 0, play: A(breathe) }, { at: 410, play: C(mad, false) }], endMs: 1800 },
  { name: 'restart same combination', settings: S(300, 'easeOut'), events: [{ at: 0, play: C(lookAround, true) }, { at: 1500, play: C(lookAround, true) }], endMs: 2600 },
  { name: 'hard cut (0 ms)', settings: S(0, 'easeInOut'), events: [{ at: 0, play: A(breathe) }, { at: 730, play: A(lookLeft) }], endMs: 1400 },
  { name: 'standalone looping animation keeps looping (3 cycles)', settings: S(0, 'easeInOut'), events: [{ at: 0, play: A(breathe) }], endMs: 3300, extraSamples: [999, 1000, 1001, 2000, 3000] },
  { name: 'transition into a looping animation, several cycles', settings: S(250, 'easeOut'), events: [{ at: 0, play: A(lookLeft) }, { at: 300, play: A(breathe) }], endMs: 3400 },
  {
    name: 'control: looping combination wrap, no switch',
    settings: S(0, 'easeInOut'),
    events: [{ at: 0, play: C(lookAround, true) }],
    endMs: 2800,
    extraSamples: [2746, 2748, 2749, 2750, 2751, 2752, 2754]
  },
  { name: 'saved: animation -> animation, playTransition()', settings: S(300, 'easeInOut'), events: [{ at: 0, play: A(breathe) }, { at: 730, play: T(tAA) }], endMs: 1600 },
  {
    name: 'saved: animation -> combination, position switched at 30%',
    settings: S(300, 'easeInOut'),
    events: [{ at: 0, play: A(lookLeft) }, { at: 250, play: T(tAC) }],
    endMs: 1400
  },
  {
    name: 'saved: To combination loops (checked), blend plays once over 2 full loops',
    settings: S(300, 'easeInOut'),
    events: [{ at: 0, play: A(lookLeft) }, { at: 250, play: T(tAC) }],
    endMs: 6200
  },
  {
    name: 'saved: combination -> animation, colours + eyelids switched at 70%',
    settings: S(300, 'easeInOut'),
    events: [{ at: 0, play: C(lookAround, true) }, { at: 1330, play: T(tCA) }],
    endMs: 2200
  },
  {
    name: 'saved: combination -> combination, bezier, pupil + shape switched',
    settings: S(300, 'easeInOut'),
    events: [{ at: 0, play: C(mad, false) }, { at: 600, play: T(tCC) }],
    endMs: 1500
  },
  {
    name: 'saved: eyeController by name, interrupted mid-blend',
    settings: S(300, 'easeInOut'),
    events: [{ at: 0, play: A(breathe) }, { at: 500, play: T(tAC, true) }, { at: 640, play: T(tCA) }, { at: 760, play: A(lookLeft) }],
    endMs: 1800
  }
]

const STEP_MS = 20
const FIELDS = ['width', 'height', 'radius', 'distance', 'eyePosX', 'eyePosY', 'pupilWidth', 'pupilHeight', 'pupilX', 'pupilY', 'upperEyelid', 'lowerEyelid', 'upperEyelidTilt', 'highlightX', 'highlightY', 'highlightSize'] as const satisfies readonly (keyof EyeParams)[]
const RIGHT_FIELDS = ['eyePosX', 'upperEyelid'] as const satisfies readonly (keyof EyeParams)[]

function sampleTimes(sc: Scenario): number[] {
  const set = new Set<number>([...sc.events.map((e) => e.at), ...(sc.extraSamples ?? [])])
  for (let t = 0; t <= sc.endMs; t += STEP_MS) set.add(t)
  return [...set].sort((a, b) => a - b)
}

// ---- C++ harness -----------------------------------------------------------------------------
const header = generateCppHeader(project)
const cppPlay = (p: Play) =>
  p.kind === 'animation'
    ? `PlayAnimation(Anim_${p.a.name});`
    : p.kind === 'combo'
      ? `Combo(${p.c.name}, ${p.loop ? 'true' : 'false'});`
      : p.viaController
        ? `if (!EyeControllerRequestTransitionByName(${JSON.stringify(p.t.name.toLowerCase())}, EYE_PRIORITY_SENSOR)) std::printf("MISSING\\n");`
        : `if (!playTransition(${JSON.stringify(p.t.name)})) std::printf("MISSING\\n");`
const fmt = [...FIELDS, ...RIGHT_FIELDS].map(() => '%.4f').join(' ')
const args = [...FIELDS.map((f) => `eyesPlayer.live.${f}`), ...RIGHT_FIELDS.map((f) => `eyesPlayer.liveRight.${f}`)].join(', ')
const body = scenarios
  .map((sc, i) => {
    const [bx1, by1, bx2, by2] = quantizeBezier(sc.settings.bezier)
    const lines = [`  eyesPlayer = EyesPlayerState();`, `  EyeControllerRelease();`,`  SetTransition(${sc.settings.durationMs}, EYE_EASE_${{ linear: 'LINEAR', easeIn: 'IN', easeOut: 'OUT', easeInOut: 'INOUT', bounce: 'BOUNCE', elastic: 'ELASTIC', bezier: 'BEZIER' }[sc.settings.easing]}, ${bx1}, ${by1}, ${bx2}, ${by2});`]
    for (const t of sampleTimes(sc)) {
      lines.push(`  fakeMillis = ${t};`)
      for (const ev of sc.events.filter((e) => e.at === t)) lines.push(`  UpdateEyes(); ${cppPlay(ev.play)}`)
      lines.push(`  UpdateEyes(); dump(${i});`)
    }
    return `static void scenario${i}() {\n${lines.join('\n')}\n}`
  })
  .join('\n\n')
const cpp = `#include <cstdint>
#include <cmath>
#include <cstdio>
static unsigned long fakeMillis = 0;
unsigned long millis() { return fakeMillis; }
// Arduino core stand-ins (min/max are global macros there)
template <class A, class B> auto min(A a, B b) -> decltype(a + b) { return a < b ? a : b; }
template <class A, class B> auto max(A a, B b) -> decltype(a + b) { return a > b ? a : b; }
#define PROGMEM
#ifndef PI
#define PI 3.14159265358979f
#endif
#include "eyes.h"
#include "eyeController.h"

static void dump(int sc) {
  std::printf("%d %lu %d ${fmt} %u %u\\n", sc, fakeMillis, eyesPlayer.transitioning ? 1 : 0, ${args},
              (unsigned)eyesPlayer.colorsLeft.sclera, (unsigned)eyesPlayer.colorsLeft.iris);
}

${body}

int main() {
${project.animationCombos.map((c) => `  std::printf("combo ${c.id} %lu\\n", eyesComboDurationMs(${c.name}));`).join('\n')}
${scenarios.map((_, i) => `  scenario${i}();`).join('\n')}
  return 0;
}
`

const dir = join(tmpdir(), 'kibo-transition-parity')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'eyes.h'), header)
writeFileSync(join(dir, 'eyeController.h'), generateEyeControllerHeader())
writeFileSync(join(dir, 'main.cpp'), cpp)
const exe = join(dir, process.platform === 'win32' ? 'parity.exe' : 'parity')
try {
  execFileSync('g++', ['-std=gnu++17', '-O1', '-w', '-o', exe, join(dir, 'main.cpp')], { stdio: 'pipe' })
} catch (e) {
  const err = e as { stderr?: Buffer }
  fail(`g++ could not compile the exported header (${dir}):\n${err.stderr?.toString().split('\n').slice(0, 40).join('\n')}`)
}
console.log(`ok: exported eyes.h compiles with the transition player (${dir})`)
const out = execFileSync(exe, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const lines = out.trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/))
if (lines.some((l) => l[0] === 'MISSING')) fail('playTransition()/EyeControllerRequestTransitionByName() did not find a saved transition by name')
console.log('ok: every saved transition was found by name on the device (playTransition + eyeController, case-insensitive)')
const rows = lines.filter((l) => l[0] !== 'combo').map((l) => l.map(Number))

// Combination cycle length must match the studio timeline exactly (a loop's 0 ms closing frame used
// to count as 1 ms on the device, which made looping combos drift a few ms per cycle).
const comboDriftMs = new Map<string, number>()
for (const l of lines.filter((l) => l[0] === 'combo')) {
  const c = project.animationCombos.find((x) => x.id === l[1])!
  comboDriftMs.set(c.id, Number(l[2]) - computeComboTimeline(c, animations).total)
}
if ([...comboDriftMs.values()].some((d) => d !== 0)) fail(`combination durations differ from the studio: ${JSON.stringify([...comboDriftMs])}`)
console.log('ok: every combination lasts exactly as long on the device as in the studio (no loop drift)')
function inKnownWrapOffset(sc: Scenario, t: number, frame: PlayerFrame): boolean {
  const play = [...sc.events].reverse().find((e) => e.at <= t)?.play
  const active =
    play?.kind === 'combo'
      ? { combo: play.c, loop: play.loop }
      : play?.kind === 'transition' && play.t.target.kind === 'combo'
        ? { combo: project.animationCombos.find((c) => c.id === play.t.target.id)!, loop: play.t.target.loop }
        : null
  if (!active || !active.loop || frame.transitioning) return false
  const drift = comboDriftMs.get(active.combo.id) ?? 0
  const total = computeComboTimeline(active.combo, animations).total
  const cycle = Math.floor(frame.clipElapsedMs / total)
  return drift > 0 && cycle >= 1 && frame.clipElapsedMs % total <= cycle * drift
}

// ---- Compare ---------------------------------------------------------------------------------
const TOL = 1.0 // EyeFrame stores integer fields; interpolating rounded endpoints costs up to ~1 unit
const channels = (c: number) => [(c >> 11) & 31, (c >> 5) & 63, c & 31]
function eventOf(at: number, p: Play, hardCut: boolean): ClipEvent {
  if (p.kind === 'animation') return { atMs: at, ref: { kind: 'animation', id: p.a.id } }
  if (p.kind === 'combo') return { atMs: at, ref: { kind: 'combo', id: p.c.id, loop: p.loop } }
  const s = settingsOfTransition(p.t)
  return { atMs: at, ref: clipRefOf(p.t.target), settings: hardCut ? { ...s, durationMs: 0 } : s }
}

let failures = 0
for (const [i, sc] of scenarios.entries()) {
  const events: ClipEvent[] = sc.events.map((e) => eventOf(e.at, e.play, false))
  const cutEvents: ClipEvent[] = sc.events.map((e) => eventOf(e.at, e.play, true))
  const cut = { ...sc.settings, durationMs: 0 }
  // Groups a saved transition deliberately SWITCHES jump like a cut, so the "never jumps more than a
  // hard cut" check only applies to scenarios where everything blends.
  const allBlend = sc.events.every(
    (e) => e.play.kind !== 'transition' || JSON.stringify(e.play.t.interpolation) === JSON.stringify(DEFAULT_TRANSITION_INTERPOLATION)
  )
  const scRows = rows.filter((r) => r[0] === i)
  let maxDiff = 0
  let maxColorDiff = 0
  let maxBlendStep = 0
  let maxCutStep = 0
  let knownOffsetSamples = 0
  let prev: PlayerFrame | null = null
  let prevCut: PlayerFrame | null = null
  for (const row of scRows) {
    const t = row[1]
    const frame = simulateTransitions(project, events, t, sc.settings)
    const cutFrame = simulateTransitions(project, cutEvents, t, cut)
    if (!frame || !cutFrame) fail(`${sc.name}: simulator produced no frame at ${t}ms`)
    if (inKnownWrapOffset(sc, t, frame)) {
      knownOffsetSamples++
      prev = null
      prevCut = null
      continue
    }
    // Blending flag: must agree with the device, and a blend may only run right after its own
    // switch — never again when a looping To combination wraps around.
    const fwBlending = row[2] === 1
    if (fwBlending !== frame.transitioning && failures < 25) {
      failures++
      console.error(`  blending flag mismatch ${sc.name} @${t}ms: studio ${frame.transitioning} vs firmware ${fwBlending}`)
    }
    const insideSwitchWindow = events.some((ev) => t >= ev.atMs && t < ev.atMs + (ev.settings ?? sc.settings).durationMs)
    if (fwBlending && !insideSwitchWindow) {
      failures++
      console.error(`  ${sc.name} @${t}ms: the device is blending outside any switch (a transition repeated)`)
    }
    const values = [...FIELDS.map((f) => frame.left[f] as number), ...RIGHT_FIELDS.map((f) => frame.right[f] as number)]
    values.forEach((v, k) => {
      const d = Math.abs(v - row[3 + k])
      maxDiff = Math.max(maxDiff, d)
      if (d > TOL && failures < 25) {
        failures++
        const name = k < FIELDS.length ? FIELDS[k] : `right.${RIGHT_FIELDS[k - FIELDS.length]}`
        console.error(`  mismatch ${sc.name} @${t}ms ${name}: studio ${v.toFixed(3)} vs firmware ${row[3 + k].toFixed(3)}`)
      }
    })
    const base = 3 + values.length
    for (const [k, hex] of [frame.colorsLeft.sclera, frame.colorsLeft.iris].entries()) {
      const a = channels(hexToRgb565(hex))
      const b = channels(row[base + k])
      maxColorDiff = Math.max(maxColorDiff, ...a.map((x, j) => Math.abs(x - b[j])))
    }
    if (prev && prevCut) {
      for (const f of FIELDS) {
        maxBlendStep = Math.max(maxBlendStep, Math.abs((frame.left[f] as number) - (prev.left[f] as number)))
        maxCutStep = Math.max(maxCutStep, Math.abs((cutFrame.left[f] as number) - (prevCut.left[f] as number)))
      }
    }
    prev = frame
    prevCut = cutFrame
  }
  if (scRows.length !== sampleTimes(sc).length) fail(`${sc.name}: expected ${sampleTimes(sc).length} firmware rows, got ${scRows.length}`)
  if (maxColorDiff > 2) {
    failures++
    console.error(`  colour mismatch ${sc.name}: max RGB565 channel diff ${maxColorDiff}`)
  }
  if (sc.settings.durationMs > 0 && allBlend && maxBlendStep > maxCutStep + 1e-6) {
    failures++
    console.error(`  ${sc.name}: blended switch moved a field ${maxBlendStep.toFixed(2)}/frame, more than the hard cut (${maxCutStep.toFixed(2)})`)
  }
  console.log(
    `${maxDiff <= TOL && maxColorDiff <= 2 ? 'ok' : 'FAIL'}: ${sc.name} — ${scRows.length} frames, max field diff ${maxDiff.toFixed(3)}, max colour diff ${maxColorDiff}, ` +
      `largest per-frame step ${maxBlendStep.toFixed(2)} (hard cut ${maxCutStep.toFixed(2)})` +
      (knownOffsetSamples > 0 ? ` [${knownOffsetSamples} sample(s) inside the pre-existing combo loop-wrap offset, not compared]` : '')
  )
}

if (failures > 0) fail(`${failures} mismatch(es) between the simulator and the exported player`)
console.log('ok: Transition Simulator matches the exported ESP32 player for every scenario')
