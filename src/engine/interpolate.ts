import type { Animation, EyeParams, Keyframe } from '@/types'
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

/** Total playable duration of an animation in ms. The segment leaving the last
 * keyframe only plays when looping (it wraps back to keyframe 0). */
export function animationDuration(anim: Animation): number {
  if (anim.keyframes.length === 0) return 0
  if (anim.keyframes.length === 1) return anim.keyframes[0].duration
  const segments = anim.loop ? anim.keyframes.length : anim.keyframes.length - 1
  let total = 0
  for (let i = 0; i < segments; i++) total += anim.keyframes[i].duration
  return total
}

export interface SampleResult {
  params: EyeParams
  segmentIndex: number
  segmentT: number
}

/** Samples an animation's eye params at `timeMs` elapsed since playback start.
 * `timeMs` is expected pre-clamped/wrapped by the caller for looping. */
export function sampleAnimation(anim: Animation, timeMs: number): SampleResult {
  const kfs = anim.keyframes
  if (kfs.length === 0) {
    throw new Error('Cannot sample an animation with no keyframes')
  }
  if (kfs.length === 1) {
    return { params: kfs[0].params, segmentIndex: 0, segmentT: 0 }
  }

  let remaining = Math.max(0, timeMs)
  const segmentCount = anim.loop ? kfs.length : kfs.length - 1

  for (let i = 0; i < segmentCount; i++) {
    const from = kfs[i]
    const to = kfs[(i + 1) % kfs.length]
    const dur = Math.max(1, from.duration)
    if (remaining <= dur || i === segmentCount - 1) {
      const t = Math.min(1, remaining / dur)
      const eased = applyEasing(t, from.easing, from.customBezier)
      return { params: lerpParams(from.params, to.params, eased), segmentIndex: i, segmentT: t }
    }
    remaining -= dur
  }

  const last = kfs[kfs.length - 1]
  return { params: last.params, segmentIndex: kfs.length - 1, segmentT: 1 }
}

/** Wraps elapsed time into [0, duration) for looping playback; clamps to the end otherwise. */
export function wrapTime(timeMs: number, anim: Animation): number {
  const total = animationDuration(anim)
  if (total <= 0) return 0
  if (anim.loop) {
    const m = timeMs % total
    return m < 0 ? m + total : m
  }
  return Math.min(timeMs, total)
}

export function findKeyframeAtOrAfter(anim: Animation, keyframeId: string): number {
  return anim.keyframes.findIndex((k) => k.id === keyframeId)
}

export function keyframeStartTimes(anim: Animation): number[] {
  const starts: number[] = []
  let acc = 0
  for (let i = 0; i < anim.keyframes.length; i++) {
    starts.push(acc)
    acc += anim.keyframes[i].duration
  }
  return starts
}

/** Smallest allowed segment duration (ms) between two adjacent keyframes — shared by the
 * Timeline's own drag-to-resize handling and the store's absolute-time/paste actions, so
 * "how close can two keyframes get" is defined in exactly one place. */
export const MIN_SEGMENT_MS = 16

export { EYE_PARAM_KEYS }
export type { Keyframe }
