import type { UiDesignProject, UiWidget } from '@/types'

// Shared, framework-free (no React, no LVGL string-building) layout primitives for a Data List
// widget's item template — imported by BOTH WidgetRenderer.tsx (canvas repetition/row-clone
// rendering) and lib/export/lvglExport.ts (per-item C++ creation function + reachability walk),
// so canvas preview and C++ export can never silently disagree about which widgets make up the
// template or how big one row is — same "one shared implementation, can't drift" precedent
// actionTable.ts already establishes project-wide.

/** Every widget in a Data List's item-template subtree, in tree order, regardless of `visible`/
 * `CONTAINER_LIKE` membership — deliberately unconditional (unlike the generic `children()`
 * recursion both WidgetRenderer.tsx and lvglExport.ts otherwise use), since a template widget the
 * author has temporarily hidden should still exist in every repeated row, not vanish from all of
 * them. */
export function dataListTemplateDescendants(uiDesign: UiDesignProject, dataListWidget: UiWidget): UiWidget[] {
  const out: UiWidget[] = []
  const seen = new Set<string>()
  const visit = (widget: UiWidget) => {
    for (const childId of widget.childIds) {
      const child = uiDesign.widgets[childId]
      if (!child || seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      visit(child)
    }
  }
  visit(dataListWidget)
  return out
}

/** Union bounding box of the template's DIRECT children's own authored x/y/width/height — the
 * per-row wrapper's size (both the canvas's row-clone offset math and the generated per-item C++
 * create function's row container size read this same box). Percent widths resolve against the
 * Data List's own authored width; non-numeric "auto" sizes fall back to a small fixed minimum —
 * documented approximation, the same tier as this exporter's other generation-time-approximated
 * sizes (e.g. a gauge's needle length). */
export function dataListTemplateBounds(uiDesign: UiDesignProject, dataListWidget: UiWidget): { width: number; height: number } {
  const listWidth = typeof dataListWidget.style.width === 'number' ? dataListWidget.style.width : 200
  const directChildren = dataListWidget.childIds.map((id) => uiDesign.widgets[id]).filter((w): w is UiWidget => !!w)
  if (directChildren.length === 0) return { width: listWidth, height: 40 }

  const resolveLength = (v: UiWidget['style']['width'], against: number, fallback: number): number => {
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.endsWith('%')) return (Number(v.slice(0, -1)) / 100) * against
    return fallback
  }

  let maxRight = 0
  let maxBottom = 0
  for (const child of directChildren) {
    const x = typeof child.style.x === 'number' ? child.style.x : 0
    const y = typeof child.style.y === 'number' ? child.style.y : 0
    const w = resolveLength(child.style.width, listWidth, 40)
    const h = resolveLength(child.style.height, 40, 20)
    maxRight = Math.max(maxRight, x + w)
    maxBottom = Math.max(maxBottom, y + h)
  }
  return { width: Math.max(maxRight, listWidth), height: Math.max(maxBottom, 1) }
}
