import { useRef } from 'react'
import { useStore } from '@/state/store'
import { WidgetRenderer } from './WidgetRenderer'
import { readAssetDragPayload, readComponentTemplateDragPayload, readWidgetDragPayload } from '@/lib/uiDesign/dnd'
import { UI_SRC_IMAGE_WIDGETS } from '@/types'

/** Live design canvas — a real, size/shape-matched DOM box (not a canvas-2D rendering) so the
 * preview's box-model/flex/text behavior is genuine browser CSS, not a hand-rolled layout
 * engine. Sized/shaped from project.uiDesign.display — UI Design Mode's own display config,
 * completely separate from project.display (Eye Studio's) — with an optional ephemeral
 * `uiPreviewDisplayOverride` for the Display panel's "Preview as..." (never touches the saved
 * project, see that field's own comment in store.ts). */
export function Canvas() {
  const previewOverride = useStore((s) => s.uiPreviewDisplayOverride)
  const display = useStore((s) => s.uiPreviewDisplayOverride ?? s.project.uiDesign.display)
  const uiDesign = useStore((s) => s.project.uiDesign)
  const addUiWidget = useStore((s) => s.addUiWidget)
  const addUiComponentTemplate = useStore((s) => s.addUiComponentTemplate)
  const setUiWidgetSrc = useStore((s) => s.setUiWidgetSrc)
  const updateUiWidgetStyle = useStore((s) => s.updateUiWidgetStyle)
  const checkpoint = useStore((s) => s.checkpoint)
  const boxRef = useRef<HTMLDivElement>(null)
  const activeScreen = uiDesign.screens.find((s) => s.id === uiDesign.activeScreenId) ?? uiDesign.screens[0]

  const borderRadius = display.shape === 'round' ? '50%' : '0px'

  if (!activeScreen) {
    return <div className="p-4 text-sm text-studio-muted">No screen — this shouldn't happen; the project always seeds one.</div>
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
        const newId = addUiWidget('image', activeScreen.rootWidgetId, Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top))
        setUiWidgetSrc(newId, assetId)
      }
      return
    }

    const templateId = readComponentTemplateDragPayload(e)
    if (templateId) {
      checkpoint()
      addUiComponentTemplate(templateId, activeScreen.rootWidgetId, Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top))
      return
    }

    const type = readWidgetDragPayload(e)
    if (!type) return
    checkpoint()
    const target = resolveDropTarget(e, rect)
    addUiWidget(type, target.parentId, Math.round(e.clientX - target.originLeft), Math.round(e.clientY - target.originTop))
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center overflow-auto p-6 gap-2">
      <div
        ref={boxRef}
        className="relative shrink-0"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          width: display.width,
          height: display.height,
          borderRadius,
          background: '#ffffff',
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
        <WidgetRenderer widgetId={activeScreen.rootWidgetId} />

        {/* Round-display safe area guide — purely visual, helps avoid placing important
            content where a circular bezel would crop it. Inset is a common rule-of-thumb
            margin for round smartwatch-style UIs, not a hard constraint. */}
        {display.shape === 'round' && (
          <div
            className="absolute rounded-full border border-dashed border-studio-accent/40"
            style={{ inset: '12%', pointerEvents: 'none' }}
            title="Safe design area — content outside this guide is closer to the bezel edge"
          />
        )}
      </div>
      <span className="text-[11px] text-studio-muted">
        {Math.round(display.width)} × {Math.round(display.height)} · {display.shape}
        {previewOverride && ' (preview)'}
      </span>
    </div>
  )
}
