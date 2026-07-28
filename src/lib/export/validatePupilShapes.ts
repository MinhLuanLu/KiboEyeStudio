import type { CustomPupilShape, EyeParams, Project } from '@/types'
import { expressionLeftParams, expressionRightParams } from '@/types'

export type PupilShapeValidationStatus = 'passed' | 'warning' | 'failed'

export interface PupilShapeValidationResult {
  shapeId: string
  shapeName: string
  status: PupilShapeValidationStatus
  messages: string[]
}

/** Every place in the project an EyeParams lives, labeled for the report below — mirrors how
 * eyeFrameLiteral() gets called from exportExpression()/exportAnimation() in cppExport.ts, so
 * "used here" in the report means "genuinely reachable from the exported header," not just
 * "exists somewhere in the project JSON." */
function allParamsLocations(project: Project): { label: string; params: EyeParams }[] {
  const locations: { label: string; params: EyeParams }[] = []
  for (const e of project.expressions) {
    locations.push({ label: `Expression "${e.name}"`, params: expressionLeftParams(e) })
    locations.push({ label: `Expression "${e.name}" (right eye)`, params: expressionRightParams(e) })
  }
  for (const a of project.animations) {
    a.keyframes.forEach((k, i) => {
      locations.push({ label: `Animation "${a.name}", keyframe ${i + 1}`, params: k.params })
    })
  }
  return locations
}

/**
 * Runs the same checks exportPupilShapes()/eyeFrameLiteral() (cppExport.ts) implicitly rely
 * on, per custom pupil shape (imported via SVG in the Pupil Shape picker) — mirrors
 * validateStickerExport()'s approach: report pass/warning/fail with a concrete reason per
 * shape, rather than a shape silently not appearing (or silently falling back to a circle) on
 * hardware with no way to tell why.
 */
export function validatePupilShapeExport(project: Project): PupilShapeValidationResult[] {
  const results: PupilShapeValidationResult[] = []
  const locations = allParamsLocations(project)
  const shapesById = new Map(project.customPupilShapes.map((s) => [s.id, s]))

  function usageFor(shapeId: string): string[] {
    return locations.filter((l) => l.params.pupilShape === 'custom' && l.params.pupilCustomShapeId === shapeId).map((l) => l.label)
  }

  function checkShape(shape: CustomPupilShape) {
    const messages: string[] = []
    let status: PupilShapeValidationStatus = 'passed'

    if (!Array.isArray(shape.points) || shape.points.length < 3) {
      results.push({
        shapeId: shape.id,
        shapeName: shape.name,
        status: 'failed',
        messages: [`Only ${shape.points?.length ?? 0} point(s) — needs at least 3 to form a shape. Falls back to a plain circle on real hardware, same as the studio preview.`]
      })
      return
    }

    const usedIn = usageFor(shape.id)
    if (usedIn.length === 0) {
      results.push({
        shapeId: shape.id,
        shapeName: shape.name,
        status: 'warning',
        messages: [
          'Not selected as the pupil shape anywhere (no expression or animation keyframe uses it) — it exists in the project\'s shape library but won\'t visibly appear anywhere in the export. Select it in the Pupil Shape picker and save the expression/keyframe you want it on.'
        ]
      })
      return
    }

    messages.push(`Used by: ${usedIn.join(', ')}.`)
    results.push({ shapeId: shape.id, shapeName: shape.name, status, messages })
  }

  for (const shape of project.customPupilShapes) checkShape(shape)

  // The reverse direction: an EyeParams that *selects* a custom shape ID with no matching
  // entry in project.customPupilShapes (e.g. deleted from the library after being picked).
  // eyesFillPupilShape() in the export already falls back to an ellipse for this rather than
  // drawing nothing — but silently rendering a circle instead of the shape you picked is
  // exactly the kind of thing that should be reported, not just quietly handled.
  const dangling = new Map<string, string[]>()
  for (const loc of locations) {
    if (loc.params.pupilShape === 'custom' && loc.params.pupilCustomShapeId && !shapesById.has(loc.params.pupilCustomShapeId)) {
      const list = dangling.get(loc.params.pupilCustomShapeId) ?? []
      list.push(loc.label)
      dangling.set(loc.params.pupilCustomShapeId, list)
    }
  }
  for (const [missingId, locs] of dangling) {
    results.push({
      shapeId: missingId,
      shapeName: `(missing shape "${missingId}")`,
      status: 'failed',
      messages: [`Referenced by ${locs.join(', ')}, but no shape with this id exists in the project anymore — renders as a plain circle instead of the intended custom shape on real hardware (same fallback the studio preview uses).`]
    })
  }

  return results
}
