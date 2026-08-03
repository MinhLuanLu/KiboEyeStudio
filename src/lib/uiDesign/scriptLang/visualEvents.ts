import type { Node } from 'acorn'
import type { UiWidget } from '@/types'
import { selectFirst } from '@/lib/uiDesign/selectors'
import { parseScript } from './parser'
import { applyTextEdits } from './textSplice'
import { ACTION_TABLE } from './actionTable'

// The visual Events/Actions panel (PropertiesPanel.tsx's "Events" section) is a structured VIEW
// over the script text, not a second data model — per this feature's plan, the script is the
// single source of truth. This file (a) recognizes the shape
// `srcRef.on("trigger", () => { tgtRef.method(literal, literal, ...); ...more actions...; })`
// anywhere in the script — each statement in the block is one action, either a plain call
// (enabled) or `if (false) { tgtRef.method(...); }` (disabled — a real, re-parseable JS shape,
// not a comment) — and (b) edits/adds/removes/reorders actions via precise text splices (single-
// field edits) or a full block-body rewrite (structural edits: add/remove/duplicate/reorder/
// toggle-disabled, where the action list itself changes shape) at the matched nodes' source
// offsets. Free-form code elsewhere in the script — or any `.on()` whose body doesn't match this
// shape — is left alone and simply isn't shown here; it still runs.

export interface VisualActionEntry {
  targetWidgetId: string
  targetRefName: string
  method: string
  args: (string | number | boolean)[]
  argRanges: [number, number][]
  disabled: boolean
  /** Range of just the `target.method(args)` call — valid regardless of `disabled` (the disabled
   * wrapper is stripped before this range is computed), used for target/method/arg edits. */
  callExprRange: [number, number]
  /** Range of this action's own whole statement (the plain call or the `if (false) {...}` wrapper)
   * — used for remove/duplicate/reorder, and to know the current disabled-wrapper shape. */
  stmtRange: [number, number]
}

/** One `if(...)`-clause's left-hand operand — `data.<name>` (a Variable Manager entry, see
 * types/uiDesign.ts's UiVariable / the sandbox's `data` object), `<ref>.getValue()` (a live
 * widget reading, e.g. a slider/bar/arc's current value), or a bare top-level script variable. */
export type VisualConditionLhs = { kind: 'data'; name: string } | { kind: 'widgetValue'; refName: string; widgetId: string } | { kind: 'identifier'; name: string }

export type VisualConditionOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'includes'

export interface VisualCondition {
  left: VisualConditionLhs
  op: VisualConditionOp
  right: string | number | boolean
  /** Range of just this clause's own expression — valid whether it's the sole clause or one side
   * of a `&&`/`||` pair, used to edit this clause without touching the other one. */
  range: [number, number]
}

export interface VisualConditionGroup {
  clauses: VisualCondition[]
  /** How `clauses` combine — meaningful only when `clauses.length === 2`. */
  combinator: 'and' | 'or'
  /** Range of the whole condition expression (the `if(...)`'s test) — a full-group rewrite (add/
   * remove a clause, change the combinator) replaces this whole range. */
  range: [number, number]
}

export interface VisualEventRow {
  key: string
  sourceWidgetId: string
  sourceRefName: string
  trigger: string
  triggerRange: [number, number]
  actions: VisualActionEntry[]
  /** Present when the handler body is `if (<condition>) { ...actions...; } else { ...
   * ...elseActions...; }` — `actions` above is always the CONSEQUENT branch's action list (so
   * every existing action-list splice function keeps working unchanged); this describes the
   * condition guarding it and the optional else branch. */
  condition?: VisualConditionGroup
  elseActions?: VisualActionEntry[]
  /** Range to replace for a structural edit (add/remove/duplicate/reorder/toggle-disabled) to
   * the consequent action list specifically — the whole arrow body when there's no condition
   * (identical to `arrowBodyRange` in that case), or just the `if(...)`'s consequent block when
   * there is one, so rewriting the action list can never clobber the condition/else branch. */
  actionsRange: [number, number]
  /** Range to replace for a structural edit to the else branch — undefined when there's no else
   * branch yet (see spliceRowElse to add one). */
  elseRange?: [number, number]
  /** Range of the arrow function's body (block `{...}` or a bare expression) — used only by
   * spliceRowCondition to convert between the flat-action-list shape and the `if(...) {...}
   * else {...}` shape; every other structural edit uses `actionsRange`/`elseRange` instead so it
   * can't disturb a condition. Also transparently upgrades a bare-expression body (the original
   * single-action shape) to a block the first time anything structural touches it. */
  arrowBodyRange: [number, number]
  /** A user-chosen name for the generated C++ handler function (e.g. `button_event_cb`),
   * read from an optional 3rd string-literal argument to `.on(trigger, callback, "name")` — the
   * exact same "just an extra literal on the call" pattern bindings' options object uses one
   * level up. `undefined` when not set, in which case lvglExport.ts's collectEvents() falls back
   * to its usual auto-derived `<widget>_on_<trigger>` name. */
  handlerName?: string
  /** Range of the 3rd argument (the handler-name string literal), when present — used by
   * spliceEventHandlerName to edit it in place. Undefined when the row has no explicit name yet
   * (spliceEventHandlerName inserts a brand new 3rd argument in that case instead). */
  handlerNameRange?: [number, number]
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

interface RawCall {
  targetRefName: string
  method: string
  args: (string | number | boolean)[]
  argRanges: [number, number][]
  callExprRange: [number, number]
}

function extractRefMethodCall(node: Node): RawCall | null {
  if (node.type !== 'CallExpression') return null
  const call = node as unknown as { callee: Node; arguments: Node[]; start: number; end: number }
  if (call.callee.type !== 'MemberExpression') return null
  const m = call.callee as unknown as { object: Node; property: Node; computed: boolean }
  if (m.computed || m.property.type !== 'Identifier' || m.object.type !== 'Identifier') return null
  const targetRefName = (m.object as unknown as { name: string }).name
  const method = (m.property as unknown as { name: string }).name
  const args: (string | number | boolean)[] = []
  const argRanges: [number, number][] = []
  for (const a of call.arguments) {
    const v = literalValue(a)
    if (v === null) return null
    args.push(v)
    argRanges.push([a.start, a.end])
  }
  return { targetRefName, method, args, argRanges, callExprRange: [call.start, call.end] }
}

/** Left-hand side of a condition clause: `data.<name>`, `<ref>.getValue()`, or a bare identifier
 * (a top-level script variable). Anything else (a computed member, a nested call, a literal, ...)
 * isn't recognized — the whole `if(...)` then just isn't shown as an editable condition, same
 * "only the exact recognized shape is editable" fallback as everywhere else in this file. */
function parseConditionLhs(node: Node, refNameToWidgetId: Map<string, string>): VisualConditionLhs | null {
  if (node.type === 'MemberExpression') {
    const m = node as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier') return null
    if (m.object.type !== 'Identifier' || (m.object as unknown as { name: string }).name !== 'data') return null
    return { kind: 'data', name: (m.property as unknown as { name: string }).name }
  }
  if (node.type === 'CallExpression') {
    const c = node as unknown as { callee: Node; arguments: Node[] }
    if (c.arguments.length !== 0 || c.callee.type !== 'MemberExpression') return null
    const m = c.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier' || (m.property as unknown as { name: string }).name !== 'getValue') return null
    if (m.object.type !== 'Identifier') return null
    const refName = (m.object as unknown as { name: string }).name
    const widgetId = refNameToWidgetId.get(refName)
    if (!widgetId) return null
    return { kind: 'widgetValue', refName, widgetId }
  }
  if (node.type === 'Identifier') {
    return { kind: 'identifier', name: (node as unknown as { name: string }).name }
  }
  return null
}

/** One clause: `<lhs> ==/!=/>/</>=/<= <literal>` (`===`/`!==` accepted when parsing, always
 * generated as `===`/`!==`) or `String(<lhs>).includes(<literal>)` for "Contains". "Is true"/
 * "Is false" are just Equals against a boolean literal — no separate op needed. */
function parseConditionClause(node: Node, refNameToWidgetId: Map<string, string>): VisualCondition | null {
  const n = node as unknown as { start: number; end: number }
  if (node.type === 'CallExpression') {
    const c = node as unknown as { callee: Node; arguments: Node[] }
    if (c.callee.type !== 'MemberExpression' || c.arguments.length !== 1) return null
    const m = c.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier' || (m.property as unknown as { name: string }).name !== 'includes') return null
    if (m.object.type !== 'CallExpression') return null
    const inner = m.object as unknown as { callee: Node; arguments: Node[] }
    if (inner.callee.type !== 'Identifier' || (inner.callee as unknown as { name: string }).name !== 'String' || inner.arguments.length !== 1) return null
    const left = parseConditionLhs(inner.arguments[0], refNameToWidgetId)
    const right = literalValue(c.arguments[0])
    if (!left || typeof right !== 'string') return null
    return { left, op: 'includes', right, range: [n.start, n.end] }
  }
  if (node.type === 'BinaryExpression') {
    const b = node as unknown as { left: Node; right: Node; operator: string }
    const OP_MAP: Partial<Record<string, VisualConditionOp>> = { '==': '==', '===': '==', '!=': '!=', '!==': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' }
    const op = OP_MAP[b.operator]
    if (!op) return null
    const left = parseConditionLhs(b.left, refNameToWidgetId)
    if (!left) return null
    const right = literalValue(b.right)
    if (right === null) return null
    return { left, op, right, range: [n.start, n.end] }
  }
  return null
}

/** The whole `if(...)`'s test — either one clause, or exactly one `&&`/`||` pair of clauses (no
 * deeper nesting is recognized, matching this editor's other "one level of composition" limits,
 * e.g. Events' own single-call-per-action shape before this file's own multi-action extension). */
function parseConditionGroup(testNode: Node, refNameToWidgetId: Map<string, string>): VisualConditionGroup | null {
  const n = testNode as unknown as { start: number; end: number }
  if (testNode.type === 'LogicalExpression') {
    const l = testNode as unknown as { left: Node; right: Node; operator: string }
    if (l.operator !== '&&' && l.operator !== '||') return null
    const left = parseConditionClause(l.left, refNameToWidgetId)
    const right = parseConditionClause(l.right, refNameToWidgetId)
    if (!left || !right) return null
    return { clauses: [left, right], combinator: l.operator === '&&' ? 'and' : 'or', range: [n.start, n.end] }
  }
  const clause = parseConditionClause(testNode, refNameToWidgetId)
  if (!clause) return null
  return { clauses: [clause], combinator: 'and', range: [n.start, n.end] }
}

/** Parses a statement list (a block body's `.body`, or a single non-block statement wrapped in
 * an array) into action entries, same "any unrecognized statement bails the whole list" rule
 * parseVisualEventRows already applies to a handler's own top-level statements. */
function parseActionStatementList(stmts: Node[], refNameToWidgetId: Map<string, string>): VisualActionEntry[] | null {
  const out: VisualActionEntry[] = []
  for (const s of stmts) {
    const entry = parseActionFromStatement(s, refNameToWidgetId)
    if (!entry) return null
    out.push(entry)
  }
  return out
}

function statementsOf(node: Node): Node[] {
  return node.type === 'BlockStatement' ? (node as unknown as { body: Node[] }).body : [node]
}

/** Parses one statement from a `.on()` handler's block body (or the sole node of a bare-
 * expression arrow body, passed the same way) into one action entry — either a plain
 * `tgtRef.method(literal, ...)` (enabled) or `if (false) { tgtRef.method(...); }` /
 * `if (false) tgtRef.method(...);` (disabled). Anything else returns null, which bails the
 * whole row (see parseVisualEventRows) — same "only the exact recognized shape is editable"
 * discipline as every other part of this file. */
function parseActionFromStatement(stmt: Node, refNameToWidgetId: Map<string, string>): VisualActionEntry | null {
  const s = stmt as unknown as { type: string; start: number; end: number }
  let node: Node = stmt
  if (stmt.type === 'ExpressionStatement') {
    node = (stmt as unknown as { expression: Node }).expression
  }

  if (node.type === 'IfStatement') {
    const i = node as unknown as { test: Node; consequent: Node; alternate: Node | null; start: number; end: number }
    if (i.alternate) return null
    if (i.test.type !== 'Literal' || (i.test as unknown as { value: unknown }).value !== false) return null
    let inner: Node
    if (i.consequent.type === 'BlockStatement') {
      const body = (i.consequent as unknown as { body: Node[] }).body
      if (body.length !== 1 || body[0].type !== 'ExpressionStatement') return null
      inner = (body[0] as unknown as { expression: Node }).expression
    } else if (i.consequent.type === 'ExpressionStatement') {
      inner = (i.consequent as unknown as { expression: Node }).expression
    } else {
      return null
    }
    const raw = extractRefMethodCall(inner)
    if (!raw) return null
    const targetWidgetId = refNameToWidgetId.get(raw.targetRefName)
    if (!targetWidgetId) return null
    return { ...raw, targetWidgetId, disabled: true, stmtRange: [i.start, i.end] }
  }

  if (node.type === 'CallExpression') {
    const raw = extractRefMethodCall(node)
    if (!raw) return null
    const targetWidgetId = refNameToWidgetId.get(raw.targetRefName)
    if (!targetWidgetId) return null
    return { ...raw, targetWidgetId, disabled: false, stmtRange: [s.start, s.end] }
  }

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
    const nameNode = call.arguments[2]
    if (!eventNode || eventNode.type !== 'Literal' || typeof (eventNode as unknown as { value: unknown }).value !== 'string') continue
    if (!cbNode || cbNode.type !== 'ArrowFunctionExpression') continue
    const fn = cbNode as unknown as { body: Node }
    const bodyNode = fn.body as unknown as { start: number; end: number }
    const hasExplicitName = nameNode && nameNode.type === 'Literal' && typeof (nameNode as unknown as { value: unknown }).value === 'string'

    const stmts: Node[] = fn.body.type === 'BlockStatement' ? (fn.body as unknown as { body: Node[] }).body : [fn.body]
    const baseRow = {
      key: `${call.start}`,
      sourceWidgetId,
      sourceRefName,
      trigger: (eventNode as unknown as { value: string }).value,
      triggerRange: [eventNode.start, eventNode.end] as [number, number],
      arrowBodyRange: [bodyNode.start, bodyNode.end] as [number, number],
      handlerName: hasExplicitName ? (nameNode as unknown as { value: string }).value : undefined,
      handlerNameRange: hasExplicitName ? ([nameNode!.start, nameNode!.end] as [number, number]) : undefined
    }

    // Condition-wrapped shape: the block's SOLE statement is `if (<condition>) {...} else {...}`
    // (not the per-action `if (false) {...}` disabled-wrapper, which only ever wraps one call).
    if (stmts.length === 1 && stmts[0].type === 'IfStatement') {
      const ifStmt = stmts[0] as unknown as { test: Node; consequent: Node; alternate: Node | null; start: number; end: number }
      const isDisabledWrapper = ifStmt.test.type === 'Literal' && (ifStmt.test as unknown as { value: unknown }).value === false
      if (!isDisabledWrapper) {
        const group = parseConditionGroup(ifStmt.test, refNameToWidgetId)
        if (group) {
          const consequentStmt = ifStmt.consequent as unknown as { start: number; end: number }
          const actions = parseActionStatementList(statementsOf(ifStmt.consequent), refNameToWidgetId)
          const elseActions = ifStmt.alternate ? parseActionStatementList(statementsOf(ifStmt.alternate), refNameToWidgetId) : null
          if (actions && (!ifStmt.alternate || elseActions)) {
            const elseNode = ifStmt.alternate as unknown as { start: number; end: number } | null
            rows.push({
              ...baseRow,
              actions,
              condition: group,
              elseActions: elseActions ?? undefined,
              actionsRange: [consequentStmt.start, consequentStmt.end],
              elseRange: elseNode ? [elseNode.start, elseNode.end] : undefined
            })
            continue
          }
        }
        // A real (non-disabled-wrapper) `if` that doesn't match the recognized condition/action
        // grammar — not editable visually, same "unrecognized shape isn't shown" rule as
        // everywhere else; don't fall through to the flat-action-list parse below (a single `if`
        // statement can never itself be a plain-call action).
        continue
      }
    }

    const actions = parseActionStatementList(stmts, refNameToWidgetId)
    if (!actions) continue

    rows.push({ ...baseRow, actions, actionsRange: baseRow.arrowBodyRange })
  }

  return rows
}

function argLiteralText(v: string | number | boolean): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

export function spliceEventTrigger(script: string, row: VisualEventRow, newTrigger: string): string {
  return applyTextEdits(script, [{ start: row.triggerRange[0], end: row.triggerRange[1], replacement: JSON.stringify(newTrigger) }])
}

/** Sets/edits/clears this row's explicit handler-function name — the 3rd argument to
 * `.on(trigger, callback, "name")`. An empty/whitespace `newName` removes the argument entirely
 * (falling back to lvglExport.ts's usual auto-derived name), matching the "empty clears the
 * override" convention already used elsewhere in this app (e.g. the LVGL Export dialog's screen
 * custom-name field). */
export function spliceEventHandlerName(script: string, row: VisualEventRow, newName: string): string {
  const trimmed = newName.trim()
  if (row.handlerNameRange) {
    if (trimmed) return applyTextEdits(script, [{ start: row.handlerNameRange[0], end: row.handlerNameRange[1], replacement: JSON.stringify(trimmed) }])
    // Remove the whole `, "name"` argument — walk back over any whitespace then the preceding
    // comma too, so clearing the name doesn't leave a dangling `, )` behind.
    let start = row.handlerNameRange[0]
    while (start > 0 && /\s/.test(script[start - 1])) start--
    if (start > 0 && script[start - 1] === ',') start--
    return applyTextEdits(script, [{ start, end: row.handlerNameRange[1], replacement: '' }])
  }
  if (!trimmed) return script
  const insertAt = row.arrowBodyRange[1]
  return applyTextEdits(script, [{ start: insertAt, end: insertAt, replacement: `, ${JSON.stringify(trimmed)}` }])
}

export type ActionBranch = 'then' | 'else'

function actionsOf(row: VisualEventRow, branch: ActionBranch): VisualActionEntry[] {
  return branch === 'else' ? (row.elseActions ?? []) : row.actions
}

function rangeOf(row: VisualEventRow, branch: ActionBranch): [number, number] | undefined {
  return branch === 'else' ? row.elseRange : row.actionsRange
}

export function spliceActionArg(script: string, row: VisualEventRow, actionIndex: number, argIndex: number, newValue: string | number | boolean, branch: ActionBranch = 'then'): string {
  const range = actionsOf(row, branch)[actionIndex]?.argRanges[argIndex]
  if (!range) return script
  return applyTextEdits(script, [{ start: range[0], end: range[1], replacement: argLiteralText(newValue) }])
}

function shiftRange(r: [number, number], by: number): [number, number] {
  return [r[0] + by, r[1] + by]
}

/** Prepends a `const ref = ui.get("#tag")` declaration for `targetWidgetId` if one doesn't
 * already exist, returning the (possibly-prefixed) script, the ref name to use, and how far
 * every existing offset needs to shift to stay valid against the new script text. */
function ensureRef(script: string, widgets: Record<string, UiWidget>, targetWidgetId: string): { script: string; refName: string | null; shift: number } {
  const { widgetIdToRefName } = findGetRefs(script, widgets)
  const existing = widgetIdToRefName.get(targetWidgetId)
  if (existing) return { script, refName: existing, shift: 0 }
  const widget = widgets[targetWidgetId]
  if (!widget?.tagId) return { script, refName: null, shift: 0 }
  const refName = `${widget.tagId}Ref`
  const decl = `const ${refName} = ui.get(${JSON.stringify(`#${widget.tagId}`)});\n`
  return { script: decl + script, refName, shift: decl.length }
}

/** Replaces the whole `target.method(args)` call for one action in the row — used when that
 * action's Target widget or Action method changes (the argument shape is different per action,
 * so a full-call replace is simpler and more robust than patching individual pieces). Auto-
 * declares a `const ref = ui.get(...)` for the new target if one doesn't already exist; leaves
 * the action's disabled-wrapper (if any) untouched since callExprRange never includes it.
 * `explicitArgs`, when given, replaces the method's own generic `defaultArgsFor()` guess — used
 * by the Hardware action presets (see actionTable.ts's HARDWARE_ACTION_PRESETS), which need a
 * specific function name + arg shape baked in rather than a blank `callFunction("")`. */
export function spliceActionField(
  script: string,
  widgets: Record<string, UiWidget>,
  row: VisualEventRow,
  actionIndex: number,
  newTargetWidgetId: string,
  newMethod: string,
  explicitArgs?: (string | number | boolean)[],
  branch: ActionBranch = 'then'
): string {
  const action = actionsOf(row, branch)[actionIndex]
  if (!action) return script
  const { script: base, refName, shift } = ensureRef(script, widgets, newTargetWidgetId)
  if (!refName) return script
  const callExprRange = shift === 0 ? action.callExprRange : shiftRange(action.callExprRange, shift)
  const spec = ACTION_TABLE[newMethod]
  const args = explicitArgs ?? (spec ? defaultArgsFor(newMethod) : [])
  return applyTextEdits(base, [{ start: callExprRange[0], end: callExprRange[1], replacement: `${refName}.${newMethod}(${args.map(argLiteralText).join(', ')})` }])
}

function defaultArgsFor(method: string): (string | number | boolean)[] {
  if (['setValue', 'setOpacity', 'setRotation'].includes(method)) return [0]
  if (['setPosition', 'setSize', 'setRange'].includes(method)) return [0, 0]
  if (['setText', 'setColor', 'setBackground', 'setSource'].includes(method)) return ['']
  if (method === 'setEnabled') return [true]
  if (method === 'animateTo') return [100, 300]
  return []
}

interface ActionLike {
  targetRefName: string
  method: string
  args: (string | number | boolean)[]
  disabled: boolean
}

function renderActionStatementText(a: ActionLike): string {
  const call = `${a.targetRefName}.${a.method}(${a.args.map(argLiteralText).join(', ')})`
  return a.disabled ? `if (false) { ${call}; }` : `${call};`
}

function renderBlockBody(actions: ActionLike[]): string {
  if (actions.length === 0) return '{}'
  const lines = actions.map((a) => `  ${renderActionStatementText(a)}`)
  return `{\n${lines.join('\n')}\n}`
}

/** Rewrites just the range for `branch` (the `if(...)`'s consequent when a condition is present
 * and `branch === 'then'`, its else block when `branch === 'else'`, or the whole arrow body when
 * there's no condition at all) — never the condition/other branch, so editing one branch's
 * actions can't disturb the other or the guarding condition. `branch === 'else'` on a row with no
 * `elseRange` yet is a no-op (use spliceRowAddElse first). */
function rewriteActions(script: string, row: VisualEventRow, newActions: ActionLike[], branch: ActionBranch = 'then'): string {
  const range = rangeOf(row, branch)
  if (!range) return script
  return applyTextEdits(script, [{ start: range[0], end: range[1], replacement: renderBlockBody(newActions) }])
}

export function spliceActionToggleDisabled(script: string, row: VisualEventRow, actionIndex: number, branch: ActionBranch = 'then'): string {
  const list = actionsOf(row, branch)
  const next = list.map((a, i) => (i === actionIndex ? { ...a, disabled: !a.disabled } : a))
  return rewriteActions(script, row, next, branch)
}

export function spliceActionRemove(script: string, row: VisualEventRow, actionIndex: number, branch: ActionBranch = 'then'): string {
  const next = actionsOf(row, branch).filter((_, i) => i !== actionIndex)
  return rewriteActions(script, row, next, branch)
}

export function spliceActionDuplicate(script: string, row: VisualEventRow, actionIndex: number, branch: ActionBranch = 'then'): string {
  const list = actionsOf(row, branch)
  const src = list[actionIndex]
  if (!src) return script
  const next = [...list]
  next.splice(actionIndex + 1, 0, { ...src })
  return rewriteActions(script, row, next, branch)
}

export function spliceActionReorder(script: string, row: VisualEventRow, fromIndex: number, toIndex: number, branch: ActionBranch = 'then'): string {
  const next = [...actionsOf(row, branch)]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) return script
  next.splice(toIndex, 0, moved)
  return rewriteActions(script, row, next, branch)
}

/** Shifts every source-offset field on a row by `by` — needed whenever `ensureRef` prepends a
 * new `const ref = ui.get(...)` declaration ahead of the row's own text, so every range computed
 * against the pre-insert script stays valid against the post-insert one. */
function shiftRow(row: VisualEventRow, by: number): VisualEventRow {
  const shiftActions = (list: VisualActionEntry[]) =>
    list.map((a) => ({
      ...a,
      argRanges: a.argRanges.map((r) => shiftRange(r, by)),
      callExprRange: shiftRange(a.callExprRange, by),
      stmtRange: shiftRange(a.stmtRange, by)
    }))
  return {
    ...row,
    triggerRange: shiftRange(row.triggerRange, by),
    arrowBodyRange: shiftRange(row.arrowBodyRange, by),
    actionsRange: shiftRange(row.actionsRange, by),
    elseRange: row.elseRange ? shiftRange(row.elseRange, by) : undefined,
    actions: shiftActions(row.actions),
    elseActions: row.elseActions ? shiftActions(row.elseActions) : undefined,
    condition: row.condition
      ? { ...row.condition, range: shiftRange(row.condition.range, by), clauses: row.condition.clauses.map((c) => ({ ...c, range: shiftRange(c.range, by) })) }
      : undefined
  }
}

/** Appends a brand-new action to an existing row (a second+ action for an already-recognized
 * event), auto-declaring a `const ref = ui.get(...)` for the target if one doesn't already
 * exist. Structural, so it goes through the same full-block rewrite as remove/duplicate/reorder. */
export function spliceActionAdd(script: string, widgets: Record<string, UiWidget>, row: VisualEventRow, targetWidgetId: string, method: string, branch: ActionBranch = 'then'): string | null {
  const { script: base, refName, shift } = ensureRef(script, widgets, targetWidgetId)
  if (!refName) return null
  const shiftedRow = shift === 0 ? row : shiftRow(row, shift)
  const next: ActionLike[] = [...actionsOf(shiftedRow, branch), { targetRefName: refName, method, args: defaultArgsFor(method), disabled: false }]
  return rewriteActions(base, shiftedRow, next, branch)
}

/** Appends a brand-new `srcRef.on(trigger, () => { tgtRef.method(args); });` block (a new event
 * row with one action), declaring whichever `const ref = ui.get("#tag")` bindings don't already
 * exist yet. Both widgets must have a tagId (an event/action row needs a stable selector on both
 * ends). */
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
  const body = renderBlockBody([{ targetRefName: tgtRef, method, args: defaultArgsFor(method), disabled: false }])
  const block = `${srcRef}.on(${JSON.stringify(trigger)}, () => ${body});\n`
  const prefix = decls.length > 0 ? `${decls.join('\n')}\n` : ''
  const sep = script.trim() ? '\n' : ''
  return `${script}${sep}${prefix}${block}`
}

// ---------------------------------------------------------------------------------------------
// Conditions — "if this, do that" on top of a row's actions. See VisualCondition/
// VisualConditionGroup's own doc comments for the recognized grammar. A condition clause's
// "widget value" left-hand side is deliberately restricted here to widgets that ALREADY have a
// `const ref = ui.get(...)` declared somewhere in the script (populated from parseVisualEventRows'
// own ref-discovery) — unlike action targets, condition editing never auto-declares a new ref, so
// none of these functions need the shift/ensureRef machinery action editing does.
// ---------------------------------------------------------------------------------------------

type ClauseInput = { left: VisualConditionLhs; op: VisualConditionOp; right: string | number | boolean }

function renderLhsText(lhs: VisualConditionLhs): string {
  if (lhs.kind === 'data') return `data.${lhs.name}`
  if (lhs.kind === 'widgetValue') return `${lhs.refName}.getValue()`
  return lhs.name
}

function renderClauseText(clause: ClauseInput): string {
  const lhsText = renderLhsText(clause.left)
  if (clause.op === 'includes') return `String(${lhsText}).includes(${argLiteralText(clause.right as string)})`
  const OP_TEXT: Record<Exclude<VisualConditionOp, 'includes'>, string> = { '==': '===', '!=': '!==', '>': '>', '<': '<', '>=': '>=', '<=': '<=' }
  return `${lhsText} ${OP_TEXT[clause.op]} ${argLiteralText(clause.right)}`
}

function renderConditionGroupText(clauses: ClauseInput[], combinator: 'and' | 'or'): string {
  if (clauses.length === 1) return renderClauseText(clauses[0])
  return `${renderClauseText(clauses[0])} ${combinator === 'and' ? '&&' : '||'} ${renderClauseText(clauses[1])}`
}

/** Returns every named widget whose value can be used as a condition's "widget value" operand —
 * i.e. already has a `const ref = ui.get(...)` somewhere in the script (see this section's own
 * top comment for why this list isn't "every named widget in the project"). */
export function widgetsWithExistingRefs(script: string, widgets: Record<string, UiWidget>): UiWidget[] {
  const { widgetIdToRefName } = findGetRefs(script, widgets)
  return [...widgetIdToRefName.keys()].map((id) => widgets[id]).filter((w): w is UiWidget => Boolean(w))
}

/** Adds a condition to a row that doesn't have one yet, wrapping its existing (flat) action list
 * as the consequent — `if (<clause>) { ...current actions... }`, no else branch. Pass `null` to
 * remove an existing condition instead (and any else branch), leaving just the flat action list —
 * the two ends of the same toggle, exposed as one function since a row only ever has 0 or 1
 * conditions and the UI only ever transitions directly between those two states (editing an
 * EXISTING condition's own clause(s) goes through spliceConditionClause/spliceAddConditionClause/
 * spliceRemoveConditionClause/spliceConditionCombinator instead, none of which touch the actions). */
export function spliceRowCondition(script: string, row: VisualEventRow, newClause: ClauseInput | null): string {
  if (newClause === null) {
    return applyTextEdits(script, [{ start: row.arrowBodyRange[0], end: row.arrowBodyRange[1], replacement: renderBlockBody(row.actions) }])
  }
  const body = `{\n  if (${renderClauseText(newClause)}) ${renderBlockBody(row.actions)}\n}`
  return applyTextEdits(script, [{ start: row.arrowBodyRange[0], end: row.arrowBodyRange[1], replacement: body }])
}

/** Edits one existing clause's LHS/operator/RHS in place (does not affect the other clause, if
 * a `&&`/`||` pair is present). */
export function spliceConditionClause(script: string, row: VisualEventRow, clauseIndex: number, newClause: ClauseInput): string {
  const clause = row.condition?.clauses[clauseIndex]
  if (!clause) return script
  return applyTextEdits(script, [{ start: clause.range[0], end: clause.range[1], replacement: renderClauseText(newClause) }])
}

/** Switches an existing 2-clause condition between `&&` and `||` — a no-op on a 1-clause condition. */
export function spliceConditionCombinator(script: string, row: VisualEventRow, newCombinator: 'and' | 'or'): string {
  if (!row.condition || row.condition.clauses.length !== 2) return script
  const text = renderConditionGroupText(row.condition.clauses, newCombinator)
  return applyTextEdits(script, [{ start: row.condition.range[0], end: row.condition.range[1], replacement: text }])
}

/** Adds a second clause (combined with AND by default — see spliceConditionCombinator to switch
 * to OR afterward) to a condition that currently has just one. */
export function spliceAddConditionClause(script: string, row: VisualEventRow, secondClause: ClauseInput): string {
  if (!row.condition || row.condition.clauses.length !== 1) return script
  const text = renderConditionGroupText([row.condition.clauses[0], secondClause], 'and')
  return applyTextEdits(script, [{ start: row.condition.range[0], end: row.condition.range[1], replacement: text }])
}

/** Drops back to a single clause, keeping whichever of the two the caller specifies (the UI's
 * own "remove" button on a given clause card keeps the OTHER one). */
export function spliceRemoveConditionClause(script: string, row: VisualEventRow, keepIndex: 0 | 1): string {
  if (!row.condition || row.condition.clauses.length !== 2) return script
  const text = renderClauseText(row.condition.clauses[keepIndex])
  return applyTextEdits(script, [{ start: row.condition.range[0], end: row.condition.range[1], replacement: text }])
}

/** Adds an empty `else {}` branch to a conditioned row that doesn't have one yet — populate it
 * afterward via spliceActionAdd(..., 'else'). No-op if the row has no condition, or already has
 * an else branch. */
export function spliceRowAddElse(script: string, row: VisualEventRow): string {
  if (!row.condition || row.elseRange) return script
  return applyTextEdits(script, [{ start: row.actionsRange[1], end: row.actionsRange[1], replacement: ' else {}' }])
}

/** Removes an existing else branch entirely (including its own actions) — the row falls back to
 * "do nothing when the condition is false", same as before an else branch was ever added. */
export function spliceRowRemoveElse(script: string, row: VisualEventRow): string {
  if (!row.elseRange) return script
  return applyTextEdits(script, [{ start: row.actionsRange[1], end: row.elseRange[1], replacement: '' }])
}
