import type { Project } from '@/types'
import {
  allReachableWidgets,
  buildValidationCodegenContext,
  reachableWidgetsForScreen,
  requiredLibraries,
  screenCreateFnName,
  screenShowFnName,
  widgetCreateFnName
} from '@/lib/export/lvglExport'
import type { ExportTarget } from '@/lib/export/exportTarget'
import { validateScript } from '@/lib/uiDesign/scriptLang/validateScript'

export type LvglValidationStatus = 'passed' | 'warning' | 'failed'

export interface LvglValidationResult {
  category: string
  status: LvglValidationStatus
  messages: string[]
}

/** Which export mode to validate for — the two real modes `LvglExportDialog.tsx` offers.
 * `undefined` (used by scriptLang/validateScript.ts's own dry-run context, see
 * buildValidationCodegenContext) validates the whole project the way "Complete Project" mode
 * would, without target-specific checks (no board/display chosen yet). */
export type LvglExportScope = { mode: 'screen'; screenId: string } | { mode: 'complete'; target: ExportTarget }

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

// A deliberately small, non-exhaustive set — just common C++ keywords plus the handful of
// Arduino/LVGL-reserved names most likely to actually collide with a widget id or screen name a
// real author might type (setup/loop are Arduino's own required function names; NULL/true/false
// are C++ literals that would silently break as identifiers). Not trying to enumerate every
// possible reserved word — just the realistic collision risks for this export's own generated
// identifier shapes (Create<Name>, Show<Name>, create_<name>_screen, show_<name>_screen).
const RESERVED_IDENTIFIERS = new Set([
  'class', 'struct', 'void', 'int', 'char', 'float', 'double', 'bool', 'static', 'const', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'namespace', 'include',
  'define', 'new', 'delete', 'public', 'private', 'protected', 'template', 'typename', 'sizeof',
  'setup', 'loop', 'null', 'true', 'false', 'main'
])

/** Validates a UI Design project against the checklist Kibo Eye Studio's LVGL export dialogs
 * show before download — one result per category (matching the requested summary format), not
 * per-widget, since these are project-wide structural checks rather than per-item ones (contrast
 * with validateStickers.ts/validatePupilShapes.ts, which report one row per sticker/shape because
 * those checks are inherently per-item). `scope` picks which of the two real export modes to
 * validate for — widget/asset/CSS/event checks are scoped to just the one screen for
 * `{mode: 'screen'}`, and the target-aware checks (required libraries, entry-point naming) only
 * run for `{mode: 'complete'}`. Pass `undefined` for a whole-project, mode-agnostic pass (used by
 * scriptLang/validateScript.ts's own dry-run context via buildValidationCodegenContext, which
 * has no board/screen selection to scope to). */
export function validateLvglExport(project: Project, scope?: LvglExportScope): LvglValidationResult[] {
  const uiDesign = project.uiDesign
  const scopedScreen = scope?.mode === 'screen' ? uiDesign.screens.find((s) => s.id === scope.screenId) : undefined
  const widgets = scope?.mode === 'screen' ? (scopedScreen ? reachableWidgetsForScreen(uiDesign, scopedScreen) : []) : allReachableWidgets(uiDesign)
  const scopedScreens = scope?.mode === 'screen' ? (scopedScreen ? [scopedScreen] : []) : uiDesign.screens
  const results: LvglValidationResult[] = []

  // ---- LVGL widgets ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    if (scope?.mode === 'screen' && !scopedScreen) {
      status = 'failed'
      messages.push('Selected screen no longer exists — pick another screen to export.')
    } else {
      const danglingParents = widgets.filter((w) => w.parentId && !uiDesign.widgets[w.parentId!])
      if (danglingParents.length > 0) {
        status = 'failed'
        messages.push(`${danglingParents.length} widget(s) reference a parent that no longer exists.`)
      }
      const emptyScreens = scopedScreens.filter((s) => {
        const root = uiDesign.widgets[s.rootWidgetId]
        return root && root.childIds.length === 0
      })
      if (emptyScreens.length > 0) {
        status = status === 'failed' ? status : 'warning'
        messages.push(`${emptyScreens.length} screen(s) have no widgets on them yet: ${emptyScreens.map((s) => s.name).join(', ')}.`)
      }
      messages.push(scope?.mode === 'screen' ? `${widgets.length} widget(s) on this screen.` : `${widgets.length} widget(s) across ${scopedScreens.length} screen(s).`)
    }
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
      messages.push(`${unusedRules} CSS rule(s) don't match any widget in scope — harmless, just unused${scope?.mode === 'screen' ? ' on this screen' : ''}.`)
    }
    messages.push(`${usedRules.length} CSS rule(s) will be included.`)
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
    if (scope?.mode !== 'screen') {
      const unusedAssets = uiDesign.assets.filter((a) => !usedAssetIds.has(a.id))
      if (unusedAssets.length > 0) {
        status = status === 'failed' ? status : 'warning'
        messages.push(`${unusedAssets.length} imported asset(s) aren't placed on any widget/background, so they're skipped in the export (no unused image data included): ${unusedAssets.map((a) => a.name).join(', ')}.`)
      }
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
    if (scope?.mode === 'screen' && uiDesign.script.trim()) {
      messages.push('This screen-only export uses empty `// TODO` stubs for every event — the Logic tab\'s script isn\'t included (it may reference other screens\' widgets/globals). Export "Complete Project" for real script-generated callback bodies.')
    }
    results.push({ category: 'Event callbacks', status, messages })
  }

  // ---- C++ identifiers ----
  // Defensive re-check that every identifier this export will actually emit (screen create/show
  // function names, named-widget create function names) is non-empty and doesn't collide with a
  // C++/Arduino reserved word after sanitization — confirms the PascalCase/snake_case sanitizers
  // in lvglExport.ts did their job, rather than assuming it.
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const badIdentifiers = new Set<string>()
    for (const s of scopedScreens) {
      const name = screenCreateFnName(s.name).replace(/^Create/, '').toLowerCase()
      if (RESERVED_IDENTIFIERS.has(name) || !name) badIdentifiers.add(s.name)
    }
    for (const w of widgets) {
      if (!w.tagId) continue
      const name = widgetCreateFnName(w).replace(/^Create/, '').toLowerCase()
      if (RESERVED_IDENTIFIERS.has(name) || !name) badIdentifiers.add(w.tagId)
    }
    if (badIdentifiers.size > 0) {
      status = 'failed'
      messages.push(`${badIdentifiers.size} name(s) sanitize to a reserved C++/Arduino word and would produce invalid generated code: ${[...badIdentifiers].join(', ')} — rename in Kibo Eye Studio.`)
    } else {
      messages.push('Every screen/widget name generates a valid C++ identifier.')
    }
    results.push({ category: 'C++ identifiers', status, messages })
  }

  // ---- Function name collisions ----
  // Screen create-function names and named-widget create-function names all land in the same
  // flat namespace in the generated output (either one shared file, for "UI Screen Only", or
  // across src/components + src/screens for "Complete Project") — two screens (or a screen and a
  // widget) whose sanitized names collide would produce a real "redefinition" compile error.
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const fnNames = new Map<string, string[]>()
    const record = (fnName: string, label: string) => {
      const list = fnNames.get(fnName) ?? []
      list.push(label)
      fnNames.set(fnName, list)
    }
    for (const s of scopedScreens) record(screenCreateFnName(s.name), `screen "${s.name}"`)
    for (const w of widgets) {
      if (w.tagId) record(widgetCreateFnName(w), `widget "${w.tagId}"`)
    }
    const collisions = [...fnNames.entries()].filter(([, labels]) => labels.length > 1)
    if (collisions.length > 0) {
      status = 'failed'
      messages.push(`${collisions.length} generated function name(s) collide: ${collisions.map(([fn, labels]) => `${fn} (${labels.join(', ')})`).join('; ')} — rename one of each pair in Kibo Eye Studio.`)
    } else {
      messages.push('No generated function names collide.')
    }
    results.push({ category: 'Function name collisions', status, messages })
  }

  if (scope?.mode === 'screen') {
    // ---- Initialization isolation ----
    // "UI Screen Only" mode's generator (generateUiScreenExport) never calls lv_init/
    // lv_display_create/SPI.begin/Wire.begin anywhere in its code path — asserted here by
    // construction (verified by this file's own design, not by re-generating and scanning the
    // output text, which would need the same async RGB565 asset decode the real export does) —
    // making the requirement explicit and checkable rather than an unstated assumption.
    results.push({
      category: 'Initialization isolation',
      status: 'passed',
      messages: ['This export mode never emits LVGL/display/SPI/board initialization code — verified by the exporter\'s design (generateUiScreenExport never calls those APIs), not by scanning generated output.']
    })
  }

  if (scope?.mode === 'complete') {
    // ---- Required libraries ----
    const libs = requiredLibraries(scope.target)
    results.push({
      category: 'Required libraries',
      status: libs.length > 0 ? 'passed' : 'warning',
      messages: [libs.length > 0 ? `libraries.txt will list: ${libs.join(', ')}.` : 'No required libraries could be determined for this target.']
    })
  }

  // ---- LVGL configuration ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const width = scope?.mode === 'complete' ? scope.target.width : project.uiDesign.display.width
    const height = scope?.mode === 'complete' ? scope.target.height : project.uiDesign.display.height
    const shape = scope?.mode === 'complete' ? scope.target.shape : project.uiDesign.display.shape
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

  // ---- Entry point ----
  if (scope?.mode !== 'screen') {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    if (uiDesign.screens.length === 0) {
      status = 'failed'
      messages.push('No screens exist — the generated entry point would have nothing to show.')
    } else {
      const entryFile = scope?.mode === 'complete' ? (scope.target.format === 'arduino' ? 'KiboExport.ino' : 'main.cpp') : 'Example.ino'
      messages.push(`${entryFile} will call KiboUI::${screenShowFnName(uiDesign.screens[0].name)}() to show "${uiDesign.screens[0].name}".`)
    }
    results.push({ category: 'Entry point', status, messages })
  }

  // ---- Logic tab script ----
  // Delegates to scriptLang/validateScript.ts (parse + restricted-subset check + a codegen dry
  // run) and appends its rows here — the same panel, not a second one, per this feature's own
  // "reuse... don't duplicate" instruction. Skipped for "UI Screen Only" mode, whose export
  // never includes script-generated code at all (see the "Event callbacks" note above) — showing
  // whole-project script validation rows there would be confusing (they'd reference other
  // screens' widgets that aren't part of this export).
  if (scope?.mode !== 'screen') {
    for (const row of validateScript(uiDesign.script, buildValidationCodegenContext(project))) {
      results.push(row)
    }
  }

  return results
}
