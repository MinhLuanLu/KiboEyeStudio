import { useEffect, useRef } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import { renderFace } from '@/renderer/faceRenderer'
import { sampleAnimation, animationDuration, wrapTime } from '@/engine/interpolate'
import { IdleEngine } from '@/engine/idleEngine'
import type { EyeParams } from '@/types'

const MAX_DT_MS = 100

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const idleEngineRef = useRef(new IdleEngine())
  const rafRef = useRef<number>()
  const lastTimeRef = useRef<number | null>(null)
  const fpsAccumRef = useRef({ frames: 0, elapsed: 0 })

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
      const dt = Math.min(MAX_DT_MS, now - lastTimeRef.current)
      lastTimeRef.current = now

      const state = useStore.getState()
      let params: EyeParams = state.project.eyeBase
      let frameIndex = 0
      let timeMs = state.playbackTimeMs

      if (state.mode === 'design') {
        idleEngineRef.current.reset()
        params = state.project.eyeBase
        timeMs = 0
      } else if (state.mode === 'animate') {
        const anim = getActiveAnimation()
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
          const sample = sampleAnimation(anim, t)
          params = sample.params
          frameIndex = sample.segmentIndex
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
        timeMs = 0
      }

      renderFace(ctx!, params, { ...state.project.display, theme: state.project.colors })

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

  return (
    <div className="flex items-center justify-center w-full h-full">
      <canvas ref={canvasRef} style={{ width: display.width, height: display.height, borderRadius }} className="shadow-floating" />
    </div>
  )
}
