import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/state/store'
import {
  deriveUiScreenSnakeName,
  generateHeaderExport,
  generateLvglExport,
  generateModuleExport,
  generateUiScreenExport,
  type LvglExportFile
} from '@/lib/export/lvglExport'
import { validateLvglExport, type LvglValidationResult } from '@/lib/export/validateLvglExport'
import { ValidationPanel } from '@/components/Export/ExportDialog'
import { createZip } from '@/lib/export/zip'
import { exportBinaryFile } from '@/state/persistence'
import { sanitizeFilename, sanitizeIdentifier } from '@/lib/export/naming'
import { extractUserCodeBlocksFromFiles, mergeUserCode } from '@/lib/export/userCodeMerge'
import { LvglMultiScreenPreview, LvglScreenPreview } from './LvglPreviewCanvas'
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

type ExportMode = 'complete' | 'module' | 'header' | 'screen'

// UI Design Mode's own export dialog — deliberately a separate component from Eye Studio's
// ExportDialog.tsx (not an extra tab on it), so opening it from the UiDesignTopBar can never
// show any Eye Studio export option. Generation is async (RGB565 asset decoding needs canvas
// APIs) so this dialog tracks its own loading state rather than computing content inline like
// ExportDialog.tsx's synchronous C++/JSON tabs do.
//
// Four modes:
// - 'complete' (default) — ready-to-compile project: entry sketch + ui.h/.cpp(+assets) + config.h
//   + lv_conf.h + README.md, with a board/display/pin/format config form (generateLvglExport).
// - 'module' — the same ui.h/.cpp(+assets) content, without the entry sketch/config.h/lv_conf.h —
//   for dropping into an existing sketch that already calls lv_init() (generateModuleExport).
// - 'header' — module's files folded into one ui.h, for small projects (generateHeaderExport).
// - 'screen' ("UI Screen Only") — one screen, standalone .h/.cpp pair, kept as its own distinct
//   picker since it's scoped to a single screen rather than the whole project (generateUiScreenExport).
// The config form's `target` state (complete mode only) is deliberately ephemeral (component-local,
// not persisted to the project) — see exportTarget.ts's file-top comment.
export function LvglExportDialog() {
  const open = useStore((s) => s.lvglExportDialogOpen)
  const setOpen = useStore((s) => s.setLvglExportDialogOpen)
  const project = useStore((s) => s.project)
  const renameProject = useStore((s) => s.renameProject)

  const [mode, setMode] = useState<ExportMode>('complete')
  const [screenId, setScreenId] = useState<string | null>(null)
  // Empty = derive the filename/function names from the screen's own name (the previous,
  // only behavior). Non-empty overrides them — see generateUiScreenExport's customName param.
  const [screenCustomName, setScreenCustomName] = useState('')
  const [target, setTarget] = useState<ExportTarget>(KIBO_PROJECT_PRESET)

  const [rawFiles, setRawFiles] = useState<LvglExportFile[] | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  // "Restore custom code from a previous export" — Complete Project mode only (see the file-drop
  // section below). Ephemeral dialog-local state, same as `target` — never persisted to the
  // project. Populated by reading dropped/browsed file(s) as text and pulling out every
  // `// USER CODE BEGIN <name>` ... `// USER CODE END <name>` block (see userCodeMerge.ts).
  const [restoredUserCode, setRestoredUserCode] = useState<Map<string, string>>(new Map())
  const [restoredFileNames, setRestoredFileNames] = useState<string[]>([])
  const restoreInputRef = useRef<HTMLInputElement>(null)

  // The files actually shown/downloaded — `rawFiles` with any restored USER CODE blocks spliced
  // back in. Kept as a derived value (not baked into the generation effect) so restoring/clearing
  // custom code doesn't need to re-run the async asset-decode generation step.
  const files = useMemo(() => {
    if (!rawFiles) return null
    if (mode === 'screen' || restoredUserCode.size === 0) return rawFiles
    return rawFiles.map((f) => ({ ...f, content: mergeUserCode(f.content, restoredUserCode) }))
  }, [rawFiles, mode, restoredUserCode])

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

  const scope = useMemo(() => {
    if (mode === 'screen') return screenId ? ({ mode: 'screen', screenId } as const) : undefined
    if (mode === 'complete') return { mode: 'complete', target } as const
    return { mode } as const
  }, [mode, screenId, target])
  const validation = useMemo(() => (open && scope ? validateLvglExport(project, scope) : []), [open, project, scope])

  useEffect(() => {
    if (!open) return
    if (mode === 'screen' && !screenId) return
    let cancelled = false
    setRawFiles(null)
    setNotes([])
    setError(null)
    setActiveFile(0)
    const run =
      mode === 'screen' && screenId
        ? generateUiScreenExport(project, screenId, screenCustomName).then((r) => ({ files: r.files, notes: r.notes }))
        : mode === 'module'
          ? generateModuleExport(project).then((f) => ({ files: f, notes: [] }))
          : mode === 'header'
            ? generateHeaderExport(project).then((f) => ({ files: f, notes: [] }))
            : generateLvglExport(project, target).then((f) => ({ files: f, notes: [] }))
    run
      .then(({ files: f, notes: n }) => {
        if (!cancelled) {
          setRawFiles(f)
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

  const handleRestoreFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const texts = await Promise.all(Array.from(fileList).map((f) => f.text()))
    const blocks = extractUserCodeBlocksFromFiles(texts)
    setRestoredUserCode(blocks)
    setRestoredFileNames(Array.from(fileList).map((f) => f.name))
  }

  const handleClearRestoredUserCode = () => {
    setRestoredUserCode(new Map())
    setRestoredFileNames([])
  }

  const projectFolderName = sanitizeFilename(project.name)
  const projectNamespace = sanitizeIdentifier(project.name)
  const zipFilename =
    mode === 'screen'
      ? `${screenBaseName}_screen.zip`
      : mode === 'module'
        ? `${projectFolderName}_module.zip`
        : mode === 'header'
          ? `${projectFolderName}_header.zip`
          : `${projectFolderName}.zip`

  const handleDownloadZip = async () => {
    if (!files) return
    setDownloading(true)
    try {
      const prefix = mode === 'screen' ? `${screenBaseName}_screen` : projectFolderName
      const zipBytes = createZip(files.map((f) => ({ name: `${prefix}/${f.name}`, content: f.content })))
      const ok = await exportBinaryFile(zipFilename, zipBytes, ['zip'])
      setStatus(ok ? `Exported ${zipFilename}` : null)
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
          className="studio-panel w-[1040px] max-h-[85vh] flex flex-col"
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
            <button className={`studio-tab ${mode === 'complete' ? 'studio-tab-active' : ''}`} onClick={() => setMode('complete')}>
              Complete Project
            </button>
            <button className={`studio-tab ${mode === 'module' ? 'studio-tab-active' : ''}`} onClick={() => setMode('module')}>
              Module
            </button>
            <button className={`studio-tab ${mode === 'header' ? 'studio-tab-active' : ''}`} onClick={() => setMode('header')}>
              Header
            </button>
            <button className={`studio-tab ${mode === 'screen' ? 'studio-tab-active' : ''}`} onClick={() => setMode('screen')}>
              UI Screen Only
            </button>
          </div>

          {mode !== 'screen' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 p-2 border-b border-studio-border text-xs">
              <label className="flex items-center gap-1">
                <span className="text-studio-muted">
                  Project Name<span className="text-studio-danger">*</span>:
                </span>
                <input
                  className={`${SELECT_CLASS} ${project.name.trim() ? '' : 'border-studio-danger'}`}
                  value={project.name}
                  onChange={(e) => renameProject(e.target.value)}
                  placeholder="Required — used for the folder/zip/namespace names below"
                />
              </label>
              <span className="text-studio-muted font-mono basis-full">
                {mode === 'complete' && `${projectFolderName}/${target.format === 'arduino' ? `${projectFolderName}.ino` : 'src/main.cpp'} · `}
                namespace {projectNamespace} · {zipFilename}
              </span>
            </div>
          )}

          {mode === 'module' && (
            <div className="p-2 border-b border-studio-border text-xs text-studio-muted">
              ui.h/ui.cpp{`(/assets.h/.cpp)`} only — no entry sketch, config.h, or lv_conf.h. Drop into an existing sketch that already calls lv_init() and has a display registered.
            </div>
          )}

          {mode === 'header' && (
            <div className="p-2 border-b border-studio-border text-xs text-studio-muted">
              Everything folded into one ui.h — the smallest drop-in shape, best for small projects. No LVGL/display/SPI/board init anywhere in the file.
            </div>
          )}

          {(mode === 'complete' || mode === 'module' || mode === 'header') && (
            <div className="flex items-center gap-2 p-2 border-b border-studio-border text-xs">
              <input
                ref={restoreInputRef}
                type="file"
                multiple
                accept=".ino,.cpp,.h"
                className="hidden"
                onChange={(e) => {
                  void handleRestoreFilesSelected(e.target.files)
                  e.target.value = ''
                }}
              />
              <button className="studio-btn" onClick={() => restoreInputRef.current?.click()}>
                Restore custom code from a previous export (optional)…
              </button>
              {restoredFileNames.length > 0 && (
                <>
                  <span className="text-studio-muted">
                    {restoredUserCode.size} custom code block{restoredUserCode.size === 1 ? '' : 's'} restored from {restoredFileNames.join(', ')}
                  </span>
                  <button className="studio-btn" onClick={handleClearRestoredUserCode}>
                    Clear
                  </button>
                </>
              )}
            </div>
          )}

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
                  <span className="text-studio-muted font-mono">{screenBaseName}_screen.h</span>
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
            <div className="flex-1 min-h-0 flex">
              <div className="w-[240px] shrink-0 border-r border-studio-border overflow-y-auto">
                <div className="px-2 pt-2 text-[10px] uppercase tracking-wide text-studio-muted">Preview — how this looks</div>
                {mode === 'screen' ? <LvglScreenPreview screenId={screenId} /> : <LvglMultiScreenPreview />}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
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
              </div>
            </div>
          )}

          <div className="flex items-center justify-between p-3 border-t border-studio-border">
            <span className="text-xs text-studio-muted">{status}</span>
            <button className="studio-btn-primary" disabled={!files || downloading} onClick={handleDownloadZip}>
              {downloading ? 'Preparing…' : `Download ${zipFilename}`}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
