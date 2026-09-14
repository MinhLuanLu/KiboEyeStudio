import { nanoid } from 'nanoid'
import type { Animation, EasingType, EyeColors, EyeParams, EyeShapeId, Expression, Keyframe, Marker, PupilShapeId, Track } from '@/types'
import { DEFAULT_EYE_COLORS, DEFAULT_EYE_PARAMS, EYE_PARAM_RANGES, createDefaultTracks } from '@/types'
import { normalizeStickerInstances } from '@/state/persistence'

const PUPIL_SHAPE_IDS: PupilShapeId[] = ['circle', 'oval', 'heart', 'star', 'diamond', 'square', 'triangle', 'custom']
const EYE_SHAPE_IDS: EyeShapeId[] = [
  'default',
  'heart',
  'star',
  'diamond',
  'hexagon',
  'cloud',
  'teardrop',
  'leaf',
  'bean',
  'crescent',
  'catEye',
  'animeEye',
  'robotEye',
  'happyArc',
  'custom'
]

// EYE_PARAM_RANGES only covers the numeric EyeParams fields (pupilShape/pupilCustomShapeId/
// eyeShape/eyeCustomShapeId and the boolean flip/visible/locked fields are deliberately excluded —
// see its definition in types/index.ts), so this only checks those; the excluded fields are
// validated and defaulted separately below in normalizeImportedParams(). Tolerant on purpose: a
// valid params object must carry ALMOST every numeric field, but a few may be missing — a file from
// a slightly different Studio version can lack a newer param, which normalizeImportedParams()
// backfills from defaults. Foreign/garbage JSON has essentially none of these, so the near-complete
// threshold still rejects it.
function isEyeParams(value: unknown): value is EyeParams {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const keys = Object.keys(EYE_PARAM_RANGES)
  const present = keys.filter((key) => typeof v[key] === 'number').length
  return present >= keys.length - 4
}

/** Old hand-authored/exported JSON only ever had one shared `upperEyelidRoundness`/
 * `lowerEyelidRoundness` per lid — split into independent Left/Right End Roundness fields since. If
 * the raw params object still only has the old field, copy it into both new ones so an old file
 * imports byte-identical (mirrors persistence.ts's normalizeEyeParams migration). */
function migrateEyelidRoundness(raw: Record<string, unknown>): Partial<EyeParams> {
  const patch: Partial<EyeParams> = {}
  if (typeof raw.upperEyelidRoundness === 'number' && raw.upperEyelidLeftRoundness === undefined && raw.upperEyelidRightRoundness === undefined) {
    patch.upperEyelidLeftRoundness = raw.upperEyelidRoundness
    patch.upperEyelidRightRoundness = raw.upperEyelidRoundness
  }
  if (typeof raw.lowerEyelidRoundness === 'number' && raw.lowerEyelidLeftRoundness === undefined && raw.lowerEyelidRightRoundness === undefined) {
    patch.lowerEyelidLeftRoundness = raw.lowerEyelidRoundness
    patch.lowerEyelidRightRoundness = raw.lowerEyelidRoundness
  }
  return patch
}

/** Fills in pupilShape/pupilCustomShapeId/eyeShape/eyeCustomShapeId and the boolean flip/visible/
 * locked fields (added after the JSON export format already existed, so older files won't have
 * them), validating the two shape ids against their known sets — a garbage/foreign value would
 * otherwise reach cppExport.ts's enum lookups and silently emit `undefined` into the generated C++.
 * Booleans spread from DEFAULT_EYE_PARAMS first so a missing field backfills to its default. */
function normalizeImportedParams(params: EyeParams): EyeParams {
  const shape = params.pupilShape
  const eyeShape = params.eyeShape
  return {
    ...DEFAULT_EYE_PARAMS,
    ...params,
    ...migrateEyelidRoundness(params as unknown as Record<string, unknown>),
    pupilShape: PUPIL_SHAPE_IDS.includes(shape) ? shape : DEFAULT_EYE_PARAMS.pupilShape,
    pupilCustomShapeId: typeof params.pupilCustomShapeId === 'string' ? params.pupilCustomShapeId : null,
    eyeShape: EYE_SHAPE_IDS.includes(eyeShape) ? eyeShape : DEFAULT_EYE_PARAMS.eyeShape,
    eyeCustomShapeId: typeof params.eyeCustomShapeId === 'string' ? params.eyeCustomShapeId : null
  }
}

/** Merges an imported colors object over DEFAULT_EYE_COLORS so any field a different Studio version
 * lacked backfills to a sane default (mirrors persistence.ts's `{ ...DEFAULT_EYE_COLORS, ...e.colors }`). */
function normalizeImportedColors(raw: unknown): EyeColors {
  return { ...DEFAULT_EYE_COLORS, ...(raw && typeof raw === 'object' ? (raw as Partial<EyeColors>) : {}) }
}
/** Left/right override colors: an object → merged; anything else → null (no divergence). */
function normalizeImportedColorsOverride(raw: unknown): EyeColors | null {
  return raw && typeof raw === 'object' ? normalizeImportedColors(raw) : null
}

/** Builds one normalized Keyframe from a raw JSON keyframe at the given absolute time. Shared by the
 * pose track and the four secondary tracks so every imported keyframe gets identical validation. */
function normalizeImportedKeyframe(kf: Record<string, unknown>, timeMs: number): Keyframe {
  return {
    id: typeof kf.id === 'string' ? kf.id : nanoid(8),
    timeMs,
    easing: typeof kf.easing === 'string' ? (kf.easing as EasingType) : 'linear',
    customBezier: Array.isArray(kf.customBezier) ? (kf.customBezier as [number, number, number, number]) : undefined,
    params: normalizeImportedParams(kf.params as EyeParams),
    leftParams: isEyeParams(kf.leftParams) ? normalizeImportedParams(kf.leftParams as EyeParams) : null,
    rightParams: isEyeParams(kf.rightParams) ? normalizeImportedParams(kf.rightParams as EyeParams) : null,
    styleOverrides: Array.isArray(kf.styleOverrides) ? (kf.styleOverrides as string[]) : []
  }
}

/** A secondary keyframe track (leftEye/rightEye/pupils/eyelids) from the Studio's own export — these
 * always use absolute `timeMs`. Malformed entries are dropped per-entry rather than failing the
 * whole import; absent/empty (older files) → [], i.e. that track inherits the pose track. */
function normalizeSecondaryTrack(raw: unknown): Keyframe[] {
  if (!Array.isArray(raw)) return []
  const out: Keyframe[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const kf = item as Record<string, unknown>
    if (!isEyeParams(kf.params)) continue
    out.push(normalizeImportedKeyframe(kf, typeof kf.timeMs === 'number' ? kf.timeMs : 0))
  }
  return out
}

/** Keeps the export's own timeline lanes when present and well-formed (so imported sticker tracks
 * resolve after importAnimation() re-IDs them); falls back to a fresh default lane set otherwise. */
function normalizeImportedTracks(raw: unknown): Track[] {
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((t) => !!t && typeof t === 'object' && typeof (t as Record<string, unknown>).id === 'string' && typeof (t as Record<string, unknown>).kind === 'string')
  ) {
    return raw as Track[]
  }
  return createDefaultTracks(() => nanoid(8))
}

function normalizeImportedMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((m): m is Marker => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).timeMs === 'number')
}

/** Validates that a parsed JSON blob looks like an `Animation` (our own export or a hand-authored
 * one) before it's spliced into the project. Accepts BOTH on-disk shapes:
 *   - The Studio's Animation JSON export: absolute `timeMs` per keyframe, the four secondary track
 *     arrays, `durationMs`, markers, stickers and `pupilColor` — a lossless round-trip.
 *   - The older hand-writable format: a single pose track authored as "duration to the next
 *     keyframe", no secondary tracks.
 * Absolute-vs-duration timing is auto-detected (any numeric `timeMs` → absolute). */
export function parseAnimationJson(json: string): Animation {
  const data = JSON.parse(json)
  if (!data || typeof data !== 'object') throw new Error('Not a valid animation file')
  if (!Array.isArray(data.keyframes) || data.keyframes.length === 0) {
    throw new Error('Animation JSON must contain a non-empty "keyframes" array')
  }
  for (const kf of data.keyframes) {
    if (!kf || typeof kf !== 'object' || !isEyeParams(kf.params)) {
      throw new Error('Each keyframe needs a full params object')
    }
  }

  const rawKfs = data.keyframes as Record<string, unknown>[]
  // Any numeric timeMs anywhere → the whole file is absolute (the Studio export). Otherwise
  // prefix-sum each keyframe's "duration to next", the same rule normalizeProject()'s legacy
  // migration uses, so a hand-authored duration file imports identically to before.
  const absolute = rawKfs.some((k) => typeof k.timeMs === 'number')
  const loop = Boolean(data.loop)
  let t = 0
  let lastGap = 0
  const keyframes: Keyframe[] = rawKfs.map((kf) => {
    let timeMs: number
    if (absolute) {
      timeMs = typeof kf.timeMs === 'number' ? kf.timeMs : t
    } else {
      timeMs = t
      const gap = typeof kf.duration === 'number' ? kf.duration : 0
      t += gap
      lastGap = gap
    }
    return normalizeImportedKeyframe(kf, timeMs)
  })

  const leftEyeKeyframes = normalizeSecondaryTrack(data.leftEyeKeyframes)
  const rightEyeKeyframes = normalizeSecondaryTrack(data.rightEyeKeyframes)
  const pupilKeyframes = normalizeSecondaryTrack(data.pupilKeyframes)
  const eyelidKeyframes = normalizeSecondaryTrack(data.eyelidKeyframes)

  // Total length: honor an explicit durationMs; else derive. Absolute files use the latest keyframe
  // time across every track; legacy duration files use the prefix-sum end (minus the trailing gap
  // when not looping — the old duration-based playback's own rule).
  let durationMs: number
  if (typeof data.durationMs === 'number' && data.durationMs > 0) {
    durationMs = data.durationMs
  } else if (absolute) {
    const allTimes = [...keyframes, ...leftEyeKeyframes, ...rightEyeKeyframes, ...pupilKeyframes, ...eyelidKeyframes].map((k) => k.timeMs)
    durationMs = allTimes.length ? Math.max(...allTimes) : 0
  } else {
    durationMs = loop ? t : t - lastGap
  }
  if (!(durationMs > 0)) durationMs = 1

  return {
    id: typeof data.id === 'string' ? data.id : '',
    name: typeof data.name === 'string' ? data.name : 'Imported Animation',
    loop,
    durationMs,
    keyframes,
    leftEyeKeyframes,
    rightEyeKeyframes,
    pupilKeyframes,
    eyelidKeyframes,
    tracks: normalizeImportedTracks(data.tracks),
    // Older exported/hand-authored animation JSON predates stickers (or a hand-edited entry is
    // malformed) — normalizeStickerInstances() backfills/drops per-entry, same as project load.
    stickers: normalizeStickerInstances(data.stickers),
    markers: normalizeImportedMarkers(data.markers),
    pupilColor: typeof data.pupilColor === 'string' ? data.pupilColor : null
  }
}

/** Validates a parsed JSON blob as an `Expression` (the Studio's Expression JSON export, or a
 * hand-authored one) before it's added to the project — normalizes params/colors and the per-eye
 * overrides, backfilling anything a different Studio version lacked. */
export function parseExpressionJson(json: string): Expression {
  const data = JSON.parse(json)
  if (!data || typeof data !== 'object') throw new Error('Not a valid expression file')
  if (!isEyeParams(data.params)) throw new Error('Expression JSON must contain a full "params" object')

  return {
    id: typeof data.id === 'string' ? data.id : '',
    name: typeof data.name === 'string' ? data.name : 'Imported Expression',
    params: normalizeImportedParams(data.params as EyeParams),
    colors: normalizeImportedColors(data.colors),
    leftParams: isEyeParams(data.leftParams) ? normalizeImportedParams(data.leftParams as EyeParams) : null,
    rightParams: isEyeParams(data.rightParams) ? normalizeImportedParams(data.rightParams as EyeParams) : null,
    leftColors: normalizeImportedColorsOverride(data.leftColors),
    rightColors: normalizeImportedColorsOverride(data.rightColors),
    styleOverrides: Array.isArray(data.styleOverrides) ? (data.styleOverrides as string[]) : [],
    stickers: normalizeStickerInstances(data.stickers),
    folderId: null,
    order: 0
  }
}

/** A parsed, validated single-clip import — an Animation or an Expression, auto-detected. */
export type StudioClipImport =
  | { kind: 'animation'; animation: Animation }
  | { kind: 'expression'; expression: Expression }

/** Auto-detects whether `json` is an Animation (has a `keyframes` array) or an Expression (has a
 * `params` object and no keyframes) and parses it. Throws a clear message on anything else. */
export function parseStudioClip(json: string): StudioClipImport {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('This file is not valid JSON, so it could not be imported. It may be corrupted.')
  }
  if (!data || typeof data !== 'object') throw new Error('This file does not contain a Kibo animation or expression.')
  const obj = data as Record<string, unknown>
  if (Array.isArray(obj.keyframes)) return { kind: 'animation', animation: parseAnimationJson(json) }
  if (isEyeParams(obj.params)) return { kind: 'expression', expression: parseExpressionJson(json) }
  throw new Error('Unrecognized file. Import an Animation JSON or an Expression JSON exported from the Studio.')
}
