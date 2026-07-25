import type { Animation, EyeParams } from '@/types'
import { EYE_PARAM_RANGES } from '@/types'

function isEyeParams(value: unknown): value is EyeParams {
  if (typeof value !== 'object' || value === null) return false
  return Object.keys(EYE_PARAM_RANGES).every((key) => typeof (value as Record<string, unknown>)[key] === 'number')
}

/** Validates that a parsed JSON blob looks like an `Animation` (from our own export or a
 * hand-authored one) before it's spliced into the project — avoids crashing the renderer
 * on malformed/foreign JSON. */
export function parseAnimationJson(json: string): Animation {
  const data = JSON.parse(json)
  if (!data || typeof data !== 'object') throw new Error('Not a valid animation file')
  if (!Array.isArray(data.keyframes) || data.keyframes.length === 0) {
    throw new Error('Animation JSON must contain a non-empty "keyframes" array')
  }
  for (const kf of data.keyframes) {
    if (typeof kf.duration !== 'number' || typeof kf.easing !== 'string' || !isEyeParams(kf.params)) {
      throw new Error('Each keyframe needs duration, easing, and a full params object')
    }
  }
  return {
    id: typeof data.id === 'string' ? data.id : '',
    name: typeof data.name === 'string' ? data.name : 'Imported Animation',
    loop: Boolean(data.loop),
    keyframes: data.keyframes
  }
}
