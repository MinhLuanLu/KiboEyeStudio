import { nanoid } from 'nanoid'
import type { Animation, EasingType, EyeParams, Keyframe } from '@/types'
import { DEFAULT_EYE_PARAMS } from '@/types'

export function p(overrides: Partial<EyeParams> = {}): EyeParams {
  return { ...DEFAULT_EYE_PARAMS, ...overrides }
}

// styleOverrides is left empty here — createDefaultProject() recomputes the real value for
// every built-in keyframe against the project's Visual Reference once it exists (see
// computeStyleOverrides in types/index.ts), so this placeholder is never actually used as-is.
export function kf(duration: number, easing: EasingType, overrides: Partial<EyeParams> = {}, customBezier?: [number, number, number, number]): Keyframe {
  return { id: nanoid(8), duration, easing, customBezier, params: p(overrides), styleOverrides: [] }
}

export function kfFrom(base: EyeParams, duration: number, easing: EasingType, overrides: Partial<EyeParams> = {}): Keyframe {
  return { id: nanoid(8), duration, easing, params: { ...base, ...overrides }, styleOverrides: [] }
}

export function anim(name: string, loop: boolean, keyframes: Keyframe[]): Animation {
  return { id: nanoid(8), name, loop, keyframes, stickers: [] }
}
