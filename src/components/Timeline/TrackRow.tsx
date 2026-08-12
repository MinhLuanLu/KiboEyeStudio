import { useState } from 'react'
import type { Keyframe, Marker, StickerInstance, Track } from '@/types'
import { useStore } from '@/state/store'
import type { KeyframeTrackKind } from '@/state/store'
import { KeyframeDiamond, ClipView, MarkerFlag } from './TimelineItems'
import { msToFrame, TRACK_HEADER_WIDTH_PX, TRACK_ROW_HEIGHT_PX, trackAccentClasses } from './timelineMath'

/** The sticker track header's own "+" — a small asset picker, independent of the Sticker
 * Manager panel's scope-based add, so a sticker clip can be created directly on a specific
 * Timeline track without leaving the Timeline. Uses the store directly (like TimelineInspector
 * does for its own leaf-level concerns) rather than threading the asset list through
 * Timeline.tsx as yet another prop. */
function AddStickerButton({ onPick }: { onPick: (assetId: string) => void }) {
  const assets = useStore((s) => s.project.stickerAssets)
  const [open, setOpen] = useState(false)
  return (
    <span className="relative shrink-0">
      <button
        className="text-xs text-studio-muted hover:text-studio-accent w-4"
        title="Add a sticker to this track (at the playhead)"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        +
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-48 max-h-56 overflow-y-auto studio-panel border border-studio-border rounded-md shadow-lg z-30 p-1 flex flex-col gap-0.5"
          onMouseLeave={() => setOpen(false)}
        >
          {assets.length === 0 && <span className="text-[11px] text-studio-muted p-1.5">No sticker assets yet — import one in the Stickers panel.</span>}
          {assets.map((a) => (
            <button
              key={a.id}
              className="text-left px-2 py-1 rounded hover:bg-studio-panel2 text-xs truncate"
              onClick={() => {
                onPick(a.id)
                setOpen(false)
              }}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/** One Combination clip laid out on the synthetic 'comboClip' track — a plain data shape
 * (not AnimationComboClip directly) since TrackRow/ClipView only need the resolved timeline
 * position, not the clip's own loop/speed/transition fields (those are edited in
 * TimelineInspector). `active` mirrors ClipView's own prop — true for whichever clip
 * sampleCombo() says is currently playing. */
export interface ComboClipLayout {
  id: string
  startMs: number
  durationMs: number
  label: string
  active: boolean
}

interface TrackRowProps {
  track: Track
  pxPerMs: number
  durationMs: number
  fps: number
  keyframes?: Keyframe[]
  stickers?: StickerInstance[]
  markers?: Marker[]
  comboClips?: ComboClipLayout[]
  isSelected: (id: string) => boolean
  onKeyframePointerDown?: (trackKind: KeyframeTrackKind, keyframeId: string, timeMs: number, e: React.PointerEvent) => void
  onStickerBodyPointerDown?: (stickerId: string, e: React.PointerEvent) => void
  onStickerHandlePointerDown?: (stickerId: string, edge: 'start' | 'end', e: React.PointerEvent) => void
  /** Sticker keyframe diamonds (rendered over each sticker's clip). */
  onStickerKeyframePointerDown?: (stickerId: string, keyframeId: string, timeMs: number, e: React.PointerEvent) => void
  isStickerKeyframeSelected?: (stickerId: string, keyframeId: string) => boolean
  onMarkerPointerDown?: (markerId: string, e: React.PointerEvent) => void
  onComboClipBodyPointerDown?: (clipId: string, e: React.PointerEvent) => void
  onComboClipHandlePointerDown?: (clipId: string, edge: 'start' | 'end', e: React.PointerEvent) => void
  onToggleVisible: () => void
  onToggleLocked: () => void
  onRemove?: () => void
  onRename?: (name: string) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  canDetach?: boolean
  onDetach?: () => void
  /** Only meaningful for kind:'sticker' tracks — renders the header's "+" asset picker. */
  onAddStickerAsset?: (assetId: string) => void
}

/** One horizontal lane: a fixed-width header (name/visibility/lock/remove) plus a scrollable
 * body rendering whatever this track's `kind` holds — keyframe diamonds, sticker clips, or
 * marker flags. Purely presentational/dispatch — every interaction is wired by the Timeline
 * container via the callback props, matching TimelineItems' leaf components. */
export function TrackRow({
  track,
  pxPerMs,
  durationMs,
  fps,
  keyframes,
  stickers,
  markers,
  comboClips,
  isSelected,
  onKeyframePointerDown,
  onStickerBodyPointerDown,
  onStickerHandlePointerDown,
  onStickerKeyframePointerDown,
  isStickerKeyframeSelected,
  onMarkerPointerDown,
  onComboClipBodyPointerDown,
  onComboClipHandlePointerDown,
  onToggleVisible,
  onToggleLocked,
  onRemove,
  onRename,
  onMoveUp,
  onMoveDown,
  canDetach,
  onDetach,
  onAddStickerAsset
}: TrackRowProps) {
  const accent = trackAccentClasses(track.kind)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(track.name)

  const trackKind = track.kind as KeyframeTrackKind

  return (
    <div className="flex" style={{ height: TRACK_ROW_HEIGHT_PX }}>
      <div
        className="sticky left-0 z-10 shrink-0 flex items-center gap-1.5 px-2 border-r border-b border-studio-border bg-studio-panel"
        style={{ width: TRACK_HEADER_WIDTH_PX }}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${accent.dot}`} />
        {renaming ? (
          <input
            autoFocus
            className="flex-1 min-w-0 bg-studio-panel2 border border-studio-border rounded px-1 text-xs"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (nameDraft.trim() && onRename) onRename(nameDraft.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setNameDraft(track.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-xs"
            onDoubleClick={() => onRename && setRenaming(true)}
            title={track.name}
          >
            {track.name}
          </span>
        )}
        {(onMoveUp || onMoveDown) && (
          <span className="flex flex-col shrink-0 -space-y-1">
            <button className="text-[9px] leading-none text-studio-muted hover:text-studio-text disabled:opacity-30" disabled={!onMoveUp} onClick={onMoveUp} title="Move track up">
              &#9650;
            </button>
            <button className="text-[9px] leading-none text-studio-muted hover:text-studio-text disabled:opacity-30" disabled={!onMoveDown} onClick={onMoveDown} title="Move track down">
              &#9660;
            </button>
          </span>
        )}
        {onAddStickerAsset && <AddStickerButton onPick={onAddStickerAsset} />}
        <button
          className="text-xs text-studio-muted hover:text-studio-text w-4 shrink-0"
          title={track.visible ? 'Hide (mute)' : 'Show'}
          onClick={onToggleVisible}
        >
          {track.visible ? '\u{1F441}' : '–'}
        </button>
        <button
          className="text-xs text-studio-muted hover:text-studio-text w-4 shrink-0"
          title={track.locked ? 'Unlock' : 'Lock'}
          onClick={onToggleLocked}
        >
          {track.locked ? '\u{1F512}' : '\u{1F513}'}
        </button>
        {onRemove && (
          <button className="text-xs text-studio-muted hover:text-studio-danger w-4 shrink-0" title="Delete track" onClick={onRemove}>
            &times;
          </button>
        )}
      </div>

      <div
        className={`relative flex-1 border-b border-studio-border ${track.visible ? 'bg-studio-panel2/40' : 'bg-studio-panel2/10'}`}
        style={{ width: durationMs * pxPerMs }}
      >
        {track.kind !== 'sticker' && track.kind !== 'marker' && (keyframes?.length ?? 0) === 0 && canDetach && (
          <button
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-studio-muted hover:text-studio-accent border border-dashed border-studio-border2 rounded px-1.5 py-0.5"
            onClick={onDetach}
            title="Give this track its own independently-timed keyframes, starting from the Expression track's current pose"
          >
            + Diverge from Expression
          </button>
        )}

        {keyframes?.map((k, i) => (
          <KeyframeDiamond
            key={k.id}
            trackKind={track.kind}
            timeMs={k.timeMs}
            pxPerMs={pxPerMs}
            selected={isSelected(k.id)}
            locked={track.locked}
            onPointerDown={(e) => onKeyframePointerDown?.(trackKind, k.id, k.timeMs, e)}
            title={`Keyframe ${i + 1} — Frame ${msToFrame(k.timeMs, fps)} · ${Math.round(k.timeMs)}ms`}
          />
        ))}

        {stickers?.map((s) => (
          <ClipView
            key={s.id}
            trackKind="sticker"
            startMs={s.anim.startTimeMs}
            endMs={s.anim.endTimeMs}
            durationMs={durationMs}
            pxPerMs={pxPerMs}
            selected={isSelected(s.id)}
            locked={track.locked || s.locked}
            label={s.name}
            onBodyPointerDown={(e) => onStickerBodyPointerDown?.(s.id, e)}
            onStartHandlePointerDown={(e) => onStickerHandlePointerDown?.(s.id, 'start', e)}
            onEndHandlePointerDown={(e) => onStickerHandlePointerDown?.(s.id, 'end', e)}
          />
        ))}

        {/* Sticker keyframe diamonds, laid over each sticker's clip (absolute timeMs). */}
        {stickers?.flatMap((s) =>
          (s.keyframes ?? []).map((k, i) => (
            <KeyframeDiamond
              key={`${s.id}:${k.id}`}
              trackKind="sticker"
              timeMs={k.timeMs}
              pxPerMs={pxPerMs}
              selected={isStickerKeyframeSelected?.(s.id, k.id) ?? false}
              locked={track.locked || s.locked}
              onPointerDown={(e) => onStickerKeyframePointerDown?.(s.id, k.id, k.timeMs, e)}
              title={`${s.name} keyframe ${i + 1} — Frame ${msToFrame(k.timeMs, fps)} · ${Math.round(k.timeMs)}ms`}
            />
          ))
        )}

        {markers?.map((m) => (
          <MarkerFlag
            key={m.id}
            timeMs={m.timeMs}
            pxPerMs={pxPerMs}
            selected={isSelected(m.id)}
            label={`${m.label || 'Marker'} — ${Math.round(m.timeMs)}ms`}
            onPointerDown={(e) => onMarkerPointerDown?.(m.id, e)}
          />
        ))}

        {comboClips?.map((c) => (
          <ClipView
            key={c.id}
            trackKind="comboClip"
            startMs={c.startMs}
            endMs={c.startMs + c.durationMs}
            durationMs={durationMs}
            pxPerMs={pxPerMs}
            selected={isSelected(c.id)}
            locked={track.locked}
            active={c.active}
            label={c.label}
            onBodyPointerDown={(e) => onComboClipBodyPointerDown?.(c.id, e)}
            onStartHandlePointerDown={(e) => onComboClipHandlePointerDown?.(c.id, 'start', e)}
            onEndHandlePointerDown={(e) => onComboClipHandlePointerDown?.(c.id, 'end', e)}
          />
        ))}
      </div>
    </div>
  )
}
