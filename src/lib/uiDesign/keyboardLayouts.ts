// Shared keyboard layout tables — the ONE source of truth for what keys exist in every mode,
// imported by both the live-preview renderer (WidgetRenderer.tsx) and every LVGL export codegen
// path (lvglExport.ts), the same "single shared geometry module" principle already used by
// pupilShapes.ts/eyeShapes.ts elsewhere in this codebase so preview and firmware can never
// structurally disagree about what a given keyboard mode contains.
//
// A raw built-in row is a plain string[]: either a literal 1-character token to type, or one of
// the KB_CONTROL sentinel strings below (never a real character — the '' prefix can't
// appear in normal text/keyboard layouts, so exact-string-match lookup is always unambiguous).

import type { UiKeyboardCase, UiKeyboardConfig, UiKeyboardCustomLayout, UiKeyboardLanguage, UiKeyboardPage } from '@/types'

export const KB_CONTROL = {
  shift: 'SHIFT',
  caps: 'CAPS',
  backspace: 'BACKSPACE',
  delete: 'DELETE',
  enter: 'ENTER',
  space: 'SPACE',
  lang: 'LANG',
  prevLayout: 'PREV',
  nextLayout: 'NEXT',
  close: 'CLOSE'
} as const

export type UiKeyboardControlToken = (typeof KB_CONTROL)[keyof typeof KB_CONTROL]

export const KB_CONTROL_TOKENS: ReadonlySet<string> = new Set(Object.values(KB_CONTROL))

/** What the live-preview canvas shows on a control key. */
export const KB_CONTROL_PREVIEW_LABEL: Record<string, string> = {
  [KB_CONTROL.shift]: '⇧',
  [KB_CONTROL.caps]: '⇪',
  [KB_CONTROL.backspace]: '⌫',
  [KB_CONTROL.delete]: 'Del',
  [KB_CONTROL.enter]: '⏎',
  [KB_CONTROL.space]: '',
  [KB_CONTROL.lang]: '🌐',
  [KB_CONTROL.prevLayout]: '‹',
  [KB_CONTROL.nextLayout]: '›',
  [KB_CONTROL.close]: '✕'
}

/** What gets embedded verbatim inside the generated `lv_keyboard_set_map()` C array for a
 * control key — real `LV_SYMBOL_*` macros where LVGL has a genuinely matching built-in symbol
 * (Backspace/Enter, matching the spec's own example concept literally), short bracketed literal
 * strings otherwise (self-documenting in the generated source, and exceedingly unlikely to
 * collide with anything a real layout would ever type). The generated shared event callback
 * string-compares `lv_buttonmatrix_get_button_text()`'s result against these same literals to
 * detect which control key was pressed — see lvglExport.ts's emitKeyboardEventCallback(). */
export const KB_CONTROL_LVGL_LITERAL: Record<string, string> = {
  [KB_CONTROL.shift]: '"[SHIFT]"',
  [KB_CONTROL.caps]: '"[CAPS]"',
  [KB_CONTROL.backspace]: 'LV_SYMBOL_BACKSPACE',
  [KB_CONTROL.delete]: '"[DEL]"',
  [KB_CONTROL.enter]: 'LV_SYMBOL_NEW_LINE',
  [KB_CONTROL.space]: '" "',
  [KB_CONTROL.lang]: '"[LANG]"',
  [KB_CONTROL.prevLayout]: '"[PREV]"',
  [KB_CONTROL.nextLayout]: '"[NEXT]"',
  [KB_CONTROL.close]: '"[CLOSE]"'
}

const DANISH_ONLY_CHARS = new Set(['å', 'Å', 'æ', 'Æ', 'ø', 'Ø'])

const ROW_LETTERS_1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']
const ROW_LETTERS_2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l']
const ROW_LETTERS_3 = [KB_CONTROL.shift, 'z', 'x', 'c', 'v', 'b', 'n', 'm', KB_CONTROL.backspace]
const BOTTOM_ROW = [KB_CONTROL.caps, KB_CONTROL.lang, KB_CONTROL.prevLayout, KB_CONTROL.space, KB_CONTROL.nextLayout, KB_CONTROL.enter, KB_CONTROL.close]

/** Lowercase letter rows for `language: 'english'`/`'danish'` — case (upper/lower) is applied at
 * resolve time, not baked into separate tables, since every other property of the two cases is
 * identical. */
export const ENGLISH_LETTERS_ROWS: string[][] = [ROW_LETTERS_1, ROW_LETTERS_2, ROW_LETTERS_3, BOTTOM_ROW]

/** Per the spec's own literal example: `q w e r t y u i o p å` / `a s d f g h j k l æ ø` /
 * `z x c v b n m`. æ/ø/å are direct keys, never alt-char long-press variants. */
export const DANISH_LETTERS_ROWS: string[][] = [
  [...ROW_LETTERS_1, 'å'],
  [...ROW_LETTERS_2, 'æ', 'ø'],
  ROW_LETTERS_3,
  BOTTOM_ROW
]

export const NUMBER_ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  ['.', ',', '?', '!', "'", KB_CONTROL.backspace],
  [KB_CONTROL.lang, KB_CONTROL.prevLayout, KB_CONTROL.space, KB_CONTROL.nextLayout, KB_CONTROL.enter, KB_CONTROL.close]
]

export const SYMBOL_ROWS: string[][] = [
  ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
  ['_', '\\', '|', '~', '<', '>', '€', '£', '¥', '•'],
  ['.', ',', '?', '!', "'", KB_CONTROL.backspace],
  [KB_CONTROL.lang, KB_CONTROL.prevLayout, KB_CONTROL.space, KB_CONTROL.nextLayout, KB_CONTROL.enter, KB_CONTROL.close]
]

/** Base English letters only — Danish's æ/ø/å are direct keys (see DANISH_LETTERS_ROWS), never
 * alt-chars, per the user's own explicit carve-out. */
export interface UiKeyboardAltCharTableEntry {
  base: string
  variants: string[]
}
export const DEFAULT_ALT_CHARS: UiKeyboardAltCharTableEntry[] = [
  { base: 'a', variants: ['á', 'à', 'â', 'ä'] },
  { base: 'e', variants: ['é', 'è', 'ê', 'ë'] },
  { base: 'o', variants: ['ó', 'ò', 'ô', 'ö'] },
  { base: 'u', variants: ['ú', 'ù', 'û', 'ü'] },
  { base: 'i', variants: ['í', 'ì', 'î', 'ï'] },
  { base: 'c', variants: ['ç'] },
  { base: 'n', variants: ['ñ'] }
]

/** One key as resolved for a specific keyboard state — the shape both the live-preview
 * renderer and codegen consume, so a custom layout's `UiKeyboardCustomKey` and a built-in row's
 * raw string token look identical to every consumer past this function. */
export interface UiResolvedKeyboardKey {
  /** Stable per-key id: the literal character/control sentinel for built-in rows, or the
   * UiKeyboardCustomKey's own id for a custom layout. */
  keyId: string
  /** What the live-preview canvas shows on the key. */
  display: string
  /** What gets typed into the target textarea when tapped — '' for control keys, which are
   * handled specially instead (see control below). */
  insertText: string
  control: UiKeyboardControlToken | null
}

function resolveBuiltinRows(rows: string[][], language: UiKeyboardLanguage, kase: UiKeyboardCase, danishCharsEnabled: boolean, showLanguageSwitchKey: boolean): UiResolvedKeyboardKey[][] {
  return rows.map((row) =>
    row
      .filter((token) => showLanguageSwitchKey || token !== KB_CONTROL.lang)
      .filter((token) => language === 'danish' && !danishCharsEnabled ? !DANISH_ONLY_CHARS.has(token) : true)
      .map((token): UiResolvedKeyboardKey => {
        if (KB_CONTROL_TOKENS.has(token)) {
          return { keyId: token, display: KB_CONTROL_PREVIEW_LABEL[token] ?? token, insertText: '', control: token as UiKeyboardControlToken }
        }
        const isLetter = /^\p{L}$/u.test(token)
        const display = isLetter ? (kase === 'upper' ? token.toUpperCase() : token.toLowerCase()) : token
        return { keyId: token, display, insertText: display, control: null }
      })
  )
}

function resolveCustomRows(layout: UiKeyboardCustomLayout | null): UiResolvedKeyboardKey[][] {
  const rows: UiResolvedKeyboardKey[][] = []
  for (const key of layout?.keys ?? []) {
    if (key.newRow || rows.length === 0) rows.push([])
    rows[rows.length - 1].push({ keyId: key.id, display: key.label, insertText: key.insertText, control: null })
  }
  // A custom layout still needs a way to delete/submit/close — always append this fixed trailing
  // row rather than requiring the user to hand-author it (they can still add their own extra
  // rows above it via the Properties panel's custom-layout editor).
  rows.push([
    { keyId: KB_CONTROL.backspace, display: KB_CONTROL_PREVIEW_LABEL[KB_CONTROL.backspace], insertText: '', control: KB_CONTROL.backspace },
    { keyId: KB_CONTROL.enter, display: KB_CONTROL_PREVIEW_LABEL[KB_CONTROL.enter], insertText: '', control: KB_CONTROL.enter },
    { keyId: KB_CONTROL.close, display: KB_CONTROL_PREVIEW_LABEL[KB_CONTROL.close], insertText: '', control: KB_CONTROL.close }
  ])
  return rows
}

/** Resolves a keyboard's current {language, case, page} state into rows of real keys — the one
 * function both the live-preview renderer and every codegen path call, so they can never
 * structurally disagree. `page: 'letters'` is meaningless for `language: 'custom'` (a custom
 * layout has no case/page concept — see UiKeyboardConfig's own doc comment); `page` is ignored
 * in that case. */
export function resolveKeyboardMap(config: Pick<UiKeyboardConfig, 'language' | 'danishCharsEnabled' | 'showLanguageSwitchKey' | 'customLayout'>, kase: UiKeyboardCase, page: UiKeyboardPage): UiResolvedKeyboardKey[][] {
  if (config.language === 'custom') return resolveCustomRows(config.customLayout)
  if (page === 'numbers') return resolveBuiltinRows(NUMBER_ROWS, config.language, kase, config.danishCharsEnabled, config.showLanguageSwitchKey)
  if (page === 'symbols') return resolveBuiltinRows(SYMBOL_ROWS, config.language, kase, config.danishCharsEnabled, config.showLanguageSwitchKey)
  const rows = config.language === 'danish' ? DANISH_LETTERS_ROWS : ENGLISH_LETTERS_ROWS
  return resolveBuiltinRows(rows, config.language, kase, config.danishCharsEnabled, config.showLanguageSwitchKey)
}

/** Live, ephemeral (never persisted — see store.ts's `keyboardRuntime`) per-keyboard-widget state
 * for the interactive live preview: what's currently typed, cursor position, and which
 * language/case/page is active right now (independent of the widget's own *default*
 * language/case/page in keyboardConfig, which only sets the STARTING state). `lastAction`/
 * `lastCallback`/`lastDetailLabel`/`lastDetailValue` back the optional debug/event-info label —
 * see formatKeyboardDebugText() below. `lastDetailLabel`/`Value` are a generic one-line "what
 * just happened, concretely" pair whose label varies by action (spec's own examples show
 * "Selected character: æ" for a keypress, "Direction: Left" for cursor movement, "Value:
 * København" for a text change) — all gated by the same `showSelectedCharacter` config toggle
 * (the spec's four debug-panel toggles don't have a separate one per action kind). */
export interface UiKeyboardRuntimeState {
  text: string
  cursorPos: number
  language: UiKeyboardLanguage
  case: UiKeyboardCase
  page: UiKeyboardPage
  lastAction: string
  lastCallback: string
  lastDetailLabel: string
  lastDetailValue: string
}

export function defaultKeyboardRuntimeState(config: Pick<UiKeyboardConfig, 'language' | 'defaultCase' | 'defaultPage'>): UiKeyboardRuntimeState {
  return {
    text: '',
    cursorPos: 0,
    language: config.language === 'custom' ? 'custom' : config.language,
    case: config.defaultCase,
    page: config.defaultPage,
    lastAction: '',
    lastCallback: '',
    lastDetailLabel: '',
    lastDetailValue: ''
  }
}

/** Formats the optional debug/event-info label's text — matches the spec's own example shapes
 * (`Selected character: æ` / `Action: Character pressed` / `Callback: OnCharacterSelected`),
 * respecting each individual show* toggle in keyboardConfig. */
export function formatKeyboardDebugText(config: UiKeyboardConfig, runtime: UiKeyboardRuntimeState): string {
  const lines: string[] = []
  if (config.showSelectedCharacter && runtime.lastDetailLabel) lines.push(`${runtime.lastDetailLabel}: ${runtime.lastDetailValue}`)
  if (config.showCurrentAction && runtime.lastAction) lines.push(`Action: ${runtime.lastAction}`)
  if (config.showCursorPosition) lines.push(`Cursor position: ${runtime.cursorPos}`)
  if (config.showCallbackName && runtime.lastCallback) lines.push(`Callback: ${runtime.lastCallback}`)
  return lines.join('\n')
}

/** The next page in the letters -> numbers -> symbols -> letters cycle (KB_CONTROL.nextLayout). */
export function nextKeyboardPage(page: UiKeyboardPage): UiKeyboardPage {
  if (page === 'letters') return 'numbers'
  if (page === 'numbers') return 'symbols'
  return 'letters'
}
/** The previous page in that same cycle (KB_CONTROL.prevLayout). */
export function previousKeyboardPage(page: UiKeyboardPage): UiKeyboardPage {
  if (page === 'letters') return 'symbols'
  if (page === 'symbols') return 'numbers'
  return 'letters'
}

/** The actual key-press state machine — shared by every interactive entry point (the live
 * preview's plain click handler, its long-press alt-char popover, and the encoder-navigation
 * simulate buttons in store.ts) so all three update runtime state / fire events identically.
 * Deliberately dependency-free (no store.ts/sandboxRuntime.ts imports — `dispatchEvent` is a
 * plain callback the caller supplies) both because keyboardLayouts.ts is meant to stay a pure
 * lib module and because store.ts already imports FROM this file, so this file importing back
 * INTO sandboxRuntime.ts (which itself imports store.ts) would create a real circular import.
 * Mirrors the exported C++ event callback's own control-token branching (see lvglExport.ts's
 * emitKeyboardEventCallback) closely enough that preview and firmware behave the same way
 * structurally, not just visually. */
export function applyKeyboardKeyPress(
  widgetId: string,
  config: UiKeyboardConfig,
  rt: UiKeyboardRuntimeState,
  key: UiResolvedKeyboardKey,
  maxLength: number,
  setKeyboardRuntimeState: (widgetId: string, partial: Partial<UiKeyboardRuntimeState>) => void,
  dispatchEvent?: (widgetId: string, event: string, ...args: unknown[]) => void
): void {
  const set = (partial: Partial<UiKeyboardRuntimeState>) => setKeyboardRuntimeState(widgetId, partial)
  const dispatchTextChanged = (text: string) => {
    if (config.targetTextareaId) dispatchEvent?.(config.targetTextareaId, 'valueChanged', text)
  }

  switch (key.control) {
    case KB_CONTROL.shift:
    case KB_CONTROL.caps:
      set({ case: rt.case === 'lower' ? 'upper' : 'lower' })
      return
    case KB_CONTROL.lang:
      set({ language: rt.language === 'danish' ? 'english' : 'danish' })
      return
    case KB_CONTROL.prevLayout:
      set({ page: previousKeyboardPage(rt.page) })
      return
    case KB_CONTROL.nextLayout:
      set({ page: nextKeyboardPage(rt.page) })
      return
    case KB_CONTROL.backspace: {
      if (rt.cursorPos === 0) return
      const text = rt.text.slice(0, rt.cursorPos - 1) + rt.text.slice(rt.cursorPos)
      set({ text, cursorPos: rt.cursorPos - 1, lastAction: 'Backspace', lastCallback: 'OnBackspace', lastDetailLabel: '', lastDetailValue: '' })
      dispatchTextChanged(text)
      return
    }
    case KB_CONTROL.delete: {
      if (rt.cursorPos >= rt.text.length) return
      const text = rt.text.slice(0, rt.cursorPos) + rt.text.slice(rt.cursorPos + 1)
      set({ text, lastAction: 'Delete', lastCallback: 'OnDelete', lastDetailLabel: '', lastDetailValue: '' })
      dispatchTextChanged(text)
      return
    }
    case KB_CONTROL.enter:
      set({ lastAction: 'Submit', lastCallback: 'OnSubmit', lastDetailLabel: '', lastDetailValue: '' })
      if (config.targetTextareaId) dispatchEvent?.(config.targetTextareaId, 'longPress')
      return
    case KB_CONTROL.close:
      set({ lastAction: 'Keyboard closed', lastCallback: 'OnKeyboardClose', lastDetailLabel: '', lastDetailValue: '' })
      return
    case null:
    case undefined: {
      if (maxLength > 0 && rt.text.length >= maxLength) return
      const text = rt.text.slice(0, rt.cursorPos) + key.insertText + rt.text.slice(rt.cursorPos)
      set({
        text,
        cursorPos: rt.cursorPos + key.insertText.length,
        lastAction: 'Character pressed',
        lastCallback: 'OnCharacterSelected',
        lastDetailLabel: 'Selected character',
        lastDetailValue: key.insertText
      })
      dispatchTextChanged(text)
      return
    }
  }
}
