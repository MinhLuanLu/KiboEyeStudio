import { useMemo, useRef, useState } from 'react'
import * as acorn from 'acorn'
import type { Node } from 'acorn'
import { useStore } from '@/state/store'
import { UI_BACKGROUND_IMAGE_WIDGETS, UI_ICON_TEXT_WIDGETS, UI_SRC_IMAGE_WIDGETS, UI_TEXT_STYLE_WIDGETS, UI_WIDGET_LABELS } from '@/types'
import { checkExpressionSubset } from '@/lib/uiDesign/scriptLang/restrictedSubset'
import type { UiImageFit, UiIndicatorEasing, UiKeyboardCustomKey, UiLengthValue, UiListItem, UiThemeTokens, UiWidget, UiWidgetStateName, UiWidgetStyle } from '@/types'
import { MATERIAL_PRESET_LABELS } from '@/lib/uiDesign/materialPresets'
import type { MaterialPresetId } from '@/lib/uiDesign/materialPresets'
import { DEFAULT_ALT_CHARS } from '@/lib/uiDesign/keyboardLayouts'
import { missingDanishCodepoints } from '@/lib/uiDesign/fontImport'
import { rectFitsDisplayShape, uiDisplayShapeToDisplayShape } from '@/renderer/displayMask'
import { centerPanForRect, fitZoomToDisplay } from '@/lib/uiDesign/canvasZoom'
import { isTopLevelUiWidget } from '@/lib/uiDesign/widgetGeometry'
import { isOptionsSourceWidget, resolveOptionsSourceLines } from '@/lib/uiDesign/optionsSource'
import { ACTION_TABLE, HARDWARE_ACTION_PRESETS } from '@/lib/uiDesign/scriptLang/actionTable'
import {
  widgetVarName,
  widgetBaseName,
  toCIdentifier,
  EVENT_CAPABLE_WIDGET_TYPES,
  EVENT_CALLBACK_TRIGGER_OPTIONS,
  isIndicatorWidget,
  indicatorFunctionBaseName,
  indicatorScreenFunctionPrefix
} from '@/lib/export/lvglExport'
import { IconPicker } from './IconPicker'
import { LVGL_SYMBOLS } from '@/lib/uiDesign/lvglSymbols'
import {
  addAnimatePresetRow,
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

const IMAGE_FIT_OPTIONS: { value: UiImageFit; label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'fitWidth', label: 'Fit Width' },
  { value: 'fitHeight', label: 'Fit Height' },
  { value: 'fullScreen', label: 'Full Screen' },
  { value: 'none', label: 'None' }
]

function NumberField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">{label}</span>
      <input
        type="number"
        className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-full disabled:opacity-50"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
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
function LengthField({
  label,
  value,
  onChange,
  disabled
}: {
  label: string
  value: UiLengthValue | undefined
  onChange: (v: UiLengthValue) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">{label}</span>
      <input
        className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-full font-mono disabled:opacity-50"
        defaultValue={lengthToInputText(value)}
        key={lengthToInputText(value)}
        placeholder="px, %, or auto"
        disabled={disabled}
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

/** `themeToken`/`onThemeTokenChange` are optional — only the handful of themeable fields
 * (background/text/border/shadow/glow color, see UiThemeableStyleField) pass them, giving those
 * fields a small "Theme token" dropdown alongside the literal color picker. Picking a token
 * doesn't discard the literal value (it stays as the fallback/last-applied color); it's tracked
 * separately in UiWidget.themeTokens — see lib/uiDesign/themes.ts's resolveThemedStyle(). */
function ColorField({
  label,
  value,
  onChange,
  themeToken,
  onThemeTokenChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
  themeToken?: keyof UiThemeTokens | null
  onThemeTokenChange?: (token: keyof UiThemeTokens | null) => void
}) {
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
      {onThemeTokenChange && (
        <select
          className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-[10px] text-studio-muted"
          value={themeToken ?? ''}
          onChange={(e) => onThemeTokenChange((e.target.value || null) as keyof UiThemeTokens | null)}
        >
          <option value="">Literal color (no theme token)</option>
          {THEME_TOKEN_OPTIONS.map((t) => (
            <option key={t} value={t}>
              Theme token: {t}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

const THEME_TOKEN_OPTIONS: (keyof UiThemeTokens)[] = ['background', 'surface', 'primary', 'secondary', 'text', 'textMuted', 'border', 'accent']

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
/** "Auto-generate an event callback for this widget" — the automatic, script-free scaffolding
 * (see EVENT_CAPABLE_WIDGET_TYPES/collectEvents in lvglExport.ts): every interactive widget gets
 * a `<var>_event_cb(lv_event_t* e)` with a `switch (lv_event_get_code(e))`, registered via
 * `lv_obj_add_event_cb(widget, cb, LV_EVENT_ALL, NULL)`, with one empty `case` per event checked
 * below (or just a `default:` if none are checked — still real, compilable scaffolding). This is
 * independent of — and merges into the same function as — any script-authored `.on(...)` events
 * from the Logic tab or the "Events" list below; nothing here duplicates those. */
function AutoEventCallbackSection({ widget }: { widget: UiWidget }) {
  const updateUiWidgetMeta = useStore((s) => s.updateUiWidgetMeta)
  const checkpoint = useStore((s) => s.checkpoint)
  if (!EVENT_CAPABLE_WIDGET_TYPES.has(widget.type)) return null

  const enabled = widget.eventCallbackEnabled !== false
  const selected = widget.eventCallbackTriggers ?? []
  const fnName = `${widgetBaseName(widget)}_event_cb`

  const toggleEnabled = () => {
    checkpoint()
    updateUiWidgetMeta(widget.id, { eventCallbackEnabled: !enabled })
  }
  const toggleTrigger = (value: string) => {
    checkpoint()
    const next = selected.includes(value) ? selected.filter((t) => t !== value) : [...selected, value]
    updateUiWidgetMeta(widget.id, { eventCallbackTriggers: next })
  }

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={toggleEnabled} />
        <span className="studio-label">Auto Event Callback</span>
      </label>
      {enabled && (
        <>
          <span className="text-[11px] text-studio-muted font-mono">{fnName}(lv_event_t* e)</span>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {EVENT_CALLBACK_TRIGGER_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggleTrigger(opt.value)} />
                {opt.label}
              </label>
            ))}
          </div>
          <span className="text-[11px] text-studio-muted">
            {selected.length === 0
              ? 'No events checked — registers with LV_EVENT_ALL and an empty default: case you fill in yourself.'
              : `Registers with LV_EVENT_ALL; the switch handles ${selected.length} selected event${selected.length === 1 ? '' : 's'}.`}
          </span>
        </>
      )}
    </div>
  )
}

interface AnimationPresetDef {
  label: string
  title: string
  configLiteral: (widget: UiWidget) => string
}

// Curated, realistic presets over the one real `.animate()` mechanism (real LVGL lv_anim, see
// codegen.ts's renderAnimate) — sugar over a real primitive, not a second animation system. Each
// button inserts a `<ref>.on('click', () => { <ref>.animate({...}); })` block via
// addAnimatePresetRow (visualEvents.ts) — a one-way insert, editable afterward as plain script
// text but not re-editable through the Events section's row UI (documented there). "Focus Glow" is
// the one exception — it's not an animation at all, just a direct focused-state style write using
// the existing per-state style mechanism, since glow isn't one of `.animate()`'s tweenable keys.
const ANIMATION_PRESETS: AnimationPresetDef[] = [
  { label: 'Fade', title: 'Fade toward 30% opacity on click', configLiteral: () => '{ opacity: 30, duration: 250, easing: "easeOut" }' },
  { label: 'Zoom', title: 'Scale up to 120% with a slight overshoot on click', configLiteral: () => '{ scale: 1.2, duration: 220, easing: "overshoot" }' },
  { label: 'Pulse', title: 'Shrink to 90% and back — click twice to see the pulse', configLiteral: () => '{ scale: 0.9, duration: 150, easing: "easeInOut" }' },
  {
    label: 'Slide',
    title: 'Slide 24px to the right on click',
    configLiteral: (w) => `{ x: ${Math.round((typeof w.style.x === 'number' ? w.style.x : 0) + 24)}, duration: 220, easing: "easeOut" }`
  },
  {
    label: 'Press Depth',
    title: 'Nudge down 4px on click, mimicking a pressed physical button',
    configLiteral: (w) => `{ y: ${Math.round((typeof w.style.y === 'number' ? w.style.y : 0) + 4)}, duration: 100, easing: "easeOut" }`
  },
  {
    // x/y are real lv_anim_t tweens (see codegen.ts's renderAnimate), so this is the one preset
    // whose easing curve is genuinely animated on hardware, not just in the browser preview —
    // rotation/scale currently snap to their final value at export time (documented on
    // UiWidgetStyle/renderAnimate), so a "bounce" preset built around rotation would look bouncy
    // in the live preview but NOT on real hardware; a bounce-eased slide is real end-to-end.
    label: 'Bounce',
    title: 'Slide 30px right with a real LVGL bounce easing curve on click (real on both preview and hardware)',
    configLiteral: (w) => `{ x: ${Math.round((typeof w.style.x === 'number' ? w.style.x : 0) + 30)}, duration: 500, easing: "bounce" }`
  }
]

function AnimationPresetsSection({ widget }: { widget: UiWidget }) {
  const script = useStore((s) => s.project.uiDesign.script)
  const widgets = useStore((s) => s.project.uiDesign.widgets)
  const setUiScript = useStore((s) => s.setUiScript)
  const updateUiWidgetState = useStore((s) => s.updateUiWidgetState)
  const checkpoint = useStore((s) => s.checkpoint)

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-1.5">
      <span className="studio-label">Animation Presets</span>
      <div className="grid grid-cols-3 gap-1">
        {ANIMATION_PRESETS.map((p) => (
          <button
            key={p.label}
            className="studio-btn text-[10px] px-1 py-1"
            title={p.title}
            onClick={() => {
              const next = addAnimatePresetRow(script, widgets, widget.id, 'click', p.configLiteral(widget))
              if (next === null) return
              checkpoint()
              setUiScript(next)
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          className="studio-btn text-[10px] px-1 py-1"
          title="Adds a glow to this widget's Focused state (real LVGL shadow-as-glow — see the Appearance section's Glow fields)"
          onClick={() => {
            checkpoint()
            updateUiWidgetState(widget.id, 'focused', { glowColor: '#2196F3', glowRadius: 14 })
          }}
        >
          Focus Glow
        </button>
      </div>
    </div>
  )
}

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

/** One row in the List widget's item editor (see ListItemsSection) — drag-to-reorder card modeled
 * directly on ActionCard's shape above, with a compact collapsed IconPicker (only one row's picker
 * expands at a time, since IconPicker's full swatch grid is too tall to keep open per-row). */
function ListItemRow({
  item,
  invalidReason,
  varNamePreview,
  dragging,
  iconOpen,
  onToggleIcon,
  onDragStart,
  onDropOnto,
  onTextInput,
  onCommitChange,
  onDuplicate,
  onDelete
}: {
  item: UiListItem
  invalidReason: string | null
  varNamePreview: string
  dragging: boolean
  iconOpen: boolean
  onToggleIcon: () => void
  onDragStart: () => void
  onDropOnto: () => void
  onTextInput: (partial: Partial<UiListItem>) => void
  onCommitChange: (partial: Partial<UiListItem>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const glyph = item.iconSymbol ? LVGL_SYMBOLS.find((s) => s.id === item.iconSymbol)?.glyph : null

  return (
    <div
      className={`bg-studio-panel border rounded p-1.5 flex flex-col gap-1.5 ${dragging ? 'opacity-40' : ''} ${
        invalidReason ? 'border-studio-danger' : 'border-studio-border2'
      }`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnto()
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-studio-muted cursor-grab select-none text-xs" title="Drag to reorder">
          ⠿
        </span>
        <button
          type="button"
          title="Icon"
          className={`w-6 h-6 shrink-0 flex items-center justify-center rounded border text-sm leading-none ${
            iconOpen ? 'border-studio-accent bg-studio-accent/15' : 'border-studio-border bg-studio-panel2 text-studio-muted'
          }`}
          onClick={onToggleIcon}
        >
          {glyph ?? '—'}
        </button>
        <input
          className="flex-1 min-w-0 bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs"
          placeholder="Item text"
          value={item.text}
          onChange={(e) => onTextInput({ text: e.target.value })}
        />
        <button className="text-[11px] text-studio-muted hover:text-studio-text" title="Duplicate item" onClick={onDuplicate}>
          ⧉
        </button>
        <button className="text-[11px] text-studio-muted hover:text-red-400" title="Delete item" onClick={onDelete}>
          ✕
        </button>
      </div>

      {iconOpen && <IconPicker value={item.iconSymbol} onSelect={(symbolId) => onCommitChange({ iconSymbol: symbolId })} />}

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Widget ID</span>
        <input
          className={`bg-studio-panel2 border rounded px-1.5 py-0.5 text-xs font-mono ${invalidReason ? 'border-studio-danger' : 'border-studio-border'}`}
          value={item.widgetId}
          onChange={(e) => onTextInput({ widgetId: e.target.value })}
        />
        {invalidReason ? (
          <span className="text-[10px] text-studio-danger">{invalidReason}</span>
        ) : (
          <span className="text-[10px] text-studio-muted font-mono">→ {varNamePreview}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={item.clickEventEnabled} onChange={(e) => onCommitChange({ clickEventEnabled: e.target.checked })} />
          <span className="studio-label">Click event</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={item.encoderFocusEnabled} onChange={(e) => onCommitChange({ encoderFocusEnabled: e.target.checked })} />
          <span className="studio-label">Encoder focus</span>
        </label>
      </div>
    </div>
  )
}

/** List widget item editor — add/edit/delete/duplicate/reorder rows, each backed directly by the
 * addUiListItem/updateUiListItem/deleteUiListItem/duplicateUiListItem/reorderUiListItem store
 * actions (store.ts). Every change writes straight to the store (no "Apply" step), so the canvas
 * preview (WidgetRenderer.tsx's 'list' case) and the always-visible LVGL Code panel update live. */
function ListItemsSection({ widget }: { widget: UiWidget }) {
  const checkpoint = useStore((s) => s.checkpoint)
  const addUiListItem = useStore((s) => s.addUiListItem)
  const updateUiListItem = useStore((s) => s.updateUiListItem)
  const deleteUiListItem = useStore((s) => s.deleteUiListItem)
  const duplicateUiListItem = useStore((s) => s.duplicateUiListItem)
  const reorderUiListItem = useStore((s) => s.reorderUiListItem)
  const allWidgets = useStore((s) => s.project.uiDesign.widgets)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [iconOpenFor, setIconOpenFor] = useState<string | null>(null)

  const items = widget.listItems ?? []

  const otherIdentifiers = useMemo(() => {
    const set = new Set<string>()
    for (const w of Object.values(allWidgets)) {
      if (w.id !== widget.id && w.tagId) set.add(w.tagId)
    }
    return set
  }, [allWidgets, widget.id])

  return (
    <div className="flex flex-col gap-2 border-t border-studio-border pt-2.5">
      <div className="flex items-center justify-between">
        <span className="studio-label">List Items</span>
        <button
          className="text-[11px] text-studio-accent hover:text-studio-text"
          onClick={() => {
            checkpoint()
            addUiListItem(widget.id)
          }}
        >
          + Add Item
        </button>
      </div>

      {items.length === 0 && <p className="text-[11px] text-studio-muted">No items yet — click "+ Add Item" to add one.</p>}

      <div className="flex flex-col gap-1.5">
        {items.map((item, index) => {
          const trimmedId = item.widgetId.trim()
          const dupInList = items.filter((it) => it.widgetId === item.widgetId).length > 1
          let invalidReason: string | null = null
          if (trimmedId === '') invalidReason = 'Widget ID is required'
          else if (dupInList) invalidReason = 'Duplicate widget ID within this list'
          else if (otherIdentifiers.has(trimmedId)) invalidReason = 'Widget ID collides with another widget'
          else if (item.text.trim() === '') invalidReason = 'Item text is required'

          return (
            <ListItemRow
              key={item.id}
              item={item}
              invalidReason={invalidReason}
              varNamePreview={`${toCIdentifier(trimmedId || 'item')}_item`}
              dragging={dragIndex === index}
              iconOpen={iconOpenFor === item.id}
              onToggleIcon={() => setIconOpenFor(iconOpenFor === item.id ? null : item.id)}
              onDragStart={() => setDragIndex(index)}
              onDropOnto={() => {
                if (dragIndex !== null && dragIndex !== index) {
                  checkpoint()
                  reorderUiListItem(widget.id, dragIndex, index)
                }
                setDragIndex(null)
              }}
              onTextInput={(partial) => updateUiListItem(widget.id, item.id, partial)}
              onCommitChange={(partial) => {
                checkpoint()
                updateUiListItem(widget.id, item.id, partial)
              }}
              onDuplicate={() => {
                checkpoint()
                duplicateUiListItem(widget.id, item.id)
              }}
              onDelete={() => {
                checkpoint()
                deleteUiListItem(widget.id, item.id)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** One row in a Keyboard widget's custom-layout editor — same drag-reorder card shape as
 * ListItemRow above, simpler fields (no icon/validation — any label/insertText is valid for a
 * hand-authored layout). `newRow` starts a fresh row on the keyboard (see UiKeyboardCustomLayout's
 * doc comment for why the layout is stored as one flat, `newRow`-flagged list). */
function KeyboardCustomKeyRow({
  keyItem,
  dragging,
  onDragStart,
  onDropOnto,
  onChange,
  onCommitChange,
  onDelete
}: {
  keyItem: UiKeyboardCustomKey
  dragging: boolean
  onDragStart: () => void
  onDropOnto: () => void
  onChange: (partial: Partial<UiKeyboardCustomKey>) => void
  onCommitChange: (partial: Partial<UiKeyboardCustomKey>) => void
  onDelete: () => void
}) {
  return (
    <div
      className={`bg-studio-panel border border-studio-border2 rounded p-1.5 flex items-center gap-1.5 ${dragging ? 'opacity-40' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnto()
      }}
    >
      <span className="text-studio-muted cursor-grab select-none text-xs" title="Drag to reorder">
        ⠿
      </span>
      <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="Start a new row on the keyboard before this key">
        <input type="checkbox" checked={Boolean(keyItem.newRow)} onChange={(e) => onCommitChange({ newRow: e.target.checked })} />
        <span className="text-[10px] text-studio-muted">New row</span>
      </label>
      <input
        className="w-16 bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs"
        placeholder="Label"
        value={keyItem.label}
        onChange={(e) => onChange({ label: e.target.value })}
      />
      <input
        className="flex-1 min-w-0 bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono"
        placeholder="Inserts..."
        value={keyItem.insertText}
        onChange={(e) => onChange({ insertText: e.target.value })}
      />
      <button className="text-[11px] text-studio-muted hover:text-red-400 shrink-0" title="Delete key" onClick={onDelete}>
        ✕
      </button>
    </div>
  )
}

/** Keyboard widget's custom-layout editor — only rendered when `keyboardConfig.language ===
 * 'custom'`. Each row is one key; add/delete/reorder mirror ListItemsSection's own actions. */
function KeyboardCustomLayoutEditor({ widget }: { widget: UiWidget }) {
  const checkpoint = useStore((s) => s.checkpoint)
  const addUiKeyboardCustomKey = useStore((s) => s.addUiKeyboardCustomKey)
  const updateUiKeyboardCustomKey = useStore((s) => s.updateUiKeyboardCustomKey)
  const deleteUiKeyboardCustomKey = useStore((s) => s.deleteUiKeyboardCustomKey)
  const reorderUiKeyboardCustomKey = useStore((s) => s.reorderUiKeyboardCustomKey)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const keys = widget.keyboardConfig?.customLayout?.keys ?? []

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="studio-label">Custom Layout Keys</span>
        <button
          className="text-[11px] text-studio-accent hover:text-studio-text"
          onClick={() => {
            checkpoint()
            addUiKeyboardCustomKey(widget.id)
          }}
        >
          + Add Key
        </button>
      </div>
      {keys.length === 0 && <p className="text-[11px] text-studio-muted">No keys yet — click "+ Add Key" to add one.</p>}
      <div className="flex flex-col gap-1">
        {keys.map((k, index) => (
          <KeyboardCustomKeyRow
            key={k.id}
            keyItem={k}
            dragging={dragIndex === index}
            onDragStart={() => setDragIndex(index)}
            onDropOnto={() => {
              if (dragIndex !== null && dragIndex !== index) {
                checkpoint()
                reorderUiKeyboardCustomKey(widget.id, dragIndex, index)
              }
              setDragIndex(null)
            }}
            onChange={(partial) => updateUiKeyboardCustomKey(widget.id, k.id, partial)}
            onCommitChange={(partial) => {
              checkpoint()
              updateUiKeyboardCustomKey(widget.id, k.id, partial)
            }}
            onDelete={() => {
              checkpoint()
              deleteUiKeyboardCustomKey(widget.id, k.id)
            }}
          />
        ))}
      </div>
      <p className="text-[11px] text-studio-muted">Backspace/Enter/Close keys are always added automatically after your own keys.</p>
    </div>
  )
}

/** Font picker + import, shown inside KeyboardSection — one font selection per keyboard, applied
 * (at export time — see lvglExport.ts) to both the keyboard's own key labels and its linked
 * output textarea, so "Danish text displays correctly" covers both places with one setting. This
 * app does no font rasterization of its own (see fontImport.ts's file-top comment) — the user
 * pastes/uploads a `.c` file already produced by LVGL's own official font converter. */
function KeyboardFontPicker({ widget }: { widget: UiWidget }) {
  const customFonts = useStore((s) => s.project.uiDesign.customFonts)
  const addUiCustomFont = useStore((s) => s.addUiCustomFont)
  const deleteUiCustomFont = useStore((s) => s.deleteUiCustomFont)
  const updateUiKeyboardConfig = useStore((s) => s.updateUiKeyboardConfig)
  const checkpoint = useStore((s) => s.checkpoint)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const config = widget.keyboardConfig
  if (!config) return null

  const selectedFont = customFonts.find((f) => f.id === config.customFontId) ?? null
  const missing = selectedFont ? missingDanishCodepoints(selectedFont.declaredCodepoints) : []

  const importFile = async (file: File) => {
    const text = await file.text()
    checkpoint()
    const id = addUiCustomFont(file.name.replace(/\.c$/i, ''), text)
    updateUiKeyboardConfig(widget.id, { customFontId: id })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="studio-label">Custom Font (for Danish glyphs)</span>
      <div className="flex items-center gap-1.5">
        <select
          className="flex-1 min-w-0 bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs"
          value={config.customFontId ?? ''}
          onChange={(e) => {
            checkpoint()
            updateUiKeyboardConfig(widget.id, { customFontId: e.target.value || null })
          }}
        >
          <option value="">(default — LVGL Montserrat, no æøå)</option>
          {customFonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button className="text-[11px] text-studio-accent hover:text-studio-text shrink-0" onClick={() => fileInputRef.current?.click()}>
          Import .c...
        </button>
        {selectedFont && (
          <button
            className="text-[11px] text-studio-muted hover:text-red-400 shrink-0"
            title="Delete this font"
            onClick={() => {
              checkpoint()
              deleteUiCustomFont(selectedFont.id)
            }}
          >
            ✕
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".c,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importFile(file)
          e.target.value = ''
        }}
      />
      <p className="text-[11px] text-studio-muted">
        Convert a font at{' '}
        <a href="https://lvgl.io/tools/fontconverter" target="_blank" rel="noreferrer" className="underline">
          lvgl.io/tools/fontconverter
        </a>{' '}
        (include æ ø å Æ Ø Å in the character list) and import the generated .c file here.
      </p>
      {config.language === 'danish' && config.danishCharsEnabled && (
        <>
          {!selectedFont && <p className="text-[11px] text-studio-danger">⚠ No custom font selected — æ/ø/å will render as missing-glyph boxes on real hardware.</p>}
          {selectedFont && missing.length > 0 && (
            <p className="text-[11px] text-studio-danger">⚠ "{selectedFont.name}" is missing: {missing.join(' ')}</p>
          )}
          {selectedFont && missing.length === 0 && <p className="text-[11px] text-green-500">✓ "{selectedFont.name}" covers æ ø å Æ Ø Å.</p>}
        </>
      )}
    </div>
  )
}

const SELECT_CLS = 'bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-full'

function TypeToggle({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-9 h-8 rounded border text-sm ${active ? 'border-studio-accent text-studio-accent bg-studio-accent/10' : 'border-studio-border text-studio-muted bg-studio-panel2'}`}
    >
      {children}
    </button>
  )
}

/** CSS-like Typography controls for text-based widgets (see UI_TEXT_STYLE_WIDGETS). State-aware —
 * `appearance`/`setAppearance` already point at the default style or the hover/pressed/... state
 * being edited. All fields preview live on the canvas; the LVGL export maps them where LVGL can
 * (see lib/export/lvglExport.ts), with weight/italic/justify preview-only and word-wrap/overflow/
 * transform exported for `label` widgets. */
function TypographySection({
  widget,
  appearance,
  setAppearance,
  stateTab
}: {
  widget: UiWidget
  appearance: Partial<UiWidgetStyle>
  setAppearance: (partial: Partial<UiWidgetStyle>) => void
  stateTab: 'default' | UiWidgetStateName
}) {
  const customFonts = useStore((s) => s.project.uiDesign.customFonts)
  const addUiCustomFont = useStore((s) => s.addUiCustomFont)
  const setUiWidgetThemeToken = useStore((s) => s.setUiWidgetThemeToken)
  const checkpoint = useStore((s) => s.checkpoint)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importFile = async (file: File) => {
    const text = await file.text()
    checkpoint()
    const id = addUiCustomFont(file.name.replace(/\.c$/i, ''), text)
    setAppearance({ fontId: id })
  }

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-2">
      <span className="text-xs font-medium text-studio-text/80">Typography</span>

      <div className="flex flex-col gap-1">
        <span className="studio-label">Font Family</span>
        <div className="flex items-center gap-1.5">
          <select
            className={`${SELECT_CLS} flex-1 min-w-0`}
            value={appearance.fontId ?? ''}
            onChange={(e) => setAppearance({ fontId: e.target.value || undefined })}
          >
            <option value="">Montserrat (built-in)</option>
            {customFonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="text-[11px] text-studio-accent hover:text-studio-text shrink-0" onClick={() => fileInputRef.current?.click()}>
            Import .c…
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".c,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importFile(file)
            e.target.value = ''
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Font Size" value={appearance.fontSize ?? 14} onChange={(v) => setAppearance({ fontSize: v })} />
        <div className="flex flex-col gap-1">
          <span className="studio-label">Font Weight</span>
          <select className={SELECT_CLS} value={appearance.fontWeight === 'normal' ? 'regular' : appearance.fontWeight ?? 'regular'} onChange={(e) => setAppearance({ fontWeight: e.target.value as UiWidgetStyle['fontWeight'] })}>
            <option value="thin">Thin</option>
            <option value="light">Light</option>
            <option value="regular">Regular</option>
            <option value="medium">Medium</option>
            <option value="semibold">SemiBold</option>
            <option value="bold">Bold</option>
            <option value="extrabold">ExtraBold</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="studio-label">Style</span>
        <div className="flex gap-1.5">
          <TypeToggle active={appearance.fontStyle === 'italic'} onClick={() => setAppearance({ fontStyle: appearance.fontStyle === 'italic' ? 'normal' : 'italic' })} title="Italic">
            <span className="italic">I</span>
          </TypeToggle>
          <TypeToggle active={!!appearance.underline} onClick={() => setAppearance({ underline: !appearance.underline })} title="Underline">
            <span className="underline">U</span>
          </TypeToggle>
          <TypeToggle active={!!appearance.strikethrough} onClick={() => setAppearance({ strikethrough: !appearance.strikethrough })} title="Strikethrough">
            <span className="line-through">S</span>
          </TypeToggle>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Letter Spacing" value={appearance.letterSpacing ?? 0} onChange={(v) => setAppearance({ letterSpacing: v })} />
        <NumberField label="Line Height" value={appearance.lineHeight ?? 0} onChange={(v) => setAppearance({ lineHeight: v })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="studio-label">Text Align</span>
          <select className={SELECT_CLS} value={appearance.textAlign ?? 'left'} onChange={(e) => setAppearance({ textAlign: e.target.value as UiWidgetStyle['textAlign'] })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="studio-label">Text Transform</span>
          <select className={SELECT_CLS} value={appearance.textTransform ?? 'none'} onChange={(e) => setAppearance({ textTransform: e.target.value as UiWidgetStyle['textTransform'] })}>
            <option value="none">None</option>
            <option value="uppercase">Uppercase</option>
            <option value="lowercase">Lowercase</option>
            <option value="capitalize">Capitalize</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ColorField
          label="Text Color"
          value={appearance.color ?? ''}
          onChange={(v) => setAppearance({ color: v })}
          themeToken={stateTab === 'default' ? widget.themeTokens?.color : undefined}
          onThemeTokenChange={stateTab === 'default' ? (t) => setUiWidgetThemeToken(widget.id, 'color', t) : undefined}
        />
        <NumberField label="Text Opacity %" value={appearance.textOpacity ?? 100} onChange={(v) => setAppearance({ textOpacity: v })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="studio-label">Word Wrap</span>
          <select className={SELECT_CLS} value={appearance.wordWrap === false ? 'nowrap' : 'wrap'} onChange={(e) => setAppearance({ wordWrap: e.target.value === 'wrap' })}>
            <option value="wrap">Wrap</option>
            <option value="nowrap">No wrap</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="studio-label">Text Overflow</span>
          <select className={SELECT_CLS} value={appearance.textOverflow ?? 'clip'} onChange={(e) => setAppearance({ textOverflow: e.target.value as UiWidgetStyle['textOverflow'] })}>
            <option value="clip">Clip</option>
            <option value="ellipsis">Ellipsis</option>
            <option value="scroll">Scroll</option>
          </select>
        </div>
      </div>

      <NumberField
        label="Padding"
        value={appearance.paddingTop ?? 0}
        onChange={(v) => setAppearance({ paddingTop: v, paddingRight: v, paddingBottom: v, paddingLeft: v })}
      />

      {widget.type !== 'label' && (
        <p className="text-[11px] text-studio-muted">
          Word Wrap, Text Overflow &amp; Text Transform preview here but export to firmware for Label widgets only. Font Weight/Italic
          need an imported custom font to reach firmware (built-in Montserrat has no variants).
        </p>
      )}
    </div>
  )
}

const KEYBOARD_LANGUAGES: { value: NonNullable<UiWidget['keyboardConfig']>['language']; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'danish', label: 'Danish' },
  { value: 'custom', label: 'Custom' }
]

const KEYBOARD_SHAPES: { value: NonNullable<UiWidget['keyboardConfig']>['shape']; label: string; hint: string }[] = [
  { value: 'rectangular', label: 'Rectangular', hint: "Today's plain full-width rows, regardless of display shape." },
  { value: 'adaptive', label: 'Adaptive', hint: 'Automatically curves rows to fit a round display; no change on a square/rectangular one.' },
  { value: 'round', label: 'Round', hint: 'Always applies the round-display curving, even on a non-round display.' },
  { value: 'custom', label: 'Custom', hint: 'Uses the fixed padding values below instead of automatic curving.' }
]

/** A reasonable starting point for the Custom-shape padding fields, derived from the project's own
 * display size — deliberately only ever applied via the explicit "Use suggested values" button
 * below (see keyboardConfig.edgePadding.autoEdgeCompensation's own doc comment), never silently,
 * matching DisplaySettingsPanel.tsx's own orientation-swap-button precedent for "a computed
 * suggestion the user explicitly opts into," not a live-recomputing magic default. */
function suggestedKeyboardEdgePadding(display: { width: number; height: number }): NonNullable<UiWidget['keyboardConfig']>['edgePadding'] {
  const margin = Math.max(2, Math.round(Math.min(display.width, display.height) * 0.025))
  return { leftCurve: margin * 2, rightCurve: margin * 2, top: margin, bottom: margin, safeAreaMargin: margin, autoEdgeCompensation: true }
}

/** Full Keyboard widget properties — General/Language/Alt Characters/Interaction/Debug Panel
 * groups, matching the spec's own section grouping. Every field writes straight to
 * keyboardConfig via updateUiKeyboardConfig (no "Apply" step), same live-update convention as
 * every other Properties panel field in this file. */
function KeyboardSection({ widget }: { widget: UiWidget }) {
  const allWidgets = useStore((s) => s.project.uiDesign.widgets)
  const display = useStore((s) => s.project.uiDesign.display)
  const updateUiKeyboardConfig = useStore((s) => s.updateUiKeyboardConfig)
  const checkpoint = useStore((s) => s.checkpoint)

  const config = widget.keyboardConfig
  if (!config) return null

  const set = (partial: Partial<typeof config>) => {
    checkpoint()
    updateUiKeyboardConfig(widget.id, partial)
  }

  const otherTextareas = Object.values(allWidgets).filter((w) => w.type === 'textarea')
  const otherLabels = Object.values(allWidgets).filter((w) => w.type === 'label')

  return (
    <div className="flex flex-col gap-3 border-t border-studio-border pt-2.5">
      <span className="studio-label">Keyboard</span>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">General</span>
        <input
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
          placeholder="Keyboard title"
          value={config.title}
          onChange={(e) => updateUiKeyboardConfig(widget.id, { title: e.target.value })}
          onBlur={() => checkpoint()}
        />
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-studio-muted">Target Text Area</span>
            <select
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs"
              value={config.targetTextareaId ?? ''}
              onChange={(e) => set({ targetTextareaId: e.target.value || null })}
            >
              <option value="">(none)</option>
              {otherTextareas.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.tagId ?? w.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-studio-muted">Debug Label</span>
            <select
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs"
              value={config.debugLabelId ?? ''}
              onChange={(e) => set({ debugLabelId: e.target.value || null })}
            >
              <option value="">(none)</option>
              {otherLabels.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.tagId ?? w.id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.autoOpen} onChange={(e) => set({ autoOpen: e.target.checked })} />
            Auto-open
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.autoCloseOnSubmit} onChange={(e) => set({ autoCloseOnSubmit: e.target.checked })} />
            Auto-close on submit
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-2">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Language</span>
        <div className="flex bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {KEYBOARD_LANGUAGES.map((l) => (
            <button
              key={l.value}
              className={`flex-1 text-xs py-1 rounded ${config.language === l.value ? 'bg-studio-accent/20 text-studio-accent' : 'text-studio-muted'}`}
              onClick={() => set({ language: l.value, danishCharsEnabled: l.value === 'danish' ? true : config.danishCharsEnabled })}
            >
              {l.label}
            </button>
          ))}
        </div>
        {config.language !== 'custom' && (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.showLanguageSwitchKey} onChange={(e) => set({ showLanguageSwitchKey: e.target.checked })} />
            Show language-switch key
          </label>
        )}
        {config.language === 'danish' && (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.danishCharsEnabled} onChange={(e) => set({ danishCharsEnabled: e.target.checked })} />
            Danish characters (æ ø å) enabled
          </label>
        )}
        {config.language === 'custom' && <KeyboardCustomLayoutEditor widget={widget} />}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-2">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Keyboard Shape</span>
        <div className="grid grid-cols-2 gap-1 bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {KEYBOARD_SHAPES.map((s) => (
            <button
              key={s.value}
              title={s.hint}
              className={`text-xs py-1 rounded ${config.shape === s.value ? 'bg-studio-accent/20 text-studio-accent' : 'text-studio-muted'}`}
              onClick={() => set({ shape: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-studio-muted">{KEYBOARD_SHAPES.find((s) => s.value === config.shape)?.hint}</p>
        {config.shape === 'custom' && (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Left Curve Padding" value={config.edgePadding.leftCurve} onChange={(v) => set({ edgePadding: { ...config.edgePadding, leftCurve: v } })} />
              <NumberField label="Right Curve Padding" value={config.edgePadding.rightCurve} onChange={(v) => set({ edgePadding: { ...config.edgePadding, rightCurve: v } })} />
              <NumberField label="Top Padding" value={config.edgePadding.top} onChange={(v) => set({ edgePadding: { ...config.edgePadding, top: v } })} />
              <NumberField label="Bottom Padding" value={config.edgePadding.bottom} onChange={(v) => set({ edgePadding: { ...config.edgePadding, bottom: v } })} />
            </div>
            <NumberField label="Safe-Area Margin" value={config.edgePadding.safeAreaMargin} onChange={(v) => set({ edgePadding: { ...config.edgePadding, safeAreaMargin: v } })} />
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={config.edgePadding.autoEdgeCompensation}
                onChange={(e) => set({ edgePadding: { ...config.edgePadding, autoEdgeCompensation: e.target.checked } })}
              />
              Automatic edge compensation
            </label>
            <button
              className="self-start text-xs px-2 py-1 rounded border border-studio-border text-studio-muted hover:text-studio-accent hover:border-studio-accent"
              onClick={() => set({ edgePadding: suggestedKeyboardEdgePadding(display) })}
            >
              Use suggested values
            </button>
          </div>
        )}
        {(config.shape === 'round' || (config.shape === 'adaptive' && display.shape === 'round')) && (
          <p className="text-[11px] text-studio-muted">Rows automatically indent to fit the round display — no manual padding needed.</p>
        )}
      </div>

      {config.language !== 'custom' && (
        <div className="flex flex-col gap-1.5 border-t border-studio-border pt-2">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Alternate Characters</span>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.altCharsEnabled} onChange={(e) => set({ altCharsEnabled: e.target.checked })} />
            Long-press for accented variants
          </label>
          {config.altCharsEnabled && (
            <p className="text-[11px] text-studio-muted">
              {(config.customAltChars ?? DEFAULT_ALT_CHARS).map((a) => `${a.base}→${a.variants.join('')}`).join('  ')}
            </p>
          )}
        </div>
      )}

      <div className="border-t border-studio-border pt-2">
        <KeyboardFontPicker widget={widget} />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-2">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Interaction</span>
        <div className="grid grid-cols-2 gap-1">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.encoderEnabled} onChange={(e) => set({ encoderEnabled: e.target.checked })} />
            Encoder enabled
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.wrapNavigation} onChange={(e) => set({ wrapNavigation: e.target.checked })} />
            Wrap navigation
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input type="checkbox" checked={config.repeatBackspace} onChange={(e) => set({ repeatBackspace: e.target.checked })} />
            Repeat backspace
          </label>
        </div>
        <NumberField label="Repeat Delay (ms)" value={config.repeatDelayMs} onChange={(v) => set({ repeatDelayMs: v })} />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={config.showEventInfo} onChange={(e) => set({ showEventInfo: e.target.checked })} />
          <span className="studio-label">Show Event Info (debug panel)</span>
        </label>
        {config.showEventInfo && (
          <div className="grid grid-cols-2 gap-1 pl-1">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={config.showSelectedCharacter} onChange={(e) => set({ showSelectedCharacter: e.target.checked })} />
              Selected character
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={config.showCursorPosition} onChange={(e) => set({ showCursorPosition: e.target.checked })} />
              Cursor position
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={config.showCallbackName} onChange={(e) => set({ showCallbackName: e.target.checked })} />
              Callback name
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={config.showCurrentAction} onChange={(e) => set({ showCurrentAction: e.target.checked })} />
              Current action
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

/** Extended textarea fields (multiline/password/read-only/max-length/cursor+selection color) —
 * genuinely useful on any 'textarea' widget, not just ones linked to a keyboard. Written via the
 * existing generic updateUiWidgetProps (see UiWidget.props' own doc comment for this convention). */
function TextareaOutputSection({ widget }: { widget: UiWidget }) {
  const updateUiWidgetProps = useStore((s) => s.updateUiWidgetProps)
  const checkpoint = useStore((s) => s.checkpoint)

  const set = (partial: Record<string, string | number | boolean>) => {
    checkpoint()
    updateUiWidgetProps(widget.id, partial)
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-studio-border pt-2.5">
      <span className="studio-label">Text Area</span>
      <div className="grid grid-cols-2 gap-1">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
          <input type="checkbox" checked={Boolean(widget.props.multiline)} onChange={(e) => set({ multiline: e.target.checked })} />
          Multi-line
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
          <input type="checkbox" checked={Boolean(widget.props.passwordMode)} onChange={(e) => set({ passwordMode: e.target.checked })} />
          Password mode
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
          <input type="checkbox" checked={Boolean(widget.props.readOnly)} onChange={(e) => set({ readOnly: e.target.checked })} />
          Read-only
        </label>
      </div>
      <NumberField
        label="Max Length (0 = unlimited)"
        value={typeof widget.props.maxLength === 'number' ? widget.props.maxLength : 0}
        onChange={(v) => set({ maxLength: Math.max(0, v) })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">Cursor Color</span>
          <input
            type="color"
            className="w-full h-7 bg-studio-panel2 border border-studio-border rounded"
            value={typeof widget.props.cursorColor === 'string' ? widget.props.cursorColor : '#2196f3'}
            onChange={(e) => set({ cursorColor: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">Selection Color</span>
          <input
            type="color"
            className="w-full h-7 bg-studio-panel2 border border-studio-border rounded"
            value={typeof widget.props.selectionColor === 'string' ? widget.props.selectionColor : '#2196f3'}
            onChange={(e) => set({ selectionColor: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

/** True when `widgetId` is anywhere inside a `dataList` widget's item-template subtree (a
 * descendant, at any depth, of a Data List's own childIds) — gates the "Visible when" field below,
 * which only means something for a widget that gets re-evaluated once per repeated row. */
function isDataListTemplateDescendant(widgets: Record<string, UiWidget>, widgetId: string): boolean {
  let current = widgets[widgetId]
  while (current?.parentId) {
    const parent = widgets[current.parentId]
    if (!parent) return false
    if (parent.type === 'dataList') return true
    current = parent
  }
  return false
}

/** The data source id bound to the nearest `dataList` ancestor, or null when `widgetId` isn't a
 * template descendant at all (or its list has no source picked yet) — powers TemplateTextField's
 * "Insert field" buttons below, so any widget anywhere in a template (not just an auto-scaffolded
 * one) can bind to any field, and the button list updates live if the source's own field list
 * changes later (this is read fresh on every render, never cached). */
function dataListAncestorDataSourceId(widgets: Record<string, UiWidget>, widgetId: string): string | null {
  let current = widgets[widgetId]
  while (current?.parentId) {
    const parent = widgets[current.parentId]
    if (!parent) return null
    if (parent.type === 'dataList') return parent.dataListConfig?.dataSourceId ?? null
    current = parent
  }
  return null
}

/** A widget's Text field, with a small "Insert field" button row underneath when it's part of a
 * Data List item template — one single Text field can freely combine any number of `{{field}}`
 * placeholders (e.g. "{{name}} — {{age}}"), so there's no need for a separate widget per field.
 * Clicking a button splices `{{fieldName}}` in at the current cursor position (or appends, when
 * nothing's focused yet) rather than always appending to the end. */
function TemplateTextField({ widget, allWidgets }: { widget: UiWidget; allWidgets: Record<string, UiWidget> }) {
  const dataSources = useStore((s) => s.project.uiDesign.dataSources)
  const updateUiWidgetText = useStore((s) => s.updateUiWidgetText)
  const inputRef = useRef<HTMLInputElement>(null)
  const dataSourceId = dataListAncestorDataSourceId(allWidgets, widget.id)
  const source = dataSourceId ? dataSources.find((d) => d.id === dataSourceId) : undefined

  const insertPlaceholder = (fieldName: string) => {
    const el = inputRef.current
    const placeholder = `{{${fieldName}}}`
    const text = widget.text ?? ''
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    updateUiWidgetText(widget.id, text.slice(0, start) + placeholder + text.slice(end))
    requestAnimationFrame(() => {
      const pos = start + placeholder.length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">Text</span>
      <input
        ref={inputRef}
        className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
        value={widget.text ?? ''}
        onChange={(e) => updateUiWidgetText(widget.id, e.target.value)}
      />
      {source && (
        <div className="flex flex-col gap-1 mt-0.5">
          {source.fields.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-studio-muted w-full">Insert field:</span>
              {source.fields.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-studio-panel2 border border-studio-border hover:border-blue-400"
                  onClick={() => insertPlaceholder(f.name)}
                  title={`Insert {{${f.name}}} at the cursor`}
                >
                  {`{{${f.name}}}`}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-studio-muted">"{source.name}" has no fields yet — add some in the Data Sources tab.</span>
          )}
        </div>
      )}
    </div>
  )
}

/** Data source picker + config for a `dataList` widget — this is how a Data Source Manager entry
 * actually gets "applied" to a specific Data List on the canvas (a Data Source is reusable/
 * many-to-many, so the binding lives here, on the widget that consumes it, not on the source
 * itself). See WidgetRenderer.tsx's DataListRepeatedRows for how this immediately drives the live
 * preview once picked, and lib/export/lvglExport.ts's Data List codegen for how it drives export. */
const INDICATOR_EASING_OPTIONS: { value: UiIndicatorEasing; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In/Out' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'overshoot', label: 'Overshoot' }
]

function indicatorNumProp(widget: UiWidget, key: string, fallback: number): number {
  const v = widget.props[key]
  return typeof v === 'number' ? v : fallback
}

/** Progress Bar/Slider/Gauge/Arc/Spinner config — Min/Max/Value/Step + the Animation Controls
 * (enable/duration/easing/loop/reverse/delay/auto-play) that drive both the live canvas preview's
 * CSS transition (see indicatorEasing.ts) and the exported C++'s hand-rolled lv_anim_t (see
 * lvglExport.ts's emitIndicatorAnimStart) — the same fields, read by both, so preview and export
 * can never disagree about how a value change animates. The "Function name" field is the
 * `set<Base>Value`/`animate<Base>`/etc. base name exported functions use (see
 * indicatorFunctionBaseName) — left blank, it auto-derives from this widget's own ID, shown live
 * as the input's placeholder so the field is never a mystery. Spinner has no real LVGL `value`
 * concept (see INDICATOR_VALUE_WIDGET_TYPES in lvglExport.ts) so it only gets Duration/Angle. */
function IndicatorSection({ widget }: { widget: UiWidget }) {
  const updateUiWidgetProps = useStore((s) => s.updateUiWidgetProps)
  const checkpoint = useStore((s) => s.checkpoint)
  // Screen-prefixed exactly like the real export (see lvglExport.ts's indicatorScreenFunctionPrefix)
  // — the widget being edited is always on the active screen, so that's the one whose prefix this
  // preview text shows; falls back to no prefix if somehow unresolved (e.g. mid-screen-delete).
  const activeScreenName = useStore((s) => s.project.uiDesign.screens.find((sc) => sc.id === s.project.uiDesign.activeScreenId)?.name ?? '')
  if (!isIndicatorWidget(widget.type)) return null
  const isSpinner = widget.type === 'spinner'

  const set = (partial: Record<string, string | number | boolean>) => {
    checkpoint()
    updateUiWidgetProps(widget.id, partial)
  }

  const animEnabled = Boolean(widget.props.animEnabled)
  const defaultBase = indicatorFunctionBaseName({ ...widget, props: { ...widget.props, functionName: '' } })
  const fnPrefix = activeScreenName ? indicatorScreenFunctionPrefix(activeScreenName) : ''

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-2">
      <span className="studio-label">Indicator</span>

      {!isSpinner && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Min" value={indicatorNumProp(widget, 'min', 0)} onChange={(v) => set({ min: v })} />
            <NumberField label="Max" value={indicatorNumProp(widget, 'max', 100)} onChange={(v) => set({ max: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Value" value={indicatorNumProp(widget, 'value', 0)} onChange={(v) => set({ value: v })} />
            <div className="flex flex-col gap-1">
              <span className="studio-label" title="0 = continuous (no snapping)">
                Step
              </span>
              <input
                type="number"
                min={0}
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm w-full"
                value={Math.round(indicatorNumProp(widget, 'step', 0))}
                onChange={(e) => set({ step: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={animEnabled} onChange={(e) => set({ animEnabled: e.target.checked })} />
        {isSpinner ? 'Spinning' : 'Animate value changes'}
      </label>

      {isSpinner ? (
        animEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Duration (ms)" value={indicatorNumProp(widget, 'spinDurationMs', 1000)} onChange={(v) => set({ spinDurationMs: Math.max(1, v) })} />
            <NumberField label="Angle" value={indicatorNumProp(widget, 'spinAngle', 60)} onChange={(v) => set({ spinAngle: Math.max(1, v) })} />
          </div>
        )
      ) : (
        <>
          {animEnabled && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Duration (ms)" value={indicatorNumProp(widget, 'animDurationMs', 300)} onChange={(v) => set({ animDurationMs: Math.max(1, v) })} />
                <div className="flex flex-col gap-1">
                  <span className="studio-label">Easing</span>
                  <select
                    className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
                    value={typeof widget.props.animEasing === 'string' ? widget.props.animEasing : 'easeOut'}
                    onChange={(e) => set({ animEasing: e.target.value })}
                  >
                    {INDICATOR_EASING_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={Boolean(widget.props.animLoop)} onChange={(e) => set({ animLoop: e.target.checked })} />
                  Loop
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={Boolean(widget.props.animReverse)} onChange={(e) => set({ animReverse: e.target.checked })} />
                  Reverse
                </label>
              </div>
              <NumberField label="Delay (ms)" value={indicatorNumProp(widget, 'animDelayMs', 0)} onChange={(v) => set({ animDelayMs: Math.max(0, v) })} />
            </>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={Boolean(widget.props.animAutoStart)} onChange={(e) => set({ animAutoStart: e.target.checked })} />
            Play automatically when the screen opens (sweeps Min → Max)
          </label>
        </>
      )}

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={Boolean(widget.props.animEventsEnabled)} onChange={(e) => set({ animEventsEnabled: e.target.checked })} />
        Animation events (OnAnimationStarted/Updated/Completed stubs in the export)
      </label>

      <div className="flex flex-col gap-1">
        <span className="studio-label">Function name</span>
        <input
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm font-mono"
          placeholder={defaultBase}
          value={typeof widget.props.functionName === 'string' ? widget.props.functionName : ''}
          onChange={(e) => set({ functionName: e.target.value })}
        />
        <span className="text-[10px] text-studio-muted">
          {isSpinner
            ? `Exports as ${fnPrefix}start${defaultBase}Animation()/${fnPrefix}stop${defaultBase}Animation()`
            : `Exports as ${fnPrefix}set${defaultBase}Value()/${fnPrefix}animate${defaultBase}To()/etc.`}
        </span>
      </div>
    </div>
  )
}

/** Options Source binding for Dropdown/Roller/Tabs — mirrors DataListSection's Data Source picker
 * below, but produces one option/tab-name LINE per row (via a single-line `{{}}` template) instead
 * of repeating a whole widget subtree. When no source is bound, the widget's own static per-line
 * list (props.options / props.tabNames) is directly editable here too — this is the only editor
 * for that static list anywhere in the app, so it needs to exist regardless of Data Source use. */
function OptionsSourceSection({ widget }: { widget: UiWidget }) {
  const dataSources = useStore((s) => s.project.uiDesign.dataSources)
  const updateUiWidgetOptionsSource = useStore((s) => s.updateUiWidgetOptionsSource)
  const updateUiWidgetProps = useStore((s) => s.updateUiWidgetProps)
  const checkpoint = useStore((s) => s.checkpoint)
  const config = widget.optionsSource
  if (!config) return null

  const set = (partial: Partial<typeof config>) => {
    checkpoint()
    updateUiWidgetOptionsSource(widget.id, partial)
  }
  const boundSource = dataSources.find((d) => d.id === config.dataSourceId)
  const staticPropKey = widget.type === 'tabs' ? 'tabNames' : 'options'
  const staticValue = String(widget.props[staticPropKey] ?? '')
  const previewLines = resolveOptionsSourceLines(widget, dataSources, undefined).slice(0, 5)
  const isTabs = widget.type === 'tabs'

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-2">
      <span className="studio-label">Options Source</span>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-studio-muted">Data source</span>
        <select
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
          value={config.dataSourceId ?? ''}
          onChange={(e) => set({ dataSourceId: e.target.value || null })}
        >
          <option value="">(none — use the static list below)</option>
          {dataSources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {config.dataSourceId && !boundSource && <span className="text-[10px] text-red-400">This data source no longer exists.</span>}
      </div>

      {!config.dataSourceId && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">{isTabs ? 'Tab names (one per line)' : 'Options (one per line)'}</span>
          <textarea
            rows={3}
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm font-mono"
            value={staticValue}
            onChange={(e) => {
              checkpoint()
              updateUiWidgetProps(widget.id, { [staticPropKey]: e.target.value })
            }}
          />
        </div>
      )}

      {config.dataSourceId && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-studio-muted">Item template ({'{{field}}'} per row)</span>
            <input
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm font-mono"
              value={config.itemTemplate}
              onChange={(e) => set({ itemTemplate: e.target.value })}
              placeholder="{{name}}"
            />
            {boundSource && boundSource.fields.length > 0 && (
              <span className="text-[10px] text-studio-muted">Fields: {boundSource.fields.map((f) => f.name).join(', ')}</span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-studio-muted">Max items</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                disabled={config.maxItems === 0}
                className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm flex-1 min-w-0 disabled:opacity-40"
                value={config.maxItems === 0 ? '' : config.maxItems}
                placeholder="Unlimited"
                onChange={(e) => set({ maxItems: Math.max(1, Number(e.target.value) || 1) })}
              />
              <label className="flex items-center gap-1 text-[10px] text-studio-muted shrink-0 cursor-pointer" title="0 = unlimited">
                <input type="checkbox" checked={config.maxItems === 0} onChange={(e) => set({ maxItems: e.target.checked ? 0 : 10 })} />∞
              </label>
            </div>
          </div>

          {isTabs ? (
            <span className="text-[10px] text-studio-muted">
              Tabs are baked from this data source's sample data at export time — LVGL's tab view has no cheap way to change tab count after
              creation, so tabs won't update live once flashed. Use Dropdown, Roller, or a Data List for content that must update at runtime.
            </span>
          ) : (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={config.includeSampleDataInExport} onChange={(e) => set({ includeSampleDataInExport: e.target.checked })} />
              Include sample data in export (otherwise starts empty until app code calls SetItems)
            </label>
          )}

          {previewLines.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-studio-muted">Preview</span>
              <div className="text-xs text-studio-muted px-2 py-1 bg-studio-panel2 border border-studio-border rounded truncate">
                {previewLines.join(isTabs ? ' | ' : ', ')}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DataListSection({ widget }: { widget: UiWidget }) {
  const dataSources = useStore((s) => s.project.uiDesign.dataSources)
  const updateUiDataListConfig = useStore((s) => s.updateUiDataListConfig)
  const addUiWidget = useStore((s) => s.addUiWidget)
  const updateUiWidgetText = useStore((s) => s.updateUiWidgetText)
  const checkpoint = useStore((s) => s.checkpoint)
  const config = widget.dataListConfig
  if (!config) return null

  const set = (partial: Partial<typeof config>) => {
    checkpoint()
    updateUiDataListConfig(widget.id, partial)
  }
  const boundSource = dataSources.find((d) => d.id === config.dataSourceId)

  // Picking a source on a still-empty Data List auto-scaffolds a SINGLE Label pre-bound to every
  // field at once (e.g. "{{name}}  {{age}}  {{email}}"), not one widget per field — one Text field
  // can already combine any number of `{{field}}` placeholders (see TemplateTextField's "Insert
  // field" buttons below, which stay available on this and any other template widget for
  // hand-editing afterward), so multiplying widgets per field would just be extra clutter to move/
  // style/delete. This is a starting point, not a lock — fully hand-editable afterward, and never
  // runs again once the list has any children, so it can never clobber a template the author
  // already built.
  const handleDataSourceChange = (dataSourceId: string) => {
    checkpoint()
    updateUiDataListConfig(widget.id, { dataSourceId: dataSourceId || null })
    if (dataSourceId && widget.childIds.length === 0) {
      const source = dataSources.find((d) => d.id === dataSourceId)
      if (source && source.fields.length > 0) {
        const labelId = addUiWidget('label', widget.id, 4, 4)
        updateUiWidgetText(labelId, source.fields.map((f) => `{{${f.name}}}`).join('  '))
      }
    }
  }

  return (
    <div className="border-t border-studio-border pt-2.5 flex flex-col gap-2">
      <span className="studio-label">Data</span>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-studio-muted">Data source</span>
        <select
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
          value={config.dataSourceId ?? ''}
          onChange={(e) => handleDataSourceChange(e.target.value)}
        >
          <option value="">(none — add one in the Data Sources tab)</option>
          {dataSources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {config.dataSourceId && !boundSource && <span className="text-[10px] text-red-400">This data source no longer exists.</span>}
        {boundSource && boundSource.fields.length === 0 && (
          <span className="text-[10px] text-studio-muted">"{boundSource.name}" has no fields yet — add some in the Data Sources tab.</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">Max items</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              disabled={config.maxItems === 0}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm flex-1 min-w-0 disabled:opacity-40"
              value={config.maxItems === 0 ? '' : config.maxItems}
              placeholder="Unlimited"
              onChange={(e) => set({ maxItems: Math.max(1, Number(e.target.value) || 1) })}
            />
            <label className="flex items-center gap-1 text-[10px] text-studio-muted shrink-0 cursor-pointer" title="0 = unlimited">
              <input type="checkbox" checked={config.maxItems === 0} onChange={(e) => set({ maxItems: e.target.checked ? 0 : 10 })} />
              ∞
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">Item spacing (px, negative to overlap)</span>
          <input
            type="number"
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
            value={config.itemSpacing}
            onChange={(e) => set({ itemSpacing: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-studio-muted">Rendering mode</span>
        <div className="text-xs text-studio-muted px-2 py-1 bg-studio-panel2 border border-studio-border rounded">Create all (recycling — coming soon)</div>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={config.itemClickEnabled} onChange={(e) => set({ itemClickEnabled: e.target.checked })} />
        Item click enabled
      </label>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={config.includeSampleDataInExport} onChange={(e) => set({ includeSampleDataInExport: e.target.checked })} />
        Include sample data in export
      </label>
      <span className="text-[10px] text-studio-muted -mt-1">Off by default — production firmware never ships demonstration rows unless you opt in here.</span>

      <div className="grid grid-cols-1 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">Empty text</span>
          <input className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm" value={config.emptyText} onChange={(e) => set({ emptyText: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">Loading text</span>
          <input className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm" value={config.loadingText} onChange={(e) => set({ loadingText: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-studio-muted">Error text</span>
          <input className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm" value={config.errorText} onChange={(e) => set({ errorText: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

/** "Visible when" — a bare boolean expression (`{{}}` wrapper not needed here, unlike the text
 * fields), shown only for a widget inside a Data List's item template (see
 * isDataListTemplateDescendant above). Live-validated with the exact same parser + restricted-
 * subset grammar the C++ export uses (scriptLang/codegen.ts's compileTemplateExpr), so a typo a
 * user would only otherwise discover at export time is caught immediately here instead. */
function VisibleWhenField({ widget }: { widget: UiWidget }) {
  const updateUiWidgetMeta = useStore((s) => s.updateUiWidgetMeta)
  const checkpoint = useStore((s) => s.checkpoint)
  const [draft, setDraft] = useState(widget.visibleWhenExpr ?? '')

  let error: string | null = null
  if (draft.trim()) {
    try {
      const node = acorn.parseExpressionAt(draft, 0, { ecmaVersion: 2022 })
      const errors = checkExpressionSubset(node as unknown as Node)
      if (errors.length > 0) error = errors[0].message
    } catch (e) {
      error = e instanceof Error ? e.message.replace(/\s*\(\d+:\d+\)\s*$/, '') : String(e)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-studio-muted">Visible when (e.g. unread == true)</span>
      <input
        className={`bg-studio-panel2 border rounded px-2 py-1 text-sm font-mono ${error ? 'border-red-500' : 'border-studio-border'}`}
        value={draft}
        placeholder="always visible"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (error) return
          checkpoint()
          updateUiWidgetMeta(widget.id, { visibleWhenExpr: draft.trim() || null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  )
}

// Position/size are always inline, direct-manipulation fields (drag/resize own them — states
// don't carry their own position in this pass). The appearance block below (background/color/
// border/padding/opacity/font/align) is state-aware: selecting Hover/Pressed/Disabled/Focused
// switches these fields to edit that state's override on top of the Default appearance (which
// itself already layers on top of any matching CSS rule — see cssCascade.ts), matching LVGL's
// own per-state style model.
/** Absolute display-local bounding box for a widget — sums ancestor x/y offsets up to (but not
 * including) the screen root, since a nested widget's own x/y are parent-relative (see
 * WidgetRenderer.tsx's isTopLevelWidget doc comment for the same distinction). Used by the
 * Navigator's Center-in-workspace/Zoom-to-selection actions, which need a real display-local
 * point to center the viewport on regardless of how deeply the selected widget is nested. */
function absoluteWidgetRect(allWidgets: Record<string, UiWidget>, widget: UiWidget): { x: number; y: number; width: number; height: number } {
  let x = typeof widget.style.x === 'number' ? widget.style.x : 0
  let y = typeof widget.style.y === 'number' ? widget.style.y : 0
  const width = typeof widget.style.width === 'number' ? widget.style.width : 0
  const height = typeof widget.style.height === 'number' ? widget.style.height : 0
  let parentId = widget.parentId
  while (parentId) {
    const parent = allWidgets[parentId]
    if (!parent || parent.type === 'screen') break
    x += typeof parent.style.x === 'number' ? parent.style.x : 0
    y += typeof parent.style.y === 'number' ? parent.style.y : 0
    parentId = parent.parentId
  }
  return { x, y, width, height }
}

export function PropertiesPanel() {
  const selectedWidgetId = useStore((s) => s.selectedWidgetId)
  const widget = useStore((s) => (s.selectedWidgetId ? s.project.uiDesign.widgets[s.selectedWidgetId] : null))
  const allWidgets = useStore((s) => s.project.uiDesign.widgets)
  const assets = useStore((s) => s.project.uiDesign.assets)
  const uiDisplay = useStore((s) => s.project.uiDesign.display)
  const display = { width: uiDisplay.width, height: uiDisplay.height, shape: uiDisplayShapeToDisplayShape(uiDisplay.shape) }
  const updateUiWidgetStyle = useStore((s) => s.updateUiWidgetStyle)
  const updateUiWidgetState = useStore((s) => s.updateUiWidgetState)
  const updateUiWidgetMeta = useStore((s) => s.updateUiWidgetMeta)
  const setUiWidgetSrc = useStore((s) => s.setUiWidgetSrc)
  const deleteUiWidget = useStore((s) => s.deleteUiWidget)
  const setUiWidgetThemeToken = useStore((s) => s.setUiWidgetThemeToken)
  const applyMaterialPreset = useStore((s) => s.applyMaterialPreset)
  const checkpoint = useStore((s) => s.checkpoint)
  const selectUiWidget = useStore((s) => s.selectUiWidget)
  const updateUiWorkspaceView = useStore((s) => s.updateUiWorkspaceView)
  // The state tab lives in the store (uiPreviewState) so the canvas can simulate the selected
  // state on the selected widget — switching the tab you edit also previews it live.
  const stateTab = useStore((s) => s.uiPreviewState)
  const setStateTab = useStore((s) => s.setUiPreviewState)

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

  // "Full Screen" Image Fit takes over the widget's own position/size at render/export time (see
  // WidgetRenderer.tsx's fullScreenBoxCss / lvglExport.ts's image codegen) without touching the
  // stored style — so the X/Y/Width/Height fields below are disabled and show the live resolved
  // values instead of stale numbers that no longer match what's actually rendered.
  const isFullScreenImage = widget.type === 'image' && appearance.imageFit === 'fullScreen'
  const isTopLevel = isTopLevelUiWidget(allWidgets, widget)

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

      {widget.type !== 'screen' && (
        <div className="flex items-center gap-1 flex-wrap text-[11px]">
          <button
            className="studio-btn px-1.5 py-0.5"
            title="Center this widget in the workspace at the current zoom level"
            onClick={() => {
              const viewport = useStore.getState().uiCanvasViewportSize
              if (!viewport) return
              const rect = absoluteWidgetRect(allWidgets, widget)
              const { panX, panY } = centerPanForRect(display, useStore.getState().uiWorkspaceView.zoom, rect)
              updateUiWorkspaceView({ panX, panY })
            }}
          >
            Center in workspace
          </button>
          <button
            className="studio-btn px-1.5 py-0.5"
            title="Zoom the workspace to fit this widget"
            onClick={() => {
              const viewport = useStore.getState().uiCanvasViewportSize
              if (!viewport) return
              const rect = absoluteWidgetRect(allWidgets, widget)
              const zoom = fitZoomToDisplay(viewport, { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) }, 'contain', 0.5)
              const { panX, panY } = centerPanForRect(display, zoom, rect)
              updateUiWorkspaceView({ zoom, panX, panY })
            }}
          >
            Zoom to selection
          </button>
          {widget.parentId && (
            <button className="studio-btn px-1.5 py-0.5" title="Select the parent widget" onClick={() => selectUiWidget(widget.parentId!)}>
              Select parent
            </button>
          )}
          {widget.childIds.length > 0 && (
            <button className="studio-btn px-1.5 py-0.5" title="Select the first child widget" onClick={() => selectUiWidget(widget.childIds[0])}>
              Select child
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={isFullScreenImage ? 0 : x} onChange={(v) => updateUiWidgetStyle(widget.id, { x: v })} disabled={isFullScreenImage} />
        <NumberField label="Y" value={isFullScreenImage ? 0 : y} onChange={(v) => updateUiWidgetStyle(widget.id, { y: v })} disabled={isFullScreenImage} />
        <LengthField
          label="Width"
          value={isFullScreenImage ? (isTopLevel ? display.width : '100%') : style.width}
          onChange={(v) => updateUiWidgetStyle(widget.id, { width: v })}
          disabled={isFullScreenImage}
        />
        <LengthField
          label="Height"
          value={isFullScreenImage ? (isTopLevel ? display.height : '100%') : style.height}
          onChange={(v) => updateUiWidgetStyle(widget.id, { height: v })}
          disabled={isFullScreenImage}
        />
      </div>

      {isFullScreenImage && (
        <div className="text-[11px] text-studio-muted bg-studio-panel2 border border-studio-border rounded px-2 py-1.5">
          {isTopLevel
            ? `Full Screen: automatically sized to match the display (${Math.round(display.width)} × ${Math.round(display.height)}).`
            : 'Full Screen: this widget is nested, so it fills its parent container instead of the whole display.'}
        </div>
      )}

      {widget.type !== 'screen' && !isFullScreenImage && !rectFitsDisplayShape(display, { x, y, width, height }) && (
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

      {widget.text !== undefined && <TemplateTextField widget={widget} allWidgets={allWidgets} />}

      {UI_ICON_TEXT_WIDGETS.has(widget.type) && (
        <IconPicker
          value={widget.iconSymbol}
          onSelect={(symbolId) => {
            checkpoint()
            updateUiWidgetMeta(widget.id, { iconSymbol: symbolId })
          }}
        />
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

      {widget.type === 'list' && <ListItemsSection widget={widget} />}
      {widget.type === 'textarea' && <TextareaOutputSection widget={widget} />}
      {widget.type === 'keyboard' && <KeyboardSection widget={widget} />}
      {widget.type === 'dataList' && <DataListSection widget={widget} />}
      {isOptionsSourceWidget(widget.type) && <OptionsSourceSection widget={widget} />}
      {isIndicatorWidget(widget.type) && <IndicatorSection widget={widget} />}
      {isDataListTemplateDescendant(allWidgets, widget.id) && <VisibleWhenField widget={widget} />}

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

        {stateTab === 'default' && (
          <div className="flex flex-col gap-1">
            <span className="studio-label">Material Preset</span>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(MATERIAL_PRESET_LABELS) as MaterialPresetId[]).map((p) => (
                <button
                  key={p}
                  className="studio-btn text-[10px] px-1 py-1"
                  title={`Apply the ${MATERIAL_PRESET_LABELS[p]} preset — a starting bundle, every field it sets stays editable afterward`}
                  onClick={() => {
                    checkpoint()
                    applyMaterialPreset(widget.id, p)
                  }}
                >
                  {MATERIAL_PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="Background"
            value={appearance.background ?? ''}
            onChange={(v) => setAppearance({ background: v })}
            themeToken={stateTab === 'default' ? widget.themeTokens?.background : undefined}
            onThemeTokenChange={stateTab === 'default' ? (t) => setUiWidgetThemeToken(widget.id, 'background', t) : undefined}
          />
          <ColorField
            label="Text Color"
            value={appearance.color ?? ''}
            onChange={(v) => setAppearance({ color: v })}
            themeToken={stateTab === 'default' ? widget.themeTokens?.color : undefined}
            onThemeTokenChange={stateTab === 'default' ? (t) => setUiWidgetThemeToken(widget.id, 'color', t) : undefined}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Background Opacity %" value={appearance.backgroundOpacity ?? 100} onChange={(v) => setAppearance({ backgroundOpacity: v })} />
          <NumberField label="Border Opacity %" value={appearance.borderOpacity ?? 100} onChange={(v) => setAppearance({ borderOpacity: v })} />
        </div>

        <div className="flex flex-col gap-1">
          <span className="studio-label">Surface Style</span>
          <div className="grid grid-cols-4 gap-1">
            {(['flat', 'glass', 'soft', 'bevel'] as const).map((s) => (
              <button
                key={s}
                className={`studio-tab text-[10px] ${appearance.surfaceStyle === s || (s === 'flat' && !appearance.surfaceStyle) ? 'studio-tab-active' : ''}`}
                onClick={() => setAppearance({ surfaceStyle: s === 'flat' ? undefined : s })}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="Glow Color"
            value={appearance.glowColor ?? ''}
            onChange={(v) => setAppearance({ glowColor: v })}
            themeToken={stateTab === 'default' ? widget.themeTokens?.glowColor : undefined}
            onThemeTokenChange={stateTab === 'default' ? (t) => setUiWidgetThemeToken(widget.id, 'glowColor', t) : undefined}
          />
          <NumberField label="Glow Radius" value={appearance.glowRadius ?? 0} onChange={(v) => setAppearance({ glowRadius: v })} />
        </div>

        <NumberField
          label="Elevation (0-24, Material-style — derives a shadow; ignored once Shadow Width below is set explicitly)"
          value={appearance.elevation ?? 0}
          onChange={(v) => setAppearance({ elevation: v })}
        />

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

        {widget.type === 'image' && (
          <div className="flex flex-col gap-1">
            <span className="studio-label">Image Fit</span>
            <select
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
              value={appearance.imageFit ?? 'contain'}
              onChange={(e) => setAppearance({ imageFit: e.target.value as UiImageFit })}
            >
              {IMAGE_FIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {appearance.imageFit === 'fullScreen' && (
              <span className="text-[11px] text-studio-muted">
                Resizes this widget to the display and clips it to the display's shape (round displays get a circular clip).
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Border Width" value={appearance.borderWidth ?? 0} onChange={(v) => setAppearance({ borderWidth: v })} />
          <ColorField
            label="Border Color"
            value={appearance.borderColor ?? ''}
            onChange={(v) => setAppearance({ borderColor: v })}
            themeToken={stateTab === 'default' ? widget.themeTokens?.borderColor : undefined}
            onThemeTokenChange={stateTab === 'default' ? (t) => setUiWidgetThemeToken(widget.id, 'borderColor', t) : undefined}
          />
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
        {/* Text widgets get the full Typography section below instead of these two generic
            controls; non-text widgets (which can still carry a text label incidentally) keep the
            minimal Font Size + Text Align here. */}
        {!UI_TEXT_STYLE_WIDGETS.has(widget.type) && (
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
        )}
      </div>

      {UI_TEXT_STYLE_WIDGETS.has(widget.type) && <TypographySection widget={widget} appearance={appearance} setAppearance={setAppearance} stateTab={stateTab} />}

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
      <AutoEventCallbackSection widget={widget} />
      {widget.tagId && <EventsSection widget={widget} />}
      {widget.tagId && <AnimationPresetsSection widget={widget} />}
    </div>
  )
}
