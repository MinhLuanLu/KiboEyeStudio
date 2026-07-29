import { UI_TOOLBOX_WIDGETS, UI_WIDGET_LABELS } from '@/types'
import { setWidgetDragPayload } from '@/lib/uiDesign/dnd'

/** Drag source for placing widgets on the Canvas — plain native HTML5 DnD (draggable +
 * dataTransfer), same technique already used elsewhere in this codebase (sticker layer
 * reordering), no new dependency. Canvas.tsx's onDrop reads the payload and calls
 * addUiWidget(). */
export function Toolbox() {
  return (
    <div className="p-2 grid grid-cols-2 gap-1.5">
      {UI_TOOLBOX_WIDGETS.map((type) => (
        <div
          key={type}
          draggable
          onDragStart={(e) => setWidgetDragPayload(e, type)}
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-2 text-xs text-center cursor-grab active:cursor-grabbing hover:border-studio-accent select-none"
          title={`Drag onto the canvas to add a ${UI_WIDGET_LABELS[type]}`}
        >
          {UI_WIDGET_LABELS[type]}
        </div>
      ))}
    </div>
  )
}
