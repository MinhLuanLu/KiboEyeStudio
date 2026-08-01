import { nanoid } from 'nanoid'
import type { Animation, EasingType, EyeParams, Keyframe } from '@/types'
import { DEFAULT_EYE_PARAMS, createDefaultTracks } from '@/types'

export function p(overrides: Partial<EyeParams> = {}): EyeParams {
  return { ...DEFAULT_EYE_PARAMS, ...overrides }
}

/** A keyframe spec as authored by the builtin animation lists below: `msToNext` is the gap
 * to the *next* spec in the list (the old `Keyframe.duration` semantics) — kept as the
 * authoring ergonomic since "how long until the next pose" reads far more naturally than an
 * absolute ms offset for a hand-written sequence. `anim()` converts a list of these into real
 * Keyframe[] with absolute `timeMs` via a prefix sum, matching the old keyframeStartTimes()
 * behavior exactly. */
export interface KfSpec {
  id: string
  msToNext: number
  easing: EasingType
  customBezier?: [number, number, number, number]
  params: EyeParams
  styleOverrides: string[]
}

// styleOverrides is left empty here — createDefaultProject() recomputes the real value for
// every built-in keyframe against the project's Visual Reference once it exists (see
// computeStyleOverrides in types/index.ts), so this placeholder is never actually used as-is.
export function kf(msToNext: number, easing: EasingType, overrides: Partial<EyeParams> = {}, customBezier?: [number, number, number, number]): KfSpec {
  return { id: nanoid(8), msToNext, easing, customBezier, params: p(overrides), styleOverrides: [] }
}

export function kfFrom(base: EyeParams, msToNext: number, easing: EasingType, overrides: Partial<EyeParams> = {}): KfSpec {
  return { id: nanoid(8), msToNext, easing, params: { ...base, ...overrides }, styleOverrides: [] }
}

export function anim(name: string, loop: boolean, specs: KfSpec[]): Animation {
  let t = 0
  const keyframes: Keyframe[] = specs.map((spec) => {
    const k: Keyframe = {
      id: spec.id,
      timeMs: t,
      easing: spec.easing,
      customBezier: spec.customBezier,
      params: spec.params,
      leftParams: null,
      rightParams: null,
      styleOverrides: spec.styleOverrides
    }
    t += spec.msToNext
    return k
  })
  const lastGap = specs.length > 0 ? specs[specs.length - 1].msToNext : 0
  const durationMs = loop ? t : t - lastGap
  return {
    id: nanoid(8),
    name,
    loop,
    durationMs,
    keyframes,
    leftEyeKeyframes: [],
    rightEyeKeyframes: [],
    pupilKeyframes: [],
    eyelidKeyframes: [],
    tracks: createDefaultTracks(() => nanoid(8)),
    stickers: [],
    markers: []
  }
}
