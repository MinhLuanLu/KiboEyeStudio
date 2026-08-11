import { Fragment, useEffect, useState } from 'react'
import { useStore, normalizeName } from '@/state/store'

/** Combination library management + playback transport — the actual clip *editing* (drag/trim/
 * reorder/copy/paste/multi-select) lives in the shared bottom Timeline (Timeline.tsx), which
 * switches into "combo editing mode" whenever a combo is selected here.
 *
 * Layout is organised top-to-bottom into four clearly separated zones so the panel stays usable with
 * dozens/hundreds of combos: (1) a large, independently-scrolling NAVIGATION list with search +
 * drag-reorder + inline rename, given the most space; (2) a compact PLAYBACK transport bar; (3) a
 * slim SETTINGS/info footer. The clip SEQUENCE itself is edited in the Timeline (kept as the main
 * workspace). */
export function AnimationCombinationPanel() {
  const combos = useStore((s) => s.project.animationCombos)
  const selectedComboId = useStore((s) => s.selectedComboId)
  const selectedClipId = useStore((s) => s.selectedComboClipId)
  const loopPreview = useStore((s) => s.comboPreviewLoop)
  const playing = useStore((s) => s.comboPreviewPlaying)
  const previewTimeMs = useStore((s) => s.comboPreviewTimeMs)

  const selectAnimationCombo = useStore((s) => s.selectAnimationCombo)
  const selectAnimationComboClip = useStore((s) => s.selectAnimationComboClip)
  const setComboPreviewPlaying = useStore((s) => s.setComboPreviewPlaying)
  const setComboPreviewTimeMs = useStore((s) => s.setComboPreviewTimeMs)
  const setComboPreviewLoop = useStore((s) => s.setComboPreviewLoop)

  const addAnimationCombo = useStore((s) => s.addAnimationCombo)
  const duplicateAnimationCombo = useStore((s) => s.duplicateAnimationCombo)
  const renameAnimationCombo = useStore((s) => s.renameAnimationCombo)
  const deleteAnimationCombo = useStore((s) => s.deleteAnimationCombo)
  const reorderAnimationCombo = useStore((s) => s.reorderAnimationCombo)
  const checkpoint = useStore((s) => s.checkpoint)

  const selectedCombo = combos.find((combo) => combo.id === selectedComboId) ?? combos[0] ?? null

  // Duplicate-name detection — flags combos whose name collides (would share an exported identifier).
  const nameCounts = combos.reduce((m, c) => m.set(normalizeName(c.name), (m.get(normalizeName(c.name)) ?? 0) + 1), new Map<string, number>())
  const isDupName = (name: string) => (nameCounts.get(normalizeName(name)) ?? 0) > 1

  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!selectedComboId && combos[0]) selectAnimationCombo(combos[0].id)
    if (selectedCombo && selectedCombo.clips.length > 0 && !selectedCombo.clips.some((clip) => clip.id === selectedClipId)) {
      selectAnimationComboClip(selectedCombo.clips[0].id)
    }
  }, [combos, selectAnimationComboClip, selectAnimationCombo, selectedClipId, selectedCombo, selectedComboId])

  const q = search.trim().toLowerCase()
  const filtered = q ? combos.filter((c) => c.name.toLowerCase().includes(q)) : combos
  // Reorder only makes sense on the full, unfiltered list, so dragging is disabled while searching.
  const canDrag = q === ''

  const clearDrag = () => {
    setDragId(null)
    setOverIndex(null)
  }
  const dropAt = (slot: number) => {
    if (!dragId) return clearDrag()
    const fromIdx = combos.findIndex((c) => c.id === dragId)
    if (fromIdx === -1) return clearDrag()
    let target = slot > fromIdx ? slot - 1 : slot
    target = Math.max(0, Math.min(combos.length - 1, target))
    if (target !== fromIdx) {
      checkpoint()
      reorderAnimationCombo(dragId, target)
    }
    clearDrag()
  }

  const commitRename = (id: string) => {
    checkpoint()
    renameAnimationCombo(id, draftName.trim() || 'Combination')
    setEditingId(null)
  }

  const tbtn =
    'h-7 w-7 shrink-0 flex items-center justify-center rounded border border-studio-border bg-studio-panel2 hover:bg-studio-border2 text-studio-text text-sm leading-none disabled:opacity-40 disabled:hover:bg-studio-panel2'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* ---- Zone 1: navigation header (title + count + New + search) ---- */}
      <div className="border-b border-studio-border p-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="studio-label">
            Combinations <span className="text-studio-muted/70">· {combos.length}</span>
          </span>
          <button
            className="studio-btn text-xs px-2 py-1"
            onClick={() => {
              checkpoint()
              const id = addAnimationCombo()
              selectAnimationCombo(id)
              setSearch('')
            }}
          >
            + New
          </button>
        </div>
        {combos.length > 4 && (
          <input
            className="w-full rounded border border-studio-border bg-studio-panel2 px-2 py-1 text-xs"
            placeholder="Search combinations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      {/* ---- Zone 2: navigation list — the biggest zone, scrolls on its own ---- */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-0.5"
        onDragOver={(e) => {
          if (dragId) e.preventDefault()
        }}
        onDrop={(e) => {
          if (dragId) {
            e.preventDefault()
            dropAt(overIndex ?? combos.length)
          }
        }}
      >
        {combos.length === 0 ? (
          <div className="p-3 text-sm text-studio-muted text-center">No combinations yet. Use + New.</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-xs text-studio-muted text-center">No results found</div>
        ) : (
          filtered.map((combo) => {
            const i = combos.indexOf(combo)
            const isSelected = selectedCombo?.id === combo.id
            const isEditing = editingId === combo.id
            return (
              <Fragment key={combo.id}>
                {canDrag && dragId && overIndex === i && <div className="h-0.5 rounded bg-studio-accent" />}
                <div
                  draggable={canDrag && !isEditing}
                  onDragStart={(e) => {
                    setDragId(combo.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', combo.id)
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
                  onClick={() => selectAnimationCombo(combo.id)}
                  className={`group flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 cursor-pointer ${
                    dragId === combo.id ? 'opacity-40' : ''
                  } ${
                    isSelected
                      ? 'border-studio-accent bg-studio-accent/15'
                      : 'border-transparent hover:border-studio-border hover:bg-studio-panel2'
                  }`}
                >
                  {/* accent bar makes the current selection immediately obvious */}
                  <span className={`w-0.5 self-stretch rounded-full shrink-0 ${isSelected ? 'bg-studio-accent' : 'bg-transparent'}`} />
                  {canDrag ? (
                    <span
                      className="text-studio-muted/40 group-hover:text-studio-muted cursor-grab select-none shrink-0 leading-none"
                      title="Drag to reorder"
                    >
                      ⠿
                    </span>
                  ) : (
                    <span className="w-2 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        autoFocus
                        className="w-full bg-studio-panel border border-studio-border rounded px-1 text-sm"
                        value={draftName}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => commitRename(combo.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          else if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                    ) : (
                      <div
                        className={`truncate text-sm ${isSelected ? 'font-medium text-studio-text' : ''} flex items-center gap-1`}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setEditingId(combo.id)
                          setDraftName(combo.name)
                        }}
                      >
                        {isSelected && playing && <span className="text-studio-accent" title="Previewing">▶</span>}
                        <span className="truncate">{combo.name}</span>
                        {isDupName(combo.name) && (
                          <span className="text-studio-warn shrink-0" title="Duplicate name — rename to keep names unique">
                            ⚠
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-[11px] text-studio-muted truncate">
                      {combo.clips.length} clip{combo.clips.length === 1 ? '' : 's'}
                      {combo.loop ? ' · loop' : ''}
                    </div>
                  </div>
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      title="Rename"
                      className="px-1 text-studio-muted hover:text-studio-text"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(combo.id)
                        setDraftName(combo.name)
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
                        const id = duplicateAnimationCombo(combo.id)
                        selectAnimationCombo(id)
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
                        deleteAnimationCombo(combo.id)
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
        {canDrag && dragId && overIndex === combos.length && <div className="h-0.5 rounded bg-studio-accent" />}
      </div>

      {/* ---- Zone 3: compact playback transport ---- */}
      <div className="border-t border-studio-border px-2 py-1.5 flex items-center gap-1">
        <button className={tbtn} title="Play / resume" disabled={!selectedCombo} onClick={() => setComboPreviewPlaying(true)}>
          ▶
        </button>
        <button className={tbtn} title="Pause" disabled={!selectedCombo} onClick={() => setComboPreviewPlaying(false)}>
          ⏸
        </button>
        <button
          className={tbtn}
          title="Stop (reset to start)"
          disabled={!selectedCombo}
          onClick={() => {
            setComboPreviewPlaying(false)
            setComboPreviewTimeMs(0)
          }}
        >
          ⏹
        </button>
        <button
          className={tbtn}
          title="Restart from beginning"
          disabled={!selectedCombo}
          onClick={() => {
            setComboPreviewTimeMs(0)
            setComboPreviewPlaying(true)
          }}
        >
          ⟲
        </button>
        <button
          className={tbtn}
          title="Preview from the selected clip's position"
          disabled={!selectedCombo}
          onClick={() => {
            const clip = selectedCombo?.clips.find((c) => c.id === selectedClipId) ?? selectedCombo?.clips[0]
            if (clip) setComboPreviewTimeMs(clip.startTimeMs)
          }}
        >
          ⇥
        </button>
        <button
          className={`${tbtn} ${loopPreview ? 'border-studio-accent text-studio-accent' : ''}`}
          title="Loop preview"
          disabled={!selectedCombo}
          onClick={() => setComboPreviewLoop(!loopPreview)}
        >
          ↻
        </button>
        <span className="ml-auto text-[11px] font-mono text-studio-muted tabular-nums">
          {Math.round(previewTimeMs)}ms{playing ? ' ·▶' : ''}
        </span>
      </div>

      {/* ---- Zone 4: slim settings / sequence-editing hint ---- */}
      <div className="border-t border-studio-border px-2 py-1.5 text-[11px] text-studio-muted">
        {selectedCombo ? (
          <>
            Editing <span className="text-studio-text">{selectedCombo.name}</span> · {selectedCombo.clips.length} clip
            {selectedCombo.clips.length === 1 ? '' : 's'} — edit the sequence in the Timeline below.
          </>
        ) : (
          'Select or add a combination to begin.'
        )}
      </div>
    </div>
  )
}
