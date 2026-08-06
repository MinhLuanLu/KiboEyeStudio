import { useStore } from '@/state/store'
import type { UiPositionInfoField } from '@/types'

const GRID_SIZE_PRESETS = [1, 2, 4, 5, 8, 10, 16]

const POSITION_INFO_FIELDS: { value: UiPositionInfoField; label: string }[] = [
  { value: 'x', label: 'X position' },
  { value: 'y', label: 'Y position' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'centerX', label: 'Center X' },
  { value: 'centerY', label: 'Center Y' },
  { value: 'distanceFromScreenCenter', label: 'Distance from screen center' },
  { value: 'distanceFromParentEdges', label: 'Distance from parent edges' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'zoomLevel', label: 'Current zoom level' }
]

const SNAP_TOGGLES: { key: 'snapToGrid' | 'snapToCenter' | 'snapToDisplayEdges' | 'snapToSafeArea' | 'snapToParent' | 'snapToWidgets'; label: string }[] = [
  { key: 'snapToGrid', label: 'Snap to grid' },
  { key: 'snapToCenter', label: 'Snap to display center' },
  { key: 'snapToDisplayEdges', label: 'Snap to display edges' },
  { key: 'snapToSafeArea', label: 'Snap to safe area' },
  { key: 'snapToParent', label: 'Snap to parent' },
  { key: 'snapToWidgets', label: 'Snap to widgets & widget centers' }
]

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

// UI Design Mode's canvas workspace preferences — zoom/pan itself lives on the toolbar (it needs
// to be reachable with one click, not two), everything else that configures HOW the canvas helps
// you position widgets (grid/snap/rulers/guides/safe-area/pixel-accurate/position-info-panel
// fields) lives here in one discoverable place. See UiWorkspaceViewSettings' own doc comment for
// why these settings are saved in EditorState (immune to undo/redo) rather than project.uiDesign.
export function WorkspaceSettingsPanel() {
  const view = useStore((s) => s.uiWorkspaceView)
  const updateUiWorkspaceView = useStore((s) => s.updateUiWorkspaceView)

  const togglePositionField = (field: UiPositionInfoField) => {
    const next = view.positionInfoFields.includes(field) ? view.positionInfoFields.filter((f) => f !== field) : [...view.positionInfoFields, field]
    updateUiWorkspaceView({ positionInfoFields: next })
  }

  return (
    <div className="p-3 flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="studio-label">Grid</span>
        <Toggle label="Show grid" checked={view.gridVisible} onChange={(v) => updateUiWorkspaceView({ gridVisible: v })} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-studio-muted w-20">Grid size</span>
          <select
            className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-1 text-xs flex-1"
            value={view.gridSize}
            onChange={(e) => updateUiWorkspaceView({ gridSize: Number(e.target.value) })}
          >
            {GRID_SIZE_PRESETS.map((s) => (
              <option key={s} value={s}>
                {s} px
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-studio-muted w-20">Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            className="flex-1"
            value={view.gridOpacity}
            onChange={(e) => updateUiWorkspaceView({ gridOpacity: Number(e.target.value) })}
          />
          <span className="text-[11px] text-studio-muted w-8 text-right">{view.gridOpacity}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-studio-muted w-20">Subdivision</span>
          <input
            type="number"
            min={1}
            max={20}
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs w-16"
            value={view.gridSubdivision}
            onChange={(e) => updateUiWorkspaceView({ gridSubdivision: Math.max(1, Number(e.target.value)) })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-3">
        <span className="studio-label">Snapping</span>
        <Toggle label="Enable snapping (hold Alt to disable while dragging)" checked={view.snapEnabled} onChange={(v) => updateUiWorkspaceView({ snapEnabled: v })} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-studio-muted w-24">Snap distance</span>
          <input
            type="number"
            min={0}
            max={100}
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs w-16"
            value={view.snapDistance}
            onChange={(e) => updateUiWorkspaceView({ snapDistance: Math.max(0, Number(e.target.value)) })}
          />
          <span className="text-[11px] text-studio-muted">px</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-studio-muted w-24">Magnetic strength</span>
          <input
            type="range"
            min={0}
            max={100}
            className="flex-1"
            value={view.magneticStrength}
            onChange={(e) => updateUiWorkspaceView({ magneticStrength: Number(e.target.value) })}
          />
          <span className="text-[11px] text-studio-muted w-8 text-right">{view.magneticStrength}%</span>
        </div>
        <div className="grid grid-cols-1 gap-1 mt-1">
          {SNAP_TOGGLES.map((t) => (
            <Toggle key={t.key} label={t.label} checked={view[t.key]} onChange={(v) => updateUiWorkspaceView({ [t.key]: v })} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-3">
        <span className="studio-label">Guides & Safe Area</span>
        <Toggle label="Show rulers" checked={view.rulersVisible} onChange={(v) => updateUiWorkspaceView({ rulersVisible: v })} />
        <Toggle label="Show alignment guides while dragging" checked={view.guidesVisible} onChange={(v) => updateUiWorkspaceView({ guidesVisible: v })} />
        <Toggle label="Show safe-area guide (round displays)" checked={view.safeAreaVisible} onChange={(v) => updateUiWorkspaceView({ safeAreaVisible: v })} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-studio-muted w-24">Safe-area margin</span>
          <input
            type="number"
            min={0}
            max={200}
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs w-16"
            value={view.safeAreaMargin}
            onChange={(e) => updateUiWorkspaceView({ safeAreaMargin: Math.max(0, Number(e.target.value)) })}
          />
          <span className="text-[11px] text-studio-muted">px</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-3">
        <span className="studio-label">Pixel-Accurate Mode</span>
        <Toggle
          label="Snap every position/size to whole pixels + show grid at high zoom"
          checked={view.pixelAccurateMode}
          onChange={(v) => updateUiWorkspaceView({ pixelAccurateMode: v })}
        />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-studio-border pt-3">
        <span className="studio-label">Position Info Panel Fields</span>
        <div className="grid grid-cols-1 gap-1">
          {POSITION_INFO_FIELDS.map((f) => (
            <Toggle key={f.value} label={f.label} checked={view.positionInfoFields.includes(f.value)} onChange={() => togglePositionField(f.value)} />
          ))}
        </div>
      </div>
    </div>
  )
}
