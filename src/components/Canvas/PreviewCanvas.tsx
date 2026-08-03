import { useEffect, useRef } from 'react'
import { useStore, getActiveAnimation, isComboTimelineActive } from '@/state/store'
import { renderFace } from '@/renderer/faceRenderer'
import { sampleAnimationEye, sampleTrack, animationDuration, wrapTime } from '@/engine/interpolate'
import { computeComboTimeline, sampleCombo } from '@/engine/comboPlayback'
import { IdleEngine } from '@/engine/idleEngine'
import {
  clampFps,
  effectiveStickers,
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

const MAX_DT_MS = 100

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const idleEngineRef = useRef(new IdleEngine())
  const rafRef = useRef<number>()
  const lastTimeRef = useRef<number | null>(null)
  const fpsAccumRef = useRef({ frames: 0, elapsed: 0 })
  // Time banked since the last actual tick+draw — lets the loop skip frames to hit the
  // configured Display FPS while still handing the *full* elapsed real time to the tick
  // logic below (so animation speed stays real-time-accurate regardless of draw rate,
  // exactly like the exported firmware: eyesPlayAnimation() reads absolute millis(), so
  // throttling how often it's called doesn't change how fast an animation plays).
  const pendingDtRef = useRef(0)
  // Stickers run on their own continuous real-time clock (drift/spin/pulse/GIF playback) in
  // Design and Idle mode, where there's no scrubbable timeline to speak of — ambient
  // decoration with its own independent speed/fps/loop controls. In Animate mode, though, a
  // sticker's clip (StickerAnimSettings.startTimeMs/endTimeMs) is now a first-class Timeline
  // item with its own visible start/end, so it must scrub, pause, and reverse together with
  // the animation's own playback time — see the `isAnimateScrub` branch below, which feeds the
  // animation's own `t` into drawSticker.ts's visibility/motion math instead of this clock.
  const stickerElapsedRef = useRef(0)
  // Latest effective sticker list, refreshed every drawn frame — read (not recomputed) by the
  // pointer handlers below so canvas-drag hit-testing always matches what's actually on
  // screen without duplicating the project/expression/animation resolution logic above.
  const lastStickersRef = useRef<StickerInstance[]>([])
  const dragRef = useRef<{ id: string; grabOffsetX: number; grabOffsetY: number } | null>(null)

  const display = useStore((s) => s.project.display)

  // Resize the backing canvas + reset the DPR transform whenever the configured display
  // size changes. Kept separate from the rAF loop below so resizing doesn't restart it.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = display.width * dpr
    canvas.height = display.height * dpr
    ctx.scale(dpr, dpr)
  }, [display.width, display.height])

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

      // Throttle to the configured Display FPS. Re-read every rAF (not cached) so a change
      // to the slider takes effect on the very next frame.
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
      // True only while actually viewing/playing the Animate-mode timeline — gates whether
      // stickers scrub with `timeMs` (see stickerElapsedRef's comment) below.
      let isAnimateScrub = false

      if (state.rightTab === 'visual-reference') {
        // While the right panel's Visual Reference tab is open, this canvas shows the VR's
        // own pose/theme instead of the live design/animate/idle state — same full-size,
        // bezel-and-all render everything else gets. Read-only: this never writes into
        // eyeBase/colors, so switching away always resumes exactly whatever Design/Animate/
        // Idle was showing before, undisturbed.
        idleEngineRef.current.reset()
        const vr = state.project.visualReference
        params = leftVisualReferenceParams(vr)
        rightParams = rightVisualReferenceParams(vr)
        theme = leftVisualReferenceColors(vr)
        rightTheme = rightVisualReferenceColors(vr)
        timeMs = 0
      } else if (isComboTimelineActive(state)) {
        // While a Combination is selected on the Combinations tab, this canvas (and the
        // bottom Timeline, via the same shared predicate) shows the combo's own playback
        // instead of Design/Animate/Idle — same reasoning as the Visual Reference branch
        // above: leftTab+selectedComboId pick what's being authored right now, so the shared
        // preview should reflect that regardless of `mode` (mode is left untouched, so
        // switching back to Animations/Expressions resumes exactly where it was).
        //
        // isComboTimelineActive already excludes an actively-*playing* Animate-mode
        // animation, even if leftTab is still (sticky-)showing 'combinations' — e.g. the user
        // built a combo, then hit the Toolbar's own Play button for a regular animation
        // without first clicking back to the Animations tab. Without this, leftTab's
        // stickiness silently swallowed the Toolbar Play button's effect (reported as "no
        // animation play"). Non-playing states (paused/stopped, or plain Design) still yield
        // to the combo preview, since there's nothing actively animating to protect there.
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
            isAnimateScrub = true
          }
        }
      } else if (state.mode === 'design') {
        idleEngineRef.current.reset()
        // Design mode is the only place the live pose can actually diverge per eye (Eye
        // Target: Left/Right) — Animate/Idle keep playing back one shared pose mirrored, as
        // before, since keyframes/idle drift aren't split per eye.
        params = leftEyeParams(state.project)
        rightParams = rightEyeParams(state.project)
        theme = leftEyeColors(state.project)
        rightTheme = rightEyeColors(state.project)
        timeMs = 0
        activeExpression = state.project.expressions.find((e) => e.id === state.selectedExpressionId) ?? null
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
          // Per-eye sampling merges the pose track with the pupils/eyelids/leftEye-or-
          // rightEye tracks (see sampleAnimationEye) — the one wiring change that makes the
          // new independently-timed tracks actually take effect during playback/scrubbing.
          params = sampleAnimationEye(anim, t, 'left')
          rightParams = sampleAnimationEye(anim, t, 'right')
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

      // Animate mode: stickers scrub/pause/reverse with the animation's own playback time,
      // so a sticker clip's start/end (and drift/spin/pulse/GIF-frame motion) reflects
      // exactly what the Timeline shows at the current playhead. Design/Idle mode: no
      // scrubbable timeline exists, so stickers keep running on their own free-running clock.
      const stickerElapsedMs = isAnimateScrub ? timeMs : (stickerElapsedRef.current += dt)
      const stickers = effectiveStickers(state.project, activeExpression, activeAnimation)
      lastStickersRef.current = stickers
      // Auto-mirrors the right eye's eyelid taper (left/right roundness, Center Position X)
      // whenever it isn't intentionally diverged from the left eye's — see
      // renderRightEyeParams()'s own doc comment. Applied once, right here, so every mode branch
      // above (Design/Animate/Idle/Visual Reference/Combo) gets correct mirroring for free.
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

  // Converts a pointer event's client coordinates into display-space coordinates relative to
  // the display's own center — the same coordinate space StickerInstance.x/y are defined in
  // (see faceRenderer.ts's drawLayer(), which translates to (cx, cy) before drawing stickers).
  function toDisplayCoords(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = display.width / rect.width
    const scaleY = display.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX - display.width / 2,
      y: (e.clientY - rect.top) * scaleY - display.height / 2
    }
  }

  // Hit-tests against each sticker's *static* box (instance.x/y/width/height*scale, ignoring
  // live drift/spin/pulse and rotation) — grabbing wherever a sticker is currently animated to
  // would make the drag target visually "run away" as you try to grab it; editing the base
  // position and watching the live preview separately is the more predictable interaction.
  // Front-layer stickers are tested first so a front sticker is grabbed before whatever sits
  // behind it at the same spot, matching the Sticker Manager's "front-layer-first" list order.
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

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = toDisplayCoords(e)
    const hit = hitTestSticker(x, y)
    if (!hit) return
    e.currentTarget.setPointerCapture(e.pointerId)
    useStore.getState().checkpoint()
    useStore.getState().selectSticker(hit.id)
    dragRef.current = { id: hit.id, grabOffsetX: x - hit.x, grabOffsetY: y - hit.y }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = toDisplayCoords(e)
    useStore.getState().updateSticker(drag.id, { x: x - drag.grabOffsetX, y: y - drag.grabOffsetY })
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  return (
    <div className="flex items-center justify-center w-full h-full">
      <canvas
        ref={canvasRef}
        style={{ width: display.width, height: display.height, borderRadius }}
        className="shadow-floating"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}
