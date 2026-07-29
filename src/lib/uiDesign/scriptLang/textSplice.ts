/** A single "replace source[start,end) with replacement" edit, keyed to offsets from the
 * ORIGINAL (unmodified) source — see applyTextEdits. Shared by sandboxRuntime.ts (patching
 * top-level let/const keywords for the Variable Inspector) and the visual Events/Actions panel
 * (splicing a row's edited value back into the exact `.on(...)` call it came from). */
export interface TextEdit {
  start: number
  end: number
  replacement: string
}

/** Applies every edit against the original `source` in one pass — edits are resolved against
 * original offsets regardless of order/overlap-free-ness the caller provides them in, so a
 * caller never needs to re-derive offsets after an earlier edit shifted the text. */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const e of sorted) {
    if (e.start < cursor) continue // overlapping edit — skip rather than corrupt output
    out += source.slice(cursor, e.start)
    out += e.replacement
    cursor = e.end
  }
  out += source.slice(cursor)
  return out
}
