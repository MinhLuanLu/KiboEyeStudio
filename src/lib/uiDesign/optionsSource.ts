import { evalTemplateTextPreview } from '@/lib/uiDesign/scriptLang/templateExpr'
import type { UiDataSource, UiWidget } from '@/types'

/** The 3 widget kinds an `optionsSource` binding is meaningful on — Dropdown/Roller (both take a
 * single "\n"-joined options string) and Tabs (a tab per line). Shared by persistence.ts (backfill
 * for pre-existing saved widgets), WidgetRenderer.tsx (preview), PropertiesPanel.tsx (section
 * gating), and lvglExport.ts (struct dedup + codegen) so the set can't drift between them. */
export const UI_OPTIONS_SOURCE_WIDGET_TYPES: ReadonlySet<UiWidget['type']> = new Set(['dropdown', 'roller', 'tabs'])

export function isOptionsSourceWidget(type: UiWidget['type']): boolean {
  return UI_OPTIONS_SOURCE_WIDGET_TYPES.has(type)
}

/** Live sandbox rows (if the script has ever mutated this widget's runtime items) or the bound
 * Data Source's own sample data — the same resolution Data List rows use (see WidgetRenderer.tsx's
 * firstDataListRow/DataListRepeatedRows), reused here for Dropdown/Roller/Tabs so every
 * data-source-bound widget in the app resolves rows identically. */
export function resolveDataSourceRows(dataSource: UiDataSource | null | undefined, runtimeOverride: unknown[] | undefined): unknown[] {
  if (runtimeOverride) return runtimeOverride
  if (!dataSource) return []
  try {
    const parsed = JSON.parse(dataSource.sampleData)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Resolves a Dropdown/Roller/Tabs widget's option/tab-name lines — either its own static
 * per-line list (`props.options`/`props.tabNames`, today's original behavior, unchanged) when no
 * Data Source is bound, or one `itemTemplate`-evaluated line per bound Data Source row otherwise.
 * The preview twin of lvglExport.ts's Options Source codegen (dropdown/roller: a real runtime
 * `<var>_RebuildOptions()`; tabs: baked at export time) — both read the same `optionsSource`
 * config and the same `{{}}` template syntax (scriptLang/templateExpr.ts), so preview and export
 * can't disagree about which rows/template produced which lines. */
export function resolveOptionsSourceLines(widget: UiWidget, dataSources: UiDataSource[], runtimeOverride: unknown[] | undefined): string[] {
  const cfg = widget.optionsSource
  if (!cfg?.dataSourceId) {
    const raw = widget.type === 'tabs' ? widget.props.tabNames : widget.props.options
    return String(raw ?? '').split('\n')
  }
  const dataSource = dataSources.find((d) => d.id === cfg.dataSourceId)
  const rows = resolveDataSourceRows(dataSource, runtimeOverride)
  const limited = cfg.maxItems > 0 ? rows.slice(0, cfg.maxItems) : rows
  const template = cfg.itemTemplate || '{{name}}'
  return limited.map((row) => evalTemplateTextPreview(template, (row && typeof row === 'object' ? row : {}) as Record<string, unknown>, {}))
}
