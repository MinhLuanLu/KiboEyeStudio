import type { UiWidgetType } from '@/types'

/** Native HTML5 DnD MIME type used to drag a widget kind from the Toolbox onto the Canvas —
 * no drag-and-drop library, same "plain browser APIs" approach as this codebase's existing
 * native-HTML5-drag layer-reordering (StickerManagerPanel.tsx). */
export const UI_WIDGET_DND_TYPE = 'application/x-kibo-ui-widget-type'

export function setWidgetDragPayload(e: React.DragEvent, type: UiWidgetType): void {
  e.dataTransfer.setData(UI_WIDGET_DND_TYPE, type)
  e.dataTransfer.effectAllowed = 'copy'
}

export function readWidgetDragPayload(e: React.DragEvent): UiWidgetType | null {
  const type = e.dataTransfer.getData(UI_WIDGET_DND_TYPE)
  return type ? (type as UiWidgetType) : null
}

/** Same pattern, for dragging an asset out of the Asset Manager onto the Canvas (see
 * AssetManagerPanel.tsx's drag source and Canvas.tsx's onDrop, which checks this payload type
 * before falling back to readWidgetDragPayload). */
export const UI_ASSET_DND_TYPE = 'application/x-kibo-ui-asset-id'

export function setAssetDragPayload(e: React.DragEvent, assetId: string): void {
  e.dataTransfer.setData(UI_ASSET_DND_TYPE, assetId)
  e.dataTransfer.effectAllowed = 'copy'
}

export function readAssetDragPayload(e: React.DragEvent): string | null {
  const id = e.dataTransfer.getData(UI_ASSET_DND_TYPE)
  return id || null
}
