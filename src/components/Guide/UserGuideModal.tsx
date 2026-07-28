import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/state/store'
import { GUIDE_SEARCH_KEYWORDS, GUIDE_SECTIONS, type GuideSection } from '@/data/userGuideSections'

const SHOW_ON_STARTUP_KEY = 'kibo-eye-studio:show-guide-on-startup'

export function getShowGuideOnStartup(): boolean {
  try {
    return localStorage.getItem(SHOW_ON_STARTUP_KEY) === 'true'
  } catch {
    return false
  }
}

function setShowGuideOnStartup(value: boolean): void {
  try {
    localStorage.setItem(SHOW_ON_STARTUP_KEY, value ? 'true' : 'false')
  } catch {
    // Ignore — this is a nice-to-have preference, not critical state.
  }
}

// Sections sharing a `group` render as one nested list under that heading in the sidebar —
// today only "Animation Guide" (7.1–7.18) uses this; everything else is top-level.
function groupSections(sections: GuideSection[]): { top: GuideSection[]; groups: Record<string, GuideSection[]> } {
  const top: GuideSection[] = []
  const groups: Record<string, GuideSection[]> = {}
  for (const s of sections) {
    if (s.group) {
      ;(groups[s.group] ??= []).push(s)
    } else {
      top.push(s)
    }
  }
  return { top, groups }
}

function matchesQuery(section: GuideSection, query: string): boolean {
  if (!query.trim()) return true
  const q = query.trim().toLowerCase()
  const haystack = `${section.title} ${GUIDE_SEARCH_KEYWORDS[section.id] ?? ''}`.toLowerCase()
  return haystack.includes(q)
}

export function UserGuideModal() {
  const open = useStore((s) => s.guideOpen)
  const setOpen = useStore((s) => s.setGuideOpen)

  const [currentId, setCurrentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showOnStartup, setShowOnStartupState] = useState(getShowGuideOnStartup)

  // Reset to the contents page and clear any search each time the guide is (re)opened, so
  // it never reopens mid-search on a stale section from last time.
  useEffect(() => {
    if (open) {
      setCurrentId(null)
      setQuery('')
    }
  }, [open])

  const { top, groups } = useMemo(() => groupSections(GUIDE_SECTIONS), [])
  const filtered = useMemo(() => new Set(GUIDE_SECTIONS.filter((s) => matchesQuery(s, query)).map((s) => s.id)), [query])
  const hasQuery = query.trim().length > 0

  const currentIndex = currentId ? GUIDE_SECTIONS.findIndex((s) => s.id === currentId) : -1
  const current = currentIndex >= 0 ? GUIDE_SECTIONS[currentIndex] : null
  const prev = currentIndex > 0 ? GUIDE_SECTIONS[currentIndex - 1] : null
  const next = currentIndex >= 0 && currentIndex < GUIDE_SECTIONS.length - 1 ? GUIDE_SECTIONS[currentIndex + 1] : null

  if (!open) return null

  const toggleShowOnStartup = () => {
    const nextValue = !showOnStartup
    setShowOnStartupState(nextValue)
    setShowGuideOnStartup(nextValue)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
        onClick={() => setOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.15 }}
          className="studio-panel w-[94vw] max-w-[1160px] h-[86vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-studio-border shrink-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">User Guide</h2>
              {current && <span className="text-xs text-studio-muted">— {current.title}</span>}
            </div>
            <button className="studio-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="flex-1 min-h-0 flex">
            {/* Sidebar: search + table of contents */}
            <div className="w-64 shrink-0 border-r border-studio-border flex flex-col min-h-0">
              <div className="p-2 border-b border-studio-border">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the guide..."
                  className="w-full bg-studio-panel2 border border-studio-border rounded-md px-2.5 py-1.5 text-sm placeholder:text-studio-muted focus:outline-none focus:border-studio-accent"
                />
              </div>
              <nav className="flex-1 overflow-y-auto p-2 text-sm">
                <button
                  className={`w-full text-left px-2 py-1.5 rounded-md mb-1 transition-colors ${
                    currentId === null ? 'bg-studio-accent/20 text-studio-accent font-medium' : 'hover:bg-studio-panel2 text-studio-text'
                  }`}
                  onClick={() => setCurrentId(null)}
                >
                  Contents
                </button>

                {top.map((s) => {
                  if (hasQuery && !filtered.has(s.id)) return null
                  return (
                    <button
                      key={s.id}
                      className={`w-full text-left px-2 py-1.5 rounded-md mb-1 transition-colors ${
                        currentId === s.id ? 'bg-studio-accent/20 text-studio-accent font-medium' : 'hover:bg-studio-panel2 text-studio-text'
                      }`}
                      onClick={() => setCurrentId(s.id)}
                    >
                      {s.title}
                    </button>
                  )
                })}

                {Object.entries(groups).map(([groupName, items]) => {
                  const visible = hasQuery ? items.filter((s) => filtered.has(s.id)) : items
                  if (hasQuery && visible.length === 0) return null
                  return (
                    <div key={groupName} className="mt-2">
                      <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-studio-muted font-semibold">{groupName}</div>
                      {visible.map((s) => (
                        <button
                          key={s.id}
                          className={`w-full text-left pl-4 pr-2 py-1.5 rounded-md mb-0.5 text-[13px] transition-colors ${
                            currentId === s.id ? 'bg-studio-accent/20 text-studio-accent font-medium' : 'hover:bg-studio-panel2 text-studio-text/90'
                          }`}
                          onClick={() => setCurrentId(s.id)}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </nav>
              <label className="flex items-center gap-2 p-2.5 border-t border-studio-border text-xs text-studio-muted cursor-pointer">
                <input type="checkbox" checked={showOnStartup} onChange={toggleShowOnStartup} className="accent-studio-accent" />
                Show this guide on startup
              </label>
            </div>

            {/* Content pane */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-6">
                {current ? (
                  <div key={current.id}>{current.content}</div>
                ) : (
                  <ContentsPage top={top} groups={groups} onSelect={setCurrentId} />
                )}
              </div>

              {current && (
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-studio-border shrink-0">
                  <button className="studio-btn" onClick={() => setCurrentId(null)}>
                    ← Back to Contents
                  </button>
                  <div className="flex items-center gap-2">
                    <button className="studio-btn" disabled={!prev} onClick={() => prev && setCurrentId(prev.id)}>
                      ← Previous{prev ? `: ${prev.title}` : ''}
                    </button>
                    <button className="studio-btn" disabled={!next} onClick={() => next && setCurrentId(next.id)}>
                      Next{next ? `: ${next.title}` : ''} →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function ContentsPage({
  top,
  groups,
  onSelect
}: {
  top: GuideSection[]
  groups: Record<string, GuideSection[]>
  onSelect: (id: string) => void
}) {
  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Kibo Studio User Guide</h1>
      <p className="text-sm text-studio-muted mb-5">
        Everything about designing eye expressions, building animations, and exporting them for ESP32 — pick a topic below, or
        search the sidebar.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {top.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="text-left p-3 rounded-lg border border-studio-border bg-studio-panel2 hover:border-studio-accent/50 hover:bg-studio-panel2/70 transition-colors"
          >
            <div className="font-medium text-sm text-studio-text">{s.title}</div>
          </button>
        ))}
      </div>

      {Object.entries(groups).map(([groupName, items]) => (
        <div key={groupName} className="mt-6">
          <h3 className="text-sm font-semibold text-studio-text mb-2">{groupName}</h3>
          <div className="grid grid-cols-3 gap-2">
            {items.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className="text-left px-3 py-2 rounded-md border border-studio-border bg-studio-panel2/60 hover:border-studio-accent/50 hover:bg-studio-panel2 transition-colors text-[13px] text-studio-text/90"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
