import { useStore } from '@/state/store'
import type { UiPositionInfoField } from '@/types'
import { classifyWidgetVisibility, uiDisplayShapeToDisplayShape } from '@/renderer/displayMask'

const VISIBILITY_LABELS: Record<string, string> = {
  'fully-visible': 'Fully visible',
  'partially-clipped': 'Partially clipped',
  'outside-safe-area': 'Outside safe area',
  'outside-display': 'Outside display'
}
const VISIBILITY_COLORS: Record<string, string> = {
  'fully-visible': '#22c55e',
  'outside-safe-area': '#f59e0b',
  'partially-clipped': '#f97316',
  'outside-display': '#ef4444'
}

const FIELD_LABELS: Record<UiPositionInfoField, string> = {
  x: 'X',
  y: 'Y',
  width: 'W',
  height: 'H',
  centerX: 'Center X',
  centerY: 'Center Y',
  distanceFromScreenCenter: 'Dist. center',
  distanceFromParentEdges: 'Dist. parent (L,T,R,B)',
  rotation: 'Rotation',
  zoomLevel: 'Zoom'
}

/** Floating info panel shown near a widget while it's being dragged/resized — reads the same
 * `uiDragPreview` store field the rulers/guides do (see that field's own doc comment) so it can
 * never disagree with what's actually happening on screen. Rendered INSIDE the canvas stage (so
 * it tracks pan/zoom automatically along with the widget) but with its own counter
 * `scale(1/zoom)` so the text stays a constant, readable screen size at every zoom level —
 * directly satisfies "the information panel must remain readable at every workspace zoom level." */
export function DragInfoPanel({ display }: { display: { width: number; height: number; shape: 'round' | 'square' | 'rectangle' | 'custom' } }) {
  const dragPreview = useStore((s) => s.uiDragPreview)
  const fields = useStore((s) => s.uiWorkspaceView.positionInfoFields)
  const zoom = useStore((s) => s.uiWorkspaceView.zoom)
  const safeAreaMargin = useStore((s) => s.uiWorkspaceView.safeAreaMargin)
  const widgets = useStore((s) => s.project.uiDesign.widgets)

  if (!dragPreview) return null
  const { rect } = dragPreview
  const widget = widgets[dragPreview.widgetId]
  const parent = widget?.parentId ? widgets[widget.parentId] : undefined
  const parentBounds =
    parent && typeof parent.style.width === 'number' && typeof parent.style.height === 'number' ? { width: parent.style.width, height: parent.style.height } : display
  // Only meaningful for a top-level widget — a nested widget's rect is parent-relative, not
  // display-relative (see WidgetRenderer's own isTopLevelWidget doc comment).
  const isTopLevel = widget?.parentId ? widgets[widget.parentId]?.type === 'screen' : true
  const visibility = isTopLevel ? classifyWidgetVisibility({ width: display.width, height: display.height, shape: uiDisplayShapeToDisplayShape(display.shape) }, rect, safeAreaMargin) : null

  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const rotation = widget && typeof widget.style.rotation === 'number' ? widget.style.rotation : 0

  const values: Record<UiPositionInfoField, string> = {
    x: `${Math.round(rect.x)}`,
    y: `${Math.round(rect.y)}`,
    width: `${Math.round(rect.width)}`,
    height: `${Math.round(rect.height)}`,
    centerX: `${Math.round(centerX)}`,
    centerY: `${Math.round(centerY)}`,
    distanceFromScreenCenter: `${Math.round(Math.hypot(centerX - display.width / 2, centerY - display.height / 2))}`,
    distanceFromParentEdges: `${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(parentBounds.width - (rect.x + rect.width))}, ${Math.round(parentBounds.height - (rect.y + rect.height))}`,
    rotation: `${Math.round(rotation)}°`,
    zoomLevel: `${Math.round(zoom * 100)}%`
  }

  return (
    <div
      className="absolute pointer-events-none bg-studio-panel2/95 border border-studio-border rounded px-2 py-1 text-[10px] leading-tight text-studio-text whitespace-nowrap shadow-lg z-40"
      style={{ left: rect.x + rect.width + 8, top: rect.y, transform: `scale(${1 / zoom})`, transformOrigin: '0 0' }}
    >
      {fields.map((f) => (
        <div key={f}>
          <span className="text-studio-muted">{FIELD_LABELS[f]}:</span> {values[f]}
        </div>
      ))}
      {visibility && (
        <div className="mt-0.5 pt-0.5 border-t border-studio-border font-medium" style={{ color: VISIBILITY_COLORS[visibility] }}>
          {VISIBILITY_LABELS[visibility]}
        </div>
      )}
    </div>
  )
}
