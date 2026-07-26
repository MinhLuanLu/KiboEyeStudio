import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/state/store'
import { renderFace } from '@/renderer/faceRenderer'
import { fitDisplayToBox } from '@/renderer/displayMask'
import type { EyeColors, EyeParams } from '@/types'

const THUMB_BOX = 48

function ExpressionThumb({ params, colors }: { params: EyeParams; colors: EyeColors }) {
  const ref = useRef<HTMLCanvasElement>(null)
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
  const eyeBase = useStore((s) => s.project.eyeBase)
  const projectColors = useStore((s) => s.project.colors)
  const selectedExpressionId = useStore((s) => s.selectedExpressionId)
  const addExpression = useStore((s) => s.addExpression)
  const applyExpression = useStore((s) => s.applyExpression)
  const saveExpression = useStore((s) => s.saveExpression)
  const renameExpression = useStore((s) => s.renameExpression)
  const deleteExpression = useStore((s) => s.deleteExpression)
  const checkpoint = useStore((s) => s.checkpoint)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [newName, setNewName] = useState('')

  const selected = expressions.find((e) => e.id === selectedExpressionId)
  const isDirty = !!selected && (JSON.stringify(selected.params) !== JSON.stringify(eyeBase) || JSON.stringify(selected.colors) !== JSON.stringify(projectColors))

  const handleSelect = (id: string) => {
    if (id === selectedExpressionId) return
    if (isDirty && selected) {
      const proceed = window.confirm(`"${selected.name}" has unsaved changes. Switch anyway and discard them?`)
      if (!proceed) return
    }
    applyExpression(id)
  }

  const handleSave = () => {
    if (!selectedExpressionId) return
    checkpoint()
    saveExpression(selectedExpressionId)
  }

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

      {selected && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-studio-border bg-studio-panel2/50">
          <span className="text-xs text-studio-muted truncate flex-1">
            Editing <span className="text-studio-text">{selected.name}</span>
            {isDirty && <span className="text-studio-warn"> — unsaved changes</span>}
          </span>
          <button className="studio-btn-primary text-xs px-2 py-1" disabled={!isDirty} onClick={handleSave}>
            Save
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 grid grid-cols-1 gap-1">
        {expressions.map((expr) => {
          const isSelected = expr.id === selectedExpressionId
          const showDirtyDot = isSelected && isDirty
          return (
            <div
              key={expr.id}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border ${
                isSelected ? 'bg-studio-accent/20 border-studio-accent/40' : 'hover:bg-studio-panel2 border-transparent'
              }`}
              onClick={() => handleSelect(expr.id)}
            >
              <ExpressionThumb params={expr.params} colors={expr.colors} />
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
                  className="text-sm truncate flex-1 flex items-center gap-1.5"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingId(expr.id)
                    setDraftName(expr.name)
                  }}
                >
                  {expr.name}
                  {showDirtyDot && <span className="w-1.5 h-1.5 rounded-full bg-studio-warn shrink-0" title="Unsaved changes" />}
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
          )
        })}
      </div>
    </div>
  )
}
