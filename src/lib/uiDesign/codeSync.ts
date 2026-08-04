// Two-way sync for the LVGL Code panel's manual edits (see LvglCodePanel.tsx):
//  - findRecognizedCodeChanges(): CODE -> WIDGETS. Runs when you click Apply — recognizes a
//    fixed set of common LVGL call shapes in the edited text (position/size, text, show/hide,
//    slider/bar/arc value, checkbox/switch checked state, and the local-style calls for
//    background/text/border color, border width, corner radius, and opacity — see
//    STYLE_COLOR_RE/STYLE_NUM_RE below) and applies the values they carry back onto the matching
//    widget's real fields in one batched update, so the canvas preview and Properties panel
//    visibly update from an applied code edit.
//  - patchCodeWithWidgetValues(): WIDGETS -> CODE. Runs automatically whenever the visual
//    designer changes a widget already referenced in an applied code override (drag/resize in
//    Properties panel, etc.) — rewrites just the recognized calls' numeric/string arguments to
//    match the widget's current values, leaving everything else in the override (comments,
//    event callback bodies, custom lines) byte-for-byte untouched. Together these make every
//    recognized property flow in both directions without either side clobbering the other's
//    edits.
//  - findWidgetVarNamesInCode()/hasStructuralDrift(): used for the panel's staleness banner —
//    only fires for changes a patch genuinely can't absorb (a widget added/removed from the
//    screen), not for the routine property tweaks patchCodeWithWidgetValues already keeps in
//    sync, so the banner doesn't nag after every ordinary edit.
//
// This is NOT a C++ interpreter: anything outside these exact shapes (event callback bodies,
// custom function calls, arbitrary LVGL APIs) is simply not recognized in either direction and
// has no effect — same "only surface what's structurally recognizable, leave everything else
// untouched" precedent this codebase already uses for its HTML/CSS/script visual editors (see
// visualEvents.ts's own file-top comment).
//
// Deliberately regex/pattern-based, not a real parse, and deliberately run on the main thread:
// every function below is a handful of linear regex passes over a few KB of generated C++ (this
// project's screens are small — a handful to a few dozen widgets), completing in well under a
// millisecond. A background Worker thread would add real complexity (structured-clone the widget
// map across the boundary, a message-passing protocol) for no measurable responsiveness gain
// here; the actual "keep typing responsive" lever for this panel is debouncing *when* this work
// runs (see LvglCodePanel.tsx's debounced auto-patch effect), not *where* it runs.
import type { UiDesignProject, UiScreen, UiWidget, UiWidgetStyle } from '@/types'
import { reachableWidgetsForScreen, widgetVarName, widgetTextLiteralWithIcon, lengthToLvglSize, colorLiteral } from '@/lib/export/lvglExport'

export interface RecognizedCodeChange {
  widgetId: string
  style?: Partial<Pick<UiWidgetStyle, 'x' | 'y' | 'width' | 'height' | 'background' | 'color' | 'borderColor' | 'borderWidth' | 'borderRadius' | 'opacity'>>
  text?: string
  visible?: boolean
  value?: number
  checked?: boolean
}

const POS_RE = /lv_obj_set_pos\(\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g
const SIZE_RE = /lv_obj_set_size\(\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g
// The trailing string literal is optionally preceded by a bare LV_SYMBOL_* macro token (adjacent
// C string literals concatenate) — see widgetTextLiteralWithIcon() in lvglExport.ts, which is
// exactly what emits `lv_label_set_text(w_x_obj_label, LV_SYMBOL_SETTINGS " Button");` for any
// widget with a built-in icon selected (see the Icon Picker feature). The function name itself
// (label/checkbox/textarea) is captured too so patchCodeWithWidgetValues can preserve whichever
// one the original call used. The icon-prefix group's presence tells the read path that the
// string content has one extra leading space baked in (see widgetTextLiteralWithIcon's
// `JSON.stringify(' ' + widget.text)`) that must be stripped back off when reading it out.
const TEXT_RE = /lv_(label|checkbox|textarea)_set_text\(\s*(\w+)\s*,\s*(LV_SYMBOL_\w+\s+)?"((?:[^"\\]|\\.)*)"\s*\)/g
const HIDE_RE = /lv_obj_(add|remove)_flag\(\s*(\w+)\s*,\s*LV_OBJ_FLAG_HIDDEN\s*\)/g
// lv_slider_set_value(w, N, LV_ANIM_OFF) / lv_bar_set_value(w, N, LV_ANIM_OFF) / lv_arc_set_value(w, N)
// — see widgetCreateCalls() in lvglExport.ts, the only 3 widget kinds with a numeric "value".
const VALUE_RE = /lv_(slider|bar)_set_value\(\s*(\w+)\s*,\s*(-?\d+)\s*,\s*\w+\s*\)|lv_arc_set_value\(\s*(\w+)\s*,\s*(-?\d+)\s*\)/g
const CHECKED_RE = /lv_obj_(add|remove)_state\(\s*(\w+)\s*,\s*LV_STATE_CHECKED\s*\)/g
// A widget's "local style" — its own per-instance lv_style_t, keyed `style_local_<widgetVarName>`
// (see exportLvglStyles() in lvglExport.ts) — is where background/text/border color, border
// width, corner radius, and opacity actually live in generated code (never as inline
// lv_obj_set_style_* calls on the widget itself). The var-name suffix directly encodes which
// widget it belongs to, which is what makes this recognizable at all: a state-suffixed local
// style (`style_local_<var>_pressed`) simply won't match any real widget var name via byVarName,
// so it's naturally ignored rather than needing an explicit exclusion.
const STYLE_COLOR_RE =
  /lv_style_set_(bg_color|text_color|border_color)\(\s*&style_local_(\w+)\s*,\s*(lv_color_hex\(\s*0x([0-9A-Fa-f]{6})\s*\)|lv_color_make\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\))\s*\)/g
const STYLE_NUM_RE = /lv_style_set_(border_width|radius|opa)\(\s*&style_local_(\w+)\s*,\s*(\d+)\s*\)/g

const STYLE_COLOR_FIELD: Record<string, 'background' | 'color' | 'borderColor'> = {
  bg_color: 'background',
  text_color: 'color',
  border_color: 'borderColor'
}

function hexFromColorMatch(hexDigits: string | undefined, r: string | undefined, g: string | undefined, b: string | undefined): string {
  if (hexDigits) return `#${hexDigits.toUpperCase()}`
  const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')
  return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`.toUpperCase()
}

function unescapeCString(s: string): string {
  return s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}

function resolveWidget(byVarName: Map<string, UiWidget>, varName: string): UiWidget | undefined {
  const direct = byVarName.get(varName)
  if (direct) return direct
  if (varName.endsWith('_label')) return byVarName.get(varName.slice(0, -'_label'.length))
  return undefined
}

/** Scans `code` for the recognized call shapes and resolves each match's LVGL variable name back
 * to a real widget id via the exact same widgetVarName() naming this screen's code was generated
 * with — so a match only ever occurs against a variable name this app itself generated. Button
 * text writes target the `_label` child var (see widgetCreateCalls in lvglExport.ts); this
 * strips that suffix so the change lands on the button widget itself. Uses `matchAll` throughout
 * (never a stateful `.exec()`/`.test()` loop against these module-level `g`-flag regexes), so a
 * partial scan can never leave `lastIndex` pointing mid-string for the next caller. */
export function findRecognizedCodeChanges(uiDesign: UiDesignProject, screen: UiScreen, code: string): RecognizedCodeChange[] {
  const widgets = reachableWidgetsForScreen(uiDesign, screen)
  const byVarName = new Map<string, UiWidget>()
  for (const w of widgets) byVarName.set(widgetVarName(w), w)

  const changes = new Map<string, RecognizedCodeChange>()
  const getOrCreate = (widgetId: string): RecognizedCodeChange => {
    let c = changes.get(widgetId)
    if (!c) {
      c = { widgetId }
      changes.set(widgetId, c)
    }
    return c
  }

  for (const m of code.matchAll(POS_RE)) {
    const w = byVarName.get(m[1])
    if (!w) continue
    const c = getOrCreate(w.id)
    c.style = { ...c.style, x: Number(m[2]), y: Number(m[3]) }
  }
  for (const m of code.matchAll(SIZE_RE)) {
    const w = byVarName.get(m[1])
    if (!w) continue
    const c = getOrCreate(w.id)
    c.style = { ...c.style, width: Number(m[2]), height: Number(m[3]) }
  }
  for (const m of code.matchAll(TEXT_RE)) {
    const w = resolveWidget(byVarName, m[2])
    if (!w) continue
    let text = unescapeCString(m[4])
    if (m[3] && text.startsWith(' ')) text = text.slice(1) // strip the icon-concatenation's injected leading space
    getOrCreate(w.id).text = text
  }
  for (const m of code.matchAll(HIDE_RE)) {
    const w = byVarName.get(m[2])
    if (!w) continue
    getOrCreate(w.id).visible = m[1] === 'remove' // remove_flag(HIDDEN) => visible; add_flag(HIDDEN) => hidden
  }
  for (const m of code.matchAll(VALUE_RE)) {
    const varName = m[2] ?? m[4]
    const raw = m[3] ?? m[5]
    const w = byVarName.get(varName)
    if (!w) continue
    getOrCreate(w.id).value = Number(raw)
  }
  for (const m of code.matchAll(CHECKED_RE)) {
    const w = byVarName.get(m[2])
    if (!w) continue
    getOrCreate(w.id).checked = m[1] === 'add'
  }
  for (const m of code.matchAll(STYLE_COLOR_RE)) {
    const w = byVarName.get(m[2])
    if (!w) continue
    const field = STYLE_COLOR_FIELD[m[1]]
    const c = getOrCreate(w.id)
    c.style = { ...c.style, [field]: hexFromColorMatch(m[4], m[5], m[6], m[7]) }
  }
  for (const m of code.matchAll(STYLE_NUM_RE)) {
    const w = byVarName.get(m[2])
    if (!w) continue
    const c = getOrCreate(w.id)
    const n = Number(m[3])
    if (m[1] === 'border_width') c.style = { ...c.style, borderWidth: n }
    else if (m[1] === 'radius') c.style = { ...c.style, borderRadius: n }
    else c.style = { ...c.style, opacity: Math.round((n / 255) * 100) } // 'opa': 0-255 LVGL opacity -> 0-100%
  }

  return Array.from(changes.values())
}

/** The forward direction: rewrites every recognized call already present in `code` so its
 * arguments match the matching widget's CURRENT values — e.g. dragging a widget in the canvas or
 * editing its X field in the Properties panel updates the `lv_obj_set_pos(...)` call already
 * sitting in your applied code override, in place. Only rewrites calls that already exist in the
 * text (never invents new ones — that would be code generation, not patching) and only when the
 * current value is a shape the call already supports (e.g. a call with literal digit args is
 * left alone if the widget's width is now a percentage, since `lv_pct(N)` isn't a bare digit —
 * same "recognized subset only" limitation as the read direction). Every `.replace()` call below
 * runs to completion in one pass (no early return mid-scan), so each regex's `lastIndex` is left
 * reset to 0 by the engine when it finishes — safe to call repeatedly (e.g. on every widget edit,
 * via the debounced auto-patch effect) without state leaking between calls, and calling it twice
 * in a row on its own output is a no-op (idempotent) since it only ever re-derives the same
 * canonical text from the same widget values. */
export function patchCodeWithWidgetValues(uiDesign: UiDesignProject, screen: UiScreen, code: string): string {
  const widgets = reachableWidgetsForScreen(uiDesign, screen)
  const byVarName = new Map<string, UiWidget>()
  for (const w of widgets) byVarName.set(widgetVarName(w), w)

  let result = code

  result = result.replace(POS_RE, (full, varName) => {
    const w = byVarName.get(varName)
    if (!w) return full
    const x = typeof w.style.x === 'number' ? Math.round(w.style.x) : 0
    const y = typeof w.style.y === 'number' ? Math.round(w.style.y) : 0
    return `lv_obj_set_pos(${varName}, ${x}, ${y})`
  })

  result = result.replace(SIZE_RE, (full, varName) => {
    const w = byVarName.get(varName)
    if (!w) return full
    if (typeof w.style.width !== 'number' || typeof w.style.height !== 'number') return full // percent/auto — outside this call shape's range, leave as-authored
    return `lv_obj_set_size(${varName}, ${lengthToLvglSize(w.style.width)}, ${lengthToLvglSize(w.style.height)})`
  })

  result = result.replace(TEXT_RE, (full, kind, varName) => {
    const w = resolveWidget(byVarName, varName)
    if (!w) return full
    return `lv_${kind}_set_text(${varName}, ${widgetTextLiteralWithIcon(w)})`
  })

  result = result.replace(HIDE_RE, (full, _action, varName) => {
    const w = byVarName.get(varName)
    if (!w) return full
    return `lv_obj_${w.visible ? 'remove' : 'add'}_flag(${varName}, LV_OBJ_FLAG_HIDDEN)`
  })

  result = result.replace(VALUE_RE, (full, kind, sliderBarVar, _num, arcVar) => {
    const varName = sliderBarVar ?? arcVar
    const w = byVarName.get(varName)
    if (!w) return full
    const value = typeof w.props.value === 'number' ? w.props.value : 0
    if (sliderBarVar) return `lv_${kind}_set_value(${varName}, ${value}, LV_ANIM_OFF)`
    return `lv_arc_set_value(${varName}, ${value})`
  })

  result = result.replace(CHECKED_RE, (full, _action, varName) => {
    const w = byVarName.get(varName)
    if (!w) return full
    return `lv_obj_${w.props.checked ? 'add' : 'remove'}_state(${varName}, LV_STATE_CHECKED)`
  })

  result = result.replace(STYLE_COLOR_RE, (full, kind, varName) => {
    const w = byVarName.get(varName)
    if (!w) return full
    const field = STYLE_COLOR_FIELD[kind]
    const literal = colorLiteral(w.style[field])
    if (!literal) return full // field cleared, or a named CSS color colorLiteral can't resolve — leave as-authored
    return `lv_style_set_${kind}(&style_local_${varName}, ${literal})`
  })

  result = result.replace(STYLE_NUM_RE, (full, kind, varName) => {
    const w = byVarName.get(varName)
    if (!w) return full
    if (kind === 'border_width') {
      if (typeof w.style.borderWidth !== 'number') return full
      return `lv_style_set_border_width(&style_local_${varName}, ${Math.round(w.style.borderWidth)})`
    }
    if (kind === 'radius') {
      if (typeof w.style.borderRadius !== 'number') return full
      return `lv_style_set_radius(&style_local_${varName}, ${Math.round(w.style.borderRadius)})`
    }
    if (typeof w.style.opacity !== 'number') return full
    return `lv_style_set_opa(&style_local_${varName}, ${Math.round((w.style.opacity / 100) * 255)})`
  })

  return result
}

/** Every widget variable name this code text references via a recognized call — used only to
 * detect structural drift (see hasStructuralDrift below), not as a general-purpose parser. */
export function findWidgetVarNamesInCode(code: string): Set<string> {
  const names = new Set<string>()
  for (const m of code.matchAll(POS_RE)) names.add(m[1])
  for (const m of code.matchAll(SIZE_RE)) names.add(m[1])
  return names
}

/** True when the live design now has a widget this code has never seen, or the code references a
 * widget that's since been deleted — the two cases patchCodeWithWidgetValues genuinely can't
 * absorb (it only rewrites existing calls' arguments, it never adds or removes calls). This is
 * what the Code panel's staleness banner keys off, instead of raw text equality, precisely so
 * ordinary position/size/text/visibility edits — which patchCodeWithWidgetValues already keeps
 * in sync automatically — don't also trigger a redundant "your code is stale" warning. */
export function hasStructuralDrift(uiDesign: UiDesignProject, screen: UiScreen, code: string): boolean {
  // Excludes the screen's own root widget — it's created via a bare `lv_obj_create(NULL)` with
  // no lv_obj_set_pos/set_size call of its own (see widgetCreateCalls in lvglExport.ts), so its
  // var name never appears in a recognized call and would otherwise register as permanent
  // "drift" for every screen, always, even with zero real changes.
  const widgets = reachableWidgetsForScreen(uiDesign, screen).filter((w) => w.id !== screen.rootWidgetId)
  const liveVarNames = new Set(widgets.map(widgetVarName))
  const codeVarNames = findWidgetVarNamesInCode(code)
  for (const v of liveVarNames) if (!codeVarNames.has(v)) return true
  for (const v of codeVarNames) if (!liveVarNames.has(v)) return true
  return false
}
