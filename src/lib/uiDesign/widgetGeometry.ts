import type { UiWidget } from '@/types'

/** A nested widget's own `style.x/y` are relative to its immediate parent, not the display —
 * every non-top-level widget in this codebase already treats this as the load-bearing
 * distinction for anything display-absolute (out-of-bounds checks, drag-visibility
 * classification, safe-area guides — see WidgetRenderer.tsx's own `isTopLevelWidget`, computed
 * inline there since it only ever needs the render component's own already-in-scope
 * `allWidgets`). This is the same check, extracted so the new Image Fit "Full Screen" feature can
 * share one implementation between the live preview (WidgetRenderer.tsx, which still uses its own
 * pre-existing inline copy — this export is for the one new consumer that didn't already have
 * one) and the LVGL exporter (lvglExport.ts) — two contexts with no React dependency in common
 * beyond "a plain widgets record", which is all this needs. */
export function isTopLevelUiWidget(widgets: Record<string, UiWidget>, widget: UiWidget): boolean {
  return widget.parentId ? widgets[widget.parentId]?.type === 'screen' : true
}
