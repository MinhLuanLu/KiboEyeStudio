import { Fragment, useState } from 'react'
import { useStore, normalizeName, transitionNameMismatch, validateTransitionName } from '@/state/store'
import { EASING_OPTIONS } from '@/engine/easing'
import type { TransitionClipRef } from '@/types'

/** Saved transition library — same four-zone layout and interactions as the Combinations panel
 * (search, drag-reorder, inline rename, duplicate, delete). Editing happens in the Transition
 * Simulator: selecting a transition loads it there, and every change is written straight back to
 * the project (undoable, saved with the project file). */
export function TransitionLibraryPanel() {
  const transitions = useStore((s) => s.project.transitions)
  const animations = useStore((s) => s.project.animations)
  const combos = useStore((s) => s.project.animationCombos)
  const selectedId = useStore((s) => s.selectedTransitionId)
  const simulatorOpen = useStore((s) => s.transitionSimulatorOpen)

  const selectTransition = useStore((s) => s.selectTransition)
  const setSimulatorOpen = useStore((s) => s.setTransitionSimulatorOpen)
  const requestPreview = useStore((s) => s.requestTransitionPreview)
  const duplicateTransition = useStore((s) => s.duplicateTransition)
  const renameTransition = useStore((s) => s.renameTransition)
  const deleteTransition = useStore((s) => s.deleteTransition)
  const reorderTransition = useStore((s) => s.reorderTransition)
  const checkpoint = useStore((s) => s.checkpoint)

  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const selected = transitions.find((t) => t.id === selectedId) ?? null
  const nameCounts = transitions.reduce((m, t) => m.set(normalizeName(t.name), (m.get(normalizeName(t.name)) ?? 0) + 1), new Map<string, number>())
  const isDupName = (name: string) => (nameCounts.get(normalizeName(name)) ?? 0) > 1

  const clipName = (r: TransitionClipRef): string | null =>
    (r.kind === 'combo' ? combos.find((c) => c.id === r.id)?.name : animations.find((a) => a.id === r.id)?.name) ?? null
  const easingLabel = (e: string) => EASING_OPTIONS.find((o) => o.value === e)?.label ?? e

  const q = search.trim().toLowerCase()
  const filtered = q
    ? transitions.filter((t) => [t.name, clipName(t.source) ?? '', clipName(t.target) ?? ''].some((s) => s.toLowerCase().includes(q)))
    : transitions
  const canDrag = q === ''

  const open = (id: string | null) => {
    selectTransition(id)
    setSimulatorOpen(true)
  }

  const clearDrag = () => {
    setDragId(null)
    setOverIndex(null)
  }
  const dropAt = (slot: number) => {
    if (!dragId) return clearDrag()
    const fromIdx = transitions.findIndex((t) => t.id === dragId)
    if (fromIdx === -1) return clearDrag()
    let target = slot > fromIdx ? slot - 1 : slot
    target = Math.max(0, Math.min(transitions.length - 1, target))
    if (target !== fromIdx) {
      checkpoint()
      reorderTransition(dragId, target)
    }
    clearDrag()
  }

  const renameError = editingId ? validateTransitionName(draftName, transitions, editingId) : null
  const commitRename = (id: string) => {
    const current = transitions.find((t) => t.id === id)
    if (!renameError && current && draftName.trim() !== current.name) {
      checkpoint()
      renameTransition(id, draftName.trim())
    }
    setEditingId(null)
  }
  const startRename = (id: string, name: string) => {
    setEditingId(id)
    setDraftName(name)
  }

  const tbtn =
    'h-7 px-2 shrink-0 flex items-center justify-center gap-1 rounded border border-studio-border bg-studio-panel2 hover:bg-studio-border2 text-studio-text text-xs leading-none disabled:opacity-40 disabled:hover:bg-studio-panel2'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* ---- Zone 1: header ---- */}
      <div className="border-b border-studio-border p-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="studio-label">
            Transitions <span className="text-studio-muted/70">· {transitions.length}</span>
          </span>
          <button
            className="studio-btn text-xs px-2 py-1"
            title="Open the Transition Simulator with a fresh draft, then use Create Transition"
            onClick={() => open(null)}
          >
            + New
          </button>
        </div>
        {transitions.length > 4 && (
          <input
            className="w-full rounded border border-studio-border bg-studio-panel2 px-2 py-1 text-xs"
            placeholder="Search transitions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      {/* ---- Zone 2: list ---- */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-0.5"
        onDragOver={(e) => {
          if (dragId) e.preventDefault()
        }}
        onDrop={(e) => {
          if (dragId) {
            e.preventDefault()
            dropAt(overIndex ?? transitions.length)
          }
        }}
      >
        {transitions.length === 0 ? (
          <div className="p-3 text-sm text-studio-muted text-center">
            No transitions yet. Use + New, set it up in the Transition Simulator, then Create Transition.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-xs text-studio-muted text-center">No results found</div>
        ) : (
          filtered.map((t) => {
            const i = transitions.indexOf(t)
            const isSelected = selected?.id === t.id
            const isEditing = editingId === t.id
            const source = clipName(t.source)
            const target = clipName(t.target)
            const broken = !source || !target
            return (
              <Fragment key={t.id}>
                {canDrag && dragId && overIndex === i && <div className="h-0.5 rounded bg-studio-accent" />}
                <div
                  draggable={canDrag && !isEditing}
                  onDragStart={(e) => {
                    setDragId(t.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', t.id)
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setOverIndex(e.clientY < r.top + r.height / 2 ? i : i + 1)
                  }}
                  onDrop={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    e.stopPropagation()
                    dropAt(overIndex ?? i)
                  }}
                  onDragEnd={clearDrag}
                  onClick={() => open(t.id)}
                  className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 cursor-pointer ${dragId === t.id ? 'opacity-40' : ''} ${
                    isSelected ? 'border-studio-accent bg-studio-accent/15' : 'border-transparent hover:border-studio-border hover:bg-studio-panel2'
                  }`}
                >
                  <span className={`w-0.5 self-stretch rounded-full shrink-0 ${isSelected ? 'bg-studio-accent' : 'bg-transparent'}`} />
                  {canDrag ? (
                    <span className="text-studio-muted/40 group-hover:text-studio-muted cursor-grab select-none shrink-0 leading-none" title="Drag to reorder">
                      ⠿
                    </span>
                  ) : (
                    <span className="w-2 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          className={`w-full bg-studio-panel border rounded px-1 text-sm ${renameError ? 'border-studio-danger' : 'border-studio-border'}`}
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onBlur={() => commitRename(t.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !renameError) (e.target as HTMLInputElement).blur()
                            else if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        {renameError && <div className="text-[11px] text-studio-danger">{renameError}</div>}
                      </div>
                    ) : (
                      <div
                        className={`truncate text-sm ${isSelected ? 'font-medium text-studio-text' : ''} flex items-center gap-1`}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          startRename(t.id, t.name)
                        }}
                      >
                        {isSelected && simulatorOpen && (
                          <span className="text-studio-accent" title="Loaded in the Transition Simulator">
                            ⇄
                          </span>
                        )}
                        <span className="truncate">{t.name}</span>
                        {isDupName(t.name) && (
                          <span className="text-studio-warn shrink-0" title="Duplicate name — rename to keep names unique">
                            ⚠
                          </span>
                        )}
                        {!broken && transitionNameMismatch(t.name, source, target) && (
                          <span className="text-studio-warn shrink-0" title={`The name doesn't match what it plays: ${source} → ${target}. Open it and fix From/To (or rename).`}>
                            ⚠
                          </span>
                        )}
                        {broken && (
                          <span className="text-studio-warn shrink-0" title="Refers to a deleted animation or combination — pick a new one in the simulator. Not exported until fixed.">
                            ⚠
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-[11px] text-studio-muted truncate">
                      {source ?? 'missing'} → {target ?? 'missing'} · {t.durationMs}ms {easingLabel(t.easing)}
                    </div>
                  </div>
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      title="Rename"
                      className="px-1 text-studio-muted hover:text-studio-text"
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(t.id, t.name)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      title="Duplicate"
                      className="px-1 text-studio-muted hover:text-studio-text"
                      onClick={(e) => {
                        e.stopPropagation()
                        checkpoint()
                        open(duplicateTransition(t.id))
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      title="Delete"
                      className="px-1 text-studio-muted hover:text-studio-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        checkpoint()
                        deleteTransition(t.id)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </Fragment>
            )
          })
        )}
        {canDrag && dragId && overIndex === transitions.length && <div className="h-0.5 rounded bg-studio-accent" />}
      </div>

      {/* ---- Zone 3: actions ---- */}
      <div className="border-t border-studio-border px-2 py-1.5 flex items-center gap-1">
        <button className={tbtn} disabled={!selected} title="Load the selected transition into the Transition Simulator" onClick={() => selected && open(selected.id)}>
          ⇄ Edit in Simulator
        </button>
        <button
          className={tbtn}
          disabled={!selected}
          title="Open the simulator and play the selected transition"
          onClick={() => {
            if (!selected) return
            open(selected.id)
            requestPreview()
          }}
        >
          ▶ Preview
        </button>
      </div>

      {/* ---- Zone 4: hint ---- */}
      <div className="border-t border-studio-border px-2 py-1.5 text-[11px] text-studio-muted">
        {selected ? (
          <>
            ESP32: <code className="text-studio-text">playTransition({JSON.stringify(selected.name)})</code>
          </>
        ) : (
          'Select a transition to edit it in the Transition Simulator.'
        )}
      </div>
    </div>
  )
}
