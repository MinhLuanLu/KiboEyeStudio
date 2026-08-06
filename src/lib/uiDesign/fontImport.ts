// Parses a pasted LVGL v9 bitmap-font .c source (produced by LVGL's own official online font
// converter, https://lvgl.io/tools/fontconverter) for which Unicode codepoints it declares —
// purely a text scan of the converter's own predictable output shape, NOT a real C/font parser
// (per this feature's plan: no font-format/rasterization work is done in this app, only storage,
// embedding, and this one lightweight coverage check). Real converter output declares codepoints
// two ways inside its `cmaps[]` table, both handled here:
//   1. A contiguous range:      .range_start = 32, .range_length = 95, ...
//   2. A sparse list, via a named array the cmap entry points at:
//        static const uint16_t unicode_list_2[] = { 0x3b1, 0x3b2, ... };
export const DANISH_CODEPOINTS: Record<string, number> = {
  æ: 0x00e6,
  Æ: 0x00c6,
  ø: 0x00f8,
  Ø: 0x00d8,
  å: 0x00e5,
  Å: 0x00c5
}

// Accepts both decimal and hex literals for range_start/range_length — real converter output
// normally uses decimal, but this is cheap to make robust to either.
const NUM_LITERAL = '(0x[0-9a-fA-F]+|\\d+)'
const RANGE_RE = new RegExp(`\\.range_start\\s*=\\s*${NUM_LITERAL}\\s*,\\s*\\.range_length\\s*=\\s*${NUM_LITERAL}`, 'g')
const UNICODE_LIST_ARRAY_RE = /unicode_list_\w+\[\]\s*=\s*\{([^}]*)\}/g
const HEX_OR_DEC_RE = /0x[0-9a-fA-F]+|\d+/g

export function parseDeclaredCodepoints(cSource: string): number[] {
  const codepoints = new Set<number>()

  for (const m of cSource.matchAll(RANGE_RE)) {
    const start = Number(m[1])
    const length = Number(m[2])
    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || length > 5000) continue
    for (let i = 0; i < length; i++) codepoints.add(start + i)
  }

  for (const m of cSource.matchAll(UNICODE_LIST_ARRAY_RE)) {
    for (const numMatch of m[1].matchAll(HEX_OR_DEC_RE)) {
      const n = Number(numMatch[0])
      if (Number.isFinite(n)) codepoints.add(n)
    }
  }

  return Array.from(codepoints).sort((a, b) => a - b)
}

/** Codepoints from DANISH_CODEPOINTS not present in `declaredCodepoints` — empty = full coverage. */
export function missingDanishCodepoints(declaredCodepoints: number[]): string[] {
  const declared = new Set(declaredCodepoints)
  return Object.entries(DANISH_CODEPOINTS)
    .filter(([, cp]) => !declared.has(cp))
    .map(([ch]) => ch)
}

// The real converter always defines exactly one public `const lv_font_t <name> = { ... };` (the
// symbol every LV_FONT_DECLARE/lv_obj_set_style_text_font call needs) — everything else it
// declares (glyph bitmap tables, cmaps, kern data) is `static`, i.e. private to that one .c file.
// A plain text scan for this one shape is enough to recover the symbol name without needing a
// real C parser.
const FONT_VAR_RE = /\bconst\s+lv_font_t\s+(\w+)\s*=/

/** The declared `lv_font_t` variable name a pasted font `.c` source defines — what `LV_FONT_DECLARE`
 * and `&<name>` in a `lv_obj_set_style_text_font()` call need to reference it. null if the source
 * doesn't match the expected converter output shape (surfaced as a validation warning by callers,
 * never silently guessed at). */
export function parseFontVariableName(cSource: string): string | null {
  const m = FONT_VAR_RE.exec(cSource)
  return m ? m[1] : null
}
