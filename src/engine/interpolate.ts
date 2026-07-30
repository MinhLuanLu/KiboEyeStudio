import type { Animation, EyeParams, Keyframe } from '@/types'
import { PUPIL_TRACK_FIELDS, EYELID_TRACK_FIELDS, SHAPE_TRACK_FIELDS } from '@/types'
import { applyEasing } from './easing'

const EYE_PARAM_KEYS = [
  'width',
  'height',
  'radius',
  'distance',
  'rotation',
  'irisWidth',
  'irisHeight',
  'pupilWidth',
  'pupilHeight',
  'pupilX',
  'pupilY',
  'pupilRotation',
  'upperEyelid',
  'lowerEyelid',
  'upperEyelidTilt',
  'lowerEyelidTilt',
  'upperEyelidCurvature',
  'lowerEyelidCurvature',
  'highlightX',
  'highlightY',
  'highlightSize'
] as const satisfies readonly (keyof EyeParams)[]

/** Shortest-path interpolation between two angles in degrees, wrapping through 0/360 rather
 * than always going the "long way" — e.g. lerping 350deg -> 10deg at t=0.5 gives 0deg, not
 * 180deg. Kept in sync with eyesLerpAngleDeg() in cppExport.ts so the exported firmware
 * animates pupil rotation identically to the studio's own preview. */
function lerpAngleDeg(a: number, b: number, t: number): number {
  const diff = (((b - a + 180) % 360) + 360) % 360
  const shortest = diff - 180
  const result = a + shortest * t
  return ((result % 360) + 360) % 360
}

export function lerpParams(a: EyeParams, b: EyeParams, t: number): EyeParams {
  const out = {} as EyeParams
  for (const key of EYE_PARAM_KEYS) {
    out[key] = key === 'pupilRotation' ? lerpAngleDeg(a[key], b[key], t) : a[key] + (b[key] - a[key]) * t
  }
  // pupilShape/pupilCustomShapeId aren't numeric, so they can't lerp — step at the midpoint
  // instead (matches eyesLerpFrame()/eyesLerpLive() in cppExport.ts, so a keyframe transition
  // between two different pupil shapes snaps at the same instant in the studio preview and
  // the exported firmware). Everything else (size/position/rotation) keeps animating smoothly
  // through the snap exactly as before.
  out.pupilShape = t < 0.5 ? a.pupilShape : b.pupilShape
  out.pupilCustomShapeId = t < 0.5 ? a.pupilCustomShapeId : b.pupilCustomShapeId
  return out
}

export interface SampleResult {
  params: EyeParams
  segmentIndex: number
  segmentT: number
}

/** Wraps elapsed time into [0, durationMs) for looping playback; clamps to the end otherwise.
 * Pure version of wrapTime() below, usable by any track (not just the pose track). */
export function wrapMs(timeMs: number, durationMs: number, loop: boolean): number {
  if (durationMs <= 0) return 0
  if (loop) {
    const m = timeMs % durationMs
    return m < 0 ? m + durationMs : m
  }
  return Math.min(Math.max(0, timeMs), durationMs)
}

/** Samples one independently-timed keyframe track (any of Animation's pose/leftEye/rightEye/
 * pupils/eyelids arrays) at `timeMs`. Returns `null` for an empty track — the caller (usually
 * sampleAnimationEye) treats that as "this track contributes nothing, fully inherit the pose
 * track's values for these fields" rather than an error, since an empty parametric track is
 * the normal/default state for every animation that hasn't had that track authored yet. A
 * single-keyframe track holds that one pose constant for the whole animation. `kfs` is assumed
 * sorted by `timeMs` ascending — every store action that writes to a keyframe track re-sorts
 * after mutating (see store.ts), so callers never need to sort defensively here. */
export function sampleTrack(kfs: Keyframe[], loop: boolean, durationMs: number, timeMs: number): SampleResult | null {
  if (kfs.length === 0) return null
  if (kfs.length === 1) return { params: kfs[0].params, segmentIndex: 0, segmentT: 0 }

  const t = wrapMs(timeMs, durationMs, loop)
  const last = kfs[kfs.length - 1]

  if (t <= kfs[0].timeMs) return { params: kfs[0].params, segmentIndex: 0, segmentT: 0 }

  for (let i = 0; i < kfs.length - 1; i++) {
    const from = kfs[i]
    const to = kfs[i + 1]
    if (t <= to.timeMs) {
      const span = Math.max(1, to.timeMs - from.timeMs)
      const localT = Math.min(1, Math.max(0, (t - from.timeMs) / span))
      const eased = applyEasing(localT, from.easing, from.customBezier)
      return { params: lerpParams(from.params, to.params, eased), segmentIndex: i, segmentT: localT }
    }
  }

  if (!loop || durationMs <= last.timeMs) {
    return { params: last.params, segmentIndex: kfs.length - 1, segmentT: 1 }
  }

  // Loop-back segment: from the last keyframe, wrapping past durationMs back to the first
  // keyframe — generalizes the old "last keyframe's duration is the gap back to keyframe 0"
  // rule now that duration-to-next no longer exists as stored data.
  const span = Math.max(1, durationMs - last.timeMs)
  const localT = Math.min(1, Math.max(0, (t - last.timeMs) / span))
  const eased = applyEasing(localT, last.easing, last.customBezier)
  return { params: lerpParams(last.params, kfs[0].params, eased), segmentIndex: kfs.length - 1, segmentT: localT }
}

/** Merges the pose track with the pupils/eyelids/left-or-right-eye tracks into one final
 * EyeParams for the requested eye at `timeMs` — the one sampling entry point the live preview
 * and the C++ export both use, so "what does this eye look like right now" is defined in
 * exactly one place. Precedence, least to most specific: pose (baseline) -> pupils -> eyelids
 * -> left/right eye shape. A track with zero keyframes contributes nothing (sampleTrack
 * returns null) and the merge simply keeps the pose track's value for those fields — this is
 * what makes an animation with no left/right/pupil/eyelid tracks authored yet (every pre-
 * Phase-1 project) behave byte-identically to the old single-track model. */
export function sampleAnimationEye(anim: Animation, timeMs: number, eye: 'left' | 'right'): EyeParams {
  const pose = sampleTrack(anim.keyframes, anim.loop, anim.durationMs, timeMs)
  if (!pose) {
    throw new Error('Cannot sample an animation with no pose keyframes')
  }
  const merged = { ...pose.params }

  const pupils = sampleTrack(anim.pupilKeyframes, anim.loop, anim.durationMs, timeMs)
  if (pupils) {
    for (const field of PUPIL_TRACK_FIELDS) (merged as unknown as Record<string, unknown>)[field] = (pupils.params as unknown as Record<string, unknown>)[field]
  }
  const eyelids = sampleTrack(anim.eyelidKeyframes, anim.loop, anim.durationMs, timeMs)
  if (eyelids) {
    for (const field of EYELID_TRACK_FIELDS) (merged as unknown as Record<string, unknown>)[field] = (eyelids.params as unknown as Record<string, unknown>)[field]
  }
  const sideKfs = eye === 'left' ? anim.leftEyeKeyframes : anim.rightEyeKeyframes
  const side = sampleTrack(sideKfs, anim.loop, anim.durationMs, timeMs)
  if (side) {
    for (const field of SHAPE_TRACK_FIELDS) (merged as unknown as Record<string, unknown>)[field] = (side.params as unknown as Record<string, unknown>)[field]
  }
  return merged
}

/** Total playable duration of an animation in ms. Back-compat thin wrapper — `durationMs` is
 * now authoritative stored data (kept in sync by every store action that edits the pose
 * track's timing), not recomputed from keyframes. */
export function animationDuration(anim: Animation): number {
  return anim.durationMs
}

/** Samples the pose track only, at `timeMs`. Back-compat wrapper for any call site that only
 * ever cared about one shared (mirrored) pose — prefer sampleAnimationEye for anything that
 * should support left/right/pupil/eyelid divergence. */
export function sampleAnimation(anim: Animation, timeMs: number): SampleResult {
  const result = sampleTrack(anim.keyframes, anim.loop, anim.durationMs, timeMs)
  if (!result) throw new Error('Cannot sample an animation with no keyframes')
  return result
}

/** Wraps elapsed time into [0, duration) for looping playback; clamps to the end otherwise. */
export function wrapTime(timeMs: number, anim: Animation): number {
  return wrapMs(timeMs, anim.durationMs, anim.loop)
}

export function findKeyframeAtOrAfter(anim: Animation, keyframeId: string): number {
  return anim.keyframes.findIndex((k) => k.id === keyframeId)
}

/** Back-compat wrapper — keyframes now store their own absolute `timeMs` directly, so this is
 * just a projection rather than a prefix-sum computation. */
export function keyframeStartTimes(anim: Animation): number[] {
  return anim.keyframes.map((k) => k.timeMs)
}

/** Smallest allowed gap (ms) between two adjacent keyframes on the same track — shared by the
 * Timeline's own drag/resize/split handling and the store's time-write actions, so "how close
 * can two keyframes get" is defined in exactly one place. */
export const MIN_SEGMENT_MS = 16

export { EYE_PARAM_KEYS }
export type { Keyframe }
