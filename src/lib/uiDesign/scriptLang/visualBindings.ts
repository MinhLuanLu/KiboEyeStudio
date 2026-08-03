import type { Node } from 'acorn'
import type { UiWidget } from '@/types'
import { selectFirst } from '@/lib/uiDesign/selectors'
import { parseScript } from './parser'
import { applyTextEdits, type TextEdit } from './textSplice'

// The visual Data Binding panel (PropertiesPanel.tsx's "Data Binding" section) is a structured
// VIEW over the script text, exactly like visualEvents.ts's Events/Actions panel — the script
// stays the single source of truth, this file just (a) recognizes the shape
// `tgtRef.bindText(data.<name>)` / `.bindValue(data.<name>, {min, max, format, unit, fallback})` /
// `.bindVisible(data.<name>)` as a top-level statement anywhere in the script and (b) edits/adds/
// removes bindings via precise text splices at the matched call's source offsets. Only a `data.
// <name>` source (a Variable Manager entry, see types/uiDesign.ts's UiVariable) is recognized —
// binding to a bare script variable or another widget's value isn't shown as an editable row
// (still runs if hand-written, per this codebase's usual "unrecognized shape isn't visualized"
// fallback). Two-way binding composes a SECOND, independent primitive — a companion
// `srcRef.on("valueChanged", () => { data.<name> = srcRef.getValue(); })` block — rather than
// inventing a new binding-direction concept in the runtime/codegen (see sandboxRuntime.ts's
// bindValue/bindText and codegen.ts's BindingEntry, both of which stay one-way-only).

export type VisualBindingProperty = 'text' | 'value' | 'visible'

const PROPERTY_TO_METHOD: Record<VisualBindingProperty, string> = { text: 'bindText', value: 'bindValue', visible: 'bindVisible' }
const METHOD_TO_PROPERTY: Record<string, VisualBindingProperty> = { bindText: 'text', bindValue: 'value', bindVisible: 'visible' }
const BIND_METHODS = new Set(['bindText', 'bindValue', 'bindVisible'])

export interface VisualBindingOptions {
  min?: number
  max?: number
  format?: string
  unit?: string
  fallback?: string | number | boolean
}

export interface VisualBindingRow {
  key: string
  targetWidgetId: string
  targetRefName: string
  property: VisualBindingProperty
  variableName: string
  options: VisualBindingOptions
  /** Whether a companion `srcRef.on("valueChanged", () => { data.<name> = srcRef.getValue(); })`
   * write-back block already exists anywhere in the script (see spliceBindingTwoWay). */
  twoWay: boolean
  /** Range of just the `data.<name>` argument — replaced on a variable change. */
  sourceRange: [number, number]
  /** Range of the options object literal, when present. */
  optionsRange?: [number, number]
  /** Range of the whole `ref.bindX(...)` call — a full-call rewrite is used for every field edit
   * (property/variable/options), matching visualEvents.ts's spliceActionField precedent: simpler
   * and more robust than patching each piece independently. */
  callRange: [number, number]
  /** Range of the whole statement (including any trailing `;`) — used for remove. */
  stmtRange: [number, number]
}

interface ParsedRefs {
  widgetIdToRefName: Map<string, string>
  refNameToWidgetId: Map<string, string>
}

function findGetRefs(script: string, widgets: Record<string, UiWidget>): ParsedRefs {
  const widgetIdToRefName = new Map<string, string>()
  const refNameToWidgetId = new Map<string, string>()
  const parsed = parseScript(script)
  if (!parsed.program) return { widgetIdToRefName, refNameToWidgetId }
  for (const stmt of parsed.program.body) {
    if (stmt.type !== 'VariableDeclaration') continue
    const v = stmt as unknown as { declarations: { id: { type: string; name?: string }; init: Node | null }[] }
    for (const d of v.declarations) {
      if (d.id.type !== 'Identifier' || !d.id.name || !d.init) continue
      const call = d.init
      if (call.type !== 'CallExpression') continue
      const c = call as unknown as { callee: Node; arguments: Node[] }
      if (c.callee.type !== 'MemberExpression') continue
      const m = c.callee as unknown as { object: Node; property: Node }
      if (m.object.type !== 'Identifier' || (m.object as unknown as { name: string }).name !== 'ui') continue
      if (m.property.type !== 'Identifier' || (m.property as unknown as { name: string }).name !== 'get') continue
      const arg = c.arguments[0]
      if (!arg || arg.type !== 'Literal' || typeof (arg as unknown as { value: unknown }).value !== 'string') continue
      const widget = selectFirst(widgets, (arg as unknown as { value: string }).value)
      if (!widget) continue
      widgetIdToRefName.set(widget.id, d.id.name)
      refNameToWidgetId.set(d.id.name, widget.id)
    }
  }
  return { widgetIdToRefName, refNameToWidgetId }
}

function parseDataMember(node: Node): { name: string } | null {
  if (node.type !== 'MemberExpression') return null
  const m = node as unknown as { object: Node; property: Node; computed: boolean }
  if (m.computed || m.property.type !== 'Identifier') return null
  if (m.object.type !== 'Identifier' || (m.object as unknown as { name: string }).name !== 'data') return null
  return { name: (m.property as unknown as { name: string }).name }
}

function parseOptionsLiteral(node: Node): VisualBindingOptions {
  const props = node as unknown as { properties: { key: { name?: string; value?: unknown }; value: Node }[] }
  const out: VisualBindingOptions = {}
  for (const p of props.properties) {
    const key = p.key.name ?? String(p.key.value)
    if (p.value.type !== 'Literal') continue
    const v = (p.value as unknown as { value: unknown }).value
    if (key === 'min' && typeof v === 'number') out.min = v
    else if (key === 'max' && typeof v === 'number') out.max = v
    else if (key === 'format' && typeof v === 'string') out.format = v
    else if (key === 'unit' && typeof v === 'string') out.unit = v
    else if (key === 'fallback' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) out.fallback = v
  }
  return out
}

interface TwoWayWriteback {
  /** The whole `.on("valueChanged", ...)` statement — used for remove. */
  stmtRange: [number, number]
  /** Just the `data.<name>` on the assignment's left side — used to rename on a variable change. */
  dataRange: [number, number]
}

/** Finds the companion write-back block for `refName`/`variableName`, if one exists anywhere at
 * the script's top level: `refName.on("valueChanged", () => { data.<variableName> =
 * refName.getValue(); });` (block or bare-expression arrow body, matching every other "accept
 * either shape" rule in this feature). */
function findTwoWayWriteback(script: string, refName: string, variableName: string): TwoWayWriteback | null {
  const parsed = parseScript(script)
  if (!parsed.program) return null
  for (const stmt of parsed.program.body) {
    if (stmt.type !== 'ExpressionStatement') continue
    const s = stmt as unknown as { expression: Node; start: number; end: number }
    const expr = s.expression
    if (expr.type !== 'CallExpression') continue
    const call = expr as unknown as { callee: Node; arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') continue
    const m = call.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier' || (m.property as unknown as { name: string }).name !== 'on') continue
    if (m.object.type !== 'Identifier' || (m.object as unknown as { name: string }).name !== refName) continue
    const eventNode = call.arguments[0]
    const cbNode = call.arguments[1]
    if (!eventNode || eventNode.type !== 'Literal' || (eventNode as unknown as { value: unknown }).value !== 'valueChanged') continue
    if (!cbNode || cbNode.type !== 'ArrowFunctionExpression') continue
    const fn = cbNode as unknown as { body: Node }
    const stmts = fn.body.type === 'BlockStatement' ? (fn.body as unknown as { body: Node[] }).body : [fn.body]
    if (stmts.length !== 1) continue
    const innerStmt = stmts[0]
    const inner = innerStmt.type === 'ExpressionStatement' ? (innerStmt as unknown as { expression: Node }).expression : innerStmt
    if (inner.type !== 'AssignmentExpression') continue
    const a = inner as unknown as { left: Node; right: Node; operator: string }
    if (a.operator !== '=' || a.left.type !== 'MemberExpression') continue
    const left = parseDataMember(a.left)
    if (!left || left.name !== variableName) continue
    if (a.right.type !== 'CallExpression') continue
    const rc = a.right as unknown as { callee: Node; arguments: Node[] }
    if (rc.arguments.length !== 0 || rc.callee.type !== 'MemberExpression') continue
    const rm = rc.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (rm.computed || rm.object.type !== 'Identifier' || (rm.object as unknown as { name: string }).name !== refName) continue
    if (rm.property.type !== 'Identifier' || (rm.property as unknown as { name: string }).name !== 'getValue') continue
    const leftNode = a.left as unknown as { start: number; end: number }
    return { stmtRange: [s.start, s.end], dataRange: [leftNode.start, leftNode.end] }
  }
  return null
}

export function parseVisualBindingRows(script: string, widgets: Record<string, UiWidget>): VisualBindingRow[] {
  const parsed = parseScript(script)
  if (!parsed.program) return []
  const { refNameToWidgetId } = findGetRefs(script, widgets)
  const rows: VisualBindingRow[] = []

  for (const stmt of parsed.program.body) {
    if (stmt.type !== 'ExpressionStatement') continue
    const s = stmt as unknown as { expression: Node; start: number; end: number }
    const expr = s.expression
    if (expr.type !== 'CallExpression') continue
    const call = expr as unknown as { callee: Node; arguments: Node[]; start: number; end: number }
    if (call.callee.type !== 'MemberExpression') continue
    const m = call.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier') continue
    const method = (m.property as unknown as { name: string }).name
    if (!BIND_METHODS.has(method)) continue
    if (m.object.type !== 'Identifier') continue
    const targetRefName = (m.object as unknown as { name: string }).name
    const targetWidgetId = refNameToWidgetId.get(targetRefName)
    if (!targetWidgetId) continue

    const argNode = call.arguments[0]
    if (!argNode) continue
    const lhs = parseDataMember(argNode)
    if (!lhs) continue

    let options: VisualBindingOptions = {}
    let optionsRange: [number, number] | undefined
    const optNode = call.arguments[1]
    if (optNode) {
      if (optNode.type !== 'ObjectExpression') continue
      options = parseOptionsLiteral(optNode)
      const on = optNode as unknown as { start: number; end: number }
      optionsRange = [on.start, on.end]
    }

    const argRange = argNode as unknown as { start: number; end: number }
    const twoWay = Boolean(findTwoWayWriteback(script, targetRefName, lhs.name))

    rows.push({
      key: `${call.start}`,
      targetWidgetId,
      targetRefName,
      property: METHOD_TO_PROPERTY[method],
      variableName: lhs.name,
      options,
      twoWay,
      sourceRange: [argRange.start, argRange.end],
      optionsRange,
      callRange: [call.start, call.end],
      stmtRange: [s.start, s.end]
    })
  }

  return rows
}

function optionValueText(v: string | number | boolean): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

function renderOptionsLiteral(options: VisualBindingOptions): string {
  const parts: string[] = []
  if (typeof options.min === 'number') parts.push(`min: ${options.min}`)
  if (typeof options.max === 'number') parts.push(`max: ${options.max}`)
  if (options.format) parts.push(`format: ${JSON.stringify(options.format)}`)
  if (options.unit) parts.push(`unit: ${JSON.stringify(options.unit)}`)
  if (options.fallback !== undefined) parts.push(`fallback: ${optionValueText(options.fallback)}`)
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : ''
}

function renderBindingCallText(refName: string, method: string, variableName: string, options: VisualBindingOptions): string {
  const literal = renderOptionsLiteral(options)
  const args = literal ? `data.${variableName}, ${literal}` : `data.${variableName}`
  return `${refName}.${method}(${args})`
}

/** Rewrites a binding's whole call (property/variable/options together) — the shared full-call
 * replace every field-edit splice below funnels through, mirroring visualEvents.ts's
 * spliceActionField. Also renames the companion two-way write-back's `data.<name>` reference when
 * the bound variable itself changes, so a two-way binding can never end up pointing its read and
 * write sides at two different variables. */
function rewriteBindingCall(script: string, row: VisualBindingRow, property: VisualBindingProperty, variableName: string, options: VisualBindingOptions): string {
  const method = PROPERTY_TO_METHOD[property]
  const text = renderBindingCallText(row.targetRefName, method, variableName, options)
  const edits: TextEdit[] = [{ start: row.callRange[0], end: row.callRange[1], replacement: text }]
  if (row.twoWay && variableName !== row.variableName) {
    const wb = findTwoWayWriteback(script, row.targetRefName, row.variableName)
    if (wb) edits.push({ start: wb.dataRange[0], end: wb.dataRange[1], replacement: `data.${variableName}` })
  }
  return applyTextEdits(script, edits)
}

export function spliceBindingVariable(script: string, row: VisualBindingRow, newVariableName: string): string {
  return rewriteBindingCall(script, row, row.property, newVariableName, row.options)
}

export function spliceBindingProperty(script: string, row: VisualBindingRow, newProperty: VisualBindingProperty): string {
  return rewriteBindingCall(script, row, newProperty, row.variableName, row.options)
}

export function spliceBindingOptions(script: string, row: VisualBindingRow, newOptions: VisualBindingOptions): string {
  return rewriteBindingCall(script, row, row.property, row.variableName, newOptions)
}

/** Prepends a `const ref = ui.get("#tag")` declaration for `targetWidgetId` if one doesn't
 * already exist, then appends a new `ref.bindX(data.<name>);` statement — the binding-editor
 * sibling of visualEvents.ts's addEventRow. Requires the target widget to have a tagId (a
 * binding needs a stable selector, same precondition Events already has). */
export function addBindingRow(
  script: string,
  widgets: Record<string, UiWidget>,
  targetWidgetId: string,
  property: VisualBindingProperty,
  variableName: string,
  options: VisualBindingOptions = {}
): string | null {
  const target = widgets[targetWidgetId]
  if (!target?.tagId) return null
  const { widgetIdToRefName } = findGetRefs(script, widgets)
  let refName = widgetIdToRefName.get(targetWidgetId)
  const decls: string[] = []
  if (!refName) {
    refName = `${target.tagId}Ref`
    decls.push(`const ${refName} = ui.get(${JSON.stringify(`#${target.tagId}`)});`)
  }
  const call = `${renderBindingCallText(refName, PROPERTY_TO_METHOD[property], variableName, options)};\n`
  const prefix = decls.length > 0 ? `${decls.join('\n')}\n` : ''
  const sep = script.trim() ? '\n' : ''
  return `${script}${sep}${prefix}${call}`
}

/** Removes a binding row entirely — its own statement, and (if two-way) the companion write-back
 * block too. Order-independent: works whether the write-back block happens to sit before or
 * after the binding statement in the script text. */
export function spliceBindingRemove(script: string, row: VisualBindingRow): string {
  const existing = row.twoWay ? findTwoWayWriteback(script, row.targetRefName, row.variableName) : null
  let stmtRange = row.stmtRange
  let next = script
  if (existing) {
    const end = next[existing.stmtRange[1]] === '\n' ? existing.stmtRange[1] + 1 : existing.stmtRange[1]
    const removedLen = end - existing.stmtRange[0]
    next = applyTextEdits(next, [{ start: existing.stmtRange[0], end, replacement: '' }])
    if (existing.stmtRange[0] < stmtRange[0]) stmtRange = [stmtRange[0] - removedLen, stmtRange[1] - removedLen]
  }
  const end2 = next[stmtRange[1]] === '\n' ? stmtRange[1] + 1 : stmtRange[1]
  return applyTextEdits(next, [{ start: stmtRange[0], end: end2, replacement: '' }])
}

/** Adds or removes the companion `srcRef.on("valueChanged", () => { data.<name> =
 * srcRef.getValue(); });` write-back block — the "two-way" toggle. A no-op if the requested state
 * already holds (enabling twice, or disabling when nothing exists). */
export function spliceBindingTwoWay(script: string, row: VisualBindingRow, enabled: boolean): string {
  const existing = findTwoWayWriteback(script, row.targetRefName, row.variableName)
  if (enabled) {
    if (existing) return script
    const block = `${row.targetRefName}.on("valueChanged", () => { data.${row.variableName} = ${row.targetRefName}.getValue(); });\n`
    const sep = script.trim() ? '\n' : ''
    return `${script}${sep}${block}`
  }
  if (!existing) return script
  const end = script[existing.stmtRange[1]] === '\n' ? existing.stmtRange[1] + 1 : existing.stmtRange[1]
  return applyTextEdits(script, [{ start: existing.stmtRange[0], end, replacement: '' }])
}
