import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import type { ReactCodeMirrorProps } from '@uiw/react-codemirror'
import { useStore } from '@/state/store'
import { useScriptSandbox, LOG_KIND_LEVEL, type SandboxLogEntry, type SandboxLogKind } from '@/lib/uiDesign/scriptLang/sandboxRuntime'
import { parseScript } from '@/lib/uiDesign/scriptLang/parser'
import { validateScript, type ScriptValidationResult } from '@/lib/uiDesign/scriptLang/validateScript'
import { buildValidationCodegenContext } from '@/lib/export/lvglExport'

// Module-level, never-recreated CodeMirror config — see LvglCodePanel.tsx's own copy of this
// exact note for why: passing fresh `extensions`/`basicSetup` literals on every render forces
// CodeMirror to rebuild its whole editor state on every keystroke, which is what actually causes
// an editor to feel "frozen"/unresponsive, not the amount of text in it.
const JS_EXTENSIONS = [javascript()]
const BASIC_SETUP: ReactCodeMirrorProps['basicSetup'] = {
  lineNumbers: true,
  foldGutter: true,
  autocompletion: true,
  bracketMatching: true,
  closeBrackets: true,
  indentOnInput: true,
  history: true
}
const CODEMIRROR_STYLE: ReactCodeMirrorProps['style'] = { fontSize: 11, height: '100%' }

const LOG_KIND_COLOR: Record<SandboxLogKind, string> = {
  log: 'text-studio-text',
  warn: 'text-studio-warn',
  error: 'text-studio-danger',
  debug: 'text-studio-muted',
  event: 'text-studio-accent',
  info: 'text-studio-accent2'
}

const STATUS_COLOR: Record<ScriptValidationResult['status'], string> = {
  passed: 'text-studio-muted',
  warning: 'text-studio-warn',
  failed: 'text-studio-danger'
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`
  if (v === undefined) return 'undefined'
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** Everything about one log entry a text search could plausibly match against — level, message,
 * and (for a structured event entry) every Event Inspector field, so filtering works the same
 * whether Event Inspector mode is on or off. */
function entrySearchText(entry: SandboxLogEntry): string {
  const parts = [LOG_KIND_LEVEL[entry.kind], entry.message]
  if (entry.event) {
    parts.push(entry.event.widgetVarName, entry.event.widgetType, entry.event.trigger, entry.event.lvglEvent, entry.event.callbackName ?? '', String(entry.event.value ?? ''))
  }
  return parts.join(' ').toLowerCase()
}

function TerminalLine({ entry, eventInspector }: { entry: SandboxLogEntry; eventInspector: boolean }) {
  const color = LOG_KIND_COLOR[entry.kind] ?? 'text-studio-text'
  const time = formatTimestamp(entry.timestamp)
  const level = LOG_KIND_LEVEL[entry.kind]

  if (entry.kind === 'event' && entry.event && eventInspector) {
    const ev = entry.event
    return (
      <div className="flex flex-col">
        <span className={color}>
          [{time}] [{level}] Widget: {ev.widgetVarName}
        </span>
        <span className={color}>
          [{time}] [{level}] Type: {ev.widgetType}
        </span>
        <span className={color}>
          [{time}] [{level}] Event: {ev.lvglEvent} ({ev.trigger})
        </span>
        {ev.value !== undefined && (
          <span className={color}>
            [{time}] [{level}] Value: {formatValue(ev.value)}
          </span>
        )}
        <span className="text-studio-muted">
          [{time}] [{level}] User data: {ev.userData !== undefined ? formatValue(ev.userData) : '—'}
        </span>
        <span className="text-studio-muted">
          [{time}] [{level}] Callback: {ev.callbackName ?? '(anonymous)'}
        </span>
      </div>
    )
  }

  return (
    <span className={color}>
      [{time}] [{level}] {entry.message}
    </span>
  )
}

/** The Logic tab — an editable, run-and-debug JS-like scripting surface for the live preview.
 * This is the "make the LVGL panel work like a small IDE and debugger" feature: unlike the LVGL
 * Code panel (which shows generated C++ that can only ever have a small, pattern-recognized
 * subset of hand-edits applied back — see LvglCodePanel.tsx's own doc comment), there is no C++
 * compiler or LVGL runtime anywhere in this Electron/browser app to actually execute edited C++
 * against. This script, by contrast, really does run — via the browser's own real JS engine (see
 * sandboxRuntime.ts) — so editing it, clicking Apply & Run, and then clicking/dragging widgets in
 * the canvas preview fires the *actual* code you just wrote, not a simulation keyed off widget
 * type. `console.log/warn/error/debug` calls, thrown errors, and every fired widget/hardware event
 * all land in the Terminal below in real time. */
export function LogicPanel() {
  const project = useStore((s) => s.project)
  const script = useStore((s) => s.project.uiDesign.script)
  const setUiScript = useStore((s) => s.setUiScript)
  const checkpoint = useStore((s) => s.checkpoint)

  const [draft, setDraft] = useState(script)
  const lastScriptRef = useRef(script)
  const sandbox = useScriptSandbox()
  const viewRef = useRef<EditorView | null>(null)

  // Resync the draft when `script` changes from OUTSIDE this panel (global undo/redo, loading a
  // different project) — but only if the user has no unapplied edits in progress, so an external
  // change can never silently clobber a manual edit. Reset (below) updates both `draft` and this
  // ref directly, so it doesn't need to round-trip through this effect.
  useEffect(() => {
    if (script !== lastScriptRef.current) {
      if (draft === lastScriptRef.current) setDraft(script)
      lastScriptRef.current = script
    }
  }, [script, draft])

  const hasUnappliedChanges = draft !== script
  const syntaxIssues = useMemo(() => parseScript(draft).errors, [draft])
  const canApply = hasUnappliedChanges && syntaxIssues.length === 0

  const [eventInspector, setEventInspector] = useState(false)
  const [filter, setFilter] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const filteredLogs = useMemo(() => {
    let list = sandbox.logs
    if (errorsOnly) list = list.filter((e) => e.kind === 'error')
    const q = filter.trim().toLowerCase()
    if (q) list = list.filter((e) => entrySearchText(e).includes(q))
    return list
  }, [sandbox.logs, filter, errorsOnly])

  // Classic "stick to bottom" terminal behavior: auto-scroll to the newest entry only if the user
  // was already at (or very near) the bottom before this entry arrived — so scrolling up to read
  // history doesn't get yanked back down by every new event.
  useEffect(() => {
    const el = terminalRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [filteredLogs])

  const handleTerminalScroll = () => {
    const el = terminalRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const validation = useMemo(() => validateScript(script, buildValidationCodegenContext(project)), [script, project])

  const handleApplyAndRun = () => {
    if (!canApply && !hasUnappliedChanges) {
      // No pending edits — Apply & Run just (re)starts the current applied script.
      if (sandbox.running) sandbox.restart()
      else sandbox.start()
      return
    }
    if (!canApply) return
    checkpoint()
    setUiScript(draft)
    lastScriptRef.current = draft
    // setUiScript is synchronous (Zustand), but `script` from useStore won't reflect it until
    // the next render — start() itself always reads uiDesign.script fresh off the store
    // (sandboxRuntime.ts's start()), so calling it here already picks up the just-applied text.
    if (sandbox.running) sandbox.restart()
    else sandbox.start()
  }

  const handleReset = () => {
    if (!hasUnappliedChanges) return
    if (!window.confirm('Discard your unapplied script edits and revert to the last applied version? This cannot be undone with Redo once you continue editing.')) return
    setDraft(script)
    lastScriptRef.current = script
  }

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button className="studio-btn-primary text-xs px-2 py-1" disabled={hasUnappliedChanges && !canApply} onClick={handleApplyAndRun}>
          ▶ Apply &amp; Run
        </button>
        <button className="studio-btn text-xs px-2 py-1" disabled={!sandbox.running} onClick={() => sandbox.stop()}>
          ■ Stop
        </button>
        <button className="studio-btn text-xs px-2 py-1" disabled={!sandbox.running} onClick={() => sandbox.restart()}>
          ↻ Restart
        </button>
        <span className="w-px h-4 bg-studio-border mx-0.5" />
        <button className="studio-btn text-xs px-2 py-1" title="Undo" onClick={() => viewRef.current && cmUndo(viewRef.current)}>
          ↶ Undo
        </button>
        <button className="studio-btn text-xs px-2 py-1" title="Redo" onClick={() => viewRef.current && cmRedo(viewRef.current)}>
          ↷ Redo
        </button>
        <button className="studio-btn text-xs px-2 py-1" disabled={!hasUnappliedChanges} onClick={handleReset}>
          Reset to Last Applied
        </button>
        <span className={`text-[11px] ml-1 ${sandbox.running ? 'text-studio-accent' : 'text-studio-muted'}`}>{sandbox.running ? 'Running — canvas is live' : 'Stopped'}</span>
        {hasUnappliedChanges && syntaxIssues.length === 0 && <span className="text-[11px] text-studio-muted">Unapplied changes — click Apply &amp; Run.</span>}
      </div>

      {sandbox.startupError && (
        <div className="text-[11px] bg-red-500/10 border border-red-500/30 text-red-300 rounded px-2 py-1.5">
          <div className="font-medium">✕ Run failed — the script didn&apos;t start.</div>
          <div className="mt-0.5">{sandbox.startupError}</div>
          <div className="text-red-300/70 mt-0.5">
            Nothing will happen when you interact with widgets until this is fixed and you click Apply &amp; Run again. (Also
            logged in the Terminal below.)
          </div>
        </div>
      )}

      <div className="border border-studio-border rounded overflow-hidden" style={{ height: 220 }}>
        <CodeMirror
          value={draft}
          height="220px"
          theme="dark"
          extensions={JS_EXTENSIONS}
          onChange={(value) => setDraft(value)}
          onCreateEditor={(view) => {
            viewRef.current = view
          }}
          basicSetup={BASIC_SETUP}
          style={CODEMIRROR_STYLE}
          placeholder={'const button = ui.get("#startButton");\nbutton.on("click", () => {\n  console.log("Button clicked");\n});'}
        />
      </div>

      {syntaxIssues.length > 0 && (
        <div className="text-[11px] bg-red-500/10 border border-red-500/30 text-red-300 rounded px-2 py-1.5">
          {syntaxIssues.map((issue, i) => (
            <div key={i}>
              Line {issue.line}: {issue.message}
            </div>
          ))}
          <div className="text-red-300/70 mt-0.5">Apply &amp; Run is disabled until this is fixed.</div>
        </div>
      )}

      {sandbox.simulateTargets.buttons.length > 0 || sandbox.simulateTargets.hasEncoder || sandbox.simulateTargets.sensors.length > 0 ? (
        <div className="studio-panel2 border border-studio-border rounded p-2 flex flex-col gap-1.5">
          <span className="studio-label">Simulate hardware</span>
          <div className="flex flex-wrap gap-1.5">
            {sandbox.simulateTargets.buttons.map((name) => (
              <button key={name} className="studio-btn text-[11px] px-2 py-1" disabled={!sandbox.running} onClick={() => sandbox.simulateButtonPress(name)}>
                Press {name}
              </button>
            ))}
            {sandbox.simulateTargets.hasEncoder && (
              <>
                <button className="studio-btn text-[11px] px-2 py-1" disabled={!sandbox.running} onClick={() => sandbox.simulateEncoderRotate(-1)}>
                  ⟲ Encoder
                </button>
                <button className="studio-btn text-[11px] px-2 py-1" disabled={!sandbox.running} onClick={() => sandbox.simulateEncoderRotate(1)}>
                  ⟳ Encoder
                </button>
              </>
            )}
          </div>
          {sandbox.simulateTargets.sensors.map((name) => (
            <SensorSimulateRow key={name} name={name} disabled={!sandbox.running} onSend={(v) => sandbox.simulateSensorChange(name, v)} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="studio-label">Terminal</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              className="bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-[11px] w-28"
              placeholder="Filter logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <label className="flex items-center gap-1 text-[11px] text-studio-muted cursor-pointer">
              <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
              Errors only
            </label>
            <label className="flex items-center gap-1 text-[11px] text-studio-muted cursor-pointer">
              <input type="checkbox" checked={eventInspector} onChange={(e) => setEventInspector(e.target.checked)} />
              Event Inspector
            </label>
            <button
              className="text-[10px] text-studio-muted hover:text-studio-text"
              onClick={() => (sandbox.paused ? sandbox.resume() : sandbox.pause())}
            >
              {sandbox.paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button className="text-[10px] text-studio-muted hover:text-studio-text" onClick={() => sandbox.clearLogs()}>
              Clear
            </button>
          </div>
        </div>
        <div
          ref={terminalRef}
          onScroll={handleTerminalScroll}
          className="bg-studio-panel2 border border-studio-border rounded p-1.5 h-56 overflow-y-auto text-[10px] font-mono flex flex-col gap-0.5"
        >
          {sandbox.paused && <span className="text-studio-warn">⏸ Paused — new log entries are buffered and will appear when you resume.</span>}
          {filteredLogs.length === 0 && sandbox.logs.length === 0 && (
            <span className="text-studio-muted">Click Apply &amp; Run to start the preview, then interact with widgets on the canvas to see output here.</span>
          )}
          {filteredLogs.length === 0 && sandbox.logs.length > 0 && <span className="text-studio-muted">No log entries match the current filter.</span>}
          {filteredLogs.map((entry) => (
            <TerminalLine key={entry.id} entry={entry} eventInspector={eventInspector} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <span className="studio-label">Variable Inspector</span>
        <div className="bg-studio-panel2 border border-studio-border rounded p-1.5 h-32 overflow-y-auto text-[10px] font-mono flex flex-col gap-0.5">
          {Object.keys(sandbox.variables).length === 0 && <span className="text-studio-muted">No variables yet — run the script.</span>}
          {Object.entries(sandbox.variables).map(([name, value]) => (
            <div key={name} className="flex justify-between gap-2">
              <span>{name}</span>
              <span className="text-studio-muted truncate">{formatValue(value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="studio-label">Script Check (also shown before LVGL export)</span>
        <div className="flex flex-col gap-1">
          {validation.map((row) => (
            <div key={row.category} className="text-[11px]">
              <span className={STATUS_COLOR[row.status]}>
                {row.status === 'passed' ? '✓' : row.status === 'warning' ? '⚠' : '✕'} {row.category}
              </span>
              {row.messages.map((m, i) => (
                <div key={i} className="text-[10px] text-studio-muted pl-4">
                  {m}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SensorSimulateRow({ name, disabled, onSend }: { name: string; disabled: boolean; onSend: (value: number) => void }) {
  const [value, setValue] = useState(0)
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-studio-muted w-20 truncate">{name}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          setValue(v)
          onSend(v)
        }}
        className="flex-1"
      />
      <span className="text-[11px] text-studio-muted w-8 text-right">{value}</span>
    </div>
  )
}
