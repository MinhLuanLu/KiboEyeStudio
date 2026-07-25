import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/state/store'
import { analyzeEyeImage, type AnalysisResult } from '@/lib/analysis/imageAnalyzer'
import { renderFace } from '@/renderer/faceRenderer'
import type { EyeParams } from '@/types'

const ANALYSIS_SIZE = 160
const DISPLAY_MAX = 420

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function ReferenceImportDialog() {
  const open = useStore((s) => s.referenceImportOpen)
  const setOpen = useStore((s) => s.setReferenceImportOpen)
  const eyeBase = useStore((s) => s.project.eyeBase)
  const checkpoint = useStore((s) => s.checkpoint)
  const applyGeneratedEye = useStore((s) => s.applyGeneratedEye)

  const [fileName, setFileName] = useState<string | null>(null)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  const [crop, setCrop] = useState<Rect | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!result || !previewCanvasRef.current) return
    const ctx = previewCanvasRef.current.getContext('2d')
    if (!ctx) return
    const merged: EyeParams = { ...eyeBase, ...result.eyeParams }
    renderFace(ctx, merged, { size: 200, showBezel: false, theme: result.colors })
  }, [result, eyeBase])

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    },
    []
  )

  if (!open) return null

  const reset = () => {
    setFileName(null)
    setImgEl(null)
    setCrop(null)
    setResult(null)
    setStatus(null)
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }

  const handleFile = (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, DISPLAY_MAX / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scale)
      const h = Math.round(img.naturalHeight * scale)
      setDisplaySize({ w, h })
      setCrop({ x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 })
      setImgEl(img)
      setResult(null)
      setStatus(null)
    }
    img.src = url
    setFileName(file.name)
  }

  const relativePointer = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(displaySize.w, e.clientX - rect.left)),
      y: Math.max(0, Math.min(displaySize.h, e.clientY - rect.top))
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!imgEl) return
    const p = relativePointer(e)
    setDragStart(p)
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart) return
    const p = relativePointer(e)
    setCrop({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y)
    })
  }

  const handlePointerUp = () => setDragStart(null)

  const handleAnalyze = () => {
    if (!imgEl || !crop || crop.w < 8 || crop.h < 8) {
      setStatus('Drag a selection box over one eye first.')
      return
    }
    const scale = imgEl.naturalWidth / displaySize.w
    const sx = crop.x * scale
    const sy = crop.y * scale
    const sw = crop.w * scale
    const sh = crop.h * scale

    const canvas = document.createElement('canvas')
    canvas.width = ANALYSIS_SIZE
    canvas.height = ANALYSIS_SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
    const imageData = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
    setResult(analyzeEyeImage(imageData))
    setStatus('Analyzed — compare below, then Apply or re-select and re-analyze.')
  }

  const handleApply = () => {
    if (!result) return
    checkpoint()
    const name = fileName ? fileName.replace(/\.[^.]+$/, '') : 'Imported Reference'
    applyGeneratedEye(result.eyeParams, result.colors, name)
    setOpen(false)
    reset()
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center"
        onClick={() => setOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.15 }}
          className="studio-panel w-[820px] max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-3 border-b border-studio-border">
            <h3 className="text-sm font-semibold">Import Reference Image</h3>
            <button
              className="studio-btn"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            <p className="text-xs text-studio-muted leading-relaxed">
              Choose a photo or drawing of a single eye, then drag a box tightly around it (iris + sclera, lids
              trimmed off). The analyzer estimates iris/pupil/sclera/highlight colors and matching shape sliders —
              it assumes the eye is open and upright, so rotation and eyelid coverage default to neutral for you to
              dial in afterward. Everything it generates stays fully editable.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
                e.target.value = ''
              }}
            />
            <div className="flex items-center gap-2">
              <button className="studio-btn" onClick={() => fileInputRef.current?.click()}>
                Choose Image...
              </button>
              {fileName && <span className="text-xs text-studio-muted">{fileName}</span>}
              {imgEl && (
                <button className="studio-btn ml-auto" onClick={handleAnalyze}>
                  Analyze Selection
                </button>
              )}
            </div>

            {imgEl && (
              <div
                ref={containerRef}
                className="relative select-none cursor-crosshair border border-studio-border rounded-md overflow-hidden self-start"
                style={{ width: displaySize.w, height: displaySize.h }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <img src={imgEl.src} width={displaySize.w} height={displaySize.h} className="block pointer-events-none" alt="Reference" />
                {crop && (
                  <div
                    className="absolute border-2 border-studio-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] pointer-events-none"
                    style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                  />
                )}
              </div>
            )}

            {status && <p className="text-xs text-studio-accent">{status}</p>}

            {result && (
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center gap-1.5">
                  <span className="studio-label">Generated Eye</span>
                  <canvas ref={previewCanvasRef} width={200} height={200} className="rounded-full shadow-floating" />
                </div>
                <div className="flex flex-col gap-1 text-xs font-mono text-studio-muted">
                  <span>sclera {result.colors.sclera}</span>
                  <span>iris {result.colors.iris}</span>
                  <span>pupil {result.colors.pupil}</span>
                  <span>iris size {result.eyeParams.irisSize?.toFixed(0)}</span>
                  <span>pupil size {result.eyeParams.pupilSize?.toFixed(0)}</span>
                </div>
                <button className="studio-btn-primary ml-auto self-center" onClick={handleApply}>
                  Apply to Project
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
