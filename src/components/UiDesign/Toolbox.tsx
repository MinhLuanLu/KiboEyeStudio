import { useMemo, useState } from 'react'
import type { UiWidgetType } from '@/types'
import { UI_TOOLBOX_WIDGETS, UI_WIDGET_LABELS } from '@/types'
import { setComponentTemplateDragPayload, setWidgetDragPayload } from '@/lib/uiDesign/dnd'
import { COMPONENT_TEMPLATE_LABELS, type ComponentTemplateId } from '@/lib/uiDesign/componentTemplates'

// Widget-kind -> category assignment for the Toolbox's categorized layout — a flat 18-item grid
// stopped scaling once Professional Components were added on top of it, so this groups the
// existing widget types the same way the new components are grouped, rather than inventing a
// second organizing scheme. Every widget kind must appear in exactly one category (enforced by
// the `assert` line below, since a widget silently missing from the Toolbox would be a real bug).
const WIDGET_CATEGORIES: { label: string; types: UiWidgetType[] }[] = [
  { label: 'Basic', types: ['container', 'flex', 'button', 'label', 'image', 'icon', 'textarea', 'keyboard'] },
  { label: 'Indicators', types: ['switch', 'slider', 'bar', 'arc', 'checkbox', 'spinner', 'gauge', 'led', 'statusIndicator'] },
  { label: 'Navigation', types: ['dropdown', 'roller', 'list', 'tabs', 'dataList'] }
]

const COMPONENT_TEMPLATE_IDS: ComponentTemplateId[] = ['card', 'floatingPanel', 'topAppBar', 'fab', 'notificationBadge', 'dashboardTile']

function assertAllWidgetsCategorized() {
  const categorized = new Set(WIDGET_CATEGORIES.flatMap((c) => c.types))
  const missing = UI_TOOLBOX_WIDGETS.filter((t) => !categorized.has(t))
  if (missing.length > 0) console.warn('Toolbox: widget type(s) not assigned to a category:', missing)
}
assertAllWidgetsCategorized()

function ToolboxChip({ label, title, onDragStart }: { label: string; title: string; onDragStart: (e: React.DragEvent) => void }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="bg-studio-panel2 border border-studio-border rounded px-2 py-2 text-xs text-center cursor-grab active:cursor-grabbing hover:border-studio-accent select-none"
      title={title}
    >
      {label}
    </div>
  )
}

function CategorySection({ label, defaultOpen = true, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        className="flex items-center gap-1 text-[11px] font-semibold text-studio-muted uppercase tracking-wide hover:text-studio-text"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-3 inline-block">{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && <div className="grid grid-cols-2 gap-1.5">{children}</div>}
    </div>
  )
}

/** Drag source for placing widgets/component templates on the Canvas — plain native HTML5 DnD
 * (draggable + dataTransfer), same technique already used elsewhere in this codebase (sticker
 * layer reordering), no new dependency. Canvas.tsx's onDrop reads the payload and calls
 * addUiWidget()/addUiComponentTemplate(). Restructured from a single flat 18-item grid into
 * collapsible categories + a text filter once Professional Components (6 more draggable items,
 * each a pre-styled composite) were added on top — a flat grid stops being scannable well before
 * 24 entries. */
export function Toolbox() {
  const [filter, setFilter] = useState('')

  const q = filter.trim().toLowerCase()
  const matchesWidget = (type: UiWidgetType) => !q || UI_WIDGET_LABELS[type].toLowerCase().includes(q)
  const matchesTemplate = (id: ComponentTemplateId) => !q || COMPONENT_TEMPLATE_LABELS[id].toLowerCase().includes(q)

  const visibleComponentTemplates = useMemo(() => COMPONENT_TEMPLATE_IDS.filter(matchesTemplate), [q])

  return (
    <div className="p-2 flex flex-col gap-3">
      <input
        className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs"
        placeholder="Filter widgets & components..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {visibleComponentTemplates.length > 0 && (
        <CategorySection label="Cards & Panels">
          {visibleComponentTemplates.map((id) => (
            <ToolboxChip
              key={id}
              label={COMPONENT_TEMPLATE_LABELS[id]}
              title={`Drag onto the canvas to add a pre-styled ${COMPONENT_TEMPLATE_LABELS[id]} (a composite of ordinary widgets, exports normally)`}
              onDragStart={(e) => setComponentTemplateDragPayload(e, id)}
            />
          ))}
        </CategorySection>
      )}

      {WIDGET_CATEGORIES.map((cat) => {
        const visible = cat.types.filter(matchesWidget)
        if (visible.length === 0) return null
        return (
          <CategorySection key={cat.label} label={cat.label}>
            {visible.map((type) => (
              <ToolboxChip key={type} label={UI_WIDGET_LABELS[type]} title={`Drag onto the canvas to add a ${UI_WIDGET_LABELS[type]}`} onDragStart={(e) => setWidgetDragPayload(e, type)} />
            ))}
          </CategorySection>
        )
      })}
    </div>
  )
}
