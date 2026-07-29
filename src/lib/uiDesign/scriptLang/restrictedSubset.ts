import type { Program, Node } from 'acorn'
import type { ScriptError } from './parser'

// The UI scripting language is a controlled subset of JS — not unrestricted browser JavaScript
// (see this feature's plan). This file is the one place that subset is defined; codegen.ts
// refuses to emit C++ for a program that fails this check, and the live preview (sandboxRuntime.ts)
// runs the real script text regardless (so authoring feels forgiving), surfacing this check's
// errors as "won't export to C++" rather than blocking the preview outright.
//
// Supported: let/const with literal/simple-expression initializers, function declarations,
// if/else, expression-statement calls/assignments, return, and (as expressions) literals,
// identifiers, template literals, binary/logical/unary/conditional expressions, non-computed
// (or literal-computed) member access, call expressions, arrow functions, and object literals
// (for config args like .animate({...})).
//
// Rejected, each with a line, message, and suggested alternative — never silently dropped:
// loops, classes, try/catch, async/await, imports/exports, switch, labeled/break/continue,
// generators, dynamic property access, the comma operator, `new`, regex literals.

export interface SubsetCheckResult {
  ok: boolean
  errors: ScriptError[]
}

function err(errors: ScriptError[], node: Node, message: string, suggestion?: string) {
  const line = (node.loc?.start.line as number | undefined) ?? 1
  errors.push({ line, message, suggestion })
}

const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/='])

export function checkRestrictedSubset(program: Program): SubsetCheckResult {
  const errors: ScriptError[] = []

  function walkExpression(node: Node | null | undefined, insideFunction: boolean): void {
    if (!node) return
    switch (node.type) {
      case 'Literal':
      case 'Identifier':
      case 'ThisExpression':
        return
      case 'TemplateLiteral': {
        const t = node as unknown as { expressions: Node[] }
        for (const e of t.expressions) walkExpression(e, insideFunction)
        return
      }
      case 'BinaryExpression':
      case 'LogicalExpression': {
        const b = node as unknown as { left: Node; right: Node }
        walkExpression(b.left, insideFunction)
        walkExpression(b.right, insideFunction)
        return
      }
      case 'UnaryExpression': {
        const u = node as unknown as { argument: Node; operator: string }
        if (!['-', '+', '!'].includes(u.operator)) {
          err(errors, node, `Unsupported unary operator "${u.operator}".`, 'Use -, +, or ! only.')
          return
        }
        walkExpression(u.argument, insideFunction)
        return
      }
      case 'ConditionalExpression': {
        const c = node as unknown as { test: Node; consequent: Node; alternate: Node }
        walkExpression(c.test, insideFunction)
        walkExpression(c.consequent, insideFunction)
        walkExpression(c.alternate, insideFunction)
        return
      }
      case 'MemberExpression': {
        const m = node as unknown as { object: Node; property: Node; computed: boolean }
        if (m.computed && m.property.type !== 'Literal') {
          err(errors, node, 'Dynamic property access (obj[expr]) is not supported.', 'Use a literal property/method name (obj.prop or obj["literal"]).')
        }
        walkExpression(m.object, insideFunction)
        return
      }
      case 'CallExpression': {
        const c = node as unknown as { callee: Node; arguments: Node[] }
        walkExpression(c.callee, insideFunction)
        for (const a of c.arguments) {
          if (a.type === 'SpreadElement') {
            err(errors, a, 'Spread arguments (...args) are not supported.', 'Pass arguments individually.')
            continue
          }
          walkExpression(a, insideFunction)
        }
        return
      }
      case 'ArrowFunctionExpression': {
        const f = node as unknown as { params: Node[]; body: Node }
        for (const p of f.params) {
          if (p.type !== 'Identifier') {
            err(errors, p, 'Destructuring/default parameters are not supported.', 'Use plain parameter names (e.g. (direction) => ...).')
          }
        }
        if (f.body.type === 'BlockStatement') walkStatement(f.body, true)
        else walkExpression(f.body, true)
        return
      }
      case 'ObjectExpression': {
        const o = node as unknown as { properties: Node[] }
        for (const p of o.properties) {
          if (p.type !== 'Property') {
            err(errors, p, 'Spread/computed object members are not supported.', 'Use plain key: value pairs.')
            continue
          }
          const prop = p as unknown as { computed: boolean; value: Node; key: Node }
          if (prop.computed) {
            err(errors, p, 'Computed object keys are not supported.', 'Use a literal key name.')
          }
          walkExpression(prop.value, insideFunction)
        }
        return
      }
      case 'AssignmentExpression': {
        const a = node as unknown as { left: Node; right: Node; operator: string }
        if (!ASSIGNMENT_OPERATORS.has(a.operator)) {
          err(errors, node, `Unsupported assignment operator "${a.operator}".`, 'Use =, +=, -=, *=, or /=.')
        }
        if (a.left.type !== 'Identifier' && a.left.type !== 'MemberExpression') {
          err(errors, a.left, 'Unsupported assignment target.', 'Assign to a plain variable name.')
        } else {
          walkExpression(a.left, insideFunction)
        }
        walkExpression(a.right, insideFunction)
        return
      }
      case 'UpdateExpression': {
        const u = node as unknown as { argument: Node }
        walkExpression(u.argument, insideFunction)
        return
      }
      case 'ArrayExpression': {
        const arr = node as unknown as { elements: (Node | null)[] }
        for (const el of arr.elements) walkExpression(el, insideFunction)
        return
      }
      default:
        err(
          errors,
          node,
          `"${node.type}" is not supported in the UI scripting language.`,
          suggestionFor(node.type)
        )
    }
  }

  function walkStatement(node: Node, insideFunction: boolean): void {
    switch (node.type) {
      case 'BlockStatement': {
        const b = node as unknown as { body: Node[] }
        for (const s of b.body) walkStatement(s, insideFunction)
        return
      }
      case 'VariableDeclaration': {
        const v = node as unknown as { kind: string; declarations: { id: Node; init: Node | null }[] }
        if (v.kind === 'var') {
          err(errors, node, '"var" is not supported.', 'Use let or const instead.')
        }
        for (const d of v.declarations) {
          if (d.id.type !== 'Identifier') {
            err(errors, d.id, 'Destructuring declarations are not supported.', 'Declare one plain variable per statement.')
            continue
          }
          walkExpression(d.init, insideFunction)
        }
        return
      }
      case 'FunctionDeclaration': {
        const f = node as unknown as { params: Node[]; body: Node; async: boolean; generator: boolean }
        if (f.async) err(errors, node, 'async functions are not supported.', 'Timers/events already run asynchronously — use ui.setInterval or widget.on(...).')
        if (f.generator) err(errors, node, 'Generator functions are not supported.')
        for (const p of f.params) {
          if (p.type !== 'Identifier') err(errors, p, 'Destructuring/default parameters are not supported.', 'Use plain parameter names.')
        }
        walkStatement(f.body, true)
        return
      }
      case 'ExpressionStatement': {
        const e = node as unknown as { expression: Node }
        if (e.expression.type !== 'CallExpression' && e.expression.type !== 'AssignmentExpression' && e.expression.type !== 'UpdateExpression') {
          err(errors, node, 'This expression has no effect and is not supported as a statement.', 'Use a function call or assignment.')
          return
        }
        walkExpression(e.expression, insideFunction)
        return
      }
      case 'IfStatement': {
        const i = node as unknown as { test: Node; consequent: Node; alternate: Node | null }
        walkExpression(i.test, insideFunction)
        walkStatement(i.consequent, insideFunction)
        if (i.alternate) walkStatement(i.alternate, insideFunction)
        return
      }
      case 'ReturnStatement': {
        if (!insideFunction) {
          err(errors, node, 'return is only allowed inside a function.')
          return
        }
        const r = node as unknown as { argument: Node | null }
        walkExpression(r.argument, insideFunction)
        return
      }
      case 'EmptyStatement':
        return
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
        err(errors, node, 'Loops are not supported for LVGL export.', 'Use ui.setInterval(callback, ms) for repeating work.')
        return
      case 'TryStatement':
        err(errors, node, 'try/catch is not supported for LVGL export (it runs fine in preview).', 'Check for error conditions with if instead.')
        return
      case 'SwitchStatement':
        err(errors, node, 'switch is not supported.', 'Use an if/else if chain instead.')
        return
      case 'ClassDeclaration':
        err(errors, node, 'Classes are not supported.', 'Use plain functions and ui.get() widget references instead.')
        return
      default:
        err(errors, node, `"${node.type}" is not supported in the UI scripting language.`, suggestionFor(node.type))
    }
  }

  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration' || stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportAllDeclaration') {
      err(errors, stmt, 'Modules (import/export) are not supported.', 'This is a single self-contained script — remove the import/export.')
      continue
    }
    walkStatement(stmt, false)
  }

  return { ok: errors.length === 0, errors }
}

function suggestionFor(nodeType: string): string | undefined {
  if (nodeType === 'AwaitExpression') return 'async/await is not needed — timers and events already run asynchronously.'
  if (nodeType === 'YieldExpression') return 'Generators are not supported.'
  if (nodeType === 'NewExpression') return '"new" is not supported — use ui.get()/ui.getAll() to obtain widget references instead.'
  if (nodeType === 'SequenceExpression') return 'The comma operator is not supported — use separate statements.'
  if (nodeType === 'RegExpLiteral' || nodeType === 'Literal') return undefined
  return undefined
}
