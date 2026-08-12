import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, getActiveAnimation, isComboTimelineActive } from '@/state/store'
import { renderFace } from '@/renderer/faceRenderer'
import { sampleAnimationEye, sampleAnimationColors, sampleTrack, animationDuration, wrapTime } from '@/engine/interpolate'
import { computeComboTimeline, sampleCombo } from '@/engine/comboPlayback'
import { IdleEngine } from '@/engine/idleEngine'
import {
  clampFps,
  effectiveStickers,
  EYE_PARAM_RANGES,
  leftEyeColors,
  leftEyeParams,
  leftVisualReferenceColors,
  leftVisualReferenceParams,
  renderRightEyeParams,
  rightEyeColors,
  rightEyeParams,
  rightVisualReferenceColors,
  rightVisualReferenceParams
} from '@/types'
import type { Animation, EyeColors, EyeParams, Expression, StickerInstance } from '@/types'
import { CanvasToolbar } from './CanvasToolbar'
import { SelectionOverlay, type Selection } from './SelectionOverlay'
import { centerView, clamp, eyeHitBox, fitToView, pointInBox, screenDeltaToEyePos, snap, zoomAtPoint } from './canvasMath'

const MAX_DT_MS = 100
const EYE_RANGE = { x: EYE_PARAM_RANGES.eyePosX, y: EYE_PARAM_RANGES.eyePosY }

type Drag =
  | { kind: 'sticker'; id: string; grabOffsetX: number; grabOffsetY: number }
  | { kind: 'eye'; side: 'left' | 'right'; startX: number; startY: number; startEyePosX: number; startEyePosY: number }
  | { kind: 'pan'; startClientX: number; startClientY: number; startPanX: number; startPanY: number; moved: boolean }

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const idleEngineRef = useRef(new IdleEngine())
  const rafRef = useRef<number>()
  const lastTimeRef = useRef<number | null>(null)
  const fpsAccumRef = useRef({ frames: 0, elapsed: 0 })
  const pendingDtRef = useRef(0)
  const stickerElapsedRef = useRef(0)
  // Refreshed every drawn frame so the pointer/keyboard handlers hit-test against exactly what's on
  // screen without re-deriving mode/expression/animation resolution.
  const lastStickersRef = useRef<StickerInstance[]>([])
  const lastEyeParamsRef = useRef<{ left: EyeParams; right: EyeParams } | null>(null)
  const lastCanEditEyesRef = useRef(false)
  const dragRef = useRef<Drag | null>(null)
  const spaceDownRef = useRef(false)

  const display = useStore((s) => s.project.display)

  // View-only editor state (never written to the project → cannot affect export/coords).
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [selected, setSelected] = useState<Selection>(null)
  const [snapOn, setSnapOn] = useState(false)
  const [gridSize, setGridSize] = useState(5)

  // Resize the backing canvas + reset the DPR transform whenever the configured display size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = display.width * dpr
    canvas.height = display.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [display.width, display.height])

  // Centre the display in the viewport on first mount and whenever the display size changes.
  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    setView(centerView(display.width, display.height, vp.clientWidth, vp.clientHeight, 1))
  }, [display.width, display.height])

  // Native (non-passive) wheel listener so Ctrl+wheel can preventDefault the browser page-zoom.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      setView((v) => zoomAtPoint(v.zoom, v.pan, cursor, factor))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  // Track Space (held = pan) so a drag on an element region can still pan when Space is down.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function loop(now: number) {
      if (lastTimeRef.current === null) lastTimeRef.current = now
      const rawDt = Math.min(MAX_DT_MS, now - lastTimeRef.current)
      lastTimeRef.current = now

      const state = useStore.getState()
      const targetFps = clampFps(state.project.display.fps)
      const frameInterval = 1000 / targetFps
      pendingDtRef.current += rawDt
      if (pendingDtRef.current < frameInterval) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      const dt = pendingDtRef.current
      pendingDtRef.current = 0

      let params: EyeParams = state.project.eyeBase
      let rightParams: EyeParams = params
      let theme: EyeColors = state.project.colors
      let rightTheme: EyeColors = theme
      let frameIndex = 0
      let timeMs = state.playbackTimeMs
      let activeExpression: Expression | null = null
      let activeAnimation: Animation | null = null
      let isAnimateScrub = false
      // Eyes are only directly editable where they come from the design pose (not animation sampling).
      let canEditEyes = false

      if (state.rightTab === 'visual-reference') {
        idleEngineRef.current.reset()
        const vr = state.project.visualReference
        params = leftVisualReferenceParams(vr)
        rightParams = rightVisualReferenceParams(vr)
        theme = leftVisualReferenceColors(vr)
        rightTheme = rightVisualReferenceColors(vr)
        timeMs = 0
      } else if (isComboTimelineActive(state)) {
        idleEngineRef.current.reset()
        const combo = state.project.animationCombos.find((c) => c.id === state.selectedComboId) ?? null
        if (combo) {
          const timeline = computeComboTimeline(combo, state.project.animations)
          let t = state.comboPreviewTimeMs
          if (state.comboPreviewPlaying && timeline.total > 0) {
            t += dt * (state.project.timing.animationSpeed / 100)
            if (t >= timeline.total) {
              if (state.comboPreviewLoop) t %= timeline.total
              else {
                t = timeline.total
                state.setComboPreviewPlaying(false)
              }
            }
            state.setComboPreviewTimeMs(t)
          }
          const sample = sampleCombo(timeline, t, combo.loop)
          if (sample) {
            params = sample.params
            rightParams = sample.rightParams
            activeAnimation = sample.anim
            timeMs = sample.animationTimeMs
            // Colour must follow the CURRENT CLIP'S ANIMATION (its own per-keyframe palette), exactly
            // like Animate mode below — not the live project.colors, which the Colors/Expression
            // editor mutates. Without this the combo preview left `theme` at project.colors, so
            // editing an expression's colour bled into the whole combination. Falls back to the base
            // palette for any keyframe with no colour of its own, matching Animate mode.
            theme = sampleAnimationColors(sample.anim, sample.animationTimeMs, state.project.colors)
            rightTheme = theme
            isAnimateScrub = true
          }
        }
      } else if (state.mode === 'design') {
        idleEngineRef.current.reset()
        params = leftEyeParams(state.project)
        rightParams = rightEyeParams(state.project)
        theme = leftEyeColors(state.project)
        rightTheme = rightEyeColors(state.project)
        timeMs = 0
        canEditEyes = true
        activeExpression = state.project.expressions.find((e) => e.id === state.selectedExpressionId) ?? null
        if (state.eyelidPreviewClose > 0) {
          const c = state.eyelidPreviewClose
          const close = (p: EyeParams): EyeParams => ({
            ...p,
            upperEyelid: p.upperEyelid + (100 - p.upperEyelid) * c,
            lowerEyelid: p.lowerEyelid + (100 - p.lowerEyelid) * c
          })
          params = close(params)
          rightParams = close(rightParams)
        }
      } else if (state.mode === 'animate') {
        isAnimateScrub = true
        const anim = getActiveAnimation()
        activeAnimation = anim ?? null
        if (anim && anim.keyframes.length > 0) {
          let t = state.playbackTimeMs
          if (state.playbackState === 'playing') {
            t += dt * (state.project.timing.animationSpeed / 100)
            const total = animationDuration(anim)
            if (!anim.loop && t >= total) {
              t = total
              state.tickPlayback(t, false)
            } else {
              t = wrapTime(t, anim)
              state.tickPlayback(t, true)
            }
          }
          params = sampleAnimationEye(anim, t, 'left')
          rightParams = sampleAnimationEye(anim, t, 'right')
          theme = sampleAnimationColors(anim, t, state.project.colors)
          rightTheme = theme
          frameIndex = sampleTrack(anim.keyframes, anim.loop, anim.durationMs, t)?.segmentIndex ?? 0
          timeMs = t
        }
      } else {
        params = idleEngineRef.current.tick(
          dt,
          state.project.eyeBase,
          state.project.personality,
          state.project.timing.breathingAmount,
          state.project.timing.blinkSpeed
        )
        rightParams = params
        timeMs = 0
      }

      const stickerElapsedMs = isAnimateScrub ? timeMs : (stickerElapsedRef.current += dt)
      const stickers = effectiveStickers(state.project, activeExpression, activeAnimation)
      lastStickersRef.current = stickers
      lastEyeParamsRef.current = { left: params, right: rightParams }
      lastCanEditEyesRef.current = canEditEyes

      renderFace(ctx!, params, {
        ...state.project.display,
        theme,
        rightParams: renderRightEyeParams(params, rightParams),
        rightTheme,
        customShapes: state.project.customPupilShapes,
        customEyeShapes: state.project.customEyeShapes,
        stickers,
        stickerAssets: state.project.stickerAssets,
        stickerElapsedMs,
        firmwareSim: state.esp32PreviewMode
      })

      const fpsAccum = fpsAccumRef.current
      fpsAccum.frames += 1
      fpsAccum.elapsed += dt
      if (fpsAccum.elapsed >= 400) {
        const fps = Math.round((fpsAccum.frames * 1000) / fpsAccum.elapsed)
        useStore.getState().setDevStats({ fps, frame: frameIndex, timeMs })
        fpsAccum.frames = 0
        fpsAccum.elapsed = 0
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTimeRef.current = null
    }
  }, [])

  const borderRadius = display.shape === 'circle' ? '50%' : display.shape === 'rounded' ? `${display.cornerRadius}px` : '0px'

  // Client → display-centre coords (origin at display centre), the space StickerInstance.x/y and the
  // eye centres live in. Reads the canvas's live boundingRect, which already includes the stage's
  // zoom+pan transform, so the result is REAL display px at any zoom/pan (never zoomed-canvas px).
  function toDisplayCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scaleX = display.width / rect.width
    const scaleY = display.height / rect.height
    return {
      x: (clientX - rect.left) * scaleX - display.width / 2,
      y: (clientY - rect.top) * scaleY - display.height / 2
    }
  }

  function hitTestSticker(x: number, y: number): StickerInstance | null {
    const candidates = [...lastStickersRef.current].sort((a, b) => (a.layer === b.layer ? 0 : a.layer === 'front' ? -1 : 1))
    for (const s of candidates) {
      if (!s.visible || s.locked) continue
      const hw = (s.width / 2) * (s.scaleX / 100)
      const hh = (s.height / 2) * (s.scaleY / 100)
      if (x >= s.x - hw && x <= s.x + hw && y >= s.y - hh && y <= s.y + hh) return s
    }
    return null
  }

  function hitTestEye(x: number, y: number): 'left' | 'right' | null {
    if (!lastCanEditEyesRef.current || !lastEyeParamsRef.current) return null
    const { left, right } = lastEyeParamsRef.current
    if (pointInBox(x, y, eyeHitBox(left, 'left'))) return 'left'
    if (pointInBox(x, y, eyeHitBox(right, 'right'))) return 'right'
    return null
  }

  function beginPan(e: React.PointerEvent, clientX: number, clientY: number) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'pan', startClientX: clientX, startClientY: clientY, startPanX: view.pan.x, startPanY: view.pan.y, moved: false }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    viewportRef.current?.focus()
    // Middle-mouse or Space = always pan.
    if (e.button === 1 || spaceDownRef.current) {
      beginPan(e, e.clientX, e.clientY)
      return
    }
    if (e.button !== 0) return
    const { x, y } = toDisplayCoords(e.clientX, e.clientY)
    const sticker = hitTestSticker(x, y)
    if (sticker) {
      e.currentTarget.setPointerCapture(e.pointerId)
      const store = useStore.getState()
      store.checkpoint()
      store.selectSticker(sticker.id)
      store.setRightTab('stickers')
      setSelected({ kind: 'sticker', id: sticker.id })
      dragRef.current = { kind: 'sticker', id: sticker.id, grabOffsetX: x - sticker.x, grabOffsetY: y - sticker.y }
      return
    }
    const eye = hitTestEye(x, y)
    if (eye && lastEyeParamsRef.current) {
      e.currentTarget.setPointerCapture(e.pointerId)
      const store = useStore.getState()
      store.checkpoint()
      store.setEyeTarget(eye)
      store.selectSticker(null)
      setSelected({ kind: 'eye', side: eye })
      const p = lastEyeParamsRef.current[eye]
      dragRef.current = { kind: 'eye', side: eye, startX: x, startY: y, startEyePosX: p.eyePosX, startEyePosY: p.eyePosY }
      return
    }
    // Empty space → pan (and, if it turns out to be a click, deselect on pointer-up).
    beginPan(e, e.clientX, e.clientY)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.startClientX
      const dy = e.clientY - drag.startClientY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true
      setView((v) => ({ ...v, pan: { x: drag.startPanX + dx, y: drag.startPanY + dy } }))
      return
    }
    const { x, y } = toDisplayCoords(e.clientX, e.clientY)
    const store = useStore.getState()
    if (drag.kind === 'sticker') {
      const nx = x - drag.grabOffsetX
      const ny = y - drag.grabOffsetY
      store.updateSticker(drag.id, { x: snapOn ? snap(nx, gridSize) : nx, y: snapOn ? snap(ny, gridSize) : ny })
    } else {
      let pos = screenDeltaToEyePos(drag.side, { eyePosX: drag.startEyePosX, eyePosY: drag.startEyePosY }, x - drag.startX, y - drag.startY, EYE_RANGE)
      if (snapOn) {
        pos = {
          eyePosX: clamp(snap(pos.eyePosX, gridSize), EYE_RANGE.x[0], EYE_RANGE.x[1]),
          eyePosY: clamp(snap(pos.eyePosY, gridSize), EYE_RANGE.y[0], EYE_RANGE.y[1])
        }
      }
      store.setEyeParam('eyePosX', pos.eyePosX)
      store.setEyeParam('eyePosY', pos.eyePosY)
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag) e.currentTarget.releasePointerCapture(e.pointerId)
    // A click on empty space (pan that never moved) clears the selection.
    if (drag?.kind === 'pan' && !drag.moved) {
      setSelected(null)
      useStore.getState().selectSticker(null)
    }
    dragRef.current = null
  }

  // Arrow-key nudge of the selected element (Shift = 10 px). Directions are SCREEN-space; the eye
  // helper mirrors X for the right eye so the element always moves the way the arrow points.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!selected) return
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }
    const dir = map[e.key]
    if (!dir) return
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    const dx = dir[0] * step
    const dy = dir[1] * step
    const store = useStore.getState()
    if (!e.repeat) store.checkpoint()
    if (selected.kind === 'sticker') {
      const s = lastStickersRef.current.find((k) => k.id === selected.id)
      if (!s) return
      const nx = s.x + dx
      const ny = s.y + dy
      store.updateSticker(selected.id, { x: snapOn ? snap(nx, gridSize) : nx, y: snapOn ? snap(ny, gridSize) : ny })
    } else if (lastEyeParamsRef.current) {
      const p = lastEyeParamsRef.current[selected.side]
      let pos = screenDeltaToEyePos(selected.side, { eyePosX: p.eyePosX, eyePosY: p.eyePosY }, dx, dy, EYE_RANGE)
      if (snapOn) {
        pos = {
          eyePosX: clamp(snap(pos.eyePosX, gridSize), EYE_RANGE.x[0], EYE_RANGE.x[1]),
          eyePosY: clamp(snap(pos.eyePosY, gridSize), EYE_RANGE.y[0], EYE_RANGE.y[1])
        }
      }
      store.setEyeTarget(selected.side)
      store.setEyeParam('eyePosX', pos.eyePosX)
      store.setEyeParam('eyePosY', pos.eyePosY)
    }
  }

  const zoomButton = (factor: number) => {
    const vp = viewportRef.current
    const cursor = vp ? { x: vp.clientWidth / 2, y: vp.clientHeight / 2 } : { x: 0, y: 0 }
    setView((v) => zoomAtPoint(v.zoom, v.pan, cursor, factor))
  }
  const resetView = () => {
    const vp = viewportRef.current
    if (vp) setView(centerView(display.width, display.height, vp.clientWidth, vp.clientHeight, 1))
  }
  const fitView = () => {
    const vp = viewportRef.current
    if (vp) setView(fitToView(display.width, display.height, vp.clientWidth, vp.clientHeight))
  }

  const panning = dragRef.current?.kind === 'pan'

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      className={`relative w-full h-full overflow-hidden bg-studio-bg outline-none ${panning ? 'cursor-grabbing' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <CanvasToolbar
        zoom={view.zoom}
        onZoomIn={() => zoomButton(1.2)}
        onZoomOut={() => zoomButton(1 / 1.2)}
        onReset={resetView}
        onFit={fitView}
        snapOn={snapOn}
        gridSize={gridSize}
        onToggleSnap={() => setSnapOn((v) => !v)}
        onGridSize={setGridSize}
      />
      {/* Transformed stage: the canvas + overlay scale/translate together, so the render pipeline and
          all element coordinates stay in native display pixels (zoom is view-only). */}
      <div
        className="absolute top-0 left-0"
        style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}
      >
        <div className="relative" style={{ width: display.width, height: display.height }}>
          <canvas
            ref={canvasRef}
            style={{ width: display.width, height: display.height, borderRadius, imageRendering: 'pixelated' }}
            className="shadow-floating block"
          />
          <SelectionOverlay selected={selected} showGrid={snapOn} gridSize={gridSize} />
        </div>
      </div>
    </div>
  )
}
