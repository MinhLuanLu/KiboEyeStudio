// Deliberately NOT a real C++ compiler/parser — there is no C++ toolchain available in this
// Electron/browser app (see lvglExport.ts's repeated "no ESP32/LVGL toolchain in this
// environment" notes for the same limitation on the export side). This is a lightweight,
// line-tracked balance check (braces/parens/brackets, skipping string/char literals and
// comments) — enough to catch the #1 mistake in hand-edited snippets (a missing/stray brace)
// and point at the right line, without pretending to catch every real compile error.
export interface CppSyntaxIssue {
  line: number
  message: string
}

const PAIRS: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
const CLOSERS = new Set(Object.values(PAIRS))

export function checkCppBalance(code: string): CppSyntaxIssue[] {
  const stack: { char: string; line: number }[] = []
  let line = 1
  let i = 0
  const n = code.length

  while (i < n) {
    const c = code[i]

    if (c === '\n') {
      line++
      i++
      continue
    }

    // Line comment — skip to end of line.
    if (c === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++
      continue
    }

    // Block comment — skip to closing */, tracking newlines inside it.
    if (c === '/' && code[i + 1] === '*') {
      i += 2
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }

    // String / char literal — skip to the matching unescaped quote, tracking newlines
    // (a real unterminated literal is rare enough here not to special-case further).
    if (c === '"' || c === "'") {
      const quote = c
      i++
      while (i < n && code[i] !== quote) {
        if (code[i] === '\\') i++
        else if (code[i] === '\n') line++
        i++
      }
      i++
      continue
    }

    if (c in PAIRS) {
      stack.push({ char: c, line })
    } else if (CLOSERS.has(c)) {
      const top = stack.pop()
      if (!top || PAIRS[top.char] !== c) {
        return [{ line, message: `Unexpected '${c}' — no matching opening bracket.` }]
      }
    }

    i++
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]
    return [{ line: unclosed.line, message: `Unclosed '${unclosed.char}' — no matching '${PAIRS[unclosed.char]}' found.` }]
  }

  return []
}
