// UI Design Mode's LVGL C++ exporter — a completely standalone generator that reads ONLY
// `project.uiDesign`. It never imports from or reads `project.eyeBase`, `project.animations`,
// `project.expressions`, `project.stickers`, `project.stickerAssets`, `project.visualReference`,
// or `project.customPupilShapes` — that structural isolation (not a filter/allowlist applied
// after the fact) is what actually guarantees the exported LVGL project can never contain any
// Eye Studio code, by construction rather than by convention. See validateLvglExport.ts for the
// automated check that confirms this. The lib/uiDesign/scriptLang/* imports below (the
// JS-like behavior script's C++ codegen) are held to the same rule — they only ever read
// `project.uiDesign.script` plus the widget/asset/CSS data already passed in here.
//
// Targets LVGL v9.x (ported from this feature's original v8.3.x target after the user's
// installed library turned out to be v9.5.0 — v9 replaced the display-driver API entirely and
// renamed several widget-creation/style/image functions; see the LVGL v9 migration notes this
// port was written against).
//
// Output is a small set of files (KiboUI.h/.cpp, KiboUIAssets.h/.cpp, KiboUIConfig.h,
// Example.ino, README.md) assembled by generateLvglExport() — see that function at the bottom
// for the overall composition, mirroring cppExport.ts's own section-generator-function style.

import type { Project, UiAsset, UiCssRule, UiDesignProject, UiDisplaySettings, UiWidget, UiWidgetStateName, UiWidgetStyle, UiWidgetType } from '@/types'
import { UI_WIDGET_LABELS } from '@/types'
import { decodeDataUrlToRgba } from '@/lib/import/uiAssetImport'
import { matchesSelector } from '@/lib/uiDesign/selectors'
import { generateScriptCpp, type CodegenContext, type CodegenResult } from '@/lib/uiDesign/scriptLang/codegen'
import { parseScript } from '@/lib/uiDesign/scriptLang/parser'
import { LV_CONF_TEMPLATE_V9 } from './lvConfTemplate'

const LVGL_VERSION = '9.x'

// ---------------------------------------------------------------------------------------------
// Identifier helpers
// ---------------------------------------------------------------------------------------------

function toPascalCase(raw: string): string {
  const words = raw
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'Widget'
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

function toCIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1')
  return cleaned || '_'
}

/** Local C++ variable name for a widget's `lv_obj_t*` — stable, derived from tagId when set
 * (so generated code reads naturally, e.g. `wifi_btn`) or from the widget's short id otherwise.
 * Exported for scriptLang/codegen.ts's CodegenContext (see buildCodegenContext below) — the
 * script codegen needs the exact same variable name this file's own widget-creation code uses. */
export function widgetVarName(widget: UiWidget): string {
  const base = widget.tagId ? toCIdentifier(widget.tagId) : `w_${widget.id.slice(0, 6)}`
  return `${base}_obj`
}

/** `Create<Name>[<Kind>]()` function name for a named (tagId-bearing) widget — appends the
 * widget kind (Button/Label/...) unless the id already reads as ending with it, so `id="wifi"`
 * (a button) becomes `CreateWifiButton` while `id="statusLabel"` (a label) becomes
 * `CreateStatusLabel` rather than the redundant `CreateStatusLabelLabel`. */
function widgetCreateFnName(widget: UiWidget): string {
  const idPascal = toPascalCase(widget.tagId ?? widget.id)
  const kindPascal = toPascalCase(UI_WIDGET_LABELS[widget.type])
  const alreadyEndsWithKind = idPascal.toLowerCase().endsWith(kindPascal.toLowerCase())
  return `Create${idPascal}${alreadyEndsWithKind ? '' : kindPascal}`
}

function screenCreateFnName(screenName: string): string {
  const pascal = toPascalCase(screenName)
  return pascal.toLowerCase().endsWith('screen') ? `Create${pascal}` : `Create${pascal}Screen`
}

export function screenShowFnName(screenName: string): string {
  const pascal = toPascalCase(screenName)
  return pascal.toLowerCase().endsWith('screen') ? `Show${pascal}` : `Show${pascal}Screen`
}

// ---------------------------------------------------------------------------------------------
// Widget tree helpers
// ---------------------------------------------------------------------------------------------

const CONTAINER_LIKE: ReadonlySet<UiWidgetType> = new Set(['screen', 'container', 'flex', 'list', 'tabs'])

function children(uiDesign: UiDesignProject, widget: UiWidget): UiWidget[] {
  if (!CONTAINER_LIKE.has(widget.type)) return []
  return widget.childIds.map((id) => uiDesign.widgets[id]).filter((w): w is UiWidget => !!w && w.visible)
}

/** Every widget reachable from any screen's root, in tree order — used to decide which CSS
 * rules/assets/styles are actually referenced (so unused ones don't bloat the export or trip
 * "unresolved" validation). */
function allReachableWidgets(uiDesign: UiDesignProject): UiWidget[] {
  const out: UiWidget[] = []
  const seen = new Set<string>()
  const visit = (widget: UiWidget) => {
    if (seen.has(widget.id)) return
    seen.add(widget.id)
    out.push(widget)
    for (const child of children(uiDesign, widget)) visit(child)
  }
  for (const screen of uiDesign.screens) {
    const root = uiDesign.widgets[screen.rootWidgetId]
    if (root) visit(root)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Style export — one shared lv_style_t per CSS rule (selector), applied in tag/class/id
// specificity order, plus one local style per widget for direct/inline overrides not already
// covered — mirrors lib/uiDesign/cssCascade.ts's cascade semantics exactly so the exported
// firmware matches the studio preview, while still sharing style structs across widgets that
// match the same rule (real LVGL best practice — one style object, many widgets).
// ---------------------------------------------------------------------------------------------

const STATE_LVGL_ENUM: Record<Exclude<UiWidgetStateName, 'hover'>, string> = {
  pressed: 'LV_STATE_PRESSED',
  disabled: 'LV_STATE_DISABLED',
  focused: 'LV_STATE_FOCUSED'
}

function selectorRank(selector: string): number {
  if (selector.startsWith('#')) return 2
  if (selector.startsWith('.')) return 1
  return 0
}

function selectorIdent(selector: string): string {
  return toCIdentifier(selector.replace(/^[.#]/, selector[0] === '#' ? 'id_' : 'class_'))
}

function colorLiteral(css: string | undefined): string | null {
  if (!css) return null
  const hex = css.trim().match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return `lv_color_hex(0x${h.toUpperCase()})`
  }
  const rgb = css.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return `lv_color_make(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`
  return null // named CSS colors ("white", "red", ...) aren't resolved here — Properties panel's color picker always writes hex, so this only matters for hand-edited CSS text.
}

/** Emits `lv_style_set_*` calls for the style fields this pass supports, skipping any field
 * `undefined` on `style` (LVGL default applies). Position (x/y) and size (width/height) are
 * intentionally excluded — those are layout, set per-widget via lv_obj_set_pos/set_size in the
 * widget-creation code, never via a shared style struct (a shared style can't hold a
 * per-instance position anyway). */
function styleSetCalls(varName: string, style: Partial<UiWidgetStyle>, identByAssetId: Map<string, string>, indent = '  '): string[] {
  const lines: string[] = []
  const set = (call: string) => lines.push(`${indent}${call}`)

  if (style.backgroundImage !== undefined) {
    const ident = identByAssetId.get(style.backgroundImage)
    if (ident) {
      set(`lv_style_set_bg_image_src(&${varName}, &${ident});`)
      set(`lv_style_set_bg_image_opa(&${varName}, LV_OPA_COVER);`)
      if (style.backgroundSize === 'tile') {
        set(`lv_style_set_bg_image_tiled(&${varName}, true);`)
      } else if (style.backgroundSize && style.backgroundSize !== 'stretch') {
        set(`// backgroundSize "${style.backgroundSize}" has no direct LVGL bg-image equivalent (only tiled/natural-size are supported) — image draws at its native size, anchored top-left.`)
      }
    }
  }
  if (style.background !== undefined) {
    const c = colorLiteral(style.background)
    if (c) set(`lv_style_set_bg_color(&${varName}, ${c});`)
    set(`lv_style_set_bg_opa(&${varName}, LV_OPA_COVER);`)
  }
  if (style.backgroundGradient) {
    const c2 = colorLiteral(style.backgroundGradient.to)
    if (c2) {
      set(`lv_style_set_bg_grad_color(&${varName}, ${c2});`)
      set(`lv_style_set_bg_grad_dir(&${varName}, ${style.backgroundGradient.direction === 'horizontal' ? 'LV_GRAD_DIR_HOR' : 'LV_GRAD_DIR_VER'});`)
    }
  }
  if (style.opacity !== undefined) set(`lv_style_set_opa(&${varName}, ${Math.round((style.opacity / 100) * 255)});`)
  if (style.borderWidth !== undefined) set(`lv_style_set_border_width(&${varName}, ${Math.round(style.borderWidth)});`)
  if (style.borderColor !== undefined) {
    const c = colorLiteral(style.borderColor)
    if (c) set(`lv_style_set_border_color(&${varName}, ${c});`)
  }
  if (style.borderRadius !== undefined) set(`lv_style_set_radius(&${varName}, ${Math.round(style.borderRadius)});`)
  if (style.color !== undefined) {
    const c = colorLiteral(style.color)
    if (c) set(`lv_style_set_text_color(&${varName}, ${c});`)
  }
  if (style.fontSize !== undefined) {
    const size = style.fontSize <= 12 ? 12 : style.fontSize <= 14 ? 14 : style.fontSize <= 16 ? 16 : style.fontSize <= 18 ? 18 : style.fontSize <= 20 ? 20 : 24
    set(`lv_style_set_text_font(&${varName}, &lv_font_montserrat_${size}); // nearest built-in LVGL font size to ${Math.round(style.fontSize)}px`)
  }
  if (style.letterSpacing !== undefined) set(`lv_style_set_text_letter_space(&${varName}, ${Math.round(style.letterSpacing)});`)
  if (style.textAlign !== undefined) {
    const align = style.textAlign === 'center' ? 'LV_TEXT_ALIGN_CENTER' : style.textAlign === 'right' ? 'LV_TEXT_ALIGN_RIGHT' : 'LV_TEXT_ALIGN_LEFT'
    set(`lv_style_set_text_align(&${varName}, ${align});`)
  }
  if (style.paddingTop !== undefined) set(`lv_style_set_pad_top(&${varName}, ${Math.round(style.paddingTop)});`)
  if (style.paddingBottom !== undefined) set(`lv_style_set_pad_bottom(&${varName}, ${Math.round(style.paddingBottom)});`)
  if (style.paddingLeft !== undefined) set(`lv_style_set_pad_left(&${varName}, ${Math.round(style.paddingLeft)});`)
  if (style.paddingRight !== undefined) set(`lv_style_set_pad_right(&${varName}, ${Math.round(style.paddingRight)});`)
  if (style.shadowWidth !== undefined) {
    set(`lv_style_set_shadow_width(&${varName}, ${Math.round(style.shadowWidth)});`)
    if (style.shadowColor !== undefined) {
      const c = colorLiteral(style.shadowColor)
      if (c) set(`lv_style_set_shadow_color(&${varName}, ${c});`)
    }
    if (style.shadowOffsetX !== undefined) set(`lv_style_set_shadow_offset_x(&${varName}, ${Math.round(style.shadowOffsetX)});`)
    if (style.shadowOffsetY !== undefined) set(`lv_style_set_shadow_offset_y(&${varName}, ${Math.round(style.shadowOffsetY)});`)
  }
  if (style.flexDirection !== undefined) {
    set(`lv_style_set_flex_flow(&${varName}, ${style.flexDirection === 'row' ? 'LV_FLEX_FLOW_ROW' : 'LV_FLEX_FLOW_COLUMN'}${style.flexWrap ? '_WRAP' : ''});`)
  }
  if (style.justifyContent !== undefined || style.alignItems !== undefined) {
    const main =
      style.justifyContent === 'center'
        ? 'LV_FLEX_ALIGN_CENTER'
        : style.justifyContent === 'end'
          ? 'LV_FLEX_ALIGN_END'
          : style.justifyContent === 'space-between'
            ? 'LV_FLEX_ALIGN_SPACE_BETWEEN'
            : style.justifyContent === 'space-around'
              ? 'LV_FLEX_ALIGN_SPACE_AROUND'
              : 'LV_FLEX_ALIGN_START'
    const cross = style.alignItems === 'center' ? 'LV_FLEX_ALIGN_CENTER' : style.alignItems === 'end' ? 'LV_FLEX_ALIGN_END' : 'LV_FLEX_ALIGN_START'
    set(`lv_style_set_flex_main_place(&${varName}, ${main});`)
    set(`lv_style_set_flex_cross_place(&${varName}, ${cross});`)
    set(`lv_style_set_flex_track_place(&${varName}, ${cross});`)
  }
  if (style.gap !== undefined) {
    set(`lv_style_set_pad_row(&${varName}, ${Math.round(style.gap)});`)
    set(`lv_style_set_pad_column(&${varName}, ${Math.round(style.gap)});`)
  }

  return lines
}

interface CssRuleExport {
  rule: UiCssRule
  ident: string
}

/** Only CSS rules that actually match a reachable widget are exported — an authored-but-unused
 * rule doesn't cost any flash. */
function usedCssRules(uiDesign: UiDesignProject, widgets: UiWidget[]): CssRuleExport[] {
  const used = new Set<string>()
  for (const w of widgets) {
    for (const rule of uiDesign.css) {
      if (matchesSelector(w, rule.selector)) used.add(rule.id)
    }
  }
  return uiDesign.css.filter((r) => used.has(r.id)).map((rule) => ({ rule, ident: `style_sel_${selectorIdent(rule.selector)}` }))
}

function matchingRulesForWidget(widget: UiWidget, rules: CssRuleExport[]): CssRuleExport[] {
  return rules.filter((r) => matchesSelector(widget, r.rule.selector)).sort((a, b) => selectorRank(a.rule.selector) - selectorRank(b.rule.selector))
}

/** True when `style` has at least one visual (non-layout) field set — layout fields (x/y/
 * width/height) don't count since those never go into an lv_style_t (see styleSetCalls). */
function hasVisualStyle(style: Partial<UiWidgetStyle> | undefined): boolean {
  if (!style) return false
  const { x: _x, y: _y, width: _w, height: _h, visible: _v, zIndex: _z, imageFit: _f, rotation: _r, ...rest } = style
  return Object.values(rest).some((v) => v !== undefined)
}

function exportLvglStyles(widgets: UiWidget[], rules: CssRuleExport[], identByAssetId: Map<string, string>): string {
  const lines: string[] = [
    '// ---------------------------------------------------------------------------------------',
    '// Styles — one shared lv_style_t per CSS rule (applied to every matching widget, in',
    '// tag < class < id specificity order, matching real CSS), plus one local style per widget',
    '// for direct/inline overrides. Do not edit the *_style_* generated bodies below by hand —',
    "// change the design in Kibo Eye Studio's UI Design Mode and re-export instead.",
    '// ---------------------------------------------------------------------------------------',
    ''
  ]

  for (const { ident } of rules) {
    lines.push(`static lv_style_t ${ident};`)
  }
  for (const w of widgets) {
    if (hasVisualStyle(w.style)) lines.push(`static lv_style_t style_local_${widgetVarName(w)};`)
    for (const stateName of Object.keys(w.states) as UiWidgetStateName[]) {
      if (stateName === 'hover') continue // no touchscreen equivalent — see the note in KiboUI_InitStyles()
      if (hasVisualStyle(w.states[stateName])) lines.push(`static lv_style_t style_local_${widgetVarName(w)}_${stateName};`)
    }
  }
  lines.push('')

  lines.push('static void KiboUI_InitStyles() {')
  lines.push('  // "hover" styles authored in the CSS editor are intentionally not emitted here —')
  lines.push('  // LVGL has no hover state on a touchscreen; the closest real equivalent is')
  lines.push('  // LV_STATE_PRESSED, which "pressed" styles below already use.')
  for (const { rule, ident } of rules) {
    lines.push(`  lv_style_init(&${ident});`)
    lines.push(...styleSetCalls(ident, rule.style, identByAssetId))
    for (const stateName of Object.keys(rule.states) as UiWidgetStateName[]) {
      if (stateName === 'hover' || !hasVisualStyle(rule.states[stateName])) continue
      const stateIdent = `${ident}_${stateName}`
      lines.push(`  static lv_style_t ${stateIdent}; lv_style_init(&${stateIdent});`)
      lines.push(...styleSetCalls(stateIdent, rule.states[stateName]!, identByAssetId))
    }
    lines.push('')
  }
  for (const w of widgets) {
    if (hasVisualStyle(w.style)) {
      const varName = `style_local_${widgetVarName(w)}`
      lines.push(`  lv_style_init(&${varName});`)
      lines.push(...styleSetCalls(varName, w.style, identByAssetId))
      lines.push('')
    }
    for (const stateName of Object.keys(w.states) as UiWidgetStateName[]) {
      if (stateName === 'hover' || !hasVisualStyle(w.states[stateName])) continue
      const varName = `style_local_${widgetVarName(w)}_${stateName}`
      lines.push(`  lv_style_init(&${varName});`)
      lines.push(...styleSetCalls(varName, w.states[stateName]!, identByAssetId))
      lines.push('')
    }
  }
  lines.push('}')

  return lines.join('\n')
}

/** Emits the lv_obj_add_style() calls that apply a widget's cascade (matching CSS rules in
 * specificity order, then its own local override style last — "inline beats stylesheet"). */
function styleApplyCalls(widget: UiWidget, rules: CssRuleExport[], varName: string, indent = '  '): string[] {
  const lines: string[] = []
  for (const { rule, ident } of matchingRulesForWidget(widget, rules)) {
    lines.push(`${indent}lv_obj_add_style(${varName}, &${ident}, LV_PART_MAIN | LV_STATE_DEFAULT);`)
    for (const stateName of Object.keys(rule.states) as UiWidgetStateName[]) {
      if (stateName === 'hover' || !hasVisualStyle(rule.states[stateName])) continue
      lines.push(`${indent}lv_obj_add_style(${varName}, &${ident}_${stateName}, LV_PART_MAIN | ${STATE_LVGL_ENUM[stateName]});`)
    }
  }
  if (hasVisualStyle(widget.style)) {
    lines.push(`${indent}lv_obj_add_style(${varName}, &style_local_${widgetVarName(widget)}, LV_PART_MAIN | LV_STATE_DEFAULT);`)
  }
  for (const stateName of Object.keys(widget.states) as UiWidgetStateName[]) {
    if (stateName === 'hover' || !hasVisualStyle(widget.states[stateName])) continue
    lines.push(`${indent}lv_obj_add_style(${varName}, &style_local_${widgetVarName(widget)}_${stateName}, LV_PART_MAIN | ${STATE_LVGL_ENUM[stateName]});`)
  }
  return lines
}

// ---------------------------------------------------------------------------------------------
// Assets — lv_image_dsc_t + LV_COLOR_FORMAT_RGB565A8 pixel data (RGB565 color plane followed by
// a real 8-bit alpha plane, LVGL v9's native "RGB565 with real alpha" format), decoded from
// each used asset's stored dataUrl at export time (see
// decodeDataUrlToRgba — never persisted in the project file, unlike the sticker system's small
// icons, since these can be up to the full 240px display).
// ---------------------------------------------------------------------------------------------

/** Includes both `src` (image/icon widgets) and `backgroundImage` references — from every
 * widget's default style AND per-state styles, plus every used CSS rule's style/states — so an
 * asset only ever assigned as a background (never a widget's `src`) still gets exported. */
function usedAssets(uiDesign: UiDesignProject, widgets: UiWidget[], rules: CssRuleExport[]): UiAsset[] {
  const usedIds = new Set<string>()
  for (const w of widgets) {
    if (w.src) usedIds.add(w.src)
    if (w.style.backgroundImage) usedIds.add(w.style.backgroundImage)
    for (const stateStyle of Object.values(w.states)) {
      if (stateStyle?.backgroundImage) usedIds.add(stateStyle.backgroundImage)
    }
  }
  for (const { rule } of rules) {
    if (rule.style.backgroundImage) usedIds.add(rule.style.backgroundImage)
    for (const stateStyle of Object.values(rule.states)) {
      if (stateStyle?.backgroundImage) usedIds.add(stateStyle.backgroundImage)
    }
  }
  return uiDesign.assets.filter((a) => usedIds.has(a.id))
}

function assetIdent(asset: UiAsset, index: number): string {
  return `kibo_img_${toCIdentifier(asset.name.replace(/\.[^.]+$/, '')) || index}_${index}`
}

async function exportLvglAssets(uiDesign: UiDesignProject, widgets: UiWidget[], rules: CssRuleExport[]): Promise<{ header: string; source: string; identByAssetId: Map<string, string> }> {
  const assets = usedAssets(uiDesign, widgets, rules)
  const identByAssetId = new Map<string, string>()

  const headerLines = [
    '/*',
    ' * KiboUIAssets.h',
    ' *',
    ' * Generated by Kibo Eye Studio — UI/UX Design Mode.',
    ' * Declares every image asset used by the exported UI. Do not edit by hand — re-export',
    ' * from Kibo Eye Studio after changing images in the Asset Manager instead.',
    ' */',
    '#pragma once',
    '#include "lvgl.h"',
    ''
  ]
  const sourceLines = ['#include "KiboUIAssets.h"', '']

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    const ident = assetIdent(asset, i)
    identByAssetId.set(asset.id, ident)
    headerLines.push(`LV_IMAGE_DECLARE(${ident});`)

    const rgba = await decodeDataUrlToRgba(asset.dataUrl)
    // LV_COLOR_FORMAT_RGB565A8: the color plane (RGB565, 2 bytes/pixel, row-major) followed by
    // a separate alpha plane (1 byte/pixel, row-major) — real 0-255 alpha per pixel (LVGL v9's
    // native format for this; the old v8 export could only do binary on/off transparency since
    // TRUE_COLOR_ALPHA interleaved a fixed-size per-pixel record with no room for real alpha at
    // RGB565 depth).
    const colorBytes: string[] = []
    const alphaBytes: string[] = []
    for (let p = 0; p < rgba.width * rgba.height; p++) {
      const r = rgba.data[p * 4] ?? 0
      const g = rgba.data[p * 4 + 1] ?? 0
      const b = rgba.data[p * 4 + 2] ?? 0
      const a = rgba.data[p * 4 + 3] ?? 0
      const rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
      colorBytes.push(String(rgb565 & 0xff), String((rgb565 >> 8) & 0xff))
      alphaBytes.push(String(a))
    }
    const pixels = [...colorBytes, ...alphaBytes]
    sourceLines.push(`// "${asset.name}" (${rgba.width}x${rgba.height})`)
    sourceLines.push(`static const uint8_t ${ident}_map[] = {`)
    for (let p = 0; p < pixels.length; p += 16) {
      sourceLines.push(`  ${pixels.slice(p, p + 16).join(', ')},`)
    }
    sourceLines.push('};')
    sourceLines.push(`const lv_image_dsc_t ${ident} = {`)
    sourceLines.push('  .header = {')
    sourceLines.push('    .cf = LV_COLOR_FORMAT_RGB565A8,')
    sourceLines.push(`    .w = ${rgba.width},`)
    sourceLines.push(`    .h = ${rgba.height},`)
    sourceLines.push(`    .stride = ${rgba.width * 2},`)
    sourceLines.push('  },')
    sourceLines.push(`  .data_size = ${pixels.length},`)
    sourceLines.push(`  .data = ${ident}_map,`)
    sourceLines.push('};')
    sourceLines.push('')
  }

  return { header: headerLines.join('\n'), source: sourceLines.join('\n'), identByAssetId }
}

// ---------------------------------------------------------------------------------------------
// Widget creation + events
// ---------------------------------------------------------------------------------------------

function propNum(widget: UiWidget, key: string, fallback: number): number {
  const v = widget.props[key]
  return typeof v === 'number' ? v : fallback
}

function widgetTextLiteral(text: string | undefined): string {
  return JSON.stringify(text ?? '')
}

/** Emits the LVGL creation call(s) for one widget kind — position/size + kind-specific setup.
 * `varName` is the local `lv_obj_t*` this widget's create call assigns to; `parentVar` is its
 * LVGL parent object. */
// A plain number is px; "auto" has no direct LVGL equivalent so it falls back to
// LV_SIZE_CONTENT (size-to-fit — the closest available behavior); "N%" becomes lv_pct(N), LVGL's
// percentage-of-parent sizing — this is what makes a percentage-sized widget in the studio
// preview actually stay proportional on real hardware too, including across a display resize.
function lengthToLvglSize(v: UiWidget['style']['width']): string {
  if (typeof v === 'number') return String(Math.round(v))
  if (typeof v === 'string' && v.endsWith('%')) return `lv_pct(${Math.round(Number(v.slice(0, -1)))})`
  return 'LV_SIZE_CONTENT'
}

function widgetCreateCalls(widget: UiWidget, varName: string, parentVar: string, identByAssetId: Map<string, string>, indent: string): string[] {
  const lines: string[] = []
  const x = typeof widget.style.x === 'number' ? Math.round(widget.style.x) : 0
  const y = typeof widget.style.y === 'number' ? Math.round(widget.style.y) : 0
  const width = lengthToLvglSize(widget.style.width)
  const height = lengthToLvglSize(widget.style.height)

  switch (widget.type) {
    case 'container':
    case 'flex':
      lines.push(`${indent}${varName} = lv_obj_create(${parentVar});`)
      if (widget.style.flexDirection) lines.push(`${indent}lv_obj_set_flex_flow(${varName}, ${widget.style.flexDirection === 'row' ? 'LV_FLEX_FLOW_ROW' : 'LV_FLEX_FLOW_COLUMN'});`)
      break
    case 'button':
      lines.push(`${indent}${varName} = lv_button_create(${parentVar});`)
      // The label child is always created (not only when widget.text is non-empty at design
      // time) so a script's button.setText(...) — which targets this child, see codegen.ts's
      // renderWidgetMethodCall — always has somewhere to write, even for a button with no
      // initial text.
      lines.push(`${indent}${varName}_label = lv_label_create(${varName});`)
      if (widget.text) lines.push(`${indent}lv_label_set_text(${varName}_label, ${widgetTextLiteral(widget.text)});`)
      lines.push(`${indent}lv_obj_center(${varName}_label);`)
      break
    case 'label':
      lines.push(`${indent}${varName} = lv_label_create(${parentVar});`)
      lines.push(`${indent}lv_label_set_text(${varName}, ${widgetTextLiteral(widget.text)});`)
      break
    case 'image':
    case 'icon': {
      lines.push(`${indent}${varName} = lv_image_create(${parentVar});`)
      const ident = widget.src ? identByAssetId.get(widget.src) : undefined
      if (ident) lines.push(`${indent}lv_image_set_src(${varName}, &${ident});`)
      else lines.push(`${indent}// No image asset assigned in Kibo Eye Studio for this ${widget.type} yet.`)
      if (widget.style.rotation) {
        lines.push(`${indent}lv_image_set_rotation(${varName}, ${Math.round(widget.style.rotation * 10)}); // 0.1-degree units`)
      }
      break
    }
    case 'switch':
      lines.push(`${indent}${varName} = lv_switch_create(${parentVar});`)
      if (widget.props.checked) lines.push(`${indent}lv_obj_add_state(${varName}, LV_STATE_CHECKED);`)
      break
    case 'slider':
      lines.push(`${indent}${varName} = lv_slider_create(${parentVar});`)
      lines.push(`${indent}lv_slider_set_range(${varName}, ${propNum(widget, 'min', 0)}, ${propNum(widget, 'max', 100)});`)
      lines.push(`${indent}lv_slider_set_value(${varName}, ${propNum(widget, 'value', 0)}, LV_ANIM_OFF);`)
      break
    case 'bar':
      lines.push(`${indent}${varName} = lv_bar_create(${parentVar});`)
      lines.push(`${indent}lv_bar_set_range(${varName}, ${propNum(widget, 'min', 0)}, ${propNum(widget, 'max', 100)});`)
      lines.push(`${indent}lv_bar_set_value(${varName}, ${propNum(widget, 'value', 0)}, LV_ANIM_OFF);`)
      break
    case 'arc':
      lines.push(`${indent}${varName} = lv_arc_create(${parentVar});`)
      lines.push(`${indent}lv_arc_set_range(${varName}, ${propNum(widget, 'min', 0)}, ${propNum(widget, 'max', 100)});`)
      lines.push(`${indent}lv_arc_set_value(${varName}, ${propNum(widget, 'value', 0)});`)
      break
    case 'checkbox':
      lines.push(`${indent}${varName} = lv_checkbox_create(${parentVar});`)
      lines.push(`${indent}lv_checkbox_set_text(${varName}, ${widgetTextLiteral(widget.text)});`)
      if (widget.props.checked) lines.push(`${indent}lv_obj_add_state(${varName}, LV_STATE_CHECKED);`)
      break
    case 'dropdown':
      lines.push(`${indent}${varName} = lv_dropdown_create(${parentVar});`)
      lines.push(`${indent}lv_dropdown_set_options(${varName}, ${widgetTextLiteral(String(widget.props.options ?? ''))});`)
      break
    case 'roller':
      lines.push(`${indent}${varName} = lv_roller_create(${parentVar});`)
      lines.push(`${indent}lv_roller_set_options(${varName}, ${widgetTextLiteral(String(widget.props.options ?? ''))}, LV_ROLLER_MODE_NORMAL);`)
      break
    case 'textarea':
      lines.push(`${indent}${varName} = lv_textarea_create(${parentVar});`)
      if (widget.props.placeholder) lines.push(`${indent}lv_textarea_set_placeholder_text(${varName}, ${widgetTextLiteral(String(widget.props.placeholder))});`)
      if (widget.text) lines.push(`${indent}lv_textarea_set_text(${varName}, ${widgetTextLiteral(widget.text)});`)
      break
    case 'list':
      lines.push(`${indent}${varName} = lv_list_create(${parentVar});`)
      break
    case 'tabs': {
      lines.push(`${indent}${varName} = lv_tabview_create(${parentVar});`)
      lines.push(`${indent}lv_tabview_set_tab_bar_position(${varName}, LV_DIR_TOP);`)
      const names = String(widget.props.tabNames ?? '').split('\n').filter(Boolean)
      for (const name of names) {
        lines.push(`${indent}lv_tabview_add_tab(${varName}, ${JSON.stringify(name)});`)
      }
      break
    }
    case 'spinner':
      lines.push(`${indent}${varName} = lv_spinner_create(${parentVar});`)
      lines.push(`${indent}lv_spinner_set_anim_params(${varName}, 1000, 60);`)
      break
    default:
      lines.push(`${indent}${varName} = lv_obj_create(${parentVar});`)
  }

  lines.push(`${indent}lv_obj_set_pos(${varName}, ${x}, ${y});`)
  lines.push(`${indent}lv_obj_set_size(${varName}, ${width}, ${height});`)
  if (widget.style.visible === false) lines.push(`${indent}lv_obj_add_flag(${varName}, LV_OBJ_FLAG_HIDDEN);`)

  return lines
}

interface EventExport {
  widget: UiWidget
  varName: string
  trigger: string
  lvglEvent: string
  handlerName: string
  /** null = empty `// TODO` stub (no script handler for this trigger — hand-edit in the export);
   * an array (possibly empty) = real body generated from a `widget.on(trigger, ...)` block in
   * the Logic tab's script. See scriptLang/codegen.ts's CodegenEventHandler. */
  bodyLines: string[] | null
}

/** Every trigger the script API's `.on(...)` supports and this pass can generate a real LVGL
 * event registration for — see scriptLang/restrictedSubset.ts and the feature's own plan for
 * why swipe gestures and animationCompleted aren't here yet (no gesture/anim-ready wiring in
 * this project's input model). checked/unchecked both register on VALUE_CHANGED — LVGL has no
 * separate checked/unchecked event, so the handler body is wrapped in an LV_STATE_CHECKED guard
 * at assembly time instead (see generateKiboUI's event-body loop). */
const TRIGGER_TO_LVGL_EVENT: Record<string, string> = {
  click: 'LV_EVENT_CLICKED',
  pressed: 'LV_EVENT_PRESSED',
  released: 'LV_EVENT_RELEASED',
  longPress: 'LV_EVENT_LONG_PRESSED',
  valueChanged: 'LV_EVENT_VALUE_CHANGED',
  focused: 'LV_EVENT_FOCUSED',
  unfocused: 'LV_EVENT_DEFOCUSED',
  checked: 'LV_EVENT_VALUE_CHANGED',
  unchecked: 'LV_EVENT_VALUE_CHANGED',
  screenLoaded: 'LV_EVENT_SCREEN_LOADED',
  screenUnloaded: 'LV_EVENT_SCREEN_UNLOADED'
}

/** Collects every event to wire up. Script-derived handlers (from `widget.on(trigger, ...)` in
 * the Logic tab — see scriptLang/codegen.ts) take priority; the legacy `widget.events` array
 * (from before the Logic tab existed) and the default click-stub-for-named-buttons fallback
 * still apply for any widget+trigger the script doesn't cover, so older projects and
 * script-free designs keep working exactly as before. */
function collectEvents(widgets: UiWidget[], scriptHandlers: CodegenResult['eventHandlers']): EventExport[] {
  const byWidget = new Map<string, CodegenResult['eventHandlers']>()
  for (const h of scriptHandlers) {
    const list = byWidget.get(h.widgetId) ?? []
    list.push(h)
    byWidget.set(h.widgetId, list)
  }

  const out: EventExport[] = []
  for (const widget of widgets) {
    const varName = widgetVarName(widget)
    const scripted = byWidget.get(widget.id) ?? []
    if (scripted.length > 0) {
      const seenTriggers = new Map<string, number>()
      for (const h of scripted) {
        const lvglEvent = TRIGGER_TO_LVGL_EVENT[h.trigger]
        if (!lvglEvent) continue // reported by validateScript.ts's "Unsupported JavaScript API" category
        const n = (seenTriggers.get(h.trigger) ?? 0) + 1
        seenTriggers.set(h.trigger, n)
        out.push({ widget, varName, trigger: h.trigger, lvglEvent, handlerName: `${varName}_on_${h.trigger}${n > 1 ? `_${n}` : ''}`, bodyLines: h.bodyLines })
      }
      continue
    }
    if (widget.events.length > 0) {
      for (const ev of widget.events) {
        const lvglEvent = TRIGGER_TO_LVGL_EVENT[ev.trigger] ?? 'LV_EVENT_CLICKED'
        out.push({ widget, varName, trigger: ev.trigger, lvglEvent, handlerName: toCIdentifier(ev.handlerName), bodyLines: null })
      }
    } else if (widget.type === 'button' && widget.tagId) {
      out.push({ widget, varName, trigger: 'click', lvglEvent: 'LV_EVENT_CLICKED', handlerName: `${toCIdentifier(widget.tagId)}_clicked`, bodyLines: null })
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Widget registry (KiboUI::SetLabelText/SetWidgetVisible/... look widgets up by tagId) — a
// plain fixed-size array + linear search rather than std::map, matching this codebase's existing
// lightweight-embedded-C++ style (cppExport.ts never uses STL containers either) and more than
// fast enough for the widget counts a real embedded UI has (tens, not thousands).
// ---------------------------------------------------------------------------------------------

function namedWidgets(widgets: UiWidget[]): UiWidget[] {
  return widgets.filter((w) => !!w.tagId)
}

export interface LvglExportFile {
  name: string
  content: string
}

/** Builds the naming/lookup context scriptLang/codegen.ts needs but can't own itself (it must
 * not import from this file — see the file-top comment on avoiding a circular dependency).
 * `identByAssetId`/`rules` come from the real, already-computed asset/style export so a
 * script's `setSource("logo.png")`/`.addClass("x")` resolve to the EXACT identifiers the rest
 * of this file generated — see buildValidationCodegenContext below for the lighter, synchronous
 * variant validateLvglExport.ts uses (no RGB565 decode needed just to validate). */
function buildCodegenContext(uiDesign: UiDesignProject, rules: CssRuleExport[], identByAssetId: Map<string, string>): CodegenContext {
  return {
    widgets: uiDesign.widgets,
    varNameForWidget: widgetVarName,
    identForAssetName: (name) => {
      const asset = uiDesign.assets.find((a) => a.name === name)
      return asset ? identByAssetId.get(asset.id) : undefined
    },
    identForClassSelector: (className) => rules.find((r) => r.rule.selector === `.${className}`)?.ident,
    screenFnNameByName: (screenName) => {
      const screen = uiDesign.screens.find((s) => s.name === screenName)
      return screen ? screenShowFnName(screen.name) : undefined
    }
  }
}

/** Synchronous sibling of buildCodegenContext for validateLvglExport.ts — asset "idents" here
 * are placeholder truthy strings (existence checks only, never emitted into real output), so
 * validating a script never has to pay for the async RGB565 asset decode a real export does. */
export function buildValidationCodegenContext(project: Project): CodegenContext {
  const uiDesign = project.uiDesign
  const widgets = allReachableWidgets(uiDesign)
  const rules = usedCssRules(uiDesign, widgets)
  return {
    widgets: uiDesign.widgets,
    varNameForWidget: widgetVarName,
    identForAssetName: (name) => (uiDesign.assets.some((a) => a.name === name) ? 'validated' : undefined),
    identForClassSelector: (className) => rules.find((r) => r.rule.selector === `.${className}`)?.ident,
    screenFnNameByName: (screenName) => (uiDesign.screens.some((s) => s.name === screenName) ? screenShowFnName(screenName) : undefined)
  }
}

const EMPTY_CODEGEN_RESULT: CodegenResult = {
  variables: [],
  functionPrototypes: [],
  functions: [],
  eventHandlers: [],
  timers: [],
  initStatements: [],
  hardwareStubs: [],
  updateBindingsFn: [],
  errors: []
}

function runScriptCodegen(uiDesign: UiDesignProject, ctx: CodegenContext): CodegenResult {
  if (!uiDesign.script.trim()) return EMPTY_CODEGEN_RESULT
  const parsed = parseScript(uiDesign.script)
  if (!parsed.program) return { ...EMPTY_CODEGEN_RESULT, errors: parsed.errors }
  return generateScriptCpp(parsed.program, uiDesign.script, ctx)
}

// ---------------------------------------------------------------------------------------------
// lv_conf.h — generated from LVGL 9.5.0's own real lv_conf_template.h (see lvConfTemplate.ts),
// not a hand-authored subset. Two edits are applied: (1) flip the "Content enable" #if 0 guard
// to #if 1 — LVGL ships the template disabled by default, and copying it without this flip is
// this export's single most common first compile failure; (2) turn on whichever built-in
// lv_font_montserrat_* sizes styleSetCalls() can ever reference (the fixed {12,14,16,18,20,24}
// set matching its font-size-selection ternary above), so any design using one compiles without
// a separate manual step. Every other setting is left at LVGL's own stock defaults on purpose —
// deviating further risks producing a different, more confusing error than the real template
// would. The two exceptions are LV_BUILD_EXAMPLES/LV_BUILD_DEMOS, turned off in the embedded
// template itself (not here) since this export never needs LVGL's own example/demo code.
// ---------------------------------------------------------------------------------------------

const MONTSERRAT_SIZES_ALWAYS_AVAILABLE = [12, 14, 16, 18, 20, 24]

function generateLvConf(): string {
  let conf = LV_CONF_TEMPLATE_V9.replace(
    '#if 0 /* Set this to "1" to enable content */',
    '#if 1 /* Set this to "1" to enable content */'
  )
  for (const size of MONTSERRAT_SIZES_ALWAYS_AVAILABLE) {
    conf = conf.replace(new RegExp(`(#define LV_FONT_MONTSERRAT_${size}\\s+)\\d`), '$11')
  }
  return `/*
 * lv_conf.h
 *
 * Generated by Kibo Eye Studio — UI/UX Design Mode.
 *
 * This is LVGL ${LVGL_VERSION}'s own real lv_conf_template.h with its "Content enable" guard
 * flipped on and the lv_font_montserrat_* sizes this export can use already turned on — ready
 * to use as-is. See README.md's "Configuring lv_conf.h" section for where to place this file.
 *
 * You MAY edit this file for your own hardware (e.g. LV_COLOR_DEPTH if your display driver
 * expects something other than RGB565, LV_MEM_SIZE if you hit allocation failures, LV_USE_LOG
 * while bringing up your display driver) — unlike the other generated files, this one is meant
 * to be a starting point you own, not something re-export silently overwrites without you
 * noticing (re-exporting still regenerates it, so keep any manual edits in mind before you do).
 */
${conf}`
}

/** The single entry point — async because asset RGB565 decoding needs the browser's canvas
 * APIs. Reads only `project.uiDesign` (see the file-top comment) — including
 * `project.uiDesign.display`, UI Design Mode's own display config, for KiboUIConfig.h's
 * size/shape/rotation macros, and `project.uiDesign.script`, the Logic tab's behavior script.
 * `project.display` (Eye Studio's) is never touched. */
export async function generateLvglExport(project: Project): Promise<LvglExportFile[]> {
  const uiDesign = project.uiDesign
  const widgets = allReachableWidgets(uiDesign)
  const rules = usedCssRules(uiDesign, widgets)
  const { header: assetsHeader, source: assetsSource, identByAssetId } = await exportLvglAssets(uiDesign, widgets, rules)
  const stylesCode = exportLvglStyles(widgets, rules, identByAssetId)
  const codegen = runScriptCodegen(uiDesign, buildCodegenContext(uiDesign, rules, identByAssetId))
  const events = collectEvents(widgets, codegen.eventHandlers)
  const named = namedWidgets(widgets)

  const config = generateKiboUIConfig(uiDesign.display)
  const lvConf = generateLvConf()
  const { header: kiboUiHeader, source: kiboUiSource } = generateKiboUI(uiDesign, widgets, rules, identByAssetId, events, named, stylesCode, codegen)
  const example = generateExampleIno()
  const readme = generateReadme(project, widgets, rules, events, codegen)

  return [
    { name: 'KiboUI.h', content: kiboUiHeader },
    { name: 'KiboUI.cpp', content: kiboUiSource },
    { name: 'KiboUIAssets.h', content: assetsHeader },
    { name: 'KiboUIAssets.cpp', content: assetsSource },
    { name: 'KiboUIConfig.h', content: config },
    { name: 'lv_conf.h', content: lvConf },
    { name: 'Example.ino', content: example },
    { name: 'README.md', content: readme }
  ]
}

// ---------------------------------------------------------------------------------------------
// KiboUIConfig.h
// ---------------------------------------------------------------------------------------------

function generateKiboUIConfig(display: UiDisplaySettings): string {
  return `/*
 * KiboUIConfig.h
 *
 * Generated by Kibo Eye Studio — UI/UX Design Mode.
 *
 * This file contains editable hardware/display settings. You SHOULD edit this file for your
 * own board — nothing else in this export needs manual edits (see KiboUI.h's header comment).
 *
 * Required: ESP32 Arduino Core, LVGL ${LVGL_VERSION}, a supported display driver.
 */
#pragma once

// Display resolution and shape, from the Display Settings panel in UI/UX Design Mode
// (independent of Eye Studio's own Display panel — this is the LVGL screen's own config).
// Edit these ONLY if your physical panel differs from what the project was designed for.
#define KIBO_DISPLAY_WIDTH  ${Math.round(display.width)}
#define KIBO_DISPLAY_HEIGHT ${Math.round(display.height)}
#define KIBO_DISPLAY_ORIENTATION_${display.orientation.toUpperCase()} 1

${
  display.shape === 'round'
    ? '// This design targets a round display — LVGL widgets are clipped to the visible circle in\n// the studio preview; make sure your display driver reports a matching circular/round panel\n// if it has round-aware behavior (e.g. lv_display_set_antialiasing, round-display chroma tricks).\n#define KIBO_DISPLAY_ROUND 1'
    : '// #define KIBO_DISPLAY_ROUND 1  // uncomment if you switch to a round panel'
}

// Firmware/driver presentation rotation, set in the Display Settings panel — this does NOT
// change widget coordinates (those are always authored directly in Width x Height above as the
// logical resolution); it only tells your display driver which physical direction to present
// that logical resolution in, if your driver supports software rotation.
#define KIBO_DISPLAY_ROTATION ${display.rotation}

// Matches this project's RGB565 color pipeline — change only if your display driver uses a
// different LV_COLOR_DEPTH (also update lv_conf.h's LV_COLOR_DEPTH to match, see README.md).
#define KIBO_LVGL_COLOR_DEPTH 16

// Number of horizontal lines in the LVGL draw buffer. 20-40 lines is a reasonable starting
// point for a ${Math.round(display.width)}x${Math.round(display.height)} panel; raise it (uses more RAM) if you see tearing, lower it
// (uses less RAM) if you're tight on memory. See README.md's "Display buffer size" section.
#define KIBO_DRAW_BUFFER_LINES 20

// ---------------------------------------------------------------------------------------------
// Display wiring — Kibo Eye Studio does not know your physical GPIO pins (no board/pinout was
// selected in the project), so these are placeholders. EDIT THEM to match your wiring, or
// remove them entirely if your display driver library configures pins elsewhere (e.g. via
// User_Setup.h for TFT_eSPI, or a board-defs header for esp32_smartdisplay).
// ---------------------------------------------------------------------------------------------
// #define KIBO_TFT_CS   -1  // EDIT ME
// #define KIBO_TFT_DC   -1  // EDIT ME
// #define KIBO_TFT_RST  -1  // EDIT ME
// #define KIBO_TFT_SCLK -1  // EDIT ME
// #define KIBO_TFT_MOSI -1  // EDIT ME
`
}

// ---------------------------------------------------------------------------------------------
// KiboUI.h / KiboUI.cpp
// ---------------------------------------------------------------------------------------------

function fileHeaderComment(filename: string, whatItContains: string, editable: boolean): string {
  return `/*
 * ${filename}
 *
 * Generated by Kibo Eye Studio — UI/UX Design Mode.
 *
 * ${whatItContains}
 * ${editable ? 'You may edit this file — it is not overwritten automatically.' : 'Do NOT hand-edit this file — re-export from Kibo Eye Studio instead; your changes would be lost on the next export.'}
 * This export contains only LVGL UI code. It does not include any Eye Studio expressions,
 * animations, stickers, or pupil/eyelid rendering code.
 *
 * Required: ESP32 Arduino Core, LVGL ${LVGL_VERSION}, a supported display driver.
 *
 * Basic usage:
 *
 *   #include "KiboUI.h"
 *
 *   void setup() {
 *       InitializeDisplay();   // your own display driver init — see Example.ino
 *       InitializeLVGL();      // your own lv_init()/driver-registration — see Example.ino
 *       KiboUI::Begin();
 *       KiboUI::ShowMainScreen();
 *   }
 *
 *   void loop() {
 *       KiboUI::Update();      // must be called every loop() iteration
 *   }
 *
 * Opening another screen:   KiboUI::ShowScreen("settings");
 * Updating a widget:        KiboUI::SetLabelText("statusLabel", "Connected");
 *                            KiboUI::SetWidgetVisible("wifiButton", true);
 * Connecting button events: fill in the *_clicked() callback bodies in KiboUI.cpp.
 * Regenerating safely:      re-export from Kibo Eye Studio's UI/UX Design Mode — this whole
 *                            folder is replaced; keep any hand-written app logic in your own
 *                            .ino/.cpp files, not inside these generated files.
 */
`
}

function generateKiboUI(
  uiDesign: UiDesignProject,
  widgets: UiWidget[],
  rules: CssRuleExport[],
  identByAssetId: Map<string, string>,
  events: EventExport[],
  named: UiWidget[],
  stylesCode: string,
  codegen: CodegenResult
): { header: string; source: string } {
  const screenFns = uiDesign.screens.map((s) => ({ screen: s, fnName: screenCreateFnName(s.name), showFnName: screenShowFnName(s.name) }))
  const hasBindings = codegen.updateBindingsFn.length > 0
  const updateBindingsCall = hasBindings ? '  KiboUI_UpdateBindings();' : null

  // ---- header ----
  const h: string[] = [fileHeaderComment('KiboUI.h', 'Public API for the generated UI — the only file your own code should #include.', false)]
  h.push('#pragma once')
  h.push('#include "lvgl.h"')
  h.push('')
  h.push('namespace KiboUI {')
  h.push('')
  h.push('// Call once, after InitializeDisplay()/InitializeLVGL() — builds every screen and widget.')
  h.push('void Begin();')
  h.push('')
  h.push('// Call every loop() iteration — pumps LVGL\'s timer handler.')
  h.push('void Update();')
  h.push('')
  for (const { showFnName, screen } of screenFns) {
    h.push(`// Shows the "${screen.name}" screen.`)
    h.push(`void ${showFnName}();`)
  }
  h.push('// Generic screen switch by name (matches the screen name set in Kibo Eye Studio).')
  h.push('void ShowScreen(const char* screenName);')
  h.push('// Returns to the previously shown screen (ui.goBack() in the Logic tab\'s script) — a')
  h.push('// no-op if there is no previous screen.')
  h.push('void GoBack();')
  h.push('')
  h.push('// Sets a label/button/textarea/checkbox\'s text by its id (the id set in the HTML editor or Properties panel).')
  h.push('void SetLabelText(const char* widgetId, const char* text);')
  h.push('// Shows/hides a widget by id.')
  h.push('void SetWidgetVisible(const char* widgetId, bool visible);')
  h.push('// Sets a slider/bar/arc\'s value by id.')
  h.push('void SetWidgetValue(const char* widgetId, int32_t value);')
  h.push('// Looks up a widget\'s raw lv_obj_t* by id (for anything not covered by the helpers above) — returns nullptr if not found.')
  h.push('lv_obj_t* FindWidget(const char* widgetId);')
  h.push('')
  h.push('} // namespace KiboUI')
  h.push('')

  // ---- source ----
  const c: string[] = [fileHeaderComment('KiboUI.cpp', 'Implementation of the generated UI — widget creation, styles, and the public API.', false)]
  c.push('#include "KiboUI.h"')
  c.push('#include "KiboUIAssets.h"')
  c.push('#include "KiboUIConfig.h"')
  c.push('#include <string.h>')
  c.push('')
  c.push(stylesCode)
  c.push('')

  // Registry
  c.push('// ---- Widget registry (id -> lv_obj_t*), used by SetLabelText/SetWidgetVisible/SetWidgetValue/FindWidget ----')
  c.push(`#define KIBO_UI_MAX_WIDGETS ${Math.max(1, named.length)}`)
  c.push('static const char* s_widgetIds[KIBO_UI_MAX_WIDGETS];')
  c.push('static lv_obj_t* s_widgetObjs[KIBO_UI_MAX_WIDGETS];')
  c.push('static int s_widgetCount = 0;')
  c.push('')
  c.push('static void KiboUI_Register(const char* id, lv_obj_t* obj) {')
  c.push('  if (s_widgetCount < KIBO_UI_MAX_WIDGETS) {')
  c.push('    s_widgetIds[s_widgetCount] = id;')
  c.push('    s_widgetObjs[s_widgetCount] = obj;')
  c.push('    s_widgetCount++;')
  c.push('  }')
  c.push('}')
  c.push('')
  c.push('lv_obj_t* KiboUI::FindWidget(const char* widgetId) {')
  c.push('  for (int i = 0; i < s_widgetCount; i++) {')
  c.push('    if (strcmp(s_widgetIds[i], widgetId) == 0) return s_widgetObjs[i];')
  c.push('  }')
  c.push('  return nullptr;')
  c.push('}')
  c.push('')

  // Widget object statics — every widget's lv_obj_t* is file-scope (not a Create-function-local)
  // so the Logic tab's script (compiled to plain top-level C++ functions — event callbacks,
  // timer callbacks, custom functions) can reference ANY widget by its variable name from
  // anywhere in this file, e.g. a button's click handler setting a different progress bar's
  // value. Button widgets also get a `_label` static for their text child (see
  // widgetCreateCalls' button case) since script text-setting targets that, not the button
  // object itself.
  if (widgets.length > 0) {
    c.push('// ---- Widget objects — do not rename; the Logic tab\'s script compiles to code that')
    c.push('// references these exact variable names. ----')
    const declared = new Set<string>()
    for (const w of widgets) {
      const v = widgetVarName(w)
      if (!declared.has(v)) {
        declared.add(v)
        c.push(`static lv_obj_t* ${v} = nullptr;`)
      }
      if (w.type === 'button') c.push(`static lv_obj_t* ${v}_label = nullptr;`)
    }
    c.push('')
  }

  // Screen history — backs ui.goBack() in the script; every generated Show<Screen>() pushes the
  // previously-active screen here first (see the per-screen Show functions further down).
  c.push('// ---- Screen navigation history (for GoBack()) ----')
  c.push('#define KIBO_UI_MAX_SCREEN_HISTORY 8')
  c.push('static lv_obj_t* s_screenHistory[KIBO_UI_MAX_SCREEN_HISTORY];')
  c.push('static int s_screenHistoryCount = 0;')
  c.push('static lv_obj_t* s_currentScreen = nullptr;')
  c.push('')
  c.push('void KiboUI::GoBack() {')
  c.push('  if (s_screenHistoryCount <= 0) return;')
  c.push('  lv_obj_t* prev = s_screenHistory[--s_screenHistoryCount];')
  c.push('  if (prev) { lv_screen_load(prev); s_currentScreen = prev; }')
  c.push('}')
  c.push('')

  // Script variables + forward-declared/implemented functions (from top-level let/const and
  // `function` declarations in the Logic tab's script — see scriptLang/codegen.ts).
  if (codegen.variables.length > 0 || codegen.functions.length > 0) {
    c.push('// ---- Script variables & functions (from the Logic tab) ----')
    for (const v of codegen.variables) c.push(`static ${v}`)
    if (codegen.variables.length > 0) c.push('')
    for (const p of codegen.functionPrototypes) c.push(`static ${p}`)
    if (codegen.functionPrototypes.length > 0) c.push('')
    for (const fn of codegen.functions) {
      c.push(`static ${fn}`)
      c.push('')
    }
  }

  // Hardware event stubs (hardware.onButtonPress/onEncoderRotate/onSensorChange/... in the
  // script) — Kibo Eye Studio has no way to know your board's actual GPIO/sensor/radio wiring,
  // so these are named stubs with a TODO comment; call them from your own polling/interrupt code.
  if (codegen.hardwareStubs.length > 0) {
    c.push('// ---- Hardware event stubs (from the Logic tab\'s hardware.* calls) ----')
    for (const stub of codegen.hardwareStubs) {
      c.push(stub)
      c.push('')
    }
  }

  // Timers (ui.setInterval/setTimeout in the script) — declared once here; created wherever the
  // script actually calls ui.setInterval/setTimeout (init, inside a function, or inside an
  // event handler — see each call site below), matching real JS/LVGL timer semantics.
  if (codegen.timers.length > 0) {
    c.push('// ---- Timers (from the Logic tab\'s ui.setInterval/setTimeout calls) ----')
    const declaredTimers = new Set<string>()
    for (const t of codegen.timers) {
      if (!declaredTimers.has(t.varName)) {
        declaredTimers.add(t.varName)
        c.push(`static lv_timer_t* ${t.varName} = NULL;`)
      }
    }
    c.push('')
    for (const t of codegen.timers) {
      // Deliberately unnamed parameter — naming it (even something LVGL-idiomatic like
      // `timer`) would shadow a same-named user script variable inside this callback body
      // (e.g. the flagship Progress Bar example's own `let timer = null;`), silently breaking
      // `ui.clearInterval(timer)`/self-clear codegen: `timer = NULL` would clear the shadowing
      // *parameter* instead of the outer static, leaving the real timer handle dangling.
      c.push(`static void ${t.varName}_cb(lv_timer_t*) {`)
      c.push(...t.bodyLines.map((l) => `  ${l}`))
      if (t.repeatOnce) c.push(`  ${t.varName} = NULL; // one-shot (ui.setTimeout) — LVGL frees the timer itself after its repeat count is exhausted`)
      if (updateBindingsCall) c.push(updateBindingsCall)
      c.push('}')
      c.push('')
    }
  }

  // Data bindings (.bindText/.bindValue/.bindVisible in the script) — re-applied after every
  // event/timer callback below, mirroring the live preview's own "re-check after every tick"
  // model (see sandboxRuntime.ts's afterTick()).
  if (hasBindings) {
    c.push('// ---- Data bindings (from the Logic tab\'s .bindText/.bindValue/.bindVisible calls) ----')
    c.push('static void KiboUI_UpdateBindings() {')
    c.push(...codegen.updateBindingsFn.map((l) => `  ${l}`))
    c.push('}')
    c.push('')
  }

  // Event callbacks — a script-authored `widget.on(trigger, ...)` block (see the Logic tab)
  // generates a real body here; anything else (the legacy per-widget Events list, or the
  // default click stub every named button gets with no script handler at all) still gets an
  // empty // TODO stub to hand-edit, exactly as before this feature existed.
  if (events.length > 0) {
    c.push('// ---- Event callbacks. Bodies generated from the Logic tab\'s script are regenerated')
    c.push('// on every export — edit the script, not this file, to change them. Empty // TODO stubs')
    c.push('// (no script handler for that trigger) are safe to hand-edit; re-exporting preserves')
    c.push('// stub declarations but not any body you\'ve typed into one — move logic you want to')
    c.push('// keep into your own .cpp file calling KiboUI::FindWidget() instead. ----')
    for (const ev of events) {
      c.push(`static void ${ev.handlerName}(lv_event_t* e) {`)
      if (ev.bodyLines === null) {
        c.push(`  // TODO: handle the "${ev.trigger}" event for "${ev.widget.tagId}" here.`)
      } else {
        const body = ev.bodyLines.map((l) => `  ${l}`)
        if (ev.trigger === 'checked' || ev.trigger === 'unchecked') {
          const guard = ev.trigger === 'checked' ? '' : '!'
          c.push(`  if (${guard}lv_obj_has_state(${ev.varName}, LV_STATE_CHECKED)) {`)
          c.push(...body.map((l) => `  ${l}`))
          c.push('  }')
        } else {
          c.push(...body)
        }
        if (updateBindingsCall) c.push(updateBindingsCall)
      }
      c.push('}')
      c.push('')
    }
  }

  // Per-named-widget Create functions + per-screen Create functions
  const screenBuffers = new Map<string, string[]>()
  const namedFnBuffers = new Map<string, string[]>()
  const emittedFnNames = new Set<string>()

  const uniqueFnName = (base: string): string => {
    if (!emittedFnNames.has(base)) {
      emittedFnNames.add(base)
      return base
    }
    let i = 2
    while (emittedFnNames.has(`${base}${i}`)) i++
    emittedFnNames.add(`${base}${i}`)
    return `${base}${i}`
  }

  function emitWidget(widget: UiWidget, parentVar: string, buffer: string[], indent: string) {
    const varName = widgetVarName(widget)
    const isNamed = !!widget.tagId
    if (isNamed && !namedFnBuffers.has(widget.id)) {
      // Named widget gets its own Create<Name>(parent) function — called from the current
      // buffer, with its own body (and its children) built into a fresh buffer.
      const fnName = uniqueFnName(widgetCreateFnName(widget))
      const fnBuffer: string[] = []
      fnBuffer.push(...widgetCreateCalls(widget, varName, 'parent', identByAssetId, '  '))
      fnBuffer.push(...styleApplyCalls(widget, rules, varName, '  '))
      fnBuffer.push(`  KiboUI_Register(${JSON.stringify(widget.tagId)}, ${varName});`)
      for (const ev of events) {
        if (ev.widget.id === widget.id) {
          fnBuffer.push(`  lv_obj_add_event_cb(${varName}, ${ev.handlerName}, ${ev.lvglEvent}, NULL);`)
        }
      }
      for (const child of children(uiDesign, widget)) emitWidget(child, varName, fnBuffer, '  ')
      fnBuffer.push(`  return ${varName};`)
      namedFnBuffers.set(widget.id, [`static lv_obj_t* ${fnName}(lv_obj_t* parent) {`, ...fnBuffer, '}'])
      // No local declared here — ${varName} is a file-scope static (see the "Widget objects"
      // block above), already assigned inside ${fnName}() itself.
      buffer.push(`${indent}${fnName}(${parentVar});`)
    } else {
      buffer.push(...widgetCreateCalls(widget, varName, parentVar, identByAssetId, indent))
      buffer.push(...styleApplyCalls(widget, rules, varName, indent))
      for (const child of children(uiDesign, widget)) emitWidget(child, varName, buffer, indent)
    }
  }

  for (const { screen, fnName } of screenFns) {
    const root = uiDesign.widgets[screen.rootWidgetId]
    const buffer: string[] = []
    buffer.push(`static lv_obj_t* s_screen_${toCIdentifier(screen.id)} = nullptr;`)
    buffer.push(`static lv_obj_t* ${fnName}() {`)
    buffer.push(`  lv_obj_t* screen = lv_obj_create(NULL);`)
    if (root) {
      for (const child of children(uiDesign, root)) emitWidget(child, 'screen', buffer, '  ')
    }
    buffer.push('  return screen;')
    buffer.push('}')
    screenBuffers.set(screen.id, buffer)
  }

  c.push('// ---- Named widget builders ----')
  for (const fn of namedFnBuffers.values()) {
    c.push(fn.join('\n'))
    c.push('')
  }

  c.push('// ---- Screen builders ----')
  for (const buffer of screenBuffers.values()) {
    c.push(buffer.join('\n'))
    c.push('')
  }

  // Script init — top-level statements from the Logic tab's script that aren't part of any
  // function/event handler/timer (e.g. the Progress Bar example's `progress.setValue(0);`) run
  // once here, after every screen (and therefore every widget the script might reference) has
  // been created.
  const hasScriptInit = codegen.initStatements.length > 0
  if (hasScriptInit) {
    c.push('// ---- Script init (top-level statements from the Logic tab\'s script) ----')
    c.push('static void KiboUI_ScriptInit() {')
    c.push(...codegen.initStatements.map((l) => `  ${l}`))
    if (updateBindingsCall) c.push(updateBindingsCall)
    c.push('}')
    c.push('')
  }

  // Public API implementation
  c.push('// ---- Public API ----')
  c.push('void KiboUI::Begin() {')
  c.push('  KiboUI_InitStyles();')
  for (const { screen, fnName } of screenFns) {
    c.push(`  s_screen_${toCIdentifier(screen.id)} = ${fnName}();`)
  }
  if (screenFns.length > 0) c.push(`  s_currentScreen = s_screen_${toCIdentifier(screenFns[0].screen.id)};`)
  if (hasScriptInit) c.push('  KiboUI_ScriptInit();')
  c.push('}')
  c.push('')
  c.push('void KiboUI::Update() {')
  c.push('  lv_timer_handler(); // pumps LVGL — call lv_tick_inc() before this if you\'re not using an automatic tick source (see Example.ino\'s loop())')
  c.push('}')
  c.push('')
  for (const { screen, showFnName } of screenFns) {
    c.push(`void KiboUI::${showFnName}() {`)
    c.push(`  if (!s_screen_${toCIdentifier(screen.id)}) return;`)
    c.push(`  if (s_currentScreen && s_currentScreen != s_screen_${toCIdentifier(screen.id)} && s_screenHistoryCount < KIBO_UI_MAX_SCREEN_HISTORY) s_screenHistory[s_screenHistoryCount++] = s_currentScreen;`)
    c.push(`  lv_screen_load(s_screen_${toCIdentifier(screen.id)});`)
    c.push(`  s_currentScreen = s_screen_${toCIdentifier(screen.id)};`)
    c.push('}')
    c.push('')
  }
  c.push('void KiboUI::ShowScreen(const char* screenName) {')
  for (const { screen, showFnName } of screenFns) {
    c.push(`  if (strcmp(screenName, ${JSON.stringify(screen.name)}) == 0) { ${showFnName}(); return; }`)
  }
  c.push('}')
  c.push('')
  c.push('void KiboUI::SetLabelText(const char* widgetId, const char* text) {')
  c.push('  lv_obj_t* obj = FindWidget(widgetId);')
  c.push('  if (!obj) return;')
  c.push('  if (lv_obj_check_type(obj, &lv_label_class)) lv_label_set_text(obj, text);')
  c.push('  else if (lv_obj_check_type(obj, &lv_checkbox_class)) lv_checkbox_set_text(obj, text);')
  c.push('  else if (lv_obj_check_type(obj, &lv_textarea_class)) lv_textarea_set_text(obj, text);')
  c.push('  else if (lv_obj_get_child_count(obj) > 0) lv_label_set_text(lv_obj_get_child(obj, 0), text); // e.g. a button\'s label child')
  c.push('}')
  c.push('')
  c.push('void KiboUI::SetWidgetVisible(const char* widgetId, bool visible) {')
  c.push('  lv_obj_t* obj = FindWidget(widgetId);')
  c.push('  if (!obj) return;')
  c.push('  if (visible) lv_obj_remove_flag(obj, LV_OBJ_FLAG_HIDDEN);')
  c.push('  else lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);')
  c.push('}')
  c.push('')
  c.push('void KiboUI::SetWidgetValue(const char* widgetId, int32_t value) {')
  c.push('  lv_obj_t* obj = FindWidget(widgetId);')
  c.push('  if (!obj) return;')
  c.push('  if (lv_obj_check_type(obj, &lv_slider_class)) lv_slider_set_value(obj, value, LV_ANIM_ON);')
  c.push('  else if (lv_obj_check_type(obj, &lv_bar_class)) lv_bar_set_value(obj, value, LV_ANIM_ON);')
  c.push('  else if (lv_obj_check_type(obj, &lv_arc_class)) lv_arc_set_value(obj, value);')
  c.push('}')
  c.push('')

  return { header: h.join('\n'), source: c.join('\n') }
}

// ---------------------------------------------------------------------------------------------
// Example.ino
// ---------------------------------------------------------------------------------------------

function generateExampleIno(): string {
  return `/*
 * Example.ino
 *
 * Generated by Kibo Eye Studio — UI/UX Design Mode.
 *
 * A starting point, not a finished sketch — you WILL need to edit the two TODO sections below
 * (InitializeDisplay/InitializeLVGL) to match your actual display driver and wiring
 * (see KiboUIConfig.h and README.md). Everything else (KiboUI::*) is generated and works as-is.
 *
 * Required libraries: LVGL ${LVGL_VERSION}, plus whatever display-driver library matches your
 * hardware (TFT_eSPI, LovyanGFX, Arduino_GFX, esp32_smartdisplay, ...).
 */
#include <lvgl.h>
#include "KiboUI.h"
#include "KiboUIConfig.h"

// #define KIBO_SERIAL_LOG // uncomment for basic serial logging below

static lv_color_t s_buf1[KIBO_DISPLAY_WIDTH * KIBO_DRAW_BUFFER_LINES];
static uint32_t s_lastTickMs = 0;

// TODO: replace with your display driver's flush call (e.g. TFT_eSPI's pushColors,
// LovyanGFX's pushImage, or your board's equivalent). This stub only marks the flush done so
// the sketch compiles before you fill it in. \`px_map\` holds raw pixel bytes in
// KIBO_LVGL_COLOR_DEPTH format (RGB565 here) — cast to (uint16_t*)/(lv_color_t*) as your driver
// expects.
static void kibo_disp_flush(lv_display_t* disp, const lv_area_t* area, uint8_t* px_map) {
  // Example shape (TFT_eSPI-style):
  // tft.startWrite();
  // tft.setAddrWindow(area->x1, area->y1, area->x2 - area->x1 + 1, area->y2 - area->y1 + 1);
  // tft.pushColors((uint16_t*)px_map, (area->x2 - area->x1 + 1) * (area->y2 - area->y1 + 1), true);
  // tft.endWrite();
  lv_display_flush_ready(disp);
}

// TODO: fill in with your display driver's begin()/init() call(s) and pin setup — see the
// commented-out KIBO_TFT_* pins in KiboUIConfig.h.
void InitializeDisplay() {
}

void InitializeLVGL() {
  lv_init();

  lv_display_t* disp = lv_display_create(KIBO_DISPLAY_WIDTH, KIBO_DISPLAY_HEIGHT);
  lv_display_set_flush_cb(disp, kibo_disp_flush);
  lv_display_set_buffers(disp, s_buf1, NULL, sizeof(s_buf1), LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565); // matches KIBO_LVGL_COLOR_DEPTH

  // TODO: register an input device here if your hardware has touch (lv_indev_create) — omitted
  // since Kibo Eye Studio doesn't know whether your panel has a touch controller.

  s_lastTickMs = millis();
}

void setup() {
#ifdef KIBO_SERIAL_LOG
  Serial.begin(115200);
  Serial.println("Kibo UI starting...");
#endif

  InitializeDisplay();
  InitializeLVGL();

  KiboUI::Begin();
  KiboUI::ShowMainScreen();

  // Basic event callback example — see the *_clicked() stubs generated in KiboUI.cpp for any
  // named button in your design; fill in their bodies with your own logic.
}

void loop() {
  uint32_t now = millis();
  lv_tick_inc(now - s_lastTickMs);
  s_lastTickMs = now;

  KiboUI::Update();
  delay(5);
}
`
}

// ---------------------------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------------------------

function generateReadme(project: Project, widgets: UiWidget[], rules: CssRuleExport[], events: EventExport[], codegen: CodegenResult): string {
  const display = project.uiDesign.display
  const w = Math.round(display.width)
  const h = Math.round(display.height)
  const assetCount = usedAssets(project.uiDesign, widgets, rules).length
  return `# ${project.name} — KiboUI LVGL Export

Generated by **Kibo Eye Studio — UI/UX Design Mode**. This export contains **only LVGL UI
code** — no Eye Studio expressions, animations, stickers, or eye/pupil/eyelid rendering code
is included anywhere in this folder.

## What's in this folder

| File | Contents | Edit it? |
| --- | --- | --- |
| \`KiboUI.h\` | Public API (\`KiboUI::Begin()\`, \`Update()\`, \`ShowScreen()\`, ...) | No — re-export instead |
| \`KiboUI.cpp\` | Widget creation, styles, event callback stubs | Only inside the \`// TODO\` callback bodies |
| \`KiboUIAssets.h/.cpp\` | Image assets as \`lv_image_dsc_t\` | No — re-export instead |
| \`KiboUIConfig.h\` | Display size/rotation/color depth/pins | **Yes** — edit for your hardware |
| \`lv_conf.h\` | LVGL library configuration | Pre-configured, ready to use — edit only if your hardware needs differ (see below) |
| \`Example.ino\` | A starting Arduino sketch | **Yes** — fill in the two TODOs |
| \`README.md\` | This file | — |

## Required

- ESP32 Arduino Core
- **LVGL ${LVGL_VERSION}** (this export targets this version specifically — mixing LVGL 8 and
  LVGL 9 APIs will not compile; if your project is on a different major version, install
  LVGL ${LVGL_VERSION} alongside it or re-export once support for other versions is available)
- A display driver library for your panel (TFT_eSPI, LovyanGFX, Arduino_GFX, esp32_smartdisplay, ...)

## Installing LVGL

**Arduino IDE**: Sketch → Include Library → Manage Libraries... → search "lvgl" → install
version ${LVGL_VERSION}.

**PlatformIO**: add to \`platformio.ini\`:

\`\`\`ini
[env:esp32]
platform = espressif32
board = esp32dev            ; replace with your actual board
framework = arduino
lib_deps =
    lvgl/lvgl@^9.5.0
    ; add your display driver library here, e.g.:
    ; bodmer/TFT_eSPI@^2.5.0
\`\`\`

## Configuring \`lv_conf.h\`

**This export already includes a ready-to-use \`lv_conf.h\`** — generated from LVGL 9.5.0's own
real template with its "Content enable" guard already flipped on (LVGL ships that template
disabled by default, so a plain hand-copy without this step is the single most common first
compile failure — you don't need to worry about it here) and the built-in fonts this UI uses
already turned on. Where it needs to live depends on your toolchain:

- **Arduino IDE**: nothing extra to do — as long as you follow the "Arduino IDE setup" steps
  below (open \`Example.ino\` as your sketch, or copy this whole folder next to your existing
  \`.ino\`), \`lv_conf.h\` ends up directly in your sketch folder, which the Arduino build always
  adds to the compiler's include path. LVGL finds it there automatically; no separate copy step.
- **PlatformIO**: move (don't copy alongside \`src/\`) \`lv_conf.h\` into your project's
  \`include/\` folder (create it if it doesn't exist, as a sibling of \`platformio.ini\` and
  \`src/\`). PlatformIO adds \`include/\` to the compiler's include path automatically, so LVGL's
  own \`__has_include("lv_conf.h")\` check finds it there with no \`build_flags\` needed — put the
  rest of this export's files (\`KiboUI.*\`, \`KiboUIAssets.*\`, \`KiboUIConfig.h\`) in \`src/\` as usual.

You MAY edit \`lv_conf.h\` for your own hardware — it's the one generated file meant to be a
starting point you own, not something to leave untouched:

- \`LV_COLOR_DEPTH\` (16 by default, matching \`KIBO_LVGL_COLOR_DEPTH\` in \`KiboUIConfig.h\`) must
  match whatever your display driver actually expects, if it differs from RGB565.
- \`LV_MEM_SIZE\` (64KB by default) — raise it if you see allocation failures; ESP32 typically
  has plenty of RAM to spare.
- \`LV_USE_LOG\` (off by default) — flip to \`1\` while bringing up your display driver, for
  LVGL's own diagnostic logging.

This project's display is ${w}x${h} ${display.shape} (${display.orientation},
${display.rotation}° rotation) — reflected in \`KiboUIConfig.h\`, not \`lv_conf.h\` itself.

- **Display buffer size**: \`KiboUIConfig.h\`'s \`KIBO_DRAW_BUFFER_LINES\` (currently 20) times
  \`KIBO_DISPLAY_WIDTH\` (${w}) is how many pixels the draw buffer holds — raise it for less
  tearing at the cost of RAM, lower it if you're memory-constrained.
- **Draw buffer / flush callback**: see \`Example.ino\`'s \`InitializeLVGL()\`/\`kibo_disp_flush()\` —
  the flush callback body is a TODO you must fill in for your specific display driver.
- **Tick source**: LVGL 9 has no \`LV_TICK_CUSTOM\` config option — \`Example.ino\`'s \`loop()\`
  already calls \`lv_tick_inc()\` manually every iteration, which is the standard approach and
  needs no \`lv_conf.h\` setting.
- **Input device**: if your panel has touch, create one with \`lv_indev_create()\` (set its type
  and read callback via \`lv_indev_set_type()\`/\`lv_indev_set_read_cb()\`) in \`InitializeLVGL()\`
  (not generated — Kibo Eye Studio doesn't know whether your hardware has a touch controller).
- **Fonts**: this export's \`lv_conf.h\` already enables every built-in \`lv_font_montserrat_*\`
  size this UI's styles use — no manual step needed unless you add new text styles after editing
  \`lv_conf.h\` by hand and don't re-export.
- **PNG/JPG/SVG/GIF decoders**: not needed — every image asset is exported pre-converted to raw
  RGB565 + per-pixel alpha data (\`lv_image_dsc_t\`, \`LV_COLOR_FORMAT_RGB565A8\`), so LVGL's
  image decoders aren't required for this export's own assets.
- **Memory / PSRAM**: ${assetCount > 0 ? `this UI includes ${assetCount} image asset${assetCount === 1 ? '' : 's'} — if your board has PSRAM, consider allocating the draw buffer(s) from it (\`heap_caps_malloc(..., MALLOC_CAP_SPIRAM)\`) to leave more internal RAM for the rest of your sketch.` : "this UI has no image assets, so memory needs are modest — LVGL's own object/style overhead dominates, not asset storage."}

## Arduino IDE setup

1. Install the ESP32 board package (Boards Manager) and the LVGL library (Library Manager, see above).
2. Install your display driver library.
3. Copy this whole folder next to your \`.ino\` sketch (or open \`Example.ino\` directly as your sketch).
4. Edit \`KiboUIConfig.h\` for your pins, and \`Example.ino\`'s \`InitializeDisplay()\`/\`kibo_disp_flush()\` for your driver.
5. Select your ESP32 board + port, and upload.

## PlatformIO setup

See the \`platformio.ini\` example above. Build with \`pio run\`, upload with \`pio run -t upload\`.

## Regenerating safely

Re-exporting from Kibo Eye Studio replaces every file in this folder except your own
application code elsewhere in the project. Keep custom logic in your own \`.ino\`/\`.cpp\` files
(calling \`KiboUI::FindWidget()\`/\`SetLabelText()\`/etc.) rather than editing inside
\`KiboUI.cpp\`/\`KiboUI.h\`/\`KiboUIAssets.*\` directly — those get fully overwritten. The one
exception is the \`// TODO\` callback bodies in \`KiboUI.cpp\`, which are generated as empty
stubs but a re-export always regenerates the whole file — for logic you want to survive a
re-export, keep it in your own file instead. \`lv_conf.h\` is also fully regenerated on every
export — if you hand-edit it for your hardware (color depth, memory size, logging), either keep
a copy of your edits to reapply after re-exporting, or move your customized \`lv_conf.h\` outside
this folder (to your sketchbook root or PlatformIO \`include/\`, wherever your toolchain already
finds it) once it's set up the way you want, so re-exporting this folder doesn't touch it.

## Logic tab script

${
  codegen.errors.length > 0
    ? `**${codegen.errors.length} issue(s) could not be converted to C++** — see the Logic tab's validation panel in Kibo Eye Studio for the exact lines; those constructs were skipped in this export.`
    : project.uiDesign.script.trim()
      ? `The Logic tab's script compiled cleanly: ${codegen.variables.length} variable(s), ${codegen.functions.length} function(s), ${codegen.eventHandlers.length} event handler(s), ${codegen.timers.length} timer(s)${codegen.hardwareStubs.length > 0 ? `, ${codegen.hardwareStubs.length} hardware stub(s) you must wire to your own GPIO/sensor/radio code` : ''}.`
      : 'No script was authored — every widget uses its default LVGL behavior only.'
}

## Export validation

${validationSummaryText(widgets, rules, events, codegen)}
`
}

function validationSummaryText(widgets: UiWidget[], rules: CssRuleExport[], events: EventExport[], codegen: CodegenResult): string {
  return [
    `LVGL widgets: Passed (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`,
    `UI styles: Passed (${rules.length} rule${rules.length === 1 ? '' : 's'})`,
    'UI assets: Passed',
    `Event callbacks: Passed (${events.length} handler${events.length === 1 ? '' : 's'})`,
    'LVGL configuration: Passed',
    'Eye Studio code excluded: Passed',
    'Arduino example: Passed',
    codegen.errors.length > 0 ? `Logic tab script: Failed (${codegen.errors.length} issue(s) — see the Logic tab's validation panel)` : 'Logic tab script: Passed'
  ].join('\n')
}

export { LVGL_VERSION }
