import { nanoid } from 'nanoid'
import { DEFAULT_UI_DISPLAY } from '@/types'
import type { UiDataListConfig, UiDesignProject, UiKeyboardConfig, UiListItem, UiScreen, UiWidget, UiWidgetStyle, UiWidgetType } from '@/types'

/** A fresh `UiDataListConfig` for a newly-dropped Data List widget — no data source assigned yet
 * (the user picks one in the Properties panel's Data section); the template subtree is built
 * with the ordinary widget-editing tools (see UiWidgetType='dataList' doc comment), so unlike
 * `defaultKeyboardConfig()` there's no linked-sibling-widget bookkeeping needed here. */
export function defaultDataListConfig(): UiDataListConfig {
  return {
    dataSourceId: null,
    emptyText: 'No items',
    loadingText: 'Loading…',
    errorText: 'Something went wrong',
    maxItems: 0,
    renderingMode: 'createAll',
    itemClickEnabled: true,
    includeSampleDataInExport: false,
    itemSpacing: 4
  }
}

/** A fresh `UiKeyboardConfig` for a newly-dropped keyboard widget — `targetTextareaId`/
 * `debugLabelId` are filled in by store.ts's `addUiWidget`, which is what actually creates the
 * linked sibling widgets (a widgetDefaults-level default can't know their ids yet). */
export function defaultKeyboardConfig(): UiKeyboardConfig {
  return {
    targetTextareaId: null,
    debugLabelId: null,
    title: 'Keyboard',
    language: 'english',
    defaultCase: 'lower',
    defaultPage: 'letters',
    showLanguageSwitchKey: true,
    danishCharsEnabled: false,
    customLayout: null,
    altCharsEnabled: true,
    customAltChars: null,
    autoOpen: false,
    autoCloseOnSubmit: false,
    showEventInfo: true,
    showSelectedCharacter: true,
    showCursorPosition: true,
    showCallbackName: true,
    showCurrentAction: true,
    encoderEnabled: true,
    wrapNavigation: true,
    repeatBackspace: true,
    repeatDelayMs: 350,
    customFontId: null,
    // 'adaptive' out of the box — a keyboard dropped onto a round display curves automatically
    // with zero extra clicks. Old saved keyboards are backfilled to 'rectangular' instead (see
    // persistence.ts's normalizeKeyboardConfig) so no previously-exported project's appearance or
    // generated code changes just from opening it again.
    shape: 'adaptive',
    edgePadding: { leftCurve: 0, rightCurve: 0, top: 0, bottom: 0, safeAreaMargin: 6, autoEdgeCompensation: true }
  }
}

/** Per-kind default `props` (widget-specific data — see UiWidget.props doc comment) and a
 * starting size for widgets placed with no explicit size (e.g. dropped from the Toolbox). */
const WIDGET_DEFAULTS: Record<
  UiWidgetType,
  {
    width: number
    height: number
    props?: Record<string, string | number | boolean>
    text?: string
    style?: Partial<UiWidgetStyle>
    listItems?: Omit<UiListItem, 'id'>[]
    keyboardConfig?: UiKeyboardConfig
    dataListConfig?: UiDataListConfig
  }
> = {
  screen: { width: 240, height: 240 },
  container: { width: 100, height: 60 },
  flex: { width: 200, height: 80, style: { flexDirection: 'row', gap: 6, alignItems: 'center' } },
  button: { width: 100, height: 40, text: 'Button' },
  label: { width: 80, height: 20, text: 'Label' },
  image: { width: 64, height: 64, style: { imageFit: 'contain' } },
  icon: { width: 24, height: 24, text: '', style: { fontSize: 24 } },
  switch: { width: 40, height: 20 },
  // `defaultValue` is captured once at creation time from the authored `value` — the "Reset"
  // action (see actionTable.ts) sets the widget back to this, not to `min`, so resetting a bar
  // someone deliberately authored at 40% doesn't silently jump to 0.
  slider: { width: 120, height: 12, props: { min: 0, max: 100, value: 50, defaultValue: 50 } },
  bar: { width: 120, height: 12, props: { min: 0, max: 100, value: 40, defaultValue: 40 } },
  arc: { width: 80, height: 80, props: { min: 0, max: 100, value: 25, defaultValue: 25 } },
  checkbox: { width: 100, height: 20, text: 'Checkbox', props: { checked: false } },
  dropdown: { width: 100, height: 32, props: { options: 'Option 1\nOption 2\nOption 3' } },
  roller: { width: 100, height: 60, props: { options: 'Option 1\nOption 2\nOption 3' } },
  textarea: { width: 140, height: 60, props: { placeholder: 'Enter text...' } },
  list: {
    width: 140,
    height: 100,
    listItems: [
      { widgetId: 'wifi_item', text: 'Wi-Fi', iconSymbol: 'LV_SYMBOL_WIFI', clickEventEnabled: true, encoderFocusEnabled: true },
      { widgetId: 'sound_item', text: 'Sound', iconSymbol: 'LV_SYMBOL_VOLUME_MAX', clickEventEnabled: true, encoderFocusEnabled: true }
    ]
  },
  tabs: { width: 200, height: 120, props: { tabNames: 'Tab 1\nTab 2' } },
  spinner: { width: 32, height: 32 },
  keyboard: { width: 220, height: 120, keyboardConfig: defaultKeyboardConfig() },
  // Real lv_scale + a built-in-positioned needle line (see lvglExport.ts's 'gauge' create case) —
  // angleRange/rotation 270/135 is the classic "opens at the bottom" automotive-gauge look.
  gauge: { width: 90, height: 90, props: { min: 0, max: 100, value: 50, defaultValue: 50, totalTicks: 21, majorTickEvery: 5, angleRange: 270, rotation: 135 } },
  // Real lv_led widget — color/brightness map directly to lv_led_set_color/set_brightness.
  led: { width: 20, height: 20, props: { ledColor: '#22C55E', brightness: 100, state: 'off' } },
  // status drives color/icon/glow/animation entirely via statusIndicatorPresets.ts's shared table
  // — no independent color/icon fields here, that's the whole point of "automatically updates".
  statusIndicator: { width: 90, height: 24, text: 'Online', props: { status: 'online' } },
  // Empty childIds — the item template is built with the ordinary widget-editing tools (drag
  // other widgets in as children); see WidgetRenderer.tsx's Data List rendering for how row 0
  // is that real, editable template and rows 1..N-1 are non-interactive preview clones.
  dataList: { width: 200, height: 140, dataListConfig: defaultDataListConfig() }
}

/** Creates a new widget of `type`, unattached (caller is responsible for setting parentId and
 * pushing the id into the parent's childIds — see uiDesignSlice's addWidget action). */
export function createWidget(type: UiWidgetType): UiWidget {
  const d = WIDGET_DEFAULTS[type]
  return {
    id: nanoid(10),
    type,
    parentId: null,
    childIds: [],
    classNames: [],
    text: d.text,
    props: { ...d.props },
    style: { width: d.width, height: d.height, x: 0, y: 0, ...d.style },
    states: {},
    visible: true,
    locked: false,
    allowOutsideBounds: false,
    events: [],
    // Fresh `id` per item even when seeded from the same default array, so two List widgets
    // (or two items copy-pasted from one) never share an internal React key.
    listItems: d.listItems ? d.listItems.map((item) => ({ ...item, id: nanoid(8) })) : undefined,
    // Cloned (not the shared module-level default object) so two keyboard widgets never mutate
    // each other's config — same reasoning as listItems' fresh-id-per-item above.
    keyboardConfig: d.keyboardConfig ? { ...d.keyboardConfig } : undefined,
    dataListConfig: d.dataListConfig ? { ...d.dataListConfig } : undefined
  }
}

/** Seeds a brand-new UiDesignProject with a single default Screen (matching how a brand-new
 * eye project always starts with one default expression/animation) — id, name, css, assets
 * all fresh so two default projects never collide. */
export function createDefaultUiDesign(): UiDesignProject {
  const root = createWidget('screen')
  const screen: UiScreen = { id: nanoid(10), name: 'Main Screen', rootWidgetId: root.id }
  return {
    widgets: { [root.id]: root },
    screens: [screen],
    activeScreenId: screen.id,
    css: [],
    assets: [],
    customFonts: [],
    variables: [],
    dataSources: [],
    display: { ...DEFAULT_UI_DISPLAY },
    theme: 'dark',
    customThemeTokens: null,
    htmlSource: '<screen>\n</screen>\n',
    cssSource: '',
    script: ''
  }
}
