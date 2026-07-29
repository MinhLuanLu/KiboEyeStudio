import { nanoid } from 'nanoid'
import type { UiAsset, UiDesignProject, UiWidget, UiWidgetType } from '@/types'
import { UI_WIDGET_TAG } from '@/types'
import { createWidget } from './widgetDefaults'

/** Void (self-closing, no children/text) tags — matches the spec's `<img src="logo.png">`
 * example, which has no closing tag. */
const VOID_TAGS = new Set(['img'])

/** Reverse of UI_WIDGET_TAG, written explicitly (not derived) because it isn't 1:1: both the
 * 'container' and 'flex' widget types serialize to the same `<container>` tag (the spec's own
 * HTML vocabulary has no separate tag for a flex layout). `<container>` reparses as a plain
 * 'container' — a Flex Layout's flex-specific properties only survive a round-trip through the
 * visual editor/Properties panel, not through raw HTML text. */
const HTML_TAG_TO_WIDGET_TYPE: Record<string, UiWidgetType> = {
  screen: 'screen',
  container: 'container',
  button: 'button',
  label: 'label',
  img: 'image',
  icon: 'icon',
  switch: 'switch',
  slider: 'slider',
  bar: 'bar',
  arc: 'arc',
  checkbox: 'checkbox',
  dropdown: 'dropdown',
  roller: 'roller',
  textarea: 'textarea',
  list: 'list',
  tabs: 'tabs',
  spinner: 'spinner'
}

/** `src="..."` is written/read using the asset's human-readable *name* (e.g. "logo.png"), never
 * its internal id — `widget.src` itself always holds the id (that's what every other part of
 * the app, e.g. WidgetRenderer's asset lookup, expects), but showing an opaque nanoid in hand-
 * edited HTML would be both ugly and impossible to type correctly. assetsById is only needed
 * for serializing (id -> name); parsing goes the other way (name -> id), see
 * resolveSrcNameToAssetId below. */
function attrsToString(widget: UiWidget, assetsById: Map<string, UiAsset>): string {
  const attrs: string[] = []
  if (widget.tagId) attrs.push(`id="${widget.tagId}"`)
  if (widget.classNames.length > 0) attrs.push(`class="${widget.classNames.join(' ')}"`)
  if (widget.src) {
    const assetName = assetsById.get(widget.src)?.name
    if (assetName) attrs.push(`src="${assetName}"`)
  }
  return attrs.length > 0 ? ' ' + attrs.join(' ') : ''
}

function serializeWidget(widget: UiWidget, widgets: Record<string, UiWidget>, assetsById: Map<string, UiAsset>, depth: number): string {
  const tag = UI_WIDGET_TAG[widget.type]
  const indent = '    '.repeat(depth)
  const attrs = attrsToString(widget, assetsById)

  if (VOID_TAGS.has(tag)) return `${indent}<${tag}${attrs}>`

  const childLines: string[] = []
  if (widget.text) childLines.push(`${indent}    ${widget.text}`)
  for (const childId of widget.childIds) {
    const child = widgets[childId]
    if (child) childLines.push(serializeWidget(child, widgets, assetsById, depth + 1))
  }

  if (childLines.length === 0) return `${indent}<${tag}${attrs}></${tag}>`
  return `${indent}<${tag}${attrs}>\n${childLines.join('\n\n')}\n${indent}</${tag}>`
}

/** Serializes the active screen's widget tree into the project's HTML-like authoring syntax
 * (see the feature spec's `<screen><button id="wifi">Connect</button>...</screen>` example).
 * Full regenerate on every call (no incremental diffing) — simple, always-correct, and cheap
 * enough at this widget-tree scale; the tradeoff is that hand-formatting in the HTML editor
 * doesn't survive a round-trip through the visual editor, the same tradeoff real page builders
 * (Webflow, etc.) make. */
export function widgetTreeToHtml(uiDesign: UiDesignProject): string {
  const screen = uiDesign.screens.find((s) => s.id === uiDesign.activeScreenId) ?? uiDesign.screens[0]
  if (!screen) return ''
  const root = uiDesign.widgets[screen.rootWidgetId]
  if (!root) return ''
  const assetsById = new Map(uiDesign.assets.map((a) => [a.id, a]))
  return serializeWidget(root, uiDesign.widgets, assetsById, 0) + '\n'
}

/** Parses HTML-authoring-syntax text back into a widget tree using the browser's own
 * `DOMParser` (real tag/attribute parsing for free) rather than a hand-written parser — same
 * "lean on native browser APIs" precedent as this codebase's SVG path-sampling pupil-shape
 * import. Elements whose `id` attribute matches an existing widget's `tagId` reuse that
 * widget's style/props/states (so re-typing HTML doesn't wipe out styling already authored via
 * the canvas/Properties panel/CSS rules) — only structure (type/text/class/src/children) comes
 * fresh from the parsed text. Unrecognized tags are skipped (with their entire subtree) and
 * reported as a warning rather than silently dropped or guessed at. */
export function htmlToWidgetTree(
  html: string,
  existingWidgets: Record<string, UiWidget>,
  assets: UiAsset[]
): { widgets: Record<string, UiWidget>; rootId: string | null; warnings: string[] } {
  const warnings: string[] = []
  const existingByTagId = new Map<string, UiWidget>()
  for (const w of Object.values(existingWidgets)) {
    if (w.tagId) existingByTagId.set(w.tagId, w)
  }
  const assetsByName = new Map(assets.map((a) => [a.name, a]))

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rootEl = doc.body.querySelector('screen') ?? doc.body.firstElementChild
  if (!rootEl) return { widgets: {}, rootId: null, warnings: ['No <screen> root element found.'] }

  const widgets: Record<string, UiWidget> = {}

  function walk(el: Element, parentId: string | null): string | null {
    const tag = el.tagName.toLowerCase()
    const type = HTML_TAG_TO_WIDGET_TYPE[tag]
    if (!type) {
      warnings.push(`Unrecognized tag <${tag}> — skipped (and any content inside it).`)
      return null
    }

    const id = el.getAttribute('id')
    const reused = id ? existingByTagId.get(id) : undefined
    const widget: UiWidget = reused
      ? { ...JSON.parse(JSON.stringify(reused)), id: nanoid(10) }
      : createWidget(type)

    widget.type = type
    widget.parentId = parentId
    widget.tagId = id ?? undefined
    const classAttr = el.getAttribute('class')
    widget.classNames = classAttr ? classAttr.split(/\s+/).filter(Boolean) : []
    const src = el.getAttribute('src')
    if (src) {
      const asset = assetsByName.get(src)
      if (asset) widget.src = asset.id
      else warnings.push(`<${tag}${id ? ` id="${id}"` : ''}> references src="${src}", but no imported asset has that name — import it in the Assets tab first, or check for a typo.`)
    }

    // Direct text content only (not text belonging to nested elements) — matches the spec's
    // `<button id="wifi">\n    Connect\n</button>` example, where the label is the button's own
    // trimmed text node.
    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
    if (directText) widget.text = directText

    widget.childIds = []
    for (const childEl of Array.from(el.children)) {
      const childId = walk(childEl, widget.id)
      if (childId) widget.childIds.push(childId)
    }

    widgets[widget.id] = widget
    return widget.id
  }

  const rootId = walk(rootEl, null)
  return { widgets, rootId, warnings }
}
