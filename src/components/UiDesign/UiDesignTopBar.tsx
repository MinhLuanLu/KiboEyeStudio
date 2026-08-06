import { useStore } from '@/state/store'
import type { UiThemeId } from '@/types'
import type { ToolbarActions } from '@/components/Layout/Toolbar'
import { SaveStatusLabel } from '@/components/Layout/SaveStatusLabel'
import { UI_THEME_LABELS } from '@/lib/uiDesign/themes'

const THEME_ORDER: UiThemeId[] = ['light', 'dark', 'amoled', 'material', 'fluent', 'apple', 'gaming', 'automotive', 'cyberpunk', 'custom']

// UI Design Mode's own top bar — deliberately NOT the Eye Studio Toolbar with some buttons
// hidden. It's a separately composed component with a different button set (no
// PlaybackControls/Bezel/Dev Mode — those are eye-animation concepts with no meaning here) so
// the two workspaces read as genuinely different applications, per "do not reuse the same
// layout between the two modes." The only things shared are the project-management actions
// themselves (New/Open/Save/Save As/Home, owned by App.tsx) and the SaveStatusLabel leaf.
export function UiDesignTopBar({ actions }: { actions: ToolbarActions }) {
  const projectName = useStore((s) => s.project.name)
  const renameProject = useStore((s) => s.renameProject)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const setLvglExportDialogOpen = useStore((s) => s.setLvglExportDialogOpen)
  const setGuideOpen = useStore((s) => s.setGuideOpen)
  const theme = useStore((s) => s.project.uiDesign.theme)
  const setUiTheme = useStore((s) => s.setUiTheme)
  const checkpoint = useStore((s) => s.checkpoint)
  const esp32PreviewMode = useStore((s) => s.uiEsp32PreviewMode)
  const toggleUiEsp32Preview = useStore((s) => s.toggleUiEsp32Preview)

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-studio-border bg-studio-panel2">
      <button className="studio-btn" onClick={actions.goHome} title="Return to the Home Screen">
        🏠 Home
      </button>

      <span className="font-semibold text-sm tracking-wide text-studio-accent">🖥 UI/UX Design (LVGL)</span>

      <input
        className="bg-transparent border border-transparent hover:border-studio-border focus:border-studio-border rounded px-1.5 py-0.5 text-sm w-44"
        value={projectName}
        onChange={(e) => renameProject(e.target.value)}
      />
      <SaveStatusLabel />

      <select
        className="bg-studio-panel border border-studio-border rounded px-1.5 py-1 text-xs"
        value={theme}
        onChange={(e) => {
          checkpoint()
          setUiTheme(e.target.value as UiThemeId)
        }}
        title="Project theme — only affects widgets whose colors opt into a theme token (see the color pickers' 'Theme token' dropdown in Properties)"
      >
        {THEME_ORDER.map((t) => (
          <option key={t} value={t}>
            Theme: {UI_THEME_LABELS[t]}
          </option>
        ))}
      </select>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <button className="studio-btn" disabled={past === 0} onClick={undo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="studio-btn" disabled={future === 0} onClick={redo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button className="studio-btn" onClick={actions.newProject}>
          New
        </button>
        <button className="studio-btn" onClick={actions.openProject}>
          Open
        </button>
        <button className="studio-btn" onClick={actions.saveProject}>
          Save
        </button>
        <button className="studio-btn" onClick={actions.saveProjectAs}>
          Save As
        </button>
        <button className="studio-btn-primary" onClick={() => setLvglExportDialogOpen(true)}>
          Export LVGL C++...
        </button>
      </div>

      <button
        className={`studio-btn text-xs ${esp32PreviewMode ? 'text-studio-accent' : ''}`}
        onClick={toggleUiEsp32Preview}
        title="ESP32 Preview — shows the canvas approximately as the exported LVGL firmware will render it (RGB565 color quantization, one real shadow per widget instead of the richer studio preview, Montserrat font-size snapping) instead of the studio's full-quality preview"
      >
        ESP32 Preview
      </button>

      <button className="studio-btn" onClick={() => setGuideOpen(true)} title="User Guide (F1)">
        Help
      </button>
    </div>
  )
}
