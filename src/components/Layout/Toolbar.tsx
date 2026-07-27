import { useStore } from '@/state/store'
import { PlaybackControls } from '@/components/Timeline/PlaybackControls'

export interface ToolbarActions {
  newProject: () => void
  openProject: () => void
  saveProject: () => void
  saveProjectAs: () => void
}

function SaveStatusLabel() {
  const dirty = useStore((s) => s.dirty)
  const filePath = useStore((s) => s.filePath)
  const saveStatus = useStore((s) => s.saveStatus)

  if (saveStatus === 'saving') {
    return <span className="text-xs text-studio-muted">Saving…</span>
  }
  if (saveStatus === 'error') {
    return <span className="text-xs text-red-400">⚠ Save failed</span>
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-studio-muted" title="Unsaved changes">
        <span className="w-1.5 h-1.5 rounded-full bg-studio-warn" />
        Unsaved changes
      </span>
    )
  }
  if (saveStatus === 'saved') {
    return <span className="text-xs text-green-400">✓ Saved</span>
  }
  if (filePath) {
    return <span className="text-xs text-studio-muted">All changes saved</span>
  }
  return <span className="text-xs text-studio-muted">Not saved yet</span>
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
