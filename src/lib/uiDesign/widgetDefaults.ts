import { nanoid } from 'nanoid'
import { DEFAULT_UI_DISPLAY } from '@/types'
import type { UiDesignProject, UiScreen, UiWidget, UiWidgetStyle, UiWidgetType } from '@/types'

/** Per-kind default `props` (widget-specific data — see UiWidget.props doc comment) and a
 * starting size for widgets placed with no explicit size (e.g. dropped from the Toolbox). */
const WIDGET_DEFAULTS: Record<
  UiWidgetType,
  { width: number; height: number; props?: Record<string, string | number | boolean>; text?: string; style?: Partial<UiWidgetStyle> }
> = {
  screen: { width: 240, height: 240 },
  container: { width: 100, height: 60 },
  flex: { width: 200, height: 80, style: { flexDirection: 'row', gap: 6, alignItems: 'center' } },
  button: { width: 100, height: 40, text: 'Button' },
  label: { width: 80, height: 20, text: 'Label' },
  image: { width: 64, height: 64 },
  icon: { width: 24, height: 24, text: '', style: { fontSize: 24 } },
  switch: { width: 40, height: 20 },
  slider: { width: 120, height: 12, props: { min: 0, max: 100, value: 50 } },
  bar: { width: 120, height: 12, props: { min: 0, max: 100, value: 40 } },
  arc: { width: 80, height: 80, props: { min: 0, max: 100, value: 25 } },
  checkbox: { width: 100, height: 20, text: 'Checkbox', props: { checked: false } },
  dropdown: { width: 100, height: 32, props: { options: 'Option 1\nOption 2\nOption 3' } },
  roller: { width: 100, height: 60, props: { options: 'Option 1\nOption 2\nOption 3' } },
  textarea: { width: 140, height: 60, props: { placeholder: 'Enter text...' } },
  list: { width: 140, height: 100 },
  tabs: { width: 200, height: 120, props: { tabNames: 'Tab 1\nTab 2' } },
  spinner: { width: 32, height: 32 }
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
    events: []
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
    variables: [],
    display: { ...DEFAULT_UI_DISPLAY },
    htmlSource: '<screen>\n</screen>\n',
    cssSource: '',
    script: ''
  }
}
