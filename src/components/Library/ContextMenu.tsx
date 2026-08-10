import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

/**
 * Lightweight floating context menu positioned at the cursor. Closes on outside click, Esc, scroll,
 * or blur. Clamps itself inside the viewport. There is no shared menu component in the app, so this
 * is intentionally minimal.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - r.width - 4)
    const ny = Math.min(y, window.innerHeight - r.height - 4)
    setPos({ x: Math.max(4, nx), y: Math.max(4, ny) })
  }, [x, y])

  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Defer attaching the outside-click listener so the opening click doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] py-1 rounded-md border border-studio-border bg-studio-panel shadow-lg text-sm"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && <div className="my-1 border-t border-studio-border" />}
          <button
            disabled={item.disabled}
            className={`w-full text-left px-3 py-1.5 disabled:opacity-40 disabled:cursor-default ${
              item.danger ? 'text-studio-danger hover:bg-studio-danger/10' : 'text-studio-text hover:bg-studio-panel2'
            }`}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
