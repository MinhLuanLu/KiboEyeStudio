import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/state/store'
import { generateLvglExport, type LvglExportFile } from '@/lib/export/lvglExport'
import { validateLvglExport, type LvglValidationResult } from '@/lib/export/validateLvglExport'
import { ValidationPanel } from '@/components/Export/ExportDialog'
import { createZip } from '@/lib/export/zip'
import { exportBinaryFile } from '@/state/persistence'

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

// UI Design Mode's own export dialog — deliberately a separate component from Eye Studio's
// ExportDialog.tsx (not an extra tab on it), so opening it from the UiDesignTopBar can never
// show any Eye Studio export option. Generation is async (RGB565 asset decoding needs canvas
// APIs) so this dialog tracks its own loading state rather than computing content inline like
// ExportDialog.tsx's synchronous C++/JSON tabs do.
export function LvglExportDialog() {
  const open = useStore((s) => s.lvglExportDialogOpen)
  const setOpen = useStore((s) => s.setLvglExportDialogOpen)
  const project = useStore((s) => s.project)

  const [files, setFiles] = useState<LvglExportFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const validation = useMemo(() => (open ? validateLvglExport(project) : []), [open, project])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setFiles(null)
    setError(null)
    setActiveFile(0)
    generateLvglExport(project)
      .then((f) => {
        if (!cancelled) setFiles(f)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not generate the LVGL export.')
      })
    return () => {
      cancelled = true
    }
    // Regenerate only when the dialog opens, not on every project keystroke — a manual
    // "Refresh" isn't offered because there's nothing slow enough here to matter; the dialog
    // is closed and reopened for a fresh export, matching the folder-of-files nature of this
    // export (unlike the single-text-blob Eye Studio dialog, there's no single "content" to
    // keep live).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const handleDownloadZip = async () => {
    if (!files) return
    setDownloading(true)
    try {
      const zipBytes = createZip(files.map((f) => ({ name: `KiboLVGLExport/${f.name}`, content: f.content })))
      const filename = `${project.name.replace(/\s+/g, '_')}_KiboLVGLExport.zip`
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
          className="studio-panel w-[820px] max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-3 border-b border-studio-border">
            <div>
              <h3 className="text-sm font-semibold">Export LVGL C++ (UI/UX Design)</h3>
              <p className="text-[11px] text-studio-muted">KiboLVGLExport/ — LVGL UI code only, no Eye Studio content.</p>
            </div>
            <button className="studio-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <LvglValidationPanel results={validation} />

          {error && <div className="mx-3 mt-3 text-xs text-studio-danger">{error}</div>}

          {!files && !error && <div className="flex-1 flex items-center justify-center text-sm text-studio-muted p-6">Generating export…</div>}

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
              {downloading ? 'Preparing…' : 'Download KiboLVGLExport.zip'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
