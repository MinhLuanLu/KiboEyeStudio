import type { EyeParams, Project } from '@/types'
import { expressionLeftParams, expressionRightParams } from '@/types'

export type EyeRotationValidationStatus = 'passed' | 'warning' | 'failed'

export interface EyeRotationValidationResult {
  locationId: string
  locationName: string
  status: EyeRotationValidationStatus
  messages: string[]
}

/** Firmware's eyesDrawEye() never reads EyeParams.rotation — every fill routine (sclera,
 * border, glow, iris, eyelids, and any custom eye-shape boundary) walks the eye row-by-row in
 * an *unrotated* local frame, so a tilted eye renders upright on real hardware even though the
 * studio's Canvas 2D preview rotates the whole eye via ctx.rotate() before drawing anything.
 * This is a real, structural export gap (not a rounding/precision issue), so it's surfaced here
 * the same way a dangling custom pupil/eye shape reference is — a concrete reason a project
 * won't look the same on hardware, not a silent mismatch. */
export function validateEyeRotationExport(project: Project): EyeRotationValidationResult[] {
  const results: EyeRotationValidationResult[] = []
  const locations: { id: string; label: string; params: EyeParams }[] = []

  for (const e of project.expressions) {
    locations.push({ id: `expr-${e.id}-l`, label: `Expression "${e.name}"`, params: expressionLeftParams(e) })
    locations.push({ id: `expr-${e.id}-r`, label: `Expression "${e.name}" (right eye)`, params: expressionRightParams(e) })
  }
  for (const a of project.animations) {
    a.keyframes.forEach((k, i) => {
      locations.push({ id: `anim-${a.id}-${i}`, label: `Animation "${a.name}", keyframe ${i + 1}`, params: k.params })
    })
  }

  for (const loc of locations) {
    if (loc.params.rotation !== 0) {
      results.push({
        locationId: loc.id,
        locationName: loc.label,
        status: 'warning',
        messages: [
          `Rotation is ${loc.params.rotation}° here, but the exported firmware doesn't rotate the eye's outer shape — this eye renders upright on real hardware, not tilted like the studio preview.`
        ]
      })
    }
  }

  return results
}
