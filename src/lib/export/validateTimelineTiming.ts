import type { Animation, Keyframe, Project } from '@/types'

export type TimelineTimingValidationStatus = 'passed' | 'warning' | 'failed'

export interface TimelineTimingValidationResult {
  animationId: string
  animationName: string
  status: TimelineTimingValidationStatus
  messages: string[]
}

const TRACK_LABELS: { field: keyof Animation; label: string }[] = [
  { field: 'keyframes', label: 'Expression' },
  { field: 'leftEyeKeyframes', label: 'Left Eye' },
  { field: 'rightEyeKeyframes', label: 'Right Eye' },
  { field: 'pupilKeyframes', label: 'Pupils' },
  { field: 'eyelidKeyframes', label: 'Eyelids' }
]

/**
 * One result per Animation, checking every keyframe on every one of its 5 tracks against that
 * animation's own `durationMs` — a keyframe timed beyond (or before 0 of) the animation's own
 * length can never actually play (sampleTrack/bakeAnimationFrames in cppExport.ts would never
 * reach it), so this surfaces that as a clear export failure rather than a silently-dead
 * keyframe. Also flags a missing pose ("Expression") track, which every animation must have at
 * least one keyframe on (the required baseline every other track merges onto — see
 * sampleAnimationEye). Reported per-animation (not per-keyframe) to stay a short, scannable
 * list even for an animation with many keyframes — matching the other export-check panels'
 * "one row = pass/fail" shape, since a busy animation's every-keyframe-passed would otherwise
 * be pure noise.
 */
export function validateTimelineTiming(project: Project): TimelineTimingValidationResult[] {
  return project.animations.map((anim) => {
    const messages: string[] = []
    let status: TimelineTimingValidationStatus = 'passed'

    if (anim.keyframes.length === 0) {
      status = 'failed'
      messages.push('No Expression-track keyframes — every animation needs at least one baseline pose to sample.')
    }

    for (const { field, label } of TRACK_LABELS) {
      const list = anim[field] as Keyframe[]
      for (const k of list) {
        if (k.timeMs > anim.durationMs) {
          status = 'failed'
          messages.push(`${label} keyframe at ${Math.round(k.timeMs)}ms is beyond this animation's own ${Math.round(anim.durationMs)}ms length — unreachable, will never play.`)
        } else if (k.timeMs < 0) {
          status = 'failed'
          messages.push(`${label} keyframe has a negative time (${Math.round(k.timeMs)}ms) — invalid.`)
        }
      }
    }

    if (status === 'passed') messages.push(`${Math.round(anim.durationMs)}ms total, every keyframe reachable.`)
    return { animationId: anim.id, animationName: anim.name, status, messages }
  })
}
