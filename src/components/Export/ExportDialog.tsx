import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, getActiveAnimation } from '@/state/store'
import { projectToJson, animationToJson } from '@/lib/export/jsonExport'
import { generateCppHeader } from '@/lib/export/cppExport'
import { parseAnimationJson } from '@/lib/import/jsonImport'
import { exportFile, importJsonDialog } from '@/state/persistence'

type Tab = 'json-project' | 'json-animation' | 'cpp'

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
