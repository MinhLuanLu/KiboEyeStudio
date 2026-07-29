import { useState } from 'react'
import { useStore } from '@/state/store'
import { styleRulesToCssText, cssTextToStyleRules } from '@/lib/uiDesign/cssSync'
import type { UiAsset, UiCssRule } from '@/types'

function RuleField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-studio-muted uppercase tracking-wide">{label}</span>
      <input
        type={type}
        className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function RuleEditor({ rule, assets }: { rule: UiCssRule; assets: UiAsset[] }) {
  const updateUiCssRuleSelector = useStore((s) => s.updateUiCssRuleSelector)
  const updateUiCssRuleStyle = useStore((s) => s.updateUiCssRuleStyle)
  const deleteUiCssRule = useStore((s) => s.deleteUiCssRule)
  const checkpoint = useStore((s) => s.checkpoint)
  const set = updateUiCssRuleStyle.bind(null, rule.id)

  return (
    <div className="studio-panel2 border border-studio-border rounded p-2 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono flex-1"
          value={rule.selector}
          onChange={(e) => updateUiCssRuleSelector(rule.id, e.target.value)}
        />
        <button
          className="text-xs text-studio-muted hover:text-studio-danger px-1"
          onClick={() => {
            checkpoint()
            deleteUiCssRule(rule.id)
          }}
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <RuleField label="Background" type="text" value={rule.style.background ?? ''} onChange={(v) => set({ background: v })} />
        <RuleField label="Color" type="text" value={rule.style.color ?? ''} onChange={(v) => set({ color: v })} />
        <RuleField
          label="Radius"
          type="number"
          value={String(rule.style.borderRadius ?? '')}
          onChange={(v) => set({ borderRadius: v === '' ? undefined : Number(v) })}
        />
        <RuleField
          label="Border W"
          type="number"
          value={String(rule.style.borderWidth ?? '')}
          onChange={(v) => set({ borderWidth: v === '' ? undefined : Number(v) })}
        />
        <RuleField label="Border Color" type="text" value={rule.style.borderColor ?? ''} onChange={(v) => set({ borderColor: v })} />
        <RuleField
          label="Font Size"
          type="number"
          value={String(rule.style.fontSize ?? '')}
          onChange={(v) => set({ fontSize: v === '' ? undefined : Number(v) })}
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Background Image</span>
          <select
            className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
            value={rule.style.backgroundImage ?? ''}
            onChange={(e) => set({ backgroundImage: e.target.value || undefined })}
          >
            <option value="">(none)</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Fit</span>
          <select
            className="bg-studio-panel border border-studio-border rounded px-1.5 py-0.5 text-xs"
            disabled={!rule.style.backgroundImage}
            value={rule.style.backgroundSize ?? 'fill'}
            onChange={(e) => set({ backgroundSize: e.target.value as UiCssRule['style']['backgroundSize'] })}
          >
            <option value="stretch">Stretch</option>
            <option value="fit">Fit</option>
            <option value="fill">Fill</option>
            <option value="center">Center</option>
            <option value="tile">Tile</option>
          </select>
        </label>
      </div>
    </div>
  )
}

// Two editing surfaces over the same rule list, both live: the structured per-rule editor
// above (immediate — WidgetRenderer recomputes each widget's effective style from `css` on
// every render, see lib/uiDesign/cssCascade.ts, so there's no separate "apply" step) and a raw
// CSS textarea below it that reparses on blur (via the browser's own CSSOM — see
// cssTextToStyleRules) and replaces the whole rule list, the same "commit on blur, full
// regenerate" pattern HtmlEditor.tsx uses.
export function CssEditor() {
  const rules = useStore((s) => s.project.uiDesign.css)
  const assets = useStore((s) => s.project.uiDesign.assets)
  const addUiCssRule = useStore((s) => s.addUiCssRule)
  const replaceUiCssRules = useStore((s) => s.replaceUiCssRules)
  const checkpoint = useStore((s) => s.checkpoint)
  const [newSelector, setNewSelector] = useState('')
  const [editingText, setEditingText] = useState(false)
  const [draft, setDraft] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  const liveText = styleRulesToCssText(rules, assets)

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs font-mono flex-1"
          placeholder="button, .title, #wifi ..."
          value={newSelector}
          onChange={(e) => setNewSelector(e.target.value)}
        />
        <button
          className="studio-btn text-xs px-2 py-1"
          disabled={!newSelector.trim()}
          onClick={() => {
            checkpoint()
            addUiCssRule(newSelector.trim())
            setNewSelector('')
          }}
        >
          Add Rule
        </button>
      </div>

      {rules.length === 0 && <div className="text-xs text-studio-muted p-2">No CSS rules yet — add one above.</div>}
      {rules.map((rule) => (
        <RuleEditor key={rule.id} rule={rule} assets={assets} />
      ))}

      <div className="border-t border-studio-border pt-2 mt-1 flex flex-col gap-1">
        <span className="studio-label">CSS (editable)</span>
        <textarea
          className="text-[10px] font-mono bg-studio-panel2 border border-studio-border rounded p-2 min-h-[140px] resize-y"
          value={editingText ? draft : liveText}
          onFocus={() => {
            setDraft(liveText)
            setEditingText(true)
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditingText(false)
            const { rules: parsed, warnings: w } = cssTextToStyleRules(draft, assets)
            setWarnings(w)
            checkpoint()
            replaceUiCssRules(parsed)
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
    </div>
  )
}
