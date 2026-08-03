import type { UiAsset, UiWidget, UiWidgetStyle, UiWidgetType } from '@/types'

// The single shared table mapping a script-callable widget method name to (a) its live-preview
// effect and (b) its LVGL C++ codegen — used by BOTH sandboxRuntime.ts (preview) and codegen.ts
// (export), so the two can never drift (same "one shared implementation" precedent as
// renderer/pupilShapes.ts being read by both the studio renderer and the C++ exporter).
//
// A few methods (setSource, addClass, removeClass) need export-time context this table's simple
// (varName, args) => string[] shape doesn't carry (resolved asset/CSS-rule identifiers) — those
// are handled as special cases directly in codegen.ts (see CODEGEN_SPECIAL_METHODS below) rather
// than forcing an awkward extra context parameter onto every other entry.

export interface PreviewActionCtx {
  getWidget: (id: string) => UiWidget | undefined
  getAssets: () => UiAsset[]
  updateStyle: (id: string, partial: Partial<UiWidgetStyle>) => void
  updateText: (id: string, text: string) => void
  updateProps: (id: string, partial: Record<string, string | number | boolean>) => void
  setSrc: (id: string, assetId: string | null) => void
  deleteWidget: (id: string) => void
  updateMeta: (id: string, partial: { classNames?: string[] }) => void
  /** Runs `onFrame(v)` on every animation frame as `v` eases from `from` to `to` over
   * `durationMs`, for `.animateTo()`/`.animate()` — the one shared preview tween, so every
   * animated action (bar/slider value, x/y/opacity/scale) looks consistent. */
  tween: (from: number, to: number, durationMs: number, onFrame: (v: number) => void, onDone?: () => void) => void
  /** Bridges to the widget proxy's own richer `.animate({x,y,opacity,scale,duration,easing})` —
   * reused here so `playAnimation` (a positional-args ACTION_TABLE entry, needed so it shows up
   * in the visual Action dropdown) and the raw-script `.animate({...})` call share one preview
   * implementation. */
  animate: (id: string, config: { x?: number; y?: number; opacity?: number; scale?: number; duration?: number }) => void
  /** Looks up a top-level `function name(...) {...}` declared in the current script and calls it
   * with `args` if found; otherwise logs a warning (export still generates a named stub either
   * way — see codegen.ts's callFunction handling and userCodeMerge.ts). Backs the `callFunction`
   * action and every hardware-preset action (see HARDWARE_ACTION_PRESETS below), which are all
   * sugar over "call this named function." */
  callFunction: (name: string, args: unknown[]) => void
  /** Writes a Variable Manager entry's live value — the `updateVariable` action's preview
   * implementation, mirroring what `data.<name> = value` does in raw script (see
   * sandboxRuntime.ts's `data` object) so both paths agree. */
  updateVariable: (name: string, value: unknown) => void
}

export type ActionKind = 'mutate' | 'read'

export interface ActionSpec {
  appliesTo: UiWidgetType[] | 'any'
  kind: ActionKind
  /** Preview effect. For 'read' actions, the return value becomes the script's result value. */
  preview: (ctx: PreviewActionCtx, widgetId: string, args: unknown[]) => unknown
  /** 'mutate': emits statement(s). 'read': emits a single expression substituted where the call
   * appears (e.g. inside a VariableDeclarator init). `args` are already-rendered C++ expression
   * strings (codegen.ts turns AST argument nodes into text before calling in). */
  cpp?: (varName: string, args: string[], widgetType: UiWidgetType) => string[]
  cppExpr?: (varName: string, args: string[]) => string
}

/** Methods handled directly in codegen.ts instead of through ACTION_TABLE, because they need
 * export-time lookups (asset-name -> generated ident, class-name -> CSS-rule style ident) that
 * don't fit this table's plain (varName, args) => string[] shape. Still fully implemented for
 * both preview and export — just not through this dispatch table. */
export const CODEGEN_SPECIAL_METHODS: ReadonlySet<string> = new Set(['setSource', 'addClass', 'removeClass', 'callFunction', 'updateVariable'])

function numArg(args: unknown[], i: number, fallback = 0): number {
  const v = args[i]
  return typeof v === 'number' ? v : fallback
}
function strArg(args: unknown[], i: number, fallback = ''): string {
  const v = args[i]
  return typeof v === 'string' ? v : fallback
}
function boolArg(args: unknown[], i: number, fallback = false): boolean {
  const v = args[i]
  return typeof v === 'boolean' ? v : fallback
}

export const ACTION_TABLE: Record<string, ActionSpec> = {
  // ---- General (any widget) ----
  show: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateStyle(id, { visible: true }),
    cpp: (v) => [`lv_obj_remove_flag(${v}, LV_OBJ_FLAG_HIDDEN);`]
  },
  hide: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateStyle(id, { visible: false }),
    cpp: (v) => [`lv_obj_add_flag(${v}, LV_OBJ_FLAG_HIDDEN);`]
  },
  enable: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateProps(id, { disabled: false }),
    cpp: (v) => [`lv_obj_remove_state(${v}, LV_STATE_DISABLED);`]
  },
  disable: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateProps(id, { disabled: true }),
    cpp: (v) => [`lv_obj_add_state(${v}, LV_STATE_DISABLED);`]
  },
  delete: {
    appliesTo: 'any',
    kind: 'mutate',
    // Deletes the real widget for the remainder of this preview run — the Logic panel's Stop/
    // Restart controls restore the pre-run snapshot (see sandboxRuntime.ts), so this never
    // leaks into the saved design.
    preview: (ctx, id) => ctx.deleteWidget(id),
    cpp: (v) => [`lv_obj_delete(${v});`]
  },
  setOpacity: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateStyle(id, { opacity: numArg(args, 0, 100) }),
    cpp: (v, a) => [`lv_obj_set_style_opa(${v}, (lv_opa_t)((${a[0]}) * 255 / 100), LV_PART_MAIN);`]
  },
  setPosition: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateStyle(id, { x: numArg(args, 0), y: numArg(args, 1) }),
    cpp: (v, a) => [`lv_obj_set_pos(${v}, (${a[0]}), (${a[1]}));`]
  },
  setSize: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateStyle(id, { width: numArg(args, 0), height: numArg(args, 1) }),
    cpp: (v, a) => [`lv_obj_set_size(${v}, (${a[0]}), (${a[1]}));`]
  },

  // ---- Label / Button text+color ----
  setText: {
    appliesTo: ['label', 'button', 'checkbox', 'textarea'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateText(id, strArg(args, 0)),
    // Button's own label is a child object (${v}_label) rather than the button itself — see
    // codegen.ts's SET_TEXT_TARGET override, which supplies that suffix; every other kind here
    // sets text on the widget's own lv_obj_t directly.
    cpp: (v, a) => [`lv_label_set_text(${v}, (${a[0]}));`]
  },
  setColor: {
    appliesTo: ['label', 'button', 'checkbox'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateStyle(id, { color: strArg(args, 0) }),
    cpp: (v, a) => [`lv_obj_set_style_text_color(${v}, ${a[0]}, LV_PART_MAIN);`]
  },

  // ---- Button ----
  setEnabled: {
    appliesTo: ['button', 'checkbox', 'switch', 'slider', 'dropdown', 'roller', 'textarea'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { disabled: !boolArg(args, 0, true) }),
    cpp: (v, a) => [`if (${a[0]}) { lv_obj_remove_state(${v}, LV_STATE_DISABLED); } else { lv_obj_add_state(${v}, LV_STATE_DISABLED); }`]
  },
  setBackground: {
    appliesTo: ['button', 'container', 'flex', 'screen'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateStyle(id, { background: strArg(args, 0) }),
    cpp: (v, a) => [`lv_obj_set_style_bg_color(${v}, ${a[0]}, LV_PART_MAIN);`, `lv_obj_set_style_bg_opa(${v}, LV_OPA_COVER, LV_PART_MAIN);`]
  },

  // ---- Progress bar / Slider / Arc value ----
  setValue: {
    appliesTo: ['bar', 'slider', 'arc'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { value: numArg(args, 0) }),
    cpp: (v, a, t) => [`${valueSetCall(t)}(${v}, (${a[0]}), LV_ANIM_OFF);`]
  },
  getValue: {
    appliesTo: ['bar', 'slider', 'arc'],
    kind: 'read',
    preview: (ctx, id) => {
      const w = ctx.getWidget(id)
      return typeof w?.props.value === 'number' ? w.props.value : 0
    },
    cppExpr: (v) => `lv_bar_get_value(${v})` // overridden per-type in codegen.ts (get_value fn name differs by widget kind)
  },
  setRange: {
    appliesTo: ['bar', 'slider', 'arc'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { min: numArg(args, 0), max: numArg(args, 1) }),
    cpp: (v, a, t) => [`${rangeSetCall(t)}(${v}, (${a[0]}), (${a[1]}));`]
  },
  animateTo: {
    appliesTo: ['bar', 'slider', 'arc'],
    kind: 'mutate',
    preview: (ctx, id, args) => {
      const w = ctx.getWidget(id)
      const from = typeof w?.props.value === 'number' ? w.props.value : 0
      const to = numArg(args, 0)
      const duration = numArg(args, 1, 300)
      ctx.tween(from, to, duration, (v) => ctx.updateProps(id, { value: Math.round(v) }))
    },
    cpp: (v, a, t) => [
      `lv_obj_set_style_anim_duration(${v}, (uint32_t)(${a[1] ?? '300'}), LV_PART_MAIN | LV_STATE_DEFAULT);`,
      `${valueSetCall(t)}(${v}, (${a[0]}), LV_ANIM_ON);`
    ]
  },

  // ---- Image ----
  setRotation: {
    appliesTo: ['image', 'icon'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateStyle(id, { rotation: numArg(args, 0) }),
    cpp: (v, a) => [`lv_image_set_rotation(${v}, (int16_t)((${a[0]}) * 10));`]
  },
  setScale: {
    appliesTo: ['image', 'icon'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateStyle(id, { scale: numArg(args, 0, 1) }),
    cpp: (v, a) => [`lv_image_set_scale(${v}, (uint16_t)((${a[0]}) * 256));`]
  },

  // ---- State toggle (switch/checkbox) ----
  toggleState: {
    appliesTo: ['switch', 'checkbox'],
    kind: 'mutate',
    preview: (ctx, id) => {
      const w = ctx.getWidget(id)
      ctx.updateProps(id, { checked: !w?.props.checked })
    },
    cpp: (v) => [`if (lv_obj_has_state(${v}, LV_STATE_CHECKED)) { lv_obj_remove_state(${v}, LV_STATE_CHECKED); } else { lv_obj_add_state(${v}, LV_STATE_CHECKED); }`]
  },

  // ---- Play a position/opacity/scale animation, as a first-class dropdown action (the raw-
  // script `widget.animate({...})` object-literal call still works too, but can't appear in the
  // visual editor since its argument isn't a plain literal — this positional-args twin can). ----
  playAnimation: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, id, args) => {
      const [x, y, opacity, scale, duration] = args
      ctx.animate(id, {
        x: typeof x === 'number' ? x : undefined,
        y: typeof y === 'number' ? y : undefined,
        opacity: typeof opacity === 'number' ? opacity : undefined,
        scale: typeof scale === 'number' ? scale : undefined,
        duration: typeof duration === 'number' ? duration : 300
      })
    },
    cpp: (v, a) => {
      const [toX, toY, opacity, scale, duration] = a
      return [
        `{ static lv_anim_t a1; lv_anim_init(&a1); lv_anim_set_var(&a1, ${v}); lv_anim_set_exec_cb(&a1, (lv_anim_exec_xcb_t)lv_obj_set_x); lv_anim_set_values(&a1, lv_obj_get_x(${v}), (int32_t)(${toX})); lv_anim_set_duration(&a1, (uint32_t)(${duration})); lv_anim_start(&a1); }`,
        `{ static lv_anim_t a2; lv_anim_init(&a2); lv_anim_set_var(&a2, ${v}); lv_anim_set_exec_cb(&a2, (lv_anim_exec_xcb_t)lv_obj_set_y); lv_anim_set_values(&a2, lv_obj_get_y(${v}), (int32_t)(${toY})); lv_anim_set_duration(&a2, (uint32_t)(${duration})); lv_anim_start(&a2); }`,
        `lv_obj_set_style_opa(${v}, (lv_opa_t)((${opacity}) * 255 / 100), LV_PART_MAIN);`,
        `lv_image_set_scale(${v}, (uint16_t)((${scale}) * 256));`
      ]
    }
  },

  // ---- Update a Variable Manager entry — same "target widget unused, needs the raw literal
  // name" shape/reasoning as callFunction below, so this is a CODEGEN_SPECIAL_METHOD too. ----
  updateVariable: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, _id, args) => {
      const [name, value] = args
      if (typeof name === 'string' && name) ctx.updateVariable(name, value)
    }
  },

  // ---- Call a named custom function (also what every hardware/communication preset in
  // HARDWARE_ACTION_PRESETS below compiles down to) — the target widget is unused by this
  // action's own logic (kept only because every visual action is modeled as `ref.method(args)`,
  // see visualEvents.ts). Export needs the RAW literal function-name text (to build a C++
  // identifier) rather than an already-rendered/quoted C++ expression string, which is what
  // every other entry's `cpp(varName, args)` shape provides — so this is a CODEGEN_SPECIAL_METHOD
  // instead, handled directly in codegen.ts (see its callFunction branch), same reason
  // setSource/addClass/removeClass are special-cased there. Still fully implemented for preview
  // through this table, just not for export. ----
  callFunction: {
    appliesTo: 'any',
    kind: 'mutate',
    preview: (ctx, _id, args) => {
      const [name, ...rest] = args
      if (typeof name === 'string' && name) ctx.callFunction(name, rest)
    }
  }
}

export interface HardwareActionPreset {
  id: string
  label: string
  functionName: string
  argSpecs: { label: string; default: string | number | boolean }[]
}

/** "Send via Serial/WiFi/BLE/MQTT/HTTP/GPIO/I2C" and "control LEDs/relays/motors/servos/sensors/
 * buzzers" actions from the spec — this project has no real hardware/protocol access in-browser
 * (an already-established, repeated limitation — see the LVGL exporter's own TODO-stub display-
 * driver precedent), so every one of these is sugar over `callFunction`: picking a preset just
 * pre-fills a semantic function name + arg shape; the export step always generates that named
 * stub with USER CODE markers, same as a fully custom "Call custom function" action would. */
export const HARDWARE_ACTION_PRESETS: HardwareActionPreset[] = [
  { id: 'hw_gpio', label: 'Hardware: Set GPIO Pin', functionName: 'setGpioPin', argSpecs: [{ label: 'Pin', default: 0 }, { label: 'State (on/off)', default: true }] },
  { id: 'hw_serial', label: 'Hardware: Send Serial Message', functionName: 'sendSerialMessage', argSpecs: [{ label: 'Message', default: '' }] },
  { id: 'hw_servo', label: 'Hardware: Control Servo', functionName: 'controlServo', argSpecs: [{ label: 'Pin', default: 0 }, { label: 'Angle', default: 90 }] },
  { id: 'hw_motor', label: 'Hardware: Control Motor', functionName: 'controlMotor', argSpecs: [{ label: 'Speed (-100..100)', default: 0 }] },
  { id: 'hw_relay', label: 'Hardware: Control Relay', functionName: 'setRelay', argSpecs: [{ label: 'Pin', default: 0 }, { label: 'State (on/off)', default: true }] },
  { id: 'hw_buzzer', label: 'Hardware: Set Buzzer', functionName: 'setBuzzer', argSpecs: [{ label: 'On', default: true }] },
  { id: 'hw_wifi', label: 'Hardware: Send Wi-Fi / HTTP Request', functionName: 'sendHttpRequest', argSpecs: [{ label: 'URL', default: '' }, { label: 'Payload', default: '' }] },
  { id: 'hw_mqtt', label: 'Hardware: Publish MQTT Message', functionName: 'publishMqttMessage', argSpecs: [{ label: 'Topic', default: '' }, { label: 'Message', default: '' }] },
  { id: 'hw_bluetooth', label: 'Hardware: Send Bluetooth / BLE Data', functionName: 'sendBluetoothData', argSpecs: [{ label: 'Message', default: '' }] },
  { id: 'hw_i2c', label: 'Hardware: Send I2C Command', functionName: 'sendI2cCommand', argSpecs: [{ label: 'Address', default: 0 }, { label: 'Value', default: 0 }] }
]

function valueSetCall(widgetType: UiWidgetType): string {
  if (widgetType === 'slider') return 'lv_slider_set_value'
  if (widgetType === 'arc') return 'lv_arc_set_value'
  return 'lv_bar_set_value'
}
function rangeSetCall(widgetType: UiWidgetType): string {
  if (widgetType === 'slider') return 'lv_slider_set_range'
  if (widgetType === 'arc') return 'lv_arc_set_range'
  return 'lv_bar_set_range'
}
export function valueGetCall(widgetType: UiWidgetType): string {
  if (widgetType === 'slider') return 'lv_slider_get_value'
  if (widgetType === 'arc') return 'lv_arc_get_value'
  return 'lv_bar_get_value'
}
