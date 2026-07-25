import type { Animation, Project } from '@/types'

export function projectToJson(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export function animationToJson(animation: Animation): string {
  return JSON.stringify(animation, null, 2)
}
