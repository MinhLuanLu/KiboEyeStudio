import { useMemo, useState } from 'react'
import { useStore } from '@/state/store'
import { UI_BACKGROUND_IMAGE_WIDGETS, UI_SRC_IMAGE_WIDGETS, UI_WIDGET_LABELS } from '@/types'
import type { UiLengthValue, UiWidget, UiWidgetStateName, UiWidgetStyle } from '@/types'
import { rectFitsDisplayShape, uiDisplayShapeToDisplayShape } from '@/renderer/displayMask'
import { ACTION_TABLE } from '@/lib/uiDesign/scriptLang/actionTable'
import { addEventRow, parseVisualEventRows, spliceEventArg, spliceEventTargetAction, spliceEventTrigger, type VisualEventRow } from '@/lib/uiDesign/scriptLang/visualEvents'

const EVENT_OPTIONS = ['click', 'pressed', 'released', 'longPress', 'valueChanged', 'focused', 'unfocused', 'checked', 'unchecked', 'screenLoaded', 'screenUnloaded']

const BACKGROUND_SIZE_OPTIONS: { value: NonNullable<UiWidgetStyle['backgroundSize']>; label: string }[] = [
  { value: 'stretch', label: 'Stretch' },
  { value: 'fit', label: 'Fit' },
  { value: 'fill', label: 'Fill' },
  { value: 'center', label: 'Center' },
  { value: 'tile', label: 'Tile' }
]

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">{label}</span>
      <input
        type="number"
        className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-full"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function parseLengthInput(raw: string): UiLengthValue | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (trimmed.toLowerCase() === 'auto') return 'auto'
  if (/^\d+(\.\d+)?%$/.test(trimmed)) return trimmed as `${number}%`
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined
}

function lengthToInputText(v: UiLengthValue | undefined): string {
  if (v === undefined) return '0'
  if (v === 'auto') return 'auto'
  return typeof v === 'number' ? String(Math.round(v)) : v
}

/** Width/Height accept a plain px number, "auto", or "N%" — percentage/auto sizes are
 * responsive for free (WidgetRenderer's CSS preview already understands them, and
 * lvglExport.ts maps a percentage to LVGL's lv_pct()) so a widget sized this way keeps its
 * proportion automatically when the display size changes, instead of needing the rescale
 * store.ts applies to plain-px widgets on a display resize. */
function LengthField({ label, value, onChange }: { label: string; value: UiLengthValue | undefined; onChange: (v: UiLengthValue) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">{label}</span>
      <input
        className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-full font-mono"
        defaultValue={lengthToInputText(value)}
        key={lengthToInputText(value)}
        placeholder="px, %, or auto"
        onBlur={(e) => {
          const parsed = parseLengthInput(e.target.value)
          if (parsed !== undefined) onChange(parsed)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">{label}</span>
      <div className="flex items-center gap-1.5">
        <input type="color" className="w-7 h-7 rounded border border-studio-border bg-transparent" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
        <input
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm flex-1 font-mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

type StateTab = 'default' | UiWidgetStateName
const STATE_TABS: { value: StateTab; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'hover', label: 'Hover' },
  { value: 'pressed', label: 'Pressed' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'focused', label: 'Focused' }
]

/** The visual Events/Actions editor — a structured view over the script text (see
 * scriptLang/visualEvents.ts), shown for any named (tagId-bearing) widget, same precondition
 * this project's default click-stub fallback already uses. Only rows matching the simple
 * `srcRef.on(event, () => { tgtRef.method(literal, ...); })` shape are shown/editable here;
 * anything else authored in the Logic tab still runs, it just doesn't get a row. Edits splice
 * the script text at the exact node offsets that produced the row — never a full regenerate. */
function EventsSection({ widget }: { widget: UiWidget }) {
  const script = useStore((s) => s.project.uiDesign.script)
  const widgets = useStore((s) => s.project.uiDesign.widgets)
  const setUiScript = useStore((s) => s.setUiScript)
  const checkpoint = useStore((s) => s.checkpoint)

  const rows = useMemo(() => parseVisualEventRows(script, widgets).filter((r) => r.sourceWidgetId === widget.id), [script, widgets, widget.id])
  const namedWidgets = useMemo(() => Object.values(widgets).filter((w) => w.tagId), [widgets])

  const commit = (next: string | null) => {
    if (next === null) return
    checkpoint()
    setUiScript(next)
  }

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="studio-label">Events</span>
        <button
          className="text-[11px] text-studio-accent hover:underline disabled:opacity-40 disabled:no-underline"
          disabled={namedWidgets.length === 0}
          onClick={() => {
            const target = namedWidgets.find((w) => w.id !== widget.id) ?? namedWidgets[0]
            if (target) commit(addEventRow(script, widgets, widget.id, 'click', target.id, 'show'))
          }}
        >
          + Add Event
        </button>
      </div>
      {rows.length === 0 && (
        <span className="text-[11px] text-studio-muted">
          No script events recognized for this widget yet — click "+ Add Event", or write one directly in the Logic tab.
        </span>
      )}
      {rows.map((row) => (
        <EventRow key={row.key} row={row} script={script} widgets={widgets} namedWidgets={namedWidgets} onCommit={commit} />
      ))}
    </div>
  )
}

function EventRow({
  row,
  script,
  widgets,
  namedWidgets,
  onCommit
}: {
  row: VisualEventRow
  script: string
  widgets: Record<string, UiWidget>
  namedWidgets: UiWidget[]
  onCommit: (next: string | null) => void
}) {
  const targetWidget = widgets[row.targetWidgetId]
  const applicableMethods = Object.entries(ACTION_TABLE)
    .filter(([, spec]) => spec.appliesTo === 'any' || (targetWidget && spec.appliesTo.includes(targetWidget.type)))
    .map(([name]) => name)

  return (
    <div className="studio-panel2 border border-studio-border rounded p-2 flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Event</span>
          <select
            className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
            value={row.trigger}
            onChange={(e) => onCommit(spliceEventTrigger(script, row, e.target.value))}
          >
            {EVENT_OPTIONS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Target</span>
          <select
            className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
            value={row.targetWidgetId}
            onChange={(e) => onCommit(spliceEventTargetAction(script, widgets, row, e.target.value, row.method))}
          >
            {namedWidgets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.tagId}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Action</span>
        <select
          className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
          value={row.method}
          onChange={(e) => onCommit(spliceEventTargetAction(script, widgets, row, row.targetWidgetId, e.target.value))}
        >
          {applicableMethods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {row.args.map((arg, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Value{row.args.length > 1 ? ` ${i + 1}` : ''}</span>
          <input
            className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono"
            defaultValue={String(arg)}
            key={`${row.key}-${i}-${arg}`}
            onBlur={(e) => {
              const raw = e.target.value
              const newVal = typeof arg === 'number' ? Number(raw) : typeof arg === 'boolean' ? raw === 'true' : raw
              onCommit(spliceEventArg(script, row, i, newVal))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </div>
      ))}
    </div>
  )
}

// Position/size are always inline, direct-manipulation fields (drag/resize own them — states
// don't carry their own position in this pass). The appearance block below (background/color/
// border/padding/opacity/font/align) is state-aware: selecting Hover/Pressed/Disabled/Focused
// switches these fields to edit that state's override on top of the Default appearance (which
// itself already layers on top of any matching CSS rule — see cssCascade.ts), matching LVGL's
// own per-state style model.
export function PropertiesPanel() {
  const selectedWidgetId = useStore((s) => s.selectedWidgetId)
  const widget = useStore((s) => (s.selectedWidgetId ? s.project.uiDesign.widgets[s.selectedWidgetId] : null))
  const assets = useStore((s) => s.project.uiDesign.assets)
  const uiDisplay = useStore((s) => s.project.uiDesign.display)
  const display = { width: uiDisplay.width, height: uiDisplay.height, shape: uiDisplayShapeToDisplayShape(uiDisplay.shape) }
  const updateUiWidgetStyle = useStore((s) => s.updateUiWidgetStyle)
  const updateUiWidgetState = useStore((s) => s.updateUiWidgetState)
  const updateUiWidgetText = useStore((s) => s.updateUiWidgetText)
  const updateUiWidgetMeta = useStore((s) => s.updateUiWidgetMeta)
  const setUiWidgetSrc = useStore((s) => s.setUiWidgetSrc)
  const deleteUiWidget = useStore((s) => s.deleteUiWidget)
  const checkpoint = useStore((s) => s.checkpoint)
  const [stateTab, setStateTab] = useState<StateTab>('default')

  if (!selectedWidgetId || !widget) {
    return <div className="p-3 text-sm text-studio-muted">Select a widget on the canvas to edit its properties.</div>
  }

  const style = widget.style
  const x = typeof style.x === 'number' ? style.x : 0
  const y = typeof style.y === 'number' ? style.y : 0
  const width = typeof style.width === 'number' ? style.width : 0
  const height = typeof style.height === 'number' ? style.height : 0

  const appearance: Partial<UiWidgetStyle> = stateTab === 'default' ? style : (widget.states[stateTab] ?? {})
  const setAppearance = (partial: Partial<UiWidgetStyle>) =>
    stateTab === 'default' ? updateUiWidgetStyle(widget.id, partial) : updateUiWidgetState(widget.id, stateTab, partial)

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{UI_WIDGET_LABELS[widget.type]}</span>
        {widget.type !== 'screen' && (
          <button
            className="text-xs text-studio-muted hover:text-studio-danger"
            onClick={() => {
              checkpoint()
              deleteUiWidget(widget.id)
            }}
          >
            Delete
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={x} onChange={(v) => updateUiWidgetStyle(widget.id, { x: v })} />
        <NumberField label="Y" value={y} onChange={(v) => updateUiWidgetStyle(widget.id, { y: v })} />
        <LengthField label="Width" value={style.width} onChange={(v) => updateUiWidgetStyle(widget.id, { width: v })} />
        <LengthField label="Height" value={style.height} onChange={(v) => updateUiWidgetStyle(widget.id, { height: v })} />
      </div>

      {widget.type !== 'screen' && !rectFitsDisplayShape(display, { x, y, width, height }) && (
        <div className="flex items-center justify-between gap-2 bg-studio-danger/10 border border-studio-danger/40 rounded px-2 py-1.5 text-[11px] text-studio-danger">
          <span>⚠ Outside the visible display area{widget.allowOutsideBounds ? ' (allowed)' : ' — snaps back on next move/resize'}</span>
          <label className="flex items-center gap-1 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={widget.allowOutsideBounds}
              onChange={(e) => updateUiWidgetMeta(widget.id, { allowOutsideBounds: e.target.checked })}
            />
            Allow
          </label>
        </div>
      )}

      {widget.text !== undefined && (
        <div className="flex flex-col gap-1">
          <span className="studio-label">Text</span>
          <input
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
            value={widget.text}
            onChange={(e) => updateUiWidgetText(widget.id, e.target.value)}
          />
        </div>
      )}

      {UI_SRC_IMAGE_WIDGETS.has(widget.type) && (
        <div className="flex flex-col gap-1">
          <span className="studio-label">Image Source</span>
          <select
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
            value={widget.src ?? ''}
            onChange={(e) => setUiWidgetSrc(widget.id, e.target.value || null)}
          >
            <option value="">(none — import one in the Assets tab)</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="border-t border-studio-border pt-2.5 flex flex-col gap-2.5">
        <div className="flex bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {STATE_TABS.map((t) => (
            <button
              key={t.value}
              className={`studio-tab flex-1 text-[11px] ${stateTab === t.value ? 'studio-tab-active' : ''}`}
              onClick={() => setStateTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {stateTab !== 'default' && (
          <button
            className="text-[11px] text-studio-muted hover:text-studio-text self-start"
            onClick={() => updateUiWidgetState(widget.id, stateTab, null)}
          >
            Clear {STATE_TABS.find((t) => t.value === stateTab)?.label} overrides
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Background" value={appearance.background ?? ''} onChange={(v) => setAppearance({ background: v })} />
          <ColorField label="Text Color" value={appearance.color ?? ''} onChange={(v) => setAppearance({ color: v })} />
        </div>

        {UI_BACKGROUND_IMAGE_WIDGETS.has(widget.type) && (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <span className="studio-label">Background Image {stateTab !== 'default' && `(${STATE_TABS.find((t) => t.value === stateTab)?.label})`}</span>
              <select
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
                value={appearance.backgroundImage ?? ''}
                onChange={(e) => setAppearance({ backgroundImage: e.target.value || undefined })}
              >
                <option value="">(none)</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="studio-label">Fit</span>
              <select
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
                disabled={!appearance.backgroundImage}
                value={appearance.backgroundSize ?? 'fill'}
                onChange={(e) => setAppearance({ backgroundSize: e.target.value as UiWidgetStyle['backgroundSize'] })}
              >
                {BACKGROUND_SIZE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {UI_SRC_IMAGE_WIDGETS.has(widget.type) && (
          <NumberField label="Rotation °" value={appearance.rotation ?? 0} onChange={(v) => setAppearance({ rotation: v })} />
        )}

        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Border Width" value={appearance.borderWidth ?? 0} onChange={(v) => setAppearance({ borderWidth: v })} />
          <ColorField label="Border Color" value={appearance.borderColor ?? ''} onChange={(v) => setAppearance({ borderColor: v })} />
          <NumberField label="Radius" value={appearance.borderRadius ?? 0} onChange={(v) => setAppearance({ borderRadius: v })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Padding"
            value={appearance.paddingTop ?? 0}
            onChange={(v) => setAppearance({ paddingTop: v, paddingRight: v, paddingBottom: v, paddingLeft: v })}
          />
          <NumberField label="Opacity %" value={appearance.opacity ?? 100} onChange={(v) => setAppearance({ opacity: v })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Font Size" value={appearance.fontSize ?? 14} onChange={(v) => setAppearance({ fontSize: v })} />
          <div className="flex flex-col gap-1">
            <span className="studio-label">Text Align</span>
            <select
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
              value={appearance.textAlign ?? 'left'}
              onChange={(e) => setAppearance({ textAlign: e.target.value as 'left' | 'center' | 'right' })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
      </div>

      <div className="border-t border-studio-border pt-2.5 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="studio-label">ID</span>
          <input
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm font-mono"
            placeholder="(none)"
            value={widget.tagId ?? ''}
            onChange={(e) => updateUiWidgetMeta(widget.id, { tagId: e.target.value || null })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="studio-label">Class</span>
          <input
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm font-mono"
            placeholder="(space-separated)"
            value={widget.classNames.join(' ')}
            onChange={(e) => updateUiWidgetMeta(widget.id, { classNames: e.target.value.split(/\s+/).filter(Boolean) })}
          />
        </div>
      </div>

      {widget.tagId && <EventsSection widget={widget} />}
    </div>
  )
}
