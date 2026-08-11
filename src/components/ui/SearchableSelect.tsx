import { useEffect, useMemo, useRef, useState } from 'react'

export interface SearchableSelectItem {
  id: string
  name: string
}

interface SearchableSelectProps {
  items: SearchableSelectItem[]
  value: string
  onChange: (id: string) => void
  /** Trigger-button text when nothing is selected. */
  placeholder?: string
  searchPlaceholder?: string
  /** Shown when the query matches nothing. */
  emptyLabel?: string
  disabled?: boolean
  title?: string
  buttonClassName?: string
  /** Tailwind width class for the popup (e.g. "w-56"). */
  menuWidthClassName?: string
  align?: 'left' | 'right'
  /** Cap on rendered rows so a project with thousands of items stays snappy; the search narrows
   * the list well before this bites. Extra matches are summarized in a footer. */
  maxRendered?: number
}

/**
 * A drop-in replacement for a native <select> that adds a live, case-insensitive, partial-match
 * search box which auto-focuses on open. Selection semantics are identical to a <select>: it calls
 * onChange with the chosen item's id. Built for large lists — filtering is memoized and the rendered
 * rows are capped.
 */
export function SearchableSelect({
  items,
  value,
  onChange,
  placeholder = 'Choose…',
  searchPlaceholder = 'Search…',
  emptyLabel = 'No results found',
  disabled = false,
  title,
  buttonClassName = 'min-w-0 max-w-[9rem] bg-studio-panel2 border border-studio-border rounded px-1.5 py-1 text-xs',
  menuWidthClassName = 'w-56',
  align = 'right',
  maxRendered = 200
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = items.find((i) => i.id === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q))
  }, [items, query])
  const shown = filtered.slice(0, maxRendered)
  const overflow = filtered.length - shown.length

  // Focus the search box as soon as the popup opens so the user can type immediately.
  useEffect(() => {
    if (open) {
      setQuery('')
      // Focus after paint so the freshly-mounted input actually exists.
      const t = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(t)
    }
  }, [open])

  // Close on outside click or Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className={`${buttonClassName} flex items-center justify-between gap-1 disabled:opacity-50`}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${selected ? '' : 'text-studio-muted'}`}>{selected ? selected.name : placeholder}</span>
        <span className="shrink-0 text-studio-muted leading-none">▾</span>
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${menuWidthClassName} studio-panel border border-studio-border rounded-md shadow-lg z-30 p-2 flex flex-col gap-2`}
        >
          <input
            ref={inputRef}
            className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              else if (e.key === 'Enter' && shown.length > 0) pick(shown[0].id)
            }}
          />
          <div className="max-h-60 overflow-y-auto flex flex-col gap-0.5">
            {filtered.length === 0 ? (
              <span className="text-xs text-studio-muted p-2">{emptyLabel}</span>
            ) : (
              <>
                {shown.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`px-2 py-1 rounded text-left text-sm truncate hover:bg-studio-panel2 ${
                      item.id === value ? 'bg-studio-accent/20 text-studio-text' : ''
                    }`}
                    onClick={() => pick(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
                {overflow > 0 && (
                  <span className="text-xs text-studio-muted p-2">
                    {overflow} more — keep typing to narrow…
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
