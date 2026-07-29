import type { Project, UiWidget } from '@/types'
import { buildValidationCodegenContext } from '@/lib/export/lvglExport'
import { validateScript } from '@/lib/uiDesign/scriptLang/validateScript'

export type LvglValidationStatus = 'passed' | 'warning' | 'failed'

export interface LvglValidationResult {
  category: string
  status: LvglValidationStatus
  messages: string[]
}

const CONTAINER_LIKE = new Set(['screen', 'container', 'flex', 'list', 'tabs'])

function reachableWidgets(project: Project): UiWidget[] {
  const uiDesign = project.uiDesign
  const out: UiWidget[] = []
  const seen = new Set<string>()
  const visit = (widget: UiWidget | undefined) => {
    if (!widget || seen.has(widget.id)) return
    seen.add(widget.id)
    out.push(widget)
    if (CONTAINER_LIKE.has(widget.type)) {
      for (const id of widget.childIds) visit(uiDesign.widgets[id])
    }
  }
  for (const screen of uiDesign.screens) visit(uiDesign.widgets[screen.rootWidgetId])
  return out
}

// Fields an author could type free text into — scanned by the "Eye Studio code excluded"
// check below as a cheap, always-on sanity net on top of the real guarantee (lvglExport.ts
// structurally only ever reads project.uiDesign — see that file's top comment).
const SUSPICIOUS_TOKENS = ['EyeParams', 'EyeFrame', 'StickerDef', 'pupilShape', 'eyelid', 'expressionLeft', 'expressionRight']

function scanForEyeStudioLeakage(project: Project): string[] {
  const hits: string[] = []
  const uiDesign = project.uiDesign
  const haystacks: string[] = [uiDesign.htmlSource, uiDesign.cssSource]
  for (const widget of Object.values(uiDesign.widgets)) {
    if (widget.text) haystacks.push(widget.text)
    haystacks.push(...widget.classNames)
    if (widget.tagId) haystacks.push(widget.tagId)
  }
  for (const rule of uiDesign.css) haystacks.push(rule.selector)
  for (const asset of uiDesign.assets) haystacks.push(asset.name)

  for (const token of SUSPICIOUS_TOKENS) {
    if (haystacks.some((h) => h.includes(token))) hits.push(token)
  }
  return hits
}

/** Validates a UI Design project against the checklist Kibo Eye Studio's LVGL export dialog
 * shows before download — one result per category (matching the requested summary format),
 * not per-widget, since these are project-wide structural checks rather than per-item ones
 * (contrast with validateStickers.ts/validatePupilShapes.ts, which report one row per sticker/
 * shape because those checks are inherently per-item). */
export function validateLvglExport(project: Project): LvglValidationResult[] {
  const uiDesign = project.uiDesign
  const widgets = reachableWidgets(project)
  const results: LvglValidationResult[] = []

  // ---- LVGL widgets ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const danglingParents = widgets.filter((w) => w.parentId && !uiDesign.widgets[w.parentId!])
    if (danglingParents.length > 0) {
      status = 'failed'
      messages.push(`${danglingParents.length} widget(s) reference a parent that no longer exists.`)
    }
    const emptyScreens = uiDesign.screens.filter((s) => {
      const root = uiDesign.widgets[s.rootWidgetId]
      return root && root.childIds.length === 0
    })
    if (emptyScreens.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(`${emptyScreens.length} screen(s) have no widgets on them yet: ${emptyScreens.map((s) => s.name).join(', ')}.`)
    }
    messages.push(`${widgets.length} widget(s) across ${uiDesign.screens.length} screen(s).`)
    results.push({ category: 'LVGL widgets', status, messages })
  }

  // ---- UI styles ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const usedRules = uiDesign.css.filter((rule) =>
      widgets.some((w) => {
        if (rule.selector.startsWith('#')) return w.tagId === rule.selector.slice(1)
        if (rule.selector.startsWith('.')) return w.classNames.includes(rule.selector.slice(1))
        return true // tag selectors are cheap enough to just count as "could match"
      })
    )
    const unusedRules = uiDesign.css.length - usedRules.length
    if (unusedRules > 0) {
      status = 'warning'
      messages.push(`${unusedRules} CSS rule(s) don't match any widget currently on screen — harmless, just unused.`)
    }
    messages.push(`${uiDesign.css.length} CSS rule(s) defined.`)
    results.push({ category: 'UI styles', status, messages })
  }

  // ---- UI assets ----
  // Covers both `src` (Image/Icon widgets) and `backgroundImage` (screen/container/button/...
  // backgrounds, including per-state variants and CSS rules that match a reachable widget) —
  // any of these holding an id with no matching Asset Manager entry means the id<->name lookup
  // htmlSync.ts/cssSync.ts/lvglExport.ts all rely on will silently drop the reference, so it's
  // reported here as the one place that walks every reference kind.
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const assetIds = new Set(uiDesign.assets.map((a) => a.id))
    const usedCssRules = uiDesign.css.filter((rule) =>
      widgets.some((w) => {
        if (rule.selector.startsWith('#')) return w.tagId === rule.selector.slice(1)
        if (rule.selector.startsWith('.')) return w.classNames.includes(rule.selector.slice(1))
        return true
      })
    )

    const danglingLabels = new Set<string>()
    const usedAssetIds = new Set<string>()
    const recordRef = (id: string | undefined, label: string) => {
      if (!id) return
      if (assetIds.has(id)) usedAssetIds.add(id)
      else danglingLabels.add(label)
    }
    for (const w of widgets) {
      const label = w.tagId ?? w.id
      recordRef(w.src, label)
      recordRef(w.style.backgroundImage, label)
      for (const stateStyle of Object.values(w.states)) recordRef(stateStyle?.backgroundImage, label)
    }
    for (const rule of usedCssRules) {
      recordRef(rule.style.backgroundImage, `CSS rule "${rule.selector}"`)
      for (const stateStyle of Object.values(rule.states)) recordRef(stateStyle?.backgroundImage, `CSS rule "${rule.selector}"`)
    }

    if (danglingLabels.size > 0) {
      status = 'failed'
      messages.push(`${danglingLabels.size} reference(s) point to an image asset that no longer exists in the Asset Manager: ${[...danglingLabels].join(', ')}.`)
    }
    const unusedAssets = uiDesign.assets.filter((a) => !usedAssetIds.has(a.id))
    if (unusedAssets.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(`${unusedAssets.length} imported asset(s) aren't placed on any widget/background, so they're skipped in the export (no unused image data included): ${unusedAssets.map((a) => a.name).join(', ')}.`)
    }
    messages.push(`${usedAssetIds.size} asset(s) will be included.`)
    results.push({ category: 'UI assets', status, messages })
  }

  // ---- Event callbacks ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const handlerNames = new Map<string, string[]>()
    for (const w of widgets) {
      for (const ev of w.events) {
        const list = handlerNames.get(ev.handlerName) ?? []
        list.push(w.tagId ?? w.id)
        handlerNames.set(ev.handlerName, list)
      }
    }
    const namedButtonsWithoutEvents = widgets.filter((w) => w.type === 'button' && w.tagId && w.events.length === 0)
    const collisions = [...handlerNames.entries()].filter(([, widgetLabels]) => widgetLabels.length > 1)
    if (collisions.length > 0) {
      status = 'failed'
      messages.push(`${collisions.length} event handler name(s) are used by more than one widget, which would collide in the generated C++: ${collisions.map(([name]) => name).join(', ')}.`)
    }
    if (namedButtonsWithoutEvents.length > 0) {
      messages.push(`${namedButtonsWithoutEvents.length} named button(s) will get an automatic click-handler stub: ${namedButtonsWithoutEvents.map((w) => w.tagId).join(', ')}.`)
    }
    results.push({ category: 'Event callbacks', status, messages })
  }

  // ---- LVGL configuration ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const { width, height, shape } = project.uiDesign.display
    if (!(width > 0) || !(height > 0)) {
      status = 'failed'
      messages.push('Display width/height must be greater than 0 — check the Display Settings panel.')
    } else if (width * height > 480 * 480) {
      status = 'warning'
      messages.push(`${Math.round(width)}x${Math.round(height)} is a large panel for an ESP32's internal RAM — you may need to raise KIBO_DRAW_BUFFER_LINES or use PSRAM for the draw buffer (see README.md).`)
    } else {
      messages.push(`${Math.round(width)}x${Math.round(height)} ${shape} display.`)
    }
    results.push({ category: 'LVGL configuration', status, messages })
  }

  // ---- Eye Studio code excluded ----
  {
    const hits = scanForEyeStudioLeakage(project)
    results.push({
      category: 'Eye Studio code excluded',
      status: hits.length > 0 ? 'warning' : 'passed',
      messages:
        hits.length > 0
          ? [`Found Eye-Studio-sounding text in your UI content (${hits.join(', ')}) — check it isn't accidental; the exporter itself never reads eye/expression/animation/sticker data regardless.`]
          : ['The exporter only ever reads UI Design Mode data — no eye, expression, animation, sticker, or pupil/eyelid code can appear in this export.']
    })
  }

  // ---- Arduino example ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    if (uiDesign.screens.length === 0) {
      status = 'failed'
      messages.push('No screens exist — Example.ino would have nothing to show.')
    } else {
      messages.push(`Example.ino will call KiboUI::ShowMainScreen() to show "${uiDesign.screens[0].name}".`)
    }
    results.push({ category: 'Arduino example', status, messages })
  }

  // ---- Logic tab script ----
  // Delegates to scriptLang/validateScript.ts (parse + restricted-subset check + a codegen dry
  // run) and appends its rows here — the same panel, not a second one, per this feature's own
  // "reuse... don't duplicate" instruction.
  for (const row of validateScript(uiDesign.script, buildValidationCodegenContext(project))) {
    results.push(row)
  }

  return results
}
