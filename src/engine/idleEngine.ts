import type { EyeParams, Personality } from '@/types'
import { applyEasing } from './easing'

type Phase = 'gaze' | 'blink' | 'pause'

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Procedural idle behavior: random blinks (occasionally doubled), random look targets,
 * pauses, and continuous micro-movement — all timed from `Personality` sliders rather than
 * fixed constants, so the character reads as alive without repeating a fixed loop.
 */
export class IdleEngine {
  private elapsed = 0
  private phase: Phase = 'pause'
  private phaseEndsAt = 0

  private gazeFromX = 0
  private gazeFromY = 0
  private gazeToX = 0
  private gazeToY = 0
  private gazeStart = 0
  private gazeDuration = 400
  private lastGazeQuadrant = -1

  private nextBlinkAt = rand(1500, 3500)
  private blinkStart = 0
  private blinkDuration = 140
  private pendingDoubleBlink = false

  private driftPhaseX = Math.random() * 1000
  private driftPhaseY = Math.random() * 1000
  private microSeedA = Math.random() * 1000
  private microSeedB = Math.random() * 1000

  reset(): void {
    this.elapsed = 0
    this.phase = 'pause'
    this.phaseEndsAt = 0
    this.nextBlinkAt = rand(1500, 3500)
  }

  private scheduleNextGaze(personality: Personality): void {
    const idleDelaySec = 0.4 + (personality.idleDelay / 100) * 3.2
    const energyFactor = 1.4 - personality.energy / 100 // more energy -> shorter waits
    this.phaseEndsAt = this.elapsed + rand(idleDelaySec * 500, idleDelaySec * 1000) * energyFactor
    this.phase = 'pause'
  }

  private beginGaze(personality: Personality): void {
    const range = 14 + (personality.curiosity / 100) * 26
    // Pick a quadrant different from the last one so movement doesn't ping-pong predictably.
    let quadrant = Math.floor(Math.random() * 8)
    if (quadrant === this.lastGazeQuadrant) quadrant = (quadrant + 1 + Math.floor(Math.random() * 6)) % 8
    this.lastGazeQuadrant = quadrant
    const angle = (quadrant / 8) * Math.PI * 2
    const dist = rand(0.4, 1) * range

    this.gazeFromX = this.gazeToX
    this.gazeFromY = this.gazeToY
    this.gazeToX = Math.cos(angle) * dist
    this.gazeToY = Math.sin(angle) * dist * 0.7
    this.gazeStart = this.elapsed
    const speedFactor = 1.6 - personality.movementSpeed / 100
    this.gazeDuration = rand(220, 420) * speedFactor
    this.phase = 'gaze'
    this.phaseEndsAt = this.gazeStart + this.gazeDuration
  }

  private maybeStartBlink(personality: Personality, blinkSpeedPct: number): boolean {
    if (this.elapsed < this.nextBlinkAt) return false
    this.blinkStart = this.elapsed
    const sleepFactor = 1 + (personality.sleepiness / 100) * 1.2
    const speedFactor = 150 / clamp(blinkSpeedPct, 10, 300)
    this.blinkDuration = rand(110, 170) * sleepFactor * speedFactor
    this.pendingDoubleBlink = Math.random() < 0.12
    this.phase = 'blink'
    return true
  }

  private scheduleNextBlink(personality: Personality): void {
    const freqFactor = 1.8 - (personality.blinkFrequency / 100) * 1.5
    this.nextBlinkAt = this.elapsed + rand(1800, 4200) * freqFactor
  }

  tick(dtMs: number, base: EyeParams, personality: Personality, breathingAmount: number, blinkSpeedPct = 100): EyeParams {
    this.elapsed += dtMs

    if (this.phase !== 'blink' && this.maybeStartBlink(personality, blinkSpeedPct)) {
      // transition handled below via phase check
    }

    let eyelidOverride = 0
    if (this.phase === 'blink') {
      const t = (this.elapsed - this.blinkStart) / this.blinkDuration
      if (t >= 1) {
        if (this.pendingDoubleBlink) {
          this.pendingDoubleBlink = false
          this.blinkStart = this.elapsed
        } else {
          this.scheduleNextBlink(personality)
          this.scheduleNextGaze(personality)
        }
      } else {
        // Triangle wave: close over first half, reopen over second half.
        eyelidOverride = t < 0.5 ? applyEasing(t * 2, 'easeOut') : 1 - applyEasing((t - 0.5) * 2, 'easeIn')
      }
    } else if (this.phase === 'pause') {
      if (this.elapsed >= this.phaseEndsAt) this.beginGaze(personality)
    } else if (this.phase === 'gaze') {
      if (this.elapsed >= this.phaseEndsAt) this.scheduleNextGaze(personality)
    }

    const gazeT = this.phase === 'gaze' ? applyEasing(clamp((this.elapsed - this.gazeStart) / this.gazeDuration, 0, 1), 'easeInOut') : 1
    const gazeX = this.gazeFromX + (this.gazeToX - this.gazeFromX) * gazeT
    const gazeY = this.gazeFromY + (this.gazeToY - this.gazeFromY) * gazeT

    const driftAmp = (personality.randomEyeDrift / 100) * 10
    const driftX = Math.sin(this.elapsed / 5200 + this.driftPhaseX) * driftAmp
    const driftY = Math.cos(this.elapsed / 6100 + this.driftPhaseY) * driftAmp * 0.6

    const microAmp = (personality.microMovement / 100) * 4
    const microX = (Math.sin(this.elapsed / 190 + this.microSeedA) + Math.sin(this.elapsed / 97 + this.microSeedA * 2)) * 0.5 * microAmp
    const microY = (Math.sin(this.elapsed / 210 + this.microSeedB) + Math.sin(this.elapsed / 131 + this.microSeedB * 2)) * 0.5 * microAmp

    const breathe = Math.sin(this.elapsed / 2600) * (breathingAmount / 100) * 6
    const confidenceLidLift = (personality.confidence / 100) * 4
    const sleepyLid = (personality.sleepiness / 100) * 28

    const pupilX = clamp(gazeX + driftX + microX, -40, 40)
    const pupilY = clamp(gazeY + driftY + microY, -40, 40)

    return {
      ...base,
      height: clamp(base.height + breathe, 10, 160),
      pupilX,
      pupilY,
      upperEyelid: clamp(Math.max(base.upperEyelid, eyelidOverride * 100 + sleepyLid) - confidenceLidLift, 0, 100),
      lowerEyelid: clamp(Math.max(base.lowerEyelid, eyelidOverride * 20), 0, 100)
    }
  }
}
