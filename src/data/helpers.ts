import { nanoid } from 'nanoid'
import type { Animation, EasingType, EyeParams, Keyframe } from '@/types'
import { DEFAULT_EYE_PARAMS } from '@/types'

export function p(overrides: Partial<EyeParams> = {}): EyeParams {
  return { ...DEFAULT_EYE_PARAMS, ...overrides }
}

export function kf(duration: number, easing: EasingType, overrides: Partial<EyeParams> = {}, customBezier?: [number, number, number, number]): Keyframe {
  return { id: nanoid(8), duration, easing, customBezier, params: p(overrides) }
}

export function kfFrom(base: EyeParams, duration: number, easing: EasingType, overrides: Partial<EyeParams> = {}): Keyframe {
  return { id: nanoid(8), duration, easing, params: { ...base, ...overrides } }
}

export function anim(name: string, loop: boolean, keyframes: Keyframe[]): Animation {
  return { id: nanoid(8), name, loop, keyframes }
}
