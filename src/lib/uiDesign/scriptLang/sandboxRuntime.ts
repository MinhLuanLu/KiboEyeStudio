import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/state/store'
import type { UiWidget, UiWidgetStyle } from '@/types'
import { selectAll, selectFirst } from '@/lib/uiDesign/selectors'
import { parseScript } from './parser'
import { applyTextEdits, type TextEdit } from './textSplice'
import { walkAllNodes } from './astWalk'
import { ACTION_TABLE, type PreviewActionCtx } from './actionTable'

// Live-preview execution — runs the ACTUAL script text via the browser's own JS engine
// (`new Function(...)`, not the Acorn AST) so preview behavior uses genuine JS semantics for
// free, matching this codebase's "lean on the real platform instead of writing an interpreter"
// precedent (DOMParser/CSSOM for HTML/CSS). The Acorn AST is used here only for two narrow,
// preview-specific conveniences: (a) the Variable Inspector (mirroring top-level let/const onto
// an externally-readable object via a small keyword-only source splice) and (b) locating
// `.bindText/.bindValue/.bindVisible(...)` calls anywhere in the script so their argument
// expressions can be re-evaluated on every tick (see BINDING_METHODS below). C++ export
// (codegen.ts) is a completely separate walk of the untouched AST — this file never feeds into it.

export type SandboxLogKind = 'log' | 'warn' | 'error' | 'event'

export interface SandboxLogEntry {
  id: number
  kind: SandboxLogKind
  message: string
  timestamp: number
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

class ScriptSandbox {
  private cb: SandboxCallbacks
  private timers = new Set<number>()
  private eventHandlers = new Map<string, Record<string, ((...a: unknown[]) => void)[]>>()
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
    const state = useStore.getState()
    const uiDesign = state.project.uiDesign
    const source = uiDesign.script
    const parsed = parseScript(source)
    if (!parsed.program) {
      this.log('error', `Line ${parsed.errors[0]?.line ?? 1}: ${parsed.errors[0]?.message ?? 'Could not parse script.'}`)
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

    this.running = true
    this.cb.onRunningChange(true)

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('ui', 'hardware', 'console', 'data', '__vars', '__bindingsHolder', fullSource)
      fn(uiSandbox, hardwareSandbox, consoleSandbox, dataSandbox, this.varsProxy, this.bindingsHolder)
    } catch (err) {
      this.logError(err)
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
    this.cb.onRunningChange(false)
    this.cb.onVariablesChange({})
    this.cb.onSimulateTargetsChange({ buttons: [], hasEncoder: false, sensors: [] })
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
    this.log('event', `${event} on ${w?.tagId ?? widgetId}`)
    notifyAffectedWidget(widgetId)
    for (const h of handlers) {
      try {
        h(...args)
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
    proxy.on = (event: string, handler: (...a: unknown[]) => void) => {
      const forWidget = this.eventHandlers.get(widget.id) ?? {}
      forWidget[event] = [...(forWidget[event] ?? []), handler]
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
      error: (...args: unknown[]) => this.log('error', args.map(stringifyLogArg).join(' '))
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

  private logError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    let line: number | undefined
    if (err instanceof Error && err.stack) {
      const m = err.stack.match(/<anonymous>:(\d+):\d+/)
      if (m) line = Number(m[1])
    }
    this.log('error', line ? `Line ${line}: ${message}` : message)
  }

  private log(kind: SandboxLogKind, message: string): void {
    this.cb.onLog({ id: this.nextLogId++, kind, message, timestamp: Date.now() })
  }
}

function stringifyLogArg(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
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

export interface ScriptSandboxApi {
  running: boolean
  logs: SandboxLogEntry[]
  variables: Record<string, unknown>
  simulateTargets: SimulateTargets
  start: () => void
  stop: () => void
  restart: () => void
  clearLogs: () => void
  simulateButtonPress: (name: string) => void
  simulateEncoderRotate: (direction: number) => void
  simulateSensorChange: (name: string, value: number) => void
}

export function useScriptSandbox(): ScriptSandboxApi {
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<SandboxLogEntry[]>([])
  const [variables, setVariables] = useState<Record<string, unknown>>({})
  const [simulateTargets, setSimulateTargets] = useState<SimulateTargets>({ buttons: [], hasEncoder: false, sensors: [] })
  const sandboxRef = useRef<ScriptSandbox | null>(null)

  if (!sandboxRef.current) {
    sandboxRef.current = new ScriptSandbox({
      onLog: (entry) => setLogs((prev) => [...prev.slice(-199), entry]),
      onVariablesChange: setVariables,
      onRunningChange: setRunning,
      onSimulateTargetsChange: setSimulateTargets
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
    start: () => sandboxRef.current?.start(),
    stop: () => sandboxRef.current?.stop(),
    restart: () => sandboxRef.current?.restart(),
    clearLogs: () => setLogs([]),
    simulateButtonPress: (name) => sandboxRef.current?.simulateButtonPress(name),
    simulateEncoderRotate: (direction) => sandboxRef.current?.simulateEncoderRotate(direction),
    simulateSensorChange: (name, value) => sandboxRef.current?.simulateSensorChange(name, value)
  }
}
