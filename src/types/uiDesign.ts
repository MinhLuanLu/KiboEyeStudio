// UI Design Mode — data model for the visual LVGL screen designer. Kept in its own file
// (rather than folded into the already-700+-line types/index.ts) since this feature's types
// alone run to several hundred lines. Re-exported from index.ts so `from '@/types'` imports
// keep working uniformly across the app.
//
// Storage shape: widgets live in a FLAT map (id -> UiWidget, each carrying parentId/childIds)
// rather than a nested tree, matching this codebase's existing convention for addressable
// collections (stickers, customPupilShapes are flat arrays with ids) and making Layers-panel
// lookups, Properties-panel edits, and Immer mutations by id far simpler than recursive tree
// walks. The nested-tree *view* is reconstructed only where actually needed (HTML
// serialization, the LVGL exporter's creation-order walk) — see lib/uiDesign/*.

export type UiWidgetType =
  | 'screen'
  | 'container'
  | 'button'
  | 'label'
  | 'image'
  | 'icon'
  | 'switch'
  | 'slider'
  | 'bar'
  | 'arc'
  | 'checkbox'
  | 'dropdown'
  | 'roller'
  | 'textarea'
  | 'list'
  | 'flex'
  | 'tabs'
  | 'spinner'
  | 'keyboard'
  | 'gauge'
  | 'led'
  | 'statusIndicator'
  | 'dataList'

/** HTML tag <-> widget type mapping, used by both the HTML serializer/parser (lib/uiDesign/
 * htmlSync.ts) and the Toolbox. 'container'/'flex' both serialize as <container> — flex is a
 * container with style.flexDirection set, not a distinct tag. */
export const UI_WIDGET_TAG: Record<UiWidgetType, string> = {
  screen: 'screen',
  container: 'container',
  button: 'button',
  label: 'label',
  image: 'img',
  icon: 'icon',
  switch: 'switch',
  slider: 'slider',
  bar: 'bar',
  arc: 'arc',
  checkbox: 'checkbox',
  dropdown: 'dropdown',
  roller: 'roller',
  textarea: 'textarea',
  list: 'list',
  flex: 'container',
  tabs: 'tabs',
  spinner: 'spinner',
  keyboard: 'keyboard',
  gauge: 'gauge',
  led: 'led',
  statusIndicator: 'status-indicator',
  dataList: 'data-list'
}

export const UI_WIDGET_LABELS: Record<UiWidgetType, string> = {
  screen: 'Screen',
  container: 'Container',
  button: 'Button',
  label: 'Label',
  image: 'Image',
  icon: 'Icon',
  switch: 'Switch',
  slider: 'Slider',
  bar: 'Progress Bar',
  arc: 'Arc',
  checkbox: 'Checkbox',
  dropdown: 'Dropdown',
  roller: 'Roller',
  textarea: 'Text Area',
  list: 'List',
  flex: 'Flex Layout',
  tabs: 'Tabs',
  spinner: 'Spinner',
  keyboard: 'Keyboard',
  gauge: 'Gauge',
  led: 'LED',
  statusIndicator: 'Status Indicator',
  dataList: 'Data List'
}

/** Widget kinds whose whole visual IS an image (use UiWidget.src) vs. kinds that can have an
 * image behind their existing content (use UiWidgetStyle.backgroundImage instead) — shared by
 * AssetManagerPanel.tsx's click-to-apply, Canvas.tsx's asset drag-drop, and
 * PropertiesPanel.tsx's background-image field, so the three stay in agreement about which
 * widget kinds support which. */
export const UI_SRC_IMAGE_WIDGETS: ReadonlySet<UiWidgetType> = new Set(['image', 'icon'])
/** Widget kinds a built-in LVGL symbol icon (UiWidget.iconSymbol) can attach to — button/label/
 * checkbox emit it as a prefix baked into their own text literal (see lvglExport.ts's
 * widgetTextLiteralWithIcon); the standalone `icon` widget emits it as the *entire* text literal
 * of its own `lv_label_create()` (see widgetCreateCalls' `'icon'` case) — LVGL has no dedicated
 * icon object, a symbol icon is just a label whose text happens to be one of the built-in
 * `LV_SYMBOL_*` glyphs, which is exactly why it already gets independently adjustable size (font
 * size) and color (text color) through the same generic style pipeline every label uses, on top
 * of the position/size every widget already has. */
export const UI_ICON_TEXT_WIDGETS: ReadonlySet<UiWidgetType> = new Set(['button', 'label', 'checkbox', 'icon'])
export const UI_BACKGROUND_IMAGE_WIDGETS: ReadonlySet<UiWidgetType> = new Set([
  'screen',
  'container',
  'flex',
  'button',
  'list',
  'tabs',
  'checkbox',
  'dropdown',
  'roller',
  'textarea',
  'switch',
  'slider',
  'bar',
  'arc',
  'spinner',
  'dataList'
])

/** Widget kinds offered in the Toolbox / droppable directly onto the canvas. 'screen' is
 * excluded — a screen is created via "New Screen", never dragged in as a child. */
export const UI_TOOLBOX_WIDGETS: UiWidgetType[] = [
  'container',
  'flex',
  'button',
  'label',
  'image',
  'icon',
  'switch',
  'slider',
  'bar',
  'arc',
  'checkbox',
  'dropdown',
  'roller',
  'textarea',
  'list',
  'tabs',
  'spinner',
  'keyboard',
  'gauge',
  'led',
  'statusIndicator',
  'dataList'
]

export type UiLengthValue = number | 'auto' | `${number}%`

/** Flat bag of every CSS-mapped style property this pass supports — all optional, unset means
 * "use the LVGL default for this widget kind". Mirrors the property list from the feature spec;
 * see lib/uiDesign/cssSync.ts CSS_TO_STYLE_MAP for the exact CSS-property <-> field mapping. */
export interface UiWidgetStyle {
  width?: UiLengthValue
  height?: UiLengthValue
  x?: number
  y?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  borderWidth?: number
  borderColor?: string
  borderRadius?: number
  background?: string
  backgroundGradient?: { to: string; direction: 'horizontal' | 'vertical' } | null
  opacity?: number // 0-100
  color?: string // text color
  fontFamily?: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  letterSpacing?: number
  textAlign?: 'left' | 'center' | 'right'
  shadowWidth?: number
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
  visible?: boolean
  zIndex?: number
  flexDirection?: 'row' | 'column'
  flexWrap?: boolean
  justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  alignItems?: 'start' | 'center' | 'end'
  gap?: number
  overflow?: 'visible' | 'hidden' | 'scroll'
  imageFit?: 'contain' | 'cover' | 'stretch'
  /** Asset id (see UiAsset) used as a background image — available on any widget kind (screen,
   * container/flex/list/tabs, button, ...), not just the dedicated Image widget. Reuses the
   * existing per-state style system (UiWidgetStateStyles) for free, so "different image per
   * button state" is just this field set inside states.pressed/disabled/focused, same as any
   * other style field — no separate "button image variants" concept needed. */
  backgroundImage?: string
  /** How the background image fills its box — maps to CSS background-size/-repeat/-position and
   * LVGL's lv_style_set_bg_img_* style props at export time (see lib/export/lvglExport.ts).
   * 'tile' repeats the image at its natural size instead of scaling it. */
  backgroundSize?: 'stretch' | 'fit' | 'fill' | 'center' | 'tile'
  /** Degrees, image/icon widgets only (LVGL's lv_img_set_angle) — a deliberately narrow addition
   * rather than general widget rotation (canvas-wide arbitrary rotation of any widget kind
   * remains out of scope, same as this project's other deferred canvas-editing features). */
  rotation?: number
  /** Zoom factor, 1 = natural size, image/icon widgets only (LVGL's lv_img_set_zoom, whose
   * native unit is 256 = 1.0x — converted at export time, see lib/export/lvglExport.ts). Set
   * by the scripting API's `image.setScale(...)`, same narrow image/icon-only scoping as
   * rotation above. */
  scale?: number

  // --- Advanced Style System (glow/elevation/glass) — all real LVGL v9 primitives, see
  // lib/export/lvglExport.ts's styleSetCalls() for the exact mapping. Nothing here simulates an
  // effect LVGL can't actually render; anything the spec asked for that LVGL genuinely can't do
  // (true 3D perspective, mesh gradients, bloom, ambient occlusion, real blur) was deliberately
  // left out rather than faked — see the "Advanced Style System..." plan for the full split.
  /** A soft, colored glow — a second, zero-offset shadow layer (LVGL only carries one shadow
   * part per style, so this and shadowWidth/Color both ultimately drive lv_style_set_shadow_*;
   * setting both is flagged by validateLvglExport.ts since only one wins). */
  glowColor?: string
  glowRadius?: number // 0-40px
  /** Material-style single knob (0-24) that derives shadowWidth/OffsetY/Color/opa automatically
   * — a convenience preset over the real shadow fields below, not a distinct rendering concept.
   * Ignored once shadowWidth is set explicitly (explicit shadow fields always win). */
  elevation?: number
  /** True glass-style translucency — real, distinct LVGL setters (lv_style_set_bg_opa/
   * border_opa), independent of the existing overall `opacity` (which also fades text/children). */
  backgroundOpacity?: number // 0-100
  borderOpacity?: number // 0-100
  /** A small derived-bundle convenience: 'glass' raises backgroundOpacity + adds a light border
   * highlight; 'soft' widens elevation into a low-opacity neumorphism-ish shadow; 'bevel'
   * approximates an edge highlight using the single borderColor LVGL actually has (no per-edge
   * border color exists in LVGL — documented approximation, see validateLvglExport.ts). Applying
   * this only pre-fills the underlying real fields above; it isn't itself exported. */
  surfaceStyle?: 'flat' | 'glass' | 'soft' | 'bevel'
}

/** Color-bearing UiWidgetStyle fields that can track a project theme token instead of (or in
 * addition to — the literal field always stays the fallback/last-applied value) a hardcoded hex
 * string. Kept as a side-table (UiWidget.themeTokens) rather than widening every color field's
 * type to a tagged union — far less invasive across colorLiteral()/styleToCss()/ColorField/
 * cssSync/htmlSync, all of which keep assuming a plain hex string. See lib/uiDesign/themes.ts's
 * resolveThemedStyle() for how a themed field's literal value gets overridden at read time. */
export type UiThemeableStyleField = 'background' | 'color' | 'borderColor' | 'shadowColor' | 'glowColor'

export type UiThemeId = 'light' | 'dark' | 'amoled' | 'material' | 'fluent' | 'apple' | 'gaming' | 'automotive' | 'cyberpunk' | 'custom'

/** One theme's named color palette — see lib/uiDesign/themes.ts's UI_THEMES table for the actual
 * per-theme values. Every named theme (including 'custom') resolves to one of these; 'custom'
 * reads from Project.uiDesign.customThemeTokens instead of a fixed table entry. */
export interface UiThemeTokens {
  background: string
  surface: string
  primary: string
  secondary: string
  text: string
  textMuted: string
  border: string
  accent: string
}

export type UiWidgetStateName = 'hover' | 'pressed' | 'disabled' | 'focused'

export interface UiWidgetStateStyles {
  hover?: Partial<UiWidgetStyle>
  pressed?: Partial<UiWidgetStyle>
  disabled?: Partial<UiWidgetStyle>
  focused?: Partial<UiWidgetStyle>
}

export interface UiWidgetEvent {
  trigger: 'click' | 'valueChanged' | 'longPress'
  handlerName: string
}

/** One row inside a `list`-type widget's `listItems` — LVGL's real `lv_list_add_button()` API,
 * not a generic child widget (a `list` widget's own `childIds` stays unused going forward; see
 * lvglExport.ts's `listItemCreateCalls()`/`emitListItemClickCallback()`). `id` is an internal,
 * never-exported React key (regenerated on duplicate/seed so two items never collide); `widgetId`
 * is the user-facing, exported identity — it's the literal string passed to `Project_Register()`
 * and looked up via `find_<screen>_widget()`, kept exactly as typed (not sanitized) so it stays
 * stable and predictable, while the *generated C++ variable name* derived from it is separately
 * sanitized at export time (see `toCIdentifier`). */
export interface UiListItem {
  id: string
  widgetId: string
  text: string
  iconSymbol: string | null
  clickEventEnabled: boolean
  encoderFocusEnabled: boolean
}

export type UiKeyboardLanguage = 'english' | 'danish' | 'custom'
export type UiKeyboardCase = 'lower' | 'upper'
export type UiKeyboardPage = 'letters' | 'numbers' | 'symbols'

/** One base key's long-press variant set, e.g. `{ base: 'a', variants: ['á','à','â','ä'] }` —
 * see lib/uiDesign/keyboardLayouts.ts's DEFAULT_ALT_CHARS for the built-in English table. Danish's
 * æ/ø/å are deliberately never alt-chars (they're direct keys in the Danish layout instead). */
export interface UiKeyboardAltCharSet {
  base: string
  variants: string[]
}

/** One key in a `language: 'custom'` keyboard's hand-authored layout — `insertText` is what gets
 * typed (usually equal to `label`, but lets a key show e.g. "123" while inserting nothing, for a
 * mode-switch-style custom key). Stored as a flat, orderable list (not rows-of-rows) — `newRow`
 * marks a key as starting a new row, the same "one flat reorderable array" shape as `UiListItem`,
 * so the Properties panel's custom-layout editor can reuse the exact same drag-reorder row
 * component instead of needing nested-array reorder logic. */
export interface UiKeyboardCustomKey {
  id: string
  label: string
  insertText: string
  widthUnits?: number
  newRow?: boolean
}

export interface UiKeyboardCustomLayout {
  keys: UiKeyboardCustomKey[]
}

/** How a keyboard's rows lay themselves out relative to the project's display shape — see
 * lib/uiDesign/keyboardAdaptiveLayout.ts for the actual row/spacer-fraction algorithm.
 * 'rectangular': today's plain full-width rows, always, regardless of display shape (the
 * default for every keyboard saved before this feature existed — see normalizeKeyboardConfig).
 * 'adaptive': automatically curves rows to follow a round display's shape; a no-op (same as
 * 'rectangular') on a non-round display. 'round': always applies the round-display curving
 * algorithm even on a non-round display (mostly useful for previewing/authoring against a future
 * display swap). 'custom': uses the fixed edgePadding values below instead of any automatic
 * ellipse math. */
export type UiKeyboardShape = 'rectangular' | 'adaptive' | 'round' | 'custom'

/** Only meaningful when `shape === 'custom'` (fixed manual padding) — every other shape computes
 * its own spacer fractions automatically and ignores leftCurve/rightCurve/top/bottom, but
 * `safeAreaMargin`/`autoEdgeCompensation` apply to the automatic shapes too (see
 * keyboardAdaptiveLayout.ts). Units are the same display-local px every other widget/style field
 * in this project already uses. */
export interface UiKeyboardEdgePadding {
  leftCurve: number
  rightCurve: number
  top: number
  bottom: number
  /** Extra inward erosion applied to the display's safe ellipse before computing chord widths —
   * a small safety margin so keys don't sit flush against the physical display edge. */
  safeAreaMargin: number
  /** Reserved for a future "auto-tune padding when the display changes" pass — currently just
   * gates the Properties panel's "Use suggested values" button from silently overwriting fields
   * the user has already hand-edited (see PropertiesPanel.tsx's KeyboardSection). */
  autoEdgeCompensation: boolean
}

/** Only meaningful when `UiWidget.type === 'keyboard'`. A keyboard widget is always created
 * alongside two sibling widgets (see store.ts's addUiWidget) — a `'textarea'` output/input area
 * (`targetTextareaId`) and an optional `'label'` debug/event-info panel (`debugLabelId`); this
 * config is what links the three together and holds everything genuinely keyboard-specific.
 * Purely visual/positional properties (background, border, font, size, position, key/row
 * spacing, pressed/focused states) deliberately live in the widget's own existing `style`/
 * `states` instead of being duplicated here — see lvglExport.ts's keyboard codegen comment for
 * the full reasoning. */
export interface UiKeyboardConfig {
  targetTextareaId: string | null
  debugLabelId: string | null
  title: string

  language: UiKeyboardLanguage
  defaultCase: UiKeyboardCase
  defaultPage: UiKeyboardPage
  showLanguageSwitchKey: boolean
  /** Defaults true when language === 'danish'; lets a Danish keyboard's æ/ø/å keys be hidden
   * without switching language entirely (spec's own separate toggle). */
  danishCharsEnabled: boolean
  /** language === 'custom' only. */
  customLayout: UiKeyboardCustomLayout | null

  altCharsEnabled: boolean
  /** null = use the built-in DEFAULT_ALT_CHARS table (keyboardLayouts.ts). */
  customAltChars: UiKeyboardAltCharSet[] | null

  autoOpen: boolean
  autoCloseOnSubmit: boolean

  /** Master toggle for the linked debug label's content — the individual show* flags below only
   * matter when this is true. */
  showEventInfo: boolean
  showSelectedCharacter: boolean
  showCursorPosition: boolean
  showCallbackName: boolean
  showCurrentAction: boolean

  encoderEnabled: boolean
  wrapNavigation: boolean
  repeatBackspace: boolean
  repeatDelayMs: number

  /** -> project.uiDesign.customFonts[].id — see UiCustomFont. null = the project's default font
   * (LVGL's built-in Montserrat, no Danish glyphs). */
  customFontId: string | null

  shape: UiKeyboardShape
  edgePadding: UiKeyboardEdgePadding
}

// Indicator widgets — Gauge/LED/Status Indicator + the animation-loop config shared by
// bar/slider/arc/gauge/led. All of this lives in UiWidget.props (the existing loosely-typed
// Record<string, string|number|boolean> bag — see UiWidget.props' own doc comment) rather than
// as dedicated typed fields, matching how min/max/value already live there for bar/slider/arc;
// these type aliases exist purely so UI code (Properties panel, WidgetRenderer, lvglExport) has a
// single shared vocabulary instead of re-typing the string-literal unions everywhere.
export type UiStatusIndicatorState = 'online' | 'offline' | 'busy' | 'error' | 'warning' | 'success' | 'loading'
export type UiLedState = 'off' | 'on' | 'blink' | 'flash' | 'pulse'
/** Reuses the exact 6-value easing vocabulary already established by the general-purpose
 * `.animate()` script action (see scriptLang/sandboxRuntime.ts's EASINGS table) — deliberately
 * the same names so authors don't have to learn two different easing vocabularies. */
export type UiIndicatorEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bounce' | 'overshoot'
/** Tri-state checkbox value — LVGL has no real indeterminate checkbox state (confirmed against
 * v9.2.0 source), so this is real in the editor/preview but export approximates it as unchecked
 * with an explicit validateLvglExport.ts warning, never a silent drop. */
export type UiCheckedValue = boolean | 'indeterminate'

// Data List — repeats a user-designed item-template subtree (the widget's own `childIds`, authored
// with the same tools as any other widget tree) once per row of a bound UiDataSource. See
// lib/export/lvglExport.ts's "Data List codegen" section and WidgetRenderer.tsx's dataList
// rendering branch — both read this same config so preview/export can't disagree about which
// source/empty-text/etc. is active.
export type UiDataListRenderingMode = 'createAll' // reserved: 'recycle' | 'paginate' — not implemented

export interface UiDataListConfig {
  dataSourceId: string | null
  emptyText: string
  loadingText: string
  errorText: string
  /** 0 = unlimited. */
  maxItems: number
  renderingMode: UiDataListRenderingMode
  itemClickEnabled: boolean
  /** Vertical gap (px) between repeated rows — matches the real LVGL `lv_obj_set_style_pad_row`
   * on the list's own column-flex container (see lvglExport.ts's 'dataList' widgetCreateCalls
   * case), and the same value drives the canvas preview's row-clone offset (see
   * WidgetRenderer.tsx's DataListRepeatedRows) so the two can't disagree. Default 4, matching the
   * hardcoded gap this used before it was configurable. */
  itemSpacing: number
  /** "Include sample data in export" — off by default, so production firmware never silently
   * ships the Data Source Manager's design-time sample rows. When on, the bound data source's
   * sample array is emitted as a literal C++ array and passed to a one-time SetItems() call
   * inside the screen's own create function — a quick way to see real rows without writing
   * application code yet, explicitly opt-in per the spec's own "must not depend on hardcoded
   * editor-only demonstration items" requirement. */
  includeSampleDataInExport: boolean
}

export interface UiWidget {
  id: string
  type: UiWidgetType
  parentId: string | null
  childIds: string[]
  /** HTML id="..." — also becomes the exported LVGL `CreateXxx()` function name when set. */
  tagId?: string
  /** HTML class="..." (space-separated in source, stored split). */
  classNames: string[]
  /** Label/button text, textarea placeholder, list item text, etc. */
  text?: string
  /** Asset id reference for image/icon widgets — see UiAsset. */
  src?: string
  /** Built-in LVGL symbol-font macro (e.g. "LV_SYMBOL_WIFI") shown alongside `text` — see
   * lib/uiDesign/lvglSymbols.ts for the full list and lvglExport.ts's
   * widgetTextLiteralWithIcon() for how the two combine into one `LV_SYMBOL_WIFI " Wi-Fi"`
   * C string. null/undefined = no icon. Only meaningful on widgets that render `text`
   * (button/label/checkbox today). */
  iconSymbol?: string | null
  /** Widget-kind-specific data: slider min/max/value, dropdown/roller options, checkbox
   * checked, arc angles, tabs names, etc. Loosely typed (not one interface per widget kind)
   * to keep the model flat — see lib/uiDesign/widgetDefaults.ts for the shape each kind uses.
   * `'textarea'` widgets additionally use: `multiline` (boolean), `passwordMode` (boolean),
   * `readOnly` (boolean), `maxLength` (number, 0 = unlimited), `cursorColor`/`selectionColor`
   * (hex strings, optional — map to LVGL's real `LV_PART_CURSOR`/`LV_PART_SELECTED` style
   * parts, see lvglExport.ts's textarea codegen). */
  props: Record<string, string | number | boolean>
  /** Only meaningful when `type === 'list'` — the widget's real content (LVGL `lv_list_add_button()`
   * rows), managed entirely through the Properties panel's List Items editor. undefined/empty on
   * every other widget kind. */
  listItems?: UiListItem[]
  /** Only meaningful when `type === 'keyboard'` — see UiKeyboardConfig. */
  keyboardConfig?: UiKeyboardConfig
  /** Only meaningful when `type === 'dataList'` — see UiDataListConfig. */
  dataListConfig?: UiDataListConfig
  /** Only meaningful on a descendant of a `dataList` widget's template subtree (see
   * lib/export/lvglExport.ts's dataListTemplateDescendants/isDataListTemplateDescendant) — a
   * boolean expression (`item.<field>` / `data.<name>`, see scriptLang/templateExpr.ts) that
   * controls this widget's visibility per repeated row. Stored top-level (not in `props`) since
   * it's a narrow, typed field conditionally meaningful by tree position, not widget-kind data —
   * same reasoning as `iconSymbol`. undefined/empty = always visible (today's default behavior
   * for every widget that isn't inside a Data List template). */
  visibleWhenExpr?: string
  style: UiWidgetStyle
  states: UiWidgetStateStyles
  /** Which of this widget's own color fields (in `style`, default state only — per-state theming
   * is deliberately out of scope this pass) should track the project's active theme token instead
   * of their literal value — see UiThemeableStyleField's doc comment. undefined/empty = every
   * color field uses its literal hex as authored, today's exact behavior. */
  themeTokens?: Partial<Record<UiThemeableStyleField, keyof UiThemeTokens>>
  visible: boolean
  locked: boolean
  /** Escape hatch for the round-display soft-clamp (see renderer/displayMask.ts
   * clampRectToDisplayShape) — set when the user explicitly dismisses the out-of-bounds
   * warning for a widget that doesn't fit inside a circular display. */
  allowOutsideBounds: boolean
  events: UiWidgetEvent[]
  /** Auto-generated event callback (see EVENT_CAPABLE_WIDGET_TYPES in lvglExport.ts) — every
   * interactive widget gets a scaffolded `<var>_event_cb(lv_event_t* e)` with a
   * `switch (lv_event_get_code(e))` by default; set false here to opt a specific widget out.
   * Independent of the script-authored `.on(...)` events (Logic tab) and the legacy `events`
   * array above — real bodies from either of those are folded into this same callback's switch
   * automatically, they never produce a second function. */
  eventCallbackEnabled?: boolean
  /** Which LVGL event codes the auto-generated callback's switch actually handles (see the
   * Properties panel's Events section) — empty/undefined means "no specific selection", which
   * still registers via LV_EVENT_ALL but only emits a `default:` case (fill in your own
   * `lv_event_get_code(e)` check). Values are this app's existing trigger vocabulary (see
   * EVENT_OPTIONS in PropertiesPanel.tsx), restricted to the subset LV_EVENT_ALL scaffolding
   * makes sense for: click/pressed/released/longPress/valueChanged/focused/unfocused/scroll. */
  eventCallbackTriggers?: string[]
}

/** A CSS rule as authored — selector is intentionally restricted to a single simple tag/
 * .class/#id token (no combinators, no specificity beyond source order/last-rule-wins) — see
 * lib/uiDesign/cssSync.ts for the parser that enforces this. */
export interface UiCssRule {
  id: string
  selector: string
  style: Partial<UiWidgetStyle>
  states: UiWidgetStateStyles
}

export interface UiAsset {
  id: string
  name: string
  dataUrl: string
  naturalWidth: number
  naturalHeight: number
  /** The originally-uploaded file's format ('png'|'jpg'|'svg'|'gif'|'bmp'|'webp'), for display
   * in the Asset Manager — every asset is normalized to a PNG data URL internally regardless
   * (see decodeUiImageAsset/decodeSvgAsset), so this is purely informational, not what's
   * actually stored/exported. File size isn't a separate stored field — it's derived from
   * `dataUrl.length` on the fly where shown, since it'd otherwise drift from the real value
   * whenever the asset is replaced. */
  sourceFormat: string
}

export interface UiScreen {
  id: string
  name: string
  rootWidgetId: string
  /** Manually-edited override of the "LVGL Code" panel's live-generated text for this screen —
   * see LvglCodePanel.tsx. null/undefined = show the freshly generated code (today's default,
   * always-regenerated behavior). Once set (via that panel's "Apply Changes" button), the panel
   * shows THIS text instead, surviving further visual-designer edits, mirroring how htmlSource/
   * cssSource freeze until the user re-syncs — see customCodeBaseline below for how staleness
   * against the design is detected. This is a Studio-side scratchpad only (matches the panel's
   * own existing "not a downloadable export" scope) — it is never read by generateLvglExport/
   * generateUiScreenExport, so it can't silently diverge from or break the real export output. */
  customCode?: string | null
  /** The live-generated code text captured at the moment customCode was last applied — compared
   * against the CURRENT live-generated text to detect "the design changed since you edited this"
   * (see LvglCodePanel.tsx's staleness banner). Kept in lockstep with customCode; both are
   * cleared together by "Reset to Generated Code". */
  customCodeBaseline?: string | null
}

// UI Design Mode's own display configuration — deliberately a completely separate object from
// Project.display (Eye Studio's). The two workspaces can legitimately target different physical
// panels on the same robot (e.g. round eyes + a separate rectangular status screen), and after
// this session's Home-Screen/independent-workspace redesign, one workspace's settings must never
// silently affect the other — see the "Nav" work in this project's history for why that split
// exists at the top level too.
export type UiDisplayShape = 'round' | 'square' | 'rectangle' | 'custom'
export type UiDisplayOrientation = 'portrait' | 'landscape'
export type UiDisplayRotation = 0 | 90 | 180 | 270

export interface UiDisplaySettings {
  width: number
  height: number
  shape: UiDisplayShape
  orientation: UiDisplayOrientation
  /** Firmware/driver-level presentation rotation (passed through to KIBO_DISPLAY_ROTATION in
   * the LVGL export) — NOT a visual transform of the design canvas. Widgets are always authored
   * directly in `width`x`height` (the logical/design resolution); this just tells the exported
   * config which physical direction the panel should present that logical resolution in. */
  rotation: UiDisplayRotation
}

export interface UiDisplayPreset {
  id: string
  label: string
  width: number
  height: number
  shape: UiDisplayShape
}

export const UI_DISPLAY_PRESETS: UiDisplayPreset[] = [
  { id: '240x240-round', label: '240 × 240 (Round)', width: 240, height: 240, shape: 'round' },
  { id: '240x240-square', label: '240 × 240 (Square)', width: 240, height: 240, shape: 'square' },
  { id: '320x240', label: '320 × 240', width: 320, height: 240, shape: 'rectangle' },
  { id: '320x480', label: '320 × 480', width: 320, height: 480, shape: 'rectangle' },
  { id: '480x320', label: '480 × 320', width: 480, height: 320, shape: 'rectangle' },
  { id: '480x480', label: '480 × 480 (Square)', width: 480, height: 480, shape: 'square' }
]

export const DEFAULT_UI_DISPLAY: UiDisplaySettings = {
  width: 240,
  height: 240,
  shape: 'round',
  orientation: 'portrait',
  rotation: 0
}

export type UiVariableType = 'number' | 'text' | 'boolean' | 'color' | 'list' | 'image' | 'object'
export type UiVariableScope = 'global' | 'screen' | 'component' | 'sensor' | 'api' | 'hardware'

/** A named piece of data ("Temperature", "Brightness", "Light Enabled", ...) that widget
 * bindings/actions/conditions can read and write — the Variable Manager's own entries. Unlike
 * `script` (the sole source of truth for BEHAVIOR — see its own doc comment below), variables
 * really are a second, structured, persisted model: a Variable Manager table needs a declared
 * name/type/scope/default *before* anything can reference it, which can't be inferred for free
 * from arbitrary script text the way Events/Bindings' patterns can. To avoid this becoming a
 * competing "source of truth" for a variable's actual VALUE, the live sandbox exposes each of
 * these through one `data` object (`data.temperature`, ...) backed directly by the same store
 * state the Variable Manager table shows — script and Variable Manager always read/write the
 * exact same live value, never a copy (see lib/uiDesign/scriptLang/sandboxRuntime.ts). */
export interface UiVariable {
  id: string
  name: string
  type: UiVariableType
  scope: UiVariableScope
  /** Set when scope is 'screen' or 'component' — which screen/widget this variable belongs to.
   * Purely organizational (which screen's/widget's section of the Variable Manager table it
   * shows under) — every variable is reachable from anywhere in the script/every screen via
   * `data.<name>` regardless of scope; scope doesn't gate visibility. */
  screenId?: string
  componentId?: string
  defaultValue: string | number | boolean
  min?: number
  max?: number
  unit?: string
  /** e.g. `"{value}°C"` — `{value}` is replaced with the current (formatted) value. Used by
   * Data Binding's text rendering (see visualBindings.ts). */
  format?: string
  fallback?: string | number | boolean
}

export type UiDataSourceFieldType = 'int' | 'double' | 'bool' | 'string'

export interface UiDataSourceField {
  id: string
  /** Becomes the generated C++ struct member name (sanitized via toCIdentifier at export time —
   * stored here exactly as typed, matching UiListItem.widgetId's "sanitize at export, not at
   * rest" precedent). */
  name: string
  type: UiDataSourceFieldType
}

/** Purely descriptive/documentation — shown in the Data Source Manager's picker and the exported
 * README's guidance text. Does NOT branch codegen: every source kind ultimately feeds the exact
 * same generated SetItems()/AddItem() API (see lib/export/lvglExport.ts's Data List codegen), so
 * this is deliberately NOT a discriminant for different code paths — the same "don't build 13
 * shallow paths when one real one covers them all" call this project has made repeatedly. */
export type UiDataSourceKind =
  | 'static' | 'cppArray' | 'cppStructArray' | 'stdArray' | 'stdVector'
  | 'jsonObject' | 'jsonArray' | 'httpResponse' | 'mqttPayload' | 'sensorValue'
  | 'appVariable' | 'callbackFunction' | 'custom'

/** A reusable, named data source — a field schema (-> a generated C++ struct) plus hand-authored
 * sample JSON used only for design-time preview (see lib/export/lvglExport.ts's
 * dataSourceStructName()/emitDataListStructDecl() for how `fields` becomes real C++, and
 * WidgetRenderer.tsx's Data List rendering for how `sampleData` drives the canvas). At runtime the
 * generated `<var>_SetItems(...)`/`<var>_AddItem(...)` API replaces this sample data entirely —
 * sample data is never baked into a production export. */
export interface UiDataSource {
  id: string
  name: string
  sourceKind: UiDataSourceKind
  fields: UiDataSourceField[]
  /** -> fields[].id. Authored/validated (see validateLvglExport.ts) but not used for codegen
   * addressing this pass — the generated API stays index-based (AddItem/UpdateItem/RemoveItem/
   * OnItemClicked(index, item)); reserved for a future FindIndexByKey() convenience. */
  keyFieldId: string | null
  /** Raw JSON array text, hand-edited in the Data Source Manager panel — parsed on demand
   * (JSON.parse), never persisted pre-parsed, so a parse-error display always reflects exactly
   * the saved text. */
  sampleData: string
  /** Escape hatch for when the auto-derived struct name (see dataSourceStructName(), a simple
   * trailing-'s' strip of the source name — "Notifications" -> "NotificationItem") is wrong. */
  structNameOverride?: string
}

/** A user-imported LVGL v9 bitmap font, already converted to C source by LVGL's own official
 * online font converter (https://lvgl.io/tools/fontconverter) — this project does no font
 * rasterization of its own, it only stores/embeds/references what's pasted in. `declaredCodepoints`
 * is parsed once at import time by text-scanning the pasted source's own declared unicode-range/
 * list tables (not a real font parser — see lib/uiDesign/fontImport.ts), purely so the Properties
 * panel and export validation can warn when a keyboard needs Danish glyphs (æ/ø/å/Æ/Ø/Å =
 * U+00E6/00F8/00E5/00C6/00D8/00C5) a selected font doesn't declare. */
export interface UiCustomFont {
  id: string
  name: string
  cSource: string
  declaredCodepoints: number[]
}

export interface UiDesignProject {
  widgets: Record<string, UiWidget>
  screens: UiScreen[]
  activeScreenId: string | null
  css: UiCssRule[]
  assets: UiAsset[]
  customFonts: UiCustomFont[]
  variables: UiVariable[]
  dataSources: UiDataSource[]
  display: UiDisplaySettings
  /** The project's active color theme — see lib/uiDesign/themes.ts's UI_THEMES table. Only
   * affects widgets that opt a color field into theming via UiWidget.themeTokens; every other
   * widget's literal hex colors are completely unaffected by this field, so switching themes on
   * a project that uses no tokens is a visual no-op (today's exact behavior, preserved). */
  theme: UiThemeId
  /** Only meaningful when `theme === 'custom'` — the user-edited palette used in place of a
   * fixed UI_THEMES table entry. null while `theme !== 'custom'`. */
  customThemeTokens: UiThemeTokens | null
  /** Regenerated text mirrors of the widget tree / css rules — see lib/uiDesign/htmlSync.ts
   * and cssSync.ts. Source of truth flows whichever direction was edited last (full
   * regenerate each way, not incremental patching); both are persisted so a reopened project
   * shows the exact text the user last had in the editors. */
  htmlSource: string
  cssSource: string
  /** The JS-like behavior script — see lib/uiDesign/scriptLang/. Unlike htmlSource/cssSource,
   * this is the ONE source of truth for behavior (not a regenerated mirror of some other
   * model) — the visual Events/Actions editor in PropertiesPanel is a structured view over
   * recognizable patterns in this text, edited via precise text splices, never a parallel
   * data model. See scriptLang/restrictedSubset.ts for exactly what subset of JS is supported. */
  script: string
}
