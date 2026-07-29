import * as acorn from 'acorn'

/** A single problem with the script — a line number (1-based, matching the textarea's own
 * line numbering), a human message, and optionally which supported alternative to use instead
 * (shown by both the Debug Console and the "Unsupported JavaScript API" validation category —
 * see restrictedSubset.ts/validateScript.ts). Never silently dropped anywhere in this pipeline. */
export interface ScriptError {
  line: number
  message: string
  suggestion?: string
}

export interface ParseResult {
  program: acorn.Program | null
  errors: ScriptError[]
}

/** Thin wrapper around Acorn — the actual JS tokenizer/parser (see this feature's plan for why
 * a real parser library is used instead of hand-writing one: there's no native browser API that
 * exposes a JS AST, unlike DOMParser/CSSOM for HTML/CSS). Produces a real ESTree `Program` for
 * static analysis (restrictedSubset.ts, codegen.ts, the visual Events/Actions panel's pattern
 * matching) — NOT used for live-preview execution, which runs the actual source text via the
 * browser's own JS engine instead (see sandboxRuntime.ts). */
export function parseScript(source: string): ParseResult {
  if (!source.trim()) {
    return { program: { type: 'Program', body: [], sourceType: 'script', start: 0, end: 0 } as unknown as acorn.Program, errors: [] }
  }
  try {
    const program = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script', locations: true, allowReturnOutsideFunction: false })
    return { program, errors: [] }
  } catch (err) {
    if (err instanceof SyntaxError) {
      const loc = (err as SyntaxError & { loc?: { line: number; column: number } }).loc
      return { program: null, errors: [{ line: loc?.line ?? 1, message: err.message.replace(/\s*\(\d+:\d+\)\s*$/, '') }] }
    }
    return { program: null, errors: [{ line: 1, message: err instanceof Error ? err.message : String(err) }] }
  }
}
