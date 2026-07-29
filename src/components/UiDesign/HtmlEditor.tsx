import { useState } from 'react'
import { useStore } from '@/state/store'
import { widgetTreeToHtml, htmlToWidgetTree } from '@/lib/uiDesign/htmlSync'

// Two-way synced: while unfocused, the textarea always shows the widget tree regenerated fresh
// (so canvas/Properties-panel/CSS edits show up here immediately). Focusing it freezes that
// live sync so typing isn't fought mid-edit; blurring reparses the typed text (via DOMParser —
// see htmlSync.ts) and replaces the active screen's tree, which is also what makes this a
// full-regenerate-each-direction sync rather than an incremental patch (see the plan).
export function HtmlEditor() {
  const uiDesign = useStore((s) => s.project.uiDesign)
  const widgets = useStore((s) => s.project.uiDesign.widgets)
  const replaceActiveScreenWidgets = useStore((s) => s.replaceActiveScreenWidgets)
  const checkpoint = useStore((s) => s.checkpoint)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  const liveText = widgetTreeToHtml(uiDesign)

  return (
    <div className="p-2 flex flex-col gap-1.5">
      <textarea
        className="text-[11px] font-mono bg-studio-panel2 border border-studio-border rounded p-2 min-h-[260px] resize-y"
        value={editing ? draft : liveText}
        onFocus={() => {
          setDraft(liveText)
          setEditing(true)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          const { widgets: parsed, rootId, warnings: w } = htmlToWidgetTree(draft, widgets, uiDesign.assets)
          setWarnings(w)
          if (rootId) {
            checkpoint()
            replaceActiveScreenWidgets(parsed, rootId)
          }
        }}
        spellCheck={false}
      />
      {warnings.length > 0 && (
        <div className="text-[11px] text-studio-warn flex flex-col gap-0.5">
          {warnings.map((w, i) => (
            <span key={i}>⚠ {w}</span>
          ))}
        </div>
      )}
    </div>
  )
}
