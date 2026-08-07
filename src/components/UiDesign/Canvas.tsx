import { useEffect, useRef } from 'react'
import { useStore } from '@/state/store'
import { WidgetRenderer } from './WidgetRenderer'
import { readAssetDragPayload, readComponentTemplateDragPayload, readWidgetDragPayload } from '@/lib/uiDesign/dnd'
import { UI_SRC_IMAGE_WIDGETS } from '@/types'
import { clampUiZoom, computeStageTransform, zoomAroundPoint } from '@/lib/uiDesign/canvasZoom'
import { CanvasRulers } from './Ruler'
import { DragInfoPanel } from './DragInfoPanel'
import { AlignmentGuides } from './AlignmentGuides'

/** Live design canvas — a real, size/shape-matched DOM box (not a canvas-2D rendering) so the
 * preview's box-model/flex/text behavior is genuine browser CSS, not a hand-rolled layout
 * engine. Sized/shaped from project.uiDesign.display — UI Design Mode's own display config,
 * completely separate from project.display (Eye Studio's) — with an optional ephemeral
 * `uiPreviewDisplayOverride` for the Display panel's "Preview as..." (never touches the saved
 * project, see that field's own comment in store.ts).
 *
 * Zoom/pan (see lib/uiDesign/canvasZoom.ts) is a single CSS `transform` applied to a `stage` div
 * wrapping the otherwise completely unchanged display box below — every widget still renders at
 * its real 1:1 logical px (WidgetRenderer's styleToCss is untouched), so the exported LVGL
 * x/y/width/height values can never be affected by the preview scale. The viewport itself never
 * natively scrolls (`overflow: hidden`) — panning is purely the transform's translate component. */
export function Canvas() {
  const previewOverride = useStore((s) => s.uiPreviewDisplayOverride)
  const display = useStore((s) => s.uiPreviewDisplayOverride ?? s.project.uiDesign.display)
  const uiDesign = useStore((s) => s.project.uiDesign)
  const addUiWidget = useStore((s) => s.addUiWidget)
  const addUiComponentTemplate = useStore((s) => s.addUiComponentTemplate)
  const setUiWidgetSrc = useStore((s) => s.setUiWidgetSrc)
  const updateUiWidgetStyle = useStore((s) => s.updateUiWidgetStyle)
  const checkpoint = useStore((s) => s.checkpoint)
  const view = useStore((s) => s.uiWorkspaceView)
  const updateUiWorkspaceView = useStore((s) => s.updateUiWorkspaceView)
  const setUiCanvasViewportSize = useStore((s) => s.setUiCanvasViewportSize)
  const viewportSize = useStore((s) => s.uiCanvasViewportSize)
  const dragPreview = useStore((s) => s.uiDragPreview)
  const viewportRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const activeScreen = uiDesign.screens.find((s) => s.id === uiDesign.activeScreenId) ?? uiDesign.screens[0]

  const borderRadius = display.shape === 'round' ? '50%' : '0px'

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    // A synchronous initial measurement, not just ResizeObserver's own async first callback —
    // ResizeObserver is spec-required to deliver one immediately on observe() in every real
    // browser, but relying on that alone means the very first render (before that callback
    // lands) computes the stage transform from a {0,0} fallback, visibly popping the display box
    // into its correctly-centered position a frame later instead of starting there.
    const rect = el.getBoundingClientRect()
    setUiCanvasViewportSize({ width: rect.width, height: rect.height })
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setUiCanvasViewportSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setUiCanvasViewportSize])

  const transform = computeStageTransform(viewportSize ?? { width: 0, height: 0 }, display, view)

  // Grid overlay — a repeating-linear-gradient background sized in the stage's own local px
  // units, so the ancestor `transform: scale()` above naturally scales the rendered line spacing
  // right along with every widget (no separate zoom-aware math needed here). Two line weights
  // (major = every gridSize px, minor = gridSubdivision-per-major) approximate a real design-tool
  // grid; gridOpacity is one multiplier over both so "Opacity" in the Workspace tab controls the
  // whole overlay's visibility in one knob rather than two. Shown when the user's own "Show grid"
  // toggle is on, OR — the Pixel-Accurate Mode spec's own "auto-show the pixel grid at high zoom
  // (>=400%) so individual LVGL pixels are visually countable" behavior — regardless of that
  // toggle once zoomed in far enough for individual pixels to matter.
  const gridActive = view.gridVisible || (view.pixelAccurateMode && view.zoom >= 4)
  const minorGridSize = Math.max(1, view.gridSize / Math.max(1, view.gridSubdivision))
  const gridBackgroundImage = [
    'linear-gradient(to right, rgba(255,255,255,0.4) 1px, transparent 1px)',
    'linear-gradient(to bottom, rgba(255,255,255,0.4) 1px, transparent 1px)',
    'linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px)',
    'linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)'
  ].join(', ')
  const gridBackgroundSize = `${view.gridSize}px ${view.gridSize}px, ${view.gridSize}px ${view.gridSize}px, ${minorGridSize}px ${minorGridSize}px, ${minorGridSize}px ${minorGridSize}px`

  const handleWheel = (e: React.WheelEvent) => {
    const viewportEl = viewportRef.current
    if (!viewportEl || !viewportSize) return
    const isZoomGesture = e.ctrlKey || e.metaKey
    if (!isZoomGesture) {
      // Plain wheel = pan (Shift+wheel swaps axes, the standard trackpad/mouse convention).
      e.preventDefault()
      const dx = e.shiftKey ? e.deltaY : e.deltaX
      const dy = e.shiftKey ? 0 : e.deltaY
      updateUiWorkspaceView({ panX: view.panX - dx, panY: view.panY - dy })
      return
    }
    // Ctrl+wheel, or a trackpad pinch (browsers report pinch as a wheel event with
    // ctrlKey: true — standard, well-known browser behavior) = zoom around the cursor.
    e.preventDefault()
    const viewportRect = viewportEl.getBoundingClientRect()
    const zoomFactor = Math.exp(-e.deltaY * 0.01)
    const next = zoomAroundPoint(e.clientX, e.clientY, viewportRect, viewportSize, display, view, clampUiZoom(view.zoom * zoomFactor))
    updateUiWorkspaceView(next)
  }

  // Every other widget kind drops straight onto the screen root (this app has no general
  // "drop into an existing container" mechanism — nesting under `container`/`flex` today only
  // happens via component templates or hand-editing the HTML text). A Data List's own `childIds`
  // IS its item template (see UiDataListConfig's doc comment) — without a way to actually drop
  // widgets into it, the template couldn't be built with the ordinary Toolbox/Properties-panel
  // tools at all, so this is the one targeted exception: dropping onto (or inside) an existing
  // `dataList` widget parents there instead of at the root, with the drop position measured
  // relative to that widget's own box (matching how `style.x/y` already behaves for any nested
  // widget — position:absolute nesting, not display-global coordinates).
  const resolveDropTarget = (e: React.DragEvent, screenRect: DOMRect): { parentId: string; originLeft: number; originTop: number } => {
    const hitEl = (e.target as Element).closest<HTMLElement>('[data-widget-id]')
    let hitWidget = hitEl ? uiDesign.widgets[hitEl.dataset.widgetId ?? ''] : undefined
    while (hitWidget && hitWidget.type !== 'dataList' && hitWidget.parentId) {
      hitWidget = uiDesign.widgets[hitWidget.parentId]
    }
    if (hitWidget?.type === 'dataList') {
      const targetEl = boxRef.current?.querySelector<HTMLElement>(`[data-widget-id="${hitWidget.id}"]`)
      const targetRect = targetEl?.getBoundingClientRect()
      if (targetRect) return { parentId: hitWidget.id, originLeft: targetRect.left, originTop: targetRect.top }
    }
    return { parentId: activeScreen.rootWidgetId, originLeft: screenRect.left, originTop: screenRect.top }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect) return
    // rect/originLeft/originTop come from real DOM getBoundingClientRect() calls, which already
    // report screen-accurate (zoomed) positions for elements inside the transformed stage — so
    // only the raw client-pixel DELTA needs dividing by zoom to land back in the logical px
    // space `UiWidget.style.x/y` live in (see canvasZoom.ts's own top comment).
    const zoom = view.zoom

    const assetId = readAssetDragPayload(e)
    if (assetId) {
      // Dropped an asset from the Asset Manager. If it landed on an existing (non-screen)
      // widget, assign the asset to that widget (src for Image/Icon, backgroundImage for
      // everything else) instead of creating a new one — matches "drag onto a button/screen/
      // panel/card to become its background/icon."
      const targetEl = (e.target as Element).closest<HTMLElement>('[data-widget-id]')
      const targetWidget = targetEl ? uiDesign.widgets[targetEl.dataset.widgetId ?? ''] : undefined
      checkpoint()
      if (targetWidget && targetWidget.type !== 'screen') {
        if (UI_SRC_IMAGE_WIDGETS.has(targetWidget.type)) setUiWidgetSrc(targetWidget.id, assetId)
        else updateUiWidgetStyle(targetWidget.id, { backgroundImage: assetId })
      } else {
        const newId = addUiWidget('image', activeScreen.rootWidgetId, Math.round((e.clientX - rect.left) / zoom), Math.round((e.clientY - rect.top) / zoom))
        setUiWidgetSrc(newId, assetId)
      }
      return
    }

    const templateId = readComponentTemplateDragPayload(e)
    if (templateId) {
      checkpoint()
      addUiComponentTemplate(templateId, activeScreen.rootWidgetId, Math.round((e.clientX - rect.left) / zoom), Math.round((e.clientY - rect.top) / zoom))
      return
    }

    const type = readWidgetDragPayload(e)
    if (!type) return
    checkpoint()
    const target = resolveDropTarget(e, rect)
    addUiWidget(type, target.parentId, Math.round((e.clientX - target.originLeft) / zoom), Math.round((e.clientY - target.originTop) / zoom))
  }

  if (!activeScreen) {
    return <div className="p-4 text-sm text-studio-muted">No screen — this shouldn't happen; the project always seeds one.</div>
  }

  return (
    <div ref={viewportRef} className="relative h-full w-full overflow-hidden" onWheel={handleWheel}>
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.zoom})`, transformOrigin: '0 0' }}
      >
        <div
          ref={boxRef}
          className="relative shrink-0"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          style={{
            width: display.width,
            height: display.height,
            borderRadius,
            background: display.backgroundColor ?? '#ffffff',
            overflow: 'hidden',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px rgba(0,0,0,0.4)',
            // Explicit reset so descendants inherit a clean baseline instead of the app's own
            // dark-theme chrome (body has text-studio-text/antialiased/Inter globally) — this is
            // what an LVGL default-theme screen actually starts from.
            color: '#000000',
            fontFamily: 'Montserrat, Arial, sans-serif',
            fontSize: 14
          }}
        >
          {gridActive && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ backgroundImage: gridBackgroundImage, backgroundSize: gridBackgroundSize, opacity: view.gridOpacity / 100 }}
            />
          )}

          <WidgetRenderer widgetId={activeScreen.rootWidgetId} />

          {/* Round-display safe area guide — a user-configurable px margin (Workspace tab), not
              a hardcoded percentage. Helps avoid placing important content where a circular
              bezel would crop it; a soft guide, not a hard constraint. */}
          {display.shape === 'round' && view.safeAreaVisible && (
            <div
              className="absolute rounded-full border border-dashed border-studio-accent/40 pointer-events-none"
              style={{ inset: view.safeAreaMargin }}
              title="Safe design area — content outside this guide is closer to the bezel edge"
            />
          )}

          {/* Center crosshair + horizontal/vertical diameter guides — round displays only, tied
              to the same safe-area toggle since both exist to help center/align content relative
              to a circular bezel. */}
          {display.shape === 'round' && view.safeAreaVisible && (
            <>
              <div className="absolute pointer-events-none" style={{ left: 0, right: 0, top: display.height / 2, height: 0, borderTop: '1px dashed rgba(79,168,255,0.3)' }} />
              <div className="absolute pointer-events-none" style={{ top: 0, bottom: 0, left: display.width / 2, width: 0, borderLeft: '1px dashed rgba(79,168,255,0.3)' }} />
              <div
                className="absolute rounded-full bg-studio-accent pointer-events-none"
                style={{ left: display.width / 2 - 2, top: display.height / 2 - 2, width: 4, height: 4 }}
                title={`Display center (${Math.round(display.width / 2)}, ${Math.round(display.height / 2)})`}
              />
            </>
          )}

          {/* Positioned relative to the display box, so this is exactly correct for a top-level
              (direct screen child) widget — the overwhelming majority of drags. A nested widget's
              uiDragPreview.rect is parent-relative (see WidgetRenderer's own isTopLevelWidget
              doc comment), so the panel lands near its parent's origin rather than the nested
              widget itself in that case; a documented approximation, not a silent bug. */}
          <DragInfoPanel display={{ width: display.width, height: display.height, shape: display.shape }} />
          <AlignmentGuides />
        </div>
      </div>

      {view.rulersVisible && <CanvasRulers viewportSize={viewportSize ?? { width: 0, height: 0 }} display={display} view={view} dragPreview={dragPreview} />}

      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-studio-muted bg-studio-panel/80 rounded px-2 py-0.5 pointer-events-none">
        {Math.round(display.width)} × {Math.round(display.height)} · {display.shape}
        {previewOverride && ' (preview)'} · {Math.round(view.zoom * 100)}%
      </span>
    </div>
  )
}
