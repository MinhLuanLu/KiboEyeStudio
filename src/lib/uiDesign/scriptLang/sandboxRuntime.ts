import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/state/store'
import type { UiWidget, UiWidgetStyle } from '@/types'
import { selectAll, selectFirst } from '@/lib/uiDesign/selectors'
import { parseScript } from './parser'
import { applyTextEdits, type TextEdit } from './textSplice'
import { walkAllNodes } from './astWalk'
import { ACTION_TABLE, type PreviewActionCtx } from './actionTable'
import { widgetVarName, TRIGGER_TO_LVGL_EVENT } from '@/lib/export/lvglExport'

// Live-preview execution — runs the ACTUAL script text via the browser's own JS engine
// (`new Function(...)`, not the Acorn AST) so preview behavior uses genuine JS semantics for
// free, matching this codebase's "lean on the real platform instead of writing an interpreter"
// precedent (DOMParser/CSSOM for HTML/CSS). The Acorn AST is used here only for two narrow,
// preview-specific conveniences: (a) the Variable Inspector (mirroring top-level let/const onto
// an externally-readable object via a small keyword-only source splice) and (b) locating
// `.bindText/.bindValue/.bindVisible(...)` calls anywhere in the script so their argument
// expressions can be re-evaluated on every tick (see BINDING_METHODS below). C++ export
// (codegen.ts) is a completely separate walk of the untouched AST — this file never feeds into it.

// 'log'/'warn'/'error'/'debug' come from the script's own console.* calls (rendered as
// USER/WARNING/ERROR/DEBUG — 'log' reads as "USER" since, in this sandbox, everything a running
// script prints is the user's own application output, the same role LV_LOG_USER plays in real
// LVGL firmware). 'event' is a fired widget/hardware event (rendered as EVENT). 'info' is this
// runtime's own lifecycle messages (Preview started/stopped) — never emitted by user code.
export type SandboxLogKind = 'log' | 'warn' | 'error' | 'debug' | 'event' | 'info'

export const LOG_KIND_LEVEL: Record<SandboxLogKind, string> = {
  log: 'USER',
  warn: 'WARNING',
  error: 'ERROR',
  debug: 'DEBUG',
  event: 'EVENT',
  info: 'INFO'
}

/** Structured detail attached only to `kind: 'event'` entries — this is what the Logic tab's
 * optional "Event Inspector" mode reads to show Widget/Type/Event/Value/Callback as separate
 * fields instead of one flattened message string. `widgetVarName`/`lvglEvent` deliberately reuse
 * the exact same naming (`widgetVarName()`/`TRIGGER_TO_LVGL_EVENT`) the real C++ export uses, so
 * what you see firing live in the preview terminal names things identically to what you'll see in
 * the exported `ui.cpp` — same "preview and export must agree" precedent as this feature's
 * dispatch-trigger-name vocabulary already followed. `userData` has no real backing concept in
 * this JS sandbox (LVGL's `lv_obj_add_event_cb(..., user_data)` has no preview-side equivalent
 * today) — always `undefined`, shown as "—" in the UI rather than a fabricated value. */
export interface SandboxEventDetail {
  widgetId: string
  widgetType: string
  widgetVarName: string
  trigger: string
  lvglEvent: string
  value?: unknown
  userData?: unknown
  callbackName?: string
}

export interface SandboxLogEntry {
  id: number
  kind: SandboxLogKind
  message: string
  timestamp: number
  event?: SandboxEventDetail
}

export interface SimulateTargets {
  buttons: string[]
  hasEncoder: boolean
  sensors: string[]
}

interface SandboxCallbacks {
  onLog: (entry: SandboxLogEntry) => void
  onVariablesChange: (vars: Record<string, unknown>) => void
  onRunningChange: (running: boolean) => void
  onSimulateTargetsChange: (targets: SimulateTargets) => void
  // Fired when Start/Restart's top-level script execution throws before a single event handler
  // ever gets registered (e.g. a ReferenceError from a stray identifier) — distinct from an error
  // thrown later *inside* an already-running event handler (dispatchWidgetEvent's own try/catch),
  // which only logs to the Terminal since the rest of the script is still live. A startup failure
  // means the whole run never actually started, so it needs a signal that can't be missed by
  // scrolling past one Terminal line — see LogicPanel.tsx's red banner. `null` clears it.
  onStartupError: (message: string | null) => void
}

const BINDING_METHODS = new Set(['bindText', 'bindValue', 'bindVisible'])

/** `bindText`/`bindValue`'s optional 2nd argument — see PropertiesPanel.tsx's BindingsSection /
 * visualBindings.ts and codegen.ts's own BindingOptions (kept as two independent small types,
 * one per side, rather than a shared import, matching this pair's existing "preview reruns real
 * JS, export walks a separate AST" independence elsewhere in this feature). */
export interface BindingOptions {
  min?: number
  max?: number
  format?: string
  unit?: string
  fallback?: string | number | boolean
}

/** `bindText`'s displayed string: `format`'s `{value}` placeholder substituted in, else a plain
 * `unit` suffix, else the raw value — the fallback (used when `value` is nullish/NaN) is a
 * preview-only convenience (see codegen.ts's parseBindingOptions doc comment for why export
 * doesn't need one). */
function applyBindingFormat(value: unknown, options?: BindingOptions): string {
  let v = value
  const isEmpty = v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))
  if (isEmpty && options?.fallback !== undefined) v = options.fallback
  if (typeof v === 'number') {
    let n = v
    if (typeof options?.min === 'number') n = Math.max(options.min, n)
    if (typeof options?.max === 'number') n = Math.min(options.max, n)
    v = n
  }
  const text = String(v ?? '')
  if (options?.format?.includes('{value}')) return options.format.replace('{value}', text)
  if (options?.unit) return `${text}${options.unit}`
  return text
}

const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeIn: (t) => t * t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
}

// Exported (only) so scratch/unit-style scripts can drive it directly without mounting React —
// the public surface real callers use is still the `useScriptSandbox()` hook / module-level
// dispatchWidgetEvent/isSandboxRunning below, which wrap exactly one shared instance per app.
export class ScriptSandbox {
  private cb: SandboxCallbacks
  private timers = new Set<number>()
  private eventHandlers = new Map<string, Record<string, { fn: (...a: unknown[]) => void; name?: string }[]>>()
  private hardwareButtons = new Map<string, (() => void)[]>()
  private hardwareEncoder: ((direction: number) => void)[] = []
  private hardwareSensors = new Map<string, ((value: number) => void)[]>()
  private snapshot: { widgets: Record<string, UiWidget>; activeScreenId: string | null } | null = null
  private screenHistory: string[] = []
  private bindingsHolder: { update: () => void } = { update: () => {} }
  private varsProxy: Record<string, unknown> = {}
  private nextLogId = 1
  running = false

  constructor(cb: SandboxCallbacks) {
    this.cb = cb
  }

  start(): void {
    if (this.running) return
    this.cb.onStartupError(null)
    const state = useStore.getState()
    const uiDesign = state.project.uiDesign
    const source = uiDesign.script
    const parsed = parseScript(source)
    if (!parsed.program) {
      const message = `Line ${parsed.errors[0]?.line ?? 1}: ${parsed.errors[0]?.message ?? 'Could not parse script.'}`
      this.log('error', message)
      this.cb.onStartupError(message)
      return
    }

    this.snapshot = { widgets: JSON.parse(JSON.stringify(uiDesign.widgets)), activeScreenId: uiDesign.activeScreenId }
    this.screenHistory = []
    this.eventHandlers.clear()
    this.hardwareButtons.clear()
    this.hardwareEncoder = []
    this.hardwareSensors.clear()

    // Top-level let/const -> var (function-scoped, still behaves like a normal mutable local
    // for every other reference in the script) plus a getter-per-name epilogue, so the Variable
    // Inspector can read live values from outside without needing closure introspection.
    const edits: TextEdit[] = []
    const topLevelNames: string[] = []
    for (const stmt of parsed.program.body) {
      if (stmt.type === 'FunctionDeclaration') {
        // Also exposed via __vars (same getter epilogue below) — not to show a function in the
        // Variable Inspector meaningfully, but so ctx.callFunction("name", ...) can look up and
        // call an already-declared top-level function by name (see PreviewActionCtx.callFunction).
        const f = stmt as unknown as { id: { name?: string } | null }
        if (f.id?.name) topLevelNames.push(f.id.name)
        continue
      }
      if (stmt.type !== 'VariableDeclaration') continue
      const decl = stmt as unknown as { kind: string; start: number; declarations: { id: { type: string; name?: string } }[] }
      if (decl.kind === 'var') continue
      edits.push({ start: decl.start, end: decl.start + decl.kind.length, replacement: 'var' })
      for (const d of decl.declarations) {
        if (d.id.type === 'Identifier' && d.id.name) topLevelNames.push(d.id.name)
      }
    }
    const patchedSource = applyTextEdits(source, edits)

    // Locate every `<widgetRef>.bindText/.bindValue/.bindVisible(<expr>)` call anywhere in the
    // script so its argument expression can be re-evaluated (not just its once-off value) every
    // time __bindingsHolder.update() runs — see the epilogue below and dispatchWidgetEvent/timer
    // callbacks, which both call it after every tick.
    const bindingCalls: { receiverText: string; method: string; argText: string; optionsText: string | null }[] = []
    walkAllNodes(parsed.program, (node) => {
      if (node.type !== 'CallExpression') return
      const call = node as unknown as { callee: { type: string }; arguments: { start: number; end: number }[] }
      if (call.callee.type !== 'MemberExpression') return
      const member = call.callee as unknown as { object: { start: number; end: number }; property: { type: string; name?: string }; computed: boolean }
      if (member.computed || member.property.type !== 'Identifier' || !member.property.name) return
      if (!BINDING_METHODS.has(member.property.name)) return
      if (call.arguments.length === 0) return
      bindingCalls.push({
        receiverText: source.slice(member.object.start, member.object.end),
        method: member.property.name,
        argText: source.slice(call.arguments[0].start, call.arguments[0].end),
        optionsText: call.arguments[1] ? source.slice(call.arguments[1].start, call.arguments[1].end) : null
      })
    })

    const epilogue: string[] = []
    for (const name of topLevelNames) {
      epilogue.push(
        `Object.defineProperty(__vars, ${JSON.stringify(name)}, { configurable: true, enumerable: true, get: function() { return typeof ${name} !== 'undefined' ? ${name} : undefined; } });`
      )
    }
    epilogue.push('__bindingsHolder.update = function() {')
    for (const b of bindingCalls) {
      const optionsArg = b.optionsText ? `, (${b.optionsText})` : ''
      epilogue.push(
        `  try { if (typeof ${b.receiverText} !== 'undefined' && ${b.receiverText} && ${b.receiverText}.__applyBinding) { ${b.receiverText}.__applyBinding(${JSON.stringify(b.method)}, (${b.argText})${optionsArg}); } } catch (e) {}`
      )
    }
    epilogue.push('};')

    const fullSource = `${patchedSource}\n${epilogue.join('\n')}\n__bindingsHolder.update();`

    const ctx: PreviewActionCtx = {
      getWidget: (id) => useStore.getState().project.uiDesign.widgets[id],
      getAssets: () => useStore.getState().project.uiDesign.assets,
      updateStyle: (id, partial) => useStore.getState().updateUiWidgetStyle(id, partial),
      updateText: (id, text) => useStore.getState().updateUiWidgetText(id, text),
      updateProps: (id, partial) => useStore.getState().updateUiWidgetProps(id, partial),
      setSrc: (id, assetId) => useStore.getState().setUiWidgetSrc(id, assetId),
      deleteWidget: (id) => useStore.getState().deleteUiWidget(id),
      updateMeta: (id, partial) => useStore.getState().updateUiWidgetMeta(id, partial),
      tween: (from, to, duration, onFrame, onDone) => this.runTween(from, to, duration, onFrame, onDone),
      animate: (id, config) => {
        const w = useStore.getState().project.uiDesign.widgets[id]
        if (w) this.animateWidget(ctx, w, config)
      },
      callFunction: (name, args) => {
        const fn = this.varsProxy[name]
        if (typeof fn === 'function') {
          try {
            ;(fn as (...a: unknown[]) => void)(...args)
          } catch (err) {
            this.logError(err)
          }
        } else {
          this.log('warn', `callFunction("${name}"): no function named "${name}" is declared in the script — export will still generate a stub for it.`)
        }
      },
      updateVariable: (name, value) => {
        useStore.getState().setRuntimeVariableValue(name, value as string | number | boolean)
        this.afterTick()
      }
    }

    this.varsProxy = {}
    this.bindingsHolder = { update: () => {} }
    const uiSandbox = this.buildUiSandbox(ctx)
    const hardwareSandbox = this.buildHardwareSandbox()
    const consoleSandbox = this.buildConsoleSandbox()
    const dataSandbox = this.buildDataSandbox()
    const serialSandbox = this.buildSerialSandbox()

    this.running = true
    this.cb.onRunningChange(true)
    this.log('info', 'Preview started')

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'ui',
        'hardware',
        'console',
        'data',
        '__vars',
        '__bindingsHolder',
        'Serial',
        'printf',
        'LV_LOG_USER',
        fullSource
      )
      fn(
        uiSandbox,
        hardwareSandbox,
        consoleSandbox,
        dataSandbox,
        this.varsProxy,
        this.bindingsHolder,
        serialSandbox,
        (...args: unknown[]) => this.log('log', formatPrintfStyle(args)),
        (...args: unknown[]) => this.log('log', formatPrintfStyle(args))
      )
    } catch (err) {
      const message = this.formatErrorMessage(err)
      this.log('error', message)
      this.cb.onStartupError(message)
      this.running = false
      this.cb.onRunningChange(false)
      return
    }

    this.cb.onVariablesChange({ ...this.varsProxy })
    this.cb.onSimulateTargetsChange({
      buttons: [...this.hardwareButtons.keys()],
      hasEncoder: this.hardwareEncoder.length > 0,
      sensors: [...this.hardwareSensors.keys()]
    })
  }

  stop(): void {
    if (!this.running && !this.snapshot) return
    if (this.running) this.log('info', 'Preview stopped')
    for (const id of this.timers) {
      window.clearInterval(id)
      window.clearTimeout(id)
    }
    this.timers.clear()
    this.eventHandlers.clear()
    this.hardwareButtons.clear()
    this.hardwareEncoder = []
    this.hardwareSensors.clear()
    this.running = false
    if (this.snapshot) {
      useStore.getState().restoreUiRuntimeSnapshot(this.snapshot.widgets, this.snapshot.activeScreenId)
      this.snapshot = null
    }
    useStore.getState().resetRuntimeVariableValues()
    useStore.getState().resetKeyboardRuntime()
    useStore.getState().resetSimulatedFocus()
    this.cb.onRunningChange(false)
    this.cb.onVariablesChange({})
    this.cb.onSimulateTargetsChange({ buttons: [], hasEncoder: false, sensors: [] })
    this.cb.onStartupError(null)
  }

  restart(): void {
    this.stop()
    this.start()
  }

  dispatchWidgetEvent(widgetId: string, event: string, ...args: unknown[]): void {
    if (!this.running) return
    const handlers = this.eventHandlers.get(widgetId)?.[event]
    if (!handlers || handlers.length === 0) return
    const w = useStore.getState().project.uiDesign.widgets[widgetId]
    const varName = w ? widgetVarName(w) : widgetId
    this.logEvent(
      {
        widgetId,
        widgetType: w?.type ?? 'unknown',
        widgetVarName: varName,
        trigger: event,
        lvglEvent: TRIGGER_TO_LVGL_EVENT[event] ?? event,
        value: args.length > 0 ? args[0] : undefined,
        callbackName: handlers.find((h) => h.name)?.name
      },
      `${event} on ${w?.tagId ?? widgetId}`
    )
    notifyAffectedWidget(widgetId)
    for (const { fn } of handlers) {
      try {
        fn(...args)
      } catch (err) {
        this.logError(err)
      }
    }
    this.afterTick()
  }

  simulateButtonPress(name: string): void {
    if (!this.running) return
    const handlers = this.hardwareButtons.get(name)
    this.log('event', `Simulated button press: ${name}`)
    if (!handlers) return
    for (const h of handlers) {
      try {
        h()
      } catch (err) {
        this.logError(err)
      }
    }
    this.afterTick()
  }

  simulateEncoderRotate(direction: number): void {
    if (!this.running) return
    this.log('event', `Simulated encoder rotate: ${direction > 0 ? 'CW' : 'CCW'}`)
    for (const h of this.hardwareEncoder) {
      try {
        h(direction)
      } catch (err) {
        this.logError(err)
      }
    }
    this.afterTick()
  }

  simulateSensorChange(name: string, value: number): void {
    if (!this.running) return
    const handlers = this.hardwareSensors.get(name)
    this.log('event', `Simulated sensor "${name}" -> ${value}`)
    if (!handlers) return
    for (const h of handlers) {
      try {
        h(value)
      } catch (err) {
        this.logError(err)
      }
    }
    this.afterTick()
  }

  private afterTick(): void {
    try {
      this.bindingsHolder.update()
    } catch {
      /* a binding expression throwing shouldn't take down the rest of the tick */
    }
    this.cb.onVariablesChange({ ...this.varsProxy })
  }

  private runTween(from: number, to: number, duration: number, onFrame: (v: number) => void, onDone?: () => void): void {
    const start = performance.now()
    const step = (now: number) => {
      if (!this.running) return
      const t = Math.min(1, duration <= 0 ? 1 : (now - start) / duration)
      onFrame(from + (to - from) * t)
      this.afterTick()
      if (t < 1) requestAnimationFrame(step)
      else onDone?.()
    }
    requestAnimationFrame(step)
  }

  private animateWidget(ctx: PreviewActionCtx, widget: UiWidget, config: Record<string, unknown>): void {
    const duration = typeof config.duration === 'number' ? config.duration : 300
    const ease = EASINGS[typeof config.easing === 'string' ? config.easing : 'linear'] ?? EASINGS.linear
    const style = widget.style
    const props: { key: keyof UiWidgetStyle; from: number; to: number }[] = []
    if (typeof config.x === 'number') props.push({ key: 'x', from: typeof style.x === 'number' ? style.x : 0, to: config.x })
    if (typeof config.y === 'number') props.push({ key: 'y', from: typeof style.y === 'number' ? style.y : 0, to: config.y })
    if (typeof config.opacity === 'number') props.push({ key: 'opacity', from: style.opacity ?? 100, to: config.opacity })
    if (typeof config.scale === 'number') props.push({ key: 'scale', from: style.scale ?? 1, to: config.scale })
    if (props.length === 0) return
    const start = performance.now()
    const step = (now: number) => {
      if (!this.running) return
      const raw = Math.min(1, duration <= 0 ? 1 : (now - start) / duration)
      const t = ease(raw)
      const partial: Partial<UiWidgetStyle> = {}
      for (const p of props) (partial as Record<string, number>)[p.key] = p.from + (p.to - p.from) * t
      ctx.updateStyle(widget.id, partial)
      this.afterTick()
      if (raw < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  private createWidgetProxy(ctx: PreviewActionCtx, widget: UiWidget): Record<string, unknown> {
    const proxy: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(ACTION_TABLE)) {
      if (spec.appliesTo !== 'any' && !spec.appliesTo.includes(widget.type)) continue
      // Only 'mutate' actions flag this widget as "affected" for the canvas highlight (A6) —
      // 'read' actions (e.g. getValue) don't change anything, so highlighting on read would be
      // misleading. bindText/bindValue/bindVisible are deliberately excluded too (see below):
      // they re-run every tick via __bindingsHolder.update(), which would make the highlight a
      // near-constant flicker instead of a meaningful "this just happened" signal.
      proxy[name] = (...args: unknown[]) => {
        if (spec.kind === 'mutate') notifyAffectedWidget(widget.id)
        return spec.preview(ctx, widget.id, args)
      }
    }
    if (widget.type === 'image' || widget.type === 'icon') {
      proxy.setSource = (name: string) => {
        const asset = ctx.getAssets().find((a) => a.name === name)
        if (!asset) {
          this.log('error', `setSource("${name}"): no imported asset has that name.`)
          return
        }
        notifyAffectedWidget(widget.id)
        ctx.setSrc(widget.id, asset.id)
      }
    }
    proxy.addClass = (cls: string) => {
      const w = ctx.getWidget(widget.id)
      if (w && typeof cls === 'string' && !w.classNames.includes(cls)) {
        notifyAffectedWidget(widget.id)
        ctx.updateMeta(widget.id, { classNames: [...w.classNames, cls] })
      }
    }
    proxy.removeClass = (cls: string) => {
      const w = ctx.getWidget(widget.id)
      if (w) {
        notifyAffectedWidget(widget.id)
        ctx.updateMeta(widget.id, { classNames: w.classNames.filter((c) => c !== cls) })
      }
    }
    // The optional 3rd arg mirrors the export-only `.on(trigger, callback, "name")` shape
    // codegen.ts already recognizes for a custom C++ callback function name — reusing that exact
    // syntax here means it's already valid per restrictedSubset.ts (no export-validator change
    // needed) and doubles as the "Callback" field the Event Inspector shows for a fired event.
    proxy.on = (event: string, handler: (...a: unknown[]) => void, name?: string) => {
      const forWidget = this.eventHandlers.get(widget.id) ?? {}
      forWidget[event] = [...(forWidget[event] ?? []), { fn: handler, name }]
      this.eventHandlers.set(widget.id, forWidget)
    }
    proxy.animate = (config: Record<string, unknown>) => {
      notifyAffectedWidget(widget.id)
      this.animateWidget(ctx, widget, config)
    }
    proxy.bindText = (value: unknown, options?: BindingOptions) => ctx.updateText(widget.id, applyBindingFormat(value, options))
    proxy.bindValue = (value: unknown, options?: BindingOptions) => {
      let n = Number(value)
      if (Number.isNaN(n) && options?.fallback !== undefined) n = Number(options.fallback)
      if (typeof options?.min === 'number') n = Math.max(options.min, n)
      if (typeof options?.max === 'number') n = Math.min(options.max, n)
      ctx.updateProps(widget.id, { value: n })
    }
    proxy.bindVisible = (value: unknown) => ctx.updateStyle(widget.id, { visible: Boolean(value) })
    proxy.__applyBinding = (method: string, value: unknown, options?: BindingOptions) => {
      const fn = proxy[method]
      if (typeof fn === 'function') (fn as (v: unknown, o?: BindingOptions) => void)(value, options)
    }
    return proxy
  }

  private buildUiSandbox(ctx: PreviewActionCtx): Record<string, unknown> {
    return {
      get: (selector: string) => {
        const w = selectFirst(useStore.getState().project.uiDesign.widgets, selector)
        return w ? this.createWidgetProxy(ctx, w) : null
      },
      getAll: (selector: string) => selectAll(useStore.getState().project.uiDesign.widgets, selector).map((w) => this.createWidgetProxy(ctx, w)),
      setTimeout: (callback: () => void, ms: number) => {
        const id = window.setTimeout(() => {
          this.timers.delete(id)
          this.invokeCallback(callback)
        }, ms)
        this.timers.add(id)
        return id
      },
      setInterval: (callback: () => void, ms: number) => {
        const id = window.setInterval(() => this.invokeCallback(callback), ms)
        this.timers.add(id)
        return id
      },
      clearInterval: (id: number) => {
        window.clearInterval(id)
        this.timers.delete(id)
      },
      clearTimeout: (id: number) => {
        window.clearTimeout(id)
        this.timers.delete(id)
      },
      showScreen: (name: string) => {
        const screens = useStore.getState().project.uiDesign.screens
        const target = screens.find((s) => s.name === name)
        if (!target) {
          this.log('error', `ui.showScreen("${name}"): no screen named "${name}" exists.`)
          return
        }
        const current = useStore.getState().project.uiDesign.activeScreenId
        if (current) this.screenHistory.push(current)
        useStore.getState().setUiActiveScreen(target.id)
        this.log('event', `Screen -> "${name}"`)
      },
      goBack: () => {
        const prev = this.screenHistory.pop()
        if (prev) useStore.getState().setUiActiveScreen(prev)
      }
    }
  }

  private buildHardwareSandbox(): Record<string, unknown> {
    const target: Record<string, unknown> = {
      onButtonPress: (name: string, callback: () => void) => {
        this.hardwareButtons.set(name, [...(this.hardwareButtons.get(name) ?? []), callback])
      },
      onEncoderRotate: (callback: (direction: number) => void) => {
        this.hardwareEncoder.push(callback)
      },
      onSensorChange: (name: string, callback: (value: number) => void) => {
        this.hardwareSensors.set(name, [...(this.hardwareSensors.get(name) ?? []), callback])
      }
    }
    return new Proxy(target, {
      get: (obj, prop) => {
        if (typeof prop === 'string' && prop in obj) return obj[prop]
        if (typeof prop === 'string' && prop.startsWith('on')) {
          return () => {
            this.log('log', `hardware.${prop}(...) registered — not simulated in preview; exports as a stub handler you wire to your own hardware/network code.`)
          }
        }
        return undefined
      }
    })
  }

  /** `data.<name>` — the live bridge to the Variable Manager's own entries (see types/uiDesign.ts's
   * UiVariable doc comment). Reads fall back to the declared variable's own `defaultValue` when
   * nothing's been written yet this run (store.ts's runtimeVariableValues starts empty on every
   * Start — see stop()); reads/writes for a name with NO declared UiVariable still work (an
   * ad-hoc runtime-only value), so referencing `data.x` never throws even before it's been added
   * to the Variable Manager table. Writes go through the same store action the Variable Manager
   * panel's own "current value" column reads, so script and panel always agree. */
  private buildDataSandbox(): Record<string, unknown> {
    return new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (typeof prop !== 'string') return undefined
          const state = useStore.getState()
          if (prop in state.runtimeVariableValues) return state.runtimeVariableValues[prop]
          return state.project.uiDesign.variables.find((v) => v.name === prop)?.defaultValue
        },
        set: (_t, prop, value) => {
          if (typeof prop !== 'string') return false
          useStore.getState().setRuntimeVariableValue(prop, value as string | number | boolean)
          this.afterTick()
          return true
        }
      }
    )
  }

  private buildConsoleSandbox(): Record<string, unknown> {
    return {
      log: (...args: unknown[]) => this.log('log', args.map(stringifyLogArg).join(' ')),
      warn: (...args: unknown[]) => this.log('warn', args.map(stringifyLogArg).join(' ')),
      error: (...args: unknown[]) => this.log('error', args.map(stringifyLogArg).join(' ')),
      debug: (...args: unknown[]) => this.log('debug', args.map(stringifyLogArg).join(' '))
    }
  }

  /** A small `Serial` shim so real Arduino-style logging idioms — `Serial.println("Clicked")`,
   * `Serial.print(x)` — work verbatim inside an event handler and land in the Terminal, same as
   * `console.log`. This is still real JS execution (Serial.println really is just a function call
   * that runs when the event fires), not a simulation — it exists purely because "Serial" isn't a
   * real global in a browser, so without this shim that exact line would throw a ReferenceError
   * instead of doing what a user coming from Arduino firmware code would expect. */
  private buildSerialSandbox(): Record<string, unknown> {
    return {
      println: (...args: unknown[]) => this.log('log', args.map(stringifyLogArg).join(' ')),
      print: (...args: unknown[]) => this.log('log', args.map(stringifyLogArg).join(' '))
    }
  }

  private invokeCallback(callback: () => void): void {
    try {
      callback()
    } catch (err) {
      this.logError(err)
    }
    this.afterTick()
  }

  private formatErrorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    let line: number | undefined
    if (err instanceof Error && err.stack) {
      const m = err.stack.match(/<anonymous>:(\d+):\d+/)
      if (m) line = Number(m[1])
    }
    const base = line ? `Line ${line}: ${message}` : message
    const hint = lvglMisuseHint(message)
    return hint ? `${base} ${hint}` : base
  }

  private logError(err: unknown): void {
    this.log('error', this.formatErrorMessage(err))
  }

  private log(kind: SandboxLogKind, message: string): void {
    this.cb.onLog({ id: this.nextLogId++, kind, message, timestamp: Date.now() })
  }

  private logEvent(detail: SandboxEventDetail, message: string): void {
    this.cb.onLog({ id: this.nextLogId++, kind: 'event', message, timestamp: Date.now(), event: detail })
  }
}

// A common first mistake: pasting literal LVGL C event-callback code (e.g. `switch (code) { case
// LV_EVENT_CLICKED: ... }`) directly into this scripting language, where none of those
// identifiers exist — it's syntactically valid JS (switch/case is real JS), so it parses fine and
// only fails at runtime with a plain "X is not defined" ReferenceError, which on its own doesn't
// explain *why*. Recognized narrowly, only for names that are unambiguously LVGL vocabulary (the
// conventional `code` param from `lv_event_get_code(e)`, or an `LV_EVENT_*`/`LV_STATE_*`/
// `LV_OBJ_FLAG_*`/`LV_ALIGN_*`/`LV_PART_*` constant) — deliberately not generic names like `e`/
// `obj`/`evt`, which are common in unrelated, genuinely unrelated JS typos and would make this
// hint misleading more often than helpful.
function lvglMisuseHint(message: string): string | undefined {
  const m = message.match(/^(\w+) is not defined$/)
  if (!m) return undefined
  const name = m[1]
  const looksLvgl = name === 'code' || /^LV_(EVENT|STATE|OBJ_FLAG|ALIGN|PART)_/.test(name)
  if (!looksLvgl) return undefined
  return `— this looks like literal LVGL C event-callback code. This scripting language is JS-like, not C: write "const w = ui.get(\"#yourWidget\"); w.on(\"click\", () => { ... });" instead of a switch(code)/case LV_EVENT_... block.`
}

function stringifyLogArg(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Backs the `printf`/`LV_LOG_USER` sandbox globals — real C printf-style substitution
 * (`%d`/`%i`/`%u`/`%f`/`%s`/`%%`) against a format-string first argument, matching exactly the
 * `LV_LOG_USER("Slider value: %d", value)` shape LVGL firmware code actually uses, so that line
 * works unmodified in preview. A trailing `\n` (from the `printf("...\n")` convention) is trimmed
 * since each Terminal entry is already its own line. Falls back to space-joining every argument,
 * same as console.log, when the first argument isn't a format string (no `%` in it) — so a plain
 * `printf("Button clicked")` with no substitutions still works. */
function formatPrintfStyle(args: unknown[]): string {
  if (args.length === 0) return ''
  const first = args[0]
  if (typeof first !== 'string' || !first.includes('%')) {
    // No format specifiers to substitute, but a bare `printf("Button clicked\n")` — no "%"
    // anywhere — is exactly as common as the substitution form, so the trailing-newline trim
    // below must not be conditional on which branch ran, or a plain printf call keeps a stray
    // blank-looking newline baked into the one Terminal entry it produces.
    return args
      .map(stringifyLogArg)
      .join(' ')
      .replace(/\n+$/, '')
  }
  let argIndex = 1
  const formatted = first.replace(/%[sdiuf%]/g, (spec) => {
    if (spec === '%%') return '%'
    if (argIndex >= args.length) return spec
    const v = args[argIndex++]
    if (spec === '%d' || spec === '%i' || spec === '%u') return String(Math.trunc(Number(v)))
    if (spec === '%f') return String(Number(v))
    return String(v)
  })
  return formatted.replace(/\n+$/, '')
}

// Module-level singleton — only one Logic tab/script sandbox exists at a time in this app, so
// WidgetRenderer.tsx (which can't easily reach into a React hook owned by a sibling panel) reads
// it directly to fire real canvas interactions (click/pressed/released/longPress/valueChanged)
// into the running script during a Run session, without any change to design-time behavior when
// nothing is running.
let currentSandbox: ScriptSandbox | null = null

export function dispatchWidgetEvent(widgetId: string, event: string, ...args: unknown[]): void {
  currentSandbox?.dispatchWidgetEvent(widgetId, event, ...args)
}

export function isSandboxRunning(): boolean {
  return currentSandbox?.running ?? false
}

// A6's "highlight the affected component during testing" signal — a tiny module-level pub-sub,
// same "WidgetRenderer can't easily reach into a sibling panel's React state" rationale as the
// dispatchWidgetEvent singleton above. Fired whenever a widget proxy method actually mutates
// something (see createWidgetProxy's per-entry notifyAffectedWidget calls) or a script event
// handler runs (see dispatchWidgetEvent above) — WidgetRenderer.tsx subscribes and applies a
// brief highlight to the matching widget, independent of which right-panel tab is open.
type AffectedWidgetListener = (widgetId: string) => void
const affectedWidgetListeners = new Set<AffectedWidgetListener>()

function notifyAffectedWidget(widgetId: string): void {
  for (const listener of affectedWidgetListeners) listener(widgetId)
}

export function subscribeAffectedWidget(listener: AffectedWidgetListener): () => void {
  affectedWidgetListeners.add(listener)
  return () => affectedWidgetListeners.delete(listener)
}

// Bounded well past the default 200 — a terminal meant for real interactive debugging (lots of
// EVENT entries from clicking around the preview) fills that up fast; 1000 is still a trivial
// amount of memory for plain log-entry objects and keeps meaningfully more session history
// on-screen for the text filter to search across.
const LOG_RETENTION = 1000

export interface ScriptSandboxApi {
  running: boolean
  logs: SandboxLogEntry[]
  variables: Record<string, unknown>
  simulateTargets: SimulateTargets
  paused: boolean
  // Set when the most recent Start/Restart failed before the script ever finished its top-level
  // run (a parse error, or a thrown error before a single event handler got registered) — cleared
  // on the next successful Start/Restart or on Stop. See LogicPanel.tsx's banner, which is the
  // whole point of tracking this separately from the Terminal's own (easy-to-miss) error line.
  startupError: string | null
  start: () => void
  stop: () => void
  restart: () => void
  clearLogs: () => void
  pause: () => void
  resume: () => void
  simulateButtonPress: (name: string) => void
  simulateEncoderRotate: (direction: number) => void
  simulateSensorChange: (name: string, value: number) => void
}

export function useScriptSandbox(): ScriptSandboxApi {
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<SandboxLogEntry[]>([])
  const [variables, setVariables] = useState<Record<string, unknown>>({})
  const [simulateTargets, setSimulateTargets] = useState<SimulateTargets>({ buttons: [], hasEncoder: false, sensors: [] })
  const [paused, setPaused] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const sandboxRef = useRef<ScriptSandbox | null>(null)
  // Pause/resume is purely a "stop appending to what's displayed" toggle — the sandbox itself
  // keeps running and generating real entries the whole time (pausing the terminal must never
  // pause script execution), they're just buffered here instead of hitting `logs` until Resume,
  // so nothing is silently lost. A ref (not state) because it's read synchronously inside the
  // onLog callback, which can fire many times per render cycle during a burst of events.
  const pausedRef = useRef(false)
  const bufferedRef = useRef<SandboxLogEntry[]>([])

  if (!sandboxRef.current) {
    sandboxRef.current = new ScriptSandbox({
      onLog: (entry) => {
        if (pausedRef.current) {
          bufferedRef.current.push(entry)
          return
        }
        setLogs((prev) => [...prev.slice(-(LOG_RETENTION - 1)), entry])
      },
      onVariablesChange: setVariables,
      onRunningChange: setRunning,
      onSimulateTargetsChange: setSimulateTargets,
      onStartupError: setStartupError
    })
  }

  // Assigning `currentSandbox` here (not in the lazy-init block above) matters: React 18
  // StrictMode's dev-mode double-invoke runs mount -> cleanup -> mount again on first render,
  // and the *cleanup* nulls currentSandbox out — if the pointer were only ever set once during
  // the initial lazy-init (which doesn't re-run on the second mount, since sandboxRef.current is
  // already set by then), currentSandbox would stay permanently null and WidgetRenderer's
  // isSandboxRunning()/dispatchWidgetEvent() would silently never fire. Re-assigning on every
  // effect mount (including StrictMode's second one) keeps it correct in both dev and prod.
  useEffect(() => {
    currentSandbox = sandboxRef.current
    return () => {
      sandboxRef.current?.stop()
      if (currentSandbox === sandboxRef.current) currentSandbox = null
    }
  }, [])

  return {
    running,
    logs,
    variables,
    simulateTargets,
    paused,
    startupError,
    // A fresh Run/Restart is a fresh debugging session — clearing here (rather than leaving old
    // entries to intermix with the new run's output) is what makes "reruns the preview" one of
    // this terminal's two documented ways logs get cleared, the other being the explicit Clear
    // button (see clearLogs below). Stopping alone does NOT clear — you may still want to read the
    // final state after a run ends.
    start: () => {
      setLogs([])
      bufferedRef.current = []
      sandboxRef.current?.start()
    },
    stop: () => sandboxRef.current?.stop(),
    restart: () => {
      setLogs([])
      bufferedRef.current = []
      sandboxRef.current?.restart()
    },
    clearLogs: () => {
      setLogs([])
      bufferedRef.current = []
    },
    pause: () => {
      pausedRef.current = true
      setPaused(true)
    },
    resume: () => {
      pausedRef.current = false
      setPaused(false)
      if (bufferedRef.current.length > 0) {
        const buffered = bufferedRef.current
        bufferedRef.current = []
        setLogs((prev) => [...prev, ...buffered].slice(-LOG_RETENTION))
      }
    },
    simulateButtonPress: (name) => sandboxRef.current?.simulateButtonPress(name),
    simulateEncoderRotate: (direction) => sandboxRef.current?.simulateEncoderRotate(direction),
    simulateSensorChange: (name, value) => sandboxRef.current?.simulateSensorChange(name, value)
  }
}
