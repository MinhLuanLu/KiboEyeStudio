// The board/display/pin/format configuration surface for "Complete Project" LVGL exports.
// Deliberately NOT part of `UiDesignProject`/persisted project data — this is a one-off,
// export-time choice (dialog-local React state, seeded from the presets below), not a design
// decision that needs undo/redo or save-format migration. Keeping it here also keeps
// lvglExport.ts's "structurally isolated, only ever reads project.uiDesign" guarantee (see that
// file's top comment) intact — the export target is passed in alongside the project, never read
// from it.
//
// LVGL version is deliberately NOT a field here: every codegen path in lvglExport.ts targets
// v9.x specifically (see LVGL_VERSION in lvglExport.ts) — a real switchable version dropdown
// would imply support that doesn't exist. The dialog shows this as fixed, read-only text instead.

export type EsBoard = 'esp32' | 'esp32s2' | 'esp32s3' | 'esp32c3' | 'esp32c6' | 'custom'
export type DisplayModel = 'gc9a01a' | 'ili9341' | 'st7789' | 'generic'
export type ExportFormat = 'arduino' | 'platformio'

export interface ExportPins {
  cs: number
  dc: number
  rst: number
  sclk: number
  mosi: number
  miso: number
  bl: number
}

export interface ExportTarget {
  board: EsBoard
  /** Free-text board id, used only when board === 'custom' (e.g. a platformio board string or
   * Arduino FQBN the built-in list doesn't cover). */
  boardFqbnCustom: string
  displayModel: DisplayModel
  width: number
  height: number
  shape: 'round' | 'square'
  pins: ExportPins
  format: ExportFormat
}

export const BOARD_LABELS: Record<EsBoard, string> = {
  esp32: 'ESP32 (original)',
  esp32s2: 'ESP32-S2',
  esp32s3: 'ESP32-S3',
  esp32c3: 'ESP32-C3',
  esp32c6: 'ESP32-C6',
  custom: 'Custom…'
}

/** Arduino FQBNs / PlatformIO board ids for each built-in board choice. Only used to fill in
 * README.md/platformio.ini text — GPIO pin numbers are a wiring decision, not a board-family
 * one, so this table intentionally does NOT also carry pin presets (see DISPLAY_PRESETS below,
 * keyed by display model instead). */
export const BOARD_IDS: Record<Exclude<EsBoard, 'custom'>, { arduinoFqbn: string; platformioBoard: string }> = {
  esp32: { arduinoFqbn: 'esp32:esp32:esp32', platformioBoard: 'esp32dev' },
  esp32s2: { arduinoFqbn: 'esp32:esp32:esp32s2', platformioBoard: 'esp32-s2-saola-1' },
  esp32s3: { arduinoFqbn: 'esp32:esp32:esp32s3', platformioBoard: 'esp32-s3-devkitc-1' },
  esp32c3: { arduinoFqbn: 'esp32:esp32:esp32c3', platformioBoard: 'esp32-c3-devkitm-1' },
  esp32c6: { arduinoFqbn: 'esp32:esp32:esp32c6', platformioBoard: 'esp32-c6-devkitc-1' }
}

export const DISPLAY_MODEL_LABELS: Record<DisplayModel, string> = {
  gc9a01a: 'GC9A01A round (matches Kibo project)',
  ili9341: 'ILI9341',
  st7789: 'ST7789',
  generic: 'Generic / other'
}

/** Per-display-model default pins/resolution/shape — selecting a display model in the dialog
 * fills these in (still user-editable after). Only the `gc9a01a` preset gets a real, compiling
 * flush-callback implementation in generateCompleteProjectExport() (see lvglExport.ts) — it's
 * the literal "reuse this project's ... display settings, pin configuration, and initialization
 * logic" deliverable the export feature was asked to provide, taken directly from
 * `C:\Users\minhl\OneDrive\Desktop\Robo\Kibo\Display.h`. The others stay TODO-stubbed exactly
 * like the existing single-mode export already does — implementing every possible display
 * driver's real init sequence is out of scope; the point of this preset is to make the one
 * concrete, real display this whole feature was motivated by "just work."
 */
export const DISPLAY_PRESETS: Record<DisplayModel, { width: number; height: number; shape: 'round' | 'square'; pins: ExportPins }> = {
  gc9a01a: { width: 240, height: 240, shape: 'round', pins: { cs: 2, dc: 4, rst: 5, sclk: 6, mosi: 7, miso: -1, bl: -1 } },
  ili9341: { width: 240, height: 320, shape: 'square', pins: { cs: 5, dc: 2, rst: 4, sclk: 18, mosi: 23, miso: 19, bl: -1 } },
  st7789: { width: 240, height: 240, shape: 'square', pins: { cs: 5, dc: 2, rst: 4, sclk: 18, mosi: 23, miso: -1, bl: -1 } },
  generic: { width: 240, height: 240, shape: 'square', pins: { cs: -1, dc: -1, rst: -1, sclk: -1, mosi: -1, miso: -1, bl: -1 } }
}

/** Literal "reuse the real Kibo project's setup" default — matches
 * `C:\Users\minhl\OneDrive\Desktop\Robo\Kibo\Display.h` and `lv_conf.h` exactly (SPI pins, round
 * 240x240 GC9A01A panel, ESP32-C6, Arduino IDE format since that project has no platformio.ini). */
export const KIBO_PROJECT_PRESET: ExportTarget = {
  board: 'esp32c6',
  boardFqbnCustom: '',
  displayModel: 'gc9a01a',
  width: 240,
  height: 240,
  shape: 'round',
  pins: { cs: 2, dc: 4, rst: 5, sclk: 6, mosi: 7, miso: -1, bl: -1 },
  format: 'arduino'
}

export function boardIdFor(target: ExportTarget): { arduinoFqbn: string; platformioBoard: string } {
  if (target.board === 'custom') {
    const custom = target.boardFqbnCustom.trim() || 'esp32:esp32:esp32'
    return { arduinoFqbn: custom, platformioBoard: custom }
  }
  return BOARD_IDS[target.board]
}
