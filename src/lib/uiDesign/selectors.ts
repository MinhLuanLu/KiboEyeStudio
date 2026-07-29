import type { UiWidget } from '@/types'
import { UI_WIDGET_TAG } from '@/types'

/** Selector matching shared by CSS rule matching (lvglExport.ts), the script DSL's
 * `ui.get`/`ui.getAll` (scriptLang/sandboxRuntime.ts), and the C++ codegen's selector
 * resolution (scriptLang/codegen.ts) — one implementation so preview, CSS, and export can never
 * disagree about what a selector matches. Supports `#id`, `.class`, and a bare tag name
 * (e.g. "button", matched against UI_WIDGET_TAG). No combinators, same restriction CSS rules
 * already have (see lib/uiDesign/cssSync.ts). */
export function matchesSelector(widget: UiWidget, selector: string): boolean {
  if (selector.startsWith('#')) return widget.tagId === selector.slice(1)
  if (selector.startsWith('.')) return widget.classNames.includes(selector.slice(1))
  return UI_WIDGET_TAG[widget.type] === selector
}

export function selectAll(widgets: Record<string, UiWidget>, selector: string): UiWidget[] {
  return Object.values(widgets).filter((w) => matchesSelector(w, selector))
}

export function selectFirst(widgets: Record<string, UiWidget>, selector: string): UiWidget | null {
  return Object.values(widgets).find((w) => matchesSelector(w, selector)) ?? null
}
