import type { Node } from 'acorn'

/** Generic "visit every node reachable from `root`" walker — unlike restrictedSubset.ts's
 * whitelist-shaped visitor (which needs to know exactly what each statement/expression means),
 * this one just needs to find every node of interest anywhere in the tree (used for locating
 * `.bindText(...)`-style calls in sandboxRuntime.ts and `.on(event, () => singleCall())` blocks
 * in the visual Events/Actions panel) — reflection over own-enumerable-object/array properties,
 * skipping the position bookkeeping fields so it never recurses into those. */
export function walkAllNodes(node: unknown, visit: (n: Node) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkAllNodes(item, visit)
    return
  }
  const n = node as Record<string, unknown>
  if (typeof n.type === 'string') visit(n as unknown as Node)
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'type') continue
    const v = n[key]
    if (v && typeof v === 'object') walkAllNodes(v, visit)
  }
}
