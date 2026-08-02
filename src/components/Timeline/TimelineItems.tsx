import type { TrackKind } from '@/types'
import { msToPx, trackAccentClasses } from './timelineMath'

interface KeyframeDiamondProps {
  trackKind: TrackKind
  timeMs: number
  pxPerMs: number
  selected: boolean
  locked: boolean
  onPointerDown: (e: React.PointerEvent) => void
  title: string
}

/** One keyframe on any of the 5 keyframe tracks (pose/leftEye/rightEye/pupils/eyelids) — a
 * 45°-rotated diamond positioned by its absolute `timeMs`, matching the pre-existing single-
 * track Timeline's visual language. Purely presentational — all interaction (select/multi-
 * select/drag) is wired by the caller via onPointerDown, same pattern the old Timeline.tsx used. */
export function KeyframeDiamond({ trackKind, timeMs, pxPerMs, selected, locked, onPointerDown, title }: KeyframeDiamondProps) {
  const accent = trackAccentClasses(trackKind)
  return (
    <button
      onPointerDown={locked ? undefined : onPointerDown}
      className={`absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 transition-colors ${
        selected ? `${accent.dot} ${accent.border}` : `bg-studio-panel border-studio-border2 hover:${accent.border}`
      } ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
      style={{ left: msToPx(timeMs, pxPerMs) }}
      title={title}
    />
  )
}

interface ClipViewProps {
  trackKind: TrackKind
  startMs: number
  endMs: number | null
  durationMs: number
  pxPerMs: number
  selected: boolean
  locked: boolean
  label: string
  /** True while this clip is the one currently driving playback (e.g. a Combination clip the
   * playhead is inside of right now) — an extra highlight ring layered on top of `selected`,
   * distinct from it (a clip can be selected but not playing, or playing but not selected).
   * Defaults false; unused by keyframe/sticker/marker callers today. */
  active?: boolean
  onBodyPointerDown: (e: React.PointerEvent) => void
  onStartHandlePointerDown: (e: React.PointerEvent) => void
  onEndHandlePointerDown: (e: React.PointerEvent) => void
}

/** A ranged clip (sticker instance, Combination clip, or in future an expression/effect clip) —
 * a rectangular block spanning [startMs, endMs] with visible drag handles on both edges.
 * `endMs === null` (a sticker with no configured end) renders as an open-ended clip stretching
 * to the track's full width, per StickerAnimSettings.endTimeMs's "null = stays visible
 * indefinitely" contract. */
export function ClipView({ trackKind, startMs, endMs, durationMs, pxPerMs, selected, locked, label, active, onBodyPointerDown, onStartHandlePointerDown, onEndHandlePointerDown }: ClipViewProps) {
  const accent = trackAccentClasses(trackKind)
  const left = msToPx(startMs, pxPerMs)
  const width = Math.max(6, msToPx((endMs ?? durationMs) - startMs, pxPerMs))
  return (
    <div
      className={`absolute top-1 bottom-1 rounded-md border overflow-hidden ${
        active
          ? `${accent.border} bg-studio-accent2/25 shadow-[0_0_0_1px_rgba(124,92,255,0.6)]`
          : selected
            ? `${accent.border} bg-studio-accent/30`
            : 'border-studio-border2 bg-studio-panel2 hover:bg-studio-border2/60'
      } ${locked ? 'opacity-50' : ''}`}
      style={{ left, width }}
    >
      <div
        className={`absolute inset-0 flex items-center px-2 text-[11px] truncate select-none ${locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
        onPointerDown={locked ? undefined : onBodyPointerDown}
        title={label}
      >
        {active && <span className="mr-1 text-studio-accent2 shrink-0">▶</span>}
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${accent.dot}`} />
        <span className="truncate">{label}</span>
        {endMs === null && <span className="ml-1 text-studio-muted shrink-0">→</span>}
      </div>
      {!locked && (
        <>
          <div
            className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/20"
            onPointerDown={onStartHandlePointerDown}
          />
          {endMs !== null && (
            <div
              className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/20"
              onPointerDown={onEndHandlePointerDown}
            />
          )}
        </>
      )}
    </div>
  )
}

interface MarkerFlagProps {
  timeMs: number
  pxPerMs: number
  selected: boolean
  label: string
  onPointerDown: (e: React.PointerEvent) => void
}

/** A studio-only labeled point-in-time annotation, rendered as a small flag/pin. */
export function MarkerFlag({ timeMs, pxPerMs, selected, label, onPointerDown }: MarkerFlagProps) {
  return (
    <button
      onPointerDown={onPointerDown}
      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[9px] border-l-transparent border-r-transparent cursor-grab active:cursor-grabbing ${
        selected ? 'border-t-studio-danger' : 'border-t-studio-muted hover:border-t-studio-danger'
      }`}
      style={{ left: msToPx(timeMs, pxPerMs) }}
      title={label}
    />
  )
}
