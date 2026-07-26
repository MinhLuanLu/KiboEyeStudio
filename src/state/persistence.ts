import { nanoid } from 'nanoid'
import type { Animation, Expression, EyeColors, EyeParams, Project } from '@/types'
import { DEFAULT_DISPLAY, DEFAULT_EYE_COLORS, DEFAULT_EYE_PARAMS, DEFAULT_PERSONALITY, DEFAULT_TIMING } from '@/types'

const LOCAL_STORAGE_KEY = 'kibo-eye-studio:autosave'
const LOCAL_STORAGE_PATH_KEY = 'kibo-eye-studio:last-path'

function hasElectron(): boolean {
  return typeof window !== 'undefined' && !!window.kibo
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
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

/** Backfills fields added after a project/autosave was written (e.g. the old scalar
 * `irisSize`/`pupilSize` becoming `irisWidth`/`irisHeight`/`pupilWidth`/`pupilHeight`, or
 * the whole `colors`/`display` themes, or the per-eye override fields added for the Eye
 * Target feature) with defaults, so older saves on disk or in localStorage don't break the
 * renderer or leave sliders holding `undefined`. */
function normalizeProject(raw: Partial<Project> & Record<string, unknown>): Project {
  const animations: Animation[] = (raw.animations ?? []).map((a) => ({
    ...a,
    keyframes: a.keyframes.map((k) => ({ ...k, params: normalizeEyeParams(k.params) }))
  }))
  const expressions: Expression[] = (raw.expressions ?? []).map((e) => ({
    ...e,
    params: normalizeEyeParams(e.params),
    colors: { ...DEFAULT_EYE_COLORS, ...(e.colors ?? {}) },
    leftParams: normalizeEyeParamsOverride(e.leftParams),
    rightParams: normalizeEyeParamsOverride(e.rightParams),
    leftColors: normalizeEyeColorsOverride(e.leftColors),
    rightColors: normalizeEyeColorsOverride(e.rightColors)
  }))

  return {
    id: raw.id ?? nanoid(10),
    name: raw.name ?? 'Untitled Project',
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    eyeBase: normalizeEyeParams(raw.eyeBase),
    colors: { ...DEFAULT_EYE_COLORS, ...(raw.colors ?? {}) },
    eyeLeftOverride: normalizeEyeParamsOverride(raw.eyeLeftOverride),
    eyeRightOverride: normalizeEyeParamsOverride(raw.eyeRightOverride),
    colorsLeftOverride: normalizeEyeColorsOverride(raw.colorsLeftOverride),
    colorsRightOverride: normalizeEyeColorsOverride(raw.colorsRightOverride),
    display: { ...DEFAULT_DISPLAY, ...(raw.display ?? {}) },
    personality: { ...DEFAULT_PERSONALITY, ...(raw.personality ?? {}) },
    timing: { ...DEFAULT_TIMING, ...(raw.timing ?? {}) },
    animations,
    expressions
  }
}

export function deserializeProject(json: string): Project {
  return normalizeProject(JSON.parse(json))
}

export async function saveProjectAs(project: Project): Promise<string | null> {
  const json = serializeProject(project)
  const suggested = `${project.name.replace(/[^a-z0-9 _-]/gi, '_')}.json`
  if (hasElectron()) {
    const result = await window.kibo!.saveProjectAs(json, suggested)
    return result.canceled ? null : (result.filePath ?? null)
  }
  downloadTextFile(json, suggested)
  return suggested
}

export async function saveProjectToPath(filePath: string, project: Project): Promise<void> {
  const json = serializeProject(project)
  if (hasElectron()) {
    await window.kibo!.saveProjectToPath(filePath, json)
    return
  }
  localStorage.setItem(LOCAL_STORAGE_PATH_KEY, filePath)
  downloadTextFile(json, filePath)
}

export async function openProjectDialog(): Promise<{ project: Project; filePath: string } | null> {
  if (hasElectron()) {
    const result = await window.kibo!.openProject()
    if (result.canceled || !result.json) return null
    return { project: deserializeProject(result.json), filePath: result.filePath ?? '' }
  }
  return openProjectFilePicker()
}

function openProjectFilePicker(): Promise<{ project: Project; filePath: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => resolve({ project: deserializeProject(String(reader.result)), filePath: file.name })
      reader.readAsText(file)
    }
    input.click()
  })
}

export async function autosaveWrite(project: Project): Promise<void> {
  const json = serializeProject(project)
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

export async function autosaveRead(): Promise<Project | null> {
  if (hasElectron()) {
    const result = await window.kibo!.autosaveRead()
    return result.exists && result.json ? deserializeProject(result.json) : null
  }
  const json = localStorage.getItem(LOCAL_STORAGE_KEY)
  return json ? deserializeProject(json) : null
}

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
  return picked ? serializeProject(picked.project) : null
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
