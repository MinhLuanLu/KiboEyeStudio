import { useEffect } from 'react'

export interface ShortcutActions {
  newProject: () => void
  openProject: () => void
  saveProject: () => void
  saveProjectAs: () => void
  exportDialog: () => void
  undo: () => void
  redo: () => void
  playPause: () => void
  stop: () => void
  restart: () => void
  nextFrame: () => void
  prevFrame: () => void
  duplicateKeyframe: () => void
  deleteKeyframe: () => void
  copyKeyframe: () => void
  pasteKeyframe: () => void
  toggleDevMode: () => void
  openGuide: () => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** Wires the app's keyboard shortcuts to the same action set the native Electron menu
 * dispatches, so behavior is identical whether triggered via keys or the menu bar. */
export function useKeyboardShortcuts(actions: ShortcutActions): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey

      if (e.key === 'F1') {
        e.preventDefault()
        actions.openGuide()
        return
      }

      if (e.code === 'Space' && !isEditableTarget(e.target)) {
        e.preventDefault()
        actions.playPause()
        return
      }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        actions.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        actions.newProject()
        return
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        actions.openProject()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) actions.saveProjectAs()
        else actions.saveProject()
        return
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        actions.exportDialog()
        return
      }
      if (mod && e.key.toLowerCase() === 'd' && !isEditableTarget(e.target)) {
        e.preventDefault()
        actions.duplicateKeyframe()
        return
      }
      // Guarded by isEditableTarget so this never hijacks normal text copy/paste in inputs —
      // Ctrl/Cmd+C/V only act on the selected keyframe when focus is elsewhere in the app.
      if (mod && e.key.toLowerCase() === 'c' && !isEditableTarget(e.target)) {
        e.preventDefault()
        actions.copyKeyframe()
        return
      }
      if (mod && e.key.toLowerCase() === 'v' && !isEditableTarget(e.target)) {
        e.preventDefault()
        actions.pasteKeyframe()
        return
      }
      if (mod && e.key === '.') {
        e.preventDefault()
        actions.toggleDevMode()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!isEditableTarget(e.target)) {
          e.preventDefault()
          actions.deleteKeyframe()
        }
        return
      }
      if (e.key === 'ArrowRight' && !isEditableTarget(e.target)) {
        actions.nextFrame()
        return
      }
      if (e.key === 'ArrowLeft' && !isEditableTarget(e.target)) {
        actions.prevFrame()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions])
}
