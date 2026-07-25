import { useState } from 'react'
import { useStore } from '@/state/store'

export function AnimationLibraryPanel() {
  const animations = useStore((s) => s.project.animations)
  const activeAnimationId = useStore((s) => s.activeAnimationId)
  const selectAnimation = useStore((s) => s.selectAnimation)
  const addAnimation = useStore((s) => s.addAnimation)
  const duplicateAnimation = useStore((s) => s.duplicateAnimation)
  const renameAnimation = useStore((s) => s.renameAnimation)
  const deleteAnimation = useStore((s) => s.deleteAnimation)
  const checkpoint = useStore((s) => s.checkpoint)
  const setMode = useStore((s) => s.setMode)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

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
      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
        {animations.map((a) => (
          <div
            key={a.id}
            className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md cursor-pointer text-sm ${
              a.id === activeAnimationId ? 'bg-studio-accent/20 text-studio-text border border-studio-accent/40' : 'hover:bg-studio-panel2 border border-transparent'
            }`}
            onClick={() => {
              selectAnimation(a.id)
              setMode('animate')
            }}
          >
            {editingId === a.id ? (
              <input
                autoFocus
                className="bg-studio-panel2 border border-studio-border rounded px-1 text-sm w-full mr-2"
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
                className="truncate"
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
        ))}
      </div>
    </div>
  )
}
