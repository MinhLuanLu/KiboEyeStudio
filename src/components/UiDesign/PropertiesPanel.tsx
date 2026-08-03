import { useMemo, useState } from 'react'
import { useStore } from '@/state/store'
import { UI_BACKGROUND_IMAGE_WIDGETS, UI_SRC_IMAGE_WIDGETS, UI_WIDGET_LABELS } from '@/types'
import type { UiLengthValue, UiWidget, UiWidgetStateName, UiWidgetStyle } from '@/types'
import { rectFitsDisplayShape, uiDisplayShapeToDisplayShape } from '@/renderer/displayMask'
import { ACTION_TABLE, HARDWARE_ACTION_PRESETS } from '@/lib/uiDesign/scriptLang/actionTable'
import { widgetVarName } from '@/lib/export/lvglExport'
import {
  addEventRow,
  parseVisualEventRows,
  spliceActionAdd,
  spliceActionArg,
  spliceActionDuplicate,
  spliceActionField,
  spliceActionRemove,
  spliceActionReorder,
  spliceActionToggleDisabled,
  spliceAddConditionClause,
  spliceConditionClause,
  spliceConditionCombinator,
  spliceEventHandlerName,
  spliceEventTrigger,
  spliceRemoveConditionClause,
  spliceRowAddElse,
  spliceRowCondition,
  spliceRowRemoveElse,
  widgetsWithExistingRefs,
  type VisualActionEntry,
  type VisualCondition,
  type VisualConditionLhs,
  type VisualConditionOp,
  type VisualEventRow
} from '@/lib/uiDesign/scriptLang/visualEvents'
import {
  addBindingRow,
  parseVisualBindingRows,
  spliceBindingOptions,
  spliceBindingProperty,
  spliceBindingRemove,
  spliceBindingTwoWay,
  spliceBindingVariable,
  type VisualBindingOptions,
  type VisualBindingProperty,
  type VisualBindingRow
} from '@/lib/uiDesign/scriptLang/visualBindings'

const CONDITION_OP_LABELS: Record<VisualConditionOp, string> = {
  '==': 'Equals',
  '!=': 'Not equal',
  '>': 'Greater than',
  '<': 'Less than',
  '>=': 'Greater or equal',
  '<=': 'Less or equal',
  includes: 'Contains'
}

function coerceConditionValue(raw: string): string | number | boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

function lhsKey(lhs: VisualConditionLhs): string {
  return lhs.kind === 'data' ? 'data' : lhs.kind === 'widgetValue' ? `widget:${lhs.widgetId}` : `id:${lhs.name}`
}

function lhsLabel(lhs: VisualConditionLhs, widgets: Record<string, UiWidget>): string {
  if (lhs.kind === 'data') return `Variable: ${lhs.name}`
  if (lhs.kind === 'widgetValue') return `${widgets[lhs.widgetId]?.tagId ?? lhs.refName} value`
  return `Script variable: ${lhs.name}`
}

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

/** "When this happens" → readable summary of one action, for the row's human-readable summary
 * line. A small set of common methods get natural-language phrasing; anything else falls back to
 * a plain `target.method(args)` rendering — same "cover the common case, degrade gracefully"
 * approach the rest of this editor already uses. */
function summarizeAction(a: VisualActionEntry, widgets: Record<string, UiWidget>): string {
  const target = widgets[a.targetWidgetId]?.tagId ?? a.targetRefName
  const argText = (v: string | number | boolean) => (typeof v === 'string' ? `"${v}"` : String(v))
  const args = a.args.map(argText).join(', ')
  switch (a.method) {
    case 'show':
      return `show ${target}`
    case 'hide':
      return `hide ${target}`
    case 'enable':
      return `enable ${target}`
    case 'disable':
      return `disable ${target}`
    case 'setEnabled':
      return `${a.args[0] ? 'enable' : 'disable'} ${target}`
    case 'setText':
      return `set ${target} text to ${args}`
    case 'setColor':
      return `set ${target} color to ${args}`
    case 'setValue':
      return `set ${target} value to ${args}`
    case 'setOpacity':
      return `set ${target} opacity to ${args}`
    case 'toggleState':
      return `toggle ${target}`
    case 'playAnimation':
      return `animate ${target}`
    case 'callFunction': {
      const preset = HARDWARE_ACTION_PRESETS.find((p) => p.functionName === a.args[0])
      const fnLabel = preset ? preset.label.replace(/^Hardware: /, '') : typeof a.args[0] === 'string' ? a.args[0] : 'a custom function'
      return `call ${fnLabel}`
    }
    default:
      return `${target}.${a.method}(${args})`
  }
}

const BIND_PROPERTY_OPTIONS: { value: VisualBindingProperty; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'value', label: 'Value' },
  { value: 'visible', label: 'Visible' }
]

function summarizeBinding(row: VisualBindingRow): string {
  const propLabel = row.property === 'text' ? 'Text' : row.property === 'value' ? 'Value' : 'Visibility'
  return row.twoWay ? `${propLabel} <-> data.${row.variableName}` : `${propLabel} <- data.${row.variableName}`
}

/** The visual Data Binding editor — a structured view over the script text (see
 * scriptLang/visualBindings.ts), same "recognized shape only" precondition and tagId requirement
 * as EventsSection below. Only `tgtRef.bindText/bindValue/bindVisible(data.<name>, {...})` calls
 * are shown/editable here — anything bound to a bare script variable or another widget's value
 * still runs, it just isn't visualized. Two-way binding adds/removes a companion
 * `.on("valueChanged", ...)` write-back block (visualBindings.ts's spliceBindingTwoWay) — a
 * second, independent primitive rather than a new binding-direction concept. */
function BindingsSection({ widget }: { widget: UiWidget }) {
  const script = useStore((s) => s.project.uiDesign.script)
  const widgets = useStore((s) => s.project.uiDesign.widgets)
  const variables = useStore((s) => s.project.uiDesign.variables)
  const setUiScript = useStore((s) => s.setUiScript)
  const checkpoint = useStore((s) => s.checkpoint)

  const rows = useMemo(() => parseVisualBindingRows(script, widgets).filter((r) => r.targetWidgetId === widget.id), [script, widgets, widget.id])

  const commit = (next: string | null) => {
    if (next === null) return
    checkpoint()
    setUiScript(next)
  }

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="studio-label">Data Binding</span>
        <button
          className="text-[11px] text-studio-accent hover:underline disabled:opacity-40 disabled:no-underline"
          disabled={variables.length === 0}
          onClick={() => {
            const v = variables[0]
            if (v) commit(addBindingRow(script, widgets, widget.id, 'text', v.name))
          }}
        >
          + Add Binding
        </button>
      </div>
      {variables.length === 0 && <span className="text-[11px] text-studio-muted">No variables yet — add one in the Variables tab first.</span>}
      {variables.length > 0 && rows.length === 0 && (
        <span className="text-[11px] text-studio-muted">No bindings recognized for this widget yet — click "+ Add Binding".</span>
      )}
      {rows.map((row) => (
        <BindingRow key={row.key} row={row} script={script} variables={variables} onCommit={commit} />
      ))}
    </div>
  )
}

function BindingRow({
  row,
  script,
  variables,
  onCommit
}: {
  row: VisualBindingRow
  script: string
  variables: { id: string; name: string }[]
  onCommit: (next: string | null) => void
}) {
  const options = row.options
  const setOptions = (partial: Partial<VisualBindingOptions>) => onCommit(spliceBindingOptions(script, row, { ...options, ...partial }))
  const variableNames = variables.some((v) => v.name === row.variableName) ? variables.map((v) => v.name) : [row.variableName, ...variables.map((v) => v.name)]

  return (
    <div className="studio-panel2 border border-studio-border rounded p-2 flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Property</span>
          <select
            className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
            value={row.property}
            onChange={(e) => onCommit(spliceBindingProperty(script, row, e.target.value as VisualBindingProperty))}
          >
            {BIND_PROPERTY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Variable</span>
          <select
            className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
            value={row.variableName}
            onChange={(e) => onCommit(spliceBindingVariable(script, row, e.target.value))}
          >
            {variableNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {row.property === 'value' && (
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="Min" value={options.min ?? 0} onChange={(v) => setOptions({ min: v })} />
          <NumberField label="Max" value={options.max ?? 100} onChange={(v) => setOptions({ max: v })} />
        </div>
      )}
      {row.property === 'text' && (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-studio-muted uppercase tracking-wide">Format</span>
            <input
              className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono"
              placeholder="{value}"
              value={options.format ?? ''}
              onChange={(e) => setOptions({ format: e.target.value || undefined })}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-studio-muted uppercase tracking-wide">Unit</span>
            <input
              className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
              placeholder="°C"
              value={options.unit ?? ''}
              onChange={(e) => setOptions({ unit: e.target.value || undefined })}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input type="checkbox" checked={row.twoWay} onChange={(e) => onCommit(spliceBindingTwoWay(script, row, e.target.checked))} />
          Two-way (write back on change)
        </label>
        <button className="text-[11px] text-studio-muted hover:text-red-400" onClick={() => onCommit(spliceBindingRemove(script, row))}>
          Remove
        </button>
      </div>
      <span className="text-[11px] text-studio-muted italic">{summarizeBinding(row)}</span>
    </div>
  )
}

/** The visual Events/Actions editor — a structured view over the script text (see
 * scriptLang/visualEvents.ts), shown for any named (tagId-bearing) widget, same precondition
 * this project's default click-stub fallback already uses. Only rows matching the recognized
 * `srcRef.on(event, () => { tgtRef.method(literal, ...); ...more actions...; })` shape are
 * shown/editable here; anything else authored in the Logic tab still runs, it just doesn't get a
 * row. Edits splice the script text at the exact node offsets that produced the row — never a
 * full regenerate (structural edits — add/remove/duplicate/reorder/disable — rewrite just the
 * handler's own block body, see visualEvents.ts). */
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
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [elseDragIndex, setElseDragIndex] = useState<number | null>(null)

  const enabled = row.actions.filter((a) => !a.disabled)
  const summary =
    row.actions.length === 0
      ? 'no actions yet'
      : enabled.length === 0
        ? '(all actions disabled)'
        : enabled.map((a) => summarizeAction(a, widgets)).join('; ')
  const conditionText = row.condition
    ? row.condition.clauses.map((c) => summarizeClause(c, widgets)).join(row.condition.combinator === 'and' ? ' and ' : ' or ')
    : null

  return (
    <div className="studio-panel2 border border-studio-border rounded p-2 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">When this happens</span>
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
        <button
          className="self-end text-[11px] text-studio-accent hover:underline disabled:opacity-40 disabled:no-underline text-right"
          disabled={namedWidgets.length === 0}
          onClick={() => {
            const target = namedWidgets.find((w) => w.id !== row.sourceWidgetId) ?? namedWidgets[0]
            if (target) onCommit(spliceActionAdd(script, widgets, row, target.id, 'show'))
          }}
        >
          + Add Action
        </button>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Callback function name</span>
        <input
          className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono"
          placeholder={`${widgets[row.sourceWidgetId] ? widgetVarName(widgets[row.sourceWidgetId]) : 'widget'}_on_${row.trigger} (auto)`}
          defaultValue={row.handlerName ?? ''}
          key={`${row.key}-${row.handlerName ?? ''}`}
          onBlur={(e) => onCommit(spliceEventHandlerName(script, row, e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </label>
      <span className="text-[11px] text-studio-muted italic">
        When {row.trigger}
        {conditionText ? ` if ${conditionText}` : ''} → {summary}
        {row.elseActions && row.elseActions.length > 0 ? `, else ${row.elseActions.map((a) => summarizeAction(a, widgets)).join('; ')}` : ''}
      </span>

      <ConditionSection row={row} script={script} widgets={widgets} onCommit={onCommit} />

      <div className="flex flex-col gap-1.5">
        {row.actions.map((action, i) => (
          <ActionCard
            key={`${row.key}-${i}`}
            action={action}
            index={i}
            script={script}
            widgets={widgets}
            namedWidgets={namedWidgets}
            multi={row.actions.length > 1}
            dragging={dragIndex === i}
            onDragStart={() => setDragIndex(i)}
            onDropOnto={() => {
              if (dragIndex !== null && dragIndex !== i) onCommit(spliceActionReorder(script, row, dragIndex, i))
              setDragIndex(null)
            }}
            onCommit={onCommit}
            onFieldChange={(targetWidgetId, method, explicitArgs) => onCommit(spliceActionField(script, widgets, row, i, targetWidgetId, method, explicitArgs))}
            onArgChange={(argIndex, value) => onCommit(spliceActionArg(script, row, i, argIndex, value))}
            onToggleDisabled={() => onCommit(spliceActionToggleDisabled(script, row, i))}
            onDuplicate={() => onCommit(spliceActionDuplicate(script, row, i))}
            onRemove={() => onCommit(spliceActionRemove(script, row, i))}
          />
        ))}
      </div>

      {row.condition && (
        <div className="border-t border-studio-border/60 pt-1.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-studio-muted uppercase tracking-wide">Else</span>
            {row.elseActions ? (
              <div className="flex items-center gap-2">
                <button
                  className="text-[11px] text-studio-accent hover:underline disabled:opacity-40 disabled:no-underline"
                  disabled={namedWidgets.length === 0}
                  onClick={() => {
                    const target = namedWidgets.find((w) => w.id !== row.sourceWidgetId) ?? namedWidgets[0]
                    if (target) onCommit(spliceActionAdd(script, widgets, row, target.id, 'show', 'else'))
                  }}
                >
                  + Add Else Action
                </button>
                <button className="text-[11px] text-studio-muted hover:text-red-400" onClick={() => onCommit(spliceRowRemoveElse(script, row))}>
                  Remove Else
                </button>
              </div>
            ) : (
              <button className="text-[11px] text-studio-accent hover:underline" onClick={() => onCommit(spliceRowAddElse(script, row))}>
                + Add Else Branch
              </button>
            )}
          </div>
          {row.elseActions && (
            <div className="flex flex-col gap-1.5">
              {row.elseActions.map((action, i) => (
                <ActionCard
                  key={`${row.key}-else-${i}`}
                  action={action}
                  index={i}
                  script={script}
                  widgets={widgets}
                  namedWidgets={namedWidgets}
                  multi={row.elseActions!.length > 1}
                  dragging={elseDragIndex === i}
                  onDragStart={() => setElseDragIndex(i)}
                  onDropOnto={() => {
                    if (elseDragIndex !== null && elseDragIndex !== i) onCommit(spliceActionReorder(script, row, elseDragIndex, i, 'else'))
                    setElseDragIndex(null)
                  }}
                  onCommit={onCommit}
                  onFieldChange={(targetWidgetId, method, explicitArgs) => onCommit(spliceActionField(script, widgets, row, i, targetWidgetId, method, explicitArgs, 'else'))}
                  onArgChange={(argIndex, value) => onCommit(spliceActionArg(script, row, i, argIndex, value, 'else'))}
                  onToggleDisabled={() => onCommit(spliceActionToggleDisabled(script, row, i, 'else'))}
                  onDuplicate={() => onCommit(spliceActionDuplicate(script, row, i, 'else'))}
                  onRemove={() => onCommit(spliceActionRemove(script, row, i, 'else'))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "if temperature is above 30°C" style condition summary + editor — shown between the trigger
 * and the action list. Shows "+ Add Condition" when the row has none yet; once present, a small
 * form per clause (Data/Widget Value/Script Variable source, comparator, value) plus an AND/OR
 * toggle and add/remove-clause controls when a second clause exists. */
function ConditionSection({
  row,
  script,
  widgets,
  onCommit
}: {
  row: VisualEventRow
  script: string
  widgets: Record<string, UiWidget>
  onCommit: (next: string | null) => void
}) {
  const conditionCandidates = useMemo(() => widgetsWithExistingRefs(script, widgets), [script, widgets])

  if (!row.condition) {
    return (
      <button
        className="self-start text-[11px] text-studio-accent hover:underline"
        onClick={() => onCommit(spliceRowCondition(script, row, { left: { kind: 'identifier', name: 'value' }, op: '>', right: 0 }))}
      >
        + Add Condition
      </button>
    )
  }

  return (
    <div className="studio-panel border border-studio-border rounded p-1.5 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">If</span>
        <button className="text-[11px] text-studio-muted hover:text-red-400" onClick={() => onCommit(spliceRowCondition(script, row, null))}>
          Remove Condition
        </button>
      </div>
      {row.condition.clauses.map((clause, i) => (
        <div key={i} className="flex flex-col gap-1">
          {i === 1 && (
            <div className="flex items-center justify-center gap-1.5">
              <select
                className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-[10px]"
                value={row.condition!.combinator}
                onChange={(e) => onCommit(spliceConditionCombinator(script, row, e.target.value as 'and' | 'or'))}
              >
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
            </div>
          )}
          <ClauseEditor
            clause={clause}
            widgets={widgets}
            candidates={conditionCandidates}
            onChange={(next) => onCommit(spliceConditionClause(script, row, i, next))}
            onRemove={row.condition!.clauses.length === 2 ? () => onCommit(spliceRemoveConditionClause(script, row, i === 0 ? 1 : 0)) : undefined}
          />
        </div>
      ))}
      {row.condition.clauses.length === 1 && (
        <button
          className="self-start text-[11px] text-studio-accent hover:underline"
          onClick={() => onCommit(spliceAddConditionClause(script, row, { left: { kind: 'identifier', name: 'value' }, op: '>', right: 0 }))}
        >
          + Add Condition (AND/OR)
        </button>
      )}
    </div>
  )
}

function ClauseEditor({
  clause,
  widgets,
  candidates,
  onChange,
  onRemove
}: {
  clause: VisualCondition
  widgets: Record<string, UiWidget>
  candidates: UiWidget[]
  onChange: (next: { left: VisualConditionLhs; op: VisualConditionOp; right: string | number | boolean }) => void
  onRemove?: () => void
}) {
  const lhsOptions: { key: string; lhs: VisualConditionLhs }[] = [
    { key: 'data', lhs: { kind: 'data', name: clause.left.kind === 'data' ? clause.left.name : 'value' } },
    ...candidates.map((w) => ({ key: `widget:${w.id}`, lhs: { kind: 'widgetValue' as const, refName: `${w.tagId}Ref`, widgetId: w.id } })),
    { key: 'id', lhs: { kind: 'identifier', name: clause.left.kind === 'identifier' ? clause.left.name : 'value' } }
  ]

  return (
    <div className="grid grid-cols-3 gap-1">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Data source</span>
        <select
          className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs"
          value={lhsKey(clause.left)}
          onChange={(e) => {
            const opt = lhsOptions.find((o) => o.key === e.target.value)
            if (opt) onChange({ left: opt.lhs, op: clause.op, right: clause.right })
          }}
        >
          {lhsOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {lhsLabel(o.lhs, widgets)}
            </option>
          ))}
        </select>
        {clause.left.kind !== 'widgetValue' && (
          <input
            className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono mt-0.5"
            defaultValue={clause.left.name}
            key={clause.left.name}
            placeholder="name"
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name) onChange({ left: { kind: clause.left.kind, name } as VisualConditionLhs, op: clause.op, right: clause.right })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Comparator</span>
        <select
          className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs"
          value={clause.op}
          onChange={(e) => onChange({ left: clause.left, op: e.target.value as VisualConditionOp, right: clause.right })}
        >
          {(Object.keys(CONDITION_OP_LABELS) as VisualConditionOp[]).map((op) => (
            <option key={op} value={op}>
              {CONDITION_OP_LABELS[op]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Value</span>
          {onRemove && (
            <button className="text-[10px] text-studio-muted hover:text-red-400" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
        <input
          className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono"
          defaultValue={String(clause.right)}
          key={String(clause.right)}
          onBlur={(e) => onChange({ left: clause.left, op: clause.op, right: coerceConditionValue(e.target.value) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
    </div>
  )
}

function summarizeClause(c: VisualCondition, widgets: Record<string, UiWidget>): string {
  const lhs = c.left.kind === 'data' ? c.left.name : c.left.kind === 'widgetValue' ? `${widgets[c.left.widgetId]?.tagId ?? c.left.refName}'s value` : c.left.name
  if (c.op === 'includes') return `${lhs} contains "${c.right}"`
  const words: Record<Exclude<VisualConditionOp, 'includes'>, string> = { '==': 'is', '!=': 'is not', '>': 'is above', '<': 'is below', '>=': 'is at least', '<=': 'is at most' }
  return `${lhs} ${words[c.op as Exclude<VisualConditionOp, 'includes'>]} ${typeof c.right === 'string' ? `"${c.right}"` : c.right}`
}

function ActionCard({
  action,
  index,
  widgets,
  namedWidgets,
  multi,
  dragging,
  onDragStart,
  onDropOnto,
  onFieldChange,
  onArgChange,
  onToggleDisabled,
  onDuplicate,
  onRemove
}: {
  action: VisualActionEntry
  index: number
  script: string
  widgets: Record<string, UiWidget>
  namedWidgets: UiWidget[]
  multi: boolean
  dragging: boolean
  onDragStart: () => void
  onDropOnto: () => void
  onCommit: (next: string | null) => void
  onFieldChange: (targetWidgetId: string, method: string, explicitArgs?: (string | number | boolean)[]) => void
  onArgChange: (argIndex: number, value: string | number | boolean) => void
  onToggleDisabled: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const targetWidget = widgets[action.targetWidgetId]
  const applicableMethods = Object.entries(ACTION_TABLE)
    .filter(([name, spec]) => name !== 'callFunction' && (spec.appliesTo === 'any' || (targetWidget && spec.appliesTo.includes(targetWidget.type))))
    .map(([name]) => name)
  const matchedPreset = action.method === 'callFunction' ? HARDWARE_ACTION_PRESETS.find((p) => p.functionName === action.args[0]) : undefined
  const actionSelectValue = matchedPreset ? `preset:${matchedPreset.id}` : action.method

  return (
    <div
      className={`bg-studio-panel border rounded p-1.5 flex flex-col gap-1.5 ${dragging ? 'opacity-40' : ''} ${action.disabled ? 'border-studio-border opacity-60' : 'border-studio-border2'}`}
      draggable={multi}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnto()
      }}
    >
      <div className="flex items-center gap-1.5">
        {multi && <span className="text-studio-muted cursor-grab select-none text-xs" title="Drag to reorder">⠿</span>}
        <span className="text-[10px] text-studio-muted uppercase tracking-wide flex-1">Action {multi ? index + 1 : ''}</span>
        <label className="flex items-center gap-1 text-[10px] text-studio-muted" title="Disable without deleting">
          <input type="checkbox" checked={!action.disabled} onChange={onToggleDisabled} />
          Enabled
        </label>
        <button className="text-[11px] text-studio-muted hover:text-studio-text" title="Duplicate action" onClick={onDuplicate}>
          ⧉
        </button>
        <button className="text-[11px] text-studio-muted hover:text-red-400" title="Delete action" onClick={onRemove}>
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Target component</span>
          <select
            className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs"
            value={action.targetWidgetId}
            onChange={(e) => onFieldChange(e.target.value, action.method)}
          >
            {namedWidgets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.tagId}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Do this action</span>
          <select
            className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs"
            value={actionSelectValue}
            onChange={(e) => {
              const val = e.target.value
              if (val.startsWith('preset:')) {
                const preset = HARDWARE_ACTION_PRESETS.find((p) => `preset:${p.id}` === val)
                if (preset) onFieldChange(action.targetWidgetId, 'callFunction', [preset.functionName, ...preset.argSpecs.map((s) => s.default)])
                return
              }
              onFieldChange(action.targetWidgetId, val)
            }}
          >
            <optgroup label="Widget Actions">
              {applicableMethods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
            <optgroup label="Hardware">
              {HARDWARE_ACTION_PRESETS.map((p) => (
                <option key={p.id} value={`preset:${p.id}`}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Custom">
              <option value="callFunction">Call custom function</option>
            </optgroup>
          </select>
        </div>
      </div>
      {action.args.map((arg, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Value or data source{action.args.length > 1 ? ` ${i + 1}` : ''}</span>
          <input
            className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono"
            defaultValue={String(arg)}
            key={`${i}-${arg}`}
            onBlur={(e) => {
              const raw = e.target.value
              const newVal = typeof arg === 'number' ? Number(raw) : typeof arg === 'boolean' ? raw === 'true' : raw
              onArgChange(i, newVal)
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

      {widget.tagId && <BindingsSection widget={widget} />}
      {widget.tagId && <EventsSection widget={widget} />}
    </div>
  )
}
