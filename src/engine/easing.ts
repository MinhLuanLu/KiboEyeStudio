import type { EasingType } from '@/types'

export type EasingFn = (t: number) => number

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

const linear: EasingFn = (t) => t

const easeIn: EasingFn = (t) => t * t * t

const easeOut: EasingFn = (t) => 1 - Math.pow(1 - t, 3)

const easeInOut: EasingFn = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const bounce: EasingFn = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  let x = t
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

const elastic: EasingFn = (t) => {
  if (t === 0 || t === 1) return t
  const c4 = (2 * Math.PI) / 3
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}

// Cubic bezier(x1,y1,x2,y2) sampled the same way CSS `cubic-bezier()` timing functions
// work: x is treated as the time axis, y as the eased output, and we solve x(t)=input via
// Newton-Raphson (falling back to bisection) since the curve is defined parametrically.
function makeBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by

  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  const sampleXDerivative = (t: number): number => (3 * ax * t + 2 * bx) * t + cx

  function solveTForX(x: number): number {
    let t = x
    for (let i = 0; i < 8; i++) {
      const xEst = sampleX(t) - x
      const d = sampleXDerivative(t)
      if (Math.abs(d) < 1e-6) break
      t -= xEst / d
    }
    // Bisection fallback for safety at flat derivatives
    let lo = 0
    let hi = 1
    let guess = t
    for (let i = 0; i < 20 && (guess < 0 || guess > 1 || Math.abs(sampleX(guess) - x) > 1e-5); i++) {
      guess = (lo + hi) / 2
      if (sampleX(guess) < x) lo = guess
      else hi = guess
    }
    return clamp01(guess)
  }

  return (t: number): number => sampleY(solveTForX(clamp01(t)))
}

export function getEasingFn(type: EasingType, customBezier?: [number, number, number, number]): EasingFn {
  switch (type) {
    case 'linear':
      return linear
    case 'easeIn':
      return easeIn
    case 'easeOut':
      return easeOut
    case 'easeInOut':
      return easeInOut
    case 'bounce':
      return bounce
    case 'elastic':
      return elastic
    case 'bezier': {
      const [x1, y1, x2, y2] = customBezier ?? [0.42, 0, 0.58, 1]
      return makeBezier(x1, y1, x2, y2)
    }
    default:
      return linear
  }
}

export function applyEasing(t: number, type: EasingType, customBezier?: [number, number, number, number]): number {
  return getEasingFn(type, customBezier)(clamp01(t))
}

export const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In Out' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'elastic', label: 'Elastic' },
  { value: 'bezier', label: 'Custom Bezier' }
]
