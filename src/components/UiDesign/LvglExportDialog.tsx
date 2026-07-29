import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/state/store'
import { deriveUiScreenSnakeName, generateLvglExport, generateUiScreenExport, type LvglExportFile } from '@/lib/export/lvglExport'
import { validateLvglExport, type LvglValidationResult } from '@/lib/export/validateLvglExport'
import { ValidationPanel } from '@/components/Export/ExportDialog'
import { createZip } from '@/lib/export/zip'
import { exportBinaryFile } from '@/state/persistence'
import {
  BOARD_LABELS,
  DISPLAY_MODEL_LABELS,
  DISPLAY_PRESETS,
  KIBO_PROJECT_PRESET,
  type DisplayModel,
  type EsBoard,
  type ExportFormat,
  type ExportTarget
} from '@/lib/export/exportTarget'

function LvglValidationPanel({ results }: { results: LvglValidationResult[] }) {
  return (
    <ValidationPanel<LvglValidationResult>
      title="LVGL Export Check"
      results={results}
      itemKey={(r, i) => `${r.category}-${i}`}
      itemTitle={(r) => r.category}
    />
  )
}

const SELECT_CLASS = 'bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs'
const NUM_INPUT_CLASS = 'bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs w-16'

type ExportMode = 'screen' | 'complete'

// UI Design Mode's own export dialog — deliberately a separate component from Eye Studio's
// ExportDialog.tsx (not an extra tab on it), so opening it from the UiDesignTopBar can never
// show any Eye Studio export option. Generation is async (RGB565 asset decoding needs canvas
// APIs) so this dialog tracks its own loading state rather than computing content inline like
// ExportDialog.tsx's synchronous C++/JSON tabs do.
//
// Two modes, per the export feature's own spec: "UI Screen Only" (one screen, standalone .h/.cpp
// pair — generateUiScreenExport) and "Complete Project" (the full KiboExport/ folder, with a
// board/display/pin/format config form — generateLvglExport). The config form's `target` state
// is deliberately ephemeral (component-local, not persisted to the project) — it's a one-off
// export-time choice, not a design decision; see exportTarget.ts's file-top comment.
export function LvglExportDialog() {
  const open = useStore((s) => s.lvglExportDialogOpen)
  const setOpen = useStore((s) => s.setLvglExportDialogOpen)
  const project = useStore((s) => s.project)

  const [mode, setMode] = useState<ExportMode>('complete')
  const [screenId, setScreenId] = useState<string | null>(null)
  // Empty = derive the filename/function names from the screen's own name (the previous,
  // only behavior). Non-empty overrides them — see generateUiScreenExport's customName param.
  const [screenCustomName, setScreenCustomName] = useState('')
  const [target, setTarget] = useState<ExportTarget>(KIBO_PROJECT_PRESET)

  const [files, setFiles] = useState<LvglExportFile[] | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const screens = project.uiDesign.screens

  // Default the screen picker to the first screen whenever the dialog opens (or the previously
  // selected screen was deleted) — matches "select which screen to export" from the spec without
  // requiring an explicit choice for the common single-screen case.
  useEffect(() => {
    if (!open) return
    if (!screenId || !screens.some((s) => s.id === screenId)) {
      setScreenId(screens[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, screens])

  // Switching which screen is selected resets any custom filename back to the (new) screen's
  // own derived default — a custom name typed for one screen shouldn't silently carry over to
  // a different screen.
  useEffect(() => {
    setScreenCustomName('')
  }, [screenId])

  const scope = useMemo(
    () => (mode === 'screen' ? (screenId ? ({ mode: 'screen', screenId } as const) : undefined) : ({ mode: 'complete', target } as const)),
    [mode, screenId, target]
  )
  const validation = useMemo(() => (open && scope ? validateLvglExport(project, scope) : []), [open, project, scope])

  useEffect(() => {
    if (!open) return
    if (mode === 'screen' && !screenId) return
    let cancelled = false
    setFiles(null)
    setNotes([])
    setError(null)
    setActiveFile(0)
    const run =
      mode === 'screen' && screenId
        ? generateUiScreenExport(project, screenId, screenCustomName).then((r) => ({ files: r.files, notes: r.notes }))
        : generateLvglExport(project, target).then((f) => ({ files: f, notes: [] }))
    run
      .then(({ files: f, notes: n }) => {
        if (!cancelled) {
          setFiles(f)
          setNotes(n)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not generate the LVGL export.')
      })
    return () => {
      cancelled = true
    }
    // Regenerate when the dialog opens or the mode/screen/target selection changes — not on
    // every project keystroke, matching the original single-mode dialog's behavior (close/reopen
    // for a fresh export otherwise).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, screenId, screenCustomName, target])

  if (!open) return null

  const selectedScreen = screens.find((s) => s.id === screenId)
  const screenBaseName = deriveUiScreenSnakeName(screenCustomName.trim() || selectedScreen?.name || 'screen')

  const handleDisplayModelChange = (model: DisplayModel) => {
    const preset = DISPLAY_PRESETS[model]
    setTarget((t) => ({ ...t, displayModel: model, width: preset.width, height: preset.height, shape: preset.shape, pins: preset.pins }))
  }

  const handleDownloadZip = async () => {
    if (!files) return
    setDownloading(true)
    try {
      const prefix = mode === 'screen' ? `${screenBaseName}_screen` : 'KiboExport'
      const zipBytes = createZip(files.map((f) => ({ name: `${prefix}/${f.name}`, content: f.content })))
      const filename = mode === 'screen' ? `${screenBaseName}_KiboScreen.zip` : `${project.name.replace(/\s+/g, '_')}_KiboExport.zip`
      const ok = await exportBinaryFile(filename, zipBytes, ['zip'])
      setStatus(ok ? `Exported ${filename}` : null)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center"
        onClick={() => setOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.15 }}
          className="studio-panel w-[860px] max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-3 border-b border-studio-border">
            <div>
              <h3 className="text-sm font-semibold">Export LVGL C++ (UI/UX Design)</h3>
              <p className="text-[11px] text-studio-muted">LVGL UI code only, no Eye Studio content.</p>
            </div>
            <button className="studio-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="flex items-center gap-1 p-2 border-b border-studio-border">
            <button className={`studio-tab ${mode === 'screen' ? 'studio-tab-active' : ''}`} onClick={() => setMode('screen')}>
              UI Screen Only
            </button>
            <button className={`studio-tab ${mode === 'complete' ? 'studio-tab-active' : ''}`} onClick={() => setMode('complete')}>
              Complete Project (.zip)
            </button>
          </div>

          {mode === 'screen' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2 border-b border-studio-border text-xs">
              <label className="flex items-center gap-1">
                <span className="text-studio-muted">Screen:</span>
                {screens.length === 0 ? (
                  <span className="text-studio-muted">No screens in this project yet.</span>
                ) : (
                  <select className={SELECT_CLASS} value={screenId ?? ''} onChange={(e) => setScreenId(e.target.value)}>
                    {screens.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              {screens.length > 0 && (
                <label className="flex items-center gap-1">
                  <span className="text-studio-muted">File name:</span>
                  <input
                    className={SELECT_CLASS}
                    placeholder={deriveUiScreenSnakeName(selectedScreen?.name ?? 'screen')}
                    value={screenCustomName}
                    onChange={(e) => setScreenCustomName(e.target.value)}
                  />
                  <span className="text-studio-muted font-mono">
                    {screenBaseName}_screen.h / .cpp
                  </span>
                </label>
              )}
              <span className="text-studio-muted basis-full">Standalone .h/.cpp — no LVGL/display/SPI/board init, drop into any existing LVGL project.</span>
            </div>
          )}

          {mode === 'complete' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2 border-b border-studio-border text-xs">
              <label className="flex items-center gap-1">
                <span className="text-studio-muted">Board:</span>
                <select
                  className={SELECT_CLASS}
                  value={target.board}
                  onChange={(e) => setTarget((t) => ({ ...t, board: e.target.value as EsBoard }))}
                >
                  {(Object.keys(BOARD_LABELS) as EsBoard[]).map((b) => (
                    <option key={b} value={b}>
                      {BOARD_LABELS[b]}
                    </option>
                  ))}
                </select>
              </label>
              {target.board === 'custom' && (
                <input
                  className={SELECT_CLASS}
                  placeholder="e.g. esp32:esp32:esp32c6"
                  value={target.boardFqbnCustom}
                  onChange={(e) => setTarget((t) => ({ ...t, boardFqbnCustom: e.target.value }))}
                />
              )}
              <label className="flex items-center gap-1">
                <span className="text-studio-muted">Display:</span>
                <select className={SELECT_CLASS} value={target.displayModel} onChange={(e) => handleDisplayModelChange(e.target.value as DisplayModel)}>
                  {(Object.keys(DISPLAY_MODEL_LABELS) as DisplayModel[]).map((d) => (
                    <option key={d} value={d}>
                      {DISPLAY_MODEL_LABELS[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-studio-muted">Resolution:</span>
                <input
                  type="number"
                  className={NUM_INPUT_CLASS}
                  value={target.width}
                  onChange={(e) => setTarget((t) => ({ ...t, width: Number(e.target.value) || t.width }))}
                />
                <span className="text-studio-muted">x</span>
                <input
                  type="number"
                  className={NUM_INPUT_CLASS}
                  value={target.height}
                  onChange={(e) => setTarget((t) => ({ ...t, height: Number(e.target.value) || t.height }))}
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-studio-muted">Shape:</span>
                <select className={SELECT_CLASS} value={target.shape} onChange={(e) => setTarget((t) => ({ ...t, shape: e.target.value as ExportTarget['shape'] }))}>
                  <option value="round">Round</option>
                  <option value="square">Square</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-studio-muted">Format:</span>
                <div className="flex items-center gap-1">
                  <button
                    className={`studio-tab ${target.format === 'arduino' ? 'studio-tab-active' : ''}`}
                    onClick={() => setTarget((t) => ({ ...t, format: 'arduino' as ExportFormat }))}
                  >
                    Arduino IDE
                  </button>
                  <button
                    className={`studio-tab ${target.format === 'platformio' ? 'studio-tab-active' : ''}`}
                    onClick={() => setTarget((t) => ({ ...t, format: 'platformio' as ExportFormat }))}
                  >
                    PlatformIO
                  </button>
                </div>
              </label>
              <div className="flex items-center gap-2 basis-full">
                <span className="text-studio-muted">Pins (CS / DC / RST / SCLK / MOSI):</span>
                {(['cs', 'dc', 'rst', 'sclk', 'mosi'] as const).map((pin) => (
                  <input
                    key={pin}
                    type="number"
                    className={NUM_INPUT_CLASS}
                    value={target.pins[pin]}
                    onChange={(e) => setTarget((t) => ({ ...t, pins: { ...t.pins, [pin]: Number(e.target.value) } }))}
                  />
                ))}
                <span className="text-studio-muted">LVGL 9.x (matches this project)</span>
              </div>
            </div>
          )}

          <LvglValidationPanel results={validation} />

          {notes.length > 0 && (
            <div className="mx-3 mt-2 text-[11px] text-studio-muted space-y-1">
              {notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          )}

          {error && <div className="mx-3 mt-3 text-xs text-studio-danger">{error}</div>}

          {mode === 'screen' && screens.length === 0 && <div className="flex-1 flex items-center justify-center text-sm text-studio-muted p-6">Add a screen in UI/UX Design Mode first.</div>}

          {!files && !error && !(mode === 'screen' && screens.length === 0) && <div className="flex-1 flex items-center justify-center text-sm text-studio-muted p-6">Generating export…</div>}

          {files && (
            <>
              <div className="flex items-center gap-1 p-2 border-b border-studio-border overflow-x-auto">
                {files.map((f, i) => (
                  <button
                    key={f.name}
                    className={`studio-tab shrink-0 ${activeFile === i ? 'studio-tab-active' : ''}`}
                    onClick={() => setActiveFile(i)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-studio-bg m-3 rounded-md border border-studio-border whitespace-pre">
                {files[activeFile]?.content}
              </pre>
            </>
          )}

          <div className="flex items-center justify-between p-3 border-t border-studio-border">
            <span className="text-xs text-studio-muted">{status}</span>
            <button className="studio-btn-primary" disabled={!files || downloading} onClick={handleDownloadZip}>
              {downloading ? 'Preparing…' : mode === 'screen' ? 'Download Screen.zip' : 'Download KiboExport.zip'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
