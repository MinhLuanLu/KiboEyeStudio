import { useRef, useState } from 'react'
import { useStore } from '@/state/store'
import type { PupilShapeId } from '@/types'
import { PUPIL_SHAPE_POLYGONS, type PupilPolygon } from '@/renderer/pupilShapes'
import { parseSvgToPolygon, SvgShapeImportError } from '@/lib/svgShapeImport'

const BUILTIN_SHAPES: { value: PupilShapeId; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'oval', label: 'Oval' },
  { value: 'heart', label: 'Heart' },
  { value: 'star', label: 'Star' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' }
]

const ICON_VIEWBOX = 24
const ICON_R = 10 // leaves a little breathing room inside the 24x24 viewBox

function polygonToSvgPoints(polygon: PupilPolygon): string {
  const c = ICON_VIEWBOX / 2
  return polygon.map(([x, y]) => `${c + x * ICON_R},${c + y * ICON_R}`).join(' ')
}

/** Tiny inline preview icon for a shape swatch button — for built-ins this renders the exact
 * same normalized geometry (pupilShapes.ts) the pupil itself draws from, so the swatch is a
 * true preview, not a generic stand-in icon. */
function ShapeIcon({ shape, polygon }: { shape: PupilShapeId; polygon?: PupilPolygon | null }) {
  if (shape === 'circle') {
    return (
      <svg viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} className="w-6 h-6">
        <circle cx={ICON_VIEWBOX / 2} cy={ICON_VIEWBOX / 2} r={ICON_R} fill="currentColor" />
      </svg>
    )
  }
  if (shape === 'oval') {
    return (
      <svg viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} className="w-6 h-6">
        <ellipse cx={ICON_VIEWBOX / 2} cy={ICON_VIEWBOX / 2} rx={ICON_R} ry={ICON_R * 0.65} fill="currentColor" />
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
  // 'custom' shapes with no matching library entry (deleted after being selected) fall back
  // to a plain dashed placeholder rather than rendering nothing.
  return (
    <svg viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} className="w-6 h-6">
      <circle cx={ICON_VIEWBOX / 2} cy={ICON_VIEWBOX / 2} r={ICON_R} fill="none" stroke="currentColor" strokeDasharray="3 3" />
    </svg>
  )
}

interface PupilShapePickerProps {
  shape: PupilShapeId
  customShapeId: string | null
  /** 'circle' additionally snaps pupilWidth/pupilHeight equal — handled by the caller, since
   * this component doesn't know about size fields. Every other shape only changes shape/
   * customShapeId. */
  onSelectShape: (shape: PupilShapeId, customShapeId: string | null) => void
}

export function PupilShapePicker({ shape, customShapeId, onSelectShape }: PupilShapePickerProps) {
  const customShapes = useStore((s) => s.project.customPupilShapes)
  const addCustomPupilShape = useStore((s) => s.addCustomPupilShape)
  const deleteCustomPupilShape = useStore((s) => s.deleteCustomPupilShape)
  const checkpoint = useStore((s) => s.checkpoint)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setImportError(null)
    try {
      const text = await file.text()
      const points = parseSvgToPolygon(text)
      const name = file.name.replace(/\.svg$/i, '') || 'Custom Shape'
      checkpoint()
      const id = addCustomPupilShape(name, points)
      onSelectShape('custom', id)
    } catch (err) {
      setImportError(err instanceof SvgShapeImportError ? err.message : 'Could not read that SVG file.')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="studio-label">Pupil Shape</span>
      <div className="grid grid-cols-4 gap-1.5">
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
            <ShapeIcon shape={s.value} polygon={PUPIL_SHAPE_POLYGONS[s.value]} />
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
            <ShapeIcon shape="custom" polygon={cs.points} />
            <span className="truncate max-w-full px-0.5">{cs.name}</span>
            <span
              role="button"
              tabIndex={0}
              title="Delete this custom shape"
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-studio-panel border border-studio-border text-studio-muted hover:text-red-400 hover:border-red-400 flex items-center justify-center text-[9px] leading-none"
              onClick={(e) => {
                e.stopPropagation()
                checkpoint()
                deleteCustomPupilShape(cs.id)
                if (shape === 'custom' && customShapeId === cs.id) onSelectShape('circle', null)
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button
          title="Import a custom SVG shape"
          className="flex flex-col items-center justify-center gap-1 py-1.5 rounded-md border border-dashed border-studio-border bg-studio-panel2 text-studio-muted hover:text-studio-text text-[10px]"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="text-base leading-none">+</span>
          Import SVG
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
        Custom SVGs use only the first &lt;path&gt; element, traced into an outline.
      </p>
    </div>
  )
}
