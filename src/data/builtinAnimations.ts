import type { Animation } from '@/types'
import { anim, kf } from './helpers'

// Base pose values shared by most animations, tweaked per-keyframe via overrides.
const OPEN = {}
const CLOSED = { upperEyelid: 100, lowerEyelid: 15 }

export const builtinAnimations: Animation[] = [
  anim('Idle', true, [
    kf(2200, 'easeInOut', { height: 78, pupilY: 0 }),
    kf(2200, 'easeInOut', { height: 73, pupilY: 2 }),
  ]),

  anim('Blink', false, [
    kf(90, 'easeIn', OPEN),
    kf(70, 'easeOut', CLOSED),
    kf(140, 'easeInOut', OPEN),
  ]),

  anim('Double Blink', false, [
    kf(80, 'easeIn', OPEN),
    kf(60, 'easeOut', CLOSED),
    kf(90, 'easeInOut', OPEN),
    kf(70, 'easeIn', CLOSED),
    kf(150, 'easeOut', OPEN),
  ]),

  anim('Look Left', false, [
    kf(160, 'easeOut', { pupilX: 0 }),
    kf(650, 'easeInOut', { pupilX: -34, rotation: -3 }),
    kf(200, 'easeIn', { pupilX: 0, rotation: 0 }),
  ]),

  anim('Look Right', false, [
    kf(160, 'easeOut', { pupilX: 0 }),
    kf(650, 'easeInOut', { pupilX: 34, rotation: 3 }),
    kf(200, 'easeIn', { pupilX: 0, rotation: 0 }),
  ]),

  anim('Look Up', false, [
    kf(160, 'easeOut', { pupilY: 0, upperEyelid: 0 }),
    kf(600, 'easeInOut', { pupilY: -30, upperEyelid: 8 }),
    kf(200, 'easeIn', { pupilY: 0, upperEyelid: 0 }),
  ]),

  anim('Look Down', false, [
    kf(160, 'easeOut', { pupilY: 0 }),
    kf(600, 'easeInOut', { pupilY: 32, upperEyelid: 20 }),
    kf(200, 'easeIn', { pupilY: 0, upperEyelid: 0 }),
  ]),

  anim('Happy', false, [
    kf(180, 'easeOut', OPEN),
    kf(260, 'bounce', { height: 58, lowerEyelid: 42, radius: 30 }),
    kf(900, 'linear', { height: 58, lowerEyelid: 42, radius: 30 }),
    kf(220, 'easeIn', OPEN),
  ]),

  anim('Thinking', true, [
    kf(500, 'easeInOut', { pupilX: -18, pupilY: -14, rotation: -4, upperEyelid: 12 }),
    kf(700, 'easeInOut', { pupilX: 12, pupilY: -18, rotation: 2, upperEyelid: 12 }),
    kf(600, 'easeInOut', { pupilX: -18, pupilY: -14, rotation: -4, upperEyelid: 12 }),
  ]),

  anim('Curious', false, [
    kf(200, 'easeOut', OPEN),
    kf(420, 'elastic', { width: 90, height: 90, pupilSize: 48, rotation: 8, pupilY: -8 }),
    kf(900, 'linear', { width: 90, height: 90, pupilSize: 48, rotation: 8, pupilY: -8 }),
    kf(260, 'easeIn', OPEN),
  ]),

  anim('Loading', true, [
    kf(260, 'easeInOut', { pupilX: 0, pupilY: -22 }),
    kf(260, 'easeInOut', { pupilX: 22, pupilY: 0 }),
    kf(260, 'easeInOut', { pupilX: 0, pupilY: 22 }),
    kf(260, 'easeInOut', { pupilX: -22, pupilY: 0 }),
  ]),

  anim('Sleep', false, [
    kf(300, 'easeIn', { upperEyelid: 40 }),
    kf(500, 'easeOut', { upperEyelid: 96, lowerEyelid: 10, height: 40 }),
    kf(2600, 'easeInOut', { upperEyelid: 100, lowerEyelid: 12, height: 34 }),
  ]),

  anim('Wake Up', false, [
    kf(120, 'linear', { upperEyelid: 100, lowerEyelid: 12, height: 34 }),
    kf(220, 'bounce', { upperEyelid: 20, height: 70 }),
    kf(260, 'easeOut', OPEN),
  ]),

  anim('Notification', false, [
    kf(140, 'easeOut', { height: 88, width: 84, pupilSize: 48 }),
    kf(120, 'easeIn', OPEN),
    kf(140, 'easeOut', { height: 88, width: 84, pupilSize: 48 }),
    kf(180, 'easeIn', OPEN),
  ]),

  anim('Permission Request', false, [
    kf(200, 'easeInOut', { pupilY: -10, upperEyelid: 6 }),
    kf(260, 'easeInOut', { width: 86, height: 86, highlightSize: 30 }),
    kf(700, 'linear', { width: 86, height: 86, highlightSize: 30, pupilY: -10 }),
    kf(240, 'easeIn', OPEN),
  ]),

  anim('Error', false, [
    kf(90, 'easeOut', { rotation: -10, pupilX: -8 }),
    kf(90, 'bezier', { rotation: 10, pupilX: 8 }, [0.65, 0, 0.35, 1]),
    kf(90, 'bezier', { rotation: -8, pupilX: -6 }, [0.65, 0, 0.35, 1]),
    kf(90, 'bezier', { rotation: 6, pupilX: 4 }, [0.65, 0, 0.35, 1]),
    kf(160, 'easeInOut', { rotation: 0, pupilX: 0, upperEyelid: 30, lowerEyelid: 30 }),
  ]),

  anim('Meeting', true, [
    kf(1400, 'easeInOut', { pupilX: -6, upperEyelid: 4 }),
    kf(1400, 'easeInOut', { pupilX: 6, upperEyelid: 4 }),
  ]),

  anim('Listening', true, [
    kf(700, 'easeInOut', { height: 80, highlightSize: 28 }),
    kf(700, 'easeInOut', { height: 76, highlightSize: 20 }),
  ]),

  anim('Processing', true, [
    kf(220, 'linear', { pupilX: 0, pupilY: -20, pupilSize: 36 }),
    kf(220, 'linear', { pupilX: 20, pupilY: 0, pupilSize: 40 }),
    kf(220, 'linear', { pupilX: 0, pupilY: 20, pupilSize: 36 }),
    kf(220, 'linear', { pupilX: -20, pupilY: 0, pupilSize: 40 }),
  ]),
]
