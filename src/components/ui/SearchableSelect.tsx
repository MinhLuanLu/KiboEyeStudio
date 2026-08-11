import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  /** Popup width in px. */
  menuWidth?: number
  align?: 'left' | 'right'
  /** Cap on rendered rows so a project with thousands of items stays snappy; the search narrows
   * the list well before this bites. Extra matches are summarized in a footer. */
  maxRendered?: number
}

// Rough popup height (search box + list + padding) used to decide whether to open upward.
const MENU_MAX_HEIGHT = 300
const GAP = 4

/**
 * A drop-in replacement for a native <select> that adds a live, case-insensitive, partial-match
 * search box which auto-focuses on open. Selection semantics are identical to a <select>: it calls
 * onChange with the chosen item's id.
 *
 * The popup is rendered in a portal on document.body with fixed positioning (auto-flipping upward
 * when there isn't room below) so it is NEVER clipped by a scrolling/overflow-hidden ancestor —
 * e.g. the bottom-docked Timeline panel, where an in-flow dropdown would be cut off and the list
 * would appear empty. Built for large lists — filtering is memoized and rendered rows are capped.
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
  buttonClassName = 'min-w-0 max-w-[9rem] bg-studio-panel2 border border-studio-border rounded px-1.5 py-1 text-xs text-studio-text',
  menuWidth = 224,
  align = 'right',
  maxRendered = 200
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = items.find((i) => i.id === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q))
  }, [items, query])
  const shown = filtered.slice(0, maxRendered)
  const overflow = filtered.length - shown.length

  const reposition = () => {
    const b = wrapRef.current?.getBoundingClientRect()
    if (b) setRect({ left: b.left, top: b.top, bottom: b.bottom })
  }

  // Measure the trigger before paint whenever the popup opens, then clear the query and focus the
  // search box so the user can type immediately.
  useLayoutEffect(() => {
    if (open) reposition()
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    const onMove = () => reposition()
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    // Capture scroll on any ancestor (the Timeline scrolls) so the popup tracks the button.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('mousedown', onDown)
    return () => {
      cancelAnimationFrame(t)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  // Decide side + horizontal placement from the measured trigger rect.
  const openUp = rect ? window.innerHeight - rect.bottom < MENU_MAX_HEIGHT && rect.top > window.innerHeight - rect.bottom : false
  const rawLeft = rect ? (align === 'right' ? rect.left + wrapRef.current!.offsetWidth - menuWidth : rect.left) : 0
  const left = rect ? Math.max(4, Math.min(rawLeft, window.innerWidth - menuWidth - 4)) : 0
  const top = rect ? (openUp ? rect.top - GAP : rect.bottom + GAP) : 0

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

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] studio-panel border border-studio-border rounded-md shadow-floating p-2 flex flex-col gap-2 text-studio-text"
            style={{ left, top, width: menuWidth, transform: openUp ? 'translateY(-100%)' : undefined }}
          >
            <input
              ref={inputRef}
              className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm text-studio-text"
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
                      className={`px-2 py-1 rounded text-left text-sm truncate text-studio-text hover:bg-studio-panel2 ${
                        item.id === value ? 'bg-studio-accent/20' : ''
                      }`}
                      onClick={() => pick(item.id)}
                    >
                      {item.name}
                    </button>
                  ))}
                  {overflow > 0 && (
                    <span className="text-xs text-studio-muted p-2">{overflow} more — keep typing to narrow…</span>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
