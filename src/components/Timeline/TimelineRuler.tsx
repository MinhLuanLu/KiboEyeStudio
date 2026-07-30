import { msToPx } from './timelineMath'

const NICE_INTERVALS_MS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]

/** Picks the smallest "nice" tick interval (1/2/5/10/20/... ms) whose on-screen spacing is at
 * least ~70px, so ruler labels never crowd together regardless of zoom level. */
function pickTickIntervalMs(pxPerMs: number): number {
  for (const interval of NICE_INTERVALS_MS) {
    if (interval * pxPerMs >= 70) return interval
  }
  return NICE_INTERVALS_MS[NICE_INTERVALS_MS.length - 1]
}

interface TimelineRulerProps {
  durationMs: number
  pxPerMs: number
  onSeek: (ms: number) => void
}

/** The millisecond ruler: click anywhere to seek (to the exact position the Timeline
 * container's own yellow hover line is already showing — see Timeline.tsx, which tracks
 * mouse position across the whole ruler+tracks area, not just this strip), plus adaptive tick
 * spacing so labels stay legible at any zoom. */
export function TimelineRuler({ durationMs, pxPerMs, onSeek }: TimelineRulerProps) {
  const interval = pickTickIntervalMs(pxPerMs)
  const ticks: number[] = []
  for (let t = 0; t <= durationMs; t += interval) ticks.push(t)

  const msFromEvent = (e: React.MouseEvent): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(durationMs, (e.clientX - rect.left) / pxPerMs))
  }

  return (
    <div
      className="relative h-6 border-b border-studio-border bg-studio-panel cursor-pointer select-none"
      style={{ width: Math.max(1, durationMs * pxPerMs) }}
      onClick={(e) => onSeek(msFromEvent(e))}
    >
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 bottom-0 border-l border-studio-border2" style={{ left: msToPx(t, pxPerMs) }}>
          <span className="absolute top-0 left-1 text-[9px] font-mono text-studio-muted whitespace-nowrap">{t}ms</span>
        </div>
      ))}
    </div>
  )
}
