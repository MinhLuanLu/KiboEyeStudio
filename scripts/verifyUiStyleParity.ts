/**
 * Studio-preview vs LVGL-exporter STYLE PARITY guard.
 *
 * Run with: npx tsx scripts/verifyUiStyleParity.ts   (or: npm run verify:ui-style)
 *
 * "What you see in the Studio preview must be what shows on the ESP32." The preview
 * (components/UiDesign/WidgetRenderer.tsx via lib/uiDesign/cssCascade.ts's computeEffectiveStyle)
 * and the exporter (lib/export/lvglExport.ts's styleSetCalls) are two implementations of the same
 * UiWidgetStyle model. This script guards them from silently drifting apart:
 *
 *   1. COMPLETENESS (compile-time): CLASSIFICATION is `Record<keyof UiWidgetStyle, Category>`, so
 *      adding a new property to UiWidgetStyle makes THIS FILE fail to type-check until the property
 *      is classified — forcing a decision about how the exporter handles it. This is the core guard.
 *   2. EMISSION (runtime): every property classified 'emitted' must actually produce an
 *      `lv_style_set_*` call from styleSetCalls — catches the exporter silently dropping a property.
 *   3. CONVERSION (runtime): spot-checks the value math (opacity %→0-255, nearest Montserrat font
 *      size, padding rounding, color hex) so a wrong conversion can't slip through.
 *
 * It intentionally does NOT re-render pixels (no ESP32/arduino-cli in this environment) — it checks
 * the thing that actually determines agreement: which properties map through, and how.
 */
import type { UiWidgetStyle } from '../src/types'
import { styleSetCalls, nearestMontserratSize } from '../src/lib/export/lvglExport'

type Category =
  | 'emitted' // styleSetCalls emits an lv_style_set_* call for this
  | 'position' // folded into lv_obj_set_pos()/set_size() per-widget (incl. margin-left/top bake)
  | 'handled-elsewhere' // emitted outside styleSetCalls (custom-font line, label long-mode, text content, preset expansion, image fit)
  | 'modifier' // only alters HOW another property emits (no standalone call)
  | 'consistent-noop' // preview & export both ignore it for an absolutely-positioned box
  | 'layer' // widget creation order / hidden flag, not a style
  | 'preview-only' // preview shows it; the device can't reproduce it with built-in fonts/no transforms (documented limitation)

// Compile-time completeness: every UiWidgetStyle key MUST appear here or this file won't build.
const CLASSIFICATION: Record<keyof UiWidgetStyle, Category> = {
  // --- emitted by styleSetCalls (shared lv_style_t) ---
  background: 'emitted',
  backgroundGradient: 'emitted',
  backgroundImage: 'emitted',
  backgroundOpacity: 'emitted',
  borderColor: 'emitted',
  borderOpacity: 'emitted',
  borderRadius: 'emitted',
  borderWidth: 'emitted',
  color: 'emitted',
  opacity: 'emitted',
  textOpacity: 'emitted',
  fontSize: 'emitted',
  letterSpacing: 'emitted',
  lineHeight: 'emitted',
  underline: 'emitted',
  strikethrough: 'emitted',
  textAlign: 'emitted',
  paddingTop: 'emitted',
  paddingBottom: 'emitted',
  paddingLeft: 'emitted',
  paddingRight: 'emitted',
  gap: 'emitted',
  flexDirection: 'emitted',
  justifyContent: 'emitted',
  alignItems: 'emitted',
  shadowWidth: 'emitted',
  shadowColor: 'emitted',
  shadowOffsetX: 'emitted',
  shadowOffsetY: 'emitted',
  elevation: 'emitted',
  glowColor: 'emitted',
  glowRadius: 'emitted',
  // --- position / size (per-widget lv_obj_set_pos/set_size; margin-left/top baked into x/y) ---
  x: 'position',
  y: 'position',
  width: 'position',
  height: 'position',
  marginLeft: 'position',
  marginTop: 'position',
  // --- handled outside styleSetCalls ---
  fontId: 'handled-elsewhere', // customFontStyleLine() per object
  textOverflow: 'handled-elsewhere', // labelLongModeLine()
  wordWrap: 'handled-elsewhere', // labelLongModeLine()
  textTransform: 'handled-elsewhere', // applied to the text content (applyTextTransform)
  surfaceStyle: 'handled-elsewhere', // Surface/Material preset expanded into concrete props by the cascade
  imageFit: 'handled-elsewhere', // image widget fit logic
  // --- modifiers ---
  backgroundSize: 'modifier', // only affects the bg-image emission (tile/native)
  flexWrap: 'modifier', // only appends _WRAP to flex_flow
  // --- consistent no-ops for an absolutely-positioned box (both sides ignore) ---
  marginRight: 'consistent-noop',
  marginBottom: 'consistent-noop',
  // --- layer / visibility ---
  visible: 'layer',
  zIndex: 'layer',
  // --- preview-only / documented device limitations ---
  fontWeight: 'preview-only', // built-in Montserrat has no weight variants (needs a custom font)
  fontStyle: 'preview-only', // built-in Montserrat has no italic variant (needs a custom font)
  fontFamily: 'preview-only', // display metadata; real device font comes from fontId
  rotation: 'preview-only', // transform not exported (see EYES_NO_ROTATION note for the soft-float rationale)
  scale: 'preview-only', // transform not exported
  overflow: 'preview-only' // general CSS overflow; LVGL clips children to bounds by default instead
}

// Representative style fragment that should make styleSetCalls emit each 'emitted' property.
// Some need a companion (e.g. a shadow color only emits when there's a shadow width).
const EMIT_FRAGMENTS: Partial<Record<keyof UiWidgetStyle, Partial<UiWidgetStyle>>> = {
  background: { background: '#ff0000' },
  backgroundGradient: { backgroundGradient: { to: '#00ff00', direction: 'horizontal' } },
  backgroundImage: { backgroundImage: 'img1' },
  backgroundOpacity: { backgroundOpacity: 40 },
  borderColor: { borderColor: '#112233', borderWidth: 2 },
  borderOpacity: { borderOpacity: 40 },
  borderRadius: { borderRadius: 8 },
  borderWidth: { borderWidth: 3 },
  color: { color: '#ff0000' },
  opacity: { opacity: 40 },
  textOpacity: { textOpacity: 40 },
  fontSize: { fontSize: 30 },
  letterSpacing: { letterSpacing: 2 },
  lineHeight: { lineHeight: 4 },
  underline: { underline: true },
  strikethrough: { strikethrough: true },
  textAlign: { textAlign: 'center' },
  paddingTop: { paddingTop: 7 },
  paddingBottom: { paddingBottom: 7 },
  paddingLeft: { paddingLeft: 7 },
  paddingRight: { paddingRight: 7 },
  gap: { gap: 6 },
  flexDirection: { flexDirection: 'row' },
  justifyContent: { justifyContent: 'center' },
  alignItems: { alignItems: 'center' },
  shadowWidth: { shadowWidth: 10 },
  shadowColor: { shadowWidth: 10, shadowColor: '#000000' },
  shadowOffsetX: { shadowWidth: 10, shadowOffsetX: 4 },
  shadowOffsetY: { shadowWidth: 10, shadowOffsetY: 4 },
  elevation: { elevation: 6 },
  glowRadius: { glowRadius: 8 },
  glowColor: { glowRadius: 8, glowColor: '#00ffff' }
}

const IDENT = new Map<string, string>([['img1', 'asset_img1']])
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

// 2. EMISSION — every 'emitted' key produces at least one real lv_style_set_* call.
for (const key of Object.keys(CLASSIFICATION) as (keyof UiWidgetStyle)[]) {
  if (CLASSIFICATION[key] !== 'emitted') continue
  const fragment = EMIT_FRAGMENTS[key]
  check(`emit-fragment-defined:${key}`, !!fragment, 'no EMIT_FRAGMENTS entry — add one')
  if (!fragment) continue
  const lines = styleSetCalls('s', fragment, IDENT)
  check(`emits-lv_style_set:${key}`, lines.some((l) => l.includes('lv_style_set_')), `styleSetCalls produced no lv_style_set_* line for ${JSON.stringify(fragment)}`)
}

// 3. CONVERSION — value math matches what the preview implies.
const opa = styleSetCalls('s', { opacity: 40 }, IDENT).join('\n')
check('opacity 40 -> 102 (0-255)', opa.includes('lv_style_set_opa(&s, 102)'), opa)

const font = styleSetCalls('s', { fontSize: 30 }, IDENT).join('\n')
check(`fontSize 30 -> nearest montserrat ${nearestMontserratSize(30)}`, font.includes(`lv_font_montserrat_${nearestMontserratSize(30)}`), font)

const pad = styleSetCalls('s', { paddingTop: 7 }, IDENT).join('\n')
check('paddingTop 7 -> pad_top 7', pad.includes('lv_style_set_pad_top(&s, 7)'), pad)

const col = styleSetCalls('s', { color: '#ff0000' }, IDENT).join('\n').toLowerCase()
check('color #ff0000 -> text_color 0xff0000', col.includes('text_color') && col.includes('0xff0000'), col)

// Report
const cats = new Map<Category, number>()
for (const c of Object.values(CLASSIFICATION)) cats.set(c, (cats.get(c) ?? 0) + 1)
console.log('UI style parity — property classification:')
for (const [c, n] of [...cats.entries()].sort()) console.log(`  ${String(c).padEnd(18)} ${n}`)
const previewOnly = (Object.keys(CLASSIFICATION) as (keyof UiWidgetStyle)[]).filter((k) => CLASSIFICATION[k] === 'preview-only')
console.log(`\nDocumented preview-only (shown in Studio, not reproduced on device): ${previewOnly.join(', ')}`)

if (failures.length > 0) {
  console.error(`\nFAIL — ${failures.length} parity check(s) failed:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`\nPASS — every emitted style property maps through and value conversions match (${Object.keys(CLASSIFICATION).length} properties classified).`)
