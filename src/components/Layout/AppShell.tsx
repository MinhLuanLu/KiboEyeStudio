import { useStore } from '@/state/store'
import { EyeStudioWorkspace } from './EyeStudioWorkspace'
import { UiDesignWorkspace } from '@/components/UiDesign/UiDesignWorkspace'
import { LvglExportDialog } from '@/components/UiDesign/LvglExportDialog'
import { HomeScreen, type HomeScreenActions } from '@/components/Home/HomeScreen'
import { SettingsModal } from '@/components/Home/SettingsModal'
import { ExportDialog } from '@/components/Export/ExportDialog'
import { UserGuideModal } from '@/components/Guide/UserGuideModal'

// The top-level router. Exactly one of three fully separate screens renders at a time — the
// Home Screen, or one of the two workspaces — never as tabs/panels within a shared shell. Each
// workspace owns its own top bar and layout. Export is workspace-specific too: ExportDialog
// (Eye Studio's JSON/C++ eye export) only mounts for 'eyeStudio', LvglExportDialog (UI Design
// Mode's own LVGL export) only mounts for 'uiDesign' — so it's structurally impossible for one
// workspace's export UI to appear while the other workspace is showing. Guide/Settings are the
// only genuinely mode-agnostic modals, so they stay mounted regardless of which screen shows.
export function AppShell({ actions }: { actions: HomeScreenActions }) {
  const workspace = useStore((s) => s.workspace)

  return (
    <div className="flex flex-col h-screen w-screen">
      <div className="flex-1 min-h-0">
        {workspace === 'home' && <HomeScreen actions={actions} />}
        {workspace === 'eyeStudio' && <EyeStudioWorkspace toolbarActions={actions} />}
        {workspace === 'uiDesign' && <UiDesignWorkspace toolbarActions={actions} />}
      </div>
      {workspace === 'eyeStudio' && <ExportDialog />}
      {workspace === 'uiDesign' && <LvglExportDialog />}
      <UserGuideModal />
      <SettingsModal />
    </div>
  )
}
