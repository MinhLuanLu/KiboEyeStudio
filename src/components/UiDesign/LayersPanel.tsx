import { useStore } from '@/state/store'
import type { UiWidget } from '@/types'
import { UI_WIDGET_LABELS } from '@/types'
import { rectFitsDisplayShape, uiDisplayShapeToDisplayShape } from '@/renderer/displayMask'

function LayerRow({ widget, depth }: { widget: UiWidget; depth: number }) {
  const widgets = useStore((s) => s.project.uiDesign.widgets)
  const uiDisplay = useStore((s) => s.project.uiDesign.display)
  const display = { width: uiDisplay.width, height: uiDisplay.height, shape: uiDisplayShapeToDisplayShape(uiDisplay.shape) }
  const selectedWidgetId = useStore((s) => s.selectedWidgetId)
  const selectUiWidget = useStore((s) => s.selectUiWidget)
  const setUiWidgetVisible = useStore((s) => s.setUiWidgetVisible)
  const setUiWidgetLocked = useStore((s) => s.setUiWidgetLocked)
  const duplicateUiWidget = useStore((s) => s.duplicateUiWidget)
  const deleteUiWidget = useStore((s) => s.deleteUiWidget)
  const checkpoint = useStore((s) => s.checkpoint)

  const isSelected = selectedWidgetId === widget.id
  const isScreen = widget.type === 'screen'
  const outOfBounds =
    !isScreen &&
    !widget.allowOutsideBounds &&
    !rectFitsDisplayShape(display, {
      x: typeof widget.style.x === 'number' ? widget.style.x : 0,
      y: typeof widget.style.y === 'number' ? widget.style.y : 0,
      width: typeof widget.style.width === 'number' ? widget.style.width : 0,
      height: typeof widget.style.height === 'number' ? widget.style.height : 0
    })

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer text-xs ${
          isSelected ? 'bg-studio-accent/20 border border-studio-accent/40' : 'hover:bg-studio-panel2 border border-transparent'
        } ${!widget.visible ? 'opacity-40' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => selectUiWidget(widget.id)}
      >
        <span className="flex-1 truncate">
          {UI_WIDGET_LABELS[widget.type]}
          {widget.tagId && <span className="text-studio-muted"> #{widget.tagId}</span>}
          {outOfBounds && (
            <span className="ml-1 text-studio-danger" title="Outside the visible display area">
              ⚠
            </span>
          )}
        </span>
        {!isScreen && (
          <>
            <button
              title={widget.visible ? 'Hide' : 'Show'}
              className="hidden group-hover:inline text-studio-muted hover:text-studio-text px-1"
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                setUiWidgetVisible(widget.id, !widget.visible)
              }}
            >
              {widget.visible ? '👁' : '🚫'}
            </button>
            <button
              title={widget.locked ? 'Unlock' : 'Lock'}
              className="hidden group-hover:inline text-studio-muted hover:text-studio-text px-1"
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                setUiWidgetLocked(widget.id, !widget.locked)
              }}
            >
              {widget.locked ? '🔒' : '🔓'}
            </button>
            <button
              title="Duplicate"
              className="hidden group-hover:inline text-studio-muted hover:text-studio-text px-1"
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                duplicateUiWidget(widget.id)
              }}
            >
              ⧉
            </button>
            <button
              title="Delete"
              className="hidden group-hover:inline text-studio-muted hover:text-studio-danger px-1"
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                deleteUiWidget(widget.id)
              }}
            >
              ✕
            </button>
          </>
        )}
      </div>
      {widget.childIds.map((childId) => {
        const child = widgets[childId]
        return child ? <LayerRow key={childId} widget={child} depth={depth + 1} /> : null
      })}
    </div>
  )
}

// Widget tree with visibility/lock/duplicate/delete — reorder-within-parent is available via
// reorderUiWidget (wired once drag-reorder lands here; selection + the per-row actions above
// already cover the M3 scope). Mirrors StickerManagerPanel.tsx's list-row action pattern.
export function LayersPanel() {
  const uiDesign = useStore((s) => s.project.uiDesign)
  const widgets = useStore((s) => s.project.uiDesign.widgets)
  const activeScreen = uiDesign.screens.find((s) => s.id === uiDesign.activeScreenId) ?? uiDesign.screens[0]
  const root = activeScreen ? widgets[activeScreen.rootWidgetId] : null

  if (!root) {
    return <div className="p-3 text-sm text-studio-muted">No screen selected.</div>
  }

  return (
    <div className="p-2 flex flex-col gap-0.5">
      <LayerRow widget={root} depth={0} />
    </div>
  )
}
