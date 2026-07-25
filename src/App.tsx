import { useEffect, useRef } from 'react'
import { useStore } from '@/state/store'
import { AppShell } from '@/components/Layout/AppShell'
import { useKeyboardShortcuts } from '@/lib/shortcuts'
import {
  autosaveRead,
  autosaveWrite,
  openProjectDialog,
  saveProjectAs,
  saveProjectToPath
} from '@/state/persistence'

const AUTOSAVE_INTERVAL_MS = 20000

export default function App() {
  const project = useStore((s) => s.project)
  const filePath = useStore((s) => s.filePath)
  const dirty = useStore((s) => s.dirty)
  const setFilePath = useStore((s) => s.setFilePath)
  const markSaved = useStore((s) => s.markSaved)
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

  // Load any autosave on first launch so work survives a crash / accidental close.
  useEffect(() => {
    if (loadedAutosave.current) return
    loadedAutosave.current = true
    autosaveRead().then((saved) => {
      if (saved) loadProject(saved, null)
    })
  }, [loadProject])

  // Periodic autosave-to-disk while there are unsaved changes.
  useEffect(() => {
    const interval = setInterval(() => {
      if (useStore.getState().dirty) autosaveWrite(useStore.getState().project)
    }, AUTOSAVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const handleSaveProject = async () => {
    if (filePath) {
      await saveProjectToPath(filePath, project)
    } else {
      const path = await saveProjectAs(project)
      if (path) setFilePath(path)
      else return
    }
    markSaved()
  }

  const handleSaveProjectAs = async () => {
    const path = await saveProjectAs(project)
    if (path) {
      setFilePath(path)
      markSaved()
    }
  }

  const handleOpenProject = async () => {
    const result = await openProjectDialog()
    if (result) loadProject(result.project, result.filePath)
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
      window.kibo.onMenu('menu:prev-frame', actions.prevFrame)
    ]
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnimationId, selectedKeyframeId, filePath, dirty])

  return <AppShell toolbarActions={actions} />
}
