import { useState } from 'react'
import { useStore } from '@/state/store'
import type { ToolbarActions } from '@/components/Layout/Toolbar'
import { getRecentProjects, hasElectron, removeRecentProject } from '@/state/persistence'

export interface HomeScreenActions extends ToolbarActions {
  openRecentProject: (path: string) => void
}

function ModeCard({
  icon,
  title,
  description,
  bullets,
  onOpen
}: {
  icon: string
  title: string
  description: string
  bullets: string[]
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="studio-panel flex-1 max-w-sm p-6 flex flex-col items-start gap-3 text-left hover:border-studio-accent transition-colors group"
    >
      <span className="text-4xl">{icon}</span>
      <span className="text-lg font-semibold">{title}</span>
      <span className="text-sm text-studio-muted">{description}</span>
      <ul className="text-xs text-studio-muted list-disc list-inside flex flex-col gap-0.5">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <span className="studio-btn-primary mt-2 group-hover:brightness-110">Open</span>
    </button>
  )
}

// The landing screen shown at launch (workspace === 'home') and whenever a workspace's Home
// button is used. Its two mode cards are the *only* way into either workspace — there is no
// tab/switcher between them once inside, per "each workspace should behave like its own
// application." Project management (New/Open/Recent/Save) lives here since it's explicitly the
// one thing meant to be shared between the two otherwise-independent editors.
export function HomeScreen({ actions }: { actions: HomeScreenActions }) {
  const setWorkspace = useStore((s) => s.setWorkspace)
  const setGuideOpen = useStore((s) => s.setGuideOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const projectName = useStore((s) => s.project.name)
  const filePath = useStore((s) => s.filePath)
  // getRecentProjects() reads localStorage fresh on every render — this setter's only job is
  // forcing a re-render after a removal (its value is never read).
  const [, forceRecentRefresh] = useState(0)
  const recent = getRecentProjects()

  return (
    <div className="h-full w-full overflow-y-auto flex flex-col items-center px-6 py-10 gap-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-5xl">👁️🖥️</span>
        <h1 className="text-2xl font-semibold tracking-wide text-studio-accent">Kibo Studio</h1>
        <p className="text-sm text-studio-muted">Choose what you want to design</p>
        {filePath && <p className="text-xs text-studio-muted">Currently loaded: {projectName}</p>}
      </div>

      <div className="flex flex-col sm:flex-row items-stretch gap-4 w-full justify-center">
        <ModeCard
          icon="👁"
          title="Expressions Design"
          description="Design animated robot eyes and export them to ESP32 firmware."
          bullets={['Eye, pupil & eyelid designer', 'Expressions & animation timeline', 'Stickers & effects', 'ESP32 eye export']}
          onOpen={() => setWorkspace('eyeStudio')}
        />
        <ModeCard
          icon="🖥"
          title="UI/UX Design (LVGL)"
          description="Build ESP32 interfaces visually with HTML & CSS."
          bullets={['Drag-and-drop UI builder', 'HTML & CSS editors', 'Widget library & live preview', 'LVGL C++ export']}
          onOpen={() => setWorkspace('uiDesign')}
        />
      </div>

      <div className="flex items-center gap-2">
        <button className="studio-btn" onClick={actions.newProject}>
          New Project
        </button>
        <button className="studio-btn" onClick={actions.openProject}>
          Open Project...
        </button>
        <button className="studio-btn" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        <button className="studio-btn" onClick={() => setGuideOpen(true)}>
          User Guide
        </button>
      </div>

      <div className="w-full max-w-2xl flex flex-col gap-2">
        <h2 className="studio-label">Recent Projects</h2>
        {!hasElectron() && <p className="text-xs text-studio-muted">Recent Projects is available in the desktop app.</p>}
        {hasElectron() && recent.length === 0 && <p className="text-xs text-studio-muted">No recent projects yet.</p>}
        {hasElectron() && recent.length > 0 && (
          <ul className="flex flex-col gap-1">
            {recent.map((entry) => (
              <li key={entry.path} className="group flex items-center gap-2 studio-panel px-3 py-2">
                <button className="flex-1 min-w-0 text-left" onClick={() => actions.openRecentProject(entry.path)}>
                  <div className="text-sm truncate">{entry.name}</div>
                  <div className="text-[11px] text-studio-muted truncate">{entry.path}</div>
                </button>
                <button
                  className="hidden group-hover:block text-studio-muted hover:text-studio-danger px-1 shrink-0"
                  title="Remove from Recent Projects"
                  onClick={() => {
                    removeRecentProject(entry.path)
                    forceRecentRefresh((v) => v + 1)
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
