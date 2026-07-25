import { nanoid } from 'nanoid'
import type { Expression } from '@/types'
import { p } from './helpers'

function expr(name: string, overrides: Parameters<typeof p>[0] = {}): Expression {
  return { id: nanoid(8), name, params: p(overrides) }
}

export const builtinExpressions: Expression[] = [
  expr('Neutral'),
  expr('Happy', { height: 58, lowerEyelid: 42, radius: 30 }),
  expr('Sad', { height: 62, upperEyelid: 18, pupilY: 10, rotation: -4 }),
  expr('Focused', { width: 70, height: 58, pupilSize: 50, upperEyelid: 10 }),
  expr('Angry', { height: 58, upperEyelid: 34, rotation: 10, pupilSize: 46 }),
  expr('Surprised', { width: 96, height: 96, pupilSize: 34, highlightSize: 30 }),
  expr('Confused', { rotation: 14, pupilX: -10, upperEyelid: 8, highlightX: 10 }),
  expr('Sleepy', { upperEyelid: 70, lowerEyelid: 12, height: 46 }),
  expr('Offline', { upperEyelid: 100, lowerEyelid: 20, height: 30, pupilSize: 0 }),
  expr('Charging', { height: 40, upperEyelid: 55, pupilY: -6, highlightSize: 30 }),
  expr('Thinking', { pupilX: -16, pupilY: -16, upperEyelid: 14, rotation: -4 }),
  expr('Notification', { width: 86, height: 90, pupilSize: 48, highlightSize: 26 }),
  expr('Meeting', { pupilX: 4, upperEyelid: 4 }),
  expr('Listening', { height: 80, highlightSize: 26 })
]
