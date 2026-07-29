import { useStore } from '@/state/store'

// Shared by both workspaces' independently-composed top bars (Toolbar.tsx for Eye Studio,
// UiDesignTopBar.tsx for UI Design Mode) so "what does Save status mean right now" has exactly
// one implementation — one of the few things the two workspaces are meant to share (the other
// being the project-management actions themselves), per "sharing only the Home Screen and
// project management system."
export function SaveStatusLabel() {
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
