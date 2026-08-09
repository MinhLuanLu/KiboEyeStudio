import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/state/store'

/**
 * Photoshop-style screen tab bar for the LVGL Designer. Each screen in the project is a tab;
 * clicking one makes it the active screen (the Canvas, Layers, Properties, Logic and LVGL Code
 * panels all already render whichever screen is `uiDesign.activeScreenId`, so switching is instant
 * and each screen keeps its own independent design). Supports add (+), inline rename (double-click),
 * duplicate, delete (✕), and drag-and-drop reorder. Everything stays inside the one project.
 */
export function ScreenTabs() {
  const screens = useStore((s) => s.project.uiDesign.screens)
  const activeScreenId = useStore((s) => s.project.uiDesign.activeScreenId)
  const setActive = useStore((s) => s.setUiActiveScreen)
  const addScreen = useStore((s) => s.addUiScreen)
  const renameScreen = useStore((s) => s.renameUiScreen)
  const duplicateScreen = useStore((s) => s.duplicateUiScreen)
  const deleteScreen = useStore((s) => s.deleteUiScreen)
  const reorderScreens = useStore((s) => s.reorderUiScreens)
  const checkpoint = useStore((s) => s.checkpoint)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) inputRef.current?.select()
  }, [editingId])

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setEditValue(current)
  }
  const commitRename = () => {
    if (editingId) {
      checkpoint()
      renameScreen(editingId, editValue)
    }
    setEditingId(null)
  }

  const onDrop = (targetIndex: number) => {
    if (dragIndex !== null && dragIndex !== targetIndex) {
      checkpoint()
      reorderScreens(dragIndex, targetIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-studio-border bg-studio-panel overflow-x-auto shrink-0">
      <span className="text-[10px] uppercase tracking-wide text-studio-muted mr-1 shrink-0">Screens</span>
      {screens.map((screen, i) => {
        const isActive = screen.id === activeScreenId
        const isEditing = editingId === screen.id
        const isDropTarget = overIndex === i && dragIndex !== null && dragIndex !== i
        return (
          <div
            key={screen.id}
            draggable={!isEditing}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault()
              if (overIndex !== i) setOverIndex(i)
            }}
            onDrop={() => onDrop(i)}
            onDragEnd={() => {
              setDragIndex(null)
              setOverIndex(null)
            }}
            onClick={() => setActive(screen.id)}
            onDoubleClick={() => startRename(screen.id, screen.name)}
            title={isActive ? `${screen.name} (active) — double-click to rename` : `Switch to ${screen.name} — double-click to rename`}
            className={`group flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-md border cursor-pointer select-none whitespace-nowrap transition-colors ${
              isActive ? 'bg-studio-panel2 border-studio-accent text-studio-text' : 'bg-studio-panel border-studio-border text-studio-muted hover:text-studio-text'
            } ${isDropTarget ? 'ring-2 ring-studio-accent' : ''} ${dragIndex === i ? 'opacity-50' : ''}`}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                className="bg-studio-bg border border-studio-border rounded px-1 py-0.5 text-sm w-28"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className="text-sm">{screen.name}</span>
            )}
            <button
              title="Duplicate screen"
              className={`px-1 text-xs rounded hover:bg-studio-border2 ${isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'} hover:opacity-100`}
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                duplicateScreen(screen.id)
              }}
            >
              ⧉
            </button>
            {screens.length > 1 && (
              <button
                title="Delete screen"
                className={`px-1 text-xs rounded text-studio-muted hover:text-studio-danger hover:bg-studio-border2 ${isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'} hover:opacity-100`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`Delete screen "${screen.name}" and everything on it? This can be undone.`)) {
                    checkpoint()
                    deleteScreen(screen.id)
                  }
                }}
              >
                ✕
              </button>
            )}
          </div>
        )
      })}
      <button
        title="New screen"
        className="studio-btn px-2 py-1 shrink-0"
        onClick={() => {
          checkpoint()
          addScreen()
        }}
      >
        +
      </button>
    </div>
  )
}
