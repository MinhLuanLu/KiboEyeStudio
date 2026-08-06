import { useStore } from '@/state/store'

/** Renders inside the display box (same logical-px coordinate space top-level widgets use — see
 * DragInfoPanel's own doc comment for the identical nested-widget caveat) — reads the shared
 * `uiDragPreview.guides`/`.spacing` fields written by WidgetRenderer's drag/resize handlers (via
 * lib/uiDesign/snapEngine.ts) so this can never disagree with what actually snapped. Guides
 * disappear the instant `uiDragPreview` clears on pointer-up, directly satisfying "the guide
 * should disappear after the drag operation finishes." */
export function AlignmentGuides() {
  const dragPreview = useStore((s) => s.uiDragPreview)
  const guidesVisible = useStore((s) => s.uiWorkspaceView.guidesVisible)

  if (!guidesVisible || !dragPreview) return null

  return (
    <>
      {dragPreview.guides.map((g, i) => (
        <div key={i} className="absolute pointer-events-none" style={g.axis === 'x' ? { left: g.value, top: 0, bottom: 0, width: 0, borderLeft: '1px solid #ef4444' } : { top: g.value, left: 0, right: 0, height: 0, borderTop: '1px solid #ef4444' }}>
          {g.label && (
            <span
              className="absolute bg-red-500 text-white text-[9px] px-1 py-0.5 rounded whitespace-nowrap"
              style={g.axis === 'x' ? { top: 4, left: 4 } : { left: 4, top: -14 }}
            >
              {g.label}
            </span>
          )}
        </div>
      ))}
      {dragPreview.spacing.map((s, i) => (
        <span
          key={i}
          className="absolute bg-studio-accent text-white text-[9px] px-1 py-0.5 rounded pointer-events-none whitespace-nowrap"
          style={{ left: s.x, top: s.y, transform: 'translate(-50%, -50%)' }}
        >
          {Math.round(s.distancePx)} px
        </span>
      ))}
    </>
  )
}
