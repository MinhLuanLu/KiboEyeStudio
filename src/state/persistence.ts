import { nanoid } from 'nanoid'
import type {
  Animation,
  CustomPupilShape,
  EditorState,
  Expression,
  EyeColors,
  EyeParams,
  EyeSide,
  PlaybackMode,
  Project,
  ProjectFile,
  StickerAsset,
  StickerInstance,
  VisualReferenceStyle
} from '@/types'
import {
  DEFAULT_DISPLAY,
  DEFAULT_EYE_COLORS,
  DEFAULT_EYE_PARAMS,
  DEFAULT_PERSONALITY,
  DEFAULT_STICKER_ANIM,
  DEFAULT_TIMING,
  PROJECT_FILE_VERSION,
  computeStyleOverrides,
  defaultEditorState
} from '@/types'
import { BUILTIN_STICKER_ASSETS } from '@/renderer/builtinStickers'

const LOCAL_STORAGE_KEY = 'kibo-eye-studio:autosave'
const LOCAL_STORAGE_PATH_KEY = 'kibo-eye-studio:last-path'
const PROJECT_FILE_EXTENSION = 'kiboeyes'

/** Thrown by parseProjectFile for anything that isn't a readable Kibo Eye Studio project —
 * caught at the call site (App.tsx) and shown to the user as a plain-language error rather
 * than crashing or silently discarding their file. */
export class ProjectFileError extends Error {}

function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!window.kibo
}

function normalizeEyeParams(params: Partial<EyeParams> | undefined): EyeParams {
  return { ...DEFAULT_EYE_PARAMS, ...(params ?? {}) }
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
      scale: typeof r.scale === 'number' ? r.scale : 100,
      rotation: typeof r.rotation === 'number' ? r.rotation : 0,
      opacity: typeof r.opacity === 'number' ? r.opacity : 100,
      tint: typeof r.tint === 'string' ? r.tint : null,
      flipH: Boolean(r.flipH),
      flipV: Boolean(r.flipV),
      visible: r.visible !== false,
      locked: Boolean(r.locked),
      anim: { ...DEFAULT_STICKER_ANIM, ...(r.anim ?? {}) }
    })
  }
  return out
}

/** Backfills project.stickerAssets: keeps every valid custom (raster) asset from the save
 * file, then re-seeds the built-in procedural assets fresh from BUILTIN_STICKER_ASSETS every
 * load (rather than trusting whatever was saved for them) — built-ins are code-defined, not
 * user data, so this is the same "source of truth lives in code" treatment
 * createDefaultProject() already gives builtinAnimations/builtinExpressions. */
function normalizeStickerAssets(raw: unknown): StickerAsset[] {
  const customFromDisk = Array.isArray(raw)
    ? raw.filter((a): a is StickerAsset => !!a && typeof a === 'object' && typeof a.id === 'string' && a.kind === 'raster')
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

  const animations: Animation[] = (raw.animations ?? []).map((a) => ({
    ...a,
    keyframes: a.keyframes.map((k) => {
      const params = normalizeEyeParams(k.params)
      const rawStyleOverrides = (k as unknown as Record<string, unknown>).styleOverrides
      return {
        ...k,
        params,
        styleOverrides: normalizeStyleOverrides(rawStyleOverrides) ?? computeStyleOverrides(params, null, visualReference)
      }
    }),
    stickers: normalizeStickerInstances((a as unknown as Record<string, unknown>).stickers)
  }))
  const expressions: Expression[] = (raw.expressions ?? []).map((e) => {
    const params = normalizeEyeParams(e.params)
    const exprColors = { ...DEFAULT_EYE_COLORS, ...(e.colors ?? {}) }
    return {
      ...e,
      params,
      colors: exprColors,
      leftParams: normalizeEyeParamsOverride(e.leftParams),
      rightParams: normalizeEyeParamsOverride(e.rightParams),
      leftColors: normalizeEyeColorsOverride(e.leftColors),
      rightColors: normalizeEyeColorsOverride(e.rightColors),
      styleOverrides: normalizeStyleOverrides(e.styleOverrides) ?? computeStyleOverrides(params, exprColors, visualReference),
      stickers: normalizeStickerInstances((e as unknown as Record<string, unknown>).stickers)
    }
  })

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
    expressions,
    visualReference,
    customPupilShapes: normalizeCustomPupilShapes(raw.customPupilShapes),
    stickerAssets: normalizeStickerAssets((raw as unknown as Record<string, unknown>).stickerAssets),
    stickers: normalizeStickerInstances((raw as unknown as Record<string, unknown>).stickers)
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

  return { eyeTarget, selectedExpressionId, activeAnimationId, mode }
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
    throw new ProjectFileError('This file does not contain a Kibo Eye Studio project.')
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

  throw new ProjectFileError('This file does not contain a Kibo Eye Studio project.')
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
    return result.canceled ? null : (result.filePath ?? null)
  }
  downloadTextFile(json, suggested)
  return suggested
}

export async function saveProjectToPath(filePath: string, project: Project, editorState: EditorState): Promise<void> {
  const json = serializeProjectFile(project, editorState)
  if (hasElectron()) {
    await window.kibo!.saveProjectToPath(filePath, json)
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
      return { status: 'ok', project: file.project, editorState: file.editorState, filePath: result.filePath ?? '' }
    } catch (err) {
      return { status: 'error', message: err instanceof ProjectFileError ? err.message : 'This file could not be opened.' }
    }
  }
  return openProjectFilePicker()
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
