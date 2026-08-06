import type { Project } from '@/types'
import {
  allReachableWidgets,
  buildValidationCodegenContext,
  indicatorFunctionBaseName,
  indicatorScreenFunctionPrefix,
  INDICATOR_VALUE_WIDGET_TYPES,
  isIndicatorWidget,
  reachableWidgetsForScreen,
  requiredLibraries,
  screenCreateFnName,
  screenFocusNextFnName,
  screenFocusPreviousFnName,
  screenIdentBase,
  screenPressFnName,
  screenShowFnName,
  toCIdentifier,
  widgetBaseName,
  widgetCreateFnName
} from '@/lib/export/lvglExport'
import type { ExportTarget } from '@/lib/export/exportTarget'
import { sanitizeFilename, sanitizeIdentifier } from '@/lib/export/naming'
import { validateScript } from '@/lib/uiDesign/scriptLang/validateScript'
import { parseVisualBindingRows } from '@/lib/uiDesign/scriptLang/visualBindings'
import { missingDanishCodepoints, parseFontVariableName } from '@/lib/uiDesign/fontImport'
import { resolveKeyboardMap } from '@/lib/uiDesign/keyboardLayouts'
import { computeAdaptiveKeyboardRowLayout, findClippedKeys } from '@/lib/uiDesign/keyboardAdaptiveLayout'

export type LvglValidationStatus = 'passed' | 'warning' | 'failed'

export interface LvglValidationResult {
  category: string
  status: LvglValidationStatus
  messages: string[]
}

/** Which export mode to validate for — the four modes `LvglExportDialog.tsx` offers.
 * `'module'`/`'header'` are whole-project, target-independent views of the same generator output
 * `'complete'` uses (see lvglExport.ts's generateLvglExport/generateModuleExport/
 * generateHeaderExport) — no board/pins/entry-sketch, so they skip the target-specific checks
 * ("Required libraries", "Entry point") below. `undefined` (used by scriptLang/validateScript.ts's
 * own dry-run context, see buildValidationCodegenContext) validates the whole project the way
 * "Complete Project" mode would, without target-specific checks (no board/display chosen yet). */
export type LvglExportScope =
  | { mode: 'screen'; screenId: string }
  | { mode: 'complete'; target: ExportTarget }
  | { mode: 'module' }
  | { mode: 'header' }

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

/** Validates a UI Design project against the checklist the LVGL export dialogs
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

  // ---- Advanced style fidelity ----
  // Flags style combinations from the Advanced Style System (glow/elevation/surfaceStyle — see
  // UiWidgetStyle's own doc comments) that get approximated rather than reproduced exactly, per
  // this feature's own "warn, never silently drop" rule (matching the established Sticker blur/
  // blend-mode precedent). LVGL carries exactly one shadow per style part, so an explicit manual
  // shadow, a glow, and an elevation-derived shadow all compete for the same lv_style_set_shadow_*
  // calls (see lvglExport.ts's styleSetCalls) — only one wins, silently, unless flagged here.
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const shadowConflicts: string[] = []
    const bevelApproximations: string[] = []
    for (const w of widgets) {
      const label = w.tagId ?? w.id
      const styles = [w.style, ...Object.values(w.states).filter((s): s is NonNullable<typeof s> => !!s)]
      for (const s of styles) {
        const hasManualShadow = s.shadowWidth !== undefined || s.shadowColor !== undefined
        const hasGlow = s.glowColor !== undefined || s.glowRadius !== undefined
        const hasElevation = s.elevation !== undefined
        const competing = [hasManualShadow, hasGlow, hasElevation].filter(Boolean).length
        if (competing > 1 && !shadowConflicts.includes(label)) shadowConflicts.push(label)
        if (s.surfaceStyle === 'bevel' && !bevelApproximations.includes(label)) bevelApproximations.push(label)
      }
    }
    if (shadowConflicts.length > 0) {
      status = 'warning'
      messages.push(
        `${shadowConflicts.length} widget(s) set more than one of Shadow/Glow/Elevation on the same style — LVGL only has one shadow per part, so only one wins (priority: Shadow > Glow > Elevation): ${shadowConflicts.join(', ')}.`
      )
    }
    if (bevelApproximations.length > 0) {
      status = status === 'warning' ? status : 'warning'
      messages.push(`${bevelApproximations.length} widget(s) use the "Bevel" surface style — approximated with a single border color (LVGL has no true per-edge border color/highlight): ${bevelApproximations.join(', ')}.`)
    }
    // "Fit Width"/"Fit Height" compute a real lv_image_set_scale() zoom factor from the widget's
    // own literal pixel width/height vs. the assigned asset's natural size (see lvglExport.ts's
    // widgetCreateCalls 'image' case) — a percentage/auto size or a widget with no image assigned
    // yet has no fixed pixel box to compute that factor from at export time, so it falls back to
    // Contain instead of guessing. Flagged here so that fallback isn't mistaken for a bug.
    const imageFitFallbacks: string[] = []
    for (const w of widgets) {
      if (w.type !== 'image') continue
      if (w.style.imageFit !== 'fitWidth' && w.style.imageFit !== 'fitHeight') continue
      const hasLiteralPxBox = typeof w.style.width === 'number' && typeof w.style.height === 'number'
      const hasAsset = !!w.src && uiDesign.assets.some((a) => a.id === w.src)
      if (!hasLiteralPxBox || !hasAsset) imageFitFallbacks.push(w.tagId ?? w.id)
    }
    if (imageFitFallbacks.length > 0) {
      status = status === 'warning' ? status : 'warning'
      messages.push(
        `${imageFitFallbacks.length} widget(s) use "Fit Width"/"Fit Height" but don't have both a literal pixel Width+Height and an assigned image — falls back to Contain in the export: ${imageFitFallbacks.join(', ')}.`
      )
    }
    if (shadowConflicts.length === 0 && bevelApproximations.length === 0 && imageFitFallbacks.length === 0) {
      messages.push('No approximated advanced-style effects in this scope.')
    }
    results.push({ category: 'Advanced style fidelity', status, messages })
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
    // GIFs animate live in the design canvas (M6 fix — the asset's dataUrl now keeps the real
    // GIF bytes instead of a rasterized single frame), but LVGL export has no GIF-playback path
    // (same "no bitmap animation on this target" limitation stickers already document) — bakes
    // whichever frame the browser's <img> decoder has current at export time. Flagged so this
    // isn't mistaken for a bug once the exported firmware shows a static image.
    const usedGifAssets = uiDesign.assets.filter((a) => usedAssetIds.has(a.id) && a.sourceFormat === 'GIF')
    if (usedGifAssets.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(
        `${usedGifAssets.length} animated GIF asset(s) will export as a single static frame — LVGL export has no GIF-playback path: ${usedGifAssets.map((a) => a.name).join(', ')}.`
      )
    }
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

  // ---- Keyboard widgets ----
  // Dangling targetTextareaId/debugLabelId (the linked widget was deleted, or moved out of this
  // export's scope), Danish keyboards missing a Danish-capable font, and custom-language keyboards
  // with no keys — three real correctness gaps that are otherwise silent until a real device shows
  // boxes/garbage or the generated C++ fails to compile (a dangling target/label id still resolves
  // via widgetVarName() to SOME identifier — just one that was never actually created in this
  // export's own file/scope, a real "undeclared identifier" compile error, not just a display bug).
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const inScopeIds = new Set(widgets.map((w) => w.id))
    const keyboards = widgets.filter((w) => w.type === 'keyboard' && w.keyboardConfig)
    const danglingLinks: string[] = []
    const outOfScopeLinks: string[] = []
    const missingFontKeyboards: string[] = []
    const danglingFontKeyboards: string[] = []
    const incompleteFontKeyboards: { label: string; missing: string[] }[] = []
    const unparsableFontKeyboards: string[] = []
    const emptyCustomLayouts: string[] = []
    const clippedKeyboards: { label: string; count: number }[] = []

    for (const w of keyboards) {
      const config = w.keyboardConfig!
      const label = w.tagId ?? w.id
      for (const [linkId, linkName] of [
        [config.targetTextareaId, 'output text area'],
        [config.debugLabelId, 'debug label']
      ] as const) {
        if (!linkId) continue
        const linked = uiDesign.widgets[linkId]
        if (!linked) danglingLinks.push(`${label}'s ${linkName}`)
        else if (!inScopeIds.has(linkId)) outOfScopeLinks.push(`${label}'s ${linkName} ("${linked.tagId ?? linked.id}")`)
      }

      if (config.language === 'danish' && config.danishCharsEnabled) {
        if (!config.customFontId) {
          missingFontKeyboards.push(label)
        } else {
          const font = uiDesign.customFonts.find((f) => f.id === config.customFontId)
          if (!font) {
            danglingFontKeyboards.push(label)
          } else {
            if (!parseFontVariableName(font.cSource)) unparsableFontKeyboards.push(`${label} ("${font.name}")`)
            const missing = missingDanishCodepoints(font.declaredCodepoints)
            if (missing.length > 0) incompleteFontKeyboards.push({ label: `${label} ("${font.name}")`, missing })
          }
        }
      }

      if (config.language === 'custom' && (!config.customLayout || config.customLayout.keys.length === 0)) {
        emptyCustomLayouts.push(label)
      }

      // Clipped-key diagnostic — only meaningful for shapes that skip the automatic round-display
      // curving math (see keyboardAdaptiveLayout.ts's own header comment). Adaptive/Round never
      // has a hit here by construction, so there's nothing to check or warn about for them.
      if ((config.shape === 'rectangular' || config.shape === 'custom') && uiDesign.display.shape === 'round') {
        const widgetRect = {
          x: typeof w.style.x === 'number' ? w.style.x : 0,
          y: typeof w.style.y === 'number' ? w.style.y : 0,
          width: typeof w.style.width === 'number' ? w.style.width : 0,
          height: typeof w.style.height === 'number' ? w.style.height : 0
        }
        const rows = resolveKeyboardMap(config, config.defaultCase, config.defaultPage)
        const rowLayouts = computeAdaptiveKeyboardRowLayout(uiDesign.display, widgetRect, rows, config.shape, config.edgePadding)
        const clipped = findClippedKeys(uiDesign.display, widgetRect, rowLayouts)
        if (clipped.length > 0) clippedKeyboards.push({ label, count: clipped.length })
      }
    }

    if (danglingLinks.length > 0) {
      status = 'failed'
      messages.push(`${danglingLinks.length} keyboard link(s) point to a widget that no longer exists: ${danglingLinks.join(', ')} — re-select the output text area/debug label in the Keyboard section.`)
    }
    if (outOfScopeLinks.length > 0) {
      status = 'failed'
      messages.push(`${outOfScopeLinks.length} keyboard link(s) point to a widget outside this export's scope: ${outOfScopeLinks.join(', ')} — the generated code would reference a variable that was never created here. Keep a keyboard and its linked widgets on the same screen.`)
    }
    if (danglingFontKeyboards.length > 0) {
      status = 'failed'
      messages.push(`${danglingFontKeyboards.length} keyboard(s) reference a custom font that no longer exists: ${danglingFontKeyboards.join(', ')} — re-select a font in the Keyboard section.`)
    }
    if (missingFontKeyboards.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(`${missingFontKeyboards.length} Danish keyboard(s) have no custom font selected: ${missingFontKeyboards.join(', ')} — LVGL's built-in Montserrat fonts don't include æ/ø/å, so those keys/text will show as boxes on real hardware. Attach a font in the Keyboard section's Font picker.`)
    }
    if (incompleteFontKeyboards.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(
        `${incompleteFontKeyboards.length} Danish keyboard(s)' selected font is missing glyphs: ${incompleteFontKeyboards.map((f) => `${f.label} missing ${f.missing.join('')}`).join('; ')} — those characters will show as boxes on real hardware.`
      )
    }
    if (unparsableFontKeyboards.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(`${unparsableFontKeyboards.length} keyboard(s)' selected font couldn't be parsed for its declared \`lv_font_t\` symbol name: ${unparsableFontKeyboards.join(', ')} — double-check it's real LVGL font-converter output; the export will guess a name from the font's own library name instead.`)
    }
    if (emptyCustomLayouts.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(`${emptyCustomLayouts.length} custom-layout keyboard(s) have no keys defined: ${emptyCustomLayouts.join(', ')} — add keys in the Keyboard section's custom layout editor, or the exported keyboard will be empty.`)
    }
    if (clippedKeyboards.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(
        `${clippedKeyboards.length} keyboard(s) may have keys clipped by the round display's edge: ${clippedKeyboards.map((k) => `${k.label} (${k.count} key(s))`).join(', ')} — switch Keyboard Shape to Adaptive or Round in the Keyboard section, or increase edge padding.`
      )
    }
    if (keyboards.length === 0) {
      messages.push('No keyboard widgets in scope.')
    } else if (messages.length === 0) {
      messages.push(`${keyboards.length} keyboard widget(s), all correctly linked.`)
    }
    results.push({ category: 'Keyboard widgets', status, messages })
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
      // The hardware-navigation namespace/function names (Main, Main_screen_focus_next, ...) are
      // derived from screenIdentBase, not screenCreateFnName's own PascalCase — check it
      // separately since the two can diverge (screenIdentBase strips a trailing "Screen" word
      // that screenCreateFnName instead guarantees is present).
      const navBase = screenIdentBase(s.name).toLowerCase()
      if (RESERVED_IDENTIFIERS.has(navBase) || !navBase) badIdentifiers.add(s.name)
    }
    for (const w of widgets) {
      if (!w.tagId) continue
      const name = widgetCreateFnName(w).replace(/^Create/, '').toLowerCase()
      if (RESERVED_IDENTIFIERS.has(name) || !name) badIdentifiers.add(w.tagId)
    }
    // List items — each item's own widgetId is what Project_Register()/find_<screen>_widget()
    // key off (see lvglExport.ts's listItemCreateLines/emitListItemLines), same as a widget's
    // tagId, so it needs the same reserved-word/empty check.
    const emptyItemIds: string[] = []
    for (const w of widgets) {
      if (w.type !== 'list') continue
      for (const item of w.listItems ?? []) {
        const trimmed = item.widgetId.trim()
        if (!trimmed) {
          emptyItemIds.push(item.text || '(untitled item)')
          continue
        }
        const sanitized = toCIdentifier(trimmed).toLowerCase()
        if (RESERVED_IDENTIFIERS.has(sanitized)) badIdentifiers.add(trimmed)
      }
    }
    if (emptyItemIds.length > 0) {
      status = 'failed'
      messages.push(`${emptyItemIds.length} list item(s) have no widget ID: ${emptyItemIds.join(', ')} — every item needs one to generate a valid Project_Register()/variable name.`)
    }
    if (badIdentifiers.size > 0) {
      status = 'failed'
      messages.push(`${badIdentifiers.size} name(s) sanitize to a reserved C++/Arduino word and would produce invalid generated code: ${[...badIdentifiers].join(', ')} — rename these widgets'/list items' ids.`)
    }
    // Duplicate widget ids (tagId) — the widget registry (s_widgetIds/s_widgetObjs, see
    // lvglExport.ts's Register()) is a flat id -> lv_obj_t* lookup, so two widgets sharing an id
    // means UI.setText()/UI.setValue()/UI.findWidget() can only ever reach whichever one
    // registered first — a real, silent runtime bug, not just a naming nicety. List item
    // widgetIds share this exact same flat registry (see emitListItemLines' Project_Register()
    // calls), so they're counted in the same namespace here, not a separate one.
    const idCounts = new Map<string, number>()
    for (const w of widgets) {
      if (w.tagId) idCounts.set(w.tagId, (idCounts.get(w.tagId) ?? 0) + 1)
      if (w.type === 'list') {
        for (const item of w.listItems ?? []) {
          const trimmed = item.widgetId.trim()
          if (trimmed) idCounts.set(trimmed, (idCounts.get(trimmed) ?? 0) + 1)
        }
      }
    }
    const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    if (duplicateIds.length > 0) {
      status = 'failed'
      messages.push(`${duplicateIds.length} widget/list-item id(s) are used by more than one widget or item: ${duplicateIds.join(', ')} — UI.setText()/setValue()/findWidget() can only ever reach one of them. Rename these to be unique.`)
    }
    if (badIdentifiers.size === 0 && duplicateIds.length === 0 && emptyItemIds.length === 0) {
      messages.push('Every screen/widget/list-item name generates a valid, unique C++ identifier.')
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
    for (const s of scopedScreens) {
      record(screenCreateFnName(s.name), `screen "${s.name}"`)
      // The per-screen hardware-navigation namespace (Main, Settings, ...) and its three methods
      // — see lvglExport.ts's generateKiboUIParts/generateUiScreenExport — land in the same flat
      // global-identifier space as every screen/widget name here, so two screens whose names both
      // sanitize to the same base (e.g. "Main" and "Main Screen") would collide on all four.
      const navBase = screenIdentBase(s.name)
      record(navBase, `screen "${s.name}"'s hardware-navigation namespace`)
      record(screenFocusNextFnName(s.name), `screen "${s.name}"'s focus-next helper`)
      record(screenFocusPreviousFnName(s.name), `screen "${s.name}"'s focus-previous helper`)
      record(screenPressFnName(s.name), `screen "${s.name}"'s press helper`)
    }
    // Widget -> owning screen name, for indicatorScreenFunctionPrefix below — mirrors
    // lvglExport.ts's own indicatorScreenNameById (generateKiboUIParts) / direct screen-name
    // threading (generateUiScreenExport/generateLiveScreenCode) so this check validates the exact
    // same screen-prefixed names those actually generate, not the pre-prefix ones.
    const screenNameByWidgetId = new Map<string, string>()
    for (const s of scopedScreens) {
      for (const w of reachableWidgetsForScreen(uiDesign, s)) screenNameByWidgetId.set(w.id, s.name)
    }
    for (const w of widgets) {
      if (w.tagId) record(widgetCreateFnName(w), `widget "${w.tagId}"`)
      if (w.type === 'list' && (w.listItems?.length ?? 0) > 0) {
        // Mirrors lvglExport.ts's computeListItemVars/emitListItemClickCallback naming exactly —
        // each item's own `<id>_item` C++ variable, plus the one shared `<list>_item_event_cb`
        // click-dispatch callback per list, both landing in the same flat function/variable
        // namespace as every screen/widget name above.
        for (const item of w.listItems ?? []) {
          const trimmed = item.widgetId.trim()
          if (trimmed) record(`${toCIdentifier(trimmed)}_item`, `list item "${item.text || trimmed}"`)
        }
        record(`${widgetBaseName(w)}_item_event_cb`, `list "${w.tagId ?? w.id}"'s item click callback`)
      }
      // Indicator helper functions (<Screen>_set<Base>Value/<Screen>_animate<Base>[To]/
      // <Screen>_start|stop<Base>Animation/<Screen>_reset<Base> — see lvglExport.ts's
      // emitIndicatorHelperFunctions) land in the same flat function namespace too, keyed off
      // indicatorFunctionBaseName (the tagId/id-derived default, or the Properties panel's
      // "Function name" override) PLUS the owning screen's own prefix (indicatorScreenFunctionPrefix)
      // — two indicators sharing a base name on the SAME screen still collide (checked here); two on
      // DIFFERENT screens no longer do, since their generated names are no longer identical. A widget
      // without a tagId still gets real functions (see widgetBaseName's own id-derived fallback), so
      // it's checked unconditionally.
      if (isIndicatorWidget(w.type)) {
        const prefix = indicatorScreenFunctionPrefix(screenNameByWidgetId.get(w.id) ?? '')
        const base = indicatorFunctionBaseName(w)
        const label = `indicator "${w.tagId ?? w.id}"`
        record(`${prefix}start${base}Animation`, label)
        record(`${prefix}stop${base}Animation`, label)
        if (INDICATOR_VALUE_WIDGET_TYPES.has(w.type)) {
          record(`${prefix}set${base}Value`, label)
          record(`${prefix}animate${base}`, label)
          record(`${prefix}animate${base}To`, label)
          record(`${prefix}reset${base}`, label)
        }
      }
    }
    if (widgets.some((w) => isIndicatorWidget(w.type) && w.tagId)) {
      record('setIndicatorValue', 'the global Indicator control API')
      record('animateIndicator', 'the global Indicator control API')
      record('animateIndicatorTo', 'the global Indicator control API')
      record('startIndicatorAnimation', 'the global Indicator control API')
      record('stopIndicatorAnimation', 'the global Indicator control API')
      record('resetIndicator', 'the global Indicator control API')
    }
    if (uiDesign.variables.some((v) => v.type === 'number')) record('updateDataValue', 'the global updateDataValue dispatcher')
    const collisions = [...fnNames.entries()].filter(([, labels]) => labels.length > 1)
    if (collisions.length > 0) {
      status = 'failed'
      messages.push(`${collisions.length} generated function name(s) collide: ${collisions.map(([fn, labels]) => `${fn} (${labels.join(', ')})`).join('; ')} — rename one of each pair.`)
    } else {
      messages.push('No generated function names collide.')
    }
    results.push({ category: 'Function name collisions', status, messages })
  }

  if (scope?.mode === 'screen' || scope?.mode === 'module' || scope?.mode === 'header') {
    // ---- Initialization isolation ----
    // Neither "UI Screen Only" (generateUiScreenExport) nor "Module"/"Header" mode's file
    // selection (ui.h/ui.cpp/assets only — no entry sketch, no config.h) ever calls lv_init/
    // lv_display_create/SPI.begin/Wire.begin anywhere in its code path — asserted here by
    // construction (verified by this file's own design, not by re-generating and scanning the
    // output text, which would need the same async RGB565 asset decode the real export does) —
    // making the requirement explicit and checkable rather than an unstated assumption.
    results.push({
      category: 'Initialization isolation',
      status: 'passed',
      messages: ['This export mode never emits LVGL/display/SPI/board initialization code — safe to drop into a project that already calls lv_init() and has a display registered.']
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

  // ---- Project name ----
  // Empty/whitespace-only falls back to naming.ts's DEFAULT_IDENTIFIER/DEFAULT_FILENAME
  // ('MyUiProject'/'My-Ui-Project') everywhere a name would otherwise appear (namespace, zip/
  // folder/entry-sketch filenames) — not a compile-breaking problem, but confusing enough
  // ("why is my export called My-Ui-Project?") to flag explicitly rather than silently fall
  // back, per the "show the final generated names before export" requirement.
  {
    const trimmed = project.name.trim()
    const ns = sanitizeIdentifier(project.name)
    const filename = sanitizeFilename(project.name)
    results.push({
      category: 'Project name',
      status: trimmed ? 'passed' : 'warning',
      messages: trimmed
        ? [`"${project.name}" → namespace \`${ns}\`, filenames use \`${filename}\`.`]
        : [`No project name set — this export will fall back to \`${ns}\`/\`${filename}\`. Set a name in the Export dialog or Project Name field for a recognizable namespace/filename.`]
    })
  }

  // ---- Entry point ---- (module/header modes have no entry sketch — see "Initialization
  // isolation" above — so this check is meaningless for them and is skipped, same as screen mode)
  if (scope?.mode !== 'screen' && scope?.mode !== 'module' && scope?.mode !== 'header') {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    if (uiDesign.screens.length === 0) {
      status = 'failed'
      messages.push('No screens exist — the generated entry point would have nothing to show.')
    } else {
      const entryFile = scope?.mode === 'complete' ? (scope.target.format === 'arduino' ? `${sanitizeFilename(project.name)}.ino` : 'main.cpp') : 'the standalone screen file'
      const showFnName = screenShowFnName(uiDesign.screens[0].name)
      const showMethod = showFnName.charAt(0).toLowerCase() + showFnName.slice(1)
      messages.push(`${entryFile} will call UI.${showMethod}() to show "${uiDesign.screens[0].name}".`)
    }
    results.push({ category: 'Entry point', status, messages })
  }

  // ---- Variable Manager ---- (skipped for "UI Screen Only" — variables aren't included in that
  // export at all, see the "Event callbacks"/"Logic tab script" notes)
  if (scope?.mode !== 'screen') {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const nameCounts = new Map<string, number>()
    for (const v of uiDesign.variables) {
      const name = v.name.trim()
      if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
    }
    const duplicateNames = [...nameCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name)
    const unnamed = uiDesign.variables.filter((v) => !v.name.trim())
    if (duplicateNames.length > 0) {
      status = 'failed'
      // Two variables named "Temperature" both generate the identical g_var_Temperature static
      // and Get/SetTemperature() functions — a real "redefinition" compile error, not just a
      // display-name nicety.
      messages.push(`${duplicateNames.length} variable name(s) are used more than once: ${duplicateNames.join(', ')} — each would generate the same C++ static/getter/setter. Rename one of each pair.`)
    }
    if (unnamed.length > 0) {
      status = 'failed'
      messages.push(`${unnamed.length} variable(s) have no name — every Variable Manager entry needs one to generate a valid getter/setter.`)
    }
    if (duplicateNames.length === 0 && unnamed.length === 0) {
      messages.push(uiDesign.variables.length > 0 ? `${uiDesign.variables.length} variable(s), all uniquely named.` : 'No variables defined yet.')
    }
    results.push({ category: 'Variable Manager', status, messages })
  }

  // ---- Data bindings ---- (skipped for "UI Screen Only" for the same reason as above)
  if (scope?.mode !== 'screen') {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const variableNames = new Set(uiDesign.variables.map((v) => v.name))
    const bindingRows = parseVisualBindingRows(uiDesign.script, uiDesign.widgets)
    const dangling = bindingRows.filter((r) => !variableNames.has(r.variableName))
    if (dangling.length > 0) {
      status = 'failed'
      const labels = dangling.map((r) => `"${r.targetRefName}.${r.property === 'text' ? 'bindText' : r.property === 'value' ? 'bindValue' : 'bindVisible'}(data.${r.variableName})"`)
      messages.push(`${dangling.length} binding(s) reference a variable that no longer exists in the Variable Manager: ${labels.join(', ')}.`)
    }
    if (bindingRows.length > 0) {
      messages.push(`${bindingRows.length - dangling.length}/${bindingRows.length} binding(s) resolve to a real Variable Manager entry.`)
    } else {
      messages.push('No data bindings authored yet.')
    }
    results.push({ category: 'Data bindings', status, messages })
  }

  // ---- Indicators (Progress Bar/Slider/Gauge/Arc/Spinner) ----
  {
    const propNum = (w: (typeof widgets)[number], key: string, fallback: number): number => {
      const v = w.props[key]
      return typeof v === 'number' ? v : fallback
    }
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const indicatorWidgets = widgets.filter((w) => isIndicatorWidget(w.type))
    const badRange = indicatorWidgets.filter((w) => INDICATOR_VALUE_WIDGET_TYPES.has(w.type) && propNum(w, 'max', 100) <= propNum(w, 'min', 0))
    if (badRange.length > 0) {
      status = 'failed'
      messages.push(`${badRange.length} indicator(s) have Max <= Min, so their fill/percentage can never compute correctly: ${badRange.map((w) => w.tagId ?? w.id).join(', ')}.`)
    }
    const badStep = indicatorWidgets.filter((w) => {
      if (!INDICATOR_VALUE_WIDGET_TYPES.has(w.type)) return false
      const step = propNum(w, 'step', 0)
      if (step <= 0) return false
      const span = propNum(w, 'max', 100) - propNum(w, 'min', 0)
      return span > 0 && Math.abs(span % step) > 0.0001
    })
    if (badStep.length > 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push(
        `${badStep.length} indicator(s) have a Step that doesn't evenly divide (Max - Min) — the last step will be a partial increment: ${badStep.map((w) => w.tagId ?? w.id).join(', ')}.`
      )
    }
    if (indicatorWidgets.length > 0) messages.push(`${indicatorWidgets.length} indicator widget(s) checked.`)
    else messages.push('No Progress Bar/Slider/Gauge/Arc/Spinner widgets in this project yet.')
    results.push({ category: 'Indicators', status, messages })
  }

  // ---- Options Source bindings (Dropdown/Roller/Tabs) ----
  {
    const messages: string[] = []
    let status: LvglValidationStatus = 'passed'
    const dataSourceIds = new Set(uiDesign.dataSources.map((d) => d.id))
    const bound = widgets.filter((w) => (w.type === 'dropdown' || w.type === 'roller' || w.type === 'tabs') && !!w.optionsSource?.dataSourceId)
    const dangling = bound.filter((w) => !dataSourceIds.has(w.optionsSource!.dataSourceId!))
    if (dangling.length > 0) {
      status = 'failed'
      messages.push(
        `${dangling.length} widget(s) reference a data source that no longer exists in the Data Sources tab: ${dangling.map((w) => w.tagId ?? w.id).join(', ')}.`
      )
    }
    const boundTabs = bound.filter((w) => w.type === 'tabs' && dataSourceIds.has(w.optionsSource!.dataSourceId!))
    if (boundTabs.length > 0) {
      messages.push(
        `${boundTabs.length} Tabs widget(s) are bound to a data source — tabs are baked from its sample data at export time and won't add/remove tabs at runtime (LVGL's tab view has no cheap way to change tab count after creation): ${boundTabs.map((w) => w.tagId ?? w.id).join(', ')}.`
      )
    }
    if (bound.length > 0) {
      messages.push(`${bound.length - dangling.length}/${bound.length} Options Source binding(s) resolve to a real Data Source.`)
    }
    results.push({ category: 'Options Source bindings', status, messages })
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
