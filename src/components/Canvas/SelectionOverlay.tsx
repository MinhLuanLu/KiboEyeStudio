import { useStore } from '@/state/store'
import { leftEyeParams, rightEyeParams } from '@/types'
import type { Project, StickerInstance } from '@/types'
import { eyeHitBox, type Box } from './canvasMath'

export type Selection =
  | { kind: 'sticker'; id: string }
  | { kind: 'eye'; side: 'left' | 'right' }
  | null

function findSticker(project: Project, id: string): StickerInstance | undefined {
  return (
    project.stickers.find((s) => s.id === id) ??
    project.expressions.flatMap((e) => e.stickers).find((s) => s.id === id) ??
    project.animations.flatMap((a) => a.stickers).find((s) => s.id === id)
  )
}

/**
 * Vector overlay drawn *inside* the transformed stage (pointer-events:none), in display pixels. Shows
 * the ESP32 display boundary, an optional snap grid, and the selection box for the currently-selected
 * element. It subscribes to the store so the box tracks live while dragging or editing numeric inputs.
 * Purely visual — never writes anything, so it can't affect export.
 */
export function SelectionOverlay({
  selected,
  showGrid,
  gridSize
}: {
  selected: Selection
  showGrid: boolean
  gridSize: number
}) {
  const project = useStore((s) => s.project)
  const display = project.display
  const w = display.width
  const h = display.height
  const cx0 = w / 2
  const cy0 = h / 2

  // Selection box in display-CENTRE coordinates → convert to absolute SVG coords by adding the centre.
  let box: Box | null = null
  if (selected?.kind === 'eye') {
    const p = selected.side === 'left' ? leftEyeParams(project) : rightEyeParams(project)
    box = eyeHitBox(p, selected.side)
  } else if (selected?.kind === 'sticker') {
    const s = findSticker(project, selected.id)
    if (s) box = { cx: s.x, cy: s.y, hw: (s.width / 2) * (s.scaleX / 100), hh: (s.height / 2) * (s.scaleY / 100) }
  }

  // Grid lines pass through the display centre so they align with snapped (centre-relative) positions.
  const gridLines: number[] = []
  if (showGrid && gridSize > 0) {
    for (let x = cx0; x <= w; x += gridSize) gridLines.push(x)
    for (let x = cx0 - gridSize; x >= 0; x -= gridSize) gridLines.push(x)
  }
  const gridLinesV: number[] = []
  if (showGrid && gridSize > 0) {
    for (let y = cy0; y <= h; y += gridSize) gridLinesV.push(y)
    for (let y = cy0 - gridSize; y >= 0; y -= gridSize) gridLinesV.push(y)
  }

  const boundary =
    display.shape === 'circle' ? (
      <circle cx={cx0} cy={cy0} r={Math.min(cx0, cy0)} />
    ) : (
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={display.shape === 'rounded' ? display.cornerRadius : 0} />
    )

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      {showGrid && (
        <g stroke="#5b8cff" strokeOpacity={0.16} strokeWidth={1} vectorEffect="non-scaling-stroke">
          {gridLines.map((x, i) => (
            <line key={`gx${i}`} x1={x} y1={0} x2={x} y2={h} />
          ))}
          {gridLinesV.map((y, i) => (
            <line key={`gy${i}`} x1={0} y1={y} x2={w} y2={y} />
          ))}
        </g>
      )}

      {/* ESP32 display boundary (e.g. 240×240 GC9A01) — kept crisp at any zoom. */}
      <g fill="none" stroke="#8b8c96" strokeOpacity={0.9} strokeWidth={1.5} vectorEffect="non-scaling-stroke">
        {boundary}
      </g>

      {box && (
        <g>
          <rect
            x={box.cx - box.hw + cx0}
            y={box.cy - box.hh + cy0}
            width={box.hw * 2}
            height={box.hh * 2}
            fill="none"
            stroke="#5b8cff"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          {/* corner handles */}
          {[
            [box.cx - box.hw + cx0, box.cy - box.hh + cy0],
            [box.cx + box.hw + cx0, box.cy - box.hh + cy0],
            [box.cx - box.hw + cx0, box.cy + box.hh + cy0],
            [box.cx + box.hw + cx0, box.cy + box.hh + cy0]
          ].map(([hx, hy], i) => (
            <rect key={i} x={hx - 3} y={hy - 3} width={6} height={6} fill="#5b8cff" vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      )}
    </svg>
  )
}
