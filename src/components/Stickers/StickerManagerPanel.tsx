import { useEffect, useRef, useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import { effectiveStickers } from '@/types'
import type { StickerAsset, StickerScope } from '@/types'
import { BUILTIN_STICKER_DRAWERS, BUILTIN_STICKER_ANIMATED } from '@/renderer/builtinStickers'
import { STICKER_PRESET_BUNDLES } from '@/data/stickerPresets'
import { decodeGifSticker, decodePngSticker, decodeSvgSticker, StickerImportError } from '@/lib/import/stickerImport'
import { StickerControls } from './StickerControls'

const SCOPES: { value: StickerScope; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'expression', label: 'Expression' },
  { value: 'animation', label: 'Animation' }
]

function StickerThumb({ asset }: { asset: StickerAsset | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!asset || asset.kind !== 'procedural' || !asset.builtinId) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.scale(canvas.width / 2 - 2, canvas.height / 2 - 2)
    BUILTIN_STICKER_DRAWERS[asset.builtinId](ctx, 0.3, '#8ab4ff')
    ctx.restore()
  }, [asset])

  const cls = 'w-8 h-8 rounded bg-studio-panel2 border border-studio-border shrink-0'
  if (!asset) return <div className={cls} title="Missing asset" />
  if (asset.kind === 'raster' && asset.frames?.[0]) {
    return <img src={asset.frames[0]} className={`${cls} object-contain`} alt={asset.name} />
  }
  return <canvas ref={canvasRef} width={32} height={32} className={cls} />
}

/** Sticker Manager: lists every currently-visible sticker (project + active expression +
 * active animation, merged — same effectiveStickers() the renderer draws from), with add/
 * duplicate/delete/hide/lock/reorder, preset application, and import entry points. Selecting
 * an item shows its full StickerControls below the list. */
export function StickerManagerPanel() {
  const project = useStore((s) => s.project)
  const stickerScope = useStore((s) => s.stickerScope)
  const setStickerScope = useStore((s) => s.setStickerScope)
  const selectedExpressionId = useStore((s) => s.selectedExpressionId)
  const selectedStickerId = useStore((s) => s.selectedStickerId)
  const selectSticker = useStore((s) => s.selectSticker)
  const addSticker = useStore((s) => s.addSticker)
  const duplicateSticker = useStore((s) => s.duplicateSticker)
  const deleteSticker = useStore((s) => s.deleteSticker)
  const renameSticker = useStore((s) => s.renameSticker)
  const stickerClipboard = useStore((s) => s.stickerClipboard)
  const copySticker = useStore((s) => s.copySticker)
  const pasteSticker = useStore((s) => s.pasteSticker)
  const setStickerVisible = useStore((s) => s.setStickerVisible)
  const setStickerLocked = useStore((s) => s.setStickerLocked)
  const moveStickerOrder = useStore((s) => s.moveStickerOrder)
  const applyStickerPreset = useStore((s) => s.applyStickerPreset)
  const addStickerAsset = useStore((s) => s.addStickerAsset)
  const deleteStickerAsset = useStore((s) => s.deleteStickerAsset)
  const checkpoint = useStore((s) => s.checkpoint)

  const [newAssetId, setNewAssetId] = useState(project.stickerAssets[0]?.id ?? '')
  const [dragId, setDragId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [justImportedId, setJustImportedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const pngInputRef = useRef<HTMLInputElement>(null)
  const gifInputRef = useRef<HTMLInputElement>(null)
  const svgInputRef = useRef<HTMLInputElement>(null)

  // Editing a specific expression is the natural default scope for anything added while it's
  // selected — without this, the scope tab silently stays wherever it last was (defaulting to
  // 'project' on first load), so a sticker added "while editing Happy" actually lands in the
  // project-wide list and shows up in every expression, which reads as exactly the "stickers
  // aren't properly scoped to the current expression" bug. Only reacts to the expression
  // *changing*, so a deliberate manual scope choice (e.g. picking Project on purpose while an
  // expression stays selected, to add something project-wide) isn't stomped on afterward.
  useEffect(() => {
    setStickerScope(selectedExpressionId ? 'expression' : 'project')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpressionId])

  const handleImport = async (file: File, kind: 'png' | 'gif' | 'svg') => {
    setImportError(null)
    try {
      const decoded =
        kind === 'png' ? await decodePngSticker(file) : kind === 'gif' ? await decodeGifSticker(file) : await decodeSvgSticker(file)
      checkpoint()
      const name = file.name.replace(/\.(png|gif|svg)$/i, '') || 'Sticker'
      const assetId = addStickerAsset({ name, kind: kind === 'svg' ? 'svg' : 'raster', ...decoded })
      setNewAssetId(assetId)
      setJustImportedId(assetId)
    } catch (err) {
      setImportError(err instanceof StickerImportError ? err.message : `Could not read that ${kind.toUpperCase()} file.`)
    }
  }

  const scopeLabel = stickerScope === 'project' ? 'Project' : stickerScope === 'expression' ? 'Expression' : 'Animation'

  const activeExpression = project.expressions.find((e) => e.id === selectedExpressionId) ?? null
  const activeAnimation = getActiveAnimation() ?? null
  const stickers = effectiveStickers(project, activeExpression, activeAnimation)
  const assetsById = new Map(project.stickerAssets.map((a) => [a.id, a]))
  const selected = stickers.find((s) => s.id === selectedStickerId) ?? null

  const canAddToScope = stickerScope === 'project' || (stickerScope === 'expression' && activeExpression) || (stickerScope === 'animation' && activeAnimation)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-3 p-3">
        <p className="text-xs text-studio-muted leading-relaxed">
          Place decorations behind or in front of the eyes. Adding applies to the scope below.
        </p>
        <div className="flex items-center bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              className={`studio-tab flex-1 ${stickerScope === s.value ? 'studio-tab-active' : ''}`}
              onClick={() => setStickerScope(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {!canAddToScope && (
          <p className="text-[11px] text-studio-muted italic">
            {stickerScope === 'expression' ? 'Select an expression first.' : 'Select or play an animation first.'}
          </p>
        )}

        <div className="flex gap-1.5">
          <select
            className="flex-1 bg-studio-panel2 border border-studio-border rounded-md text-xs px-2 py-1.5"
            value={newAssetId}
            onChange={(e) => {
              setNewAssetId(e.target.value)
              setJustImportedId(null)
            }}
          >
            {project.stickerAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            className={`studio-btn text-xs whitespace-nowrap ${
              justImportedId && justImportedId === newAssetId ? 'border-studio-accent text-studio-accent' : ''
            }`}
            disabled={!canAddToScope || !newAssetId}
            title={`Add the selected sticker to the current ${scopeLabel.toLowerCase()}`}
            onClick={() => {
              checkpoint()
              const id = addSticker(newAssetId)
              if (id) selectSticker(id)
              setJustImportedId(null)
            }}
          >
            + Add to {scopeLabel}
          </button>
        </div>
        <button
          className="studio-btn text-xs self-start"
          disabled={!canAddToScope || !stickerClipboard}
          title={stickerClipboard ? `Paste "${stickerClipboard.name}" into the current ${scopeLabel.toLowerCase()}` : 'Copy a sticker first'}
          onClick={() => {
            checkpoint()
            const id = pasteSticker()
            if (id) selectSticker(id)
          }}
        >
          Paste{stickerClipboard ? ` "${stickerClipboard.name}"` : ''}
        </button>

        <div className="flex flex-col gap-1">
          <span className="studio-label">Drag onto a Timeline sticker track</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {project.stickerAssets.map((a) => (
              <div key={a.id} className="relative shrink-0">
                <button
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-kibo-sticker-asset', a.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  className="cursor-grab active:cursor-grabbing"
                  title={`Drag "${a.name}" onto a sticker track to place it there`}
                >
                  <StickerThumb asset={a} />
                </button>
                {a.kind !== 'procedural' && (
                  <button
                    title={`Remove "${a.name}" from the sticker library (also removes every placed instance of it)`}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-studio-panel border border-studio-border text-[9px] text-studio-muted hover:text-red-400 hover:border-red-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      checkpoint()
                      deleteStickerAsset(a.id)
                      if (newAssetId === a.id) setNewAssetId(project.stickerAssets.find((o) => o.id !== a.id)?.id ?? '')
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="studio-label">Presets</span>
          <div className="grid grid-cols-3 gap-1.5">
            {STICKER_PRESET_BUNDLES.map((preset) => (
              <button
                key={preset.id}
                className="studio-btn text-xs"
                disabled={!canAddToScope}
                onClick={() => {
                  checkpoint()
                  applyStickerPreset(preset.id)
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="studio-label">Import Custom Sticker</span>
          <div className="flex gap-1.5">
            <button className="studio-btn text-xs flex-1" onClick={() => pngInputRef.current?.click()}>
              Import PNG...
            </button>
            <button className="studio-btn text-xs flex-1" onClick={() => gifInputRef.current?.click()}>
              Import GIF...
            </button>
            <button className="studio-btn text-xs flex-1" onClick={() => svgInputRef.current?.click()}>
              Import SVG...
            </button>
          </div>
          <input
            ref={pngInputRef}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImport(file, 'png')
              e.target.value = ''
            }}
          />
          <input
            ref={svgInputRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImport(file, 'svg')
              e.target.value = ''
            }}
          />
          <input
            ref={gifInputRef}
            type="file"
            accept="image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImport(file, 'gif')
              e.target.value = ''
            }}
          />
          {importError && <p className="text-[11px] text-red-400">{importError}</p>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5">
        {stickers.length === 0 && <p className="text-xs text-studio-muted italic px-1">No stickers yet.</p>}
        {stickers.map((inst) => {
          const asset = assetsById.get(inst.assetId)
          const animated = asset?.kind === 'raster' ? (asset.frames?.length ?? 0) > 1 : asset?.builtinId ? BUILTIN_STICKER_ANIMATED[asset.builtinId] : false
          return (
            <div
              key={inst.id}
              draggable
              onDragStart={() => setDragId(inst.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (!dragId || dragId === inst.id) return
                // Swap-based reorder: repeatedly nudge the dragged sticker toward the drop
                // target's position within its own layer. Simple and robust for the modest
                // sticker counts this UI is meant for, at the cost of not being a true
                // arbitrary-position drop (it walks one step per drop like the ↑/↓ buttons do).
                if (inst.layer === stickers.find((s) => s.id === dragId)?.layer) {
                  checkpoint()
                  moveStickerOrder(dragId, inst.order > (stickers.find((s) => s.id === dragId)?.order ?? 0) ? 'down' : 'up')
                }
                setDragId(null)
              }}
              className={`flex items-center gap-2 p-1.5 rounded-md border cursor-pointer ${
                selectedStickerId === inst.id ? 'border-studio-accent bg-studio-accent/10' : 'border-studio-border bg-studio-panel2'
              } ${!inst.visible ? 'opacity-50' : ''}`}
              onClick={() => selectSticker(inst.id)}
            >
              <StickerThumb asset={asset} />
              <div className="flex-1 min-w-0">
                {renamingId === inst.id ? (
                  <input
                    autoFocus
                    className="text-xs bg-studio-panel border border-studio-accent rounded px-1 w-full"
                    value={nameDraft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => {
                      if (nameDraft.trim()) { checkpoint(); renameSticker(inst.id, nameDraft.trim()) }
                      setRenamingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <div
                    className="text-xs truncate"
                    title="Double-click to rename"
                    onDoubleClick={(e) => { e.stopPropagation(); setNameDraft(inst.name); setRenamingId(inst.id) }}
                  >
                    {inst.name}
                  </div>
                )}
                <div className="flex items-center gap-1 text-[10px] text-studio-muted">
                  <span className="px-1 rounded bg-studio-panel border border-studio-border">{inst.layer === 'behind' ? 'Behind' : 'Front'}</span>
                  <span className="px-1 rounded bg-studio-panel border border-studio-border">{animated ? 'Animated' : 'Static'}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  title="Move up"
                  className="text-studio-muted hover:text-studio-text text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); checkpoint(); moveStickerOrder(inst.id, 'up') }}
                >
                  ↑
                </button>
                <button
                  title="Move down"
                  className="text-studio-muted hover:text-studio-text text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); checkpoint(); moveStickerOrder(inst.id, 'down') }}
                >
                  ↓
                </button>
                <button
                  title={inst.visible ? 'Hide' : 'Show'}
                  className="text-studio-muted hover:text-studio-text text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); checkpoint(); setStickerVisible(inst.id, !inst.visible) }}
                >
                  {inst.visible ? '◉' : '○'}
                </button>
                <button
                  title={inst.locked ? 'Unlock' : 'Lock'}
                  className="text-studio-muted hover:text-studio-text text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); checkpoint(); setStickerLocked(inst.id, !inst.locked) }}
                >
                  {inst.locked ? '🔒' : '🔓'}
                </button>
                <button
                  title="Copy"
                  className="text-studio-muted hover:text-studio-text text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); copySticker(inst.id) }}
                >
                  ⧉📋
                </button>
                <button
                  title="Duplicate"
                  className="text-studio-muted hover:text-studio-text text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); checkpoint(); duplicateSticker(inst.id) }}
                >
                  ⧉
                </button>
                <button
                  title="Delete"
                  className="text-studio-muted hover:text-red-400 text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); checkpoint(); deleteSticker(inst.id) }}
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <div className="max-h-[45%] overflow-y-auto">
          <StickerControls sticker={selected} />
        </div>
      )}
    </div>
  )
}
