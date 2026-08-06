import type { UiAsset, UiWidget, UiWidgetStyle, UiWidgetType } from '@/types'
import { STATUS_INDICATOR_PRESETS } from '@/lib/uiDesign/statusIndicatorPresets'

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
  animate: (id: string, config: { x?: number; y?: number; opacity?: number; scale?: number; rotation?: number; duration?: number; easing?: string }) => void
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
export const CODEGEN_SPECIAL_METHODS: ReadonlySet<string> = new Set([
  'setSource',
  'addClass',
  'removeClass',
  'callFunction',
  'updateVariable',
  // Needs the literal status string (not rendered C++ expression text) to resolve
  // STATUS_INDICATOR_PRESETS at export time — see codegen.ts's setStatus branch.
  'setStatus',
  // Routes through emitIndicatorAnimStart, which needs the widget's own anim* props
  // (loop/reverse/delay/easing), not just this call's literal args — see codegen.ts.
  'playIndicatorAnimation'
])

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

  // ---- Progress bar / Slider / Arc / Gauge value ----
  setValue: {
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { value: numArg(args, 0) }),
    cpp: (v, a, t) => emitValueSetLines(v, t, a[0], false)
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
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { min: numArg(args, 0), max: numArg(args, 1) }),
    cpp: (v, a, t) => [`${rangeSetCall(t)}(${v}, (${a[0]}), (${a[1]}));`]
  },
  animateTo: {
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: (ctx, id, args) => {
      const w = ctx.getWidget(id)
      const from = typeof w?.props.value === 'number' ? w.props.value : 0
      const to = numArg(args, 0)
      const duration = numArg(args, 1, 300)
      ctx.tween(from, to, duration, (v) => ctx.updateProps(id, { value: Math.round(v) }))
    },
    // bar/slider get the real native animated-transition path (LV_ANIM_ON); arc/gauge have no
    // such native path (confirmed against real LVGL v9.2.0 source) so this hand-rolls a real
    // lv_anim_t targeting the same setter emitValueSetLines would use for a one-shot call —
    // gauge's exec_cb is the small `<var>_needle_exec` trampoline generated once at creation time
    // (see lvglExport.ts's 'gauge' widgetCreateCalls case), since lv_scale's needle setter takes
    // 3 fixed args + the value, which doesn't fit lv_anim's plain (obj, int32_t) signature.
    cpp: (v, a, t) => {
      if (t === 'bar' || t === 'slider') {
        return [`lv_obj_set_style_anim_duration(${v}, (uint32_t)(${a[1] ?? '300'}), LV_PART_MAIN | LV_STATE_DEFAULT);`, ...emitValueSetLines(v, t, a[0], true)]
      }
      const setter = t === 'arc' ? '(lv_anim_exec_xcb_t)lv_arc_set_value' : `${v}_needle_exec`
      return [
        `{ static lv_anim_t a; lv_anim_init(&a); lv_anim_set_var(&a, ${v}); lv_anim_set_exec_cb(&a, ${setter}); lv_anim_set_values(&a, ${currentValueExpr(v, t)}, (int32_t)(${a[0]})); lv_anim_set_duration(&a, (uint32_t)(${a[1] ?? '300'})); lv_anim_start(&a); }`
      ]
    }
  },
  increaseValue: {
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: (ctx, id, args) => {
      const w = ctx.getWidget(id)
      const cur = typeof w?.props.value === 'number' ? w.props.value : 0
      const max = typeof w?.props.max === 'number' ? w.props.max : 100
      ctx.updateProps(id, { value: Math.min(max, cur + numArg(args, 0, 1)) })
    },
    cpp: (v, a, t) => emitValueSetLines(v, t, `${currentValueExpr(v, t)} + (${a[0] ?? '1'})`, false)
  },
  decreaseValue: {
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: (ctx, id, args) => {
      const w = ctx.getWidget(id)
      const cur = typeof w?.props.value === 'number' ? w.props.value : 0
      const min = typeof w?.props.min === 'number' ? w.props.min : 0
      ctx.updateProps(id, { value: Math.max(min, cur - numArg(args, 0, 1)) })
    },
    cpp: (v, a, t) => emitValueSetLines(v, t, `${currentValueExpr(v, t)} - (${a[0] ?? '1'})`, false)
  },
  resetValue: {
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: (ctx, id) => {
      const w = ctx.getWidget(id)
      const dflt = typeof w?.props.defaultValue === 'number' ? w.props.defaultValue : 0
      ctx.updateProps(id, { value: dflt })
    },
    cpp: (v, _a, t) => emitValueSetLines(v, t, `${v}_default_value`, false)
  },
  setDirection: {
    appliesTo: ['arc'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { direction: strArg(args, 0, 'normal') }),
    // Compared at runtime (strcmp) rather than requiring a literal arg, so a script variable can
    // drive direction too — LV_ARC_MODE_REVERSE is a real LVGL v9.2 enum value (confirmed).
    cpp: (v, a) => [`lv_arc_set_mode(${v}, (strcmp((${a[0]}), "reverse") == 0) ? LV_ARC_MODE_REVERSE : LV_ARC_MODE_NORMAL);`]
  },

  // ---- Spinner lifecycle — LVGL's real v9.2 spinner API (confirmed against source) has NO
  // public pause/resume: only lv_spinner_set_anim_params (which (re)starts it from scratch) and
  // lv_anim_delete (the only real stop mechanism). "Pause"/"Resume" in the Properties panel's
  // action picker are just labeled buttons over these same two actions — documented there, not
  // faked here. ----
  startSpinner: {
    appliesTo: ['spinner'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { spinning: true, spinDurationMs: numArg(args, 0, 1000) }),
    cpp: (v, a) => [`lv_spinner_set_anim_params(${v}, (uint32_t)(${a[0] ?? '1000'}), 60);`]
  },
  stopSpinner: {
    appliesTo: ['spinner'],
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateProps(id, { spinning: false }),
    cpp: (v) => [`lv_anim_delete(${v}, NULL);`]
  },

  // ---- LED ----
  turnOn: {
    appliesTo: ['led'],
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateProps(id, { state: 'on' }),
    cpp: (v) => [`lv_led_on(${v});`]
  },
  turnOff: {
    appliesTo: ['led'],
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateProps(id, { state: 'off' }),
    cpp: (v) => [`lv_led_off(${v});`]
  },
  blinkLed: {
    appliesTo: ['led'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { state: 'blink', animDurationMs: numArg(args, 0, 500) }),
    cpp: (v, a) => [`__kibo_led_anim_start(${v}, (uint32_t)(${a[0] ?? '500'}), true);`]
  },
  pulseLed: {
    appliesTo: ['led'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { state: 'pulse', animDurationMs: numArg(args, 0, 1000) }),
    cpp: (v, a) => [`__kibo_led_anim_start(${v}, (uint32_t)(${a[0] ?? '1000'}), false);`]
  },

  // ---- Status Indicator — status resolves to concrete color/icon/glow/animation calls at
  // export time (see statusIndicatorApplyLines in lvglExport.ts, reading the same
  // STATUS_INDICATOR_PRESETS table the live preview and widget-creation codegen both read) —
  // requires a literal status string, same "export needs the real value, not just rendered text"
  // constraint setColor/setBackground already have (see codegen.ts's renderActionArgs). ----
  setStatus: {
    appliesTo: ['statusIndicator'],
    kind: 'mutate',
    preview: (ctx, id, args) => ctx.updateProps(id, { status: strArg(args, 0, 'online') })
    // cpp handled as a CODEGEN_SPECIAL_METHOD (see codegen.ts) — needs the literal status string,
    // not a rendered C++ expression, to resolve the preset table at export time.
  },

  // ---- Indicator value-animation lifecycle (bar/slider/arc/gauge's own loop/reverse/delay
  // system — see lvglExport.ts's emitIndicatorAnimStart, kept deliberately separate from the
  // general-purpose x/y/opacity/rotation `.animate()` mechanism above). ----
  playIndicatorAnimation: {
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: (ctx, id, args) => {
      const w = ctx.getWidget(id)
      const from = typeof w?.props.value === 'number' ? w.props.value : 0
      const to = numArg(args, 0)
      const duration = numArg(args, 1, 300)
      ctx.tween(from, to, duration, (v) => ctx.updateProps(id, { value: Math.round(v) }))
    }
    // cpp handled as a CODEGEN_SPECIAL_METHOD — routes through emitIndicatorAnimStart, which
    // needs the widget's own anim* props (loop/reverse/delay/easing), not just call args.
  },
  stopIndicatorAnimation: {
    appliesTo: ['bar', 'slider', 'arc', 'gauge'],
    kind: 'mutate',
    preview: () => { /* preview tweens are frame-driven and self-terminate; nothing to cancel */ },
    cpp: (v) => [`lv_anim_delete(${v}, NULL);`]
  },

  // ---- Checkbox indeterminate — real in the editor/preview, export approximates as unchecked
  // (LVGL has no tri-state checkbox — see validateLvglExport.ts's new warning for this). ----
  setIndeterminate: {
    appliesTo: ['checkbox'],
    kind: 'mutate',
    preview: (ctx, id) => ctx.updateProps(id, { checked: 'indeterminate' }),
    cpp: (v) => [`lv_obj_remove_state(${v}, LV_STATE_CHECKED); /* indeterminate approximated as unchecked — LVGL has no tri-state checkbox */`]
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
  if (widgetType === 'gauge') return 'lv_scale_set_range'
  return 'lv_bar_set_range'
}
export function valueGetCall(widgetType: UiWidgetType): string {
  if (widgetType === 'slider') return 'lv_slider_get_value'
  if (widgetType === 'arc') return 'lv_arc_get_value'
  return 'lv_bar_get_value'
}

/** Emits the real value-set line(s) for a widget/value pair — extracted because the three widget
 * kinds this covers have three genuinely different real LVGL signatures (confirmed against real
 * v9.2.0 source, not guessed): `lv_bar_set_value`/`lv_slider_set_value` take a real native
 * `LV_ANIM_ON`/`OFF` 3rd param; `lv_arc_set_value` takes NO anim param at all (fixes a
 * pre-existing bug where this codebase's `setValue`/`animateTo` actions were passing a bogus 3rd
 * `LV_ANIM_OFF`/`ON` argument to it, which real LVGL would reject at compile time); `lv_scale`
 * (gauge) has no value setter of its own — the real API positions a separate needle line object
 * via `lv_scale_set_line_needle_value(scale, needle, needle_length, value)`, also with no anim
 * param, targeting the `<var>_needle`/`<var>_needle_len` companions created alongside every gauge
 * (see lvglExport.ts's 'gauge' widgetCreateCalls case). Since `lv_scale` has no value *getter*
 * either, gauge additionally maintains its own `<var>_value` tracker (updated by every line this
 * emits) — see `currentValueExpr` below, which reads it back for increase/decrease/animateTo's
 * "from" value. `animEnabled` is ignored for arc/gauge since neither has a native animated path —
 * a real animated arc/gauge sweep always goes through a hand-rolled `lv_anim_t` instead (see
 * `animateTo` and `emitIndicatorAnimStart` in lvglExport.ts). */
export function emitValueSetLines(varName: string, widgetType: UiWidgetType, valueExpr: string, animEnabled: boolean): string[] {
  if (widgetType === 'arc') return [`lv_arc_set_value(${varName}, (int32_t)(${valueExpr}));`]
  if (widgetType === 'gauge') {
    return [`${varName}_value = (int32_t)(${valueExpr});`, `lv_scale_set_line_needle_value(${varName}, ${varName}_needle, ${varName}_needle_len, ${varName}_value);`]
  }
  return [`${valueSetCall(widgetType)}(${varName}, (${valueExpr}), ${animEnabled ? 'LV_ANIM_ON' : 'LV_ANIM_OFF'});`]
}

/** The real "what's this widget's value right now" C++ expression — a real getter call for
 * bar/slider/arc, or gauge's own `<var>_value` tracker (see emitValueSetLines above; `lv_scale`
 * has no built-in value getter to call instead). */
export function currentValueExpr(varName: string, widgetType: UiWidgetType): string {
  if (widgetType === 'gauge') return `${varName}_value`
  return `${valueGetCall(widgetType)}(${varName})`
}

/** Minimal hex->lv_color_hex() conversion for STATUS_INDICATOR_PRESETS colors, which are always
 * plain `#rrggbb` literals (see statusIndicatorPresets.ts) — not the fuller colorLiteral() in
 * lvglExport.ts (which also handles rgb()/rgba() from hand-edited CSS), kept local here rather
 * than imported to avoid a lvglExport.ts <-> actionTable.ts import cycle (lvglExport.ts already
 * needs to import statusIndicatorApplyLines/emitIndicatorAnimStart from this file). */
function hexToLvColor(hex: string): string {
  const m = hex.trim().match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
  if (!m) return 'lv_color_black()'
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return `lv_color_hex(0x${h.toUpperCase()})`
}

/** Emits the real style/text calls that make a statusIndicator's `${varName}_dot`/`${varName}_label`
 * children match `status` — reading the SAME STATUS_INDICATOR_PRESETS table the live preview reads
 * (see WidgetRenderer.tsx), so initial widget-creation styling (lvglExport.ts's 'statusIndicator'
 * widgetCreateCalls case) and this runtime `setStatus` action can never resolve a status to
 * different colors/icons/glow/animation. Animation (pulse/spin) is approximated as an opacity
 * pulse via the shared `__kibo_opacity_anim_start` runtime helper (see lvglExport.ts's
 * ledRuntimeHelperLines) — a plain lv_obj circle has no rotation-friendly "spin" visual, so
 * 'loading' status is approximated with the same pulse as 'warning', documented here rather than
 * silently faked as a real spin. */
export function statusIndicatorApplyLines(varName: string, status: string, indent = ''): string[] {
  const preset = STATUS_INDICATOR_PRESETS[status as keyof typeof STATUS_INDICATOR_PRESETS] ?? STATUS_INDICATOR_PRESETS.online
  const colorLit = hexToLvColor(preset.color)
  const lines: string[] = []
  lines.push(`${indent}lv_obj_set_style_bg_color(${varName}_dot, ${colorLit}, LV_PART_MAIN);`)
  lines.push(`${indent}lv_obj_set_style_bg_opa(${varName}_dot, LV_OPA_COVER, LV_PART_MAIN);`)
  if (preset.glow) {
    lines.push(`${indent}lv_obj_set_style_shadow_color(${varName}_dot, ${colorLit}, LV_PART_MAIN);`)
    lines.push(`${indent}lv_obj_set_style_shadow_width(${varName}_dot, 12, LV_PART_MAIN);`)
    lines.push(`${indent}lv_obj_set_style_shadow_spread(${varName}_dot, 2, LV_PART_MAIN);`)
    lines.push(`${indent}lv_obj_set_style_shadow_opa(${varName}_dot, LV_OPA_70, LV_PART_MAIN);`)
  } else {
    lines.push(`${indent}lv_obj_set_style_shadow_width(${varName}_dot, 0, LV_PART_MAIN);`)
  }
  if (preset.anim === 'pulse' || preset.anim === 'spin') {
    lines.push(`${indent}__kibo_opacity_anim_start(${varName}_dot, ${preset.anim === 'spin' ? 1000 : 800});`)
  } else {
    lines.push(`${indent}lv_anim_delete(${varName}_dot, NULL);`)
  }
  lines.push(`${indent}lv_label_set_text(${varName}_label, ${JSON.stringify(preset.label)});`)
  return lines
}

/** Maps the Animation Controls' easing vocabulary (see UiIndicatorEasing in types/uiDesign.ts) to
 * real LVGL v9.2 lv_anim_path_* functions — bounce/overshoot are genuinely real, confirmed against
 * source, not simulated. */
const EASING_TO_LVGL_PATH: Record<string, string> = {
  linear: 'lv_anim_path_linear',
  easeIn: 'lv_anim_path_ease_in',
  easeOut: 'lv_anim_path_ease_out',
  easeInOut: 'lv_anim_path_ease_in_out',
  bounce: 'lv_anim_path_bounce',
  overshoot: 'lv_anim_path_overshoot'
}

/** The real lv_anim_exec_xcb_t-compatible setter for an indicator's own loop/reverse/delay
 * animation system — arc's native `lv_arc_set_value(obj, int32_t)` already fits the 2-arg
 * exec_cb signature directly; bar/slider/gauge each need a small generated trampoline function
 * (declared alongside the widget's other companions — see lvglExport.ts's extraWidgetDeclLines)
 * since their real setters take a 3rd argument (bar/slider's LV_ANIM_ON/OFF) or need extra
 * fixed arguments (gauge's needle/needle_len) that don't fit the plain (obj, int32_t) shape. */
function indicatorAnimSetterExpr(varName: string, widgetType: UiWidgetType): string {
  if (widgetType === 'arc') return '(lv_anim_exec_xcb_t)lv_arc_set_value'
  if (widgetType === 'gauge') return `${varName}_needle_exec`
  return `${varName}_value_exec`
}

/** Starts a real, hand-rolled lv_anim_t for an indicator's own loop/reverse/delay/easing
 * animation system (Animation Controls in the Properties panel; backs the `playIndicatorAnimation`
 * action and `animAutoStart` screen-creation wiring) — deliberately separate from the general-
 * purpose x/y/opacity/rotation `playAnimation`/`.animate()` mechanism above, which has no
 * loop/reverse/delay support at all. Reads the widget's own `anim*` props (not just call args),
 * since a screen-creation auto-start has no call args to read from. Calls the widget's own
 * `${varName}_on_anim_started`/`${varName}_on_anim_finished` USER-CODE-wrapped stubs (declared
 * unconditionally alongside every bar/slider/arc/gauge's other companions — see
 * lvglExport.ts's extraWidgetDeclLines) so `OnAnimationStarted()`/`OnAnimationFinished()` from the
 * spec are real, not just documented — `lv_anim_set_completed_cb` only ever fires for a
 * non-infinitely-looping animation, which is the real LVGL semantics for "finished". */
export function emitIndicatorAnimStart(varName: string, widgetType: 'bar' | 'slider' | 'arc' | 'gauge', widget: UiWidget, fromExpr: string, toExpr: string, indent = ''): string[] {
  const durationMs = Math.max(1, Math.round(typeof widget.props.animDurationMs === 'number' ? widget.props.animDurationMs : 300))
  const delayMs = Math.max(0, Math.round(typeof widget.props.animDelayMs === 'number' ? widget.props.animDelayMs : 0))
  const loop = !!widget.props.animLoop
  const reverse = !!widget.props.animReverse
  const easing = typeof widget.props.animEasing === 'string' ? widget.props.animEasing : 'linear'
  const easingFn = EASING_TO_LVGL_PATH[easing] ?? 'lv_anim_path_linear'
  const setter = indicatorAnimSetterExpr(varName, widgetType)
  return [
    `${indent}{`,
    `${indent}  static lv_anim_t a; lv_anim_init(&a);`,
    `${indent}  lv_anim_set_var(&a, ${varName});`,
    `${indent}  lv_anim_set_exec_cb(&a, ${setter});`,
    `${indent}  lv_anim_set_values(&a, (int32_t)(${fromExpr}), (int32_t)(${toExpr}));`,
    `${indent}  lv_anim_set_duration(&a, (uint32_t)${durationMs});`,
    `${indent}  lv_anim_set_delay(&a, (uint32_t)${delayMs});`,
    `${indent}  lv_anim_set_path_cb(&a, ${easingFn});`,
    `${indent}  lv_anim_set_repeat_count(&a, ${loop ? 'LV_ANIM_REPEAT_INFINITE' : '1'});`,
    `${indent}  lv_anim_set_playback_time(&a, ${reverse ? `(uint32_t)${durationMs}` : '0'});`,
    `${indent}  lv_anim_set_completed_cb(&a, ${varName}_on_anim_finished);`,
    `${indent}  ${varName}_on_anim_started();`,
    `${indent}  lv_anim_start(&a);`,
    `${indent}}`
  ]
}
