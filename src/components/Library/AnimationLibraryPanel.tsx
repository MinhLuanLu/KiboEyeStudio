import { Fragment, useState } from 'react'
import { useStore } from '@/state/store'

export function AnimationLibraryPanel() {
  const animations = useStore((s) => s.project.animations)
  const activeAnimationId = useStore((s) => s.activeAnimationId)
  const selectAnimation = useStore((s) => s.selectAnimation)
  const addAnimation = useStore((s) => s.addAnimation)
  const duplicateAnimation = useStore((s) => s.duplicateAnimation)
  const renameAnimation = useStore((s) => s.renameAnimation)
  const deleteAnimation = useStore((s) => s.deleteAnimation)
  const reorderAnimation = useStore((s) => s.reorderAnimation)
  const checkpoint = useStore((s) => s.checkpoint)
  const setMode = useStore((s) => s.setMode)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  // Drag-to-reorder state: which item is being dragged, and which insertion slot (0..length) the
  // indicator line is currently showing.
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const clearDrag = () => {
    setDragId(null)
    setOverIndex(null)
  }

  const dropAt = (slot: number) => {
    if (!dragId) return
    const fromIdx = animations.findIndex((x) => x.id === dragId)
    if (fromIdx === -1) {
      clearDrag()
      return
    }
    // `slot` is an insert-before position (0..length); account for the dragged item's own removal.
    let target = slot > fromIdx ? slot - 1 : slot
    target = Math.max(0, Math.min(animations.length - 1, target))
    if (target !== fromIdx) {
      checkpoint()
      reorderAnimation(dragId, target)
    }
    clearDrag()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 border-b border-studio-border">
        <span className="studio-label">Animations</span>
        <button
          className="studio-btn"
          onClick={() => {
            checkpoint()
            const id = addAnimation()
            selectAnimation(id)
            setMode('animate')
          }}
        >
          + New
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1"
        onDragOver={(e) => {
          if (dragId) e.preventDefault()
        }}
        onDrop={(e) => {
          if (dragId) {
            e.preventDefault()
            dropAt(overIndex ?? animations.length)
          }
        }}
      >
        {animations.map((a, i) => (
          <Fragment key={a.id}>
            {dragId && overIndex === i && <div className="h-0.5 rounded bg-studio-accent" />}
            <div
              draggable={editingId !== a.id}
              onDragStart={(e) => {
                setDragId(a.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', a.id)
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
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-sm ${dragId === a.id ? 'opacity-40' : ''} ${
                a.id === activeAnimationId ? 'bg-studio-accent/20 text-studio-text border border-studio-accent/40' : 'hover:bg-studio-panel2 border border-transparent'
              }`}
              onClick={() => {
                selectAnimation(a.id)
                setMode('animate')
              }}
            >
              <span className="text-studio-muted/50 group-hover:text-studio-muted cursor-grab select-none shrink-0 leading-none" title="Drag to reorder">
                ⠿
              </span>
              {editingId === a.id ? (
                <input
                  autoFocus
                  className="bg-studio-panel2 border border-studio-border rounded px-1 text-sm flex-1"
                  value={draftName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    checkpoint()
                    renameAnimation(a.id, draftName || a.name)
                    setEditingId(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
              ) : (
                <span
                  className="truncate flex-1"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingId(a.id)
                    setDraftName(a.name)
                  }}
                >
                  {a.name}
                  {a.loop && <span className="text-studio-muted"> ↻</span>}
                </span>
              )}
              <div className="hidden group-hover:flex gap-1 shrink-0">
                <button
                  title="Duplicate"
                  className="text-studio-muted hover:text-studio-text px-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    checkpoint()
                    const id = duplicateAnimation(a.id)
                    selectAnimation(id)
                  }}
                >
                  ⧉
                </button>
                <button
                  title="Delete"
                  className="text-studio-muted hover:text-studio-danger px-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (animations.length <= 1) return
                    checkpoint()
                    deleteAnimation(a.id)
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          </Fragment>
        ))}
        {dragId && overIndex === animations.length && <div className="h-0.5 rounded bg-studio-accent" />}
      </div>
    </div>
  )
}
