import type { StickerSvgColorMode, StickerSvgMeta } from '@/types'

/** Element types the recolor engine (and the meta parser below) actually looks at — the exact
 * set the spec lists (path/circle/ellipse/rect/polygon/polyline/line/g). Anything else (defs,
 * linearGradient/radialGradient stop children, clipPath/mask contents, text, etc.) is walked
 * past (its children are still visited, since a <g> can wrap arbitrary content) but never has
 * its own fill/stroke read or rewritten. */
const RECOLORABLE_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'g'])

function localName(el: Element): string {
  // SVGs parsed as image/svg+xml keep tagName unprefixed for the default SVG namespace, but
  // guard against a stray namespace prefix (e.g. from a re-serialized/edited file) anyway.
  return el.tagName.includes(':') ? el.tagName.split(':')[1].toLowerCase() : el.tagName.toLowerCase()
}

/** Reads a fill/stroke value from either the element's own attribute or its inline `style`
 * (both are common — Illustrator/Figma exports lean on `style`, hand-authored SVGs usually use
 * the plain attribute) — style takes precedence, matching real CSS cascade order for
 * presentation attributes vs. inline style. */
function getPaintValue(el: Element, prop: 'fill' | 'stroke'): string | null {
  const style = el.getAttribute('style')
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(style)
    if (m) return m[1].trim()
  }
  return el.getAttribute(prop)
}

/** Resolves the *effective* fill/stroke an element actually paints with, walking up through
 * ancestors (including the `<svg>` root itself) when the element has no paint of its own —
 * real SVGs very commonly declare `fill="currentColor"` once on the root and let every child
 * shape inherit it (exactly SVG presentation-attribute/CSS inheritance), rather than repeating
 * it on every element. `getPaintValue` alone only sees an element's own attribute/style, so
 * without this walk those (extremely common) inherited-only shapes were invisible to the
 * recolor engine — never counted in parseSvgMeta, never rewritten by recolorSvgSource — because
 * they have no paint value of their own to classify. An explicit `inherit` (or an empty value)
 * on an element also continues the walk past it, matching how CSS `inherit` behaves; any other
 * explicit value (including `none`) is a real terminating value. Reaching the top with nothing
 * found falls back to the CSS/SVG initial value — 'black' for fill, none (null) for stroke. */
function resolveEffectivePaint(el: Element, prop: 'fill' | 'stroke'): string | null {
  let node: Element | null = el
  while (node) {
    const own = getPaintValue(node, prop)
    if (own !== null && own.trim() !== '' && own.trim() !== 'inherit') return own
    node = node.parentElement
  }
  return prop === 'fill' ? 'black' : null
}

function setPaintValue(el: Element, prop: 'fill' | 'stroke', value: string): void {
  const style = el.getAttribute('style')
  if (style && new RegExp(`(?:^|;)\\s*${prop}\\s*:`).test(style)) {
    el.setAttribute('style', style.replace(new RegExp(`(${prop}\\s*:\\s*)[^;]+`), `$1${value}`))
  } else {
    el.setAttribute(prop, value)
  }
}

/** Classifies a raw fill/stroke value: `null`/`'none'`/`'inherit'`/`'transparent'`/unset ->
 * not recolorable at all (nothing to touch, or explicitly "no paint"); `url(...)` -> a
 * gradient/pattern reference, deliberately left alone (recoloring a gradient's own stops isn't
 * a sensible operation for a single flat tint, and masks/clipPaths never reach here since
 * they're not in RECOLORABLE_TAGS); `'currentColor'` -> always resolves to the sticker's tint;
 * anything else (`#rrggbb`, a named color, `rgb(...)`, `hsl(...)`) -> a literal hardcoded color,
 * only rewritten in 'overrideWithTint' mode. */
function classifyPaintValue(v: string | null): 'currentColor' | 'literal' | null {
  if (!v) return null
  const t = v.trim()
  if (t === '' || t === 'none' || t === 'inherit' || t === 'transparent') return null
  if (t === 'currentColor') return 'currentColor'
  if (t.startsWith('url(')) return null
  return 'literal'
}

function parseSvgDoc(svgText: string): Document | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null
  if (doc.documentElement.tagName.toLowerCase() !== 'svg') return null
  return doc
}

function walkRecolorable(root: Element, visit: (el: Element) => void): void {
  const walk = (el: Element) => {
    if (RECOLORABLE_TAGS.has(localName(el))) visit(el)
    for (const child of Array.from(el.children)) walk(child)
  }
  // Deliberately starts from the root <svg>'s children, never the root itself — the root
  // element's own fill/stroke/background must never be touched (there generally isn't one, but
  // this guarantees it structurally rather than by convention).
  for (const child of Array.from(root.children)) walk(child)
}

/** Parses structural stats from an SVG source — element/fill/stroke counts, currentColor/
 * gradient/clip-mask presence — surfaced in the Sticker Manager's debug panel. Never throws;
 * an unparseable source just reports `rasterizedFallback: true` with everything else zeroed. */
export function parseSvgMeta(svgText: string): StickerSvgMeta {
  const doc = parseSvgDoc(svgText)
  if (!doc) {
    return { elementCount: 0, fillCount: 0, strokeCount: 0, usesCurrentColor: false, hasGradients: false, hasClipOrMask: false, rasterizedFallback: true }
  }
  let elementCount = 0
  let fillCount = 0
  let strokeCount = 0
  let usesCurrentColor = false
  walkRecolorable(doc.documentElement, (el) => {
    elementCount++
    const fillKind = classifyPaintValue(resolveEffectivePaint(el, 'fill'))
    const strokeKind = classifyPaintValue(resolveEffectivePaint(el, 'stroke'))
    if (fillKind) fillCount++
    if (strokeKind) strokeCount++
    if (fillKind === 'currentColor' || strokeKind === 'currentColor') usesCurrentColor = true
  })
  return {
    elementCount,
    fillCount,
    strokeCount,
    usesCurrentColor,
    hasGradients: !!doc.querySelector('linearGradient, radialGradient'),
    hasClipOrMask: !!doc.querySelector('clipPath, mask'),
    rasterizedFallback: false
  }
}

/** Recolors an SVG source per the given mode/tint and returns the modified markup — the core
 * of "the color picker only changes the actual SVG shapes": every write goes through
 * setPaintValue() on a fill/stroke property of a real vector element (never the root <svg>,
 * never a gradient/clipPath/mask definition, never anything referenced via `url(...)`), so
 * transparency (untouched alpha), gradients/masks/clip-paths/opacity (untouched entirely,
 * since they're not literal fill/stroke colors) all survive unchanged. currentColor fills/
 * strokes always resolve to `tint` (falling back to white if no tint is set, since there's no
 * surrounding CSS context to inherit from on a rasterization target) regardless of `mode` —
 * there's no "original" hardcoded color to preserve for those. Hardcoded literal colors
 * (#rrggbb, named colors, rgb()/hsl()) are left exactly as authored in 'preserveOriginal' mode
 * and rewritten to `tint` in 'overrideWithTint' mode. Returns the input unchanged if it can't
 * be parsed as SVG (caller falls back to the flat raster overlay tint in that case — see
 * drawSticker.ts). */
export function recolorSvgSource(svgText: string, mode: StickerSvgColorMode, tint: string | null): string {
  const doc = parseSvgDoc(svgText)
  if (!doc) return svgText
  const effectiveTint = tint ?? '#ffffff'
  walkRecolorable(doc.documentElement, (el) => {
    for (const prop of ['fill', 'stroke'] as const) {
      const kind = classifyPaintValue(resolveEffectivePaint(el, prop))
      if (kind === 'currentColor') {
        setPaintValue(el, prop, effectiveTint)
      } else if (kind === 'literal' && mode === 'overrideWithTint') {
        setPaintValue(el, prop, effectiveTint)
      }
    }
  })
  return new XMLSerializer().serializeToString(doc)
}
