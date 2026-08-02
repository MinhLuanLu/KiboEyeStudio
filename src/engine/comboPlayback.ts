import type { Animation, AnimationCombo, EyeParams } from '@/types'
import { animationDuration, sampleAnimationEye, wrapTime } from './interpolate'

/** Same formula as the Combinations panel's own clip-block sizing — how long one clip actually
 * occupies on the combo's timeline, including its own loop count, playback speed, and the
 * transition/end-delay gaps before the next clip can start. */
function totalClipDuration(animationDurationMs: number, loopCount: number, playbackSpeed: number, transitionMs: number, endDelayMs: number): number {
  const speed = Math.max(1, playbackSpeed) / 100
  return (animationDurationMs * Math.max(1, loopCount)) / speed + transitionMs + endDelayMs
}

/** Inverse of totalClipDuration() — solves for the whole loop count that gets a clip's duration
 * as close as possible to `targetDurationMs`, holding speed/transition/endDelay fixed. This is
 * what the Combinations timeline's right-edge (and left-edge, which pins the end and re-derives
 * the start) drag-resize handles use: dragging a clip's edge can't produce an arbitrary
 * duration (loop-based animations only have a duration for whole numbers of loops), so the
 * dragged edge always snaps to whichever loop-count boundary it's closest to. Always at least 1
 * (a clip can't play zero loops). */
export function loopCountForDuration(animationDurationMs: number, playbackSpeed: number, transitionMs: number, endDelayMs: number, targetDurationMs: number): number {
  const speed = Math.max(1, playbackSpeed) / 100
  const safeAnimDuration = Math.max(1, animationDurationMs)
  const raw = ((targetDurationMs - transitionMs - endDelayMs) * speed) / safeAnimDuration
  return Math.max(1, Math.round(raw))
}

export interface ComboClipBounds {
  clip: AnimationCombo['clips'][number]
  anim: Animation | undefined
  start: number
  end: number
  dur: number
}

export interface ComboTimeline {
  clips: ComboClipBounds[]
  total: number
}

/** Resolves a combo's clips (sorted by start time) against the project's animation library into
 * absolute [start, end) windows on the combo's own timeline — the single source of truth both
 * the Combinations panel (for its clip-block layout) and the shared PreviewCanvas (for sampling
 * live playback) build on, so the two can never disagree about clip timing. */
export function computeComboTimeline(combo: AnimationCombo, animations: Animation[]): ComboTimeline {
  const clips = [...combo.clips].sort((a, b) => a.startTimeMs - b.startTimeMs)
  let total = 0
  const withBounds = clips.map((clip) => {
    const anim = animations.find((a) => a.id === clip.animationId)
    const dur = anim ? totalClipDuration(animationDuration(anim), clip.loopCount, clip.playbackSpeed, clip.transitionMs, clip.endDelayMs) : 0
    const start = clip.startTimeMs
    const end = start + dur
    total = Math.max(total, end)
    return { clip, anim, start, end, dur }
  })
  return { clips: withBounds, total }
}

export interface ComboSample {
  params: EyeParams
  rightParams: EyeParams
  anim: Animation
  /** The active clip's own id — what the Combinations panel highlights as "currently playing"
   * so it always agrees with whatever the shared preview canvas is actually showing. */
  clipId: string
  /** The active clip's own local animation time (post loop/speed scaling) — what its stickers
   * and any other per-animation-time-scrubbed effects should read, analogous to Animate mode's
   * own `timeMs`. */
  animationTimeMs: number
}

/** Samples a combo timeline at `timeMs` (a position on the combo's own timeline, 0..total) —
 * finds whichever clip window `timeMs` falls in (or the last one, once playback has run past
 * the end), then samples that clip's animation at its own local, loop/speed-scaled time. Returns
 * null when there's nothing to render (no clips, or the active clip's animation is missing/
 * empty), matching sampleAnimationEye's own "nothing to sample" contract. */
export function sampleCombo(timeline: ComboTimeline, timeMs: number): ComboSample | null {
  if (timeline.clips.length === 0) return null
  const current = timeline.clips.find((entry) => timeMs >= entry.start && timeMs < entry.end) ?? timeline.clips[timeline.clips.length - 1]
  if (!current.anim || current.anim.keyframes.length === 0) return null

  const localElapsed = Math.max(0, timeMs - current.start)
  const scaledElapsed = localElapsed * (current.clip.playbackSpeed / 100)
  const duration = animationDuration(current.anim)
  const looped = current.clip.loopCount > 1 || current.anim.loop
  const animationTimeMs = looped ? wrapTime(scaledElapsed, current.anim) : Math.min(duration, scaledElapsed)

  return {
    params: sampleAnimationEye(current.anim, animationTimeMs, 'left'),
    rightParams: sampleAnimationEye(current.anim, animationTimeMs, 'right'),
    anim: current.anim,
    clipId: current.clip.id,
    animationTimeMs
  }
}
