// Preserves hand-written logic inside generated stub bodies across a re-export. Every generated
// stub this exporter emits (event-callback TODOs, hardware.onX(...) stubs, "Call custom function"
// stubs — see codegen.ts/lvglExport.ts) wraps its body in a `// USER CODE BEGIN <name>` /
// `// USER CODE END <name>` marker pair, where `<name>` is that stub's own (unique) function name.
// extractUserCodeBlocks() reads a previously-exported file and pulls out whatever the user typed
// between each marker pair; mergeUserCode() splices those blocks back into a freshly generated
// file at the matching markers, leaving any stub the user never touched (or any brand-new stub
// this export introduces) as its freshly generated placeholder.

const BEGIN_RE = /^([ \t]*)\/\/ USER CODE BEGIN (\S+)\s*$/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function endRe(name: string): RegExp {
  return new RegExp(`^[ \\t]*// USER CODE END ${escapeRegExp(name)}\\s*$`)
}

/** Scans `previousFileText` for every `// USER CODE BEGIN <name>` ... `// USER CODE END <name>`
 * pair and returns a map of name -> the exact lines between the markers (marker lines themselves
 * excluded), verbatim. A BEGIN with no matching END (malformed/hand-truncated file) is skipped. */
export function extractUserCodeBlocks(previousFileText: string): Map<string, string> {
  const blocks = new Map<string, string>()
  const lines = previousFileText.split('\n')
  let i = 0
  while (i < lines.length) {
    const m = BEGIN_RE.exec(lines[i])
    if (!m) {
      i++
      continue
    }
    const name = m[2]
    const re = endRe(name)
    let j = i + 1
    while (j < lines.length && !re.test(lines[j])) j++
    if (j < lines.length) {
      blocks.set(name, lines.slice(i + 1, j).join('\n'))
      i = j + 1
    } else {
      i++
    }
  }
  return blocks
}

/** Replaces each `// USER CODE BEGIN <name>` ... `// USER CODE END <name>` block's body in
 * `newFileText` with the saved block from `blocks` when one exists for that name — the marker
 * lines themselves are always kept from `newFileText` (so a stub's signature/comment can still
 * change on re-export). A stub with no saved block (new this export, or the previous file simply
 * never had it) keeps its freshly generated placeholder body untouched. */
export function mergeUserCode(newFileText: string, blocks: Map<string, string>): string {
  if (blocks.size === 0) return newFileText
  const lines = newFileText.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const m = BEGIN_RE.exec(lines[i])
    if (!m) {
      out.push(lines[i])
      i++
      continue
    }
    const name = m[2]
    out.push(lines[i])
    const re = endRe(name)
    let j = i + 1
    while (j < lines.length && !re.test(lines[j])) j++
    if (j < lines.length) {
      const saved = blocks.get(name)
      out.push(...(saved !== undefined ? saved.split('\n') : lines.slice(i + 1, j)))
      out.push(lines[j])
      i = j + 1
    } else {
      i++
    }
  }
  return out.join('\n')
}

/** Merges multiple previously-exported files' USER CODE blocks into one name -> code map — used
 * when a user drops several files at once (e.g. both `ui.cpp` and the entry `.ino`) since stub
 * names are unique across the whole export (see the "Function name collisions" validation
 * category), so a single flat map covers every dropped file. */
export function extractUserCodeBlocksFromFiles(fileTexts: string[]): Map<string, string> {
  const merged = new Map<string, string>()
  for (const text of fileTexts) {
    for (const [name, code] of extractUserCodeBlocks(text)) merged.set(name, code)
  }
  return merged
}
