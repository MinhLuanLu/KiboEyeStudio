import { useState } from 'react'
import { useStore } from '@/state/store'
import { generateLiveScreenCode } from '@/lib/export/lvglExport'

// "LVGL Code" tab — a live, read-only view of the currently active screen's generated LVGL C++,
// regenerated fresh on every render straight from project.uiDesign (same "full regenerate, not
// an incremental patch" approach HtmlEditor/CssEditor already use for their own live text) — any
// edit anywhere in the design (add/remove a widget, change a property, edit a style, move/resize,
// wire up an event, switch screens) is reflected the next time this component re-renders, with
// no debounce needed since generateLiveScreenCode is fully synchronous (see its own doc comment
// for why — no image pixel decoding happens here). Not a downloadable export — see the "Export
// LVGL C++..." button in the top bar for the real, complete project (this view intentionally
// leaves out board/display/pin setup and real embedded image data to stay focused on the LVGL
// widget code itself).
export function LvglCodePanel() {
  const project = useStore((s) => s.project)
  const activeScreenId = useStore((s) => s.project.uiDesign.activeScreenId)
  const [copied, setCopied] = useState(false)

  const code = generateLiveScreenCode(project, activeScreenId)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard access can fail (permissions/insecure context) — non-fatal, the code is still visible to select/copy by hand */
    }
  }

  return (
    <div className="h-full flex flex-col p-2 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-studio-muted">
          Live LVGL code for the current screen — updates automatically as you design. Copy it straight into an Arduino project, or use{' '}
          <span className="text-studio-text">Export LVGL C++...</span> for the full downloadable project.
        </p>
        <button className="studio-btn text-xs shrink-0" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="flex-1 overflow-auto text-[11px] font-mono bg-studio-panel2 border border-studio-border rounded p-2 whitespace-pre">
        {code}
      </pre>
    </div>
  )
}
