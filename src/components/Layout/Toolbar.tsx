import { useStore } from '@/state/store'
import { PlaybackControls } from '@/components/Timeline/PlaybackControls'

export interface ToolbarActions {
  newProject: () => void
  openProject: () => void
  saveProject: () => void
  saveProjectAs: () => void
}

export function Toolbar({ actions }: { actions: ToolbarActions }) {
  const projectName = useStore((s) => s.project.name)
  const renameProject = useStore((s) => s.renameProject)
  const dirty = useStore((s) => s.dirty)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const devModeOpen = useStore((s) => s.devModeOpen)
  const toggleDevMode = useStore((s) => s.toggleDevMode)
  const showBezel = useStore((s) => s.project.display.showBezel)
  const toggleBezel = useStore((s) => s.toggleBezel)
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen)
  const setReferenceImportOpen = useStore((s) => s.setReferenceImportOpen)

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-studio-border bg-studio-panel">
      <span className="font-semibold text-sm tracking-wide text-studio-accent">Kibo Eye Studio</span>

      <input
        className="bg-transparent border border-transparent hover:border-studio-border focus:border-studio-border rounded px-1.5 py-0.5 text-sm w-44"
        value={projectName}
        onChange={(e) => renameProject(e.target.value)}
      />
      {dirty && <span className="w-1.5 h-1.5 rounded-full bg-studio-warn" title="Unsaved changes" />}

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
        <button className="studio-btn" onClick={() => setReferenceImportOpen(true)}>
          Import Reference...
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
      </div>
    </div>
  )
}
