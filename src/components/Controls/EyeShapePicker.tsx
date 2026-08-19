import { useRef, useState } from 'react'
import { useStore } from '@/state/store'
import type { EyeShapeId } from '@/types'
import { EYE_SHAPE_POLYGONS, type EyeShapePolygon } from '@/renderer/eyeShapes'
import { parseSvgToPolygon, SvgShapeImportError } from '@/lib/svgShapeImport'

// 'default' covers Circle/Oval/Rounded Rectangle (all just width/height/radius presets on top
// of the existing analytic boundary, no polygon involved) — three swatches, one shared value.
const DEFAULT_PRESETS: { label: string; width: number; height: number; radius: number }[] = [
  { label: 'Circle', width: 90, height: 90, radius: 130 },
  { label: 'Oval', width: 78, height: 100, radius: 130 },
  { label: 'Rounded Rect', width: 90, height: 90, radius: 20 }
]

const BUILTIN_SHAPES: { value: EyeShapeId; label: string }[] = [
  { value: 'heart', label: 'Heart' },
  { value: 'star', label: 'Star' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'teardrop', label: 'Teardrop' },
  { value: 'leaf', label: 'Leaf' },
  { value: 'bean', label: 'Bean' },
  { value: 'crescent', label: 'Crescent' },
  { value: 'catEye', label: 'Cat Eye' },
  { value: 'animeEye', label: 'Anime Eye' },
  { value: 'robotEye', label: 'Robot Eye' },
  { value: 'happyArc', label: 'Happy Arc' },
  { value: 'maskLens', label: 'Mask Lens' }
]

const ICON_VIEWBOX = 24
const ICON_R = 10

function polygonToSvgPoints(polygon: EyeShapePolygon): string {
  const c = ICON_VIEWBOX / 2
  return polygon.map(([x, y]) => `${c + x * ICON_R},${c + y * ICON_R}`).join(' ')
}

function ShapeIcon({ isDefault, radius, polygon }: { isDefault?: boolean; radius?: number; polygon?: EyeShapePolygon | null }) {
  if (isDefault) {
    const rx = radius !== undefined ? Math.min(ICON_R, (radius / 130) * ICON_R) : ICON_R
    return (
      <svg viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} className="w-6 h-6">
        <rect x={ICON_VIEWBOX / 2 - ICON_R} y={ICON_VIEWBOX / 2 - ICON_R} width={ICON_R * 2} height={ICON_R * 2} rx={rx} fill="currentColor" />
      </svg>
    )
  }
  if (polygon && polygon.length > 0) {
    return (
      <svg viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} className="w-6 h-6">
        <polygon points={polygonToSvgPoints(polygon)} fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} className="w-6 h-6">
      <circle cx={ICON_VIEWBOX / 2} cy={ICON_VIEWBOX / 2} r={ICON_R} fill="none" stroke="currentColor" strokeDasharray="3 3" />
    </svg>
  )
}

interface EyeShapePickerProps {
  shape: EyeShapeId
  customShapeId: string | null
  /** Circle/Oval/Rounded Rect all share eyeShape === 'default' (only width/height/radius differ
   * between them) — these are needed so the picker can tell which ONE of the three preset
   * buttons (if any) actually matches the eye's current size, instead of highlighting all three
   * whenever any of them is active. */
  currentWidth: number
  currentHeight: number
  currentRadius: number
  onSelectShape: (shape: EyeShapeId, customShapeId: string | null) => void
  /** Circle/Oval/Rounded Rect presets need to also set width/height/radius — the caller owns
   * those fields, so the preset buttons call this instead of onSelectShape for 'default'. */
  onSelectDefaultPreset: (preset: { width: number; height: number; radius: number }) => void
}

export function EyeShapePicker({ shape, customShapeId, currentWidth, currentHeight, currentRadius, onSelectShape, onSelectDefaultPreset }: EyeShapePickerProps) {
  const customShapes = useStore((s) => s.project.customEyeShapes)
  const addCustomEyeShape = useStore((s) => s.addCustomEyeShape)
  const replaceCustomEyeShape = useStore((s) => s.replaceCustomEyeShape)
  const deleteCustomEyeShape = useStore((s) => s.deleteCustomEyeShape)
  const checkpoint = useStore((s) => s.checkpoint)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // Set right before opening the file picker to re-import over an existing custom shape
  // instead of adding a new library entry ("Allow replacing the imported SVG with another one").
  const replaceTargetRef = useRef<string | null>(null)

  const handleFile = async (file: File) => {
    setImportError(null)
    try {
      const text = await file.text()
      const points = parseSvgToPolygon(text)
      const name = file.name.replace(/\.svg$/i, '') || 'Custom Shape'
      checkpoint()
      if (replaceTargetRef.current) {
        replaceCustomEyeShape(replaceTargetRef.current, points, text)
        onSelectShape('custom', replaceTargetRef.current)
      } else {
        const id = addCustomEyeShape(name, points, text)
        onSelectShape('custom', id)
      }
    } catch (err) {
      setImportError(err instanceof SvgShapeImportError ? err.message : 'Could not read that SVG file.')
    } finally {
      replaceTargetRef.current = null
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = Array.from(e.dataTransfer.files).find((f) => f.name.toLowerCase().endsWith('.svg') || f.type === 'image/svg+xml')
    if (file) handleFile(file)
    else setImportError('Drop a single .svg file.')
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="studio-label">Eye Shape Library</span>
      <div className="grid grid-cols-4 gap-1.5">
        {DEFAULT_PRESETS.map((p) => (
          <button
            key={p.label}
            title={p.label}
            className={`flex flex-col items-center gap-1 py-1.5 rounded-md border text-[10px] transition-colors ${
              shape === 'default' && currentWidth === p.width && currentHeight === p.height && currentRadius === p.radius
                ? 'border-studio-accent bg-studio-accent/15 text-studio-accent'
                : 'border-studio-border bg-studio-panel2 text-studio-muted hover:text-studio-text'
            }`}
            onClick={() => {
              checkpoint()
              onSelectShape('default', null)
              onSelectDefaultPreset(p)
            }}
          >
            <ShapeIcon isDefault radius={p.radius} />
            {p.label}
          </button>
        ))}
        {BUILTIN_SHAPES.map((s) => (
          <button
            key={s.value}
            title={s.label}
            className={`flex flex-col items-center gap-1 py-1.5 rounded-md border text-[10px] transition-colors ${
              shape === s.value
                ? 'border-studio-accent bg-studio-accent/15 text-studio-accent'
                : 'border-studio-border bg-studio-panel2 text-studio-muted hover:text-studio-text'
            }`}
            onClick={() => {
              checkpoint()
              onSelectShape(s.value, null)
            }}
          >
            <ShapeIcon polygon={EYE_SHAPE_POLYGONS[s.value]} />
            {s.label}
          </button>
        ))}
        {customShapes.map((cs) => (
          <button
            key={cs.id}
            title={cs.name}
            className={`relative flex flex-col items-center gap-1 py-1.5 rounded-md border text-[10px] transition-colors ${
              shape === 'custom' && customShapeId === cs.id
                ? 'border-studio-accent bg-studio-accent/15 text-studio-accent'
                : 'border-studio-border bg-studio-panel2 text-studio-muted hover:text-studio-text'
            }`}
            onClick={() => {
              checkpoint()
              onSelectShape('custom', cs.id)
            }}
          >
            <ShapeIcon polygon={cs.points} />
            <span className="truncate max-w-full px-0.5">{cs.name}</span>
            <span
              role="button"
              tabIndex={0}
              title="Replace this custom shape's SVG"
              className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-studio-panel border border-studio-border text-studio-muted hover:text-studio-accent hover:border-studio-accent flex items-center justify-center text-[9px] leading-none"
              onClick={(e) => {
                e.stopPropagation()
                replaceTargetRef.current = cs.id
                fileInputRef.current?.click()
              }}
            >
              ↻
            </span>
            <span
              role="button"
              tabIndex={0}
              title="Delete this custom shape"
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-studio-panel border border-studio-border text-studio-muted hover:text-red-400 hover:border-red-400 flex items-center justify-center text-[9px] leading-none"
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                deleteCustomEyeShape(cs.id)
                if (shape === 'custom' && customShapeId === cs.id) onSelectShape('default', null)
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button
          title="Import a custom SVG shape"
          className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-md border border-dashed text-[10px] transition-colors ${
            dragOver ? 'border-studio-accent bg-studio-accent/10 text-studio-accent' : 'border-studio-border bg-studio-panel2 text-studio-muted hover:text-studio-text'
          }`}
          onClick={() => {
            replaceTargetRef.current = null
            fileInputRef.current?.click()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span className="text-base leading-none">+</span>
          {dragOver ? 'Drop SVG here' : 'Import SVG'}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      {importError && <p className="text-[11px] text-red-400">{importError}</p>}
      <p className="text-[11px] text-studio-muted">
        Click a shape to apply it instantly, or drag &amp; drop / import an SVG. Custom SVGs use only the first &lt;path&gt;
        element, traced into an outline.
      </p>
    </div>
  )
}
