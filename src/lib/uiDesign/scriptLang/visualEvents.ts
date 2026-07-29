import type { Node } from 'acorn'
import type { UiWidget } from '@/types'
import { selectFirst } from '@/lib/uiDesign/selectors'
import { parseScript } from './parser'
import { applyTextEdits } from './textSplice'
import { ACTION_TABLE } from './actionTable'

// The visual Events/Actions panel (PropertiesPanel.tsx's "Events" section) is a structured VIEW
// over the script text, not a second data model — per this feature's plan, the script is the
// single source of truth. This file (a) recognizes the specific, simple shape
// `srcRef.on("trigger", () => { tgtRef.method(literal, literal, ...); })` anywhere in the
// script (only that exact shape becomes an editable row — free-form code elsewhere in the
// script is left alone and simply isn't shown here) and (b) edits/adds rows via precise text
// splices at the matched nodes' source offsets, never a full regenerate.

export interface VisualEventRow {
  key: string
  sourceWidgetId: string
  sourceRefName: string
  trigger: string
  targetWidgetId: string
  targetRefName: string
  method: string
  args: (string | number | boolean)[]
  triggerRange: [number, number]
  callExprRange: [number, number]
  argRanges: [number, number][]
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

function literalValue(node: Node): string | number | boolean | null {
  if (node.type !== 'Literal') return null
  const v = (node as unknown as { value: unknown }).value
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return null
}

export function parseVisualEventRows(script: string, widgets: Record<string, UiWidget>): VisualEventRow[] {
  const parsed = parseScript(script)
  if (!parsed.program) return []
  const { refNameToWidgetId } = findGetRefs(script, widgets)
  const rows: VisualEventRow[] = []

  for (const stmt of parsed.program.body) {
    if (stmt.type !== 'ExpressionStatement') continue
    const expr = (stmt as unknown as { expression: Node }).expression
    if (expr.type !== 'CallExpression') continue
    const call = expr as unknown as { callee: Node; arguments: Node[]; start: number; end: number }
    if (call.callee.type !== 'MemberExpression') continue
    const m = call.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier' || (m.property as unknown as { name: string }).name !== 'on') continue
    if (m.object.type !== 'Identifier') continue
    const sourceRefName = (m.object as unknown as { name: string }).name
    const sourceWidgetId = refNameToWidgetId.get(sourceRefName)
    if (!sourceWidgetId) continue

    const eventNode = call.arguments[0]
    const cbNode = call.arguments[1]
    if (!eventNode || eventNode.type !== 'Literal' || typeof (eventNode as unknown as { value: unknown }).value !== 'string') continue
    if (!cbNode || cbNode.type !== 'ArrowFunctionExpression') continue
    const fn = cbNode as unknown as { body: Node }
    let inner: Node
    if (fn.body.type === 'BlockStatement') {
      const body = (fn.body as unknown as { body: Node[] }).body
      if (body.length !== 1 || body[0].type !== 'ExpressionStatement') continue
      inner = (body[0] as unknown as { expression: Node }).expression
    } else {
      inner = fn.body
    }
    if (inner.type !== 'CallExpression') continue
    const innerCall = inner as unknown as { callee: Node; arguments: Node[]; start: number; end: number }
    if (innerCall.callee.type !== 'MemberExpression') continue
    const im = innerCall.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (im.computed || im.property.type !== 'Identifier' || im.object.type !== 'Identifier') continue
    const targetRefName = (im.object as unknown as { name: string }).name
    const targetWidgetId = refNameToWidgetId.get(targetRefName)
    if (!targetWidgetId) continue
    const method = (im.property as unknown as { name: string }).name

    const args: (string | number | boolean)[] = []
    const argRanges: [number, number][] = []
    let allLiteral = true
    for (const a of innerCall.arguments) {
      const v = literalValue(a)
      if (v === null) {
        allLiteral = false
        break
      }
      args.push(v)
      argRanges.push([a.start, a.end])
    }
    if (!allLiteral) continue

    rows.push({
      key: `${call.start}`,
      sourceWidgetId,
      sourceRefName,
      trigger: (eventNode as unknown as { value: string }).value,
      targetWidgetId,
      targetRefName,
      method,
      args,
      triggerRange: [eventNode.start, eventNode.end],
      callExprRange: [innerCall.start, innerCall.end],
      argRanges
    })
  }

  return rows
}

function argLiteralText(v: string | number | boolean): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

export function spliceEventTrigger(script: string, row: VisualEventRow, newTrigger: string): string {
  return applyTextEdits(script, [{ start: row.triggerRange[0], end: row.triggerRange[1], replacement: JSON.stringify(newTrigger) }])
}

export function spliceEventArg(script: string, row: VisualEventRow, argIndex: number, newValue: string | number | boolean): string {
  const range = row.argRanges[argIndex]
  if (!range) return script
  return applyTextEdits(script, [{ start: range[0], end: range[1], replacement: argLiteralText(newValue) }])
}

/** Replaces the whole `target.method(args)` call — used when the Target widget or Action method
 * changes (the argument shape is different per action, so a full-call replace is simpler and
 * more robust than trying to patch individual pieces). Auto-declares a `const ref = ui.get(...)`
 * for the new target if one doesn't already exist. */
export function spliceEventTargetAction(script: string, widgets: Record<string, UiWidget>, row: VisualEventRow, newTargetWidgetId: string, newMethod: string): string {
  const { widgetIdToRefName } = findGetRefs(script, widgets)
  let refName = widgetIdToRefName.get(newTargetWidgetId)
  let base = script
  if (!refName) {
    const widget = widgets[newTargetWidgetId]
    if (!widget?.tagId) return script
    refName = `${widget.tagId}Ref`
    base = `const ${refName} = ui.get(${JSON.stringify(`#${widget.tagId}`)});\n${base}`
    const shift = base.length - script.length
    row = { ...row, callExprRange: [row.callExprRange[0] + shift, row.callExprRange[1] + shift] }
  }
  const spec = ACTION_TABLE[newMethod]
  const defaultArgs = spec ? defaultArgsFor(newMethod) : []
  return applyTextEdits(base, [{ start: row.callExprRange[0], end: row.callExprRange[1], replacement: `${refName}.${newMethod}(${defaultArgs.map(argLiteralText).join(', ')})` }])
}

function defaultArgsFor(method: string): (string | number | boolean)[] {
  if (['setValue', 'setOpacity', 'setRotation'].includes(method)) return [0]
  if (['setPosition', 'setSize', 'setRange'].includes(method)) return [0, 0]
  if (['setText', 'setColor', 'setBackground', 'setSource'].includes(method)) return ['']
  if (method === 'setEnabled') return [true]
  if (method === 'animateTo') return [100, 300]
  return []
}

/** Appends a brand-new `srcRef.on(trigger, () => { tgtRef.method(args); });` block, declaring
 * whichever `const ref = ui.get("#tag")` bindings don't already exist yet. Both widgets must
 * have a tagId (an event/action row needs a stable selector on both ends). */
export function addEventRow(script: string, widgets: Record<string, UiWidget>, sourceWidgetId: string, trigger: string, targetWidgetId: string, method: string): string | null {
  const source = widgets[sourceWidgetId]
  const target = widgets[targetWidgetId]
  if (!source?.tagId || !target?.tagId) return null
  const { widgetIdToRefName } = findGetRefs(script, widgets)
  const decls: string[] = []
  let srcRef = widgetIdToRefName.get(sourceWidgetId)
  if (!srcRef) {
    srcRef = `${source.tagId}Ref`
    decls.push(`const ${srcRef} = ui.get(${JSON.stringify(`#${source.tagId}`)});`)
  }
  let tgtRef = widgetIdToRefName.get(targetWidgetId)
  if (!tgtRef) {
    tgtRef = `${target.tagId}Ref`
    if (tgtRef !== srcRef) decls.push(`const ${tgtRef} = ui.get(${JSON.stringify(`#${target.tagId}`)});`)
  }
  const defaultArgs = defaultArgsFor(method)
  const block = `${srcRef}.on(${JSON.stringify(trigger)}, () => {\n  ${tgtRef}.${method}(${defaultArgs.map(argLiteralText).join(', ')});\n});\n`
  const prefix = decls.length > 0 ? `${decls.join('\n')}\n` : ''
  const sep = script.trim() ? '\n' : ''
  return `${script}${sep}${prefix}${block}`
}
