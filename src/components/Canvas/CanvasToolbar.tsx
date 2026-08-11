/** Floating zoom/snap controls for the preview. View-only — none of these touch project data. */
export function CanvasToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  snapOn,
  gridSize,
  onToggleSnap,
  onGridSize
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
  snapOn: boolean
  gridSize: number
  onToggleSnap: () => void
  onGridSize: (px: number) => void
}) {
  const btn = 'px-2 py-1 rounded text-xs bg-studio-panel2 hover:bg-studio-border2 border border-studio-border text-studio-text'
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-studio-panel/90 border border-studio-border rounded-md px-1.5 py-1 shadow-floating backdrop-blur">
      <button className={btn} title="Zoom out (Ctrl + scroll)" onClick={onZoomOut}>
        −
      </button>
      <button
        className={`${btn} min-w-[3.25rem] font-mono`}
        title="Reset to 100%"
        onClick={onReset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className={btn} title="Zoom in (Ctrl + scroll)" onClick={onZoomIn}>
        +
      </button>
      <div className="w-px self-stretch bg-studio-border mx-0.5" />
      <button className={btn} title="Fit to view" onClick={onFit}>
        Fit
      </button>
      <button className={btn} title="Reset to 100%" onClick={onReset}>
        100%
      </button>
      <div className="w-px self-stretch bg-studio-border mx-0.5" />
      <button
        className={`${btn} ${snapOn ? 'border-studio-accent text-studio-accent' : ''}`}
        title="Snap to grid"
        onClick={onToggleSnap}
      >
        Snap
      </button>
      {snapOn && (
        <input
          type="number"
          min={1}
          max={60}
          value={gridSize}
          title="Grid size (px)"
          className="w-12 bg-studio-panel2 border border-studio-border rounded px-1 py-0.5 text-xs"
          onChange={(e) => onGridSize(Math.max(1, Math.round(Number(e.target.value) || 1)))}
        />
      )}
    </div>
  )
}
