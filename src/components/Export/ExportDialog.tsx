import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, getActiveAnimation } from '@/state/store'
import { projectToJson, animationToJson } from '@/lib/export/jsonExport'
import { generateCppHeader, generateArduinoSketch, generateArduinoReadme, arduinoSketchName, projectUsesEyeRotation, DEFAULT_ARDUINO_PINS, type ArduinoDisplayPins } from '@/lib/export/cppExport'
import { generateEyeControllerHeader } from '@/lib/export/eyeControllerExport'
import { createZip } from '@/lib/export/zip'
import { validateStickerExport, type StickerValidationResult } from '@/lib/export/validateStickers'
import { validatePupilShapeExport, type PupilShapeValidationResult } from '@/lib/export/validatePupilShapes'
import { validateTimelineTiming, type TimelineTimingValidationResult } from '@/lib/export/validateTimelineTiming'
import { validateEyeRotationExport, type EyeRotationValidationResult } from '@/lib/export/validateEyeRotation'
import { parseAnimationJson } from '@/lib/import/jsonImport'
import { exportFile, exportBinaryFile, importJsonDialog } from '@/state/persistence'

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

function EyeRotationValidationPanel({ project }: { project: Parameters<typeof validateEyeRotationExport>[0] }) {
  const results = useMemo(() => validateEyeRotationExport(project), [project])
  return (
    <ValidationPanel<EyeRotationValidationResult>
      title="Eye Rotation Export Check"
      results={results}
      itemKey={(r, i) => `${r.locationId}-${i}`}
      itemTitle={(r) => r.locationName}
    />
  )
}

function TimelineTimingValidationPanel({ project }: { project: Parameters<typeof validateTimelineTiming>[0] }) {
  const results = useMemo(() => validateTimelineTiming(project), [project])
  return (
    <ValidationPanel<TimelineTimingValidationResult>
      title="Timeline Timing Check"
      results={results}
      itemKey={(r, i) => `${r.animationId}-${i}`}
      itemTitle={(r) => r.animationName}
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
  // Default-on "extra file" option for the C++ export: bundle the eyeController.h arbitration
  // layer next to eyes.h (see generateEyeControllerHeader). When on, the C++ export saves a zip
  // of both files (eyes.h + eyeController.h) so the controller's `#include "eyes.h"` resolves;
  // when off, it saves the single eyes.h exactly as before.
  const [includeController, setIncludeController] = useState(true)
  // Default-on "Include Expressions" — when unchecked, the C++ export leaves out every standalone
  // Expression's code/data (Expr_* poses/colours/stickers + the demo's expression cycling) to
  // shrink the file. Animations & combinations are self-contained and always exported (see
  // generateCppHeader's GenerateCppOptions), so disabling this never breaks their playback.
  const [includeExpressions, setIncludeExpressions] = useState(true)
  // "Export Complete Arduino Project" — when on, the C++ export produces a ready-to-compile Arduino
  // sketch folder as a single .zip (<name>/<name>.ino + eyes.h [+ eyeController.h] + README) instead
  // of saving the bare eyes.h. Off by default so the plain-header workflow is unchanged.
  const [exportArduinoProject, setExportArduinoProject] = useState(false)
  // Display wiring for the generated .ino's TFT_* pins — same idea as the LVGL Complete Project
  // export's pin form. Only used when exportArduinoProject is on.
  const [pins, setPins] = useState<ArduinoDisplayPins>(DEFAULT_ARDUINO_PINS)
  // "Force eye rotation on device" — emits #define EYES_FORCE_ROTATION so tilted eyes render on
  // soft-float ESP32-C6/C3 (where rotation is otherwise auto-disabled). Default ON when the project
  // actually uses eye rotation, so a tilted design matches the preview on those chips out of the box.
  // Bake rotation into the eye-shape geometry so tilted eyes render smoothly on a soft-float
  // ESP32-C6/C3 (fast path) while still tilting. Default OFF (opt-in) — it changes how the eyes
  // animate on the device (see the warning under the checkbox), so the user turns it on knowingly.
  const [bakeRotation, setBakeRotation] = useState(false)
  // Smooth rendering for the Complete Arduino Project: generate the .ino using LovyanGFX (hardware
  // SPI + DMA), the same display stack the LVGL export uses, instead of Adafruit's blocking blit.
  const [smoothRendering, setSmoothRendering] = useState(true)

  if (!open) return null

  const content = tab === 'json-project' ? projectToJson(project) : tab === 'json-animation' ? (anim ? animationToJson(anim) : '// no animation selected') : generateCppHeader(project, { includeExpressions, bakeRotation })

  const handleExport = async () => {
    // "Export Complete Arduino Project" -> one .zip laid out as a ready-to-compile sketch folder:
    //   <name>/<name>.ino, <name>/eyes.h, [<name>/eyeController.h], <name>/README.md
    // The folder and the .ino share `arduinoSketchName(...)` (Arduino requires that), and eyes.h is
    // named exactly "eyes.h" so both the .ino's and eyeController.h's `#include "eyes.h"` resolve.
    if (tab === 'cpp' && exportArduinoProject) {
      const folder = arduinoSketchName(project.name)
      const entries = [
        { name: `${folder}/${folder}.ino`, content: generateArduinoSketch(project, { includeExpressions }, pins, smoothRendering) },
        { name: `${folder}/eyes.h`, content },
        ...(includeController ? [{ name: `${folder}/eyeController.h`, content: generateEyeControllerHeader() }] : []),
        { name: `${folder}/README.md`, content: generateArduinoReadme(project, { includeExpressions, includeController, smooth: smoothRendering }) }
      ]
      const ok = await exportBinaryFile(`${folder}.zip`, createZip(entries), ['zip'])
      setStatus(ok ? `Exported ${folder}.zip` : 'Export cancelled')
      return
    }
    // C++ export with the controller option on -> save TWO plain .h files (no zip). Both are
    // dropped straight into the Arduino sketch folder. The eyes header is named exactly "eyes.h"
    // (not "<name>_eyes.h") so eyeController.h's own `#include "eyes.h"` resolves without editing.
    // Two save dialogs in a row on desktop; two downloads in the browser.
    if (tab === 'cpp' && includeController) {
      const ok1 = await exportFile('eyes.h', content, ['h'])
      if (!ok1) {
        setStatus('Export cancelled')
        return
      }
      const ok2 = await exportFile('eyeController.h', generateEyeControllerHeader(), ['h'])
      setStatus(ok2 ? 'Exported eyes.h + eyeController.h' : 'Exported eyes.h (eyeController.h cancelled)')
      return
    }
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

          {tab === 'cpp' && <EyeRotationValidationPanel project={project} />}
          {tab === 'cpp' && <TimelineTimingValidationPanel project={project} />}
          {tab === 'cpp' && <PupilShapeValidationPanel project={project} />}
          {tab === 'cpp' && <StickerValidationPanel project={project} />}

          {tab === 'cpp' && (
            <label className="mx-3 mt-3 flex items-start gap-2 text-xs cursor-pointer select-none shrink-0">
              <input type="checkbox" className="mt-0.5" checked={exportArduinoProject} onChange={(e) => setExportArduinoProject(e.target.checked)} />
              <span>
                <span className="font-medium">Export Complete Arduino Project</span>
                <span className="text-studio-muted"> — download a ready-to-compile sketch as a single <code>.zip</code>: a folder containing <code>{arduinoSketchName(project.name)}.ino</code>, <code>eyes.h</code>{includeController ? <>, <code>eyeController.h</code></> : null}, and a README. (Without this, only the <code>eyes.h</code> header is saved.)</span>
              </span>
            </label>
          )}

          {tab === 'cpp' && exportArduinoProject && (
            <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-studio-muted">Display wiring (GPIO):</span>
              {(['cs', 'dc', 'rst', 'sclk', 'mosi'] as const).map((pin) => (
                <label key={pin} className="flex items-center gap-1">
                  <span className="uppercase text-studio-muted">{pin}</span>
                  <input
                    type="number"
                    className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs w-14"
                    value={pins[pin]}
                    onChange={(e) => setPins((p) => ({ ...p, [pin]: Number(e.target.value) }))}
                  />
                </label>
              ))}
              <span className="text-studio-muted">→ the <code>.ino</code>'s <code>TFT_*</code> pins</span>
            </div>
          )}

          {tab === 'cpp' && exportArduinoProject && (
            <label className="mx-3 mt-2 flex items-start gap-2 text-xs cursor-pointer select-none shrink-0">
              <input type="checkbox" className="mt-0.5" checked={smoothRendering} onChange={(e) => setSmoothRendering(e.target.checked)} />
              <span>
                <span className="font-medium">Smooth rendering (LovyanGFX + DMA)</span>
                <span className="text-studio-muted"> — generate the sketch with the same display stack as the LVGL export: hardware SPI at 80&nbsp;MHz + asynchronous DMA, so animation doesn’t stutter. Needs the <strong>LovyanGFX</strong> library and ~{Math.round((project.display.width * project.display.height * 2) / 1024)}&nbsp;KB RAM for a full-frame buffer. Uncheck to use the simpler Adafruit_GC9A01A path (blocking blit).</span>
              </span>
            </label>
          )}

          {tab === 'cpp' && (
            <label className="mx-3 mt-3 flex items-start gap-2 text-xs cursor-pointer select-none shrink-0">
              <input type="checkbox" className="mt-0.5" checked={includeExpressions} onChange={(e) => setIncludeExpressions(e.target.checked)} />
              <span>
                <span className="font-medium">Include Expressions</span>
                <span className="text-studio-muted"> — export each standalone Expression (its pose, colors, and stickers) so you can call <code>SetExpression(...)</code>. Uncheck to leave all expression code out and shrink the file; animations and combinations still export and play normally.</span>
              </span>
            </label>
          )}

          {tab === 'cpp' && (
            <label className="mx-3 mt-3 flex items-start gap-2 text-xs cursor-pointer select-none shrink-0">
              <input type="checkbox" className="mt-0.5" checked={includeController} onChange={(e) => setIncludeController(e.target.checked)} />
              <span>
                <span className="font-medium">Generate eye controller</span>
                <span className="text-studio-muted"> — also emit <code>eyeController.h</code>, a priority-based arbitration layer over <code>eyes.h</code> for juggling multiple input sources (sensors, buttons, events). Saves <code>eyes.h</code> and <code>eyeController.h</code> as two files (two save prompts).</span>
              </span>
            </label>
          )}

          {tab === 'cpp' && (
            <label className="mx-3 mt-3 flex items-start gap-2 text-xs cursor-pointer select-none shrink-0">
              <input type="checkbox" className="mt-0.5" checked={bakeRotation} onChange={(e) => setBakeRotation(e.target.checked)} />
              <span>
                <span className="font-medium">Smooth tilt on ESP32 (bake rotation)</span>
                <span className="text-studio-muted"> — bakes each tilted eye's rotation into its shape geometry so the device draws it with the fast path: <strong>tilted AND smooth</strong> even on a soft‑float ESP32‑C6/C3 (no per‑pixel rotation cost). Off by default; turn it on if a tilted eye stutters on the device. {projectUsesEyeRotation(project) ? '' : 'Only matters if you rotate an eye.'}</span>
              </span>
            </label>
          )}

          {tab === 'cpp' && bakeRotation && (
            <div className="mx-3 mt-2 text-[11px] leading-snug bg-amber-500/10 border border-amber-500/40 text-amber-300/90 rounded-md px-2 py-1.5">
              <span className="font-medium text-amber-300">⚠ Heads up — this changes how the eyes animate on the device:</span>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                <li>Only the eye <strong>shape</strong> tilt is baked. <strong>Eyelids don't tilt</strong> — a blink on a tilted eye closes level (fine for a solid lens, visible if the eyelid shows).</li>
                <li>A <strong>visible pupil / highlight won't rotate</strong> with the eye (they stay put). Best for solid shape eyes.</li>
                <li>Eyes with a shape <strong>offset</strong> or <strong>flip</strong> can't be baked and fall back to the slower runtime rotation.</li>
                <li>If the eye <strong>size animates while tilted</strong>, the tilt is baked per‑pose at each size (still correct per frame).</li>
                <li>Tilted poses become per‑eye custom shapes, so <strong>the exported file is a bit larger</strong>.</li>
              </ul>
              <span className="block mt-1">The studio preview always shows the true rotation — verify the look on your actual display after flashing.</span>
            </div>
          )}

          <pre className="flex-1 overflow-auto p-3 text-xs font-mono bg-studio-bg m-3 rounded-md border border-studio-border whitespace-pre">
            {content}
          </pre>

          <div className="flex items-center justify-between p-3 border-t border-studio-border">
            <span className="text-xs text-studio-muted">{status}</span>
            <button className="studio-btn-primary" onClick={handleExport}>
              {tab === 'cpp' && exportArduinoProject ? `Download ${arduinoSketchName(project.name)}.zip` : 'Save to File...'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
