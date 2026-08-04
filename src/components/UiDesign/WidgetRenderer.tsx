import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/state/store'
import type { UiAsset, UiWidget, UiWidgetType } from '@/types'
import { computeEffectiveStyle } from '@/lib/uiDesign/cssCascade'
import { clampRectToDisplayShape, rectFitsDisplayShape, uiDisplayShapeToDisplayShape } from '@/renderer/displayMask'
import { dispatchWidgetEvent, isSandboxRunning, subscribeAffectedWidget } from '@/lib/uiDesign/scriptLang/sandboxRuntime'
import { lvglSymbolById } from '@/lib/uiDesign/lvglSymbols'

const AFFECTED_HIGHLIGHT_MS = 400

const LONG_PRESS_MS = 600
const CLICK_MOVE_THRESHOLD = 4

function lengthToCss(v: UiWidget['style']['width']): string | undefined {
  if (v === undefined) return undefined
  if (v === 'auto') return 'auto'
  if (typeof v === 'number') return `${v}px`
  return v // already a `${number}%` template
}

/** Translates a widget's style bag to inline CSS. Every widget renders as a plain <div> (never
 * a native <button>/<input>/<select>) — LVGL's own widgets are all custom-drawn, not native
 * browser form controls, so matching that here sidesteps almost all of Tailwind's preflight
 * leakage automatically and keeps the live preview's fidelity tied to *our* CSS mapping, not
 * the browser's native-control theming. */
export function styleToCss(style: UiWidget['style']): React.CSSProperties {
  const css: React.CSSProperties = {
    position: 'absolute',
    left: style.x ?? 0,
    top: style.y ?? 0,
    width: lengthToCss(style.width),
    height: lengthToCss(style.height),
    marginTop: style.marginTop,
    marginRight: style.marginRight,
    marginBottom: style.marginBottom,
    marginLeft: style.marginLeft,
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    borderWidth: style.borderWidth,
    borderColor: style.borderColor,
    borderStyle: style.borderWidth ? 'solid' : undefined,
    borderRadius: style.borderRadius,
    background: style.backgroundGradient
      ? `linear-gradient(${style.backgroundGradient.direction === 'horizontal' ? '90deg' : '180deg'}, ${style.background ?? 'transparent'}, ${style.backgroundGradient.to})`
      : style.background,
    opacity: style.opacity !== undefined ? style.opacity / 100 : undefined,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    boxShadow:
      style.shadowWidth || style.shadowColor
        ? `${style.shadowOffsetX ?? 0}px ${style.shadowOffsetY ?? 0}px ${style.shadowWidth ?? 0}px ${style.shadowColor ?? 'rgba(0,0,0,0.4)'}`
        : undefined,
    display: style.visible === false ? 'none' : style.flexDirection ? 'flex' : undefined,
    zIndex: style.zIndex,
    flexDirection: style.flexDirection,
    flexWrap: style.flexWrap ? 'wrap' : undefined,
    justifyContent:
      style.justifyContent === 'start'
        ? 'flex-start'
        : style.justifyContent === 'end'
          ? 'flex-end'
          : style.justifyContent,
    alignItems: style.alignItems === 'start' ? 'flex-start' : style.alignItems === 'end' ? 'flex-end' : style.alignItems,
    gap: style.gap,
    overflow: style.overflow,
    // CSS object-fit has no 'stretch' keyword — LVGL/UiWidgetStyle's 'stretch' (ignore aspect
    // ratio, fill the box) is CSS's 'fill'.
    objectFit: style.imageFit === 'stretch' ? 'fill' : style.imageFit
  }
  return css
}

/** Resolves `style.backgroundImage` (an asset id — available on ANY widget kind, see
 * UiWidgetStyle's own comment) to real CSS, so a screen/container/button/etc. gets an actual
 * background picture, not just a background color. `backgroundSize` maps down to plain CSS
 * background-size/-repeat/-position — 'stretch' distorts to fill exactly, 'fit'/'fill' are the
 * standard contain/cover, 'center' shows the image at its natural size centered, and 'tile'
 * repeats it — the same handful of modes lvglExport.ts maps to LVGL's bg_img style props. */
export function backgroundImageCss(style: UiWidget['style'], assetsById: Map<string, UiAsset>): React.CSSProperties {
  if (!style.backgroundImage) return {}
  const asset = assetsById.get(style.backgroundImage)
  if (!asset) return {}
  const size = style.backgroundSize ?? 'fill'
  return {
    backgroundImage: `url(${asset.dataUrl})`,
    backgroundSize: size === 'stretch' ? '100% 100%' : size === 'fit' ? 'contain' : size === 'fill' ? 'cover' : size === 'tile' ? 'auto' : 'auto',
    backgroundRepeat: size === 'tile' ? 'repeat' : 'no-repeat',
    backgroundPosition: 'center'
  }
}

/** Merges `overrides` onto `base`, skipping any key whose override value is `undefined` —
 * a plain object spread would let styleToCss's always-present-but-undefined keys silently wipe
 * out these per-kind visual defaults, since a key set to `undefined` still "wins" in a spread. */
export function mergeDefined(base: React.CSSProperties, overrides: React.CSSProperties): React.CSSProperties {
  const out: React.CSSProperties = { ...base }
  for (const k in overrides) {
    const v = overrides[k as keyof React.CSSProperties]
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/** Baseline look for each widget kind, used only for style fields the user hasn't set —
 * approximates LVGL's default (light) theme closely enough to judge layout/spacing at a
 * glance. Not pixel-accurate to any specific LVGL theme; the exported C++ is the source of
 * truth for actual firmware appearance (see lib/export/lvglExport.ts). */
export const DEFAULT_VISUAL_CSS: Partial<Record<UiWidgetType, React.CSSProperties>> = {
  container: { background: 'transparent', border: '1px dashed #cbd5e1' },
  flex: { background: 'transparent', border: '1px dashed #cbd5e1', display: 'flex' },
  button: { background: '#2196f3', color: '#ffffff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  image: { background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 10 },
  icon: { background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 },
  switch: { background: '#cbd5e1', borderRadius: 999 },
  slider: { background: '#cbd5e1', borderRadius: 999 },
  bar: { background: '#e2e8f0', borderRadius: 4 },
  arc: { background: 'transparent', borderRadius: '50%' },
  checkbox: { background: 'transparent', display: 'flex', alignItems: 'center', gap: 6 },
  dropdown: { background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' },
  roller: { background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  textarea: { background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 4, padding: 6, color: '#94a3b8' },
  list: { background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'auto' },
  tabs: { background: 'transparent', display: 'flex', flexDirection: 'column' },
  spinner: { background: 'transparent' }
}

// 'button' is included so an Icon widget (or anything else) can be placed inside a button
// alongside its text label — reuses the existing generic child-widget system for "icon
// buttons" instead of adding a dedicated buttonIcon property.
export const CONTAINER_LIKE: ReadonlySet<UiWidgetType> = new Set(['screen', 'container', 'flex', 'list', 'tabs', 'button'])

function numProp(widget: UiWidget, key: string, fallback: number): number {
  const v = widget.props[key]
  return typeof v === 'number' ? v : fallback
}

/** Kind-specific inner content — thumbs/fills/ticks/etc — rendered inside the outer positioned
 * div. Purely presentational; the outer div (styled from widget.style, see WidgetRenderer)
 * already handles position/size/background/border for every kind uniformly. */
export function WidgetInner({ widget }: { widget: UiWidget }) {
  const asset = useStore((s) => (widget.src ? s.project.uiDesign.assets.find((a) => a.id === widget.src) : undefined))

  switch (widget.type) {
    case 'button':
    case 'label': {
      const symbol = lvglSymbolById(widget.iconSymbol)
      return (
        <>
          {symbol && <span style={{ marginRight: widget.text ? 4 : 0 }}>{symbol.glyph}</span>}
          {widget.text}
        </>
      )
    }
    case 'icon': {
      // An LVGL built-in symbol (see the Icon Picker) takes priority over a custom image — same
      // as button/label/checkbox below. Rendered as plain text (not an <img>) so it inherits
      // size/color from the outer div's own style.fontSize/style.color, exactly like any other
      // text — giving the icon independently adjustable size (font size) and color for free
      // through the existing generic style pipeline, on top of the position/size (x/y/width/
      // height) every widget already has.
      const symbol = lvglSymbolById(widget.iconSymbol)
      if (symbol) return <>{symbol.glyph}</>
      return asset ? (
        <img src={asset.dataUrl} alt="" className="max-w-full max-h-full" draggable={false} />
      ) : (
        <>{widget.text || '●'}</>
      )
    }
    case 'image':
      return asset ? (
        <img
          src={asset.dataUrl}
          alt=""
          className="w-full h-full"
          style={{ objectFit: widget.style.imageFit === 'stretch' ? 'fill' : (widget.style.imageFit ?? 'contain') }}
          draggable={false}
        />
      ) : (
        <>IMAGE</>
      )
    case 'switch': {
      const on = Boolean(widget.props.checked)
      return (
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: on ? '50%' : 2,
            width: 'calc(50% - 4px)',
            height: 'calc(100% - 4px)',
            borderRadius: 999,
            background: '#ffffff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            transition: 'left 0.15s'
          }}
        />
      )
    }
    case 'slider': {
      const min = numProp(widget, 'min', 0)
      const max = numProp(widget, 'max', 100)
      const value = numProp(widget, 'value', min)
      const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 999, background: '#2196f3' }} />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${pct}%`,
              width: 16,
              height: 16,
              marginLeft: -8,
              marginTop: -8,
              borderRadius: '50%',
              background: '#ffffff',
              border: '2px solid #2196f3'
            }}
          />
        </>
      )
    }
    case 'bar': {
      const min = numProp(widget, 'min', 0)
      const max = numProp(widget, 'max', 100)
      const value = numProp(widget, 'value', min)
      const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
      return <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 4, background: '#2196f3' }} />
    }
    case 'arc': {
      const min = numProp(widget, 'min', 0)
      const max = numProp(widget, 'max', 100)
      const value = numProp(widget, 'value', min)
      const frac = max > min ? (value - min) / (max - min) : 0
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `conic-gradient(#2196f3 ${frac * 360}deg, #e2e8f0 0deg)`,
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 8px))',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 8px))'
          }}
        />
      )
    }
    case 'checkbox': {
      const symbol = lvglSymbolById(widget.iconSymbol)
      return (
        <>
          <div
            style={{
              width: 16,
              height: 16,
              flexShrink: 0,
              border: '1.5px solid #2196f3',
              borderRadius: 3,
              background: widget.props.checked ? '#2196f3' : 'transparent'
            }}
          />
          {symbol && <span style={{ marginRight: widget.text ? 4 : 0 }}>{symbol.glyph}</span>}
          <span>{widget.text}</span>
        </>
      )
    }
    case 'dropdown': {
      const first = String(widget.props.options ?? '').split('\n')[0] ?? ''
      return (
        <>
          <span className="truncate">{first}</span>
          <span>{'▼'}</span>
        </>
      )
    }
    case 'roller': {
      const lines = String(widget.props.options ?? '').split('\n')
      return <span>{lines[Math.floor(lines.length / 2)] ?? ''}</span>
    }
    case 'textarea':
      return <>{String(widget.props.placeholder ?? '')}</>
    case 'spinner':
      return (
        <div
          style={{
            position: 'absolute',
            inset: 4,
            borderRadius: '50%',
            border: '3px solid #e2e8f0',
            borderTopColor: '#2196f3',
            animation: 'kibo-ui-spin 0.8s linear infinite'
          }}
        />
      )
    case 'tabs': {
      const names = String(widget.props.tabNames ?? '').split('\n').filter(Boolean)
      return (
        <div style={{ display: 'flex', flexDirection: 'row', borderBottom: '1px solid #cbd5e1' }}>
          {names.map((n, i) => (
            <div
              key={i}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                borderBottom: i === 0 ? '2px solid #2196f3' : '2px solid transparent',
                color: i === 0 ? '#2196f3' : '#64748b'
              }}
            >
              {n}
            </div>
          ))}
        </div>
      )
    }
    default:
      return null
  }
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RESIZE_HANDLES: { handle: ResizeHandle; cursor: string; style: React.CSSProperties }[] = [
  { handle: 'nw', cursor: 'nwse-resize', style: { top: -4, left: -4 } },
  { handle: 'n', cursor: 'ns-resize', style: { top: -4, left: '50%', marginLeft: -4 } },
  { handle: 'ne', cursor: 'nesw-resize', style: { top: -4, right: -4 } },
  { handle: 'e', cursor: 'ew-resize', style: { top: '50%', right: -4, marginTop: -4 } },
  { handle: 'se', cursor: 'nwse-resize', style: { bottom: -4, right: -4 } },
  { handle: 's', cursor: 'ns-resize', style: { bottom: -4, left: '50%', marginLeft: -4 } },
  { handle: 'sw', cursor: 'nesw-resize', style: { bottom: -4, left: -4 } },
  { handle: 'w', cursor: 'ew-resize', style: { top: '50%', left: -4, marginTop: -4 } }
]

const MIN_WIDGET_SIZE = 8

export function WidgetRenderer({ widgetId }: { widgetId: string }) {
  const widget = useStore((s) => s.project.uiDesign.widgets[widgetId])
  const cssRules = useStore((s) => s.project.uiDesign.css)
  const assets = useStore((s) => s.project.uiDesign.assets)
  const assetsById = new Map(assets.map((a) => [a.id, a]))
  const uiDisplay = useStore((s) => s.uiPreviewDisplayOverride ?? s.project.uiDesign.display)
  const display = { width: uiDisplay.width, height: uiDisplay.height, shape: uiDisplayShapeToDisplayShape(uiDisplay.shape) }
  const selectedWidgetId = useStore((s) => s.selectedWidgetId)
  const selectUiWidget = useStore((s) => s.selectUiWidget)
  const moveUiWidget = useStore((s) => s.moveUiWidget)
  const updateUiWidgetStyle = useStore((s) => s.updateUiWidgetStyle)
  const updateUiWidgetProps = useStore((s) => s.updateUiWidgetProps)
  const checkpoint = useStore((s) => s.checkpoint)
  const dragState = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const resizeState = useRef<{ handle: ResizeHandle; startClientX: number; startClientY: number; startX: number; startY: number; startWidth: number; startHeight: number } | null>(
    null
  )

  // A6: brief highlight when a running script's event handler fires on this widget or an action
  // actually mutates it (see sandboxRuntime.ts's subscribeAffectedWidget/notifyAffectedWidget) —
  // "highlight selected/affected component during testing" from the no-code spec. Subscribed
  // unconditionally (not gated on isSandboxRunning()) since the sandbox itself only ever notifies
  // while running; this hook just needs to exist for the widget's whole lifetime.
  const [affected, setAffected] = useState(false)
  const affectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return subscribeAffectedWidget((affectedId) => {
      if (affectedId !== widgetId) return
      setAffected(true)
      if (affectedTimer.current) clearTimeout(affectedTimer.current)
      affectedTimer.current = setTimeout(() => setAffected(false), AFFECTED_HIGHLIGHT_MS)
    })
  }, [widgetId])

  // widget.visible is the Layers-panel show/hide toggle (an editor/workspace concern, distinct
  // from the CSS-authored `style.visible` a user can set — see UiWidgetStyle) — hidden widgets
  // are skipped entirely on canvas, same as a hidden sticker layer.
  if (!widget || !widget.visible) return null

  if (widget.type === 'screen') {
    // The screen's own stored style (position/size) is unused for layout — the Canvas
    // component owns the outer box's size/shape from project.uiDesign.display, since a
    // display's dimensions are a project-wide setting, not something a Screen widget
    // independently tracks. This just fills that box so children position relative to it. It isn't
    // draggable/selectable like a normal widget — a bare click on it (nothing else caught the
    // pointer event first, since every other widget stops propagation) deselects.
    //
    // Background color/image DO apply here though (unlike position/size) — a screen's own
    // background is exactly what "every screen can have its own background image" means. Falls
    // through to transparent (showing Canvas.tsx's white box underneath) when unset.
    const screenEffectiveStyle = computeEffectiveStyle(widget, cssRules)
    return (
      <div
        data-widget-id={widget.id}
        className="kibo-ui-widget kibo-ui-widget--screen"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: screenEffectiveStyle.backgroundGradient
            ? `linear-gradient(${screenEffectiveStyle.backgroundGradient.direction === 'horizontal' ? '90deg' : '180deg'}, ${screenEffectiveStyle.background ?? 'transparent'}, ${screenEffectiveStyle.backgroundGradient.to})`
            : screenEffectiveStyle.background,
          opacity: screenEffectiveStyle.opacity !== undefined ? screenEffectiveStyle.opacity / 100 : undefined,
          ...backgroundImageCss(screenEffectiveStyle, assetsById)
        }}
        onPointerDown={() => selectUiWidget(null)}
      >
        {widget.childIds.map((id) => (
          <WidgetRenderer key={id} widgetId={id} />
        ))}
      </div>
    )
  }

  const isSelected = selectedWidgetId === widget.id

  // Select-on-click + pointer-drag move — same onPointerDown/Move/Up + getBoundingClientRect-
  // free delta math already used for sticker dragging in PreviewCanvas.tsx. stopPropagation so
  // dragging a child doesn't also drag/select its ancestor containers.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (widget.locked) return
    e.stopPropagation()
    selectUiWidget(widget.id)
    checkpoint()
    dragState.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: typeof widget.style.x === 'number' ? widget.style.x : 0,
      startY: typeof widget.style.y === 'number' ? widget.style.y : 0
    }
    // setPointerCapture is a robustness nicety (keeps the drag tracking even if the cursor
    // outruns the element) — it can throw in edge cases (e.g. the pointer id is no longer
    // active), which must not prevent dragState above from being set, so it's set first.
    try {
      ;(e.target as Element).setPointerCapture(e.pointerId)
    } catch {
      /* non-fatal — drag still works via bubbling pointermove */
    }

    // While a script is running (see LogicPanel.tsx's Run control), the canvas doubles as a
    // real interactive preview — pressed/longPress fire from here; click/released/valueChanged
    // resolve on pointer-up once we know whether this was a click or a drag. Design-time
    // select/drag above is unaffected either way.
    if (isSandboxRunning()) {
      longPressFired.current = false
      dispatchWidgetEvent(widget.id, 'pressed')
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true
        dispatchWidgetEvent(widget.id, 'longPress')
      }, LONG_PRESS_MS)
    }
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragState.current
    if (!drag) return
    e.stopPropagation()
    moveUiWidget(widget.id, drag.startX + (e.clientX - drag.startClientX), drag.startY + (e.clientY - drag.startClientY))
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragState.current
    if (!drag) return
    e.stopPropagation()
    dragState.current = null
    snapInsideDisplayIfNeeded()

    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (!isSandboxRunning()) return
    dispatchWidgetEvent(widget.id, 'released')
    const moved = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
    if (moved < CLICK_MOVE_THRESHOLD && !longPressFired.current) {
      dispatchWidgetEvent(widget.id, 'click')
      if (widget.type === 'switch' || widget.type === 'checkbox') {
        const next = !widget.props.checked
        updateUiWidgetProps(widget.id, { checked: next })
        dispatchWidgetEvent(widget.id, 'valueChanged', next)
      }
      return
    }
    // A drag (not a click) on a slider during Run sets its value from the drop position along
    // the track — the one widget kind this preview lets you actually operate by dragging.
    if (widget.type === 'slider') {
      const rect = (e.target as Element).getBoundingClientRect()
      const min = typeof widget.props.min === 'number' ? widget.props.min : 0
      const max = typeof widget.props.max === 'number' ? widget.props.max : 100
      const frac = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0
      const value = Math.round(min + frac * (max - min))
      updateUiWidgetProps(widget.id, { value })
      dispatchWidgetEvent(widget.id, 'valueChanged', value)
    }
  }

  // Soft-clamp back inside a circular display when a drag/resize ends outside it — skipped
  // entirely if the widget has allowOutsideBounds set (see the Properties panel's "Allow
  // outside display" checkbox), so a deliberately-placed off-display widget is never yanked
  // back. See renderer/displayMask.ts's clampRectToDisplayShape for the actual geometry.
  const snapInsideDisplayIfNeeded = () => {
    if (widget.allowOutsideBounds) return
    const rect = {
      x: typeof widget.style.x === 'number' ? widget.style.x : 0,
      y: typeof widget.style.y === 'number' ? widget.style.y : 0,
      width: typeof widget.style.width === 'number' ? widget.style.width : 0,
      height: typeof widget.style.height === 'number' ? widget.style.height : 0
    }
    const clamped = clampRectToDisplayShape(display, rect)
    if (clamped.x !== rect.x || clamped.y !== rect.y) moveUiWidget(widget.id, clamped.x, clamped.y)
  }

  // 8-handle resize — a new interaction pattern for this codebase (nothing else resizes via
  // handles; everywhere else width/height is slider- or number-field-driven). Each handle
  // adjusts a different combination of width/height/x/y depending on which edge/corner it's
  // on — e.g. dragging the "w" (west) handle grows width by -dx while also shifting x by dx,
  // so the opposite (east) edge stays put, matching how every other design tool's handles work.
  const startResize = (handle: ResizeHandle) => (e: React.PointerEvent) => {
    if (widget.locked) return
    e.stopPropagation()
    checkpoint()
    resizeState.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: typeof widget.style.x === 'number' ? widget.style.x : 0,
      startY: typeof widget.style.y === 'number' ? widget.style.y : 0,
      startWidth: typeof widget.style.width === 'number' ? widget.style.width : 0,
      startHeight: typeof widget.style.height === 'number' ? widget.style.height : 0
    }
    try {
      ;(e.target as Element).setPointerCapture(e.pointerId)
    } catch {
      /* non-fatal — resize still works via bubbling pointermove */
    }
  }
  const handleResizeMove = (e: React.PointerEvent) => {
    const r = resizeState.current
    if (!r) return
    e.stopPropagation()
    const dx = e.clientX - r.startClientX
    const dy = e.clientY - r.startClientY
    const wantsW = r.handle.includes('w')
    const wantsE = r.handle.includes('e')
    const wantsN = r.handle.includes('n')
    const wantsS = r.handle.includes('s')

    let x = r.startX
    let y = r.startY
    let width = r.startWidth
    let height = r.startHeight

    if (wantsE) width = Math.max(MIN_WIDGET_SIZE, r.startWidth + dx)
    if (wantsS) height = Math.max(MIN_WIDGET_SIZE, r.startHeight + dy)
    if (wantsW) {
      width = Math.max(MIN_WIDGET_SIZE, r.startWidth - dx)
      x = r.startX + (r.startWidth - width)
    }
    if (wantsN) {
      height = Math.max(MIN_WIDGET_SIZE, r.startHeight - dy)
      y = r.startY + (r.startHeight - height)
    }

    updateUiWidgetStyle(widget.id, { x, y, width, height })
  }
  const handleResizeUp = (e: React.PointerEvent) => {
    if (!resizeState.current) return
    e.stopPropagation()
    resizeState.current = null
    snapInsideDisplayIfNeeded()
  }

  const effectiveStyle = computeEffectiveStyle(widget, cssRules)
  // Rotation/scale are scoped to image/icon widgets only (LVGL's lv_img_set_angle/lv_img_set_zoom)
  // — see UiWidgetStyle's own comments for why these aren't general widget transforms.
  const isImageLike = widget.type === 'image' || widget.type === 'icon'
  const transformParts: string[] = []
  if (isImageLike && effectiveStyle.rotation) transformParts.push(`rotate(${effectiveStyle.rotation}deg)`)
  if (isImageLike && effectiveStyle.scale !== undefined && effectiveStyle.scale !== 1) transformParts.push(`scale(${effectiveStyle.scale})`)
  const css = mergeDefined(DEFAULT_VISUAL_CSS[widget.type] ?? {}, {
    ...styleToCss(effectiveStyle),
    ...backgroundImageCss(effectiveStyle, assetsById),
    transform: transformParts.length > 0 ? transformParts.join(' ') : undefined
  })

  // Runtime-only "disabled" state, set by the script API's widget.setEnabled(false)/.disable()
  // (see scriptLang/actionTable.ts) via widget.props.disabled — a live.props mutation, not a
  // persisted design property, matching how props.value already drives bar/slider/arc live.
  const isDisabled = Boolean(widget.props.disabled)

  const outOfBounds =
    !widget.allowOutsideBounds &&
    !rectFitsDisplayShape(display, {
      x: typeof widget.style.x === 'number' ? widget.style.x : 0,
      y: typeof widget.style.y === 'number' ? widget.style.y : 0,
      width: typeof widget.style.width === 'number' ? widget.style.width : 0,
      height: typeof widget.style.height === 'number' ? widget.style.height : 0
    })

  const commonProps = {
    'data-widget-id': widget.id,
    'data-out-of-bounds': outOfBounds || undefined,
    className: `kibo-ui-widget kibo-ui-widget--${widget.type}`,
    style: {
      ...css,
      position: 'absolute' as const,
      outline: affected ? '2px solid #22c55e' : isSelected ? '1.5px solid #4fa8ff' : outOfBounds ? '1.5px dashed #ef4444' : undefined,
      outlineOffset: affected || isSelected || outOfBounds ? 1 : undefined,
      boxShadow: affected ? '0 0 8px 2px rgba(34,197,94,0.6)' : (css.boxShadow as string | undefined),
      cursor: widget.locked ? 'default' : 'grab',
      opacity: isDisabled ? ((css.opacity as number | undefined) ?? 1) * 0.5 : css.opacity,
      pointerEvents: isDisabled ? ('none' as const) : undefined
    },
    title: outOfBounds ? 'Outside the visible display area' : undefined,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp
  }

  return (
    <div {...commonProps}>
      <WidgetInner widget={widget} />
      {CONTAINER_LIKE.has(widget.type) && widget.childIds.map((id) => <WidgetRenderer key={id} widgetId={id} />)}
      {isSelected &&
        !widget.locked &&
        RESIZE_HANDLES.map(({ handle, cursor, style }) => (
          <div
            key={handle}
            onPointerDown={startResize(handle)}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeUp}
            style={{
              position: 'absolute',
              width: 8,
              height: 8,
              background: '#4fa8ff',
              border: '1px solid #ffffff',
              borderRadius: 2,
              cursor,
              zIndex: 1000,
              ...style
            }}
          />
        ))}
    </div>
  )
}
