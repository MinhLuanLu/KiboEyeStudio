import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/state/store'
import { renderFace } from '@/renderer/faceRenderer'
import { fitDisplayToBox } from '@/renderer/displayMask'
import type { EyeParams } from '@/types'

const THUMB_BOX = 48

function ExpressionThumb({ params }: { params: EyeParams }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const colors = useStore((s) => s.project.colors)
  const display = useStore((s) => s.project.display)
  const fitted = fitDisplayToBox(display, THUMB_BOX)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    renderFace(ctx, params, { ...fitted, theme: colors })
  }, [params, colors, fitted])
  const borderRadius = fitted.shape === 'circle' ? '50%' : fitted.shape === 'rounded' ? `${fitted.cornerRadius}px` : '0px'
  return (
    <canvas
      ref={ref}
      width={Math.round(fitted.width)}
      height={Math.round(fitted.height)}
      style={{ borderRadius }}
      className="shrink-0"
    />
  )
}

export function ExpressionLibraryPanel() {
  const expressions = useStore((s) => s.project.expressions)
  const addExpression = useStore((s) => s.addExpression)
  const applyExpression = useStore((s) => s.applyExpression)
  const renameExpression = useStore((s) => s.renameExpression)
  const deleteExpression = useStore((s) => s.deleteExpression)
  const checkpoint = useStore((s) => s.checkpoint)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [newName, setNewName] = useState('')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 p-2 border-b border-studio-border">
        <input
          className="flex-1 bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm min-w-0"
          placeholder="New expression name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          className="studio-btn shrink-0"
          disabled={!newName.trim()}
          onClick={() => {
            checkpoint()
            addExpression(newName.trim())
            setNewName('')
          }}
        >
          Save Pose
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 grid grid-cols-1 gap-1">
        {expressions.map((expr) => (
          <div
            key={expr.id}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-studio-panel2 border border-transparent cursor-pointer"
            onClick={() => applyExpression(expr.id)}
          >
            <ExpressionThumb params={expr.params} />
            {editingId === expr.id ? (
              <input
                autoFocus
                className="bg-studio-panel2 border border-studio-border rounded px-1 text-sm flex-1 min-w-0"
                value={draftName}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  checkpoint()
                  renameExpression(expr.id, draftName || expr.name)
                  setEditingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            ) : (
              <span
                className="text-sm truncate flex-1"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingId(expr.id)
                  setDraftName(expr.name)
                }}
              >
                {expr.name}
              </span>
            )}
            <button
              title="Delete"
              className="hidden group-hover:block text-studio-muted hover:text-studio-danger px-1 shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                deleteExpression(expr.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
