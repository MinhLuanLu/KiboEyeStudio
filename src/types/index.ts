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
  upperEyelid: number
  lowerEyelid: number
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

export interface Expression {
  id: string
  name: string
  params: EyeParams
  colors: EyeColors
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
  upperEyelid: 0,
  lowerEyelid: 0,
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
  showBezel: true
}

export const DISPLAY_RANGES = {
  width: [60, 480] as [number, number],
  height: [60, 480] as [number, number],
  cornerRadius: [0, 160] as [number, number]
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
  pupilX: [-40, 40],
  pupilY: [-40, 40],
  upperEyelid: [0, 100],
  lowerEyelid: [0, 100],
  highlightX: [-40, 40],
  highlightY: [-40, 40],
  highlightSize: [0, 60]
}
