import { useRef, useState } from 'react'
import { useStore } from '@/state/store'
import type { BackgroundFitMode } from '@/types'
import { Slider } from '@/components/ui/Slider'
import { decodeBackgroundImageFile, BackgroundImportError } from '@/lib/import/backgroundImport'

const FIT_MODES: { value: BackgroundFitMode; label: string; hint: string }[] = [
  { value: 'fill', label: 'Fill', hint: 'Stretch to the display (ignores aspect ratio)' },
  { value: 'contain', label: 'Contain', hint: 'Whole image visible, aspect kept' },
  { value: 'cover', label: 'Cover', hint: 'Fill the display, aspect kept, crop overflow' },
  { value: 'fitWidth', label: 'Fit Width', hint: 'Scale to the display width' },
  { value: 'fitHeight', label: 'Fit Height', hint: 'Scale to the display height' },
  { value: 'original', label: 'Original', hint: "The image's own pixel size" },
  { value: 'custom', label: 'Custom', hint: 'Set width, height, X and Y by hand' }
]

/** Upload / place / remove the whole-display background image (project.backgroundImage). Lives in
 * the Display panel's Appearance tab. The image draws behind every expression and animation, so it
 * belongs to the display, not to any one expression. */
export function BackgroundImageControls() {
  const bg = useStore((s) => s.project.backgroundImage)
  const display = useStore((s) => s.project.display)
  const setBackgroundImage = useStore((s) => s.setBackgroundImage)
  const updateBackgroundImage = useStore((s) => s.updateBackgroundImage)
  const checkpoint = useStore((s) => s.checkpoint)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const decoded = await decodeBackgroundImageFile(file)
      setBackgroundImage(decoded) // undoable (checkpointed in the store)
    } catch (e) {
      setError(e instanceof BackgroundImportError ? e.message : 'Could not load that image.')
    }
    if (fileRef.current) fileRef.current.value = '' // allow re-selecting the same file
  }

  const isCustom = bg?.fitMode === 'custom'
  const maxDim = Math.max(display.width, display.height)

  return (
    <div className="flex flex-col gap-2.5">
      <span className="studio-label">Background Image</span>
      <input ref={fileRef} type="file" accept=".png,.svg,image/png,image/svg+xml" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      {!bg ? (
        <>
          <button className="studio-btn self-start" onClick={() => fileRef.current?.click()}>
            Upload PNG / SVG…
          </button>
          <p className="text-[11px] text-studio-muted leading-snug">
            Adds an image behind the eyes for every expression and animation, clipped to the display shape.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div
              className="w-12 h-12 rounded-md border border-studio-border bg-[repeating-conic-gradient(#2a2a2a_0deg_90deg,#333_90deg_180deg)] bg-[length:12px_12px] shrink-0 overflow-hidden"
              style={{ backgroundImage: `url(${bg.dataUrl})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate">{bg.name}</div>
              <div className="text-[10px] text-studio-muted uppercase">{bg.kind} · {bg.naturalWidth}×{bg.naturalHeight}</div>
            </div>
            <div className="flex flex-col gap-1">
              <button className="studio-btn text-xs" onClick={() => fileRef.current?.click()}>Replace</button>
              <button className="text-[11px] text-studio-muted hover:text-studio-text" onClick={() => setBackgroundImage(null)}>Remove</button>
            </div>
          </div>

          <label className="flex items-center justify-between text-xs cursor-pointer select-none">
            <span className="studio-label">Visible</span>
            <input type="checkbox" className="w-4 h-4 accent-studio-accent" checked={bg.visible} onChange={(e) => { checkpoint(); updateBackgroundImage({ visible: e.target.checked }) }} />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="studio-label text-[10px]">Fit Mode</span>
            <select
              className="studio-input text-xs"
              value={bg.fitMode}
              onChange={(e) => { checkpoint(); updateBackgroundImage({ fitMode: e.target.value as BackgroundFitMode }) }}
            >
              {FIT_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-studio-muted leading-snug">{FIT_MODES.find((m) => m.value === bg.fitMode)?.hint}</p>
          </div>

          <Slider label="Opacity" value={bg.opacity} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => updateBackgroundImage({ opacity: v })} />
          <Slider label="Scale" value={bg.scale} min={10} max={400} suffix="%" onCommitStart={checkpoint} onChange={(v) => updateBackgroundImage({ scale: v })} />
          <Slider label="Position X" value={bg.x} min={-maxDim} max={maxDim} suffix="px" onCommitStart={checkpoint} onChange={(v) => updateBackgroundImage({ x: v })} />
          <Slider label="Position Y" value={bg.y} min={-maxDim} max={maxDim} suffix="px" onCommitStart={checkpoint} onChange={(v) => updateBackgroundImage({ y: v })} />

          {isCustom && (
            <>
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="studio-label">Lock Aspect Ratio</span>
                <input type="checkbox" className="w-4 h-4 accent-studio-accent" checked={bg.lockAspect} onChange={(e) => { checkpoint(); updateBackgroundImage({ lockAspect: e.target.checked }) }} />
              </label>
              <Slider
                label="Width"
                value={bg.width}
                min={1}
                max={maxDim * 2}
                suffix="px"
                onCommitStart={checkpoint}
                onChange={(v) => updateBackgroundImage(bg.lockAspect ? { width: v, height: Math.round((v * bg.naturalHeight) / Math.max(1, bg.naturalWidth)) } : { width: v })}
              />
              <Slider
                label="Height"
                value={bg.height}
                min={1}
                max={maxDim * 2}
                suffix="px"
                onCommitStart={checkpoint}
                onChange={(v) => updateBackgroundImage(bg.lockAspect ? { height: v, width: Math.round((v * bg.naturalWidth) / Math.max(1, bg.naturalHeight)) } : { height: v })}
              />
            </>
          )}
          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </>
      )}
      {!bg && error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
