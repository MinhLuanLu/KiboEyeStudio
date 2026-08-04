import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { cpp } from '@codemirror/lang-cpp'
import type { ReactCodeMirrorProps } from '@uiw/react-codemirror'
import { useStore } from '@/state/store'
import { generateLiveScreenCode } from '@/lib/export/lvglExport'
import { checkCppBalance } from '@/lib/uiDesign/cppSyntaxCheck'
import { findRecognizedCodeChanges, patchCodeWithWidgetValues, hasStructuralDrift } from '@/lib/uiDesign/codeSync'

// Module-level, never-recreated CodeMirror config. `@uiw/react-codemirror` reconfigures its
// internal extension compartments whenever the `extensions` array or `basicSetup` object it's
// given is a *new reference*, even if the content is identical — passing fresh literals here on
// every render (as this panel originally did) forced a real editor-state rebuild on every single
// keystroke, which is what actually produced the reported "editor freezes / becomes unresponsive"
// symptom, not just a slow codegen call. Keeping both as stable module-level constants means a
// render only ever touches the document `value`, which CodeMirror can diff cheaply.
const CPP_EXTENSIONS = [cpp()]
const BASIC_SETUP: ReactCodeMirrorProps['basicSetup'] = {
  lineNumbers: true,
  foldGutter: true,
  autocompletion: true,
  bracketMatching: true,
  closeBrackets: true,
  indentOnInput: true
}
const CODEMIRROR_STYLE: ReactCodeMirrorProps['style'] = { fontSize: 11, height: '100%' }

// How long to wait after the *last* widget-side edit before re-scanning/patching an applied code
// override. This is the panel's actual "keep the UI responsive while things change" mechanism —
// see codeSync.ts's file-top comment for why a background Worker thread isn't used instead: the
// scan itself is sub-millisecond, so debouncing *when* it runs (coalescing a burst of rapid
// widget edits, e.g. a canvas drag, into a single patch) is what matters, not moving it off-thread.
const AUTO_PATCH_DEBOUNCE_MS = 200

// "LVGL Code" tab — an editable, two-way-synced live view of the currently active screen's
// generated LVGL C++.
//
// Important scope note (why this doesn't "run" LVGL): there is no C++ compiler or LVGL runtime
// anywhere in this Electron/browser app, so edited code here cannot actually be compiled or
// executed (that rules out interpreting arbitrary C++ — event callback bodies, custom function
// calls, anything outside the recognized shapes below). What actually happens, in both
// directions, both built on the fixed set of recognized call shapes (lv_obj_set_pos/set_size,
// lv_*_set_text, lv_obj_add/remove_flag(..., LV_OBJ_FLAG_HIDDEN), lv_slider/bar/arc's set_value,
// lv_obj_add/remove_state(..., LV_STATE_CHECKED), and the per-widget local-style calls for
// background/text/border color, border width, corner radius, and opacity) from codeSync.ts:
//  1. CODE -> WIDGETS (click Apply): your edited text becomes this screen's `customCode`
//     override (see UiScreen in types/uiDesign.ts) and is shown here instead of the
//     live-generated code from then on, until you explicitly discard it. findRecognizedCodeChanges()
//     re-scans the applied text and applies whatever it finds back onto the matching widget's
//     actual style/text/visibility/value/checked state — in one batched store update, mutating only
//     the affected widgets by id (never deleting/recreating anything, so ids/hierarchy/refs used by
//     other panels are untouched) — so the canvas preview *and* the Properties panel (which reads
//     the same widget-by-id store state) both visibly update. Apply is disabled while the code has
//     a syntax error (see the red box below) — the last-applied valid state is kept untouched until
//     the error is fixed.
//  2. WIDGETS -> CODE (automatic, debounced): whenever the visual designer changes a widget already
//     referenced in an applied override (drag/resize in Properties panel, Icon picker, etc.), an
//     effect below calls patchCodeWithWidgetValues() to rewrite just that widget's recognized calls
//     in place — so Properties-panel edits show up in the code within ~200ms, without waiting for a
//     manual Reset, and without touching anything the pattern-matcher doesn't recognize.
// Anything outside those recognized shapes (event handler bodies, custom calls, colors, a widget
// added/removed) has no code<->widget correspondence in either direction — for structural
// changes specifically (a widget added or removed), the staleness banner below still tells you
// your override no longer matches 1:1, since patching can rewrite existing calls' arguments but
// can't add or remove calls. This is a pattern-matching two-way sync, not code execution, mirroring
// the same "only surface what's structurally recognizable" approach this app's HTML/CSS/script
// visual editors already use. It is intentionally NOT read by the "Export LVGL C++..."
// generators, so it can never desync from or break the real downloadable project.
export function LvglCodePanel() {
  // Narrowed to just uiDesign (not the whole `project`, which also carries every Eye Studio
  // field) so this panel only re-renders — and only re-runs the codegen/patch work below — when
  // something it actually reads has changed, instead of on every unrelated store mutation
  // elsewhere in the app. This alone removes a lot of the churn that made the editor feel like it
  // was freezing: every unrelated store write used to force this panel (and CodeMirror inside it)
  // to re-render and recompute.
  const uiDesign = useStore((s) => s.project.uiDesign)
  const activeScreenId = uiDesign.activeScreenId
  const screen = useMemo(() => uiDesign.screens.find((s) => s.id === activeScreenId) ?? null, [uiDesign.screens, activeScreenId])
  const applyUiScreenCustomCode = useStore((s) => s.applyUiScreenCustomCode)
  const resetUiScreenCustomCode = useStore((s) => s.resetUiScreenCustomCode)
  const patchUiScreenCustomCode = useStore((s) => s.patchUiScreenCustomCode)
  const updateUiWidgetStyle = useStore((s) => s.updateUiWidgetStyle)
  const updateUiWidgetText = useStore((s) => s.updateUiWidgetText)
  const setUiWidgetVisible = useStore((s) => s.setUiWidgetVisible)
  const updateUiWidgetProps = useStore((s) => s.updateUiWidgetProps)
  const checkpoint = useStore((s) => s.checkpoint)

  // Codegen is a real (if fast) tree walk — memoized so it only reruns when the design or active
  // screen actually changes, not on every render this component happens to take (e.g. while the
  // user is mid-keystroke and `isOverridden` means this value isn't even displayed).
  const generatedCode = useMemo(() => generateLiveScreenCode(uiDesign, activeScreenId), [uiDesign, activeScreenId])
  const isOverridden = screen?.customCode != null
  const appliedValue = isOverridden ? screen!.customCode! : generatedCode

  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(appliedValue)
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [autoSynced, setAutoSynced] = useState(false)
  const syncedCountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (syncedCountTimeoutRef.current) clearTimeout(syncedCountTimeoutRef.current)
    }
  }, [])

  // Resync the draft to whatever's actually applied (live-generated, or this screen's own
  // override) whenever the screen switches or an Apply/Reset changes the applied value out from
  // under us — but deliberately NOT on every keystroke elsewhere in the app, since that's exactly
  // the "don't overwrite manual edits" behavior this panel needs while a draft is in progress.
  useEffect(() => {
    setDraft(appliedValue)
    setEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScreenId, screen?.customCode])

  // WIDGETS -> CODE: whenever the visual designer changes a widget already referenced in an
  // applied override (Properties panel edit, drag/resize, Icon picker, ...), rewrite just that
  // widget's recognized calls in the override text to match — see codeSync.ts's
  // patchCodeWithWidgetValues doc comment. Skipped while `editing` (an in-progress, unapplied
  // keystroke in this panel takes priority — same "don't clobber what the user's mid-typing"
  // principle as the draft-resync effect above). Debounced (see AUTO_PATCH_DEBOUNCE_MS) so a burst
  // of rapid widget edits — e.g. dragging a slider or a canvas drag emitting many store writes in
  // a row — coalesces into a single patch/store-write instead of one per intermediate value,
  // instead of doing this expensive-ish work synchronously on every store tick. patchUiScreenCustomCode
  // itself also no-ops (no new store reference, so no re-render) when the patch produces no change,
  // which is what stops this from looping on its own write: patching is idempotent (see
  // patchCodeWithWidgetValues's doc comment), so the second pass this triggers always finds nothing
  // left to change and settles — it can never ping-pong indefinitely.
  useEffect(() => {
    if (!screen || screen.customCode == null || editing) return
    const code = screen.customCode
    const screenId = screen.id
    const timer = setTimeout(() => {
      const patched = patchCodeWithWidgetValues(uiDesign, screen, code)
      if (patched === code) return
      patchUiScreenCustomCode(screenId, patched)
      setAutoSynced(true)
      setTimeout(() => setAutoSynced(false), 1800)
    }, AUTO_PATCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [uiDesign, screen, editing, patchUiScreenCustomCode])

  const displayedValue = editing || isOverridden ? draft : generatedCode
  // Compared against displayedValue (not draft directly) so a stale draft — left over from
  // before the user started typing, while generatedCode kept moving on every design edit — never
  // reads as a false "unapplied changes": when not actively editing and not overridden,
  // displayedValue tracks generatedCode live, so this correctly stays false until a real edit.
  const hasUnappliedChanges = displayedValue !== appliedValue
  // Only flags STRUCTURAL drift (a widget added/removed since you applied your edits) — the kind
  // of change patchCodeWithWidgetValues genuinely can't absorb, since it only rewrites existing
  // calls' arguments and never adds/removes calls. Ordinary position/size/text/visibility/value
  // edits to widgets your code already references are kept in sync automatically by the effect
  // above, so they deliberately do NOT trigger this banner.
  const isStale = isOverridden && screen != null && hasStructuralDrift(uiDesign, screen, screen.customCode!)

  const issues = useMemo(() => checkCppBalance(displayedValue), [displayedValue])
  // Syntax errors keep the last valid state: Apply is unavailable while the code doesn't even
  // balance, so a broken edit can never reach the widgets, the canvas, or the Properties panel.
  const canApply = hasUnappliedChanges && issues.length === 0

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayedValue)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard access can fail (permissions/insecure context) — non-fatal, the code is still visible to select/copy by hand */
    }
  }

  const handleApply = () => {
    if (!screen || issues.length > 0) return
    const recognized = findRecognizedCodeChanges(uiDesign, screen, displayedValue)
    checkpoint()
    for (const change of recognized) {
      if (change.style) updateUiWidgetStyle(change.widgetId, change.style)
      if (change.text !== undefined) updateUiWidgetText(change.widgetId, change.text)
      if (change.visible !== undefined) setUiWidgetVisible(change.widgetId, change.visible)
      if (change.value !== undefined) updateUiWidgetProps(change.widgetId, { value: change.value })
      if (change.checked !== undefined) updateUiWidgetProps(change.widgetId, { checked: change.checked })
    }
    // Regenerate the internal model from the just-applied widget values in the same tick, rather
    // than waiting for the debounced auto-patch effect on a later render — so the stored override
    // and the widget tree/Properties panel can never disagree, even for one frame, right after Apply.
    const freshUiDesign = useStore.getState().project.uiDesign
    const reconciled = patchCodeWithWidgetValues(freshUiDesign, screen, displayedValue)
    applyUiScreenCustomCode(screen.id, reconciled, generatedCode)
    setEditing(false)
    setSyncedCount(recognized.length)
    if (syncedCountTimeoutRef.current) clearTimeout(syncedCountTimeoutRef.current)
    syncedCountTimeoutRef.current = setTimeout(() => setSyncedCount(null), 3000)
  }

  const handleReset = () => {
    if (!screen) return
    if (!window.confirm('Discard your manually edited code and go back to the live-generated code? This cannot be undone with Redo once you continue editing.')) return
    checkpoint()
    resetUiScreenCustomCode(screen.id)
    setEditing(false)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-studio-muted">
          {isOverridden ? (
            <>
              Showing your <span className="text-studio-text">manually edited</span> code for this screen. Typing here needs{' '}
              <span className="text-studio-text">Apply Changes</span> below — but Properties-panel edits to widgets already in
              your code sync into it automatically, no button needed.
            </>
          ) : (
            <>
              Live LVGL code for the current screen — updates automatically as you design. Edit it directly and click{' '}
              <span className="text-studio-text">Apply Changes</span> to keep your edits.
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {autoSynced && <span className="text-[11px] text-green-400 whitespace-nowrap">↻ Auto-synced</span>}
          <button className="studio-btn text-xs" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {isStale && (
        <div className="text-[11px] bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 rounded px-2 py-1.5 flex items-center justify-between gap-2">
          <span>The generated code has changed since you applied your edits (something changed elsewhere in the design). Your manual edits are kept.</span>
          <button className="studio-btn text-[11px] shrink-0" onClick={handleReset}>
            Discard edits &amp; regenerate
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto border border-studio-border rounded">
        <CodeMirror
          value={displayedValue}
          height="100%"
          theme="dark"
          extensions={CPP_EXTENSIONS}
          onChange={(value) => {
            setDraft(value)
            setEditing(true)
          }}
          basicSetup={BASIC_SETUP}
          style={CODEMIRROR_STYLE}
        />
      </div>

      {issues.length > 0 && (
        <div className="text-[11px] bg-red-500/10 border border-red-500/30 text-red-300 rounded px-2 py-1.5">
          {issues.map((issue, i) => (
            <div key={i}>
              Line {issue.line}: {issue.message}
            </div>
          ))}
          <div className="text-red-300/70 mt-0.5">
            Apply Changes is disabled until this is fixed — the last successfully applied code is still what's shown in the
            preview and Properties panel. (Basic bracket-balance check only — this app has no C++ compiler available to catch
            real compile errors.)
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button className="studio-btn text-xs" disabled={!canApply} onClick={handleApply}>
          Apply Changes
        </button>
        {isOverridden && (
          <button className="studio-btn text-xs" onClick={handleReset}>
            Reset to Generated Code
          </button>
        )}
        {hasUnappliedChanges && issues.length === 0 && (
          <span className="text-[11px] text-studio-muted">Unapplied changes — click Apply Changes to keep them.</span>
        )}
        {syncedCount !== null &&
          (syncedCount > 0 ? (
            <span className="text-[11px] text-green-400">
              ✓ Synced {syncedCount} widget{syncedCount === 1 ? '' : 's'} to the visual design — canvas and Properties panel
              updated.
            </span>
          ) : (
            <span className="text-[11px] text-studio-muted">Applied — no recognized position/size/text/visibility/value calls found to sync to the canvas.</span>
          ))}
      </div>
    </div>
  )
}
