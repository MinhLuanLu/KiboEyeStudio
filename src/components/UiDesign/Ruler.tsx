import { computeStageTransform, type UiCanvasSize } from '@/lib/uiDesign/canvasZoom'
import type { UiDragPreview } from '@/state/store'

const NICE_INTERVALS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]
const RULER_THICKNESS = 18

/** Picks the smallest "nice" logical-px interval whose on-screen spacing (interval * zoom) is
 * still readable, the same adaptive-tick-spacing idea every design tool's rulers use. */
function pickInterval(zoom: number, minScreenSpacing = 40): number {
  return NICE_INTERVALS.find((i) => i * zoom >= minScreenSpacing) ?? NICE_INTERVALS[NICE_INTERVALS.length - 1]
}

/** Horizontal + vertical rulers around the display preview. Rendered OUTSIDE the canvas stage's
 * zoom/pan transform (real screen px, positioned via the same `computeStageTransform` Canvas.tsx
 * itself uses) so tick labels always show the actual, untransformed LVGL pixel coordinate — the
 * same convention used everywhere else in this codebase for "preview scale never leaks into the
 * numbers that matter." Drag markers (left/right/top/bottom/center-x/center-y) are read from the
 * shared `uiDragPreview` store field so they can never disagree with the position-info panel. */
export function CanvasRulers({
  viewportSize,
  display,
  view,
  dragPreview
}: {
  viewportSize: UiCanvasSize
  display: UiCanvasSize
  view: { zoom: number; panX: number; panY: number }
  dragPreview: UiDragPreview | null
}) {
  const transform = computeStageTransform(viewportSize, display, view)
  const interval = pickInterval(view.zoom)

  const startX = Math.floor(-transform.tx / view.zoom / interval) * interval
  const endX = Math.ceil((viewportSize.width - transform.tx) / view.zoom / interval) * interval
  const xTicks: number[] = []
  for (let v = startX; v <= endX; v += interval) xTicks.push(v)

  const startY = Math.floor(-transform.ty / view.zoom / interval) * interval
  const endY = Math.ceil((viewportSize.height - transform.ty) / view.zoom / interval) * interval
  const yTicks: number[] = []
  for (let v = startY; v <= endY; v += interval) yTicks.push(v)

  const markerValuesX: number[] = []
  const markerValuesY: number[] = []
  if (dragPreview) {
    const { x, y, width, height } = dragPreview.rect
    markerValuesX.push(x, x + width / 2, x + width)
    markerValuesY.push(y, y + height / 2, y + height)
  }

  return (
    <>
      <div
        className="absolute left-0 top-0 right-0 bg-studio-panel2/90 border-b border-studio-border pointer-events-none overflow-hidden z-20"
        style={{ height: RULER_THICKNESS }}
      >
        {xTicks.map((v) => (
          <div
            key={v}
            className="absolute top-0 bottom-0 border-l border-studio-border/60 text-[9px] text-studio-muted pl-0.5 leading-[18px]"
            style={{ left: transform.tx + v * view.zoom }}
          >
            {v}
          </div>
        ))}
        {markerValuesX.map((v, i) => (
          <div
            key={i}
            className="absolute bottom-0 w-0 h-0"
            style={{
              left: transform.tx + v * view.zoom - 4,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderBottom: '5px solid var(--studio-accent, #4fa8ff)'
            }}
          />
        ))}
      </div>
      <div
        className="absolute left-0 top-0 bottom-0 bg-studio-panel2/90 border-r border-studio-border pointer-events-none overflow-hidden z-20"
        style={{ width: RULER_THICKNESS }}
      >
        {yTicks.map((v) => (
          <div key={v} className="absolute left-0 right-0 border-t border-studio-border/60 text-[8px] text-studio-muted pl-px" style={{ top: transform.ty + v * view.zoom }}>
            {v}
          </div>
        ))}
        {markerValuesY.map((v, i) => (
          <div
            key={i}
            className="absolute right-0 w-0 h-0"
            style={{
              top: transform.ty + v * view.zoom - 4,
              borderTop: '4px solid transparent',
              borderBottom: '4px solid transparent',
              borderRight: '5px solid var(--studio-accent, #4fa8ff)'
            }}
          />
        ))}
      </div>
      <div className="absolute left-0 top-0 bg-studio-panel2 border-r border-b border-studio-border z-30" style={{ width: RULER_THICKNESS, height: RULER_THICKNESS }} />
    </>
  )
}
