// LVGL's built-in symbol font (lv_symbol_def.h) — one small glyph per macro, always available in
// any LVGL build with no extra asset/flash cost. `id` is stored verbatim on UiWidget.iconSymbol
// and IS the real C macro name, so export never needs a separate id->macro lookup table (see
// lvglExport.ts's widgetTextLiteralWithIcon). `glyph` is a Unicode approximation for the Studio
// canvas/picker ONLY — the browser has no access to LVGL's actual symbol font, so these are
// visual stand-ins for browsing/selecting, not pixel-accurate previews; the real glyph LVGL
// renders comes from its own font at firmware runtime. LV_SYMBOL_DUMMY is deliberately omitted
// (an internal LVGL sentinel, not a real selectable symbol).
export interface LvglSymbolDef {
  id: string
  label: string
  glyph: string
}

export const LVGL_SYMBOLS: LvglSymbolDef[] = [
  { id: 'LV_SYMBOL_AUDIO', label: 'Audio', glyph: '♫' },
  { id: 'LV_SYMBOL_VIDEO', label: 'Video', glyph: '\u{1F3A5}' },
  { id: 'LV_SYMBOL_LIST', label: 'List', glyph: '☰' },
  { id: 'LV_SYMBOL_OK', label: 'OK', glyph: '✓' },
  { id: 'LV_SYMBOL_CLOSE', label: 'Close', glyph: '✕' },
  { id: 'LV_SYMBOL_POWER', label: 'Power', glyph: '⏻' },
  { id: 'LV_SYMBOL_SETTINGS', label: 'Settings', glyph: '⚙' },
  { id: 'LV_SYMBOL_HOME', label: 'Home', glyph: '⌂' },
  { id: 'LV_SYMBOL_DOWNLOAD', label: 'Download', glyph: '⬇' },
  { id: 'LV_SYMBOL_DRIVE', label: 'Drive', glyph: '\u{1F4BD}' },
  { id: 'LV_SYMBOL_REFRESH', label: 'Refresh', glyph: '↻' },
  { id: 'LV_SYMBOL_MUTE', label: 'Mute', glyph: '\u{1F507}' },
  { id: 'LV_SYMBOL_VOLUME_MID', label: 'Volume Mid', glyph: '\u{1F509}' },
  { id: 'LV_SYMBOL_VOLUME_MAX', label: 'Volume Max', glyph: '\u{1F50A}' },
  { id: 'LV_SYMBOL_IMAGE', label: 'Image', glyph: '\u{1F5BC}' },
  { id: 'LV_SYMBOL_TINT', label: 'Tint', glyph: '\u{1F4A7}' },
  { id: 'LV_SYMBOL_PREV', label: 'Previous', glyph: '⏮' },
  { id: 'LV_SYMBOL_PLAY', label: 'Play', glyph: '▶' },
  { id: 'LV_SYMBOL_PAUSE', label: 'Pause', glyph: '⏸' },
  { id: 'LV_SYMBOL_STOP', label: 'Stop', glyph: '⏹' },
  { id: 'LV_SYMBOL_NEXT', label: 'Next', glyph: '⏭' },
  { id: 'LV_SYMBOL_EJECT', label: 'Eject', glyph: '⏏' },
  { id: 'LV_SYMBOL_LEFT', label: 'Left', glyph: '◀' },
  { id: 'LV_SYMBOL_RIGHT', label: 'Right', glyph: '▶' },
  { id: 'LV_SYMBOL_PLUS', label: 'Plus', glyph: '+' },
  { id: 'LV_SYMBOL_MINUS', label: 'Minus', glyph: '−' },
  { id: 'LV_SYMBOL_EYE_OPEN', label: 'Eye Open', glyph: '\u{1F441}' },
  { id: 'LV_SYMBOL_EYE_CLOSE', label: 'Eye Close', glyph: '\u{1F576}' },
  { id: 'LV_SYMBOL_WARNING', label: 'Warning', glyph: '⚠' },
  { id: 'LV_SYMBOL_SHUFFLE', label: 'Shuffle', glyph: '\u{1F500}' },
  { id: 'LV_SYMBOL_UP', label: 'Up', glyph: '▲' },
  { id: 'LV_SYMBOL_DOWN', label: 'Down', glyph: '▼' },
  { id: 'LV_SYMBOL_LOOP', label: 'Loop', glyph: '\u{1F501}' },
  { id: 'LV_SYMBOL_DIRECTORY', label: 'Directory', glyph: '\u{1F4C1}' },
  { id: 'LV_SYMBOL_UPLOAD', label: 'Upload', glyph: '⬆' },
  { id: 'LV_SYMBOL_CALL', label: 'Call', glyph: '\u{1F4DE}' },
  { id: 'LV_SYMBOL_CUT', label: 'Cut', glyph: '✂' },
  { id: 'LV_SYMBOL_COPY', label: 'Copy', glyph: '\u{1F4CB}' },
  { id: 'LV_SYMBOL_SAVE', label: 'Save', glyph: '\u{1F4BE}' },
  { id: 'LV_SYMBOL_CHARGE', label: 'Charge', glyph: '⚡' },
  { id: 'LV_SYMBOL_PASTE', label: 'Paste', glyph: '\u{1F4E5}' },
  { id: 'LV_SYMBOL_BELL', label: 'Bell', glyph: '\u{1F514}' },
  { id: 'LV_SYMBOL_KEYBOARD', label: 'Keyboard', glyph: '⌨' },
  { id: 'LV_SYMBOL_GPS', label: 'GPS', glyph: '\u{1F4CD}' },
  { id: 'LV_SYMBOL_FILE', label: 'File', glyph: '\u{1F4C4}' },
  { id: 'LV_SYMBOL_WIFI', label: 'Wi-Fi', glyph: '\u{1F4F6}' },
  { id: 'LV_SYMBOL_BATTERY_FULL', label: 'Battery Full', glyph: '\u{1F50B}' },
  { id: 'LV_SYMBOL_BATTERY_3', label: 'Battery 3/4', glyph: '\u{1F50B}' },
  { id: 'LV_SYMBOL_BATTERY_2', label: 'Battery 1/2', glyph: '\u{1F50B}' },
  { id: 'LV_SYMBOL_BATTERY_1', label: 'Battery 1/4', glyph: '\u{1F50B}' },
  { id: 'LV_SYMBOL_BATTERY_EMPTY', label: 'Battery Empty', glyph: '\u{1F50B}' },
  { id: 'LV_SYMBOL_USB', label: 'USB', glyph: '\u{1F50C}' },
  { id: 'LV_SYMBOL_BLUETOOTH', label: 'Bluetooth', glyph: 'BT' },
  { id: 'LV_SYMBOL_TRASH', label: 'Trash', glyph: '\u{1F5D1}' },
  { id: 'LV_SYMBOL_EDIT', label: 'Edit', glyph: '✎' },
  { id: 'LV_SYMBOL_BACKSPACE', label: 'Backspace', glyph: '⌫' },
  { id: 'LV_SYMBOL_SD_CARD', label: 'SD Card', glyph: 'SD' },
  { id: 'LV_SYMBOL_NEW_LINE', label: 'New Line', glyph: '↵' },
  { id: 'LV_SYMBOL_BULLET', label: 'Bullet', glyph: '•' }
]

const BY_ID = new Map(LVGL_SYMBOLS.map((s) => [s.id, s]))

export function lvglSymbolById(id: string | null | undefined): LvglSymbolDef | undefined {
  return id ? BY_ID.get(id) : undefined
}
