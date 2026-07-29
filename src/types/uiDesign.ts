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
  spinner: 'spinner'
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
  spinner: 'Spinner'
}

/** Widget kinds whose whole visual IS an image (use UiWidget.src) vs. kinds that can have an
 * image behind their existing content (use UiWidgetStyle.backgroundImage instead) — shared by
 * AssetManagerPanel.tsx's click-to-apply, Canvas.tsx's asset drag-drop, and
 * PropertiesPanel.tsx's background-image field, so the three stay in agreement about which
 * widget kinds support which. */
export const UI_SRC_IMAGE_WIDGETS: ReadonlySet<UiWidgetType> = new Set(['image', 'icon'])
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
  'spinner'
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
  'spinner'
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
  /** Widget-kind-specific data: slider min/max/value, dropdown/roller options, checkbox
   * checked, arc angles, tabs names, etc. Loosely typed (not one interface per widget kind)
   * to keep the model flat — see lib/uiDesign/widgetDefaults.ts for the shape each kind uses. */
  props: Record<string, string | number | boolean>
  style: UiWidgetStyle
  states: UiWidgetStateStyles
  visible: boolean
  locked: boolean
  /** Escape hatch for the round-display soft-clamp (see renderer/displayMask.ts
   * clampRectToDisplayShape) — set when the user explicitly dismisses the out-of-bounds
   * warning for a widget that doesn't fit inside a circular display. */
  allowOutsideBounds: boolean
  events: UiWidgetEvent[]
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

export interface UiDesignProject {
  widgets: Record<string, UiWidget>
  screens: UiScreen[]
  activeScreenId: string | null
  css: UiCssRule[]
  assets: UiAsset[]
  display: UiDisplaySettings
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
