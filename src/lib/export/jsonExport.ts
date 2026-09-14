import type { Animation, Expression, Project } from '@/types'

export function projectToJson(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export function animationToJson(animation: Animation): string {
  return JSON.stringify(animation, null, 2)
}

/** The selected expression as a standalone JSON clip — its full pose, colors, per-eye overrides,
 * style overrides and stickers — importable into another project via parseExpressionJson(). */
export function expressionToJson(expression: Expression): string {
  return JSON.stringify(expression, null, 2)
}
