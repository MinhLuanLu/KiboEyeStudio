import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, getActiveAnimation } from '@/state/store'
import { projectToJson, animationToJson } from '@/lib/export/jsonExport'
import { generateCppHeader } from '@/lib/export/cppExport'
import { validateStickerExport, type StickerValidationResult } from '@/lib/export/validateStickers'
import { validatePupilShapeExport, type PupilShapeValidationResult } from '@/lib/export/validatePupilShapes'
import { parseAnimationJson } from '@/lib/import/jsonImport'
import { exportFile, importJsonDialog } from '@/state/persistence'

type Tab = 'json-project' | 'json-animation' | 'cpp'
type ValidationStatus = 'passed' | 'warning' | 'failed'

const STATUS_ICON: Record<ValidationStatus, string> = { passed: '✓', warning: '⚠', failed: '✕' }
const STATUS_CLASS: Record<ValidationStatus, string> = {
  passed: 'text-emerald-400',
  warning: 'text-amber-400',
  failed: 'text-red-400'
}

/** Generic pass/warning/fail checklist renderer, shared by the sticker and pupil-shape export
 * checks below — same collapse-unless-something-failed behavior, same row layout, just a
 * different title/subtitle per item. Only rendered when there's at least one result, so
 * projects with nothing of that kind don't show an empty panel. */
export function ValidationPanel<T extends { status: ValidationStatus; messages: string[] }>({
  title,
  results,
  itemKey,
  itemTitle,
  itemSubtitle
}: {
  title: string
  results: T[]
  itemKey: (r: T, i: number) => string
  itemTitle: (r: T) => string
  itemSubtitle?: (r: T) => string | null
}) {
  const [expanded, setExpanded] = useState(false)
  if (results.length === 0) return null

  const passed = results.filter((r) => r.status === 'passed').length
  const warnings = results.filter((r) => r.status === 'warning').length
  const failed = results.filter((r) => r.status === 'failed').length
  const isOpen = expanded || failed > 0

  return (
    <div className="mx-3 mt-3 border border-studio-border rounded-md overflow-hidden shrink-0">
      <button className="w-full flex items-center justify-between px-3 py-2 bg-studio-panel2 text-xs" onClick={() => setExpanded((v) => !v)}>
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-3 text-studio-muted">
          {passed > 0 && <span className="text-emerald-400">{passed} passed</span>}
          {warnings > 0 && <span className="text-amber-400">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
          {failed > 0 && <span className="text-red-400">{failed} failed</span>}
          <span>{isOpen ? '▲' : '▼'}</span>
        </span>
      </button>
      {isOpen && (
        <div className="max-h-40 overflow-y-auto divide-y divide-studio-border">
          {results.map((r, i) => {
            const subtitle = itemSubtitle?.(r)
            return (
              <div key={itemKey(r, i)} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                <span className={`shrink-0 font-bold ${STATUS_CLASS[r.status]}`}>{STATUS_ICON[r.status]}</span>
                <div className="min-w-0">
                  <div>
                    <span className="font-medium">{itemTitle(r)}</span> {subtitle && <span className="text-studio-muted">({subtitle})</span>}
                  </div>
                  {r.messages.map((m, mi) => (
                    <div key={mi} className="text-studio-muted leading-snug">
                      {m}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StickerValidationPanel({ project }: { project: Parameters<typeof validateStickerExport>[0] }) {
  const results = useMemo(() => validateStickerExport(project), [project])
  return (
    <ValidationPanel<StickerValidationResult>
      title="Sticker Export Check"
      results={results}
      itemKey={(r, i) => `${r.stickerId}-${i}`}
      itemTitle={(r) => r.stickerName}
      itemSubtitle={(r) => r.scope}
    />
  )
}

function PupilShapeValidationPanel({ project }: { project: Parameters<typeof validatePupilShapeExport>[0] }) {
  const results = useMemo(() => validatePupilShapeExport(project), [project])
  return (
    <ValidationPanel<PupilShapeValidationResult>
      title="Custom Pupil Shape Export Check"
      results={results}
      itemKey={(r, i) => `${r.shapeId}-${i}`}
      itemTitle={(r) => r.shapeName}
    />
  )
}

export function ExportDialog() {
  const open = useStore((s) => s.exportDialogOpen)
  const setOpen = useStore((s) => s.setExportDialogOpen)
  const project = useStore((s) => s.project)
  const anim = useStore(() => getActiveAnimation())
  const importAnimation = useStore((s) => s.importAnimation)
  const checkpoint = useStore((s) => s.checkpoint)

  const [tab, setTab] = useState<Tab>('json-project')
  const [status, setStatus] = useState<string | null>(null)

  if (!open) return null

  const content = tab === 'json-project' ? projectToJson(project) : tab === 'json-animation' ? (anim ? animationToJson(anim) : '// no animation selected') : generateCppHeader(project)

  const handleExport = async () => {
    const filename = tab === 'cpp' ? `${project.name.replace(/\s+/g, '_')}_eyes.h` : tab === 'json-animation' ? `${(anim?.name ?? 'animation').replace(/\s+/g, '_')}.json` : `${project.name.replace(/\s+/g, '_')}.json`
    const ext = tab === 'cpp' ? ['h'] : ['json']
    const ok = await exportFile(filename, content, ext)
    setStatus(ok ? `Exported ${filename}` : null)
  }

  const handleImport = async () => {
    const json = await importJsonDialog()
    if (!json) return
    try {
      const animation = parseAnimationJson(json)
      checkpoint()
      importAnimation(animation)
      setStatus(`Imported animation "${animation.name}"`)
    } catch (err) {
      setStatus(`Import failed: ${(err as Error).message}`)
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
          className="studio-panel w-[720px] max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-3 border-b border-studio-border">
            <h3 className="text-sm font-semibold">Export / Import</h3>
            <button className="studio-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="flex items-center gap-1 p-2 border-b border-studio-border">
            <button className={`studio-tab ${tab === 'json-project' ? 'studio-tab-active' : ''}`} onClick={() => setTab('json-project')}>
              Project JSON
            </button>
            <button className={`studio-tab ${tab === 'json-animation' ? 'studio-tab-active' : ''}`} onClick={() => setTab('json-animation')}>
              Animation JSON
            </button>
            <button className={`studio-tab ${tab === 'cpp' ? 'studio-tab-active' : ''}`} onClick={() => setTab('cpp')}>
              C++ Header
            </button>
            <div className="flex-1" />
            <button className="studio-btn" onClick={handleImport}>
              Import JSON...
            </button>
          </div>

          {tab === 'cpp' && <PupilShapeValidationPanel project={project} />}
          {tab === 'cpp' && <StickerValidationPanel project={project} />}

          <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-studio-bg m-3 rounded-md border border-studio-border whitespace-pre">
            {content}
          </pre>

          <div className="flex items-center justify-between p-3 border-t border-studio-border">
            <span className="text-xs text-studio-muted">{status}</span>
            <button className="studio-btn-primary" onClick={handleExport}>
              Save to File...
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
