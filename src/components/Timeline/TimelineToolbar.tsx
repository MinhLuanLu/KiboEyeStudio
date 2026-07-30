import { useState } from 'react'
import type { TrackKind } from '@/types'
import { msToFrame, MIN_PX_PER_MS, MAX_PX_PER_MS } from './timelineMath'

const ADDABLE_FIXED_TRACKS: { kind: TrackKind; label: string }[] = [
  { kind: 'leftEye', label: 'Left Eye' },
  { kind: 'rightEye', label: 'Right Eye' },
  { kind: 'pupils', label: 'Pupils' },
  { kind: 'eyelids', label: 'Eyelids' },
  { kind: 'marker', label: 'Markers' }
]

interface TimelineToolbarProps {
  animName: string
  durationMs: number
  playbackTimeMs: number
  fps: number
  pxPerMs: number
  onZoomChange: (pxPerMs: number) => void
  onZoomToFit: () => void
  snappingEnabled: boolean
  onToggleSnapping: () => void
  /** Fixed track kinds already present on the active animation — hidden from the "+ Track"
   * menu so it only ever offers tracks that don't exist yet (each fixed kind is a singleton). */
  existingTrackKinds: Set<TrackKind>
  onAddTrack: (kind: TrackKind) => void
  onAddKeyframe: () => void
  hasSelection: boolean
  canPaste: boolean
  onSplit: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onDuplicate: () => void
  onDelete: () => void
  onJumpPrevKeyframe: () => void
  onJumpNextKeyframe: () => void
}

/** The Timeline's top toolbar: transport-adjacent readouts (time/frame/fps), zoom + snap
 * controls, +Keyframe / +Track, and the selection-driven edit actions (split/copy/cut/paste/
 * duplicate/delete) — enabled/disabled based on whether anything is selected/copied. */
export function TimelineToolbar({
  animName,
  durationMs,
  playbackTimeMs,
  fps,
  pxPerMs,
  onZoomChange,
  onZoomToFit,
  snappingEnabled,
  onToggleSnapping,
  existingTrackKinds,
  onAddTrack,
  onAddKeyframe,
  hasSelection,
  canPaste,
  onSplit,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onDelete,
  onJumpPrevKeyframe,
  onJumpNextKeyframe
}: TimelineToolbarProps) {
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const addableFixed = ADDABLE_FIXED_TRACKS.filter((t) => !existingTrackKinds.has(t.kind))

  return (
    <div className="flex items-center gap-3 px-1 pb-2 flex-wrap text-xs">
      <div className="flex items-center gap-2 font-mono text-studio-muted">
        <span className="text-studio-text font-sans font-medium">{animName}</span>
        <span>·</span>
        <span title="Playhead">{Math.round(Math.min(playbackTimeMs, durationMs))}ms</span>
        <span title="Frame">F{msToFrame(playbackTimeMs, fps)}</span>
        <span title="FPS">{fps}fps</span>
        <span>·</span>
        <span title="Total duration">{Math.round(durationMs)}ms total</span>
      </div>

      <div className="flex items-center gap-1 ml-auto">
        <button className="studio-btn px-2 py-1" title="Previous keyframe" onClick={onJumpPrevKeyframe}>
          |&lt;
        </button>
        <button className="studio-btn px-2 py-1" title="Next keyframe" onClick={onJumpNextKeyframe}>
          &gt;|
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button className="studio-btn px-2 py-1" onClick={onAddKeyframe} title="Add a keyframe at the playhead">
          + Keyframe
        </button>
        <button className="studio-btn px-2 py-1" disabled={!hasSelection} onClick={onSplit} title="Split at Playhead">
          Split
        </button>
        <button className="studio-btn px-2 py-1" disabled={!hasSelection} onClick={onCopy} title="Copy (Ctrl/Cmd+C)">
          Copy
        </button>
        <button className="studio-btn px-2 py-1" disabled={!hasSelection} onClick={onCut} title="Cut (Ctrl/Cmd+X)">
          Cut
        </button>
        <button className="studio-btn px-2 py-1" disabled={!canPaste} onClick={onPaste} title="Paste at Playhead (Ctrl/Cmd+V)">
          Paste
        </button>
        <button className="studio-btn px-2 py-1" disabled={!hasSelection} onClick={onDuplicate} title="Duplicate (Ctrl/Cmd+D)">
          Duplicate
        </button>
        <button className="studio-btn px-2 py-1" disabled={!hasSelection} onClick={onDelete} title="Delete">
          Delete
        </button>
      </div>

      <div className="relative flex items-center gap-1">
        <button className="studio-btn px-2 py-1" onClick={() => setTrackMenuOpen((v) => !v)} title="Add a track">
          + Track ▾
        </button>
        {trackMenuOpen && (
          <div
            className="absolute left-0 top-full mt-1 w-40 studio-panel border border-studio-border rounded-md shadow-lg z-30 p-1 flex flex-col gap-0.5"
            onMouseLeave={() => setTrackMenuOpen(false)}
          >
            {addableFixed.map((t) => (
              <button
                key={t.kind}
                className="text-left px-2 py-1 rounded hover:bg-studio-panel2 text-xs"
                onClick={() => {
                  onAddTrack(t.kind)
                  setTrackMenuOpen(false)
                }}
              >
                {t.label}
              </button>
            ))}
            {addableFixed.length > 0 && <div className="border-t border-studio-border my-0.5" />}
            <button
              className="text-left px-2 py-1 rounded hover:bg-studio-panel2 text-xs"
              onClick={() => {
                onAddTrack('sticker')
                setTrackMenuOpen(false)
              }}
            >
              New Sticker Track
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          className={`studio-btn px-2 py-1 ${snappingEnabled ? 'text-studio-accent border-studio-accent' : ''}`}
          onClick={onToggleSnapping}
          title="Toggle snapping (hold Alt during a drag to disable temporarily)"
        >
          Snap
        </button>
        <button className="studio-btn px-2 py-1" onClick={onZoomToFit} title="Zoom to fit">
          Fit
        </button>
        <input
          type="range"
          className="studio-input-range w-24"
          min={MIN_PX_PER_MS}
          max={MAX_PX_PER_MS}
          step={0.001}
          value={pxPerMs}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          title="Zoom"
        />
      </div>
    </div>
  )
}
