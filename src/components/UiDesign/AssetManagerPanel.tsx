import { useRef, useState } from 'react'
import { useStore } from '@/state/store'
import { decodeUiAssetFile, UiAssetImportError } from '@/lib/import/uiAssetImport'
import { setAssetDragPayload } from '@/lib/uiDesign/dnd'
import { UI_BACKGROUND_IMAGE_WIDGETS, UI_SRC_IMAGE_WIDGETS } from '@/types'
import type { UiAsset } from '@/types'

/** Rough byte size from a data URL's base64 payload (3 bytes per 4 base64 chars) — not stored
 * as a separate field (see UiAsset.sourceFormat's comment on why), just computed for display. */
function estimatedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  const base64Length = commaIndex >= 0 ? dataUrl.length - commaIndex - 1 : dataUrl.length
  return Math.round(base64Length * 0.75)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

// Assets are usable from: the Properties panel (via src/backgroundImage fields, see
// PropertiesPanel.tsx), raw HTML (<img src="name">, see htmlSync.ts), CSS
// (background-image: url("name"), see cssSync.ts), and directly here — click an asset to apply
// it to whatever's selected, or drag it onto the canvas (see dnd.ts/Canvas.tsx) to place it or
// assign it to an existing widget without needing to select anything first.
export function AssetManagerPanel() {
  const assets = useStore((s) => s.project.uiDesign.assets)
  const selectedWidgetId = useStore((s) => s.selectedWidgetId)
  const selectedWidget = useStore((s) => (s.selectedWidgetId ? s.project.uiDesign.widgets[s.selectedWidgetId] : null))
  const addUiAsset = useStore((s) => s.addUiAsset)
  const deleteUiAsset = useStore((s) => s.deleteUiAsset)
  const renameUiAsset = useStore((s) => s.renameUiAsset)
  const duplicateUiAsset = useStore((s) => s.duplicateUiAsset)
  const replaceUiAsset = useStore((s) => s.replaceUiAsset)
  const setUiWidgetSrc = useStore((s) => s.setUiWidgetSrc)
  const updateUiWidgetStyle = useStore((s) => s.updateUiWidgetStyle)
  const checkpoint = useStore((s) => s.checkpoint)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceTargetId = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const canApplyAsSrc = selectedWidget && UI_SRC_IMAGE_WIDGETS.has(selectedWidget.type)
  const canApplyAsBackground = selectedWidget && UI_BACKGROUND_IMAGE_WIDGETS.has(selectedWidget.type)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    setImporting(true)
    try {
      for (const file of Array.from(files)) {
        const decoded = await decodeUiAssetFile(file)
        checkpoint()
        addUiAsset(file.name, decoded.dataUrl, decoded.naturalWidth, decoded.naturalHeight, decoded.sourceFormat)
      }
    } catch (err) {
      setError(err instanceof UiAssetImportError ? err.message : 'Could not import that file.')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleReplaceFile = async (files: FileList | null) => {
    const file = files?.[0]
    const targetId = replaceTargetId.current
    if (!file || !targetId) return
    setError(null)
    try {
      const decoded = await decodeUiAssetFile(file)
      checkpoint()
      replaceUiAsset(targetId, decoded.dataUrl, decoded.naturalWidth, decoded.naturalHeight, decoded.sourceFormat)
    } catch (err) {
      setError(err instanceof UiAssetImportError ? err.message : 'Could not import that file.')
    } finally {
      if (replaceInputRef.current) replaceInputRef.current.value = ''
      replaceTargetId.current = null
    }
  }

  const handleApply = (asset: UiAsset) => {
    if (!selectedWidgetId) return
    checkpoint()
    if (canApplyAsSrc) setUiWidgetSrc(selectedWidgetId, asset.id)
    else if (canApplyAsBackground) updateUiWidgetStyle(selectedWidgetId, { backgroundImage: asset.id })
  }

  const canApply = canApplyAsSrc || canApplyAsBackground
  const filtered = assets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-2 flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml,.svg,.bmp,.webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input ref={replaceInputRef} type="file" accept="image/*,.svg" className="hidden" onChange={(e) => handleReplaceFile(e.target.files)} />

      <button className="studio-btn text-xs" disabled={importing} onClick={() => fileInputRef.current?.click()}>
        {importing ? 'Importing…' : 'Import Image (PNG/JPG/BMP/WebP/GIF/SVG)...'}
      </button>
      {error && <div className="text-[11px] text-studio-danger">{error}</div>}

      {assets.length > 0 && (
        <input
          className="bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-xs"
          placeholder="Search assets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {selectedWidget && (
        <div className="text-[11px] text-studio-muted">
          {canApplyAsSrc && `Click an asset to set the selected ${selectedWidget.type}'s image.`}
          {!canApplyAsSrc && canApplyAsBackground && `Click an asset to set the selected ${selectedWidget.type}'s background image.`}
          {!canApply && 'The selected widget doesn\'t support an image.'}
        </div>
      )}
      {!selectedWidget && assets.length > 0 && (
        <div className="text-[11px] text-studio-muted">Select a widget to apply an asset, or drag an asset onto the canvas.</div>
      )}

      {assets.length === 0 && <div className="text-xs text-studio-muted p-2">No assets imported yet.</div>}
      {assets.length > 0 && filtered.length === 0 && <div className="text-xs text-studio-muted p-2">No assets match "{search}".</div>}

      <div className="grid grid-cols-2 gap-2">
        {filtered.map((asset) => {
          const isAppliedSrc = canApplyAsSrc && selectedWidget!.src === asset.id
          const isAppliedBg = canApplyAsBackground && selectedWidget!.style.backgroundImage === asset.id
          return (
            <div
              key={asset.id}
              className="group relative flex flex-col gap-1 bg-studio-panel2 border border-studio-border rounded p-1.5"
              draggable
              onDragStart={(e) => setAssetDragPayload(e, asset.id)}
            >
              <button
                className={`w-full aspect-square bg-studio-panel border rounded overflow-hidden flex items-center justify-center ${
                  isAppliedSrc || isAppliedBg ? 'border-studio-accent' : 'border-studio-border'
                }`}
                disabled={!canApply}
                onClick={() => handleApply(asset)}
                title={canApply ? `Apply "${asset.name}"` : 'Select a widget that supports an image to apply this asset'}
              >
                <img src={asset.dataUrl} alt={asset.name} className="max-w-full max-h-full" draggable={false} />
              </button>

              {editingId === asset.id ? (
                <input
                  autoFocus
                  className="bg-studio-panel border border-studio-border rounded px-1 text-[10px]"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    checkpoint()
                    renameUiAsset(asset.id, draftName.trim() || asset.name)
                    setEditingId(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
              ) : (
                <span
                  className="text-[10px] text-studio-muted truncate text-center cursor-text"
                  title="Double-click to rename"
                  onDoubleClick={() => {
                    setEditingId(asset.id)
                    setDraftName(asset.name)
                  }}
                >
                  {asset.name}
                </span>
              )}

              <span className="text-[9px] text-studio-muted text-center">
                {asset.naturalWidth}×{asset.naturalHeight} · {formatBytes(estimatedByteSize(asset.dataUrl))} · {asset.sourceFormat}
              </span>

              <div className="hidden group-hover:flex items-center justify-center gap-1 text-[10px]">
                <button
                  className="text-studio-muted hover:text-studio-text px-1"
                  title="Replace image"
                  onClick={() => {
                    replaceTargetId.current = asset.id
                    replaceInputRef.current?.click()
                  }}
                >
                  ⟲
                </button>
                <button
                  className="text-studio-muted hover:text-studio-text px-1"
                  title="Duplicate"
                  onClick={() => {
                    checkpoint()
                    duplicateUiAsset(asset.id)
                  }}
                >
                  ⧉
                </button>
                <button
                  className="text-studio-muted hover:text-studio-danger px-1"
                  title="Delete"
                  onClick={() => {
                    checkpoint()
                    deleteUiAsset(asset.id)
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
