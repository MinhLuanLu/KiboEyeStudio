import { nanoid } from 'nanoid'
import type { Animation, EyeParams, Keyframe, PupilShapeId } from '@/types'
import { DEFAULT_EYE_PARAMS, EYE_PARAM_RANGES, createDefaultTracks } from '@/types'
import { normalizeStickerInstances } from '@/state/persistence'

const PUPIL_SHAPE_IDS: PupilShapeId[] = ['circle', 'oval', 'heart', 'star', 'diamond', 'square', 'triangle', 'custom']

// EYE_PARAM_RANGES only covers the numeric EyeParams fields (pupilShape/pupilCustomShapeId
// are deliberately excluded — see its definition in types/index.ts), so this only checks
// those; pupilShape/pupilCustomShapeId are validated and defaulted separately below in
// normalizeImportedParams(), same reasoning persistence.ts's normalizeEyeParams() already
// applies to project save/load.
function isEyeParams(value: unknown): value is EyeParams {
  if (typeof value !== 'object' || value === null) return false
  return Object.keys(EYE_PARAM_RANGES).every((key) => typeof (value as Record<string, unknown>)[key] === 'number')
}

/** Fills in pupilShape/pupilCustomShapeId (added after this JSON export format already
 * existed, so older exported/hand-authored animation files won't have them) and validates
 * pupilShape against the known set — a garbage/foreign value here would otherwise reach
 * cppExport.ts's PUPIL_SHAPE_ENUM lookup and silently emit `undefined` into the generated
 * C++ literal instead of a valid enum identifier. */
function normalizeImportedParams(params: EyeParams): EyeParams {
  const shape = params.pupilShape
  return {
    ...params,
    pupilShape: PUPIL_SHAPE_IDS.includes(shape) ? shape : DEFAULT_EYE_PARAMS.pupilShape,
    pupilCustomShapeId: typeof params.pupilCustomShapeId === 'string' ? params.pupilCustomShapeId : null
  }
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

  // This interchange format still authors keyframes as "duration to next" (the format is
  // meant to be hand-writable) — convert to the current absolute-timeMs Keyframe shape via
  // the same prefix-sum rule normalizeProject()'s migration uses, so an imported animation's
  // timing matches exactly what the old duration-based playback would have produced.
  const loop = Boolean(data.loop)
  let t = 0
  let lastGap = 0
  const keyframes: Keyframe[] = data.keyframes.map((kf: Record<string, unknown>) => {
    const timeMs = t
    const gap = typeof kf.duration === 'number' ? kf.duration : 0
    t += gap
    lastGap = gap
    return {
      id: typeof kf.id === 'string' ? kf.id : nanoid(8),
      timeMs,
      easing: kf.easing as Animation['keyframes'][number]['easing'],
      customBezier: kf.customBezier as [number, number, number, number] | undefined,
      params: normalizeImportedParams(kf.params as EyeParams),
      styleOverrides: Array.isArray(kf.styleOverrides) ? (kf.styleOverrides as string[]) : []
    }
  })
  const durationMs = loop ? t : t - lastGap

  return {
    id: typeof data.id === 'string' ? data.id : '',
    name: typeof data.name === 'string' ? data.name : 'Imported Animation',
    loop,
    durationMs,
    keyframes,
    leftEyeKeyframes: [],
    rightEyeKeyframes: [],
    pupilKeyframes: [],
    eyelidKeyframes: [],
    tracks: createDefaultTracks(() => nanoid(8)),
    // Older exported/hand-authored animation JSON predates stickers entirely (or a
    // hand-edited file's sticker entries are malformed) — normalizeStickerInstances()
    // backfills/drops per-entry the same way it does for project load in persistence.ts,
    // rather than rejecting the whole file or letting a malformed sticker reach the renderer.
    stickers: normalizeStickerInstances(data.stickers),
    markers: []
  }
}
