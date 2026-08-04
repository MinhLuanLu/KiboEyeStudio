import { useMemo, useState } from 'react'
import { LVGL_SYMBOLS } from '@/lib/uiDesign/lvglSymbols'

interface IconPickerProps {
  value: string | null | undefined
  onSelect: (symbolId: string | null) => void
}

/** Built-in LVGL symbol-font icon picker, following the same swatch-grid convention as
 * PupilShapePicker/EyeShapePicker — click-to-apply buttons, `checkpoint()` left to the caller
 * (this component just reports the selection). Unlike those pickers, the library here is large
 * (54 built-in symbols) so a search box is genuinely useful, not decoration. Glyphs are Unicode
 * approximations for browsing only — see lvglSymbols.ts's file-top comment for why. */
export function IconPicker({ value, onSelect }: IconPickerProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return LVGL_SYMBOLS
    return LVGL_SYMBOLS.filter((s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  }, [query])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="studio-label">Built-in Icon</span>
        {value && (
          <button className="text-[11px] text-studio-muted hover:text-studio-text" onClick={() => onSelect(null)}>
            Remove icon
          </button>
        )}
      </div>
      <input
        className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs"
        placeholder="Search icons (e.g. wifi, settings, play)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="grid grid-cols-5 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
        <button
          title="No icon"
          className={`flex flex-col items-center gap-1 py-1.5 rounded-md border text-[10px] transition-colors ${
            !value
              ? 'border-studio-accent bg-studio-accent/15 text-studio-accent'
              : 'border-studio-border bg-studio-panel2 text-studio-muted hover:text-studio-text'
          }`}
          onClick={() => onSelect(null)}
        >
          <span className="text-base leading-none">—</span>
          None
        </button>
        {filtered.map((s) => (
          <button
            key={s.id}
            title={`${s.label} (${s.id})`}
            className={`flex flex-col items-center gap-1 py-1.5 rounded-md border text-[10px] transition-colors ${
              value === s.id
                ? 'border-studio-accent bg-studio-accent/15 text-studio-accent'
                : 'border-studio-border bg-studio-panel2 text-studio-muted hover:text-studio-text'
            }`}
            onClick={() => onSelect(s.id)}
          >
            <span className="text-base leading-none">{s.glyph}</span>
            <span className="truncate max-w-full px-0.5">{s.label}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="col-span-5 text-[11px] text-studio-muted py-2 text-center">No icons match "{query}".</p>}
      </div>
      <p className="text-[11px] text-studio-muted">
        Glyphs above approximate LVGL's built-in symbol font for browsing — the real icon renders from LVGL's own font on
        the exported firmware.
      </p>
    </div>
  )
}
