import { useEffect, useRef } from 'react'
import { useStore } from '@/state/store'
import { UI_ZOOM_STEP_FACTOR, clampUiZoom } from './canvasZoom'

/** How long a gap between nudge keypresses is still considered "the same gesture" for
 * checkpoint purposes — mirrors how a mouse drag is one checkpoint, not one per pixel moved, so
 * holding an arrow key (which fires many keydown events) doesn't spam the undo stack with one
 * entry per repeat. */
const NUDGE_SESSION_GAP_MS = 500

const ARROW_KEYS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 }
}

/** UI Design Mode's own keyboard shortcuts — deliberately a separate hook from Eye Studio's
 * `useKeyboardShortcuts` (src/lib/shortcuts.ts), which is wired to undo/redo/playback/Timeline-
 * keyframe concerns only and never touches `selectedWidgetId` or any UI-Design-Mode widget
 * action (confirmed by direct read before this feature was built). Mounted once in
 * UiDesignWorkspace.tsx. Reads live store state via `useStore.getState()` inside the handler
 * (not hook selectors) so the listener never needs to be torn down/re-added as state changes. */
export function useUiDesignKeyboardShortcuts() {
  const lastNudgeAt = useRef(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey

      if (isMod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        const s = useStore.getState()
        s.updateUiWorkspaceView({ zoom: clampUiZoom(s.uiWorkspaceView.zoom * UI_ZOOM_STEP_FACTOR) })
        return
      }
      if (isMod && e.key === '-') {
        e.preventDefault()
        const s = useStore.getState()
        s.updateUiWorkspaceView({ zoom: clampUiZoom(s.uiWorkspaceView.zoom / UI_ZOOM_STEP_FACTOR) })
        return
      }
      if (isMod && e.key === '0') {
        e.preventDefault()
        useStore.getState().updateUiWorkspaceView({ zoom: 1, panX: 0, panY: 0 })
        return
      }

      // Never hijack arrow/Delete keys while the user is actually typing/navigating text (a
      // Properties-panel number field, the HTML/CSS/Logic code editors, the project-name input,
      // etc). Guard for e.target not being an Element at all (e.g. window itself, or during a
      // synthetically dispatched event) — `.closest` only exists on Element, not EventTarget in
      // general.
      const target = e.target instanceof Element ? e.target : null
      const isEditable = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable || !!target.closest('.cm-editor'))

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditable && !isMod) {
        const s = useStore.getState()
        const widget = s.selectedWidgetId ? s.project.uiDesign.widgets[s.selectedWidgetId] : undefined
        // deleteUiWidget itself already no-ops for a screen root (deleting it would leave its
        // UiScreen dangling) — checked here too so a screen selection doesn't spam the undo
        // stack with an empty checkpoint.
        if (widget && widget.type !== 'screen') {
          e.preventDefault()
          s.checkpoint()
          s.deleteUiWidget(widget.id)
        }
        return
      }

      const arrow = ARROW_KEYS[e.key]
      if (!arrow) return
      if (isEditable || isMod) return

      const s = useStore.getState()
      const widget = s.selectedWidgetId ? s.project.uiDesign.widgets[s.selectedWidgetId] : undefined
      if (!widget || widget.locked) return
      e.preventDefault()

      const step = e.altKey ? Math.max(1, s.uiWorkspaceView.gridSize) : e.shiftKey ? 10 : 1
      const x = (typeof widget.style.x === 'number' ? widget.style.x : 0) + arrow.dx * step
      const y = (typeof widget.style.y === 'number' ? widget.style.y : 0) + arrow.dy * step

      const now = Date.now()
      if (now - lastNudgeAt.current > NUDGE_SESSION_GAP_MS) s.checkpoint()
      lastNudgeAt.current = now

      s.moveUiWidget(widget.id, x, y)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
