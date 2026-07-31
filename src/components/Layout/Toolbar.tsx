import { useStore } from '@/state/store'
import { PlaybackControls } from '@/components/Timeline/PlaybackControls'
import { SaveStatusLabel } from './SaveStatusLabel'

// Eye Studio's own top bar — mounted exclusively inside EyeStudioWorkspace.tsx, not shared with
// UI Design Mode (which has its own, differently-composed UiDesignTopBar.tsx). The only things
// genuinely shared between the two are the project-management actions passed in via `actions`
// (New/Open/Save/Save As/Home — all owned by App.tsx) and the SaveStatusLabel leaf component.
export interface ToolbarActions {
  newProject: () => void
  openProject: () => void
  saveProject: () => void
  saveProjectAs: () => void
  goHome: () => void
}

export function Toolbar({ actions }: { actions: ToolbarActions }) {
  const projectName = useStore((s) => s.project.name)
  const renameProject = useStore((s) => s.renameProject)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const devModeOpen = useStore((s) => s.devModeOpen)
  const toggleDevMode = useStore((s) => s.toggleDevMode)
  const showBezel = useStore((s) => s.project.display.showBezel)
  const toggleBezel = useStore((s) => s.toggleBezel)
  const esp32PreviewMode = useStore((s) => s.esp32PreviewMode)
  const toggleEsp32Preview = useStore((s) => s.toggleEsp32Preview)
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen)
  const setGuideOpen = useStore((s) => s.setGuideOpen)

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-studio-border bg-studio-panel">
      <button className="studio-btn" onClick={actions.goHome} title="Return to the Home Screen">
        🏠 Home
      </button>

      <span className="font-semibold text-sm tracking-wide text-studio-accent">Expressions Design</span>

      <input
        className="bg-transparent border border-transparent hover:border-studio-border focus:border-studio-border rounded px-1.5 py-0.5 text-sm w-44"
        value={projectName}
        onChange={(e) => renameProject(e.target.value)}
      />
      <SaveStatusLabel />

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
        <button className="studio-btn" onClick={() => setExportDialogOpen(true)}>
          Export...
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button className="studio-btn" disabled={past === 0} onClick={undo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="studio-btn" disabled={future === 0} onClick={redo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
      </div>

      <div className="flex-1" />

      <PlaybackControls />

      <div className="flex items-center gap-1 ml-2">
        <button className={`studio-btn ${showBezel ? 'text-studio-accent' : ''}`} onClick={toggleBezel} title="Toggle Bezel">
          ⭗
        </button>
        <button className={`studio-btn ${devModeOpen ? 'text-studio-accent' : ''}`} onClick={toggleDevMode} title="Toggle Developer Mode (Ctrl+.)">
          {'</>'}
        </button>
        <button
          className={`studio-btn text-xs ${esp32PreviewMode ? 'text-studio-accent' : ''}`}
          onClick={toggleEsp32Preview}
          title="ESP32 Export Preview — shows the canvas approximately as the exported firmware will render it (RGB565 color quantization, ring-stepped iris/glow) instead of the studio's full-quality preview"
        >
          ESP32 Preview
        </button>
        <button className="studio-btn" onClick={() => setGuideOpen(true)} title="User Guide (F1)">
          Help
        </button>
      </div>
    </div>
  )
}
