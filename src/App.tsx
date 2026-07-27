import { useEffect, useRef } from 'react'
import { useStore } from '@/state/store'
import type { EditorState } from '@/types'
import { AppShell } from '@/components/Layout/AppShell'
import { useKeyboardShortcuts } from '@/lib/shortcuts'
import { autosaveRead, autosaveWrite, openProjectDialog, saveProjectAs, saveProjectToPath } from '@/state/persistence'

const AUTOSAVE_INTERVAL_MS = 20000
const SAVE_STATUS_FLASH_MS = 2500

function currentEditorState(): EditorState {
  const s = useStore.getState()
  return {
    eyeTarget: s.eyeTarget,
    selectedExpressionId: s.selectedExpressionId,
    activeAnimationId: s.activeAnimationId,
    mode: s.mode
  }
}

export default function App() {
  const project = useStore((s) => s.project)
  const filePath = useStore((s) => s.filePath)
  const dirty = useStore((s) => s.dirty)
  const setFilePath = useStore((s) => s.setFilePath)
  const markSaved = useStore((s) => s.markSaved)
  const setSaveStatus = useStore((s) => s.setSaveStatus)
  const loadProject = useStore((s) => s.loadProject)
  const newProjectAction = useStore((s) => s.newProject)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const play = useStore((s) => s.play)
  const pause = useStore((s) => s.pause)
  const stop = useStore((s) => s.stop)
  const restart = useStore((s) => s.restart)
  const nextFrame = useStore((s) => s.nextFrame)
  const prevFrame = useStore((s) => s.prevFrame)
  const toggleDevMode = useStore((s) => s.toggleDevMode)
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen)
  const selectedKeyframeId = useStore((s) => s.selectedKeyframeId)
  const activeAnimationId = useStore((s) => s.activeAnimationId)
  const duplicateKeyframe = useStore((s) => s.duplicateKeyframe)
  const deleteKeyframe = useStore((s) => s.deleteKeyframe)
  const checkpoint = useStore((s) => s.checkpoint)

  const loadedAutosave = useRef(false)
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load any autosave on first launch so work survives a crash / accidental close.
  useEffect(() => {
    if (loadedAutosave.current) return
    loadedAutosave.current = true
    autosaveRead().then((saved) => {
      if (saved) loadProject(saved.project, saved.editorState, null)
    })
  }, [loadProject])

  // Periodic autosave-to-disk while there are unsaved changes.
  useEffect(() => {
    const interval = setInterval(() => {
      const s = useStore.getState()
      if (s.dirty) autosaveWrite(s.project, currentEditorState())
    }, AUTOSAVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  // Let the Electron main process know whether there's anything to lose, so it can warn
  // before closing the window (see menu:save-project-then-close below).
  useEffect(() => {
    window.kibo?.notifyDirty(dirty)
  }, [dirty])

  // Browser/dev-preview fallback for the same "unsaved changes" warning — Electron's window
  // close is handled by the main process dialog instead (see main/index.ts), so this native
  // prompt effectively never fires there (the main process already intercepts the close
  // before the page gets a chance to unload).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!useStore.getState().dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const flashSaveStatus = (status: 'saved' | 'error') => {
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current)
    setSaveStatus(status)
    saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), SAVE_STATUS_FLASH_MS)
  }

  /** Returns whether the project actually ended up saved (false if the user canceled a
   * Save As prompt, or the write failed) — callers that need to know before proceeding
   * (e.g. closing the window) check this rather than assuming success. */
  const handleSaveProject = async (): Promise<boolean> => {
    setSaveStatus('saving')
    try {
      if (filePath) {
        await saveProjectToPath(filePath, project, currentEditorState())
      } else {
        const path = await saveProjectAs(project, currentEditorState())
        if (!path) {
          setSaveStatus('idle')
          return false
        }
        setFilePath(path)
      }
      markSaved()
      flashSaveStatus('saved')
      return true
    } catch (err) {
      flashSaveStatus('error')
      window.alert(`Could not save the project.${err instanceof Error ? ` ${err.message}` : ''}`)
      return false
    }
  }

  const handleSaveProjectAs = async (): Promise<boolean> => {
    setSaveStatus('saving')
    try {
      const path = await saveProjectAs(project, currentEditorState())
      if (!path) {
        setSaveStatus('idle')
        return false
      }
      setFilePath(path)
      markSaved()
      flashSaveStatus('saved')
      return true
    } catch (err) {
      flashSaveStatus('error')
      window.alert(`Could not save the project.${err instanceof Error ? ` ${err.message}` : ''}`)
      return false
    }
  }

  const handleOpenProject = async () => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them and open a different project?')) return
    const result = await openProjectDialog()
    if (result.status === 'ok') {
      loadProject(result.project, result.editorState, result.filePath)
    } else if (result.status === 'error') {
      window.alert(result.message)
    }
  }

  const handleNewProject = () => {
    if (dirty && !window.confirm('Discard unsaved changes and start a new project?')) return
    newProjectAction()
  }

  const playPause = () => {
    const state = useStore.getState()
    if (state.mode !== 'animate') return
    if (state.playbackState === 'playing') pause()
    else play()
  }

  const duplicateSelectedKeyframe = () => {
    if (selectedKeyframeId) {
      checkpoint()
      duplicateKeyframe(selectedKeyframeId)
    }
  }

  const deleteSelectedKeyframe = () => {
    if (selectedKeyframeId) {
      checkpoint()
      deleteKeyframe(selectedKeyframeId)
    }
  }

  const actions = {
    newProject: handleNewProject,
    openProject: handleOpenProject,
    saveProject: handleSaveProject,
    saveProjectAs: handleSaveProjectAs,
    exportDialog: () => setExportDialogOpen(true),
    undo,
    redo,
    playPause,
    stop,
    restart,
    nextFrame,
    prevFrame,
    duplicateKeyframe: duplicateSelectedKeyframe,
    deleteKeyframe: deleteSelectedKeyframe,
    toggleDevMode
  }

  useKeyboardShortcuts(actions)

  // Native Electron menu -> same action set as keyboard shortcuts.
  useEffect(() => {
    if (!window.kibo) return
    const unsubs = [
      window.kibo.onMenu('menu:new-project', actions.newProject),
      window.kibo.onMenu('menu:open-project', actions.openProject),
      window.kibo.onMenu('menu:save-project', actions.saveProject),
      window.kibo.onMenu('menu:save-project-as', actions.saveProjectAs),
      window.kibo.onMenu('menu:export', actions.exportDialog),
      window.kibo.onMenu('menu:undo', actions.undo),
      window.kibo.onMenu('menu:redo', actions.redo),
      window.kibo.onMenu('menu:duplicate-keyframe', actions.duplicateKeyframe),
      window.kibo.onMenu('menu:delete-keyframe', actions.deleteKeyframe),
      window.kibo.onMenu('menu:toggle-dev-mode', actions.toggleDevMode),
      window.kibo.onMenu('menu:play-pause', actions.playPause),
      window.kibo.onMenu('menu:stop', actions.stop),
      window.kibo.onMenu('menu:restart', actions.restart),
      window.kibo.onMenu('menu:next-frame', actions.nextFrame),
      window.kibo.onMenu('menu:prev-frame', actions.prevFrame),
      // The main process asks for this when the user chooses "Save" from the unsaved-
      // changes dialog on window close — it only tells the window it's safe to actually
      // close once the save has genuinely succeeded (see handleSaveProject's return value).
      window.kibo.onMenu('menu:save-project-then-close', async () => {
        const ok = await handleSaveProject()
        if (ok) window.kibo!.notifySaveThenCloseComplete()
      })
    ]
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnimationId, selectedKeyframeId, filePath, dirty, project])

  return <AppShell toolbarActions={actions} />
}
