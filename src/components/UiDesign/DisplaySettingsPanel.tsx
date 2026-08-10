import { useStore } from '@/state/store'
import { UI_DISPLAY_PRESETS, screenBackgroundColor } from '@/types'
import type { UiDisplayOrientation, UiDisplayRotation, UiDisplayShape } from '@/types'
import { ColorField } from '@/components/ui/ColorField'

const SHAPE_OPTIONS: { value: UiDisplayShape; label: string; disabled?: boolean }[] = [
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'custom', label: 'Custom Shape (future support)', disabled: true }
]

const ROTATIONS: UiDisplayRotation[] = [0, 90, 180, 270]

// UI Design Mode's own Display Settings — completely separate from Eye Studio's Display panel
// (project.display). Changing size here rescales existing widgets proportionally (see
// setUiDisplaySettings in store.ts) rather than leaving them clipped or stranded, and "Preview
// as..." lets you check the layout at another size/shape without touching the saved project.
export function DisplaySettingsPanel() {
  const display = useStore((s) => s.project.uiDesign.display)
  const setUiDisplaySettings = useStore((s) => s.setUiDisplaySettings)
  const applyUiDisplayPreset = useStore((s) => s.applyUiDisplayPreset)
  const checkpoint = useStore((s) => s.checkpoint)
  const previewOverride = useStore((s) => s.uiPreviewDisplayOverride)
  const setUiPreviewDisplayOverride = useStore((s) => s.setUiPreviewDisplayOverride)
  const activeScreen = useStore((s) => s.project.uiDesign.screens.find((sc) => sc.id === s.project.uiDesign.activeScreenId) ?? s.project.uiDesign.screens[0])
  const setUiScreenStyle = useStore((s) => s.setUiScreenStyle)
  const screenBg = screenBackgroundColor(activeScreen, display)

  const activePresetId = UI_DISPLAY_PRESETS.find((p) => p.width === display.width && p.height === display.height && p.shape === display.shape)?.id ?? null

  const handleOrientationChange = (next: UiDisplayOrientation) => {
    if (next === display.orientation) return
    checkpoint()
    setUiDisplaySettings({ orientation: next, width: display.height, height: display.width })
  }

  return (
    <div className="p-3 flex flex-col gap-4">
      <p className="text-[11px] text-studio-muted -mb-1">
        Project Display — physical panel settings shared by every screen. Per-screen visual style (background) is at the bottom.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="studio-label">Presets</span>
        <div className="grid grid-cols-2 gap-1.5">
          {UI_DISPLAY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`studio-tab text-xs px-2 py-1.5 ${activePresetId === preset.id ? 'studio-tab-active' : ''}`}
              onClick={() => {
                checkpoint()
                applyUiDisplayPreset(preset.id)
              }}
            >
              {preset.label}
            </button>
          ))}
          <span className={`studio-tab text-xs px-2 py-1.5 text-center ${activePresetId === null ? 'studio-tab-active' : 'opacity-50'}`}>
            Custom Size
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="studio-label">Width (px)</span>
          <input
            type="number"
            min={16}
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
            value={Math.round(display.width)}
            onChange={(e) => {
              checkpoint()
              setUiDisplaySettings({ width: Math.max(16, Number(e.target.value)) })
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="studio-label">Height (px)</span>
          <input
            type="number"
            min={16}
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
            value={Math.round(display.height)}
            onChange={(e) => {
              checkpoint()
              setUiDisplaySettings({ height: Math.max(16, Number(e.target.value)) })
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="studio-label">Display Shape</span>
        <div className="grid grid-cols-2 gap-1.5">
          {SHAPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={opt.disabled}
              title={opt.disabled ? 'Not implemented yet — arbitrary custom display outlines are a possible future addition.' : undefined}
              className={`studio-tab text-xs px-2 py-1.5 ${display.shape === opt.value ? 'studio-tab-active' : ''}`}
              onClick={() => {
                checkpoint()
                setUiDisplaySettings({ shape: opt.value })
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="studio-label">Orientation</span>
        <div className="flex bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {(['portrait', 'landscape'] as const).map((o) => (
            <button
              key={o}
              className={`studio-tab flex-1 capitalize ${display.orientation === o ? 'studio-tab-active' : ''}`}
              onClick={() => handleOrientationChange(o)}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="studio-label">Rotation</span>
        <p className="text-[11px] text-studio-muted -mt-0.5">
          Firmware/driver presentation only — you still design using Width/Height above as the logical resolution.
        </p>
        <div className="flex bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {ROTATIONS.map((r) => (
            <button
              key={r}
              className={`studio-tab flex-1 ${display.rotation === r ? 'studio-tab-active' : ''}`}
              onClick={() => {
                checkpoint()
                setUiDisplaySettings({ rotation: r })
              }}
            >
              {r}°
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-studio-border pt-3 flex flex-col gap-1.5">
        <span className="studio-label">Screen Style — {activeScreen?.name ?? 'no screen'}</span>
        <p className="text-[11px] text-studio-muted -mt-0.5">
          Per-screen: each screen tab keeps its own background. The size/shape/rotation above are shared by every screen (one physical display).
        </p>
        <ColorField
          label={`${activeScreen?.name ?? 'Screen'} background`}
          value={screenBg}
          onCommitStart={checkpoint}
          onChange={(v) => activeScreen && setUiScreenStyle(activeScreen.id, { backgroundColor: v })}
        />
        <p className="text-[11px] text-studio-muted">The surface behind this screen's widgets — exported as this LVGL screen's own background color.</p>
      </div>

      <div className="border-t border-studio-border pt-3 flex flex-col gap-1.5">
        <span className="studio-label">Preview As (doesn't change the project)</span>
        <div className="grid grid-cols-2 gap-1.5">
          {UI_DISPLAY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="studio-btn text-xs px-2 py-1.5"
              onClick={() => setUiPreviewDisplayOverride({ width: preset.width, height: preset.height, shape: preset.shape, orientation: display.orientation, rotation: display.rotation, backgroundColor: display.backgroundColor })}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {previewOverride && (
          <button className="studio-btn text-xs px-2 py-1.5 self-start" onClick={() => setUiPreviewDisplayOverride(null)}>
            Reset preview to project settings
          </button>
        )}
      </div>
    </div>
  )
}
