import type {
  Animation,
  AnimationCombo,
  ClipTransition,
  EasingType,
  EyeColors,
  EyeParams,
  Project,
  TransitionClipRef,
  TransitionInterpolation
} from '@/types'
import { DEFAULT_TRANSITION_INTERPOLATION, leftEyeColors, rightEyeColors } from '@/types'
import { animationHasColorTrack, lerpColors, lerpParams, sampleAnimationColors, sampleAnimationEye, wrapTime } from './interpolate'
import { computeComboTimeline, sampleCombo, type ComboTimeline } from './comboPlayback'
import { applyEasing } from './easing'

/** What the device is asked to play: PlayAnimation(Anim_X) or Combo(X, loop). */
export type ClipRef = { kind: 'animation'; id: string } | { kind: 'combo'; id: string; loop: boolean }

export interface TransitionSettings {
  durationMs: number
  easing: EasingType
  bezier: [number, number, number, number]
  /** Omitted = everything blends and switches at 50% (the global EYES_TRANSITION_MS behaviour). */
  interpolation?: TransitionInterpolation
}

export type TransitionGroupKey = 'position' | 'shape' | 'pupil' | 'eyelids'

/** Property groups a saved transition can blend or switch. `bit` is the EYE_TRANS_STEP_* flag the
 * C++ export emits for a switched group, and `fields` drives both the studio stepping below and
 * the generated eyesTransitionStep(), so the two can't list different fields. */
export const TRANSITION_PROPERTY_GROUPS: { key: TransitionGroupKey; label: string; bit: number; cppFlag: string; fields: (keyof EyeParams)[] }[] = [
  { key: 'position', label: 'Position & rotation', bit: 1, cppFlag: 'EYE_TRANS_STEP_POSITION', fields: ['eyePosX', 'eyePosY', 'distance', 'rotation'] },
  { key: 'shape', label: 'Eye size & shape', bit: 2, cppFlag: 'EYE_TRANS_STEP_SHAPE', fields: ['width', 'height', 'radius', 'eyeShapeScale', 'eyeShapeOffsetX', 'eyeShapeOffsetY'] },
  {
    key: 'pupil',
    label: 'Iris, pupil & highlights',
    bit: 4,
    cppFlag: 'EYE_TRANS_STEP_PUPIL',
    fields: ['irisWidth', 'irisHeight', 'pupilWidth', 'pupilHeight', 'pupilX', 'pupilY', 'pupilRotation', 'highlightX', 'highlightY', 'highlightSize']
  },
  {
    key: 'eyelids',
    label: 'Eyelids',
    bit: 8,
    cppFlag: 'EYE_TRANS_STEP_EYELIDS',
    fields: [
      'upperEyelid',
      'lowerEyelid',
      'upperEyelidTilt',
      'lowerEyelidTilt',
      'upperEyelidCurvature',
      'lowerEyelidCurvature',
      'upperEyelidLeftRoundness',
      'upperEyelidRightRoundness',
      'lowerEyelidLeftRoundness',
      'lowerEyelidRightRoundness',
      'upperEyelidStretchX',
      'lowerEyelidStretchX',
      'upperEyelidStretchY',
      'lowerEyelidStretchY',
      'upperEyelidSkew',
      'lowerEyelidSkew',
      'upperEyelidCenterDepth',
      'lowerEyelidCenterDepth',
      'upperEyelidCenterY',
      'lowerEyelidCenterY',
      'upperEyelidSmoothness',
      'lowerEyelidSmoothness',
      'upperEyelidTension',
      'lowerEyelidTension',
      'upperEyelidThickness',
      'lowerEyelidThickness'
    ]
  }
]
export const TRANSITION_COLORS_BIT = 16

// Non-numeric fields: the same set lerpParams() steps at 0.5, switched at switchAtPct instead.
const DISCRETE_FIELDS = [
  'pupilShape',
  'pupilCustomShapeId',
  'eyeShape',
  'eyeCustomShapeId',
  'eyeShapeFlipH',
  'eyeShapeFlipV',
  'eyeShapeVisible',
  'eyeShapeLocked',
  'pupilVisible',
  'pupilLocked',
  'irisVisible',
  'highlightVisible',
  'upperEyelidVisible',
  'lowerEyelidVisible',
  'upperEyelidLocked',
  'lowerEyelidLocked',
  'disableEyelid'
] as const satisfies readonly (keyof EyeParams)[]

/** EYE_TRANS_STEP_* bitmask of the groups that switch instead of blending. */
export function transitionStepMask(interp: TransitionInterpolation): number {
  let mask = 0
  for (const g of TRANSITION_PROPERTY_GROUPS) if (!interp[g.key]) mask |= g.bit
  if (!interp.colors) mask |= TRANSITION_COLORS_BIT
  return mask
}

export function transitionSettingsOf(project: Pick<Project, 'timing'>): TransitionSettings {
  const t = project.timing
  return {
    durationMs: Math.max(0, Math.min(65535, Math.round(t.clipTransitionMs ?? 0))),
    easing: t.clipTransitionEasing ?? 'easeInOut',
    bezier: t.clipTransitionBezier ?? [0.42, 0, 0.58, 1]
  }
}

/** Playback settings of a saved transition (what PlayTransition(Trans_X) uses on the device). */
export function settingsOfTransition(t: ClipTransition): TransitionSettings {
  return {
    durationMs: Math.max(0, Math.min(65535, Math.round(t.durationMs))),
    easing: t.easing,
    bezier: t.bezier,
    interpolation: t.interpolation
  }
}

export function clipRefOf(ref: TransitionClipRef): ClipRef {
  return ref.kind === 'combo' ? { kind: 'combo', id: ref.id, loop: ref.loop } : { kind: 'animation', id: ref.id }
}

/** Bezier control points as the firmware stores them (int8, x100). The exporter emits exactly
 * these values, and the simulator eases with them too, so both evaluate the same curve. */
export function quantizeBezier(b: [number, number, number, number]): [number, number, number, number] {
  return b.map((v) => Math.max(-128, Math.min(127, Math.round(v * 100)))) as [number, number, number, number]
}

export function easeClipTransition(t: number, s: TransitionSettings): number {
  const q = quantizeBezier(s.bezier).map((v) => v / 100) as [number, number, number, number]
  return applyEasing(t, s.easing, q)
}

/** Takes switched groups and all non-numeric fields from `src` (the source before the switch
 * point, the target after it) — mirrors eyesTransitionStep() in the C++ export. */
function applyTransitionSteps(blended: EyeParams, src: EyeParams, interp: TransitionInterpolation): EyeParams {
  const out = { ...blended } as unknown as Record<string, unknown>
  const from = src as unknown as Record<string, unknown>
  for (const f of DISCRETE_FIELDS) out[f] = from[f]
  for (const g of TRANSITION_PROPERTY_GROUPS) {
    if (interp[g.key]) continue
    for (const f of g.fields) out[f] = from[f]
  }
  const srcHl = src.extraHighlights ?? []
  out.extraHighlights = interp.pupil
    ? (blended.extraHighlights ?? []).map((h, i) => ({ ...h, visible: srcHl[i]?.visible ?? h.visible }))
    : srcHl.map((h) => ({ ...h }))
  return out as unknown as EyeParams
}

/** One rendered frame of the simulated device player. */
export interface PlayerFrame {
  left: EyeParams
  right: EyeParams
  colorsLeft: EyeColors
  colorsRight: EyeColors
  /** Animation whose stickers are on screen, and the playhead to draw them at. */
  stickerAnimation: Animation | null
  stickerElapsedMs: number
  /** The active clip's own clock — held at 0 while it is still being blended in. */
  clipElapsedMs: number
  /** Still blending after this frame (eyesPlayer.transitioning after UpdateEyes()). */
  transitioning: boolean
  /** Raw 0..1 progress through the blend, and the eased value actually applied. */
  transitionT: number
  easedT: number
  finished: boolean
}

interface ActiveClip {
  ref: ClipRef
  anim: Animation | null
  combo: AnimationCombo | null
  timeline: ComboTimeline | null
  startMs: number
}

interface ActiveTransition {
  from: PlayerFrame
  startMs: number
  settings: TransitionSettings
}

/**
 * Studio-side mirror of the exported eyes.h player (EyesPlayerState + UpdateEyes()), limited to
 * what a clip switch needs: one active animation or combination, the persistent colour palette,
 * and the clip-to-clip transition. Poses come from the same sampleAnimationEye()/sampleCombo()
 * the preview and the C++ baker use, so the only new logic here is the transition itself, which
 * follows eyesBeginClipTransition()/eyesApplyClipTransition() line for line:
 *
 *  - play() snapshots the last rendered frame (pose, palette, stickers) as the blend source. If
 *    nothing has been rendered yet, or the duration is 0, the switch is a hard cut.
 *  - The new clip is held on its first frame while blending; its clock starts when the blend ends.
 *  - Blended fields lerp with the eased progress; switched groups, non-numeric fields (shapes,
 *    visibility) and the sticker set flip at the switch point (50% unless a saved transition
 *    says otherwise, the same rule lerpParams()/eyesLerpLive() use).
 *  - Playing again mid-blend starts a new blend from the current blended frame, so rapid
 *    re-triggers never jump.
 *
 * Deterministic in its `nowMs` arguments; see simulateTransitions().
 */
export class TransitionPlayer {
  private clip: ActiveClip | null = null
  private live: PlayerFrame | null = null
  private transition: ActiveTransition | null = null
  // eyesPlayer.colorsLeft/colorsRight — start as EYE_COLORS_LEFT/RIGHT.
  private colorsLeft: EyeColors
  private colorsRight: EyeColors

  constructor(private readonly project: Project) {
    this.colorsLeft = leftEyeColors(project)
    this.colorsRight = rightEyeColors(project)
  }

  get lastFrame(): PlayerFrame | null {
    return this.live
  }

  get currentRef(): ClipRef | null {
    return this.clip?.ref ?? null
  }

  /** PlayAnimation()/Combo()/PlayTransition(). Returns false (and changes nothing) if the
   * reference can't be resolved to something playable. */
  play(ref: ClipRef, nowMs: number, settings: TransitionSettings): boolean {
    const resolved = this.resolve(ref)
    if (!resolved) return false
    if (this.live && settings.durationMs > 0) {
      this.transition = { from: this.live, startMs: nowMs, settings }
      resolved.startMs = nowMs + settings.durationMs
    } else {
      this.transition = null
      resolved.startMs = nowMs
    }
    this.clip = resolved
    return true
  }

  update(nowMs: number): PlayerFrame | null {
    const clip = this.clip
    if (!clip) return this.live
    const base = this.project.colors
    // A blend whose time is up is over before this frame is sampled, so the clip's clock is
    // exact no matter how frames happen to fall (same check at the top of UpdateEyes()).
    if (this.transition && nowMs - this.transition.startMs >= this.transition.settings.durationMs) this.transition = null
    const transitioning = this.transition !== null
    const elapsed = transitioning ? 0 : Math.max(0, nowMs - clip.startMs)

    let left: EyeParams
    let right: EyeParams
    let stickerAnimation: Animation | null
    let stickerElapsedMs: number
    let finished: boolean

    if (clip.anim) {
      const anim = clip.anim
      const dur = anim.durationMs
      const t = wrapTime(elapsed, anim)
      left = sampleAnimationEye(anim, t, 'left')
      right = sampleAnimationEye(anim, t, 'right')
      // A standalone animation without a baked colour track keeps the loaded palette.
      if (animationHasColorTrack(anim, base)) {
        const c = sampleAnimationColors(anim, t, base)
        this.colorsLeft = c
        this.colorsRight = c
      }
      stickerAnimation = anim
      stickerElapsedMs = dur > 0 && anim.loop ? elapsed % dur : dur > 0 && elapsed > dur ? dur : elapsed
      finished = !anim.loop && elapsed >= dur
    } else {
      const timeline = clip.timeline!
      const loop = clip.ref.kind === 'combo' && clip.ref.loop
      const t = loop ? elapsed % timeline.total : Math.min(elapsed, timeline.total)
      const sample = sampleCombo(timeline, t, loop)
      if (!sample) return this.live
      left = sample.params
      right = sample.rightParams
      // Combos reset a colourless clip to the project palette (see UpdateEyes()'s combo branch).
      if (animationHasColorTrack(sample.anim, base)) {
        const c = sampleAnimationColors(sample.anim, sample.animationTimeMs, base)
        this.colorsLeft = c
        this.colorsRight = c
      } else {
        this.colorsLeft = leftEyeColors(this.project)
        this.colorsRight = rightEyeColors(this.project)
      }
      stickerAnimation = sample.anim
      stickerElapsedMs = sample.animationTimeMs
      finished = !loop && elapsed >= timeline.total
    }

    let transitionT = 1
    let easedT = 1
    let stillBlending = false
    const tr = this.transition
    if (tr) {
      const raw = tr.settings.durationMs > 0 ? Math.max(0, nowMs - tr.startMs) / tr.settings.durationMs : 1
      transitionT = Math.min(1, raw)
      easedT = easeClipTransition(transitionT, tr.settings)
      const interp = tr.settings.interpolation ?? DEFAULT_TRANSITION_INTERPOLATION
      const switched = easedT >= interp.switchAtPct / 100
      left = applyTransitionSteps(lerpParams(tr.from.left, left, easedT), switched ? left : tr.from.left, interp)
      right = applyTransitionSteps(lerpParams(tr.from.right, right, easedT), switched ? right : tr.from.right, interp)
      if (interp.colors) {
        // eyesLerpColorSet() clamps, so an overshooting easing never extrapolates colours.
        const colorT = Math.min(1, Math.max(0, easedT))
        this.colorsLeft = lerpColors(tr.from.colorsLeft, this.colorsLeft, colorT)
        this.colorsRight = lerpColors(tr.from.colorsRight, this.colorsRight, colorT)
      } else if (!switched) {
        this.colorsLeft = tr.from.colorsLeft
        this.colorsRight = tr.from.colorsRight
      }
      if (!switched) {
        stickerAnimation = tr.from.stickerAnimation
        stickerElapsedMs = tr.from.stickerElapsedMs
      }
      if (raw >= 1) this.transition = null
      else stillBlending = true
      finished = false
    }

    this.live = {
      left,
      right,
      colorsLeft: this.colorsLeft,
      colorsRight: this.colorsRight,
      stickerAnimation,
      stickerElapsedMs,
      clipElapsedMs: elapsed,
      transitioning: stillBlending,
      transitionT,
      easedT,
      finished
    }
    return this.live
  }

  private resolve(ref: ClipRef): ActiveClip | null {
    if (ref.kind === 'animation') {
      const anim = this.project.animations.find((a) => a.id === ref.id)
      if (!anim || anim.keyframes.length === 0) return null
      return { ref, anim, combo: null, timeline: null, startMs: 0 }
    }
    const combo = this.project.animationCombos.find((c) => c.id === ref.id)
    if (!combo) return null
    const timeline = computeComboTimeline(combo, this.project.animations)
    if (timeline.total <= 0 || timeline.clips.length === 0) return null
    return { ref, anim: null, combo, timeline, startMs: 0 }
  }
}

export interface ClipEvent {
  atMs: number
  ref: ClipRef
  /** Per-switch settings (a saved transition); omitted = the settings passed to simulateTransitions. */
  settings?: TransitionSettings
}

/** Replays a list of switch events (sorted by atMs) from scratch and returns the frame at
 * `nowMs`. Each event renders a frame at its own instant first, like a device loop that draws a
 * frame right as the sensor fires, so scrubbing backward or forward always gives the same
 * result. */
export function simulateTransitions(project: Project, events: ClipEvent[], nowMs: number, settings: TransitionSettings): PlayerFrame | null {
  const player = new TransitionPlayer(project)
  for (const ev of events) {
    if (ev.atMs > nowMs) break
    player.update(ev.atMs)
    player.play(ev.ref, ev.atMs, ev.settings ?? settings)
  }
  return player.update(nowMs)
}
