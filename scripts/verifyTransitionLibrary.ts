/**
 * Saved transitions: library operations, persistence, JSON, export and compile checks.
 *
 * Run with: npx tsx --tsconfig tsconfig.web.json scripts/verifyTransitionLibrary.ts
 *          (or: npm run verify:transition-library)   — needs g++ on PATH.
 *
 * Drives the real store actions (create/rename/edit/duplicate/reorder/delete + undo), name
 * validation, project save/reopen, Project JSON, older and malformed project files, then the C++
 * export: identifiers, dedupe, sanitizing, skipped broken targets, no preview-only data, and a g++
 * build + run of the registry/lookup API (including eyeController.h) and of a project with no
 * transitions (backward compatibility). Playback parity itself is covered by verifyTransitionParity.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultProject, transitionNameMismatch, useStore, validateTransitionName } from '../src/state/store'
import { deserializeProjectFile, serializeProjectFile } from '../src/state/persistence'
import { projectToJson } from '../src/lib/export/jsonExport'
import { generateCppHeader } from '../src/lib/export/cppExport'
import { generateEyeControllerHeader } from '../src/lib/export/eyeControllerExport'
import { DEFAULT_TRANSITION_INTERPOLATION } from '../src/types'
import type { ClipTransition, Project, TransitionClipRef } from '../src/types'

function fail(msg: string): never {
  console.error('FAIL: ' + msg)
  process.exit(1)
}
function check(cond: unknown, msg: string) {
  if (!cond) fail(msg)
  console.log('ok: ' + msg)
}

const st = () => useStore.getState()
const find = (id: string) => st().project.transitions.find((t) => t.id === id)
type EditorStateArg = Parameters<typeof serializeProjectFile>[1]
const noEditorState = {} as EditorStateArg

// ---- Library operations ----------------------------------------------------------------------
st().newProject()
const [a0, a1] = st().project.animations
if (!a0 || !a1) fail('default project has fewer than two animations')
st().checkpoint()
const lookAroundId = st().addAnimationCombo('Look Around')
st().addAnimationComboClip(lookAroundId, a0.id)
st().addAnimationComboClip(lookAroundId, a1.id)
const shyId = st().addAnimationCombo('Shy')
st().addAnimationComboClip(shyId, a1.id)

const aRef = (id: string): TransitionClipRef => ({ kind: 'animation', id, loop: false })
const cRef = (id: string, loop = true): TransitionClipRef => ({ kind: 'combo', id, loop })
const draft = (name: string, source: TransitionClipRef, target: TransitionClipRef): Omit<ClipTransition, 'id'> => ({
  name,
  source,
  target,
  durationMs: 300,
  easing: 'easeInOut',
  bezier: [0.42, 0, 0.58, 1],
  interpolation: { ...DEFAULT_TRANSITION_INTERPOLATION },
  previewSwitchAfterMs: 1000,
  previewHoldMs: 1500
})

check(validateTransitionName('', []) !== null && validateTransitionName('   ', []) !== null, 'empty / blank names are rejected')
check(validateTransitionName('!!!', []) !== null, 'a name with no letters or digits is rejected')

st().checkpoint()
const idAA = st().addTransition(draft('Look Down To Look Left', aRef(a0.id), aRef(a1.id)))
const idAC = st().addTransition(draft('Look Left To Look Around', aRef(a1.id), cRef(lookAroundId)))
const idCA = st().addTransition(draft('Look Around To Blink', cRef(lookAroundId), aRef(a0.id)))
const idCC = st().addTransition(draft('Shy To Look Around', cRef(shyId, false), cRef(lookAroundId)))
check(st().project.transitions.length === 4 && st().dirty, 'created one transition per source/target type (A→A, A→C, C→A, C→C)')

const all = () => st().project.transitions
check(validateTransitionName('look down to look left', all()) !== null, 'a name differing only in case is rejected as a conflict')
check(validateTransitionName('Look-Down  to Look Left', all()) !== null, 'a name differing only in spacing/punctuation is rejected as a conflict')
check(validateTransitionName('Look Down To Look Left', all(), idAA) === null, 'renaming a transition to its own name is allowed')
check(validateTransitionName('Brand New', all()) === null, 'a unique name is accepted')

st().checkpoint()
st().renameTransition(idAA, 'Look Down → Left!')
check(find(idAA)?.name === 'Look Down → Left!', 'rename')

st().checkpoint()
st().updateTransition(idAC, { durationMs: 480.6, easing: 'bounce', interpolation: { ...find(idAC)!.interpolation, position: false, switchAtPct: 135 } })
const edited = find(idAC)!
check(edited.durationMs === 481 && edited.easing === 'bounce' && !edited.interpolation.position && edited.interpolation.switchAtPct === 100, 'edit duration/easing/interpolation (values clamped and rounded)')
st().updateTransition(idAA, { target: { ...aRef(a1.id), loop: true }, source: { ...cRef(lookAroundId), kind: 'animation', id: a0.id } })
check(find(idAA)!.target.loop === false && find(idAA)!.source.loop === false, 'loop can only be set on a combination (never on an animation From/To)')
st().undo()
check(find(idAC)!.durationMs === 300 && find(idAC)!.easing === 'easeInOut', 'undo restores the previous transition settings')
st().redo()
check(find(idAC)!.durationMs === 481, 'redo re-applies the edit')

st().checkpoint()
const dupId = st().duplicateTransition(idCA)
const dup = find(dupId)!
check(dup && dup.id !== idCA && dup.name === 'Look Around To Blink Copy' && all().indexOf(dup) === all().findIndex((t) => t.id === idCA) + 1, 'duplicate gets a new id, a "Copy" name and sits after the original')
st().updateTransition(dupId, { interpolation: { ...dup.interpolation, colors: false }, target: aRef(a1.id) })
check(find(idCA)!.interpolation.colors && find(idCA)!.target.id === a0.id, 'the duplicate is an independent deep copy')

st().checkpoint()
st().reorderTransition(dupId, 0)
check(all()[0].id === dupId, 'reorder')

st().selectTransition(dupId)
st().checkpoint()
st().deleteTransition(dupId)
check(!find(dupId) && st().selectedTransitionId === null, 'delete removes it and clears the simulator selection')
st().undo()
check(!!find(dupId), 'undo restores a deleted transition')
st().redo()
check(!find(dupId) && all().length === 4, 'redo deletes it again')

// ---- Combination Loop setting ----------------------------------------------------------------------
st().checkpoint()
st().setAnimationComboLoop(lookAroundId, true)
check(st().project.animationCombos.find((c) => c.id === lookAroundId)?.loop === true && st().dirty, 'the Loop button saves the combination\'s loop setting')
st().undo()
check(st().project.animationCombos.find((c) => c.id === lookAroundId)?.loop === false, 'undo reverts the Loop setting')
st().redo()

check(transitionNameMismatch('Idle To Look Up', 'Look Ups', 'Idle'), 'a transition whose From/To contradict its name is flagged')
check(!transitionNameMismatch('Idle To Look Up', 'Idle', 'Look Ups') && !transitionNameMismatch('Wink', 'A', 'B'), 'matching or free-form names are not flagged')

// ---- Persistence -------------------------------------------------------------------------------
// Key-order-independent comparison (content, not property order).
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v
const sameContent = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

const project = st().project
const file = serializeProjectFile(project, noEditorState)
const reopened = deserializeProjectFile(file)
check(sameContent(reopened.project.transitions, project.transitions), 'save → reopen restores every transition exactly')
check(reopened.project.animationCombos.find((c) => c.id === lookAroundId)?.loop === true, 'save → reopen keeps the combination Loop setting')
st().selectTransition(idCC)
st().loadProject(reopened.project, reopened.editorState, 'reopened.kibo')
check(st().project.transitions.length === 4 && st().selectedTransitionId === null && !st().dirty, 'loading a project resets the transition selection')

const viaJson = deserializeProjectFile(projectToJson(project)).project
check(sameContent(viaJson.transitions, project.transitions), 'Project JSON export → import keeps transitions')

const legacy = JSON.parse(file)
delete legacy.project.transitions
delete legacy.project.timing.clipTransitionMs
delete legacy.project.timing.clipTransitionEasing
delete legacy.project.timing.clipTransitionBezier
const legacyLoaded = deserializeProjectFile(JSON.stringify(legacy)).project
check(
  Array.isArray(legacyLoaded.transitions) && legacyLoaded.transitions.length === 0 && legacyLoaded.timing.clipTransitionMs === 250,
  'an older project without transition data opens with no transitions and default timing'
)
const bareLegacy = deserializeProjectFile(JSON.stringify(legacy.project)).project
check(bareLegacy.transitions.length === 0 && bareLegacy.animations.length === project.animations.length, 'a pre-versioning (bare) project file opens too')

const malformed = JSON.parse(file)
malformed.project.transitions = [
  null,
  { name: 42, easing: 'wobble', durationMs: -5, bezier: [1, 2], interpolation: { switchAtPct: 900, colors: false }, source: 'nope' },
  { id: 'same', name: 'Twin' },
  { id: 'same', name: 'Twin B', target: { kind: 'combo', id: lookAroundId, loop: 1 } }
]
const repaired = deserializeProjectFile(JSON.stringify(malformed)).project.transitions
const [r0, r1, r2, r3] = repaired
check(
  repaired.length === 4 &&
    r0.name === 'Transition 1' &&
    r1.name === 'Transition 2' &&
    r1.easing === 'easeInOut' &&
    r1.durationMs === 0 &&
    r1.bezier.join() === '0.42,0,0.58,1' &&
    r1.interpolation.switchAtPct === 100 &&
    !r1.interpolation.colors &&
    r1.interpolation.position &&
    r1.source.kind === 'animation' &&
    r2.id !== r3.id &&
    r3.target.kind === 'combo' &&
    r3.target.loop === true,
  'malformed transition entries are repaired field by field (no crash, unique ids)'
)

// ---- C++ export --------------------------------------------------------------------------------
const header = generateCppHeader(project)
const identsOf = (h: string) => [...h.matchAll(/const EyeTransition Trans_(\w+) =/g)].map((m) => m[1])
check(identsOf(header).join() === 'LookDownLeft,LookLeftToLookAround,LookAroundToBlink,ShyToLookAround', 'every transition exports an EyeTransition constant with a sanitized PascalCase identifier')
check(header.includes('const uint16_t EYE_TRANSITION_COUNT = 4;') && header.includes('&Trans_ShyToLookAround'), 'all transitions are in the name registry')
check(header.includes('"Look Down _ Left!"'), 'non-ASCII characters in names are replaced in the C string')
check(header.includes('//   playTransition("Look Left To Look Around");'), 'Quick Reference lists playTransition() calls')
check(header.includes('// Look Around To Blink -> animation'), 'each transition gets a generated comment')
check(!/previewSwitchAfterMs|previewHoldMs|1500/.test(header.split('// ---- Transitions')[1].split('// ---- Expressions')[0]), 'no Studio-only preview state is exported')

const tricky: Project = {
  ...project,
  transitions: [
    { ...project.transitions[0], id: 't1', name: 'Look Left' },
    { ...project.transitions[0], id: 't2', name: 'Look Left' }, // duplicate name from a hand-edited file
    { ...project.transitions[0], id: 't3', name: 'look_left' },
    { ...project.transitions[0], id: 't4', name: '3 blinks', target: { ...aRef(a1.id), loop: true } }, // loop on an animation To (hand-edited file)
    { ...project.transitions[0], id: 't5', name: 'wink :) "quoted" \\ path' },
    { ...project.transitions[0], id: 't6', name: 'Broken', target: aRef('deleted-animation') },
    { ...project.transitions[1], id: 't7', name: 'Idle Loop Target', target: cRef(lookAroundId, true) }
  ]
}
const trickyHeader = generateCppHeader(tricky)
const trickyIdents = identsOf(trickyHeader)
check(
  trickyIdents.join() === 'LookLeft,LookLeft_2,LookLeft_3,_3Blinks,WinkQuotedPath,IdleLoopTarget',
  `identifiers are sanitized, unique (_2/_3 suffixes) and never start with a digit (got ${trickyIdents.join(', ')})`
)
check(trickyHeader.includes('"Broken" is not exported') && !trickyHeader.includes('Trans_Broken') && trickyHeader.includes('EYE_TRANSITION_COUNT = 6;'), 'a transition whose target was deleted is skipped with a comment')
check(trickyHeader.includes('"wink :) \\"quoted\\" \\\\ path"'), 'quotes and backslashes in names are escaped')
check(
  /Trans__3Blinks = \{ "3 blinks", "_3Blinks", &Anim_\w+, nullptr, false,/.test(trickyHeader) &&
    /Trans_IdleLoopTarget = \{ "Idle Loop Target", "IdleLoopTarget", nullptr, &LookAround, true,/.test(trickyHeader),
  'loop is exported only for a To combination (ignored for an animation To)'
)
check(
  /const AnimationCombo LookAround = \{ LookAround_Clips, 2, true \};/.test(trickyHeader) && /const AnimationCombo Shy = \{ Shy_Clips, 1, false \};/.test(trickyHeader),
  'each combination exports its saved Loop setting'
)

const emptyHeader = generateCppHeader(createDefaultProject('No Transitions'))
check(emptyHeader.includes('EYE_TRANSITION_COUNT = 0;') && !emptyHeader.includes('const EyeTransition Trans_'), 'a project with no transitions still exports the (empty) registry')

// ---- Compile + run -------------------------------------------------------------------------------
const PRELUDE = `#include <cstdint>
#include <cmath>
#include <cstdio>
static unsigned long fakeMillis = 0;
unsigned long millis() { return fakeMillis; }
template <class A, class B> auto min(A a, B b) -> decltype(a + b) { return a < b ? a : b; }
template <class A, class B> auto max(A a, B b) -> decltype(a + b) { return a > b ? a : b; }
#define PROGMEM
#ifndef PI
#define PI 3.14159265358979f
#endif
`
function build(name: string, eyesH: string, main: string): string {
  const dir = join(tmpdir(), 'kibo-transition-library', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'eyes.h'), eyesH)
  writeFileSync(join(dir, 'eyeController.h'), generateEyeControllerHeader())
  writeFileSync(join(dir, 'main.cpp'), PRELUDE + main)
  const exe = join(dir, process.platform === 'win32' ? 'run.exe' : 'run')
  try {
    execFileSync('g++', ['-std=gnu++17', '-O1', '-Wall', '-Wno-unused-function', '-Wno-unused-variable', '-Wno-type-limits', '-o', exe, join(dir, 'main.cpp')], { stdio: 'pipe' })
  } catch (e) {
    fail(`g++ failed for ${name} (${dir}):\n${(e as { stderr?: Buffer }).stderr?.toString().split('\n').slice(0, 40).join('\n')}`)
  }
  return execFileSync(exe, { encoding: 'utf8' }).trim()
}

const trickyOut = build(
  'with-transitions',
  trickyHeader,
  `#include "eyes.h"
#include "eyeController.h"
int main() {
  PlayAnimation(Anim_${trickyHeader.match(/PlayAnimation\(Anim_(\w+)\)/)![1]});
  for (fakeMillis = 0; fakeMillis < 600; fakeMillis += 20) UpdateEyes();
  int ok = 1;
  ok &= FindTransition("look left") == &Trans_LookLeft;
  ok &= FindTransition("LOOKLEFT_2") == &Trans_LookLeft_2;
  ok &= FindTransition("3 blinks") == &Trans__3Blinks;
  ok &= FindTransition("Broken") == nullptr;
  ok &= FindTransition(nullptr) == nullptr;
  ok &= playTransition("wink :) \\"quoted\\" \\\\ path");
  ok &= EyesTransitioning();
  ok &= !playTransition("does not exist");
  ok &= PlayTransition("IdleLoopTarget");
  ok &= ComboPlaying() && eyesPlayer.comboLoop;
  for (; fakeMillis < 2000; fakeMillis += 20) { UpdateEyes(); EyeControllerUpdate(); }
  ok &= PlayTransition(Trans_LookLeft);
  EyeControllerRelease();
  ok &= PlayTransition(Trans_LookLeft_2, EYE_PRIORITY_SENSOR);      // priority shorthand (eyeController.h)
  ok &= playTransition("3 blinks", EYE_PRIORITY_SENSOR);
  ok &= !PlayTransition("nope", EYE_PRIORITY_SENSOR);
  for (; fakeMillis < 2600; fakeMillis += 20) { UpdateEyes(); EyeControllerUpdate(); }
  // Re-requesting the running transition every loop must not restart it.
  EyeControllerRelease();
  ok &= PlayTransition(Trans_WinkQuotedPath);
  unsigned long blendStart = eyesPlayer.transStart;
  fakeMillis += 40; UpdateEyes();
  ok &= PlayTransition(Trans_WinkQuotedPath) && eyesPlayer.transStart == blendStart && EyesTransitioning();
  // Combo(x) / EyeControllerRequestCombo(x, p) use the Loop saved in the studio.
  Combo(LookAround);             ok &= eyesPlayer.comboLoop;
  Combo(Shy);                    ok &= !eyesPlayer.comboLoop;
  Combo(Shy, true);              ok &= eyesPlayer.comboLoop;
  EyeControllerRelease();
  ok &= EyeControllerRequestCombo(Shy, EYE_PRIORITY_IDLE) && !eyesPlayer.comboLoop;
  ok &= EyeControllerRequestCombo(LookAround, EYE_PRIORITY_SENSOR) && eyesPlayer.comboLoop;
  EyeControllerRelease();
  ok &= EyeControllerRequestTransitionByName("look_left", EYE_PRIORITY_SENSOR);
  ok &= EyeControllerRequestTransition(Trans__3Blinks, EYE_PRIORITY_REACTION, true);
  ok &= !EyeControllerRequestTransitionByName("Look Left", EYE_PRIORITY_SENSOR);   // locked by a higher priority
  for (; fakeMillis < 4000; fakeMillis += 20) { UpdateEyes(); EyeControllerUpdate(); }
  std::printf("%d %u\\n", ok, (unsigned)EYE_TRANSITION_COUNT);
  return 0;
}
`
)
check(trickyOut === '1 6', 'exported header compiles (-Wall) and the registry/lookup/PlayTransition/eyeController API works on-device')

const legacyOut = build(
  'no-transitions',
  emptyHeader,
  `#include "eyes.h"
#include "eyeController.h"
int main() {
  SetTransition(0);
  PlayAnimation(Anim_${emptyHeader.match(/PlayAnimation\(Anim_(\w+)\)/)![1]});
  for (fakeMillis = 0; fakeMillis < 500; fakeMillis += 20) UpdateEyes();
  std::printf("%d %d\\n", playTransition("anything") ? 1 : 0, (int)EYE_TRANSITION_COUNT);
  return 0;
}
`
)
check(legacyOut === '0 0', 'a project with no transitions compiles and existing calls (SetTransition/PlayAnimation) are unchanged')

console.log('ok: saved transition library verified')
