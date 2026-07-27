export interface EyeParams {
  width: number
  height: number
  radius: number
  distance: number
  rotation: number
  irisWidth: number
  irisHeight: number
  pupilWidth: number
  pupilHeight: number
  pupilX: number
  pupilY: number
  /** Pupil's own tilt, independent of the eye's rotation — 0-360°. */
  pupilRotation: number
  upperEyelid: number
  lowerEyelid: number
  /** Tilts each lid's covering edge independently, -45..45°. */
  upperEyelidTilt: number
  lowerEyelidTilt: number
  /** How pronounced each lid's soft curved edge is: 0 (flat/neutral), -100 (curved inward) to 100 (curved outward). */
  upperEyelidCurvature: number
  lowerEyelidCurvature: number
  highlightX: number
  highlightY: number
  highlightSize: number
}

export interface EyeColors {
  sclera: string
  iris: string
  pupil: string
  highlight: string
  shadow: string
  glow: string
  border: string
  shadowIntensity: number
  glowIntensity: number
  borderOpacity: number
}

export type DisplayShape = 'circle' | 'square' | 'rounded'

export interface DisplaySettings {
  shape: DisplayShape
  width: number
  height: number
  cornerRadius: number
  backgroundColor: string
  showBezel: boolean
  fps: number
}

export type EasingType =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'bounce'
  | 'elastic'
  | 'bezier'

export interface Keyframe {
  id: string
  duration: number
  easing: EasingType
  customBezier?: [number, number, number, number]
  params: EyeParams
}

export interface Animation {
  id: string
  name: string
  loop: boolean
  keyframes: Keyframe[]
}

/** Which eye(s) the Controls/Colors panels currently write to. Purely an editing-session
 * concept (not persisted itself) — the *result* of edits made under 'left'/'right' is what
 * gets saved, via the params/colors override fields below. */
export type EyeSide = 'both' | 'left' | 'right'

export interface Expression {
  id: string
  name: string
  params: EyeParams
  colors: EyeColors
  /** Per-eye overrides captured at Save time. `null` means this eye had no divergence from
   * `params`/`colors` (the "both eyes" baseline) when the expression was saved. */
  leftParams: EyeParams | null
  rightParams: EyeParams | null
  leftColors: EyeColors | null
  rightColors: EyeColors | null
}

export interface Personality {
  blinkFrequency: number
  curiosity: number
  energy: number
  confidence: number
  sleepiness: number
  movementSpeed: number
  randomEyeDrift: number
  microMovement: number
  idleDelay: number
}

export interface GlobalTiming {
  animationSpeed: number
  blinkSpeed: number
  breathingAmount: number
}

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  eyeBase: EyeParams
  colors: EyeColors
  /** Per-eye overrides for the live/base pose. `null` = this eye follows eyeBase/colors
   * (no divergence yet) — see the effectiveEyeParams/leftEyeParams/rightEyeParams helpers below. */
  eyeLeftOverride: EyeParams | null
  eyeRightOverride: EyeParams | null
  colorsLeftOverride: EyeColors | null
  colorsRightOverride: EyeColors | null
  display: DisplaySettings
  personality: Personality
  timing: GlobalTiming
  animations: Animation[]
  expressions: Expression[]
}

export type PlaybackMode = 'design' | 'animate' | 'idle'
export type PlaybackState = 'playing' | 'paused' | 'stopped'

export const DEFAULT_EYE_PARAMS: EyeParams = {
  width: 78,
  height: 78,
  radius: 26,
  distance: 96,
  rotation: 0,
  irisWidth: 58,
  irisHeight: 58,
  pupilWidth: 32,
  pupilHeight: 32,
  pupilX: 0,
  pupilY: 0,
  pupilRotation: 0,
  upperEyelid: 0,
  lowerEyelid: 0,
  upperEyelidTilt: 0,
  lowerEyelidTilt: 0,
  upperEyelidCurvature: 0,
  lowerEyelidCurvature: 0,
  highlightX: -18,
  highlightY: -18,
  highlightSize: 22
}

export const DEFAULT_EYE_COLORS: EyeColors = {
  sclera: '#f4faff',
  iris: '#4fa8ff',
  pupil: '#0a1220',
  highlight: '#ffffff',
  shadow: '#000010',
  glow: '#5b8cff',
  border: '#ffffff',
  shadowIntensity: 30,
  glowIntensity: 25,
  borderOpacity: 5
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  shape: 'circle',
  width: 240,
  height: 240,
  cornerRadius: 24,
  backgroundColor: '#000000',
  showBezel: true,
  fps: 30
}

export const DISPLAY_RANGES = {
  width: [60, 480] as [number, number],
  height: [60, 480] as [number, number],
  cornerRadius: [0, 160] as [number, number],
  fps: [1, 120] as [number, number]
}

/** Clamps to the supported FPS range — used both by the live preview loop and the C++
 * export so a malformed/hand-edited project file can never push an out-of-range value into
 * either place, even though the Display panel's slider already can't produce one itself. */
export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return DEFAULT_DISPLAY.fps
  return Math.min(DISPLAY_RANGES.fps[1], Math.max(DISPLAY_RANGES.fps[0], Math.round(fps)))
}

export const DEFAULT_PERSONALITY: Personality = {
  blinkFrequency: 50,
  curiosity: 50,
  energy: 50,
  confidence: 50,
  sleepiness: 10,
  movementSpeed: 50,
  randomEyeDrift: 30,
  microMovement: 25,
  idleDelay: 40
}

export const DEFAULT_TIMING: GlobalTiming = {
  animationSpeed: 100,
  blinkSpeed: 100,
  breathingAmount: 20
}

export const EYE_PARAM_RANGES: Record<keyof EyeParams, [number, number]> = {
  width: [20, 130],
  height: [20, 130],
  radius: [0, 130],
  distance: [0, 160],
  rotation: [-45, 45],
  irisWidth: [10, 100],
  irisHeight: [10, 100],
  pupilWidth: [5, 100],
  pupilHeight: [5, 100],
  // Percent of half the eye's own width/height — already scales with eye size. +-100 lets
  // the pupil's center reach all the way to the eye's edge (previously capped at 40%, which
  // kept the pupil confined to the middle of the eye and unable to reach the corners).
  pupilX: [-100, 100],
  pupilY: [-100, 100],
  pupilRotation: [0, 360],
  upperEyelid: [0, 100],
  lowerEyelid: [0, 100],
  upperEyelidTilt: [-45, 45],
  lowerEyelidTilt: [-45, 45],
  upperEyelidCurvature: [-100, 100],
  lowerEyelidCurvature: [-100, 100],
  highlightX: [-40, 40],
  highlightY: [-40, 40],
  highlightSize: [0, 60]
}

// ---- Per-eye (Eye Target) helpers ------------------------------------------
//
// The live/base pose and each Expression store one shared params/colors pair plus optional
// left/right *override* pairs. A `null` override means that eye simply follows the shared
// value — these helpers resolve "what should this eye actually look like" without every
// caller (renderer, panels, export) needing to know about the null-means-shared convention.

export function leftEyeParams(project: Project): EyeParams {
  return project.eyeLeftOverride ?? project.eyeBase
}
export function rightEyeParams(project: Project): EyeParams {
  return project.eyeRightOverride ?? project.eyeBase
}
export function leftEyeColors(project: Project): EyeColors {
  return project.colorsLeftOverride ?? project.colors
}
export function rightEyeColors(project: Project): EyeColors {
  return project.colorsRightOverride ?? project.colors
}

/** The params/colors the Controls/Colors panels should currently display and edit, given
 * the selected Eye Target. */
export function effectiveEyeParams(project: Project, target: EyeSide): EyeParams {
  if (target === 'left') return leftEyeParams(project)
  if (target === 'right') return rightEyeParams(project)
  return project.eyeBase
}
export function effectiveEyeColors(project: Project, target: EyeSide): EyeColors {
  if (target === 'left') return leftEyeColors(project)
  if (target === 'right') return rightEyeColors(project)
  return project.colors
}

export function expressionLeftParams(e: Expression): EyeParams {
  return e.leftParams ?? e.params
}
export function expressionRightParams(e: Expression): EyeParams {
  return e.rightParams ?? e.params
}
export function expressionLeftColors(e: Expression): EyeColors {
  return e.leftColors ?? e.colors
}
export function expressionRightColors(e: Expression): EyeColors {
  return e.rightColors ?? e.colors
}

/** True when this expression's two eyes would actually render differently — used to decide
 * whether the C++ export needs separate left/right constants or can share one. */
export function expressionShapeDiverges(e: Expression): boolean {
  return JSON.stringify(expressionLeftParams(e)) !== JSON.stringify(expressionRightParams(e))
}
export function expressionColorsDiverge(e: Expression): boolean {
  return JSON.stringify(expressionLeftColors(e)) !== JSON.stringify(expressionRightColors(e))
}
