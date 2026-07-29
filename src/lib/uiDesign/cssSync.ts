import type { UiAsset, UiCssRule, UiWidgetStateName, UiWidgetStyle } from '@/types'
import { nanoid } from 'nanoid'

type FieldKind = 'length' | 'px' | 'number' | 'opacity' | 'string'

/** UiWidgetStyle field -> [CSS property name, value kind]. Position (x/y) is deliberately
 * excluded — those are per-instance placement, authored via drag/resize/the Properties panel's
 * X/Y fields, not something a tag/class/id rule sets. Shared by both directions (serialize in
 * styleRulesToCssText, parse in cssTextToStyleRules) so they can never drift apart. */
const STYLE_FIELDS: [keyof UiWidgetStyle, string, FieldKind][] = [
  ['width', 'width', 'length'],
  ['height', 'height', 'length'],
  ['marginTop', 'margin-top', 'px'],
  ['marginRight', 'margin-right', 'px'],
  ['marginBottom', 'margin-bottom', 'px'],
  ['marginLeft', 'margin-left', 'px'],
  ['paddingTop', 'padding-top', 'px'],
  ['paddingRight', 'padding-right', 'px'],
  ['paddingBottom', 'padding-bottom', 'px'],
  ['paddingLeft', 'padding-left', 'px'],
  ['borderWidth', 'border-width', 'px'],
  ['borderColor', 'border-color', 'string'],
  ['borderRadius', 'border-radius', 'px'],
  ['background', 'background', 'string'],
  ['opacity', 'opacity', 'opacity'],
  ['color', 'color', 'string'],
  ['fontFamily', 'font-family', 'string'],
  ['fontSize', 'font-size', 'px'],
  ['fontWeight', 'font-weight', 'string'],
  ['letterSpacing', 'letter-spacing', 'px'],
  ['textAlign', 'text-align', 'string'],
  ['zIndex', 'z-index', 'number'],
  ['gap', 'gap', 'px'],
  ['overflow', 'overflow', 'string']
]

function valueToCss(kind: FieldKind, v: unknown): string {
  if (kind === 'opacity') return String(Number(v) / 100)
  if (kind === 'length' && typeof v === 'number') return `${v}px`
  if (kind === 'px') return `${v}px`
  return String(v)
}

// background-image doesn't fit the generic [key, cssProp, kind] table above — its CSS value is
// a url(...) that has to be resolved through the asset list (id <-> name, same reasoning as
// htmlSync.ts's <img src="name"> — see that file's comment), and it expands to three CSS
// properties (background-image/-size/-repeat) from two UiWidgetStyle fields
// (backgroundImage/backgroundSize). Handled as an explicit special case, same pattern
// STATE_SUFFIXES below already establishes for :pressed.
const BACKGROUND_SIZE_TO_CSS: Record<NonNullable<UiWidgetStyle['backgroundSize']>, { size: string; repeat: string }> = {
  stretch: { size: '100% 100%', repeat: 'no-repeat' },
  fit: { size: 'contain', repeat: 'no-repeat' },
  fill: { size: 'cover', repeat: 'no-repeat' },
  center: { size: 'auto', repeat: 'no-repeat' },
  tile: { size: 'auto', repeat: 'repeat' }
}

function declarationsToCss(style: Partial<UiWidgetStyle>, assetsById: Map<string, UiAsset>): string {
  const lines: string[] = []
  for (const [key, prop, kind] of STYLE_FIELDS) {
    const v = style[key]
    if (v === undefined) continue
    lines.push(`  ${prop}: ${valueToCss(kind, v)};`)
  }
  if (style.backgroundImage) {
    const asset = assetsById.get(style.backgroundImage)
    if (asset) {
      const { size, repeat } = BACKGROUND_SIZE_TO_CSS[style.backgroundSize ?? 'fill']
      lines.push(`  background-image: url("${asset.name}");`)
      lines.push(`  background-size: ${size};`)
      lines.push(`  background-repeat: ${repeat};`)
    }
  }
  return lines.join('\n')
}

const STATE_SUFFIXES: { css: string; state: UiWidgetStateName }[] = [
  { css: ':hover', state: 'hover' },
  { css: ':disabled', state: 'disabled' },
  { css: ':focus', state: 'focused' },
  // :pressed isn't a real CSS pseudo-class (it's an LVGL concept) — browsers drop any rule
  // whose selector contains an unrecognized pseudo-class, so it's swapped for a sentinel class
  // before parsing and swapped back here. Internal detail only; never shown to the user.
  { css: '.__lv_state_pressed', state: 'pressed' }
]

/** Serializes the authored CSS rule list back to text — read-only mirror through Milestone 4,
 * editable (with round-trip reparsing) from Milestone 5 on. Only the simple selector forms this
 * pass supports (tag / .class / #id, optionally with one state suffix) are ever produced. */
export function styleRulesToCssText(rules: UiCssRule[], assets: UiAsset[]): string {
  const assetsById = new Map(assets.map((a) => [a.id, a]))
  const blocks: string[] = []
  for (const rule of rules) {
    const body = declarationsToCss(rule.style, assetsById)
    blocks.push(body ? `${rule.selector} {\n${body}\n}` : `${rule.selector} {\n}`)
    for (const { css, state } of STATE_SUFFIXES) {
      const stateStyle = rule.states[state]
      if (!stateStyle) continue
      const body2 = declarationsToCss(stateStyle, assetsById)
      if (body2) blocks.push(`${rule.selector}${css} {\n${body2}\n}`)
    }
  }
  return blocks.join('\n\n')
}

const PRESSED_SENTINEL_CLASS = '__lv_state_pressed'

/** Parses CSS text back into UiCssRule[] using the browser's own CSSOM (a detached <style>
 * element's .sheet.cssRules) rather than a hand-written tokenizer — real selector/value parsing
 * for free, same "lean on native browser APIs" precedent as this codebase's SVG path-sampling
 * pupil-shape import. Only simple selectors (tag / .class / #id, optionally with :hover/
 * :disabled/:focus/:pressed) are recognized; anything else (combinators, multiple selectors per
 * rule, unsupported properties) is skipped with a warning rather than silently mis-applied. */
export function cssTextToStyleRules(cssText: string, assets: UiAsset[]): { rules: UiCssRule[]; warnings: string[] } {
  const warnings: string[] = []
  const assetsByName = new Map(assets.map((a) => [a.name, a]))
  const swapped = cssText.replace(/:pressed\b/g, `.${PRESSED_SENTINEL_CLASS}`)

  const styleEl = document.createElement('style')
  styleEl.textContent = swapped
  document.head.appendChild(styleEl)
  const sheet = styleEl.sheet
  const cssRules = sheet ? Array.from(sheet.cssRules) : []
  document.head.removeChild(styleEl)

  // selector -> { base rule fields } so `button {...}` and `button:hover {...}` merge into one
  // UiCssRule instead of becoming two separate rules with the same base selector.
  const bySelector = new Map<string, UiCssRule>()

  for (const raw of cssRules) {
    if (!(raw instanceof CSSStyleRule)) {
      warnings.push(`Skipped unsupported CSS rule: "${raw.cssText.slice(0, 60)}"`)
      continue
    }
    let selectorText = raw.selectorText.trim()
    if (selectorText.includes(',')) {
      warnings.push(`Skipped "${selectorText}": multiple selectors in one rule aren't supported — split into separate rules.`)
      continue
    }

    let state: UiWidgetStateName | null = null
    for (const { css, state: s } of STATE_SUFFIXES) {
      if (selectorText.endsWith(css)) {
        state = s
        selectorText = selectorText.slice(0, -css.length)
        break
      }
    }
    if (!/^(#[\w-]+|\.[\w-]+|[a-z]+)$/i.test(selectorText)) {
      warnings.push(`Skipped "${raw.selectorText}": only a single tag, .class, or #id selector is supported (no combinators).`)
      continue
    }

    const style: Partial<UiWidgetStyle> = {}
    for (const [key, prop, kind] of STYLE_FIELDS) {
      const value = raw.style.getPropertyValue(prop).trim()
      if (!value) continue
      if (kind === 'opacity') (style as Record<string, unknown>)[key] = Math.round(parseFloat(value) * 100)
      else if (kind === 'number') (style as Record<string, unknown>)[key] = parseFloat(value)
      else if (kind === 'px') (style as Record<string, unknown>)[key] = parseFloat(value)
      else if (kind === 'length') {
        if (value === 'auto') (style as Record<string, unknown>)[key] = 'auto'
        else if (value.endsWith('%')) (style as Record<string, unknown>)[key] = value
        else (style as Record<string, unknown>)[key] = parseFloat(value)
      } else (style as Record<string, unknown>)[key] = value
    }

    const bgImageRaw = raw.style.getPropertyValue('background-image').trim()
    const urlMatch = bgImageRaw.match(/^url\(\s*["']?([^"')]+)["']?\s*\)$/)
    if (urlMatch) {
      const asset = assetsByName.get(urlMatch[1])
      if (asset) {
        style.backgroundImage = asset.id
        const sizeRaw = raw.style.getPropertyValue('background-size').trim()
        const repeatRaw = raw.style.getPropertyValue('background-repeat').trim()
        style.backgroundSize =
          repeatRaw === 'repeat'
            ? 'tile'
            : sizeRaw === 'contain'
              ? 'fit'
              : sizeRaw === 'cover'
                ? 'fill'
                : sizeRaw === '100% 100%'
                  ? 'stretch'
                  : 'center'
      } else {
        warnings.push(`Skipped background-image: url("${urlMatch[1]}") in "${raw.selectorText}" — no imported asset has that name.`)
      }
    }

    let entry = bySelector.get(selectorText)
    if (!entry) {
      entry = { id: nanoid(10), selector: selectorText, style: {}, states: {} }
      bySelector.set(selectorText, entry)
    }
    if (state) entry.states[state] = { ...entry.states[state], ...style }
    else Object.assign(entry.style, style)
  }

  return { rules: Array.from(bySelector.values()), warnings }
}
