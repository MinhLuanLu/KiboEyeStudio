import { nanoid } from 'nanoid'
import type {
  Animation,
  AnimationFolder,
  ExpressionFolder,
  AnimationCombo,
  AnimationComboClip,
  CustomEyeShape,
  CustomPupilShape,
  EasingType,
  EditorState,
  Expression,
  EyeColors,
  EyeParams,
  EyeSide,
  Keyframe,
  Marker,
  PlaybackMode,
  Project,
  ProjectFile,
  StickerAsset,
  StickerInstance,
  StickerKeyframe,
  StickerLayer,
  Track,
  VisualReferenceStyle
} from '@/types'
import {
  DEFAULT_DISPLAY,
  DEFAULT_EYE_COLORS,
  DEFAULT_EYE_PARAMS,
  DEFAULT_PERSONALITY,
  DEFAULT_STICKER_ANIM,
  DEFAULT_TIMING,
  FIXED_TRACK_KINDS,
  PROJECT_FILE_VERSION,
  computeStyleOverrides,
  defaultEditorState
} from '@/types'
import { BUILTIN_STICKER_ASSETS } from '@/renderer/builtinStickers'
import { createDefaultUiDesign, defaultKeyboardConfig, defaultOptionsSourceConfig } from '@/lib/uiDesign/widgetDefaults'
import { isOptionsSourceWidget } from '@/lib/uiDesign/optionsSource'
import { DEFAULT_UI_DISPLAY } from '@/types'
import type {
  UiAsset,
  UiCssRule,
  UiCustomFont,
  UiDesignProject,
  UiDataListConfig,
  UiDataSource,
  UiDataSourceField,
  UiDisplayOrientation,
  UiDisplayRotation,
  UiDisplayShape,
  UiDisplaySettings,
  UiKeyboardAltCharSet,
  UiKeyboardConfig,
  UiKeyboardCustomKey,
  UiKeyboardCustomLayout,
  UiKeyboardEdgePadding,
  UiListItem,
  UiOptionsSourceConfig,
  UiPositionInfoField,
  UiScreen,
  UiThemeId,
  UiThemeTokens,
  UiVariable,
  UiWidget,
  UiWorkspaceViewSettings
} from '@/types'
import { DEFAULT_CUSTOM_THEME_TOKENS } from '@/lib/uiDesign/themes'
import { defaultUiWorkspaceView } from '@/types'

const LOCAL_STORAGE_KEY = 'kibo-eye-studio:autosave'
const LOCAL_STORAGE_PATH_KEY = 'kibo-eye-studio:last-path'
const RECENT_PROJECTS_KEY = 'kibo-eye-studio:recent-projects'
const RECENT_PROJECTS_LIMIT = 8
const PROJECT_FILE_EXTENSION = 'kiboeyes'

/** Thrown by parseProjectFile for anything that isn't a readable Kibo Studio project —
 * caught at the call site (App.tsx) and shown to the user as a plain-language error rather
 * than crashing or silently discarding their file. */
export class ProjectFileError extends Error {}

export function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!window.kibo
}

export interface RecentProjectEntry {
  path: string
  name: string
  openedAt: number
}

/** Recent-projects list shown on the Home Screen. Electron-only: a browser-fallback "save"
 * downloads a file rather than writing to a stable, re-openable path, so there's nothing
 * meaningful to record there — touchRecentProject() below no-ops outside Electron. Newest
 * first, deduplicated by path, capped at RECENT_PROJECTS_LIMIT. */
export function getRecentProjects(): RecentProjectEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is RecentProjectEntry => !!e && typeof e === 'object' && typeof e.path === 'string' && typeof e.name === 'string' && typeof e.openedAt === 'number'
    )
  } catch {
    return []
  }
}

export function touchRecentProject(path: string, name: string): void {
  if (!hasElectron() || !path) return
  try {
    const entries = getRecentProjects().filter((e) => e.path !== path)
    entries.unshift({ path, name, openedAt: Date.now() })
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(entries.slice(0, RECENT_PROJECTS_LIMIT)))
  } catch {
    // Best-effort — a full localStorage quota shouldn't block the save/open that triggered this.
  }
}

export function removeRecentProject(path: string): void {
  try {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(getRecentProjects().filter((e) => e.path !== path)))
  } catch {
    // Ignore — worst case a stale entry lingers until the next successful prune.
  }
}

/** Old saved projects/animation JSON only ever had one shared `upperEyelidRoundness`/
 * `lowerEyelidRoundness` field per lid — split into independent Left/Right End Roundness
 * fields since. If the raw params object still only has the old field (no new ones), copy
 * that single value into both new fields so an old project renders byte-identical to before;
 * if the new fields are already present (saved after this change), they win as-is. */
function migrateEyelidRoundness(params: Partial<EyeParams>): Partial<EyeParams> {
  const raw = params as unknown as Record<string, unknown>
  const oldUpper = raw.upperEyelidRoundness
  const oldLower = raw.lowerEyelidRoundness
  const patch: Partial<EyeParams> = {}
  if (typeof oldUpper === 'number' && params.upperEyelidLeftRoundness === undefined && params.upperEyelidRightRoundness === undefined) {
    patch.upperEyelidLeftRoundness = oldUpper
    patch.upperEyelidRightRoundness = oldUpper
  }
  if (typeof oldLower === 'number' && params.lowerEyelidLeftRoundness === undefined && params.lowerEyelidRightRoundness === undefined) {
    patch.lowerEyelidLeftRoundness = oldLower
    patch.lowerEyelidRightRoundness = oldLower
  }
  return patch
}

function normalizeEyeParams(params: Partial<EyeParams> | undefined): EyeParams {
  return { ...DEFAULT_EYE_PARAMS, ...(params ?? {}), ...migrateEyelidRoundness(params ?? {}) }
}

function normalizeEyeParamsOverride(params: Partial<EyeParams> | null | undefined): EyeParams | null {
  return params ? normalizeEyeParams(params) : null
}

function normalizeEyeColorsOverride(colors: Partial<EyeColors> | null | undefined): EyeColors | null {
  return colors ? { ...DEFAULT_EYE_COLORS, ...colors } : null
}

function normalizeStyleOverrides(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((f): f is string => typeof f === 'string')
}

/** Backfills one placed sticker with defaults for any missing/malformed fields — lenient
 * (spread-merge, like normalizeEyeParams) rather than strict-reject, since StickerInstance has
 * many fields and a saved file predating a newly-added one shouldn't lose the whole sticker.
 * Drops entries missing `id`/`assetId` entirely (unusable — nothing to reference or select). */
/** Coerces one sticker's timeline keyframes (drops malformed entries, backfills defaults) and keeps
 * them sorted by timeMs — the invariant sampleStickerKeyframes()/the Timeline both assume. Old
 * projects have no `keyframes` field → empty array → the sticker stays static. */
function normalizeStickerKeyframes(raw: unknown, defaultWidth: number, defaultHeight: number): StickerKeyframe[] {
  if (!Array.isArray(raw)) return []
  const out: StickerKeyframe[] = []
  for (const k of raw) {
    if (!k || typeof k !== 'object') continue
    const r = k as Record<string, unknown>
    if (typeof r.timeMs !== 'number') continue
    out.push({
      id: typeof r.id === 'string' ? r.id : nanoid(8),
      timeMs: Math.max(0, Math.round(r.timeMs)),
      easing: typeof r.easing === 'string' ? (r.easing as StickerKeyframe['easing']) : 'easeInOut',
      customBezier: Array.isArray(r.customBezier) && r.customBezier.length === 4 ? (r.customBezier as [number, number, number, number]) : undefined,
      x: typeof r.x === 'number' ? r.x : 0,
      y: typeof r.y === 'number' ? r.y : 0,
      // Older sticker keyframes (pre width/height animation) fall back to the sticker's own size.
      width: typeof r.width === 'number' ? r.width : defaultWidth,
      height: typeof r.height === 'number' ? r.height : defaultHeight,
      scaleX: typeof r.scaleX === 'number' ? r.scaleX : 100,
      scaleY: typeof r.scaleY === 'number' ? r.scaleY : 100,
      rotation: typeof r.rotation === 'number' ? r.rotation : 0,
      opacity: typeof r.opacity === 'number' ? r.opacity : 100,
      tint: typeof r.tint === 'string' ? r.tint : null
    })
  }
  out.sort((a, b) => a.timeMs - b.timeMs)
  return out
}

export function normalizeStickerInstances(raw: unknown): StickerInstance[] {
  if (!Array.isArray(raw)) return []
  const out: StickerInstance[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const r = s as Partial<StickerInstance> & Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.assetId !== 'string') continue
    out.push({
      id: r.id,
      assetId: r.assetId,
      name: typeof r.name === 'string' ? r.name : 'Sticker',
      layer: r.layer === 'front' ? 'front' : 'behind',
      order: typeof r.order === 'number' ? r.order : out.length,
      x: typeof r.x === 'number' ? r.x : 0,
      y: typeof r.y === 'number' ? r.y : 0,
      width: typeof r.width === 'number' ? r.width : 48,
      height: typeof r.height === 'number' ? r.height : 48,
      // Migrates old saved projects (single uniform `scale`) into scaleX/scaleY — falls back to
      // 100 only when neither the new nor the old field is present.
      scaleX: typeof r.scaleX === 'number' ? r.scaleX : typeof r.scale === 'number' ? r.scale : 100,
      scaleY: typeof r.scaleY === 'number' ? r.scaleY : typeof r.scale === 'number' ? r.scale : 100,
      rotation: typeof r.rotation === 'number' ? r.rotation : 0,
      opacity: typeof r.opacity === 'number' ? r.opacity : 100,
      strokeWidth: typeof r.strokeWidth === 'number' ? r.strokeWidth : 5,
      tint: typeof r.tint === 'string' ? r.tint : null,
      svgColorMode: r.svgColorMode === 'overrideWithTint' ? 'overrideWithTint' : 'preserveOriginal',
      resolvedSvg:
        r.resolvedSvg && typeof r.resolvedSvg === 'object' && typeof (r.resolvedSvg as { dataUrl?: unknown }).dataUrl === 'string'
          ? (r.resolvedSvg as StickerInstance['resolvedSvg'])
          : null,
      flipH: Boolean(r.flipH),
      flipV: Boolean(r.flipV),
      visible: r.visible !== false,
      locked: Boolean(r.locked),
      anim: { ...DEFAULT_STICKER_ANIM, ...(r.anim ?? {}) },
      // Resolved against the owning Animation's actual tracks by normalizeAnimationTiming()
      // below (which knows the real track ids) — '' here just means "unresolved yet"; it's
      // never treated as a real track id.
      trackId: typeof r.trackId === 'string' ? r.trackId : '',
      keyframes: normalizeStickerKeyframes(r.keyframes, typeof r.width === 'number' ? r.width : 48, typeof r.height === 'number' ? r.height : 48)
    })
  }
  return out
}

/** Migrates one Keyframe[] array (any of Animation's keyframes/leftEyeKeyframes/
 * rightEyeKeyframes/pupilKeyframes/eyelidKeyframes) to the current absolute-`timeMs` shape.
 * Detects the legacy "duration to next keyframe" shape (every entry has a numeric `duration`
 * and no numeric `timeMs`) and converts via the same prefix-sum `keyframeStartTimes()` used to
 * compute before this feature, so migrated timing is pixel/ms-identical to the old playback.
 * Native Phase-1 saves (already `timeMs`-based) pass straight through, just backfilling
 * defaults for any field added after the file was written. Always returns entries sorted by
 * `timeMs` — every track consumer (sampleTrack, the Timeline) assumes that invariant. */
function normalizeKeyframeList(raw: unknown, visualReference: VisualReferenceStyle): Keyframe[] {
  if (!Array.isArray(raw)) return []
  const isLegacy = raw.some((k) => k && typeof k === 'object' && typeof (k as Record<string, unknown>).duration === 'number' && typeof (k as Record<string, unknown>).timeMs !== 'number')
  let acc = 0
  const out = raw.map((kRaw) => {
    const k = kRaw as Record<string, unknown>
    const params = normalizeEyeParams(k.params as Partial<EyeParams> | undefined)
    const styleOverrides = normalizeStyleOverrides(k.styleOverrides) ?? computeStyleOverrides(params, null, visualReference)
    let timeMs: number
    if (isLegacy) {
      timeMs = acc
      acc += typeof k.duration === 'number' ? k.duration : 0
    } else {
      timeMs = typeof k.timeMs === 'number' ? k.timeMs : acc
    }
    const customBezier = Array.isArray(k.customBezier) && k.customBezier.length === 4 ? (k.customBezier as [number, number, number, number]) : undefined
    const keyframe: Keyframe = {
      id: typeof k.id === 'string' ? k.id : nanoid(8),
      timeMs,
      easing: (typeof k.easing === 'string' ? k.easing : 'linear') as EasingType,
      customBezier,
      params,
      leftParams: normalizeEyeParamsOverride(k.leftParams as Partial<EyeParams> | null | undefined),
      rightParams: normalizeEyeParamsOverride(k.rightParams as Partial<EyeParams> | null | undefined),
      // Per-keyframe color (pose track only). Absent in every pre-existing save — stays null
      // (= inherit the shared base palette), so migrated projects animate exactly as before.
      colors: normalizeEyeColorsOverride(k.colors as Partial<EyeColors> | null | undefined),
      styleOverrides
    }
    if (typeof k.sourceExpressionId === 'string') keyframe.sourceExpressionId = k.sourceExpressionId
    if (typeof k.linked === 'boolean') keyframe.linked = k.linked
    return keyframe
  })
  return out.sort((a, b) => a.timeMs - b.timeMs)
}

/** Old (pre-Phase-1) `animationDuration()` rule, applied only when the pose track's keyframes
 * are actually being migrated from `duration` — recomputes the animation's total length so it
 * matches exactly what the old prefix-sum-based playback would have produced, so migrating a
 * saved project changes nothing about how it plays. Returns `null` when there's nothing to
 * migrate (native Phase-1 saves already have a real `durationMs` field to use instead). */
function migratedDurationMs(rawKeyframes: unknown, loop: boolean): number | null {
  if (!Array.isArray(rawKeyframes) || rawKeyframes.length === 0) return null
  const isLegacy = rawKeyframes.some((k) => k && typeof k === 'object' && typeof (k as Record<string, unknown>).duration === 'number' && typeof (k as Record<string, unknown>).timeMs !== 'number')
  if (!isLegacy) return null
  let total = 0
  let lastGap = 0
  for (const kRaw of rawKeyframes) {
    const d = kRaw && typeof kRaw === 'object' && typeof (kRaw as Record<string, unknown>).duration === 'number' ? (kRaw as Record<string, unknown>).duration as number : 0
    total += d
    lastGap = d
  }
  return loop ? total : total - lastGap
}

function normalizeMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return []
  const out: Marker[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const r = m as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.timeMs !== 'number') continue
    out.push({
      id: r.id,
      timeMs: r.timeMs,
      label: typeof r.label === 'string' ? r.label : '',
      color: typeof r.color === 'string' ? r.color : '#f5c542'
    })
  }
  return out
}

/** Backfills one Animation's `tracks` list: keeps any valid entries already on disk, then
 * guarantees only the 'pose' (Expression) track always exists — the required baseline — plus
 * whichever of leftEye/rightEye/pupils/eyelids/marker actually has real data (keyframes or
 * markers) already saved, so a migrated file never *loses* a track its own data still needs,
 * without cluttering the timeline with empty tracks the user never asked for (those are added
 * on demand via the Timeline's "+ Track" control — see addTrack() in state/store.ts). Also —
 * for legacy saves with no sticker tracks at all yet — synthesizes one 'sticker' track per
 * distinct StickerLayer actually used by this animation's stickers, so every existing sticker
 * has somewhere to visually land instead of an "Ungrouped" fallback. */
function normalizeTracks(raw: unknown, stickerLayersInUse: Set<StickerLayer>, hasContent: Record<'leftEye' | 'rightEye' | 'pupils' | 'eyelids' | 'marker', boolean>): Track[] {
  const out: Track[] = []
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (!t || typeof t !== 'object') continue
      const r = t as Record<string, unknown>
      if (typeof r.id !== 'string' || typeof r.kind !== 'string') continue
      out.push({
        id: r.id,
        kind: r.kind as Track['kind'],
        name: typeof r.name === 'string' ? r.name : r.kind,
        order: typeof r.order === 'number' ? r.order : out.length,
        visible: r.visible !== false,
        locked: Boolean(r.locked),
        stickerLayer: r.stickerLayer === 'front' || r.stickerLayer === 'behind' ? r.stickerLayer : undefined
      })
    }
  }
  for (const fixed of FIXED_TRACK_KINDS) {
    if (out.some((t) => t.kind === fixed.kind)) continue
    if (fixed.kind !== 'pose' && !hasContent[fixed.kind as 'leftEye' | 'rightEye' | 'pupils' | 'eyelids' | 'marker']) continue
    out.push({ id: nanoid(8), kind: fixed.kind, name: fixed.name, order: out.length, visible: true, locked: false })
  }
  const haveLayers = new Set(out.filter((t) => t.kind === 'sticker').map((t) => t.stickerLayer))
  for (const layer of stickerLayersInUse) {
    if (!haveLayers.has(layer)) {
      out.push({
        id: nanoid(8),
        kind: 'sticker',
        name: layer === 'behind' ? 'Stickers (Behind)' : 'Stickers (Front)',
        order: out.length,
        visible: true,
        locked: false,
        stickerLayer: layer
      })
    }
  }
  return out
}

/** Backfills project.stickerAssets: keeps every valid IMPORTED asset from the save file (both
 * raster PNG/GIF and — the fix for SVGs vanishing on reopen — embedded 'svg' assets, whose full
 * `svgSource` + rasterized frames are stored right in the project so they survive save/close/open
 * and can't be broken by moving/deleting the original file), then re-seeds the built-in procedural
 * assets fresh from BUILTIN_STICKER_ASSETS every load (rather than trusting whatever was saved for
 * them) — built-ins are code-defined, not user data, so this is the same "source of truth lives in
 * code" treatment createDefaultProject() already gives builtinAnimations/builtinExpressions.
 *
 * Previously this filtered to `kind === 'raster'` only, so every imported SVG asset was silently
 * dropped on load and any sticker/expression/animation referencing it lost its art. Imported assets
 * are matched by a stable `id`, so restoring the asset here transparently revives every usage
 * (relink-once-fix-everywhere, for free). Only genuinely-imported kinds pass through; procedural
 * kinds are ignored here because the built-ins above are the authority for those. */
function normalizeStickerAssets(raw: unknown): StickerAsset[] {
  const customFromDisk = Array.isArray(raw)
    ? raw.filter((a): a is StickerAsset => !!a && typeof a === 'object' && typeof a.id === 'string' && (a.kind === 'raster' || a.kind === 'svg'))
    : []
  return [...BUILTIN_STICKER_ASSETS, ...customFromDisk]
}

/** Backfills project.customPupilShapes for saves written before the pupil shape feature
 * existed (Array.isArray guard covers `undefined` the same way the other normalize* helpers
 * do) and drops any malformed entries rather than letting a hand-edited file crash the
 * renderer/export with a shape missing `points`. */
function normalizeCustomPupilShapes(raw: unknown): CustomPupilShape[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is CustomPupilShape => {
    return (
      !!s &&
      typeof s === 'object' &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      Array.isArray(s.points) &&
      s.points.every((p: unknown) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
    )
  })
}

/** Same purpose/shape as normalizeCustomPupilShapes above, one level up, for
 * project.customEyeShapes — backfills saves written before the eye shape feature existed and
 * drops malformed entries. svgSource defaults to '' for older/hand-edited entries missing it
 * (the derived `points` are what rendering/export actually use). */
function normalizeCustomEyeShapes(raw: unknown): CustomEyeShape[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Omit<CustomEyeShape, 'svgSource'> & { svgSource?: unknown } => {
      return (
        !!s &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        Array.isArray(s.points) &&
        s.points.every((p: unknown) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
      )
    })
    .map((s) => ({ ...s, svgSource: typeof s.svgSource === 'string' ? s.svgSource : '' }))
}

/** Backfills project.uiDesign for saves written before UI Design Mode existed, and drops any
 * individually malformed widget/screen/css-rule/asset entries (lenient like the other
 * normalize* helpers) rather than letting a hand-edited file crash the workspace. Falls back
 * to a fresh createDefaultUiDesign() if the field is missing entirely or has no usable
 * widgets — mirroring how normalizeStickerAssets always re-seeds a valid starting point. */
function normalizeListItems(raw: unknown): UiListItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return (raw as unknown[])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && typeof (i as Record<string, unknown>).widgetId === 'string')
    .map((i) => ({
      id: typeof i.id === 'string' ? i.id : nanoid(8),
      widgetId: i.widgetId as string,
      text: typeof i.text === 'string' ? i.text : '',
      iconSymbol: typeof i.iconSymbol === 'string' ? i.iconSymbol : null,
      clickEventEnabled: i.clickEventEnabled !== false,
      encoderFocusEnabled: i.encoderFocusEnabled !== false
    }))
}

const UI_KEYBOARD_LANGUAGES = new Set(['english', 'danish', 'custom'])
const UI_KEYBOARD_CASES = new Set(['lower', 'upper'])
const UI_KEYBOARD_PAGES = new Set(['letters', 'numbers', 'symbols'])
const UI_KEYBOARD_SHAPES = new Set(['rectangular', 'adaptive', 'round', 'custom'])

function normalizeKeyboardEdgePadding(raw: unknown): UiKeyboardEdgePadding {
  const r = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Partial<UiKeyboardEdgePadding>
  return {
    leftCurve: typeof r.leftCurve === 'number' ? r.leftCurve : 0,
    rightCurve: typeof r.rightCurve === 'number' ? r.rightCurve : 0,
    top: typeof r.top === 'number' ? r.top : 0,
    bottom: typeof r.bottom === 'number' ? r.bottom : 0,
    safeAreaMargin: typeof r.safeAreaMargin === 'number' ? r.safeAreaMargin : 6,
    autoEdgeCompensation: r.autoEdgeCompensation !== false
  }
}

function normalizeKeyboardCustomLayout(raw: unknown): UiKeyboardCustomLayout | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).keys)) return null
  const keys = ((raw as Record<string, unknown>).keys as unknown[])
    .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object' && typeof (k as Record<string, unknown>).label === 'string')
    .map(
      (k): UiKeyboardCustomKey => ({
        id: typeof k.id === 'string' ? k.id : nanoid(6),
        label: k.label as string,
        insertText: typeof k.insertText === 'string' ? k.insertText : (k.label as string),
        widthUnits: typeof k.widthUnits === 'number' ? k.widthUnits : undefined,
        newRow: Boolean(k.newRow)
      })
    )
  return { keys }
}

function normalizeAltChars(raw: unknown): UiKeyboardAltCharSet[] | null {
  if (!Array.isArray(raw)) return null
  return (raw as unknown[])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).base === 'string')
    .map((a) => ({
      base: a.base as string,
      variants: Array.isArray(a.variants) ? (a.variants as unknown[]).filter((v): v is string => typeof v === 'string') : []
    }))
}

/** Backfills UiWidget.keyboardConfig — lenient spread-over-defaults idiom, same as every other
 * field in this file, so a saved project from before a given keyboardConfig sub-field existed
 * (or a hand-edited file with an invalid value) just falls back to defaultKeyboardConfig()'s
 * value for that one field rather than the whole config being discarded. */
function normalizeKeyboardConfig(raw: unknown): UiKeyboardConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<UiKeyboardConfig> & Record<string, unknown>
  const d = defaultKeyboardConfig()
  return {
    targetTextareaId: typeof r.targetTextareaId === 'string' ? r.targetTextareaId : null,
    debugLabelId: typeof r.debugLabelId === 'string' ? r.debugLabelId : null,
    title: typeof r.title === 'string' ? r.title : d.title,
    language: UI_KEYBOARD_LANGUAGES.has(r.language as string) ? (r.language as UiKeyboardConfig['language']) : d.language,
    defaultCase: UI_KEYBOARD_CASES.has(r.defaultCase as string) ? (r.defaultCase as UiKeyboardConfig['defaultCase']) : d.defaultCase,
    defaultPage: UI_KEYBOARD_PAGES.has(r.defaultPage as string) ? (r.defaultPage as UiKeyboardConfig['defaultPage']) : d.defaultPage,
    showLanguageSwitchKey: r.showLanguageSwitchKey !== false,
    danishCharsEnabled: Boolean(r.danishCharsEnabled),
    customLayout: normalizeKeyboardCustomLayout(r.customLayout),
    altCharsEnabled: r.altCharsEnabled !== false,
    customAltChars: normalizeAltChars(r.customAltChars),
    autoOpen: Boolean(r.autoOpen),
    autoCloseOnSubmit: Boolean(r.autoCloseOnSubmit),
    showEventInfo: r.showEventInfo !== false,
    showSelectedCharacter: r.showSelectedCharacter !== false,
    showCursorPosition: r.showCursorPosition !== false,
    showCallbackName: r.showCallbackName !== false,
    showCurrentAction: r.showCurrentAction !== false,
    encoderEnabled: r.encoderEnabled !== false,
    wrapNavigation: r.wrapNavigation !== false,
    repeatBackspace: r.repeatBackspace !== false,
    repeatDelayMs: typeof r.repeatDelayMs === 'number' ? r.repeatDelayMs : d.repeatDelayMs,
    customFontId: typeof r.customFontId === 'string' ? r.customFontId : null,
    // NOT d.shape — defaultKeyboardConfig() defaults new keyboards to 'adaptive', but a project
    // saved before this feature existed must keep rendering/exporting exactly as it did before,
    // so an absent/invalid shape here falls back to 'rectangular' specifically, never d.shape.
    shape: UI_KEYBOARD_SHAPES.has(r.shape as string) ? (r.shape as UiKeyboardConfig['shape']) : 'rectangular',
    edgePadding: normalizeKeyboardEdgePadding(r.edgePadding)
  }
}

const UI_DATA_LIST_RENDERING_MODES = new Set(['createAll'])

function normalizeDataListConfig(raw: unknown): UiDataListConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<UiDataListConfig> & Record<string, unknown>
  return {
    dataSourceId: typeof r.dataSourceId === 'string' ? r.dataSourceId : null,
    emptyText: typeof r.emptyText === 'string' ? r.emptyText : 'No items',
    loadingText: typeof r.loadingText === 'string' ? r.loadingText : 'Loading…',
    errorText: typeof r.errorText === 'string' ? r.errorText : 'Something went wrong',
    maxItems: typeof r.maxItems === 'number' ? r.maxItems : 0,
    renderingMode: UI_DATA_LIST_RENDERING_MODES.has(r.renderingMode as string) ? (r.renderingMode as UiDataListConfig['renderingMode']) : 'createAll',
    itemClickEnabled: r.itemClickEnabled !== false,
    includeSampleDataInExport: Boolean(r.includeSampleDataInExport),
    itemSpacing: typeof r.itemSpacing === 'number' ? r.itemSpacing : 4
  }
}

function normalizeOptionsSourceConfig(raw: unknown): UiOptionsSourceConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<UiOptionsSourceConfig> & Record<string, unknown>
  return {
    dataSourceId: typeof r.dataSourceId === 'string' ? r.dataSourceId : null,
    itemTemplate: typeof r.itemTemplate === 'string' ? r.itemTemplate : '{{name}}',
    maxItems: typeof r.maxItems === 'number' ? r.maxItems : 0,
    includeSampleDataInExport: Boolean(r.includeSampleDataInExport)
  }
}

function normalizeUiDesign(raw: unknown): UiDesignProject {
  if (!raw || typeof raw !== 'object') return createDefaultUiDesign()
  const r = raw as Partial<UiDesignProject> & Record<string, unknown>

  const widgets: Record<string, UiWidget> = {}
  if (r.widgets && typeof r.widgets === 'object') {
    for (const [id, w] of Object.entries(r.widgets as Record<string, unknown>)) {
      if (!w || typeof w !== 'object') continue
      const wr = w as Partial<UiWidget> & Record<string, unknown>
      if (typeof wr.id !== 'string' || typeof wr.type !== 'string') continue
      widgets[id] = {
        id: wr.id,
        type: wr.type as UiWidget['type'],
        parentId: typeof wr.parentId === 'string' ? wr.parentId : null,
        childIds: Array.isArray(wr.childIds) ? wr.childIds.filter((c): c is string => typeof c === 'string') : [],
        tagId: typeof wr.tagId === 'string' ? wr.tagId : undefined,
        iconSymbol: typeof wr.iconSymbol === 'string' ? wr.iconSymbol : undefined,
        classNames: Array.isArray(wr.classNames) ? wr.classNames.filter((c): c is string => typeof c === 'string') : [],
        text: typeof wr.text === 'string' ? wr.text : undefined,
        src: typeof wr.src === 'string' ? wr.src : undefined,
        props: wr.props && typeof wr.props === 'object' ? (wr.props as UiWidget['props']) : {},
        style: wr.style && typeof wr.style === 'object' ? (wr.style as UiWidget['style']) : {},
        states: wr.states && typeof wr.states === 'object' ? (wr.states as UiWidget['states']) : {},
        visible: wr.visible !== false,
        locked: Boolean(wr.locked),
        allowOutsideBounds: Boolean(wr.allowOutsideBounds),
        events: Array.isArray(wr.events) ? (wr.events as UiWidget['events']) : [],
        eventCallbackEnabled: typeof wr.eventCallbackEnabled === 'boolean' ? wr.eventCallbackEnabled : undefined,
        eventCallbackTriggers: Array.isArray(wr.eventCallbackTriggers)
          ? wr.eventCallbackTriggers.filter((t): t is string => typeof t === 'string')
          : [],
        listItems: normalizeListItems(wr.listItems),
        keyboardConfig: normalizeKeyboardConfig(wr.keyboardConfig),
        dataListConfig: normalizeDataListConfig(wr.dataListConfig),
        // Backfilled for dropdown/roller/tabs even on a project saved before this field existed —
        // otherwise updateUiWidgetOptionsSource (which only mutates an already-present config,
        // matching this file's own established dataListConfig/keyboardConfig convention) would
        // silently no-op on every pre-existing widget of these 3 kinds.
        optionsSource: normalizeOptionsSourceConfig(wr.optionsSource) ?? (isOptionsSourceWidget(wr.type as UiWidget['type']) ? defaultOptionsSourceConfig() : undefined),
        visibleWhenExpr: typeof wr.visibleWhenExpr === 'string' ? wr.visibleWhenExpr : undefined,
        themeTokens: wr.themeTokens && typeof wr.themeTokens === 'object' ? (wr.themeTokens as UiWidget['themeTokens']) : undefined
      }
    }
  }

  const screens: UiScreen[] = Array.isArray(r.screens)
    ? r.screens.filter(
        (s): s is UiScreen =>
          !!s &&
          typeof s === 'object' &&
          typeof (s as UiScreen).id === 'string' &&
          typeof (s as UiScreen).rootWidgetId === 'string' &&
          !!widgets[(s as UiScreen).rootWidgetId]
      )
    : []

  if (Object.keys(widgets).length === 0 || screens.length === 0) return createDefaultUiDesign()

  const css: UiCssRule[] = Array.isArray(r.css)
    ? r.css.filter(
        (c): c is UiCssRule => !!c && typeof c === 'object' && typeof (c as UiCssRule).id === 'string' && typeof (c as UiCssRule).selector === 'string'
      )
    : []
  const assets: UiAsset[] = Array.isArray(r.assets)
    ? (r.assets as unknown[])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).id === 'string' && typeof (a as Record<string, unknown>).dataUrl === 'string')
        .map((a) => ({
          id: a.id as string,
          name: typeof a.name === 'string' ? a.name : 'Untitled Asset',
          dataUrl: a.dataUrl as string,
          naturalWidth: typeof a.naturalWidth === 'number' ? a.naturalWidth : 0,
          naturalHeight: typeof a.naturalHeight === 'number' ? a.naturalHeight : 0,
          // Saves from before UiAsset tracked this default to "PNG" — every asset is already
          // normalized to a PNG data URL internally regardless (see decodeUiImageAsset), so
          // that's the truthful fallback, not a guess.
          sourceFormat: typeof a.sourceFormat === 'string' ? a.sourceFormat : 'PNG'
        }))
    : []

  const customFonts: UiCustomFont[] = Array.isArray(r.customFonts)
    ? (r.customFonts as unknown[])
        .filter(
          (f): f is Record<string, unknown> =>
            !!f && typeof f === 'object' && typeof (f as Record<string, unknown>).id === 'string' && typeof (f as Record<string, unknown>).cSource === 'string'
        )
        .map((f) => ({
          id: f.id as string,
          name: typeof f.name === 'string' ? f.name : 'Untitled Font',
          cSource: f.cSource as string,
          declaredCodepoints: Array.isArray(f.declaredCodepoints) ? (f.declaredCodepoints as unknown[]).filter((c): c is number => typeof c === 'number') : []
        }))
    : []

  const activeScreenId = typeof r.activeScreenId === 'string' && screens.some((s) => s.id === r.activeScreenId) ? r.activeScreenId : screens[0].id

  const UI_VARIABLE_TYPES = new Set(['number', 'text', 'boolean', 'color', 'list', 'image', 'object'])
  const UI_VARIABLE_SCOPES = new Set(['global', 'screen', 'component', 'sensor', 'api', 'hardware'])
  const variables: UiVariable[] = Array.isArray(r.variables)
    ? (r.variables as unknown[])
        .filter(
          (v): v is Record<string, unknown> =>
            !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).id === 'string' && typeof (v as Record<string, unknown>).name === 'string'
        )
        .map((v) => ({
          id: v.id as string,
          name: v.name as string,
          type: (UI_VARIABLE_TYPES.has(v.type as string) ? v.type : 'text') as UiVariable['type'],
          scope: (UI_VARIABLE_SCOPES.has(v.scope as string) ? v.scope : 'global') as UiVariable['scope'],
          screenId: typeof v.screenId === 'string' ? v.screenId : undefined,
          componentId: typeof v.componentId === 'string' ? v.componentId : undefined,
          defaultValue: typeof v.defaultValue === 'string' || typeof v.defaultValue === 'number' || typeof v.defaultValue === 'boolean' ? v.defaultValue : '',
          min: typeof v.min === 'number' ? v.min : undefined,
          max: typeof v.max === 'number' ? v.max : undefined,
          unit: typeof v.unit === 'string' ? v.unit : undefined,
          format: typeof v.format === 'string' ? v.format : undefined,
          fallback: typeof v.fallback === 'string' || typeof v.fallback === 'number' || typeof v.fallback === 'boolean' ? v.fallback : undefined
        }))
    : []

  const UI_DATA_SOURCE_FIELD_TYPES = new Set(['int', 'double', 'bool', 'string'])
  const UI_DATA_SOURCE_KINDS = new Set([
    'static', 'cppArray', 'cppStructArray', 'stdArray', 'stdVector',
    'jsonObject', 'jsonArray', 'httpResponse', 'mqttPayload', 'sensorValue',
    'appVariable', 'callbackFunction', 'custom'
  ])
  const dataSources: UiDataSource[] = Array.isArray(r.dataSources)
    ? (r.dataSources as unknown[])
        .filter(
          (d): d is Record<string, unknown> =>
            !!d && typeof d === 'object' && typeof (d as Record<string, unknown>).id === 'string' && typeof (d as Record<string, unknown>).name === 'string'
        )
        .map((d) => {
          const fields: UiDataSourceField[] = Array.isArray(d.fields)
            ? (d.fields as unknown[])
                .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as Record<string, unknown>).id === 'string')
                .map((f) => ({
                  id: f.id as string,
                  name: typeof f.name === 'string' ? f.name : 'field',
                  type: (UI_DATA_SOURCE_FIELD_TYPES.has(f.type as string) ? f.type : 'string') as UiDataSourceField['type']
                }))
            : []
          return {
            id: d.id as string,
            name: d.name as string,
            sourceKind: UI_DATA_SOURCE_KINDS.has(d.sourceKind as string) ? (d.sourceKind as UiDataSource['sourceKind']) : 'static',
            fields,
            keyFieldId: typeof d.keyFieldId === 'string' ? d.keyFieldId : null,
            sampleData: typeof d.sampleData === 'string' ? d.sampleData : '[]',
            structNameOverride: typeof d.structNameOverride === 'string' ? d.structNameOverride : undefined
          }
        })
    : []

  const UI_THEME_IDS = new Set(['light', 'dark', 'amoled', 'material', 'fluent', 'apple', 'gaming', 'automotive', 'cyberpunk', 'custom'])
  const theme: UiThemeId = UI_THEME_IDS.has(r.theme as string) ? (r.theme as UiThemeId) : 'dark'
  const customThemeTokens: UiThemeTokens | null =
    theme === 'custom' && r.customThemeTokens && typeof r.customThemeTokens === 'object' ? { ...DEFAULT_CUSTOM_THEME_TOKENS, ...(r.customThemeTokens as Partial<UiThemeTokens>) } : null

  return {
    widgets,
    screens,
    activeScreenId,
    css,
    assets,
    customFonts,
    variables,
    dataSources,
    display: normalizeUiDisplay(r.display),
    theme,
    customThemeTokens,
    htmlSource: typeof r.htmlSource === 'string' ? r.htmlSource : '',
    cssSource: typeof r.cssSource === 'string' ? r.cssSource : '',
    script: typeof r.script === 'string' ? r.script : ''
  }
}

const UI_DISPLAY_SHAPES: UiDisplayShape[] = ['round', 'square', 'rectangle', 'custom']
const UI_DISPLAY_ORIENTATIONS: UiDisplayOrientation[] = ['portrait', 'landscape']
const UI_DISPLAY_ROTATIONS: UiDisplayRotation[] = [0, 90, 180, 270]

/** Backfills project.uiDesign.display — added after UI Design Mode's own display config
 * existed as a separate setting from project.display (Eye Studio's) — same lenient
 * spread-over-defaults idiom as normalizeEyeParams, so a save from before this field existed
 * (or a hand-edited file with a missing/invalid value) just gets sane defaults per-field
 * rather than the whole object being discarded. */
function normalizeUiDisplay(raw: unknown): UiDisplaySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<UiDisplaySettings> & Record<string, unknown>
  return {
    width: typeof r.width === 'number' && r.width > 0 ? r.width : DEFAULT_UI_DISPLAY.width,
    height: typeof r.height === 'number' && r.height > 0 ? r.height : DEFAULT_UI_DISPLAY.height,
    shape: UI_DISPLAY_SHAPES.includes(r.shape as UiDisplayShape) ? (r.shape as UiDisplayShape) : DEFAULT_UI_DISPLAY.shape,
    orientation: UI_DISPLAY_ORIENTATIONS.includes(r.orientation as UiDisplayOrientation) ? (r.orientation as UiDisplayOrientation) : DEFAULT_UI_DISPLAY.orientation,
    rotation: UI_DISPLAY_ROTATIONS.includes(r.rotation as UiDisplayRotation) ? (r.rotation as UiDisplayRotation) : DEFAULT_UI_DISPLAY.rotation,
    backgroundColor: typeof r.backgroundColor === 'string' ? r.backgroundColor : DEFAULT_UI_DISPLAY.backgroundColor
  }
}

/** Backfills fields added after a project/autosave was written (e.g. the old scalar
 * `irisSize`/`pupilSize` becoming `irisWidth`/`irisHeight`/`pupilWidth`/`pupilHeight`, or
 * the whole `colors`/`display` themes, or the per-eye override fields added for the Eye
 * Target feature) with defaults, so older saves on disk or in localStorage don't break the
 * renderer or leave sliders holding `undefined`. */
function normalizeProject(raw: Partial<Project> & Record<string, unknown>): Project {
  const eyeBase = normalizeEyeParams(raw.eyeBase)
  const colors = { ...DEFAULT_EYE_COLORS, ...(raw.colors ?? {}) }

  // Files saved before the Visual Reference system existed have no visualReference field at
  // all — seed it from this project's own shared base pose/colors (rather than the generic
  // app defaults) so re-saving an old project changes nothing visually: every expression and
  // keyframe that already matched the old shared look keeps matching it (now "inherited"),
  // and everything that already diverged from it is protected as an override below.
  const rawVr = raw.visualReference as Partial<VisualReferenceStyle> | undefined
  const visualReference: VisualReferenceStyle = {
    params: rawVr?.params ? normalizeEyeParams(rawVr.params) : { ...eyeBase },
    colors: rawVr?.colors ? { ...DEFAULT_EYE_COLORS, ...rawVr.colors } : { ...colors },
    paramsLeftOverride: normalizeEyeParamsOverride(rawVr?.paramsLeftOverride),
    paramsRightOverride: normalizeEyeParamsOverride(rawVr?.paramsRightOverride),
    colorsLeftOverride: normalizeEyeColorsOverride(rawVr?.colorsLeftOverride),
    colorsRightOverride: normalizeEyeColorsOverride(rawVr?.colorsRightOverride)
  }

  const animations: Animation[] = (raw.animations ?? []).map((aRaw, animIndex) => {
    const a = aRaw as unknown as Record<string, unknown>
    const loop = Boolean(a.loop)
    const poseKeyframes = normalizeKeyframeList(a.keyframes, visualReference)
    const durationMs = migratedDurationMs(a.keyframes, loop) ?? (typeof a.durationMs === 'number' ? a.durationMs : poseKeyframes[poseKeyframes.length - 1]?.timeMs ?? 0)
    const stickers = normalizeStickerInstances(a.stickers)
    const leftEyeKeyframes = normalizeKeyframeList(a.leftEyeKeyframes, visualReference)
    const rightEyeKeyframes = normalizeKeyframeList(a.rightEyeKeyframes, visualReference)
    const pupilKeyframes = normalizeKeyframeList(a.pupilKeyframes, visualReference)
    const eyelidKeyframes = normalizeKeyframeList(a.eyelidKeyframes, visualReference)
    const markers = normalizeMarkers(a.markers)
    const tracks = normalizeTracks(a.tracks, new Set(stickers.map((s) => s.layer)), {
      leftEye: leftEyeKeyframes.length > 0,
      rightEye: rightEyeKeyframes.length > 0,
      pupils: pupilKeyframes.length > 0,
      eyelids: eyelidKeyframes.length > 0,
      marker: markers.length > 0
    })
    // Resolve any sticker whose trackId didn't survive (dropped track, or a layer that no
    // longer has a matching track) to whichever sticker track exists — not layer-matched, since
    // a track's stickerLayer is just its own default for newly-added stickers, not a hard
    // constraint on what can live there (see assignStickerToTrack/addStickerToTrack).
    const stickerTracks = tracks.filter((t) => t.kind === 'sticker').sort((x, y) => x.order - y.order)
    for (const s of stickers) {
      if (!s.trackId || !tracks.some((t) => t.id === s.trackId)) {
        s.trackId = stickerTracks[0]?.id ?? ''
      }
    }
    return {
      id: typeof a.id === 'string' ? a.id : nanoid(8),
      name: typeof a.name === 'string' ? a.name : 'Untitled',
      loop,
      durationMs,
      keyframes: poseKeyframes,
      leftEyeKeyframes,
      rightEyeKeyframes,
      pupilKeyframes,
      eyelidKeyframes,
      tracks,
      stickers,
      markers,
      // Animation-panel folder organization (see AnimationFolder). Old projects have neither field:
      // folderId defaults to null (root), order backfills from array index so the flat list renders
      // exactly as before. animation.id itself is never touched, so references stay valid.
      folderId: typeof a.folderId === 'string' ? a.folderId : null,
      order: typeof a.order === 'number' ? a.order : animIndex,
      // Owned pupil (see Animation.pupilColor). Old projects predate the field: backfill from the
      // first pose keyframe that carries its own colours (its saved pupil), else the project's base
      // pupil — either way the animation loads self-contained and looks exactly as it did, while
      // no longer following the shared palette's pupil across Combination clips going forward.
      pupilColor:
        typeof a.pupilColor === 'string'
          ? a.pupilColor
          : poseKeyframes.find((k) => k.colors)?.colors?.pupil ?? colors.pupil
    }
  })
  const animationIds = new Set(animations.map((a) => a.id))

  // Animation-panel folder tree (editor organization only). Coerce each folder, then repair the
  // links: a folder whose parent doesn't exist (or that would form a cycle) is reparented to root,
  // and any animation.folderId pointing at a missing folder falls back to root. This keeps the tree
  // always well-formed regardless of hand-edited/older files. Old projects have no animationFolders
  // → empty array, every animation stays at root (folderId already defaulted to null above).
  const rawFolders = Array.isArray(raw.animationFolders) ? raw.animationFolders : []
  const animationFolders: AnimationFolder[] = rawFolders.map((fRaw, i) => {
    const f = fRaw as unknown as Record<string, unknown>
    return {
      id: typeof f.id === 'string' ? f.id : nanoid(8),
      name: typeof f.name === 'string' ? f.name : 'Folder',
      parentId: typeof f.parentId === 'string' ? f.parentId : null,
      order: typeof f.order === 'number' ? f.order : i,
      expanded: f.expanded !== false // default to expanded when absent
    }
  })
  const folderById = new Map(animationFolders.map((f) => [f.id, f]))
  for (const f of animationFolders) {
    if (f.parentId && !folderById.has(f.parentId)) f.parentId = null
  }
  for (const f of animationFolders) {
    const seen = new Set<string>()
    let cur: string | null = f.parentId
    while (cur) {
      if (cur === f.id || seen.has(cur)) {
        f.parentId = null // break a parent cycle
        break
      }
      seen.add(cur)
      cur = folderById.get(cur)?.parentId ?? null
    }
  }
  for (const a of animations) {
    if (a.folderId && !folderById.has(a.folderId)) a.folderId = null
  }
  const animationCombos: AnimationCombo[] = (raw.animationCombos ?? []).map((comboRaw) => {
    const combo = comboRaw as unknown as Record<string, unknown>
    const clips: AnimationComboClip[] = Array.isArray(combo.clips)
      ? combo.clips
          .map((clipRaw) => {
            const clip = clipRaw as Partial<AnimationComboClip> & Record<string, unknown>
            const animationId = typeof clip.animationId === 'string' && animationIds.has(clip.animationId) ? clip.animationId : ''
            if (!animationId) return null
            return {
              id: typeof clip.id === 'string' ? clip.id : nanoid(8),
              animationId,
              startTimeMs: typeof clip.startTimeMs === 'number' ? Math.max(0, Math.round(clip.startTimeMs)) : 0,
              loopCount: typeof clip.loopCount === 'number' && clip.loopCount > 0 ? Math.round(clip.loopCount) : 1,
              playbackSpeed: typeof clip.playbackSpeed === 'number' && clip.playbackSpeed > 0 ? clip.playbackSpeed : 100,
              transitionMs: typeof clip.transitionMs === 'number' ? Math.max(0, Math.round(clip.transitionMs)) : 0,
              endDelayMs: typeof clip.endDelayMs === 'number' ? Math.max(0, Math.round(clip.endDelayMs)) : 0
            }
          })
          .filter((clip): clip is AnimationComboClip => !!clip)
          .sort((a, b) => a.startTimeMs - b.startTimeMs)
      : []
    return {
      id: typeof combo.id === 'string' ? combo.id : nanoid(8),
      name: typeof combo.name === 'string' ? combo.name : 'Untitled Combo',
      loop: Boolean(combo.loop),
      clips
    }
  })
  const expressions: Expression[] = (raw.expressions ?? []).map((e, exprIndex) => {
    const params = normalizeEyeParams(e.params)
    const exprColors = { ...DEFAULT_EYE_COLORS, ...(e.colors ?? {}) }
    const eRaw = e as unknown as Record<string, unknown>
    return {
      ...e,
      params,
      colors: exprColors,
      leftParams: normalizeEyeParamsOverride(e.leftParams),
      rightParams: normalizeEyeParamsOverride(e.rightParams),
      leftColors: normalizeEyeColorsOverride(e.leftColors),
      rightColors: normalizeEyeColorsOverride(e.rightColors),
      styleOverrides: normalizeStyleOverrides(e.styleOverrides) ?? computeStyleOverrides(params, exprColors, visualReference),
      stickers: normalizeStickerInstances(eRaw.stickers),
      // Expressions-panel folder organization (see ExpressionFolder). Old projects have neither
      // field: folderId defaults to null (root), order backfills from array index — the flat list
      // renders exactly as before. expression.id is never touched, so references stay valid.
      folderId: typeof eRaw.folderId === 'string' ? eRaw.folderId : null,
      order: typeof eRaw.order === 'number' ? eRaw.order : exprIndex
    }
  })

  // Expressions-panel folder tree (editor organization only) — same repair pass as animationFolders.
  const rawExprFolders = Array.isArray(raw.expressionFolders) ? raw.expressionFolders : []
  const expressionFolders: ExpressionFolder[] = rawExprFolders.map((fRaw, i) => {
    const f = fRaw as unknown as Record<string, unknown>
    return {
      id: typeof f.id === 'string' ? f.id : nanoid(8),
      name: typeof f.name === 'string' ? f.name : 'Folder',
      parentId: typeof f.parentId === 'string' ? f.parentId : null,
      order: typeof f.order === 'number' ? f.order : i,
      expanded: f.expanded !== false // default to expanded when absent
    }
  })
  const exprFolderById = new Map(expressionFolders.map((f) => [f.id, f]))
  for (const f of expressionFolders) {
    if (f.parentId && !exprFolderById.has(f.parentId)) f.parentId = null
  }
  for (const f of expressionFolders) {
    const seen = new Set<string>()
    let cur: string | null = f.parentId
    while (cur) {
      if (cur === f.id || seen.has(cur)) {
        f.parentId = null // break a parent cycle
        break
      }
      seen.add(cur)
      cur = exprFolderById.get(cur)?.parentId ?? null
    }
  }
  for (const e of expressions) {
    if (e.folderId && !exprFolderById.has(e.folderId)) e.folderId = null
  }

  return {
    id: raw.id ?? nanoid(10),
    name: raw.name ?? 'Untitled Project',
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    eyeBase,
    colors,
    eyeLeftOverride: normalizeEyeParamsOverride(raw.eyeLeftOverride),
    eyeRightOverride: normalizeEyeParamsOverride(raw.eyeRightOverride),
    colorsLeftOverride: normalizeEyeColorsOverride(raw.colorsLeftOverride),
    colorsRightOverride: normalizeEyeColorsOverride(raw.colorsRightOverride),
    display: { ...DEFAULT_DISPLAY, ...(raw.display ?? {}) },
    personality: { ...DEFAULT_PERSONALITY, ...(raw.personality ?? {}) },
    timing: { ...DEFAULT_TIMING, ...(raw.timing ?? {}) },
    animations,
    animationFolders,
    animationCombos,
    expressions,
    expressionFolders,
    visualReference,
    customPupilShapes: normalizeCustomPupilShapes(raw.customPupilShapes),
    customEyeShapes: normalizeCustomEyeShapes(raw.customEyeShapes),
    stickerAssets: normalizeStickerAssets((raw as unknown as Record<string, unknown>).stickerAssets),
    stickers: normalizeStickerInstances((raw as unknown as Record<string, unknown>).stickers),
    uiDesign: normalizeUiDesign((raw as unknown as Record<string, unknown>).uiDesign)
  }
}

const UI_POSITION_INFO_FIELDS: UiPositionInfoField[] = [
  'x',
  'y',
  'width',
  'height',
  'centerX',
  'centerY',
  'distanceFromScreenCenter',
  'distanceFromParentEdges',
  'rotation',
  'zoomLevel'
]

/** Same per-field defensive-fallback idiom as normalizeUiDisplay above — an old save (or one
 * from before this feature existed) just gets sane defaults per-field rather than the whole
 * settings object being discarded. */
function normalizeUiWorkspaceView(raw: unknown): UiWorkspaceViewSettings {
  const d = defaultUiWorkspaceView()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<UiWorkspaceViewSettings> & Record<string, unknown>
  const clampNum = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

  return {
    zoom: clampNum(r.zoom, d.zoom, 0.1, 8),
    panX: clampNum(r.panX, d.panX, -100000, 100000),
    panY: clampNum(r.panY, d.panY, -100000, 100000),
    gridSize: clampNum(r.gridSize, d.gridSize, 1, 200),
    gridVisible: bool(r.gridVisible, d.gridVisible),
    gridOpacity: clampNum(r.gridOpacity, d.gridOpacity, 0, 100),
    gridSubdivision: clampNum(r.gridSubdivision, d.gridSubdivision, 1, 20),
    snapEnabled: bool(r.snapEnabled, d.snapEnabled),
    snapDistance: clampNum(r.snapDistance, d.snapDistance, 0, 100),
    magneticStrength: clampNum(r.magneticStrength, d.magneticStrength, 0, 100),
    snapToGrid: bool(r.snapToGrid, d.snapToGrid),
    snapToCenter: bool(r.snapToCenter, d.snapToCenter),
    snapToDisplayEdges: bool(r.snapToDisplayEdges, d.snapToDisplayEdges),
    snapToSafeArea: bool(r.snapToSafeArea, d.snapToSafeArea),
    snapToParent: bool(r.snapToParent, d.snapToParent),
    snapToWidgets: bool(r.snapToWidgets, d.snapToWidgets),
    rulersVisible: bool(r.rulersVisible, d.rulersVisible),
    guidesVisible: bool(r.guidesVisible, d.guidesVisible),
    safeAreaVisible: bool(r.safeAreaVisible, d.safeAreaVisible),
    safeAreaMargin: clampNum(r.safeAreaMargin, d.safeAreaMargin, 0, 200),
    pixelAccurateMode: bool(r.pixelAccurateMode, d.pixelAccurateMode),
    positionInfoFields: Array.isArray(r.positionInfoFields)
      ? (r.positionInfoFields as unknown[]).filter((f): f is UiPositionInfoField => UI_POSITION_INFO_FIELDS.includes(f as UiPositionInfoField))
      : d.positionInfoFields
  }
}

function normalizeEditorState(raw: Partial<EditorState> | undefined, project: Project): EditorState {
  const fallback = defaultEditorState(project)
  if (!raw || typeof raw !== 'object') return fallback

  const eyeTarget: EyeSide = raw.eyeTarget === 'left' || raw.eyeTarget === 'right' ? raw.eyeTarget : 'both'
  const mode: PlaybackMode = raw.mode === 'animate' || raw.mode === 'idle' ? raw.mode : 'design'
  const activeAnimationId =
    typeof raw.activeAnimationId === 'string' && project.animations.some((a) => a.id === raw.activeAnimationId)
      ? raw.activeAnimationId
      : fallback.activeAnimationId
  const selectedExpressionId =
    typeof raw.selectedExpressionId === 'string' && project.expressions.some((e) => e.id === raw.selectedExpressionId)
      ? raw.selectedExpressionId
      : null
  const uiWorkspaceView = normalizeUiWorkspaceView((raw as unknown as Record<string, unknown>).uiWorkspaceView)

  return { eyeTarget, selectedExpressionId, activeAnimationId, mode, uiWorkspaceView }
}

function looksLikeProject(raw: unknown): raw is Partial<Project> & Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return false
  const obj = raw as Record<string, unknown>
  return Array.isArray(obj.animations) && Array.isArray(obj.expressions)
}

/** Parses raw file contents into a fully-normalized, current-version ProjectFile — the one
 * place old formats get migrated forward and invalid files get rejected with a clear error.
 * Two shapes are recognized today:
 *   - The current versioned envelope: { formatVersion, project, editorState }
 *   - The pre-versioning format (every project saved before this feature existed), where the
 *     file's top level *is* the bare Project object with no wrapper at all.
 * Future format changes should add a version-gated branch here rather than replacing this
 * logic, so old files keep opening correctly. */
function parseProjectFile(json: string): ProjectFile {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ProjectFileError('This file is not valid JSON, so it could not be opened. It may be corrupted.')
  }

  if (!raw || typeof raw !== 'object') {
    throw new ProjectFileError('This file does not contain a Kibo  Studio project.')
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj.formatVersion === 'number' && looksLikeProject(obj.project)) {
    const project = normalizeProject(obj.project)
    const editorState = normalizeEditorState(obj.editorState as Partial<EditorState> | undefined, project)
    return { formatVersion: PROJECT_FILE_VERSION, project, editorState }
  }

  if (looksLikeProject(obj)) {
    const project = normalizeProject(obj)
    return { formatVersion: PROJECT_FILE_VERSION, project, editorState: defaultEditorState(project) }
  }

  throw new ProjectFileError('This file does not contain a Kibo  Studio project.')
}

export function serializeProjectFile(project: Project, editorState: EditorState): string {
  const file: ProjectFile = { formatVersion: PROJECT_FILE_VERSION, project, editorState }
  return JSON.stringify(file, null, 2)
}

export function deserializeProjectFile(json: string): ProjectFile {
  return parseProjectFile(json)
}

function suggestedFileName(project: Project): string {
  const base = project.name.replace(/[^a-z0-9 _-]/gi, '_').trim() || 'Untitled Project'
  return `${base}.${PROJECT_FILE_EXTENSION}`
}

export async function saveProjectAs(project: Project, editorState: EditorState): Promise<string | null> {
  const json = serializeProjectFile(project, editorState)
  const suggested = suggestedFileName(project)
  if (hasElectron()) {
    const result = await window.kibo!.saveProjectAs(json, suggested)
    if (result.canceled || !result.filePath) return null
    touchRecentProject(result.filePath, project.name)
    return result.filePath
  }
  downloadTextFile(json, suggested)
  return suggested
}

export async function saveProjectToPath(filePath: string, project: Project, editorState: EditorState): Promise<void> {
  const json = serializeProjectFile(project, editorState)
  if (hasElectron()) {
    await window.kibo!.saveProjectToPath(filePath, json)
    touchRecentProject(filePath, project.name)
    return
  }
  localStorage.setItem(LOCAL_STORAGE_PATH_KEY, filePath)
  downloadTextFile(json, filePath)
}

export type OpenProjectOutcome =
  | { status: 'ok'; project: Project; editorState: EditorState; filePath: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

export async function openProjectDialog(): Promise<OpenProjectOutcome> {
  if (hasElectron()) {
    const result = await window.kibo!.openProject()
    if (result.canceled || !result.json) return { status: 'canceled' }
    try {
      const file = parseProjectFile(result.json)
      if (result.filePath) touchRecentProject(result.filePath, file.project.name)
      return { status: 'ok', project: file.project, editorState: file.editorState, filePath: result.filePath ?? '' }
    } catch (err) {
      return { status: 'error', message: err instanceof ProjectFileError ? err.message : 'This file could not be opened.' }
    }
  }
  return openProjectFilePicker()
}

/** Reopens a project directly by path (Electron-only — no file-picker dialog), used by the
 * Home Screen's Recent Projects list. Mirrors openProjectDialog's outcome shape/error handling
 * so callers can treat both the same way; on failure (file moved/deleted since it was last
 * opened) the caller is expected to also call removeRecentProject(filePath). */
export async function openProjectFromPath(filePath: string): Promise<OpenProjectOutcome> {
  if (!hasElectron()) return { status: 'error', message: 'Reopening a project by path is only available in the desktop app.' }
  const result = await window.kibo!.openProjectPath(filePath)
  if (!result.ok || !result.json) {
    return { status: 'error', message: 'This project could not be found. It may have been moved or deleted.' }
  }
  try {
    const file = parseProjectFile(result.json)
    touchRecentProject(filePath, file.project.name)
    return { status: 'ok', project: file.project, editorState: file.editorState, filePath }
  } catch (err) {
    return { status: 'error', message: err instanceof ProjectFileError ? err.message : 'This file could not be opened.' }
  }
}

function openProjectFilePicker(): Promise<OpenProjectOutcome> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.${PROJECT_FILE_EXTENSION},.json,application/json`
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve({ status: 'canceled' })
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = parseProjectFile(String(reader.result))
          resolve({ status: 'ok', project: parsed.project, editorState: parsed.editorState, filePath: file.name })
        } catch (err) {
          resolve({ status: 'error', message: err instanceof ProjectFileError ? err.message : 'This file could not be opened.' })
        }
      }
      reader.readAsText(file)
    }
    input.click()
  })
}

export async function autosaveWrite(project: Project, editorState: EditorState): Promise<void> {
  const json = serializeProjectFile(project, editorState)
  if (hasElectron()) {
    await window.kibo!.autosaveWrite(json)
    return
  }
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, json)
  } catch {
    // Ignore quota errors — autosave is best-effort.
  }
}

export async function autosaveRead(): Promise<ProjectFile | null> {
  if (hasElectron()) {
    const result = await window.kibo!.autosaveRead()
    if (!result.exists || !result.json) return null
    try {
      return parseProjectFile(result.json)
    } catch {
      // A corrupted autosave shouldn't block launching the app — just skip it.
      return null
    }
  }
  const json = localStorage.getItem(LOCAL_STORAGE_KEY)
  if (!json) return null
  try {
    return parseProjectFile(json)
  } catch {
    return null
  }
}

// ---- Code export (separate from project save/load above: this writes generated ESP32/
// Arduino source, never project data, and is never read back in) --------------------------

export async function exportFile(defaultName: string, contents: string, extensions: string[]): Promise<boolean> {
  if (hasElectron()) {
    const result = await window.kibo!.exportSaveFile(defaultName, contents, [{ name: 'Export', extensions }])
    return !result.canceled
  }
  downloadTextFile(contents, defaultName)
  return true
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Binary counterpart of exportFile — used for the UI Design Mode LVGL export's downloadable
 * .zip (a real zip archive, not text, so it can't reuse the string-based path above). */
export async function exportBinaryFile(defaultName: string, bytes: Uint8Array, extensions: string[]): Promise<boolean> {
  if (hasElectron()) {
    const result = await window.kibo!.exportSaveBinaryFile(defaultName, bytesToBase64(bytes), [{ name: 'Export', extensions }])
    return !result.canceled
  }
  downloadBinaryFile(bytes, defaultName)
  return true
}

export async function importJsonDialog(): Promise<string | null> {
  if (hasElectron()) {
    const result = await window.kibo!.importOpenJson()
    return result.canceled ? null : (result.json ?? null)
  }
  const picked = await openProjectFilePicker()
  return picked.status === 'ok' ? serializeProjectFile(picked.project, picked.editorState) : null
}

function downloadTextFile(contents: string, filename: string): void {
  const blob = new Blob([contents], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadBinaryFile(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
