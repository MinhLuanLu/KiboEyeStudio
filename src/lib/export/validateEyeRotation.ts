import type { EyeParams, Project } from '@/types'
import { expressionLeftParams, expressionRightParams } from '@/types'
import { bakeEyeRotation } from './cppExport'

export type EyeRotationValidationStatus = 'passed' | 'warning' | 'failed'

export interface EyeRotationValidationResult {
  locationId: string
  locationName: string
  status: EyeRotationValidationStatus
  messages: string[]
}

interface RotationLocation { id: string; label: string; params: EyeParams }

/** Every authored pose, in a stable order, so the same walk can be run over the original project
 * and over its baked copy and the two lined up by id. */
function collectLocations(project: Project): RotationLocation[] {
  const locations: RotationLocation[] = []
  for (const e of project.expressions) {
    locations.push({ id: `expr-${e.id}-l`, label: `Expression "${e.name}"`, params: expressionLeftParams(e) })
    locations.push({ id: `expr-${e.id}-r`, label: `Expression "${e.name}" (right eye)`, params: expressionRightParams(e) })
  }
  for (const a of project.animations) {
    a.keyframes.forEach((k, i) => {
      locations.push({ id: `anim-${a.id}-${i}`, label: `Animation "${a.name}", keyframe ${i + 1}`, params: k.params })
    })
  }
  return locations
}

/** Reports, per authored rotation, whether the "Smooth tilt on ESP32" bake can turn it into plain
 * non-rotated geometry. A rotation that bakes renders on the firmware's fast per-column span path;
 * one that does not falls back to per-pixel float math, which a soft-float ESP32-C6/C3 cannot keep
 * up with. The distinction is the whole point of the check, so it is measured, not assumed. */
export function validateEyeRotationExport(project: Project): EyeRotationValidationResult[] {
  const results: EyeRotationValidationResult[] = []
  const locations = collectLocations(project)

  // Report what the bake ACTUALLY achieves, by running it and re-reading the residual rotation.
  // This used to hardcode status:'passed' for every rotated pose, so it claimed success even when
  // the bake had silently skipped the pose and left it on the slow runtime-rotation path.
  const bakedLocations = collectLocations(bakeEyeRotation(JSON.parse(JSON.stringify(project)) as Project))
  const bakedById = new Map(bakedLocations.map((l) => [l.id, l.params]))

  for (const loc of locations) {
    if (loc.params.rotation === 0) continue
    const after = bakedById.get(loc.id)
    const residual = after ? Math.round(after.rotation) : Math.round(loc.params.rotation)
    if (residual === 0) {
      results.push({
        locationId: loc.id,
        locationName: loc.label,
        status: 'passed',
        messages: [
          `Rotation is ${loc.params.rotation}° here and bakes into the eye outline and eyelids, so the device renders it on the fast non-rotated path.`
        ]
      })
    } else {
      results.push({
        locationId: loc.id,
        locationName: loc.label,
        status: 'warning',
        messages: [
          `Rotation is ${loc.params.rotation}° here but could not be baked (${residual}° left over), so it falls back to per-pixel rotation at runtime. On a soft-float ESP32-C6/C3 that is slow enough to stall the animation.`
        ]
      })
    }
  }

  return results
}
