import { Fragment, useEffect, useRef, useState } from 'react'
import { useStore, normalizeName } from '@/state/store'
import type { Animation, AnimationFolder } from '@/types'
import { ContextMenu, type MenuItem } from './ContextMenu'

// A single visible row of the flattened tree. Folders come before animations within each parent
// (VS Code Explorer ordering); collapsed folders hide their descendants.
type Row =
  | { kind: 'folder'; folder: AnimationFolder; depth: number; key: string }
  | { kind: 'animation'; anim: Animation; depth: number; key: string }

// What a drag is currently pointing at. `into` = drop inside a folder (or root); `reorder` = insert
// among a parent's same-kind siblings at a given index.
type Drop =
  | { type: 'into'; folderId: string | null }
  | { type: 'reorder'; parentId: string | null; kind: 'folder' | 'animation'; index: number; rowKey: string; pos: 'before' | 'after' }

type DragItem = { kind: 'folder' | 'animation'; id: string }
type Menu = { x: number; y: number; target: { type: 'folder' | 'animation' | 'root'; id?: string } }

const INDENT = 12
const AUTO_EXPAND_MS = 700

export function AnimationLibraryPanel() {
  const animations = useStore((s) => s.project.animations)
  const folders = useStore((s) => s.project.animationFolders)
  // Names that collide (would share an exported C++ identifier) — flagged in the list so the user
  // can rename them. New items are auto-suffixed by the store, so these come only from manual renames.
  const nameCounts = animations.reduce((m, a) => m.set(normalizeName(a.name), (m.get(normalizeName(a.name)) ?? 0) + 1), new Map<string, number>())
  const isDupName = (name: string) => (nameCounts.get(normalizeName(name)) ?? 0) > 1
  const activeAnimationId = useStore((s) => s.activeAnimationId)
  const selectAnimation = useStore((s) => s.selectAnimation)
  const addAnimation = useStore((s) => s.addAnimation)
  const duplicateAnimation = useStore((s) => s.duplicateAnimation)
  const renameAnimation = useStore((s) => s.renameAnimation)
  const deleteAnimation = useStore((s) => s.deleteAnimation)
  const addAnimationFolder = useStore((s) => s.addAnimationFolder)
  const renameAnimationFolder = useStore((s) => s.renameAnimationFolder)
  const deleteAnimationFolder = useStore((s) => s.deleteAnimationFolder)
  const setAnimationFolderExpanded = useStore((s) => s.setAnimationFolderExpanded)
  const moveAnimationToFolder = useStore((s) => s.moveAnimationToFolder)
  const moveAnimationFolder = useStore((s) => s.moveAnimationFolder)
  const checkpoint = useStore((s) => s.checkpoint)
  const setMode = useStore((s) => s.setMode)

  const [editing, setEditing] = useState<{ kind: 'folder' | 'animation'; id: string } | null>(null)
  const [draftName, setDraftName] = useState('')
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

  // ---- Build the flattened visible-row list -------------------------------------------------------
  const childFolders = (parentId: string | null) =>
    folders.filter((f) => f.parentId === parentId).sort((a, b) => a.order - b.order)
  const childAnimations = (folderId: string | null) =>
    animations.filter((a) => (a.folderId ?? null) === folderId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const rows: Row[] = []
  const build = (parentId: string | null, depth: number) => {
    for (const folder of childFolders(parentId)) {
      rows.push({ kind: 'folder', folder, depth, key: `f:${folder.id}` })
      if (folder.expanded) build(folder.id, depth + 1)
    }
    for (const anim of childAnimations(parentId)) {
      rows.push({ kind: 'animation', anim, depth, key: `a:${anim.id}` })
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

  // ---- Actions ------------------------------------------------------------------------------------
  const beginRename = (kind: 'folder' | 'animation', id: string, name: string) => {
    setEditing({ kind, id })
    setDraftName(name)
  }
  const commitRename = () => {
    if (!editing) return
    checkpoint()
    if (editing.kind === 'folder') renameAnimationFolder(editing.id, draftName.trim() || 'Folder')
    else renameAnimation(editing.id, draftName.trim() || 'Animation')
    setEditing(null)
  }

  const createAnimation = (folderId: string | null) => {
    checkpoint()
    const id = addAnimation('New Animation', folderId)
    if (folderId) setAnimationFolderExpanded(folderId, true)
    selectAnimation(id)
    setMode('animate')
  }
  const createFolder = (parentId: string | null) => {
    checkpoint()
    const id = addAnimationFolder(parentId)
    if (parentId) setAnimationFolderExpanded(parentId, true)
    beginRename('folder', id, 'New Folder')
  }

  const applyDrop = () => {
    if (!drag || !drop) return clearDrag()
    checkpoint()
    if (drop.type === 'into') {
      if (drag.kind === 'animation') moveAnimationToFolder(drag.id, drop.folderId, childAnimations(drop.folderId).length)
      else moveAnimationFolder(drag.id, drop.folderId, childFolders(drop.folderId).length)
    } else {
      if (drag.kind === 'animation') moveAnimationToFolder(drag.id, drop.parentId, drop.index)
      else moveAnimationFolder(drag.id, drop.parentId, drop.index)
    }
    clearDrag()
  }

  // Auto-expand a collapsed folder after hovering a dragged item over it briefly.
  const scheduleAutoExpand = (folder: AnimationFolder) => {
    if (folder.expanded) return
    if (autoExpand.current?.folderId === folder.id) return
    cancelAutoExpand()
    autoExpand.current = {
      folderId: folder.id,
      timer: window.setTimeout(() => {
        setAnimationFolderExpanded(folder.id, true)
        autoExpand.current = null
      }, AUTO_EXPAND_MS)
    }
  }

  // Compute the drop descriptor for hovering a given row. Folder rows have three vertical bands:
  // top → reorder before, middle → drop INTO, bottom → reorder after. Animation rows split in half.
  const computeDrop = (row: Row, e: React.DragEvent): Drop | null => {
    if (!drag) return null
    const r = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - r.top) / r.height

    if (row.kind === 'folder') {
      const f = row.folder
      // Never allow dropping a folder into itself or a descendant.
      const intoBlocked = drag.kind === 'folder' && (drag.id === f.id || isDescendant(f.id, drag.id))
      if (rel >= 0.3 && rel <= 0.7 && !intoBlocked) {
        scheduleAutoExpand(f)
        return { type: 'into', folderId: f.id }
      }
      cancelAutoExpand()
      const before = rel < 0.5
      const siblings = childFolders(f.parentId)
      if (drag.kind === 'folder') {
        const idx = siblings.findIndex((x) => x.id === f.id)
        return { type: 'reorder', parentId: f.parentId, kind: 'folder', index: before ? idx : idx + 1, rowKey: row.key, pos: before ? 'before' : 'after' }
      }
      // An animation dropped on a folder's edge lands in that folder's PARENT (animations always sit
      // after folders), appended to the parent's animation group.
      return { type: 'reorder', parentId: f.parentId, kind: 'animation', index: childAnimations(f.parentId).length, rowKey: row.key, pos: before ? 'before' : 'after' }
    }

    // Animation row.
    cancelAutoExpand()
    const a = row.anim
    const parentId = a.folderId ?? null
    const before = rel < 0.5
    if (drag.kind === 'animation') {
      const siblings = childAnimations(parentId)
      const idx = siblings.findIndex((x) => x.id === a.id)
      return { type: 'reorder', parentId, kind: 'animation', index: before ? idx : idx + 1, rowKey: row.key, pos: before ? 'before' : 'after' }
    }
    // A folder dropped on an animation row moves into that animation's parent (appended to folders).
    return { type: 'reorder', parentId, kind: 'folder', index: childFolders(parentId).length, rowKey: row.key, pos: before ? 'before' : 'after' }
  }

  const menuItems = (): MenuItem[] => {
    if (!menu) return []
    if (menu.target.type === 'folder') {
      const id = menu.target.id!
      const folder = folderById.get(id)
      return [
        { label: 'New Animation', onClick: () => createAnimation(id) },
        { label: 'New Folder', onClick: () => createFolder(id) },
        { label: 'Rename', separatorBefore: true, onClick: () => folder && beginRename('folder', id, folder.name) },
        { label: 'Delete Folder', danger: true, onClick: () => { checkpoint(); deleteAnimationFolder(id) } }
      ]
    }
    if (menu.target.type === 'animation') {
      const id = menu.target.id!
      const anim = animations.find((a) => a.id === id)
      return [
        { label: 'Rename', onClick: () => anim && beginRename('animation', id, anim.name) },
        { label: 'Duplicate', onClick: () => { checkpoint(); const nid = duplicateAnimation(id); selectAnimation(nid) } },
        {
          label: 'Delete',
          danger: true,
          disabled: animations.length <= 1,
          onClick: () => { if (animations.length > 1) { checkpoint(); deleteAnimation(id) } }
        }
      ]
    }
    // Root (empty area) menu.
    return [
      { label: 'New Animation', onClick: () => createAnimation(null) },
      { label: 'New Folder', onClick: () => createFolder(null) }
    ]
  }

  const rowIsDropInto = (row: Row) => drop?.type === 'into' && row.kind === 'folder' && drop.folderId === row.folder.id
  const lineBefore = (row: Row) => drop?.type === 'reorder' && drop.rowKey === row.key && drop.pos === 'before'
  const lineAfter = (row: Row) => drop?.type === 'reorder' && drop.rowKey === row.key && drop.pos === 'after'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 border-b border-studio-border">
        <span className="studio-label">Animations</span>
        <div className="flex items-center gap-1">
          <button className="studio-btn" title="New folder" onClick={() => createFolder(null)}>
            📁+
          </button>
          <button className="studio-btn" onClick={() => createAnimation(null)}>
            + New
          </button>
        </div>
      </div>

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
          // Dropping onto empty container space → move to root end.
          if (!drag) return
          e.preventDefault()
          if (!drop) {
            if (drag.kind === 'animation') { checkpoint(); moveAnimationToFolder(drag.id, null, childAnimations(null).length) }
            else { checkpoint(); moveAnimationFolder(drag.id, null, childFolders(null).length) }
            clearDrag()
          } else applyDrop()
        }}
      >
        {rows.map((row) => {
          const indent = row.depth * INDENT
          const isActive = row.kind === 'animation' && row.anim.id === activeAnimationId
          const dropInto = rowIsDropInto(row)
          const isEditing = editing?.id === (row.kind === 'folder' ? row.folder.id : row.anim.id) && editing?.kind === row.kind
          const dragId = row.kind === 'folder' ? row.folder.id : row.anim.id

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
                className={`group flex items-center gap-1.5 pr-2 py-1.5 rounded-md cursor-pointer text-sm border ${
                  drag?.id === dragId ? 'opacity-40' : ''
                } ${
                  dropInto
                    ? 'bg-studio-accent/25 border-studio-accent'
                    : isActive
                      ? 'bg-studio-accent/20 text-studio-text border-studio-accent/40'
                      : 'hover:bg-studio-panel2 border-transparent'
                }`}
                onClick={() => {
                  if (row.kind === 'folder') {
                    setAnimationFolderExpanded(row.folder.id, !row.folder.expanded)
                  } else {
                    selectAnimation(row.anim.id)
                    setMode('animate')
                  }
                }}
              >
                {row.kind === 'folder' ? (
                  <span className="w-3 shrink-0 text-studio-muted select-none leading-none">{row.folder.expanded ? '▾' : '▸'}</span>
                ) : (
                  <span className="w-3 shrink-0 text-studio-muted/40 group-hover:text-studio-muted cursor-grab select-none leading-none" title="Drag">
                    ⠿
                  </span>
                )}
                <span className="shrink-0 leading-none">{row.kind === 'folder' ? '📁' : '🎬'}</span>

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
                    className="truncate flex-1"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (row.kind === 'folder') beginRename('folder', row.folder.id, row.folder.name)
                      else beginRename('animation', row.anim.id, row.anim.name)
                    }}
                  >
                    {row.kind === 'folder' ? row.folder.name : row.anim.name}
                    {row.kind === 'animation' && row.anim.loop && <span className="text-studio-muted"> ↻</span>}
                    {row.kind === 'animation' && isDupName(row.anim.name) && (
                      <span className="text-studio-warn shrink-0" title="Duplicate name — rename to keep names unique">
                        ⚠
                      </span>
                    )}
                  </span>
                )}

                <div className="hidden group-hover:flex gap-1 shrink-0">
                  {row.kind === 'folder' ? (
                    <button
                      title="New animation in folder"
                      className="text-studio-muted hover:text-studio-text px-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        createAnimation(row.folder.id)
                      }}
                    >
                      +
                    </button>
                  ) : (
                    <button
                      title="Duplicate"
                      className="text-studio-muted hover:text-studio-text px-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        checkpoint()
                        const id = duplicateAnimation(row.anim.id)
                        selectAnimation(id)
                      }}
                    >
                      ⧉
                    </button>
                  )}
                  <button
                    title="Delete"
                    className="text-studio-muted hover:text-studio-danger px-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (row.kind === 'folder') {
                        checkpoint()
                        deleteAnimationFolder(row.folder.id)
                      } else {
                        if (animations.length <= 1) return
                        checkpoint()
                        deleteAnimation(row.anim.id)
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
          <div className="text-xs text-studio-muted text-center py-6">No animations yet. Use + New.</div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
    </div>
  )
}
