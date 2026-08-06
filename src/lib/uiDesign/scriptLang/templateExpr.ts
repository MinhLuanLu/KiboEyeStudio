// Data List `{{expr}}` template-string binding — the item template's own `text` field (and the
// "Visible when" field, a bare boolean expression with no `{{}}` wrapper) can reference the
// current row via `item.<field>` and any Variable Manager entry via `data.<name>`, e.g.
// `{{item.title}}`, `{{item.battery}}%`, `{{item.isOnline ? "Online" : "Offline"}}`. Deliberately
// NOT a general-purpose template language (no loops, no nested `{{}}`) — see this feature's plan
// for why: "keep expressions limited, predictable, and easy to export to C++." Preview evaluation
// lives here (real JS via `new Function(...)`, mirroring sandboxRuntime.ts's existing approach for
// script bindings); C++ compilation lives in codegen.ts's compileTemplateExpr/compileTemplateText,
// which reuse the SAME restricted-subset grammar (scriptLang/restrictedSubset.ts) this preview
// path is deliberately more permissive than — an expression that fails export-time validation can
// still preview fine, surfaced as a validation warning rather than a blocked canvas.

export type TemplateTextPart = { kind: 'literal'; text: string } | { kind: 'expr'; source: string; start: number; end: number }

const TEMPLATE_EXPR_RE = /\{\{([^{}]+)\}\}/g

/** Splits `text` into literal and `{{expr}}` parts, in order. No nested-brace support (an object
 * literal inside `{{ }}` is out of scope this pass) — `[^{}]+` deliberately stops at the first
 * `{`/`}` so a malformed/nested case degrades to literal text around unmatched braces rather than
 * silently swallowing content. */
export function parseTemplateText(text: string): TemplateTextPart[] {
  const parts: TemplateTextPart[] = []
  let lastIndex = 0
  TEMPLATE_EXPR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TEMPLATE_EXPR_RE.exec(text))) {
    if (m.index > lastIndex) parts.push({ kind: 'literal', text: text.slice(lastIndex, m.index) })
    parts.push({ kind: 'expr', source: m[1].trim(), start: m.index, end: m.index + m[0].length })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) parts.push({ kind: 'literal', text: text.slice(lastIndex) })
  return parts
}

export function hasTemplateExpr(text: string | undefined): boolean {
  if (!text) return false
  TEMPLATE_EXPR_RE.lastIndex = 0
  return TEMPLATE_EXPR_RE.test(text)
}

/** Evaluates every `{{expr}}` part in `text` against the current row (`item`) and the live
 * Variable Manager values (`data`), concatenating with any surrounding literal text — the preview
 * twin of codegen.ts's `compileTemplateText`. A throwing expression contributes an empty string
 * for that part (never crashes the canvas) and logs once via `onError`, not per evaluation, so a
 * live-repeated row (many instances re-evaluating every render) can't spam the console. */
export function evalTemplateTextPreview(text: string, item: Record<string, unknown>, data: Record<string, unknown>, onError?: (message: string) => void): string {
  const parts = parseTemplateText(text)
  if (parts.length === 0) return ''
  let out = ''
  for (const part of parts) {
    if (part.kind === 'literal') {
      out += part.text
      continue
    }
    out += String(evalTemplateExprPreview(part.source, item, data, '', onError))
  }
  return out
}

/** Evaluates a single bare boolean expression (no `{{}}` wrapper — used by "Visible when") —
 * truthy/falsy coerced the same way a real `if` would. */
export function evalBooleanExprPreview(source: string, item: Record<string, unknown>, data: Record<string, unknown>, onError?: (message: string) => void): boolean {
  if (!source.trim()) return true
  return Boolean(evalTemplateExprPreview(source, item, data, true, onError))
}

const VALID_JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** A bare field name (`{{title}}`, matching the spec's own literal examples: "Item title:
 * {{title}}") resolves against the current row directly, same as the explicit `item.title` form
 * — mirrors codegen.ts's `compileTemplateExpr`'s identical dual resolution exactly, so preview and
 * export can never disagree about which syntax is supported. Implemented by adding each of the
 * row's own keys as its own function parameter (shadowed by a real `item`/`data` param of the same
 * name, if any field happens to be called that) — keys that aren't valid bare JS identifiers
 * (spaces, leading digits, ...) simply aren't reachable as bare names in preview, only via
 * `item.<key>`, the same best-effort-identifier tradeoff this codebase already makes elsewhere. */
function evalTemplateExprPreview(source: string, item: Record<string, unknown>, data: Record<string, unknown>, fallback: unknown, onError?: (message: string) => void): unknown {
  try {
    const fieldNames = Object.keys(item).filter((k) => VALID_JS_IDENTIFIER.test(k) && k !== 'item' && k !== 'data')
    // eslint-disable-next-line no-new-func
    const fn = new Function(...fieldNames, 'item', 'data', `return (${source});`)
    return fn(...fieldNames.map((k) => item[k]), item, data)
  } catch (e) {
    onError?.(e instanceof Error ? e.message : String(e))
    return fallback
  }
}
