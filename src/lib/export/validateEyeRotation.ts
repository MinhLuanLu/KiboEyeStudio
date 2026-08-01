import type { EyeParams, Project } from '@/types'
import { expressionLeftParams, expressionRightParams } from '@/types'

export type EyeRotationValidationStatus = 'passed' | 'warning' | 'failed'

export interface EyeRotationValidationResult {
  locationId: string
  locationName: string
  status: EyeRotationValidationStatus
  messages: string[]
}

/** Firmware's eyesDrawEye() and the Studio preview now share the same rotation model:
 * the whole eye, including its boundary, fills, eyelids, pupil, and highlight, is rotated
 * around the eye center before drawing. This check is therefore informational only, surfacing
 * authored rotations so the export panel can confirm they are handled by the generated code
 * instead of treating them as a hardware mismatch. */
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
        status: 'passed',
        messages: [
          `Rotation is ${loc.params.rotation}° here and is exported with the same rotation logic as the Studio preview.`
        ]
      })
    }
  }

  return results
}
