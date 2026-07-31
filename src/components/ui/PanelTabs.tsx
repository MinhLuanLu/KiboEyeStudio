import { useEffect, useRef } from 'react'

// Shared internal sub-tab row for editor panels (Visual Reference, Controls, Colors, Display,
// Personality) — same studio-tab/studio-tab-active styling as the top-level Animations/
// Expressions/Visual Reference and Controls/Colors/Display/Personality tab bars, so every
// level of navigation in the app looks and behaves the same way.
//
// Horizontally scrollable rather than flex-1-shrinking each tab to fit: at narrow right-panel
// widths (a resizable panel, and this row is reused for every one of its sub-tab sets) six-plus
// equal-width tabs previously got cramped/illegible instead of staying readable behind a
// scrollbar. Supports mouse-wheel (vertical wheel delta redirected to horizontal scroll —
// trackpads already report real horizontal delta for two-finger swipes and pass through
// untouched), and click-and-drag scrolling; the active tab auto-scrolls into view whenever it
// changes, including when changed programmatically rather than by clicking within this row.
export function PanelTabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: { value: T; label: string }[]
  active: T
  onChange: (value: T) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeButtonRef = useRef<HTMLButtonElement>(null)
  // Drag-to-scroll state. `wasDragged` deliberately survives past pointerup (cleared at the
  // START of the next pointerdown instead) since the browser's own `click` event fires AFTER
  // pointerup — the button's onClick handler below is the one place that needs to see "did this
  // press-release sequence involve a real drag" to suppress a spurious tab switch at the end of
  // a drag.
  //
  // Pointer capture is deliberately NOT taken on pointerdown — only once movement actually
  // crosses DRAG_THRESHOLD_PX. A first version captured on every press and used a 3px threshold;
  // on real hardware (particularly with Windows display scaling) an ordinary click's own mouse
  // jitter routinely exceeds a few px between press and release, so nearly every real click was
  // being misclassified as a drag and silently swallowed — a plain `button.click()` in a test
  // script never exercises pointer events at all, which is why that bug passed automated
  // verification but broke real mouse/trackpad clicks entirely.
  const DRAG_THRESHOLD_PX = 8
  const dragInfo = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null)
  const wasDragged = useRef(false)

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const handleWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current
    if (!el) return
    dragInfo.current = { pointerId: e.pointerId, startX: e.clientX, startScrollLeft: el.scrollLeft }
    wasDragged.current = false
    // No setPointerCapture here — see the comment on wasDragged above. Capture is taken lazily
    // in handlePointerMove only once real drag distance is confirmed.
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    const el = scrollRef.current
    const info = dragInfo.current
    if (!el || !info || info.pointerId !== e.pointerId) return
    const dx = e.clientX - info.startX
    if (!wasDragged.current) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      wasDragged.current = true
      el.setPointerCapture(e.pointerId)
    }
    el.scrollLeft = info.startScrollLeft - dx
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    const el = scrollRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    dragInfo.current = null
  }

  return (
    <div
      ref={scrollRef}
      className="flex overflow-x-auto border-b border-studio-border cursor-grab active:cursor-grabbing"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          ref={active === t.value ? activeButtonRef : undefined}
          className={`studio-tab shrink-0 whitespace-nowrap ${active === t.value ? 'studio-tab-active' : ''}`}
          onClick={() => {
            if (wasDragged.current) return
            onChange(t.value)
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
