import { useMemo, useState } from 'react'
import { useStore } from '@/state/store'
import { useScriptSandbox } from '@/lib/uiDesign/scriptLang/sandboxRuntime'
import { validateScript, type ScriptValidationResult } from '@/lib/uiDesign/scriptLang/validateScript'
import { buildValidationCodegenContext } from '@/lib/export/lvglExport'

const LOG_KIND_COLOR: Record<string, string> = {
  log: 'text-studio-text',
  warn: 'text-studio-warn',
  error: 'text-studio-danger',
  event: 'text-studio-accent'
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

/** The Logic tab — script editor (plain controlled textarea; unlike HTML/CSS, the script text
 * IS the source of truth, not a regenerated mirror, so there's no separate "live vs draft" text
 * to reconcile beyond the usual "don't fight the user's typing while focused" convention every
 * text editor in this app already uses) plus Run/Stop/Restart, a combined Debug Console/Event
 * Log, a Variable Inspector, hardware Simulate controls, and a compact Script Check panel (the
 * same categories the LVGL export dialog's validation shows — see validateScript.ts). */
export function LogicPanel() {
  const project = useStore((s) => s.project)
  const script = useStore((s) => s.project.uiDesign.script)
  const setUiScript = useStore((s) => s.setUiScript)
  const checkpoint = useStore((s) => s.checkpoint)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const sandbox = useScriptSandbox()

  const validation = useMemo(() => validateScript(script, buildValidationCodegenContext(project)), [script, project])

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <button className="studio-btn text-xs px-2 py-1" disabled={sandbox.running} onClick={() => sandbox.start()}>
          ▶ Run
        </button>
        <button className="studio-btn text-xs px-2 py-1" disabled={!sandbox.running} onClick={() => sandbox.stop()}>
          ■ Stop
        </button>
        <button className="studio-btn text-xs px-2 py-1" disabled={!sandbox.running} onClick={() => sandbox.restart()}>
          ↻ Restart
        </button>
        <span className={`text-[11px] ml-1 ${sandbox.running ? 'text-studio-accent' : 'text-studio-muted'}`}>{sandbox.running ? 'Running — canvas is live' : 'Stopped'}</span>
      </div>

      <textarea
        className="text-[11px] font-mono bg-studio-panel2 border border-studio-border rounded p-2 min-h-[220px] resize-y"
        placeholder={'const button = ui.get("#startButton");\nbutton.on("click", () => {\n  ...\n});'}
        value={editing ? draft : script}
        onFocus={() => {
          setDraft(script)
          setEditing(true)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft === script) return
          checkpoint()
          setUiScript(draft)
        }}
        spellCheck={false}
      />

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

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="studio-label">Debug Console &amp; Event Log</span>
            <button className="text-[10px] text-studio-muted hover:text-studio-text" onClick={() => sandbox.clearLogs()}>
              Clear
            </button>
          </div>
          <div className="bg-studio-panel2 border border-studio-border rounded p-1.5 h-40 overflow-y-auto text-[10px] font-mono flex flex-col gap-0.5">
            {sandbox.logs.length === 0 && <span className="text-studio-muted">Run the script to see console output, fired events, and errors here.</span>}
            {sandbox.logs.map((entry) => (
              <span key={entry.id} className={LOG_KIND_COLOR[entry.kind] ?? 'text-studio-text'}>
                [{entry.kind}] {entry.message}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="studio-label">Variable Inspector</span>
          <div className="bg-studio-panel2 border border-studio-border rounded p-1.5 h-40 overflow-y-auto text-[10px] font-mono flex flex-col gap-0.5">
            {Object.keys(sandbox.variables).length === 0 && <span className="text-studio-muted">No variables yet — run the script.</span>}
            {Object.entries(sandbox.variables).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-2">
                <span>{name}</span>
                <span className="text-studio-muted truncate">{formatValue(value)}</span>
              </div>
            ))}
          </div>
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
