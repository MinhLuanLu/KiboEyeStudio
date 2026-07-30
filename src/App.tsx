import { useEffect, useRef } from 'react'
import { useStore } from '@/state/store'
import type { EditorState } from '@/types'
import { AppShell } from '@/components/Layout/AppShell'
import { useKeyboardShortcuts } from '@/lib/shortcuts'
import { autosaveRead, autosaveWrite, openProjectDialog, openProjectFromPath, removeRecentProject, saveProjectAs, saveProjectToPath } from '@/state/persistence'
import { getShowGuideOnStartup } from '@/components/Guide/UserGuideModal'

const AUTOSAVE_INTERVAL_MS = 20000
const SAVE_STATUS_FLASH_MS = 2500
const GUIDE_SEEN_KEY = 'kibo-eye-studio:guide-seen'

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
  const setGuideOpen = useStore((s) => s.setGuideOpen)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const selectedKeyframeId = useStore((s) => s.selectedKeyframeId)
  const activeAnimationId = useStore((s) => s.activeAnimationId)
  const duplicateKeyframe = useStore((s) => s.duplicateKeyframe)
  const deleteKeyframe = useStore((s) => s.deleteKeyframe)
  const copyKeyframe = useStore((s) => s.copyKeyframe)
  const pasteKeyframeAt = useStore((s) => s.pasteKeyframeAt)
  const checkpoint = useStore((s) => s.checkpoint)
  const duplicateSelection = useStore((s) => s.duplicateSelection)
  const deleteSelection = useStore((s) => s.deleteSelection)
  const copySelection = useStore((s) => s.copySelection)
  const pasteSelectionAt = useStore((s) => s.pasteSelectionAt)
  const moveSelectionByDelta = useStore((s) => s.moveSelectionByDelta)

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

  // Open the User Guide automatically the very first time the app ever launches (a
  // lightweight first-run onboarding nudge), or on every launch if the user opted into
  // "Show this guide on startup" from inside the guide itself.
  useEffect(() => {
    let shouldOpen = getShowGuideOnStartup()
    try {
      if (!shouldOpen && localStorage.getItem(GUIDE_SEEN_KEY) !== 'true') shouldOpen = true
      localStorage.setItem(GUIDE_SEEN_KEY, 'true')
    } catch {
      // Ignore — worst case the guide just doesn't auto-open this session.
    }
    if (shouldOpen) setGuideOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /** Home Screen's Recent Projects list — same dirty-check as handleOpenProject, but reopens
   * a known path directly instead of showing a file-picker dialog. */
  const handleOpenRecentProject = async (path: string) => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them and open a different project?')) return
    const result = await openProjectFromPath(path)
    if (result.status === 'ok') {
      loadProject(result.project, result.editorState, result.filePath)
    } else if (result.status === 'error') {
      removeRecentProject(path)
      window.alert(result.message)
    }
  }

  const handleNewProject = () => {
    if (dirty && !window.confirm('Discard unsaved changes and start a new project?')) return
    newProjectAction()
  }

  /** Home button handler for both workspaces — "Prompt to save if there are unsaved changes,
   * close the current workspace, return to the Home Screen." Offers a real three-way choice
   * (Save & leave / Discard & leave / stay) using two sequential native confirms, matching how
   * every other unsaved-changes prompt in this app already uses window.confirm rather than a
   * custom dialog component. */
  const goHome = async () => {
    if (!dirty) {
      setWorkspace('home')
      return
    }
    if (window.confirm('You have unsaved changes. Save before returning to the Home Screen?')) {
      const saved = await handleSaveProject()
      if (saved) setWorkspace('home')
      return
    }
    if (window.confirm('Discard unsaved changes and return to the Home Screen?')) {
      setWorkspace('home')
    }
  }

  const playPause = () => {
    const state = useStore.getState()
    if (state.mode !== 'animate') return
    if (state.playbackState === 'playing') pause()
    else play()
  }

  // Every one of these prefers the Timeline's general multi-selection actions when there's an
  // active timelineSelection (keyframes on any track, sticker clips, markers — possibly a
  // mixed multi-selection), falling back to the legacy single-pose-keyframe actions otherwise
  // so this still works from anywhere `selectedKeyframeId` alone is meaningful (e.g. a stray
  // ControlsPanel-only selection with no Timeline selection recorded).
  const duplicateSelectedKeyframe = () => {
    if (useStore.getState().timelineSelection.length > 0) {
      duplicateSelection()
      return
    }
    if (selectedKeyframeId) {
      checkpoint()
      duplicateKeyframe(selectedKeyframeId)
    }
  }

  const deleteSelectedKeyframe = () => {
    if (useStore.getState().timelineSelection.length > 0) {
      deleteSelection()
      return
    }
    if (selectedKeyframeId) {
      checkpoint()
      deleteKeyframe(selectedKeyframeId)
    }
  }

  const copySelectedKeyframe = () => {
    if (useStore.getState().timelineSelection.length > 0) {
      copySelection()
      return
    }
    if (selectedKeyframeId) copyKeyframe(selectedKeyframeId)
  }

  const cutSelection = () => {
    if (useStore.getState().timelineSelection.length === 0) return
    copySelection()
    deleteSelection()
  }

  const pasteKeyframeAtPlayhead = () => {
    const state = useStore.getState()
    if (state.timelineClipboard.length > 0) {
      pasteSelectionAt(state.playbackTimeMs)
      return
    }
    if (!state.keyframeClipboard) return
    checkpoint()
    pasteKeyframeAt(state.playbackTimeMs)
  }

  // Arrow keys nudge the Timeline's current selection by one frame (Shift = 10 frames) when
  // there is one; otherwise they fall back to the pre-existing prev/next-frame playback step.
  const moveSelectionLeft = (bigStep: boolean) => {
    const state = useStore.getState()
    if (state.timelineSelection.length === 0) {
      prevFrame()
      return
    }
    const frameMs = 1000 / state.project.display.fps
    checkpoint()
    moveSelectionByDelta(-(bigStep ? frameMs * 10 : frameMs))
  }

  const moveSelectionRight = (bigStep: boolean) => {
    const state = useStore.getState()
    if (state.timelineSelection.length === 0) {
      nextFrame()
      return
    }
    const frameMs = 1000 / state.project.display.fps
    checkpoint()
    moveSelectionByDelta(bigStep ? frameMs * 10 : frameMs)
  }

  const actions = {
    newProject: handleNewProject,
    openProject: handleOpenProject,
    openRecentProject: handleOpenRecentProject,
    saveProject: handleSaveProject,
    saveProjectAs: handleSaveProjectAs,
    goHome,
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
    copyKeyframe: copySelectedKeyframe,
    pasteKeyframe: pasteKeyframeAtPlayhead,
    cutSelection,
    moveSelectionLeft,
    moveSelectionRight,
    toggleDevMode,
    openGuide: () => setGuideOpen(true)
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
      window.kibo.onMenu('menu:user-guide', actions.openGuide),
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

  return <AppShell actions={actions} />
}
