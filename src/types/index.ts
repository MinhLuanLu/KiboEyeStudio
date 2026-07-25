export interface EyeParams {
  width: number
  height: number
  radius: number
  distance: number
  rotation: number
  pupilSize: number
  pupilX: number
  pupilY: number
  upperEyelid: number
  lowerEyelid: number
  highlightX: number
  highlightY: number
  highlightSize: number
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
  pupilSize: 42,
  pupilX: 0,
  pupilY: 0,
  upperEyelid: 0,
  lowerEyelid: 0,
  highlightX: -18,
  highlightY: -18,
  highlightSize: 22
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
  radius: [0, 65],
  distance: [0, 160],
  rotation: [-45, 45],
  pupilSize: [5, 100],
  pupilX: [-40, 40],
  pupilY: [-40, 40],
  upperEyelid: [0, 100],
  lowerEyelid: [0, 100],
  highlightX: [-40, 40],
  highlightY: [-40, 40],
  highlightSize: [0, 60]
}
