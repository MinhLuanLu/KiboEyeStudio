import type { Node, Program } from 'acorn'
import type { UiWidget } from '@/types'
import { selectFirst } from '@/lib/uiDesign/selectors'
import type { ScriptError } from './parser'
import { ACTION_TABLE, CODEGEN_SPECIAL_METHODS, valueGetCall } from './actionTable'
import { walkAllNodes } from './astWalk'

// Walks the (already restrictedSubset-validated) AST and emits equivalent LVGL C++ — the
// "convert supported JavaScript-like behavior into native LVGL C++" half of this feature. Kept
// free of any import from lib/export/lvglExport.ts (which imports THIS file) — naming lookups
// that file owns (widget C++ variable names, generated asset/CSS-rule identifiers, per-screen
// show-function names) are passed in via CodegenContext instead, so there's no circular
// dependency and this module stays independently testable.

export interface CodegenContext {
  widgets: Record<string, UiWidget>
  varNameForWidget: (widget: UiWidget) => string
  /** img_* ident lookup by asset NAME (scripts reference assets by name, same as HTML
   * `src="..."` — see htmlSync.ts) — undefined if no asset with that name is included. */
  identForAssetName: (assetName: string) => string | undefined
  /** The project-derived C++ namespace (see naming.ts's sanitizeIdentifier) the generated
   * `ui.h`/`ui.cpp` wrap the public API in — used to qualify `ui.showScreen(...)`/`ui.goBack()`
   * calls (`${namespaceName}::ShowXScreen()`/`${namespaceName}::GoBack()`), the only two script
   * APIs whose codegen needs to call back into that namespace from inside a nested expression. */
  namespaceName: string
  /** style_sel_<ident> lookup for a `.class` selector's CSS rule — used by addClass/removeClass
   * codegen; undefined if no CSS rule for that class is actually exported (see lvglExport.ts's
   * usedCssRules — a class with no rule is a no-op at runtime, same as in the browser preview). */
  identForClassSelector: (className: string) => string | undefined
  screenFnNameByName: (screenName: string) => string | undefined
  /** Resolves a Variable Manager entry (`data.<name>` in script) to its generated C++ getter/
   * setter function names and value type — undefined if no UiVariable has that name (see
   * types/uiDesign.ts's UiVariable and lvglExport.ts's per-variable static-var/getter/setter
   * codegen, the same "generated from the structured list" pattern top-level let/const already
   * uses one level up). */
  identForVariableName: (name: string) => { getter: string; setter: string; type: ExprType } | undefined
}

export interface CodegenEventHandler {
  widgetId: string
  trigger: string
  bodyLines: string[]
  /** User-chosen C++ handler function name, from an optional 3rd string-literal argument to
   * `.on(trigger, callback, "name")` — see visualEvents.ts's VisualEventRow.handlerName, the
   * Properties panel's Events section field this comes from. undefined falls back to
   * lvglExport.ts's usual auto-derived `<widget>_on_<trigger>` name. */
  customName?: string
}

export interface CodegenTimer {
  varName: string
  intervalMs: string
  repeatOnce: boolean
  bodyLines: string[]
}

export interface CodegenResult {
  variables: string[]
  functionPrototypes: string[]
  functions: string[]
  eventHandlers: CodegenEventHandler[]
  timers: CodegenTimer[]
  initStatements: string[]
  hardwareStubs: string[]
  updateBindingsFn: string[]
  errors: ScriptError[]
}

export type ExprType = 'number' | 'boolean' | 'cstr' | 'String' | 'unknown'
interface RenderedExpr {
  text: string
  type: ExprType
}

const CPP_KEYWORDS = new Set(['class', 'new', 'delete', 'template', 'namespace', 'friend', 'union', 'operator', 'typename', 'private', 'public', 'protected', 'this'])

function cIdent(name: string): string {
  return CPP_KEYWORDS.has(name) ? `js_${name}` : name
}

function escapeCString(s: string): string {
  return JSON.stringify(s)
}

/** `callFunction`'s name argument is a plain literal string (not a rendered C++ expression) —
 * this turns it into a safe C identifier, falling back to a generic name for anything that
 * doesn't sanitize to a valid one (matches this codebase's other naming-fallback helpers). */
function sanitizeFunctionName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '')
  return /^[a-zA-Z_]/.test(cleaned) && cleaned.length > 0 ? cleaned : 'customFunction'
}

/** Best-effort C++ parameter type for one of `callFunction`'s extra (post-name) arguments —
 * these are almost always literals authored through the visual Action editor, so a direct
 * literal-type check covers the common case; anything else (a variable/expression a power user
 * wrote by hand) falls back to `float`, a safe default for a stub the user fills in themselves
 * anyway. */
function inferCppParamType(node: Node | undefined): string {
  if (node?.type === 'Literal') {
    const v = (node as unknown as { value: unknown }).value
    if (typeof v === 'boolean') return 'bool'
    if (typeof v === 'string') return 'const char*'
    if (typeof v === 'number') return 'float'
  }
  return 'float'
}

function colorLiteral(css: string): string | null {
  const hex = css.trim().match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return `lv_color_hex(0x${h.toUpperCase()})`
  }
  return null
}

interface BindingEntry {
  receiverText: string
  varName: string
  method: 'bindText' | 'bindValue' | 'bindVisible'
  argNode: Node
  /** The optional 2nd `{min, max, format, unit, fallback}` argument literal object — see
   * A5's PropertiesPanel BindingsSection / visualBindings.ts. `fallback` is intentionally not
   * read at codegen time (see parseBindingOptions' own comment) — min/max/format/unit only. */
  optionsNode?: Node
}

interface BindingOptions {
  min?: number
  max?: number
  format?: string
  unit?: string
}

class Emitter {
  errors: ScriptError[] = []
  variables: string[] = []
  functionPrototypes: string[] = []
  functions: string[] = []
  eventHandlers: CodegenEventHandler[] = []
  timers: CodegenTimer[] = []
  initStatements: string[] = []
  hardwareStubs: string[] = []
  /** Every top-level `function name(...) {...}` already declared in the script — a `callFunction`
   * action naming one of these calls it directly instead of generating a redundant stub (see
   * generateScriptCpp's pre-scan, which populates this before any statement is rendered) — and
   * every OTHER name a `callFunction` action calls gets exactly one generated stub (this set also
   * tracks those, so calling the same custom-function name from several actions/events only ever
   * emits its stub once). */
  declaredFunctionNames = new Set<string>()
  private bindings: BindingEntry[] = []
  private symbolTable = new Map<string, UiWidget>()
  private varTypes = new Map<string, ExprType>()
  private timerCounter = 0
  /** Names later assigned a `ui.setInterval`/`setTimeout` result somewhere in the script (found
   * by a pre-scan in run(), before any statement is rendered) — lets a top-level `let timer =
   * null;` (the flagship Progress Bar example's own shape: declared once, assigned inside a
   * click handler) be typed as `lv_timer_t*` instead of the generic `auto`/nullptr inference,
   * which wouldn't compile once later reassigned to a real timer handle. */
  private timerVarNames = new Set<string>()

  constructor(private ctx: CodegenContext, private source: string) {}

  private line(node: Node): number {
    return node.loc?.start.line ?? 1
  }

  private err(node: Node, message: string, suggestion?: string) {
    this.errors.push({ line: this.line(node), message, suggestion })
  }

  private srcOf(node: Node): string {
    return this.source.slice(node.start, node.end)
  }

  // -----------------------------------------------------------------------------------------
  // Widget reference resolution — `const x = ui.get("#foo")` bindings (top-level only) plus
  // inline `ui.get("#foo").method(...)` — shared by every place that needs "which widget does
  // this expression refer to."
  // -----------------------------------------------------------------------------------------

  private isUiGetCall(node: Node): { selector: string } | null {
    if (node.type !== 'CallExpression') return null
    const call = node as unknown as { callee: Node; arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') return null
    const m = call.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier') return null
    const objName = m.object.type === 'Identifier' ? (m.object as unknown as { name: string }).name : null
    const propName = (m.property as unknown as { name: string }).name
    if (objName !== 'ui' || propName !== 'get') return null
    if (call.arguments.length === 0 || call.arguments[0].type !== 'Literal') return null
    const selector = (call.arguments[0] as unknown as { value: unknown }).value
    return typeof selector === 'string' ? { selector } : null
  }

  private resolveWidgetRef(node: Node): UiWidget | undefined {
    if (node.type === 'Identifier') {
      return this.symbolTable.get((node as unknown as { name: string }).name)
    }
    const uiGet = this.isUiGetCall(node)
    if (uiGet) {
      const w = selectFirst(this.ctx.widgets, uiGet.selector)
      if (!w) this.err(node, `ui.get("${uiGet.selector}") doesn't match any widget in the design.`, 'Check the id/class/tag spelling against the HTML editor.')
      return w ?? undefined
    }
    return undefined
  }

  // -----------------------------------------------------------------------------------------
  // Expression rendering
  // -----------------------------------------------------------------------------------------

  private asCStr(node: Node): string {
    const r = this.renderExpr(node)
    if (r.type === 'cstr') return r.text
    if (r.type === 'String') return `${r.text}.c_str()`
    return `String(${r.text}).c_str()`
  }

  private asStringable(r: RenderedExpr): string {
    return r.type === 'String' ? r.text : `String(${r.text})`
  }

  /** Reads a binding's optional `{min, max, format, unit, fallback}` object literal — only
   * literal `min`/`max` numbers and `format`/`unit` strings are recognized (matches every other
   * "must be a literal for export" rule in this file, and is always true of options authored via
   * the BindingsSection UI). `fallback` is deliberately not read here: in C++ a Variable Manager
   * value is always initialized to its declared default (see lvglExport.ts's per-variable static
   * var), so there's no "undefined" state to fall back from at export time the way preview's
   * JS `data` proxy can hit before a first write — fallback is a preview-only convenience,
   * documented as such in the BindingsSection UI. */
  private parseBindingOptions(node: Node | undefined): BindingOptions {
    if (!node || node.type !== 'ObjectExpression') return {}
    const props = node as unknown as { properties: { key: { name?: string; value?: unknown }; value: Node }[] }
    const out: BindingOptions = {}
    for (const p of props.properties) {
      const key = p.key.name ?? String(p.key.value)
      const litVal = p.value.type === 'Literal' ? (p.value as unknown as { value: unknown }).value : undefined
      if (key === 'min' && typeof litVal === 'number') out.min = litVal
      else if (key === 'max' && typeof litVal === 'number') out.max = litVal
      else if (key === 'format' && typeof litVal === 'string') out.format = litVal
      else if (key === 'unit' && typeof litVal === 'string') out.unit = litVal
    }
    return out
  }

  /** `bindValue`'s numeric value, min/max-clamped when the options object specifies either. */
  private renderBindValueExpr(value: RenderedExpr, opts: BindingOptions): string {
    let expr = value.text
    if (typeof opts.min === 'number') expr = `((${expr}) < ${opts.min}f ? ${opts.min}f : (${expr}))`
    if (typeof opts.max === 'number') expr = `((${expr}) > ${opts.max}f ? ${opts.max}f : (${expr}))`
    return expr
  }

  /** `bindText`'s displayed string — `format` (containing a literal `{value}` placeholder, known
   * entirely at export/codegen time since it's a literal) splits into a static prefix/suffix
   * concatenated around the live value; otherwise a plain `unit` suffix is appended when given. */
  private renderBindTextExpr(value: RenderedExpr, opts: BindingOptions): string {
    const valueText = this.asStringable(value)
    if (opts.format && opts.format.includes('{value}')) {
      const idx = opts.format.indexOf('{value}')
      const prefix = opts.format.slice(0, idx)
      const suffix = opts.format.slice(idx + '{value}'.length)
      return `(String(${escapeCString(prefix)}) + (${valueText}) + String(${escapeCString(suffix)}))`
    }
    if (opts.unit) return `((${valueText}) + String(${escapeCString(opts.unit)}))`
    return valueText
  }

  private renderExpr(node: Node): RenderedExpr {
    switch (node.type) {
      case 'Literal': {
        const lit = node as unknown as { value: unknown }
        if (typeof lit.value === 'string') return { text: escapeCString(lit.value), type: 'cstr' }
        if (typeof lit.value === 'boolean') return { text: lit.value ? 'true' : 'false', type: 'boolean' }
        if (typeof lit.value === 'number') return { text: String(lit.value), type: 'number' }
        if (lit.value === null) return { text: 'nullptr', type: 'unknown' }
        this.err(node, 'Unsupported literal value.')
        return { text: '0', type: 'unknown' }
      }
      case 'Identifier': {
        const name = (node as unknown as { name: string }).name
        const widget = this.symbolTable.get(name)
        if (widget) return { text: this.ctx.varNameForWidget(widget), type: 'unknown' }
        return { text: cIdent(name), type: this.varTypes.get(name) ?? 'unknown' }
      }
      case 'TemplateLiteral': {
        const t = node as unknown as { quasis: { value: { cooked: string } }[]; expressions: Node[] }
        const parts: string[] = []
        for (let i = 0; i < t.quasis.length; i++) {
          if (t.quasis[i].value.cooked) parts.push(escapeCString(t.quasis[i].value.cooked))
          if (i < t.expressions.length) parts.push(this.asStringable(this.renderExpr(t.expressions[i])))
        }
        return { text: `(${parts.join(' + ')})`, type: 'String' }
      }
      case 'BinaryExpression': {
        const b = node as unknown as { left: Node; right: Node; operator: string }
        const left = this.renderExpr(b.left)
        const right = this.renderExpr(b.right)
        if (b.operator === '+') {
          if (left.type === 'number' && right.type === 'number') return { text: `(${left.text} + ${right.text})`, type: 'number' }
          return { text: `(${this.asStringable(left)} + ${this.asStringable(right)})`, type: 'String' }
        }
        if (['-', '*', '/', '%'].includes(b.operator)) return { text: `(${left.text} ${b.operator} ${right.text})`, type: 'number' }
        const op = b.operator === '===' ? '==' : b.operator === '!==' ? '!=' : b.operator
        return { text: `(${left.text} ${op} ${right.text})`, type: 'boolean' }
      }
      case 'LogicalExpression': {
        const l = node as unknown as { left: Node; right: Node; operator: string }
        const op = l.operator === '&&' ? '&&' : '||'
        return { text: `(${this.renderExpr(l.left).text} ${op} ${this.renderExpr(l.right).text})`, type: 'boolean' }
      }
      case 'UnaryExpression': {
        const u = node as unknown as { argument: Node; operator: string }
        const arg = this.renderExpr(u.argument)
        return { text: `(${u.operator}${arg.text})`, type: u.operator === '!' ? 'boolean' : arg.type }
      }
      case 'ConditionalExpression': {
        const c = node as unknown as { test: Node; consequent: Node; alternate: Node }
        const cons = this.renderExpr(c.consequent)
        const alt = this.renderExpr(c.alternate)
        return { text: `(${this.asBoolCondition(c.test)} ? ${cons.text} : ${alt.text})`, type: cons.type }
      }
      case 'CallExpression':
        return this.renderCallExpr(node)
      case 'MemberExpression': {
        // Only `data.<name>` (a Variable Manager entry read) is a supported bare member
        // expression — everything else (widget refs) only ever appears as the object of a
        // CallExpression, handled by renderCallExpr, not here.
        const m = node as unknown as { object: Node; property: Node; computed: boolean }
        if (!m.computed && m.object.type === 'Identifier' && (m.object as unknown as { name: string }).name === 'data' && m.property.type === 'Identifier') {
          const varName = (m.property as unknown as { name: string }).name
          const info = this.ctx.identForVariableName(varName)
          if (!info) {
            this.err(node, `data.${varName} isn't declared in the Variable Manager.`, 'Add it there first (Variables tab), or check the spelling.')
            return { text: '0', type: 'unknown' }
          }
          return { text: `${info.getter}()`, type: info.type }
        }
        this.err(node, 'Only data.<variable> is supported as a plain expression — everything else must be a widget reference used as target.method(...).')
        return { text: '0', type: 'unknown' }
      }
      case 'ArrayExpression':
        this.err(node, 'Arrays are not supported in exported code.', 'Use ui.getAll() results only for counting, not export — export one widget reference at a time.')
        return { text: '0', type: 'unknown' }
      default:
        this.err(node, `"${node.type}" can't be converted to C++.`)
        return { text: '0', type: 'unknown' }
    }
  }

  private asBoolCondition(node: Node): string {
    const r = this.renderExpr(node)
    if (r.type === 'String') return `(${r.text}.length() > 0)`
    if (r.type === 'cstr') return `(${r.text}[0] != '\\0')`
    return r.text
  }

  private renderCallExpr(node: Node): RenderedExpr {
    const call = node as unknown as { callee: Node; arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') {
      // Plain function call: a user-defined top-level function, e.g. updateDownloadProgress(value).
      if (call.callee.type === 'Identifier') {
        const name = cIdent((call.callee as unknown as { name: string }).name)
        const args = call.arguments.map((a) => this.renderExpr(a).text)
        return { text: `${name}(${args.join(', ')})`, type: 'unknown' }
      }
      this.err(node, 'Unsupported function call shape.')
      return { text: '0', type: 'unknown' }
    }

    const member = call.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (member.computed || member.property.type !== 'Identifier') {
      this.err(node, 'Dynamic method calls are not supported for export.')
      return { text: '0', type: 'unknown' }
    }
    const method = (member.property as unknown as { name: string }).name
    const objIsUi = member.object.type === 'Identifier' && (member.object as unknown as { name: string }).name === 'ui'

    if (objIsUi) return this.renderUiCall(node, method, call.arguments)

    const widget = this.resolveWidgetRef(member.object)
    if (!widget) {
      this.err(node, `Can't tell which widget "${this.srcOf(member.object)}" refers to.`, 'Only ui.get("...") results (optionally stored in a const) are supported as widget references.')
      return { text: '0', type: 'unknown' }
    }
    return this.renderWidgetMethodCall(node, widget, method, call.arguments)
  }

  private renderUiCall(node: Node, method: string, args: Node[]): RenderedExpr {
    switch (method) {
      case 'showScreen': {
        const nameNode = args[0]
        if (!nameNode || nameNode.type !== 'Literal' || typeof (nameNode as unknown as { value: unknown }).value !== 'string') {
          this.err(node, 'ui.showScreen(name) requires a literal screen name for export.')
          return { text: '', type: 'unknown' }
        }
        const name = (nameNode as unknown as { value: string }).value
        const fn = this.ctx.screenFnNameByName(name)
        if (!fn) {
          this.err(node, `ui.showScreen("${name}"): no screen named "${name}" exists.`)
          return { text: '', type: 'unknown' }
        }
        return { text: `${this.ctx.namespaceName}::${fn}()`, type: 'unknown' }
      }
      case 'goBack':
        return { text: `${this.ctx.namespaceName}::GoBack()`, type: 'unknown' }
      case 'setInterval':
      case 'setTimeout':
      case 'clearInterval':
      case 'clearTimeout':
        this.err(node, `ui.${method}(...) is only supported as its own statement (optionally assigned to a variable), not nested inside another expression.`)
        return { text: '0', type: 'unknown' }
      case 'get':
      case 'getAll':
        this.err(node, `ui.${method}(...) can only be used to obtain a widget reference (e.g. const x = ui.get("#id")), not inline elsewhere.`)
        return { text: '0', type: 'unknown' }
      default:
        this.err(node, `ui.${method}(...) is not a supported UI API call.`)
        return { text: '0', type: 'unknown' }
    }
  }

  private renderWidgetMethodCall(node: Node, widget: UiWidget, method: string, argNodes: Node[]): RenderedExpr {
    const varName = this.ctx.varNameForWidget(widget)

    if (method === 'getValue') {
      return { text: `${valueGetCall(widget.type)}(${varName})`, type: 'number' }
    }
    if (method === 'setSource') {
      const nameNode = argNodes[0]
      if (!nameNode || nameNode.type !== 'Literal' || typeof (nameNode as unknown as { value: unknown }).value !== 'string') {
        this.err(node, 'setSource(name) requires a literal asset name for export.')
        return { text: '', type: 'unknown' }
      }
      const name = (nameNode as unknown as { value: string }).value
      const ident = this.ctx.identForAssetName(name)
      if (!ident) {
        this.err(node, `setSource("${name}"): no imported asset has that name.`)
        return { text: '', type: 'unknown' }
      }
      this.initStatements.push(`lv_image_set_src(${varName}, &${ident});`)
      return { text: '', type: 'unknown' }
    }
    if (method === 'addClass' || method === 'removeClass') {
      const nameNode = argNodes[0]
      if (!nameNode || nameNode.type !== 'Literal' || typeof (nameNode as unknown as { value: unknown }).value !== 'string') {
        this.err(node, `${method}(name) requires a literal class name for export.`)
        return { text: '', type: 'unknown' }
      }
      const cls = (nameNode as unknown as { value: string }).value
      const ident = this.ctx.identForClassSelector(cls)
      if (!ident) {
        return { text: `// ${method}("${cls}") — no CSS rule uses this class, nothing to apply at runtime`, type: 'unknown' }
      }
      const call = method === 'addClass' ? `lv_obj_add_style(${varName}, &${ident}, LV_PART_MAIN | LV_STATE_DEFAULT);` : `lv_obj_remove_style(${varName}, &${ident}, LV_PART_MAIN | LV_STATE_DEFAULT);`
      return { text: call, type: 'unknown' }
    }
    if (method === 'updateVariable') {
      const nameNode = argNodes[0]
      if (!nameNode || nameNode.type !== 'Literal' || typeof (nameNode as unknown as { value: unknown }).value !== 'string') {
        this.err(node, 'updateVariable(name, value) requires a literal variable name for export.')
        return { text: '', type: 'unknown' }
      }
      const varName = (nameNode as unknown as { value: string }).value
      const info = this.ctx.identForVariableName(varName)
      if (!info) {
        this.err(node, `updateVariable("${varName}", ...): no variable named "${varName}" in the Variable Manager.`, 'Add it there first (Variables tab), or check the spelling.')
        return { text: '', type: 'unknown' }
      }
      const valueNode = argNodes[1]
      const value = valueNode ? this.renderExpr(valueNode).text : '0'
      return { text: `${info.setter}(${value});`, type: 'unknown' }
    }
    if (method === 'callFunction') {
      const nameNode = argNodes[0]
      if (!nameNode || nameNode.type !== 'Literal' || typeof (nameNode as unknown as { value: unknown }).value !== 'string') {
        this.err(node, 'callFunction(name, ...) requires a literal function name for export.')
        return { text: '', type: 'unknown' }
      }
      const rawName = (nameNode as unknown as { value: string }).value
      const fnName = sanitizeFunctionName(rawName)
      const restNodes = argNodes.slice(1)
      const restArgs = restNodes.map((a) => this.renderExpr(a).text)
      if (!this.declaredFunctionNames.has(fnName)) {
        this.declaredFunctionNames.add(fnName)
        const params = restNodes.map((a, i) => `${inferCppParamType(a)} arg${i}`).join(', ')
        this.hardwareStubs.push(
          [
            `// Called via a "Call custom function" / hardware action wired up in the Logic tab or`,
            `// Properties panel's Events section — fill in what this should actually do (e.g.`,
            `// digitalWrite, a servo/motor call, Serial.print, an HTTP/MQTT/BLE send).`,
            `void ${fnName}(${params}) {`,
            `  // USER CODE BEGIN ${fnName}`,
            `  // TODO: implement ${fnName}`,
            `  // USER CODE END ${fnName}`,
            `}`
          ].join('\n')
        )
      }
      return { text: `${fnName}(${restArgs.join(', ')});`, type: 'unknown' }
    }
    if (method === 'bindText' || method === 'bindValue' || method === 'bindVisible') {
      const optionsNode = argNodes[1] && argNodes[1].type === 'ObjectExpression' ? argNodes[1] : undefined
      this.bindings.push({ receiverText: varName, varName, method, argNode: argNodes[0], optionsNode })
      return { text: '', type: 'unknown' }
    }
    if (method === 'animate') {
      return this.renderAnimate(node, widget, argNodes[0])
    }
    if (method === 'on') {
      this.err(node, 'widget.on(...) is only supported at the top level of the script, not nested inside another call.')
      return { text: '', type: 'unknown' }
    }

    const spec = ACTION_TABLE[method]
    if (!spec) {
      if (CODEGEN_SPECIAL_METHODS.has(method)) {
        this.err(node, `${method}(...) isn't fully supported for export yet.`)
      } else {
        this.err(node, `"${method}" is not a supported widget action.`, 'See the Widget Actions reference in the Logic tab.')
      }
      return { text: '0', type: 'unknown' }
    }
    if (spec.appliesTo !== 'any' && !spec.appliesTo.includes(widget.type)) {
      this.err(node, `"${method}" doesn't apply to a ${widget.type} widget.`)
      return { text: '0', type: 'unknown' }
    }

    const args = this.renderActionArgs(method, argNodes)
    // A button's text lives on its label CHILD object, not the button object itself (see
    // widgetCreateCalls' button case in lvglExport.ts, which always creates `${varName}_label`)
    // — every other setText-capable kind (label/checkbox/textarea) sets text on itself directly.
    const target = method === 'setText' && widget.type === 'button' ? `${varName}_label` : varName
    if (spec.kind === 'read' && spec.cppExpr) {
      return { text: spec.cppExpr(target, args), type: 'number' }
    }
    if (spec.cpp) {
      const lines = spec.cpp(target, args, widget.type)
      return { text: lines.join(' '), type: 'unknown' }
    }
    return { text: '', type: 'unknown' }
  }

  /** A couple of actions need a `const char*` (setText/setColor/setBackground's hex) rather
   * than the plain renderExpr().text every other numeric action uses. */
  private renderActionArgs(method: string, argNodes: Node[]): string[] {
    if (method === 'setText') return [argNodes[0] ? this.asCStr(argNodes[0]) : '""']
    if (method === 'setColor' || method === 'setBackground') {
      const n = argNodes[0]
      if (!n || n.type !== 'Literal' || typeof (n as unknown as { value: unknown }).value !== 'string') {
        this.err(n ?? argNodes[0], `${method}(...) requires a literal hex color string for export (e.g. "#00ff00").`, 'Variable colors are not supported yet.')
        return ['lv_color_black()']
      }
      const lit = colorLiteral((n as unknown as { value: string }).value)
      if (!lit) {
        this.err(n, `"${(n as unknown as { value: string }).value}" isn't a recognized hex color.`, 'Use a #rrggbb or #rgb hex string.')
        return ['lv_color_black()']
      }
      return [lit]
    }
    return argNodes.map((a) => this.renderExpr(a).text)
  }

  private renderAnimate(node: Node, widget: UiWidget, configNode: Node | undefined): RenderedExpr {
    if (!configNode || configNode.type !== 'ObjectExpression') {
      this.err(node, 'animate({...}) requires an object literal for export.')
      return { text: '', type: 'unknown' }
    }
    const props = configNode as unknown as { properties: { key: { name?: string; value?: unknown }; value: Node }[] }
    const varName = this.ctx.varNameForWidget(widget)
    const lines: string[] = []
    let duration = '300'
    let easing: 'LV_ANIM_PATH_LINEAR' | 'LV_ANIM_PATH_EASE_OUT' | 'LV_ANIM_PATH_EASE_IN' | 'LV_ANIM_PATH_EASE_IN_OUT' = 'LV_ANIM_PATH_LINEAR'
    const targets: { setter: string; getter: string; value: string }[] = []
    for (const p of props.properties) {
      const key = p.key.name ?? String(p.key.value)
      if (key === 'duration') {
        duration = this.renderExpr(p.value).text
        continue
      }
      if (key === 'easing') {
        const v = p.value.type === 'Literal' ? String((p.value as unknown as { value: unknown }).value) : 'linear'
        easing = v === 'easeOut' ? 'LV_ANIM_PATH_EASE_OUT' : v === 'easeIn' ? 'LV_ANIM_PATH_EASE_IN' : v === 'easeInOut' ? 'LV_ANIM_PATH_EASE_IN_OUT' : 'LV_ANIM_PATH_LINEAR'
        continue
      }
      const value = this.renderExpr(p.value).text
      if (key === 'x') targets.push({ setter: 'lv_obj_set_x', getter: 'lv_obj_get_x', value })
      else if (key === 'y') targets.push({ setter: 'lv_obj_set_y', getter: 'lv_obj_get_y', value })
      else if (key === 'opacity') targets.push({ setter: `__kibo_anim_set_opa_${varName}`, getter: '', value: `(int32_t)((${value}) * 255 / 100)` })
      else this.err(node, `animate({ ${key}: ... }) — "${key}" isn't supported for export yet.`, 'Supported: x, y, opacity, duration, easing.')
    }
    for (const t of targets) {
      if (t.setter.startsWith('__kibo_anim_set_opa_')) {
        lines.push(`lv_obj_set_style_opa(${varName}, (lv_opa_t)(${t.value}), LV_PART_MAIN);`)
        continue
      }
      lines.push(`{`)
      lines.push(`  static lv_anim_t a; lv_anim_init(&a);`)
      lines.push(`  lv_anim_set_var(&a, ${varName});`)
      lines.push(`  lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)${t.setter});`)
      lines.push(`  lv_anim_set_values(&a, ${t.getter}(${varName}), (int32_t)(${t.value}));`)
      lines.push(`  lv_anim_set_duration(&a, (uint32_t)(${duration}));`)
      lines.push(`  lv_anim_set_path_cb(&a, ${easing.includes('LINEAR') ? 'lv_anim_path_linear' : easing.includes('EASE_OUT') ? 'lv_anim_path_ease_out' : easing.includes('EASE_IN_OUT') ? 'lv_anim_path_ease_in_out' : 'lv_anim_path_ease_in'});`)
      lines.push(`  lv_anim_start(&a);`)
      lines.push(`}`)
    }
    return { text: lines.join('\n'), type: 'unknown' }
  }

  // -----------------------------------------------------------------------------------------
  // Statement rendering
  // -----------------------------------------------------------------------------------------

  private renderStatement(node: Node, out: string[]): void {
    switch (node.type) {
      case 'BlockStatement': {
        const b = node as unknown as { body: Node[] }
        for (const s of b.body) this.renderStatement(s, out)
        return
      }
      case 'EmptyStatement':
        return
      case 'ExpressionStatement': {
        const e = node as unknown as { expression: Node }
        this.renderExpressionStatement(e.expression, out)
        return
      }
      case 'IfStatement': {
        const i = node as unknown as { test: Node; consequent: Node; alternate: Node | null }
        out.push(`if (${this.asBoolCondition(i.test)}) {`)
        const cons: string[] = []
        this.renderStatement(i.consequent, cons)
        out.push(...cons.map((l) => `  ${l}`))
        if (i.alternate) {
          out.push('} else {')
          const alt: string[] = []
          this.renderStatement(i.alternate, alt)
          out.push(...alt.map((l) => `  ${l}`))
        }
        out.push('}')
        return
      }
      case 'VariableDeclaration': {
        const v = node as unknown as { kind: string; declarations: { id: { type: string; name?: string }; init: Node | null }[] }
        for (const d of v.declarations) {
          if (d.id.type !== 'Identifier' || !d.id.name) continue
          if (d.init && this.isUiGetCall(d.init)) {
            const w = this.resolveWidgetRef(d.init)
            if (w) this.symbolTable.set(d.id.name, w)
            continue
          }
          if (this.timerVarNames.has(d.id.name)) {
            // No declaration emitted here — lvglExport.ts declares `static lv_timer_t*` for
            // every name appearing in codegen.timers exactly once, and tryRenderTimerCall (see
            // below) reuses this same name as the C++ timer variable once it's actually created.
            continue
          }
          const rendered = d.init ? this.renderExpr(d.init) : { text: '0', type: 'unknown' as ExprType }
          this.varTypes.set(d.id.name, rendered.type)
          out.push(`${cppTypeFor(rendered.type)} ${cIdent(d.id.name)} = ${rendered.text};`)
        }
        return
      }
      case 'ReturnStatement': {
        const r = node as unknown as { argument: Node | null }
        out.push(r.argument ? `return ${this.renderExpr(r.argument).text};` : 'return;')
        return
      }
      default:
        this.err(node, `"${node.type}" can't be converted to C++.`)
    }
  }

  private renderExpressionStatement(expr: Node, out: string[]): void {
    if (expr.type === 'AssignmentExpression') {
      const a = expr as unknown as { left: Node; right: Node; operator: string }
      // `timer = ui.setInterval(...)` (re-assigning an already-declared variable, as opposed to
      // `let timer = ui.setInterval(...)`, which VariableDeclaration handling below covers) —
      // the flagship Progress Bar example's own shape: `let timer = null;` up top, then
      // `timer = ui.setInterval(...)` inside the click handler.
      if (a.operator === '=' && a.left.type === 'Identifier' && a.right.type === 'CallExpression' && this.tryRenderTimerCall(a.right, (a.left as unknown as { name: string }).name, out)) {
        return
      }
      // `data.<name> = value` writes through the Variable Manager entry's generated setter —
      // renderExpr's own MemberExpression case only ever produces a getter CALL (an rvalue), so
      // assignment needs this dedicated branch rather than falling through to the generic
      // `left op right;` rendering below (which would emit the invalid `Getter() = value;`).
      if (a.left.type === 'MemberExpression') {
        const m = a.left as unknown as { object: Node; property: Node; computed: boolean }
        if (!m.computed && m.object.type === 'Identifier' && (m.object as unknown as { name: string }).name === 'data' && m.property.type === 'Identifier') {
          const varName = (m.property as unknown as { name: string }).name
          const info = this.ctx.identForVariableName(varName)
          if (!info) {
            this.err(expr, `data.${varName} isn't declared in the Variable Manager.`, 'Add it there first (Variables tab), or check the spelling.')
            return
          }
          if (a.operator !== '=') {
            this.err(expr, `data.${varName} ${a.operator} ... — only plain assignment (=) is supported for variables, not compound operators.`)
            return
          }
          out.push(`${info.setter}(${this.renderExpr(a.right).text});`)
          return
        }
      }
      out.push(`${this.renderExpr(a.left).text} ${a.operator} ${this.renderExpr(a.right).text};`)
      return
    }
    if (expr.type === 'UpdateExpression') {
      const u = expr as unknown as { argument: Node; operator: string; prefix: boolean }
      const arg = this.renderExpr(u.argument).text
      out.push(u.prefix ? `${u.operator}${arg};` : `${arg}${u.operator};`)
      return
    }
    if (expr.type === 'CallExpression') {
      const timer = this.tryRenderTimerCall(expr, null, out)
      if (timer) return
      const rendered = this.renderExpr(expr)
      if (rendered.text) out.push(`${rendered.text}${rendered.text.trim().endsWith(';') || rendered.text.trim().endsWith('}') ? '' : ';'}`)
      return
    }
    this.err(expr, `"${expr.type}" has no effect and can't be exported.`)
  }

  /** `ui.setInterval/setTimeout(callback, ms)` and `ui.clearInterval/clearTimeout(timer)` need
   * special handling wherever they appear (top-level, inside a function, inside another event
   * handler) — a real lv_timer_t* variable is created per call and (if the JS assigned the
   * result to a variable) that variable is remembered so a later ui.clearInterval(x) resolves
   * back to the same C++ timer. Returns true if `node` was a timer call (handled), else false. */
  private tryRenderTimerCall(node: Node, assignedName: string | null, out: string[]): boolean {
    const call = node as unknown as { callee: Node; arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') return false
    const m = call.callee as unknown as { object: Node; property: Node }
    if (m.object.type !== 'Identifier' || (m.object as unknown as { name: string }).name !== 'ui') return false
    if (m.property.type !== 'Identifier') return false
    const method = (m.property as unknown as { name: string }).name

    if (method === 'setInterval' || method === 'setTimeout') {
      const cbNode = call.arguments[0]
      const msNode = call.arguments[1]
      if (!cbNode || (cbNode.type !== 'ArrowFunctionExpression' && cbNode.type !== 'FunctionExpression')) {
        this.err(node, `ui.${method}(...) requires a callback function literal for export.`)
        return true
      }
      const ms = msNode ? this.renderExpr(msNode).text : '1000'
      // Reuse the JS variable's own name as the C++ timer variable when it was pre-declared as
      // one (see timerVarNames/run()'s pre-scan) — e.g. `let timer = null;` up top, later
      // `timer = ui.setInterval(...)` inside a click handler — rather than allocating a second,
      // unused `s_timer_N` alongside the already-declared `static lv_timer_t* timer`.
      const varName = assignedName && this.timerVarNames.has(assignedName) ? cIdent(assignedName) : (() => {
        this.timerCounter++
        return `s_timer_${this.timerCounter}`
      })()
      // Registered BEFORE rendering the callback body — a timer very commonly clears itself
      // from inside its own tick (the flagship Progress Bar example does exactly this:
      // `if (value >= 100) ui.clearInterval(timer);` inside the same callback that created it),
      // so symbolTimerVars must already know about `assignedName` while that body is rendered,
      // not only after.
      if (assignedName) {
        this.varTypes.set(assignedName, 'unknown')
        this.symbolTimerVars.set(assignedName, varName)
      }
      const body: string[] = []
      const fn = cbNode as unknown as { body: Node }
      if (fn.body.type === 'BlockStatement') this.renderStatement(fn.body, body)
      else this.renderExpressionStatement(fn.body, body)
      this.timers.push({ varName, intervalMs: ms, repeatOnce: method === 'setTimeout', bodyLines: body })
      // Created right here — wherever this statement actually runs (top-level init, inside a
      // function, or inside an event handler, e.g. "start a repeating timer on button click")
      // — not universally in Begin(), matching real LVGL/JS timer semantics: the timer starts
      // when this line executes, not at startup.
      out.push(`${varName} = lv_timer_create(${varName}_cb, (uint32_t)(${ms}), NULL);`)
      if (method === 'setTimeout') out.push(`if (${varName}) lv_timer_set_repeat_count(${varName}, 1);`)
      return true
    }
    if (method === 'clearInterval' || method === 'clearTimeout') {
      const argNode = call.arguments[0]
      const jsName = argNode && argNode.type === 'Identifier' ? (argNode as unknown as { name: string }).name : null
      const cppVar = jsName ? this.symbolTimerVars.get(jsName) : null
      if (!cppVar) {
        this.err(node, `ui.${method}(...) argument isn't a timer created by ui.setInterval/setTimeout in this script.`)
        return true
      }
      out.push(`if (${cppVar}) { lv_timer_delete(${cppVar}); ${cppVar} = NULL; }`)
      return true
    }
    return false
  }

  private symbolTimerVars = new Map<string, string>()

  private isTimerCreateCall(node: Node): boolean {
    if (node.type !== 'CallExpression') return false
    const call = node as unknown as { callee: Node }
    if (call.callee.type !== 'MemberExpression') return false
    const m = call.callee as unknown as { object: Node; property: Node }
    if (m.object.type !== 'Identifier' || (m.object as unknown as { name: string }).name !== 'ui') return false
    if (m.property.type !== 'Identifier') return false
    const method = (m.property as unknown as { name: string }).name
    return method === 'setInterval' || method === 'setTimeout'
  }

  // -----------------------------------------------------------------------------------------
  // Top-level pass
  // -----------------------------------------------------------------------------------------

  run(program: Program): CodegenResult {
    // Pass 0: find every identifier ever assigned a ui.setInterval/setTimeout result, anywhere
    // in the script (see timerVarNames' own comment) — must happen before any statement is
    // rendered, since the assignment can appear lexically after the variable's declaration.
    walkAllNodes(program, (node) => {
      if (node.type === 'AssignmentExpression') {
        const a = node as unknown as { left: Node; right: Node; operator: string }
        if (a.operator === '=' && a.left.type === 'Identifier' && this.isTimerCreateCall(a.right)) {
          this.timerVarNames.add((a.left as unknown as { name: string }).name)
        }
      } else if (node.type === 'VariableDeclarator') {
        const d = node as unknown as { id: { type: string; name?: string }; init: Node | null }
        if (d.id.type === 'Identifier' && d.id.name && d.init && this.isTimerCreateCall(d.init)) {
          this.timerVarNames.add(d.id.name)
        }
      }
    })

    // Pass 1: register every top-level FunctionDeclaration name first, so forward references
    // between top-level statements (calling a function declared later in the file) work — C++
    // needs a prototype before use, which we emit regardless of declaration order.
    for (const stmt of program.body) {
      if (stmt.type === 'FunctionDeclaration') {
        const f = stmt as unknown as { id: { name: string } }
        this.functionPrototypes.push(`void ${cIdent(f.id.name)}(${this.paramList(stmt)});`)
      }
    }

    for (const stmt of program.body) {
      this.renderTopLevel(stmt)
    }

    if (this.bindings.length > 0) {
      const lines: string[] = []
      for (const b of this.bindings) {
        const value = this.renderExpr(b.argNode)
        const opts = this.parseBindingOptions(b.optionsNode)
        if (b.method === 'bindText') lines.push(`lv_label_set_text(${b.varName}, (${this.renderBindTextExpr(value, opts)}).c_str());`)
        else if (b.method === 'bindValue') lines.push(`lv_bar_set_value(${b.varName}, (int32_t)(${this.renderBindValueExpr(value, opts)}), LV_ANIM_OFF);`)
        else lines.push(`if (${this.asBoolCondition(b.argNode)}) { lv_obj_remove_flag(${b.varName}, LV_OBJ_FLAG_HIDDEN); } else { lv_obj_add_flag(${b.varName}, LV_OBJ_FLAG_HIDDEN); }`)
      }
      this.updateBindingsFnLines = lines
    }

    return {
      variables: this.variables,
      functionPrototypes: this.functionPrototypes,
      functions: this.functions,
      eventHandlers: this.eventHandlers,
      timers: this.timers,
      initStatements: this.initStatements,
      hardwareStubs: this.hardwareStubs,
      updateBindingsFn: this.updateBindingsFnLines,
      errors: this.errors
    }
  }

  private updateBindingsFnLines: string[] = []

  private paramList(fnNode: Node): string {
    const f = fnNode as unknown as { params: { name: string }[] }
    return f.params.map((p) => `float ${cIdent(p.name)}`).join(', ')
  }

  private renderTopLevel(stmt: Node): void {
    // `const x = ui.get(...)` — symbol table only, no C++ output.
    if (stmt.type === 'VariableDeclaration') {
      const v = stmt as unknown as { declarations: { id: { type: string; name?: string }; init: Node | null }[] }
      let allHandled = true
      for (const d of v.declarations) {
        if (d.id.type !== 'Identifier' || !d.id.name) continue
        if (d.init && this.isUiGetCall(d.init)) {
          const w = this.resolveWidgetRef(d.init)
          if (w) this.symbolTable.set(d.id.name, w)
        } else if (d.init && d.init.type === 'CallExpression' && this.tryRenderTimerCall(d.init, d.id.name, this.initStatements)) {
          // handled — the timer var name is registered inside tryRenderTimerCall
        } else {
          allHandled = false
        }
      }
      if (!allHandled) this.renderStatement(stmt, this.variables)
      return
    }

    if (stmt.type === 'FunctionDeclaration') {
      const f = stmt as unknown as { id: { name: string }; body: Node }
      const body: string[] = []
      this.renderStatement(f.body, body)
      this.functions.push([`void ${cIdent(f.id.name)}(${this.paramList(stmt)}) {`, ...body.map((l) => `  ${l}`), '}'].join('\n'))
      return
    }

    if (stmt.type === 'ExpressionStatement') {
      const e = stmt as unknown as { expression: Node }
      if (this.isHardwareOnCall(e.expression)) return // handled by generateScriptCpp's hardware pre-scan
      if (this.tryRenderEventRegistration(e.expression)) return
      if (e.expression.type === 'CallExpression' && this.tryRenderTimerCall(e.expression, null, this.initStatements)) return
      this.renderExpressionStatement(e.expression, this.initStatements)
      return
    }

    // Everything else (if/return/etc. at top level) runs once at init time.
    this.renderStatement(stmt, this.initStatements)
  }

  private isHardwareOnCall(expr: Node): boolean {
    if (expr.type !== 'CallExpression') return false
    const call = expr as unknown as { callee: Node }
    if (call.callee.type !== 'MemberExpression') return false
    const m = call.callee as unknown as { object: Node; property: Node }
    return m.object.type === 'Identifier' && (m.object as unknown as { name: string }).name === 'hardware' && m.property.type === 'Identifier'
  }

  private tryRenderEventRegistration(expr: Node): boolean {
    if (expr.type !== 'CallExpression') return false
    const call = expr as unknown as { callee: Node; arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') return false
    const m = call.callee as unknown as { object: Node; property: Node; computed: boolean }
    if (m.computed || m.property.type !== 'Identifier' || (m.property as unknown as { name: string }).name !== 'on') return false

    const widget = this.resolveWidgetRef(m.object)
    if (!widget) return false
    const eventNode = call.arguments[0]
    const cbNode = call.arguments[1]
    const nameNode = call.arguments[2]
    if (!eventNode || eventNode.type !== 'Literal' || typeof (eventNode as unknown as { value: unknown }).value !== 'string') {
      this.err(expr, 'widget.on(event, callback) requires a literal event name for export.')
      return true
    }
    if (!cbNode || (cbNode.type !== 'ArrowFunctionExpression' && cbNode.type !== 'FunctionExpression')) {
      this.err(expr, 'widget.on(event, callback) requires a callback function literal for export.')
      return true
    }
    const trigger = (eventNode as unknown as { value: string }).value
    const customName = nameNode && nameNode.type === 'Literal' && typeof (nameNode as unknown as { value: unknown }).value === 'string' ? (nameNode as unknown as { value: string }).value : undefined
    const body: string[] = []
    const fn = cbNode as unknown as { body: Node }
    if (fn.body.type === 'BlockStatement') this.renderStatement(fn.body, body)
    else this.renderExpressionStatement(fn.body, body)
    this.eventHandlers.push({ widgetId: widget.id, trigger, bodyLines: body, customName })
    return true
  }
}

export function cppTypeFor(type: ExprType): string {
  if (type === 'number') return 'float'
  if (type === 'boolean') return 'bool'
  if (type === 'cstr' || type === 'String') return 'String'
  return 'auto'
}

export function generateScriptCpp(program: Program, source: string, ctx: CodegenContext): CodegenResult {
  const emitter = new Emitter(ctx, source)

  // Every top-level `function name(...) {...}` the script already declares — scanned up front so
  // a callFunction("name", ...) action calling one of these gets a direct call instead of a
  // redundant generated stub (see Emitter.declaredFunctionNames' own comment).
  for (const stmt of program.body) {
    if (stmt.type !== 'FunctionDeclaration') continue
    const f = stmt as unknown as { id: { name?: string } | null }
    if (f.id?.name) emitter.declaredFunctionNames.add(f.id.name)
  }

  // hardware.onX(...) registrations — scanned up front (order-independent, unlike widget events)
  // so a hardware call nested anywhere still produces a stub; only literal-first-argument names
  // get a named stub, everything else falls back to a generic indexed name.
  let hwCounter = 0
  for (const stmt of program.body) {
    if (stmt.type !== 'ExpressionStatement') continue
    const expr = (stmt as unknown as { expression: Node }).expression
    if (expr.type !== 'CallExpression') continue
    const call = expr as unknown as { callee: Node; arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') continue
    const m = call.callee as unknown as { object: Node; property: Node }
    if (m.object.type !== 'Identifier' || (m.object as unknown as { name: string }).name !== 'hardware') continue
    if (m.property.type !== 'Identifier') continue
    const method = (m.property as unknown as { name: string }).name
    hwCounter++
    const firstArgLiteral = call.arguments[0]?.type === 'Literal' ? String((call.arguments[0] as unknown as { value: unknown }).value) : null
    const stubName = `on_${method.replace(/^on/, '').toLowerCase()}${firstArgLiteral ? `_${firstArgLiteral.replace(/[^a-zA-Z0-9]+/g, '_')}` : `_${hwCounter}`}`
    emitter.hardwareStubs.push(
      [
        `// hardware.${method}(${firstArgLiteral ? `"${firstArgLiteral}", ` : ''}...) — this exporter doesn't know your board's GPIO/sensor/radio setup.`,
        `// Call this function from your own hardware-polling code (e.g. in loop(), or from an interrupt/event callback).`,
        `static void ${stubName}(${method === 'onEncoderRotate' ? 'int direction' : method === 'onSensorChange' ? 'float value' : 'void'}) {`,
        `  // USER CODE BEGIN ${stubName}`,
        `  // TODO: handle the "${method}"${firstArgLiteral ? ` ("${firstArgLiteral}")` : ''} hardware event here.`,
        `  // USER CODE END ${stubName}`,
        `}`
      ].join('\n')
    )
  }

  return emitter.run(program)
}
