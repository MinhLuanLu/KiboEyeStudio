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
  'upperEyelid',
  'lowerEyelid',
  'highlightX',
  'highlightY',
  'highlightSize'
] as const satisfies readonly (keyof EyeParams)[]

export function lerpParams(a: EyeParams, b: EyeParams, t: number): EyeParams {
  const out = {} as EyeParams
  for (const key of EYE_PARAM_KEYS) {
    out[key] = a[key] + (b[key] - a[key]) * t
  }
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

export { EYE_PARAM_KEYS }
export type { Keyframe }
