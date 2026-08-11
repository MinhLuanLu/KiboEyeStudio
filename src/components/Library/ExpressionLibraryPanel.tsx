import { useState, useEffect, useRef, Fragment } from 'react'
import { useStore } from '@/state/store'
import { renderFace } from '@/renderer/faceRenderer'
import { fitDisplayToBox } from '@/renderer/displayMask'
import { expressionLeftColors, expressionLeftParams, expressionRightColors, expressionRightParams } from '@/types'
import type { Expression, ExpressionFolder } from '@/types'
import { ContextMenu, type MenuItem } from './ContextMenu'

export const EXPRESSION_THUMB_BOX = 48

export function ExpressionThumb({ expr }: { expr: Expression }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const display = useStore((s) => s.project.display)
  const customShapes = useStore((s) => s.project.customPupilShapes)
  const fitted = fitDisplayToBox(display, EXPRESSION_THUMB_BOX)
  const leftParams = expressionLeftParams(expr)
  const rightParams = expressionRightParams(expr)
  const leftColors = expressionLeftColors(expr)
  const rightColors = expressionRightColors(expr)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    renderFace(ctx, leftParams, { ...fitted, theme: leftColors, rightParams, rightTheme: rightColors, customShapes })
  }, [leftParams, rightParams, leftColors, rightColors, fitted, customShapes])
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

// A visible row of the flattened tree. Folders come before expressions within each parent (VS Code
// Explorer ordering); collapsed folders hide their descendants.
type Row =
  | { kind: 'folder'; folder: ExpressionFolder; depth: number; key: string }
  | { kind: 'expression'; expr: Expression; depth: number; key: string }

type Drop =
  | { type: 'into'; folderId: string | null }
  | { type: 'reorder'; parentId: string | null; kind: 'folder' | 'expression'; index: number; rowKey: string; pos: 'before' | 'after' }

type DragItem = { kind: 'folder' | 'expression'; id: string }
type Menu = { x: number; y: number; target: { type: 'folder' | 'expression' | 'root'; id?: string } }

const INDENT = 12
const AUTO_EXPAND_MS = 700

export function ExpressionLibraryPanel() {
  const expressions = useStore((s) => s.project.expressions)
  const folders = useStore((s) => s.project.expressionFolders)
  const eyeBase = useStore((s) => s.project.eyeBase)
  const projectColors = useStore((s) => s.project.colors)
  const eyeLeftOverride = useStore((s) => s.project.eyeLeftOverride)
  const eyeRightOverride = useStore((s) => s.project.eyeRightOverride)
  const colorsLeftOverride = useStore((s) => s.project.colorsLeftOverride)
  const colorsRightOverride = useStore((s) => s.project.colorsRightOverride)
  const selectedExpressionId = useStore((s) => s.selectedExpressionId)
  const addExpression = useStore((s) => s.addExpression)
  const applyExpression = useStore((s) => s.applyExpression)
  const saveExpression = useStore((s) => s.saveExpression)
  const renameExpression = useStore((s) => s.renameExpression)
  const deleteExpression = useStore((s) => s.deleteExpression)
  const addExpressionFolder = useStore((s) => s.addExpressionFolder)
  const renameExpressionFolder = useStore((s) => s.renameExpressionFolder)
  const deleteExpressionFolder = useStore((s) => s.deleteExpressionFolder)
  const setExpressionFolderExpanded = useStore((s) => s.setExpressionFolderExpanded)
  const moveExpressionToFolder = useStore((s) => s.moveExpressionToFolder)
  const moveExpressionFolder = useStore((s) => s.moveExpressionFolder)
  const checkpoint = useStore((s) => s.checkpoint)

  const [editing, setEditing] = useState<{ kind: 'folder' | 'expression'; id: string } | null>(null)
  const [draftName, setDraftName] = useState('')
  const [newName, setNewName] = useState('')
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const autoExpand = useRef<{ folderId: string; timer: number } | null>(null)

  const cancelAutoExpand = () => {
    if (autoExpand.current) {
      clearTimeout(autoExpand.current.timer)
      autoExpand.current = null
    }
  }
  const clearDrag = () => {
    setDrag(null)
    setDrop(null)
    cancelAutoExpand()
  }
  useEffect(() => () => cancelAutoExpand(), [])

  // ---- Dirty tracking (live pose vs. the selected expression's saved data) -----------------------
  const selected = expressions.find((e) => e.id === selectedExpressionId)
  const isDirty =
    !!selected &&
    (JSON.stringify(selected.params) !== JSON.stringify(eyeBase) ||
      JSON.stringify(selected.colors) !== JSON.stringify(projectColors) ||
      JSON.stringify(selected.leftParams) !== JSON.stringify(eyeLeftOverride) ||
      JSON.stringify(selected.rightParams) !== JSON.stringify(eyeRightOverride) ||
      JSON.stringify(selected.leftColors) !== JSON.stringify(colorsLeftOverride) ||
      JSON.stringify(selected.rightColors) !== JSON.stringify(colorsRightOverride))

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

  // ---- Flattened tree ----------------------------------------------------------------------------
  const childFolders = (parentId: string | null) =>
    folders.filter((f) => f.parentId === parentId).sort((a, b) => a.order - b.order)
  const childExpressions = (folderId: string | null) =>
    expressions.filter((e) => (e.folderId ?? null) === folderId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const rows: Row[] = []
  const build = (parentId: string | null, depth: number) => {
    for (const folder of childFolders(parentId)) {
      rows.push({ kind: 'folder', folder, depth, key: `f:${folder.id}` })
      if (folder.expanded) build(folder.id, depth + 1)
    }
    for (const expr of childExpressions(parentId)) {
      rows.push({ kind: 'expression', expr, depth, key: `e:${expr.id}` })
    }
  }
  build(null, 0)

  const folderById = new Map(folders.map((f) => [f.id, f]))
  const isDescendant = (maybeChild: string | null, ancestor: string): boolean => {
    let cur = maybeChild
    while (cur) {
      if (cur === ancestor) return true
      cur = folderById.get(cur)?.parentId ?? null
    }
    return false
  }
  const folderIsEmpty = (id: string) =>
    !folders.some((f) => f.parentId === id) && !expressions.some((e) => (e.folderId ?? null) === id)

  // ---- Actions -----------------------------------------------------------------------------------
  const beginRename = (kind: 'folder' | 'expression', id: string, name: string) => {
    setEditing({ kind, id })
    setDraftName(name)
  }
  const commitRename = () => {
    if (!editing) return
    checkpoint()
    if (editing.kind === 'folder') renameExpressionFolder(editing.id, draftName.trim() || 'Folder')
    else renameExpression(editing.id, draftName.trim() || 'Expression') // name uniqueness follows existing rules
    setEditing(null)
  }

  // New expression captures the CURRENT live pose (same as "Save Pose") into the target folder.
  const createExpression = (folderId: string | null) => {
    checkpoint()
    addExpression('New Expression', folderId)
    if (folderId) setExpressionFolderExpanded(folderId, true)
    const newId = useStore.getState().selectedExpressionId
    if (newId) beginRename('expression', newId, 'New Expression')
  }
  const createFolder = (parentId: string | null) => {
    checkpoint()
    const id = addExpressionFolder(parentId)
    if (parentId) setExpressionFolderExpanded(parentId, true)
    beginRename('folder', id, 'New Folder')
  }
  const removeFolder = (id: string) => {
    // Confirm before deleting a non-empty folder; its contents move up to the parent (never lost).
    if (!folderIsEmpty(id)) {
      const f = folderById.get(id)
      const ok = window.confirm(`Delete folder "${f?.name ?? ''}"? Its expressions and subfolders move up to the parent.`)
      if (!ok) return
    }
    checkpoint()
    deleteExpressionFolder(id)
  }

  const applyDrop = () => {
    if (!drag || !drop) return clearDrag()
    checkpoint()
    if (drop.type === 'into') {
      if (drag.kind === 'expression') moveExpressionToFolder(drag.id, drop.folderId, childExpressions(drop.folderId).length)
      else moveExpressionFolder(drag.id, drop.folderId, childFolders(drop.folderId).length)
    } else {
      if (drag.kind === 'expression') moveExpressionToFolder(drag.id, drop.parentId, drop.index)
      else moveExpressionFolder(drag.id, drop.parentId, drop.index)
    }
    clearDrag()
  }

  const scheduleAutoExpand = (folder: ExpressionFolder) => {
    if (folder.expanded) return
    if (autoExpand.current?.folderId === folder.id) return
    cancelAutoExpand()
    autoExpand.current = {
      folderId: folder.id,
      timer: window.setTimeout(() => {
        setExpressionFolderExpanded(folder.id, true)
        autoExpand.current = null
      }, AUTO_EXPAND_MS)
    }
  }

  const computeDrop = (row: Row, e: React.DragEvent): Drop | null => {
    if (!drag) return null
    const r = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - r.top) / r.height

    if (row.kind === 'folder') {
      const f = row.folder
      const intoBlocked = drag.kind === 'folder' && (drag.id === f.id || isDescendant(f.id, drag.id))
      if (rel >= 0.3 && rel <= 0.7 && !intoBlocked) {
        scheduleAutoExpand(f)
        return { type: 'into', folderId: f.id }
      }
      cancelAutoExpand()
      const before = rel < 0.5
      if (drag.kind === 'folder') {
        const siblings = childFolders(f.parentId)
        const idx = siblings.findIndex((x) => x.id === f.id)
        return { type: 'reorder', parentId: f.parentId, kind: 'folder', index: before ? idx : idx + 1, rowKey: row.key, pos: before ? 'before' : 'after' }
      }
      // An expression on a folder's edge lands in that folder's PARENT (expressions sit after folders).
      return { type: 'reorder', parentId: f.parentId, kind: 'expression', index: childExpressions(f.parentId).length, rowKey: row.key, pos: before ? 'before' : 'after' }
    }

    cancelAutoExpand()
    const ex = row.expr
    const parentId = ex.folderId ?? null
    const before = rel < 0.5
    if (drag.kind === 'expression') {
      const siblings = childExpressions(parentId)
      const idx = siblings.findIndex((x) => x.id === ex.id)
      return { type: 'reorder', parentId, kind: 'expression', index: before ? idx : idx + 1, rowKey: row.key, pos: before ? 'before' : 'after' }
    }
    return { type: 'reorder', parentId, kind: 'folder', index: childFolders(parentId).length, rowKey: row.key, pos: before ? 'before' : 'after' }
  }

  const menuItems = (): MenuItem[] => {
    if (!menu) return []
    if (menu.target.type === 'folder') {
      const id = menu.target.id!
      const folder = folderById.get(id)
      return [
        { label: 'New Expression', onClick: () => createExpression(id) },
        { label: 'New Folder', onClick: () => createFolder(id) },
        { label: 'Rename', separatorBefore: true, onClick: () => folder && beginRename('folder', id, folder.name) },
        { label: 'Delete Folder', danger: true, onClick: () => removeFolder(id) }
      ]
    }
    if (menu.target.type === 'expression') {
      const id = menu.target.id!
      const ex = expressions.find((e) => e.id === id)
      return [
        { label: 'Rename', onClick: () => ex && beginRename('expression', id, ex.name) },
        { label: 'Delete', danger: true, onClick: () => { checkpoint(); deleteExpression(id) } }
      ]
    }
    return [
      { label: 'New Expression', onClick: () => createExpression(null) },
      { label: 'New Folder', onClick: () => createFolder(null) }
    ]
  }

  const rowIsDropInto = (row: Row) => drop?.type === 'into' && row.kind === 'folder' && drop.folderId === row.folder.id
  const lineBefore = (row: Row) => drop?.type === 'reorder' && drop.rowKey === row.key && drop.pos === 'before'
  const lineAfter = (row: Row) => drop?.type === 'reorder' && drop.rowKey === row.key && drop.pos === 'after'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 p-2 border-b border-studio-border">
        <input
          className="flex-1 bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm min-w-0"
          placeholder="New expression name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) {
              checkpoint()
              addExpression(newName.trim())
              setNewName('')
            }
          }}
        />
        <button className="studio-btn shrink-0" title="New folder" onClick={() => createFolder(null)}>
          📁+
        </button>
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

      <div
        className="flex-1 overflow-y-auto p-1.5"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, target: { type: 'root' } })
        }}
        onDragOver={(e) => {
          if (drag) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!drag) return
          e.preventDefault()
          if (!drop) {
            // Dropped on empty container space → move to the root end.
            checkpoint()
            if (drag.kind === 'expression') moveExpressionToFolder(drag.id, null, childExpressions(null).length)
            else moveExpressionFolder(drag.id, null, childFolders(null).length)
            clearDrag()
          } else applyDrop()
        }}
      >
        {rows.map((row) => {
          const indent = row.depth * INDENT
          const isSelected = row.kind === 'expression' && row.expr.id === selectedExpressionId
          const showDirtyDot = isSelected && isDirty
          const dropInto = rowIsDropInto(row)
          const dragId = row.kind === 'folder' ? row.folder.id : row.expr.id
          const isEditing = editing?.id === dragId && editing?.kind === row.kind

          return (
            <Fragment key={row.key}>
              {lineBefore(row) && <div className="h-0.5 rounded bg-studio-accent" style={{ marginLeft: indent }} />}
              <div
                draggable={!isEditing}
                onDragStart={(e) => {
                  setDrag({ kind: row.kind, id: dragId })
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', dragId)
                }}
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  setDrop(computeDrop(row, e))
                }}
                onDrop={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  e.stopPropagation()
                  applyDrop()
                }}
                onDragEnd={clearDrag}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ x: e.clientX, y: e.clientY, target: { type: row.kind, id: dragId } })
                }}
                style={{ paddingLeft: indent + 4 }}
                className={`group flex items-center gap-2 pr-2 py-1.5 rounded-md cursor-pointer border ${
                  drag?.id === dragId ? 'opacity-40' : ''
                } ${
                  dropInto
                    ? 'bg-studio-accent/25 border-studio-accent'
                    : isSelected
                      ? 'bg-studio-accent/20 border-studio-accent/40'
                      : 'hover:bg-studio-panel2 border-transparent'
                }`}
                onClick={() => {
                  if (row.kind === 'folder') setExpressionFolderExpanded(row.folder.id, !row.folder.expanded)
                  else handleSelect(row.expr.id)
                }}
              >
                {row.kind === 'folder' ? (
                  <span className="w-3 shrink-0 text-studio-muted select-none leading-none">{row.folder.expanded ? '▾' : '▸'}</span>
                ) : (
                  <span className="w-3 shrink-0 text-studio-muted/40 group-hover:text-studio-muted cursor-grab select-none leading-none" title="Drag">
                    ⠿
                  </span>
                )}
                {row.kind === 'folder' ? (
                  <span className="shrink-0 leading-none">📁</span>
                ) : (
                  <div style={{ width: EXPRESSION_THUMB_BOX, height: EXPRESSION_THUMB_BOX }} className="shrink-0">
                    <ExpressionThumb expr={row.expr} />
                  </div>
                )}

                {isEditing ? (
                  <input
                    autoFocus
                    className="bg-studio-panel2 border border-studio-border rounded px-1 text-sm flex-1 min-w-0"
                    value={draftName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      else if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <span
                    className="text-sm truncate flex-1 flex items-center gap-1.5"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (row.kind === 'folder') beginRename('folder', row.folder.id, row.folder.name)
                      else beginRename('expression', row.expr.id, row.expr.name)
                    }}
                  >
                    {row.kind === 'folder' ? row.folder.name : row.expr.name}
                    {showDirtyDot && <span className="w-1.5 h-1.5 rounded-full bg-studio-warn shrink-0" title="Unsaved changes" />}
                  </span>
                )}

                <div className="hidden group-hover:flex gap-1 shrink-0">
                  {row.kind === 'folder' && (
                    <button
                      title="New expression in folder (from current pose)"
                      className="text-studio-muted hover:text-studio-text px-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        createExpression(row.folder.id)
                      }}
                    >
                      +
                    </button>
                  )}
                  <button
                    title="Delete"
                    className="text-studio-muted hover:text-studio-danger px-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (row.kind === 'folder') removeFolder(row.folder.id)
                      else {
                        checkpoint()
                        deleteExpression(row.expr.id)
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {lineAfter(row) && <div className="h-0.5 rounded bg-studio-accent" style={{ marginLeft: indent }} />}
            </Fragment>
          )
        })}

        {rows.length === 0 && (
          <div className="text-xs text-studio-muted text-center py-6">No expressions yet. Save a pose above.</div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
    </div>
  )
}
