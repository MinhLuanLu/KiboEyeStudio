import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, transitionNameMismatch, validateTransitionName } from '@/state/store'
import { renderFace } from '@/renderer/faceRenderer'
import { DEFAULT_TRANSITION_INTERPOLATION, clampFps, effectiveStickers, renderRightEyeParams } from '@/types'
import type { ClipTransition, EasingType, TransitionClipRef, TransitionInterpolation } from '@/types'
import {
  TRANSITION_PROPERTY_GROUPS,
  TransitionPlayer,
  settingsOfTransition,
  simulateTransitions,
  transitionSettingsOf,
  type ClipRef,
  type PlayerFrame,
  type TransitionSettings
} from '@/engine/transitionPlayback'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Slider } from '@/components/ui/Slider'
import { EasingPicker } from '@/components/Timeline/EasingPicker'

const EASING_CPP: Record<EasingType, string> = {
  linear: 'EYE_EASE_LINEAR',
  easeIn: 'EYE_EASE_IN',
  easeOut: 'EYE_EASE_OUT',
  easeInOut: 'EYE_EASE_INOUT',
  bounce: 'EYE_EASE_BOUNCE',
  elastic: 'EYE_EASE_ELASTIC',
  bezier: 'EYE_EASE_BEZIER'
}

const MAX_DT_MS = 100
const SPEEDS = [1, 0.5, 0.25]

// The draft (unsaved) configuration survives closing/reopening the panel within a session.
const session = {
  from: '',
  to: '',
  fromLoop: true,
  toLoop: true,
  triggerAtMs: 1000,
  holdAfterMs: 1500,
  speed: 1,
  firmwareSim: true,
  playAsLoop: false,
  interp: { ...DEFAULT_TRANSITION_INTERPOLATION } as TransitionInterpolation
}
// Preview requests (requestTransitionPreview) already acted on, so reopening doesn't replay them.
let handledPreviewNonce = 0

/** Select keys: `a:<animationId>` or `c:<comboId>`. */
function refFor(key: string, loop: boolean): ClipRef | null {
  if (key.startsWith('a:')) return { kind: 'animation', id: key.slice(2) }
  if (key.startsWith('c:')) return { kind: 'combo', id: key.slice(2), loop }
  return null
}

function transitionRefOf(key: string, loop: boolean): TransitionClipRef {
  const combo = key.startsWith('c:')
  return { kind: combo ? 'combo' : 'animation', id: key.slice(2), loop: combo && loop }
}

function keyOf(ref: TransitionClipRef): string {
  return `${ref.kind === 'combo' ? 'c' : 'a'}:${ref.id}`
}

function sameRef(a: ClipRef | null, b: ClipRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id
}

interface Readout {
  clockMs: number
  showing: 'from' | 'to'
  transitioning: boolean
  t: number
  eased: number
  clipMs: number
}

type Mode = 'scripted' | 'live'

type KindFilter = 'all' | 'combo' | 'animation'

/** One From/To selector: a kind filter (with counts, so an empty category is obvious) plus the
 * searchable list, and the Combo(x, loop) flag when a combination is picked. */
function ClipPicker({
  label,
  items,
  value,
  onChange,
  loop,
  onLoopChange,
  note
}: {
  label: string
  items: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
  loop: boolean
  /** Only the To picker passes this: the checkbox appears only when a combination is picked. */
  onLoopChange?: (loop: boolean) => void
  /** How the picked clip plays when there's no checkbox (e.g. "loops (its Loop setting)"). */
  note?: string
}) {
  const [kind, setKind] = useState<KindFilter>('all')
  const comboCount = items.filter((i) => i.id.startsWith('c:')).length
  const animCount = items.length - comboCount
  const shown = kind === 'all' ? items : items.filter((i) => i.id.startsWith(kind === 'combo' ? 'c:' : 'a:'))
  const selectedName = items.find((i) => i.id === value)?.name ?? (value ? 'Missing — choose another clip' : 'Choose…')
  const chips: { value: KindFilter; text: string }[] = [
    { value: 'all', text: `All ${items.length}` },
    { value: 'combo', text: `Combinations ${comboCount}` },
    { value: 'animation', text: `Animations ${animCount}` }
  ]

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-studio-muted w-10">{label}</span>
        <div className="flex items-center bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {chips.map((c) => (
            <button key={c.value} className={`studio-tab text-[11px] ${kind === c.value ? 'studio-tab-active' : ''}`} onClick={() => setKind(c.value)}>
              {c.text}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-12">
        <div className="flex-1 min-w-0">
          <SearchableSelect
            items={shown}
            value={value}
            onChange={onChange}
            placeholder={selectedName}
            searchPlaceholder={kind === 'combo' ? 'Search combinations…' : kind === 'animation' ? 'Search animations…' : 'Search…'}
            emptyLabel={kind === 'combo' && comboCount === 0 ? 'This project has no combinations yet — create one in the Combinations tab' : 'No results found'}
            menuWidth={360}
            align="left"
            buttonClassName="w-full bg-studio-panel2 border border-studio-border rounded px-2 py-1 text-sm text-studio-text"
          />
        </div>
        {onLoopChange && value.startsWith('c:') ? (
          <label
            className="text-[11px] text-studio-muted flex items-center gap-1 whitespace-nowrap"
            title="Loops only this To combination after the blend — the blend itself plays once. Exported as Combo(x, loop)."
          >
            <input type="checkbox" checked={loop} onChange={(e) => onLoopChange(e.target.checked)} />
            Loop combination
          </label>
        ) : (
          note && <span className="text-[11px] text-studio-muted whitespace-nowrap">{note}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Transition Simulator — previews a clip switch exactly as the exported eyes.h player performs it
 * (engine/transitionPlayback.ts mirrors PlayAnimation()/Combo()/PlayTransition()/UpdateEyes()).
 *
 * Works on either a DRAFT (duration/easing are the project default, SetTransition()) or a SAVED
 * transition selected in the Transitions panel, whose every edit is written straight back to the
 * project like combination edits are. "Create Transition" saves the current configuration.
 *
 * Two ways to test: Scripted (play From, switch at a chosen moment, scrub/replay) and Live (switch
 * whenever you press Switch — like an accelerometer event — including mid-blend; Shake test fires
 * switches at random intervals).
 */
export function TransitionSimulatorPanel({ onClose }: { onClose: () => void }) {
  const animations = useStore((s) => s.project.animations)
  const combos = useStore((s) => s.project.animationCombos)
  const transitions = useStore((s) => s.project.transitions)
  const timing = useStore((s) => s.project.timing)
  const display = useStore((s) => s.project.display)
  const selectedTransitionId = useStore((s) => s.selectedTransitionId)
  const previewNonce = useStore((s) => s.transitionPreviewNonce)
  const setTiming = useStore((s) => s.setTiming)
  const checkpoint = useStore((s) => s.checkpoint)
  const addTransition = useStore((s) => s.addTransition)
  const updateTransition = useStore((s) => s.updateTransition)
  const selectTransition = useStore((s) => s.selectTransition)

  const editing = transitions.find((t) => t.id === selectedTransitionId) ?? null

  const items = useMemo(
    () => [
      ...combos.map((c) => ({ id: `c:${c.id}`, name: `Combination · ${c.name}` })),
      ...animations.map((a) => ({ id: `a:${a.id}`, name: `Animation · ${a.name}` }))
    ],
    [animations, combos]
  )
  const nameOf = (key: string) => items.find((i) => i.id === key)?.name.replace(/^(Combination|Animation) · /, '') ?? '—'

  // ---- Draft state (used when no saved transition is selected) ----
  const [draftFrom, setDraftFrom] = useState(session.from)
  const [draftTo, setDraftTo] = useState(session.to)
  const [draftToLoop, setDraftToLoop] = useState(session.toLoop)
  const [draftTriggerAtMs, setDraftTriggerAtMs] = useState(session.triggerAtMs)
  const [draftHoldAfterMs, setDraftHoldAfterMs] = useState(session.holdAfterMs)
  const [draftInterp, setDraftInterp] = useState<TransitionInterpolation>(session.interp)

  const [speed, setSpeed] = useState(session.speed)
  const [firmwareSim, setFirmwareSim] = useState(session.firmwareSim)
  // Preview keeps running after the hold, so the To clip plays on as it would on the device:
  // a To combination with "Loop combination" checked keeps looping, a play-once clip holds.
  const [playAsLoop, setPlayAsLoop] = useState(session.playAsLoop)
  const [compareHardCut, setCompareHardCut] = useState(false)
  const [mode, setMode] = useState<Mode>('scripted')
  const [playing, setPlaying] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [readout, setReadout] = useState<Readout>({ clockMs: 0, showing: 'from', transitioning: false, t: 1, eased: 1, clipMs: 0 })
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    Object.assign(session, {
      from: draftFrom,
      to: draftTo,
      toLoop: draftToLoop,
      triggerAtMs: draftTriggerAtMs,
      holdAfterMs: draftHoldAfterMs,
      speed,
      firmwareSim,
      playAsLoop,
      interp: draftInterp
    })
  }, [draftFrom, draftTo, draftToLoop, draftTriggerAtMs, draftHoldAfterMs, speed, firmwareSim, playAsLoop, draftInterp])

  // Default/repair the draft selection when the library changes (deleted items, first open).
  useEffect(() => {
    const has = (k: string) => items.some((i) => i.id === k)
    if (!has(draftFrom)) setDraftFrom(items[0]?.id ?? '')
    if (!has(draftTo)) setDraftTo(items.find((i) => i.id !== (has(draftFrom) ? draftFrom : items[0]?.id))?.id ?? items[0]?.id ?? '')
  }, [items, draftFrom, draftTo])

  // ---- Resolved configuration: the saved transition being edited, or the draft ----
  const from = editing ? keyOf(editing.source) : draftFrom
  const to = editing ? keyOf(editing.target) : draftTo
  const toLoop = editing ? editing.target.loop : draftToLoop
  const triggerAtMs = editing ? editing.previewSwitchAfterMs : draftTriggerAtMs
  const holdAfterMs = editing ? editing.previewHoldMs : draftHoldAfterMs
  const settings: TransitionSettings = editing ? settingsOfTransition(editing) : { ...transitionSettingsOf({ timing }), interpolation: draftInterp }
  const interp = settings.interpolation ?? DEFAULT_TRANSITION_INTERPOLATION
  const effectiveMs = compareHardCut ? 0 : settings.durationMs
  const totalMs = triggerAtMs + effectiveMs + holdAfterMs

  const edit = (partial: Partial<Omit<ClipTransition, 'id'>>, withCheckpoint = true) => {
    if (!editing) return
    if (withCheckpoint) checkpoint()
    updateTransition(editing.id, partial)
  }
  // Loop belongs to the To combination only. From just previews the way that clip is authored
  // (a combination's own saved Loop), because on the device the source is whatever is already
  // playing. Picking a To combination starts with its saved Loop (what Combo(x) does).
  const comboLoopOf = (k: string) => combos.find((c) => `c:${c.id}` === k)?.loop ?? false
  const animLoopOf = (k: string) => animations.find((a) => `a:${a.id}` === k)?.loop ?? false
  const fromLoop = comboLoopOf(from)
  const setFrom = (k: string) => {
    if (editing) return edit({ source: transitionRefOf(k, comboLoopOf(k)) })
    setDraftFrom(k)
  }
  const setTo = (k: string) => {
    if (editing) return edit({ target: transitionRefOf(k, comboLoopOf(k)) })
    setDraftTo(k)
    setDraftToLoop(comboLoopOf(k))
  }
  const setToLoop = (v: boolean) => (editing ? edit({ target: { ...editing.target, loop: v } }) : setDraftToLoop(v))
  const setTriggerAtMs = (v: number) => (editing ? edit({ previewSwitchAfterMs: v }, false) : setDraftTriggerAtMs(v))
  const setHoldAfterMs = (v: number) => (editing ? edit({ previewHoldMs: v }, false) : setDraftHoldAfterMs(v))
  const setDuration = (v: number) => (editing ? edit({ durationMs: v }, false) : setTiming('clipTransitionMs', v))
  const setEasing = (easing: EasingType, bezier?: [number, number, number, number]) => {
    checkpoint()
    if (editing) updateTransition(editing.id, bezier ? { easing, bezier } : { easing })
    else {
      setTiming('clipTransitionEasing', easing)
      if (bezier) setTiming('clipTransitionBezier', bezier)
    }
  }
  const setInterp = (patch: Partial<TransitionInterpolation>, withCheckpoint = true) =>
    editing ? edit({ interpolation: { ...editing.interpolation, ...patch } }, withCheckpoint) : setDraftInterp((i) => ({ ...i, ...patch }))

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef(0)
  const playingRef = useRef(false)
  const livePlayerRef = useRef<TransitionPlayer | null>(null)
  const liveOnTargetRef = useRef(false)
  const shakeRef = useRef({ on: false, nextAt: 0 })
  const makeCfg = () => ({
    from: refFor(from, fromLoop),
    to: refFor(to, toLoop),
    triggerAtMs,
    holdAfterMs,
    speed,
    firmwareSim,
    playAsLoop,
    mode,
    settings: compareHardCut ? { ...settings, durationMs: 0 } : settings
  })
  const cfgRef = useRef(makeCfg())
  cfgRef.current = makeCfg()

  const effectiveSettings = (): TransitionSettings => cfgRef.current.settings

  const setPlayingBoth = (v: boolean) => {
    playingRef.current = v
    setPlaying(v)
  }

  function stopShake() {
    shakeRef.current.on = false
    setShaking(false)
  }

  const startScripted = () => {
    stopShake()
    livePlayerRef.current = null
    setMode('scripted')
    cfgRef.current.mode = 'scripted'
    clockRef.current = 0
    setPlayingBoth(true)
  }

  const startLive = () => {
    const { from: fromRef } = cfgRef.current
    if (!fromRef) return
    const player = new TransitionPlayer(useStore.getState().project)
    player.play(fromRef, 0, effectiveSettings())
    livePlayerRef.current = player
    liveOnTargetRef.current = false
    clockRef.current = 0
    setMode('live')
    cfgRef.current.mode = 'live'
    setPlayingBoth(true)
  }

  const switchNow = () => {
    const player = livePlayerRef.current
    const { from: fromRef, to: toRef } = cfgRef.current
    if (!player || !fromRef || !toRef) return
    const next = liveOnTargetRef.current ? fromRef : toRef
    player.update(clockRef.current)
    if (player.play(next, clockRef.current, effectiveSettings())) liveOnTargetRef.current = !liveOnTargetRef.current
    if (!playingRef.current) setPlayingBoth(true)
  }

  const toggleShake = () => {
    if (shakeRef.current.on) return stopShake()
    if (mode !== 'live' || !livePlayerRef.current) startLive()
    shakeRef.current = { on: true, nextAt: clockRef.current + 400 }
    setShaking(true)
  }

  const swap = () => {
    if (editing) {
      const newTarget = keyOf(editing.source)
      edit({ source: transitionRefOf(keyOf(editing.target), comboLoopOf(keyOf(editing.target))), target: transitionRefOf(newTarget, comboLoopOf(newTarget)) })
      return
    }
    setDraftFrom(draftTo)
    setDraftTo(draftFrom)
    setDraftToLoop(comboLoopOf(draftFrom))
  }

  // "▶ Preview" in the Transitions panel.
  useEffect(() => {
    if (previewNonce > handledPreviewNonce) {
      handledPreviewNonce = previewNonce
      startScripted()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewNonce])

  // Selecting another transition cancels a half-typed name.
  useEffect(() => setCreating(false), [selectedTransitionId])

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = display.width * dpr
    canvas.height = display.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [display.width, display.height])

  // Render loop — paced to the project's Display FPS like the main preview, so frame stepping
  // matches what the panel shows at EYE_TARGET_FPS.
  useEffect(() => {
    let raf = 0
    let last: number | null = null
    let pending = 0
    let lastReadoutAt = 0

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = last === null ? 0 : Math.min(MAX_DT_MS, now - last)
      last = now
      const state = useStore.getState()
      const project = state.project
      pending += dt
      if (pending < 1000 / clampFps(project.display.fps)) return
      const step = pending
      pending = 0

      const cfg = cfgRef.current
      const s = effectiveSettings()
      let frame: PlayerFrame | null = null
      let showing: 'from' | 'to' = 'from'

      if (cfg.mode === 'scripted') {
        const total = cfg.triggerAtMs + s.durationMs + cfg.holdAfterMs
        if (playingRef.current) {
          clockRef.current += step * cfg.speed
          // Play as loop: keep going past the hold so the To clip plays on (looping only if its
          // "Loop combination" is checked); otherwise stop at the end like before.
          if (clockRef.current >= total && !cfg.playAsLoop) {
            clockRef.current = total
            playingRef.current = false
            setPlaying(false)
          }
        }
        const events = []
        if (cfg.from) events.push({ atMs: 0, ref: cfg.from })
        if (cfg.to) events.push({ atMs: cfg.triggerAtMs, ref: cfg.to })
        frame = simulateTransitions(project, events, clockRef.current, s)
        showing = clockRef.current >= cfg.triggerAtMs ? 'to' : 'from'
        if (playheadRef.current) playheadRef.current.style.left = `${total > 0 ? Math.min(1, clockRef.current / total) * 100 : 0}%`
      } else if (livePlayerRef.current) {
        if (playingRef.current) clockRef.current += step * cfg.speed
        const shake = shakeRef.current
        if (shake.on && clockRef.current >= shake.nextAt) {
          switchNow()
          shake.nextAt = clockRef.current + 150 + Math.random() * 750
        }
        frame = livePlayerRef.current.update(clockRef.current)
        showing = liveOnTargetRef.current ? 'to' : 'from'
      }

      if (frame) {
        renderFace(ctx(), frame.left, {
          ...project.display,
          theme: frame.colorsLeft,
          rightParams: renderRightEyeParams(frame.left, frame.right),
          rightTheme: frame.colorsRight,
          customShapes: project.customPupilShapes,
          customEyeShapes: project.customEyeShapes,
          stickers: effectiveStickers(project, null, frame.stickerAnimation),
          stickerAssets: project.stickerAssets,
          stickerElapsedMs: frame.stickerElapsedMs,
          firmwareSim: cfg.firmwareSim,
          backgroundImage: project.backgroundImage
        })
      } else {
        const c = ctx()
        c.fillStyle = project.display.backgroundColor
        c.fillRect(0, 0, project.display.width, project.display.height)
      }

      if (now - lastReadoutAt > 80) {
        lastReadoutAt = now
        setReadout({
          clockMs: clockRef.current,
          showing,
          transitioning: frame?.transitioning ?? false,
          t: frame?.transitionT ?? 1,
          eased: frame?.easedT ?? 1,
          clipMs: frame?.clipElapsedMs ?? 0
        })
      }
    }
    const ctx = () => canvasRef.current!.getContext('2d')!
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // effectiveSettings/switchNow only read refs + the store, so the loop never needs re-binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scrubTo = (clientX: number, el: HTMLElement) => {
    if (mode !== 'scripted') return
    const r = el.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    clockRef.current = f * totalMs
    setPlayingBoth(false)
  }

  // ---- Create Transition ----
  const suggestName = () => {
    const base = editing ? `${editing.name} Copy` : `${nameOf(from)} To ${nameOf(to)}`
    let name = base
    for (let n = 2; validateTransitionName(name, transitions) && n < 1000; n++) name = `${base} ${n}`
    return name
  }
  const nameError = creating ? validateTransitionName(newName, transitions) : null
  const fromRef = refFor(from, fromLoop)
  const toRef = refFor(to, toLoop)
  const missingFrom = !items.some((i) => i.id === from)
  const missingTo = !items.some((i) => i.id === to)
  const saveNew = () => {
    if (nameError || !fromRef || !toRef) return
    checkpoint()
    const id = addTransition({
      name: newName.trim(),
      source: transitionRefOf(from, fromLoop),
      target: transitionRefOf(to, toLoop),
      durationMs: settings.durationMs,
      easing: settings.easing,
      bezier: [...settings.bezier] as [number, number, number, number],
      interpolation: { ...interp },
      previewSwitchAfterMs: triggerAtMs,
      previewHoldMs: holdAfterMs
    })
    selectTransition(id)
    setCreating(false)
  }

  const identical = sameRef(fromRef, toRef)
  const fromPct = totalMs > 0 ? (triggerAtMs / totalMs) * 100 : 0
  const blendPct = totalMs > 0 ? (effectiveMs / totalMs) * 100 : 0
  const canvasCss = Math.min(260, display.width)
  const borderRadius = display.shape === 'circle' ? '50%' : display.shape === 'rounded' ? `${display.cornerRadius}px` : '0px'
  const label = 'text-[11px] text-studio-muted'
  const nameShowing = readout.showing === 'from' ? nameOf(from) : nameOf(to)

  return (
    <div
      className="absolute left-2 top-full mt-1 z-50 w-[780px] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-4rem)] overflow-y-auto studio-panel shadow-floating border border-studio-border bg-studio-panel p-3 flex flex-col gap-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm text-studio-accent">⇄ Transition Simulator</span>
        <span className={label}>Previews clip switches exactly as the exported ESP32 player blends them.</span>
        <div className="flex-1" />
        <button className="studio-btn text-xs" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>

      {/* ---- Saved transition / draft bar ---- */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-studio-border bg-studio-panel2 px-2 py-1.5">
        {editing ? (
          <>
            <span className={label}>Editing transition</span>
            <span className="text-sm font-medium text-studio-text truncate max-w-[240px]">{editing.name}</span>
            <span className="text-[11px] text-studio-text">
              ({nameOf(from)} → {nameOf(to)})
            </span>
            {(missingFrom || missingTo) && <span className="text-[11px] text-studio-warn">⚠ refers to a deleted clip</span>}
            {!missingFrom && !missingTo && transitionNameMismatch(editing.name, nameOf(from), nameOf(to)) && (
              <span className="text-[11px] text-studio-warn" title="The name says one thing but From/To say another — edits here change this saved transition">
                ⚠ name doesn't match From → To
              </span>
            )}
            <span className={label}>· edits save to the project</span>
            <div className="flex-1" />
            <button
              className="studio-btn text-xs"
              onClick={() => {
                setNewName(suggestName())
                setCreating(true)
              }}
              title="Save the current settings as another transition"
            >
              Save as new…
            </button>
            <button className="studio-btn text-xs" onClick={() => selectTransition(null)} title="Stop editing this transition and work on a draft">
              New draft
            </button>
          </>
        ) : (
          <>
            <span className={label}>Draft · duration and easing are the project default (SetTransition)</span>
            <div className="flex-1" />
            <button
              className="studio-btn-primary text-xs"
              disabled={!fromRef || !toRef}
              onClick={() => {
                setNewName(suggestName())
                setCreating(true)
              }}
            >
              ＋ Create Transition
            </button>
          </>
        )}
      </div>

      {creating && (
        <div className="flex flex-col gap-1 rounded border border-studio-accent bg-studio-panel2 p-2">
          <div className="flex items-center gap-2">
            <span className={label}>Name</span>
            <input
              autoFocus
              className={`flex-1 min-w-0 rounded border bg-studio-panel px-2 py-1 text-sm ${nameError ? 'border-studio-danger' : 'border-studio-border'}`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveNew()
                else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setCreating(false)
                }
              }}
            />
            <button className="studio-btn-primary text-xs" disabled={!!nameError} onClick={saveNew}>
              Save
            </button>
            <button className="studio-btn text-xs" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
          {nameError ? (
            <span className="text-[11px] text-studio-danger">{nameError}</span>
          ) : (
            <span className={label}>
              Saves From/To, duration, easing, interpolation and preview timing. ESP32: playTransition({JSON.stringify(newName.trim())})
            </span>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="p-4 text-sm text-studio-muted">Create an animation or combination first.</div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {/* ---- Left: selection + settings ---- */}
          <div className="flex-1 min-w-[300px] flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <ClipPicker
                label="From"
                items={items}
                value={from}
                onChange={setFrom}
                loop={fromLoop}
                note={from.startsWith('c:') ? (fromLoop ? 'loops (its Loop setting)' : 'plays once (its Loop setting)') : animLoopOf(from) ? 'loops' : 'plays once'}
              />
              <div className="flex items-center gap-2">
                <button className="studio-btn text-xs ml-12" onClick={swap} title="Swap From / To">
                  ⇅ Swap
                </button>
              </div>
              <ClipPicker
                label="To"
                items={items}
                value={to}
                onChange={setTo}
                loop={toLoop}
                onLoopChange={setToLoop}
                note={animLoopOf(to) ? 'loops (set on the animation)' : 'plays once (set on the animation)'}
              />
              {identical && <div className="text-[11px] text-studio-warn">From and To are the same clip — this previews a restart (blend back to its first frame).</div>}
            </div>

            <div className="flex flex-col gap-2 border-t border-studio-border pt-2">
              <span className="studio-label">{editing ? 'Transition' : 'Transition (project default)'}</span>
              <Slider
                label="Duration"
                value={settings.durationMs}
                min={0}
                max={2000}
                step={10}
                suffix=" ms"
                onCommitStart={checkpoint}
                onChange={(v) => setDuration(Math.round(v))}
              />
              <EasingPicker easing={settings.easing} customBezier={settings.bezier} onChange={setEasing} />
              <code className="text-[11px] text-studio-muted bg-studio-panel2 rounded px-1.5 py-1 select-all">
                {editing ? (
                  <>playTransition({JSON.stringify(editing.name)});</>
                ) : (
                  <>
                    SetTransition({settings.durationMs}, {EASING_CPP[settings.easing]}); <span className="opacity-70">{'// default in eyes.h: EYES_TRANSITION_MS'}</span>
                  </>
                )}
              </code>
              <label className={`${label} flex items-center gap-1.5`} title="A/B check: preview the same switch as the old hard cut">
                <input type="checkbox" checked={compareHardCut} onChange={(e) => setCompareHardCut(e.target.checked)} />
                Compare: hard cut (0 ms, the old behaviour)
              </label>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-studio-border pt-2">
              <span className="studio-label">Property interpolation</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {TRANSITION_PROPERTY_GROUPS.map((g) => (
                  <label key={g.key} className={`${label} flex items-center gap-1.5`}>
                    <input type="checkbox" checked={interp[g.key]} onChange={(e) => setInterp({ [g.key]: e.target.checked } as Partial<TransitionInterpolation>)} />
                    Blend {g.label.toLowerCase()}
                  </label>
                ))}
                <label className={`${label} flex items-center gap-1.5`}>
                  <input type="checkbox" checked={interp.colors} onChange={(e) => setInterp({ colors: e.target.checked })} />
                  Blend colours
                </label>
              </div>
              <Slider
                label="Switch point"
                value={interp.switchAtPct}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onCommitStart={editing ? checkpoint : undefined}
                onChange={(v) => setInterp({ switchAtPct: Math.round(v) }, false)}
              />
              <span className={label}>
                Unticked properties, shape types, visibility and stickers switch at this point of the eased blend.
                {!editing && ' Saved with a transition; the project default always blends everything and switches at 50%.'}
              </span>
            </div>

            <div className="flex flex-col gap-2 border-t border-studio-border pt-2">
              <span className="studio-label">Scripted preview{editing ? ' (studio only, not exported)' : ''}</span>
              <Slider label="Switch after" value={triggerAtMs} min={0} max={6000} step={10} suffix=" ms" onCommitStart={editing ? checkpoint : undefined} onChange={(v) => setTriggerAtMs(Math.round(v))} />
              <Slider label="Hold target" value={holdAfterMs} min={0} max={6000} step={10} suffix=" ms" onCommitStart={editing ? checkpoint : undefined} onChange={(v) => setHoldAfterMs(Math.round(v))} />
            </div>
          </div>

          {/* ---- Right: device preview + transport ---- */}
          <div className="w-[300px] flex flex-col gap-2 items-stretch">
            <div className="flex items-center justify-center bg-studio-bg rounded p-2">
              <canvas
                ref={canvasRef}
                style={{ width: canvasCss, height: (canvasCss * display.height) / display.width, borderRadius, imageRendering: 'pixelated' }}
                className="block"
              />
            </div>

            <div className="text-[11px] font-mono tabular-nums flex items-center gap-2">
              <span className={readout.transitioning ? 'text-studio-accent' : 'text-studio-text'}>
                {readout.transitioning ? `Blending ${Math.round(readout.t * 100)}% (eased ${readout.eased.toFixed(2)})` : 'Playing'}
              </span>
              <span className="text-studio-muted truncate">
                {readout.transitioning ? `→ ${nameShowing}` : `${nameShowing} @ ${Math.round(readout.clipMs)}ms`}
              </span>
            </div>

            {mode === 'scripted' && (
              <div
                className="relative h-7 rounded border border-studio-border overflow-hidden cursor-pointer select-none bg-studio-panel2"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  scrubTo(e.clientX, e.currentTarget)
                }}
                onPointerMove={(e) => {
                  if (e.buttons & 1) scrubTo(e.clientX, e.currentTarget)
                }}
                title="Click or drag to scrub"
              >
                <div className="absolute inset-y-0 left-0" style={{ width: `${fromPct}%`, background: 'rgba(56,189,248,0.22)' }} />
                <div className="absolute inset-y-0" style={{ left: `${fromPct}%`, width: `${blendPct}%`, background: 'rgba(251,191,36,0.45)' }} />
                <div className="absolute inset-y-0 right-0" style={{ left: `${fromPct + blendPct}%`, background: 'rgba(52,211,153,0.22)' }} />
                <div className="absolute inset-0 flex items-center justify-between px-1.5 text-[10px] text-studio-muted pointer-events-none">
                  <span>From</span>
                  <span>{effectiveMs > 0 ? `blend ${effectiveMs}ms` : 'cut'}</span>
                  <span>{playAsLoop ? (to.startsWith('c:') && toLoop ? 'To ⟳ loops' : 'To ⟳') : 'To'}</span>
                </div>
                <div ref={playheadRef} className="absolute inset-y-0 w-0.5 bg-studio-text pointer-events-none" style={{ left: 0 }} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1">
              <button className="studio-btn-primary text-xs" disabled={!fromRef || !toRef} onClick={startScripted} title="Play From, switch at 'Switch after', hold To">
                ▶ Preview
              </button>
              <button className="studio-btn text-xs" disabled={!fromRef || !toRef} onClick={startScripted} title="Replay from the start">
                ⟲ Replay
              </button>
              <button
                className={`studio-btn text-xs ${playAsLoop ? 'text-studio-accent border-studio-accent' : ''}`}
                onClick={() => {
                  const next = !playAsLoop
                  setPlayAsLoop(next)
                  cfgRef.current.playAsLoop = next
                  // Turning it on after the preview stopped at the end continues from there.
                  if (next && mode === 'scripted' && !playingRef.current && clockRef.current >= totalMs) setPlayingBoth(true)
                }}
                title={
                  (to.startsWith('c:')
                    ? toLoop
                      ? 'Keep playing after the transition: the To combination keeps looping ("Loop combination" is checked)'
                      : 'Keep playing after the transition: the To combination plays once and holds its last frame ("Loop combination" is unchecked)'
                    : 'Keep playing after the transition: the To animation plays as set on the animation') + ' — exactly like the ESP32'
                }
              >
                ⟳ Play as loop
              </button>
              <button className="studio-btn text-xs" onClick={() => setPlayingBoth(!playingRef.current)} title="Pause / resume">
                {playing ? '⏸' : '⏵'}
              </button>
              <select className="bg-studio-panel2 border border-studio-border rounded text-xs px-1 py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Preview speed only — does not change the export">
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>
                    {v === 1 ? '1× (device)' : `${v}× slow`}
                  </option>
                ))}
              </select>
              <label className={`${label} flex items-center gap-1 ml-auto`} title="RGB565 colour quantization + firmware iris/glow approximation">
                <input type="checkbox" checked={firmwareSim} onChange={(e) => setFirmwareSim(e.target.checked)} />
                ESP32 render
              </label>
            </div>

            <div className="flex flex-col gap-1 border-t border-studio-border pt-2">
              <span className="studio-label">Sensor test (live)</span>
              <div className="flex flex-wrap items-center gap-1">
                {mode !== 'live' ? (
                  <button className="studio-btn text-xs" disabled={!fromRef || !toRef} onClick={startLive} title="Run From continuously and switch whenever you press Switch now">
                    ● Start live
                  </button>
                ) : (
                  <>
                    <button className="studio-btn-primary text-xs" onClick={switchNow} title="Switch immediately, like an accelerometer event — press again mid-blend to test interruptions">
                      ⚡ Switch now
                    </button>
                    <button className="studio-btn text-xs" onClick={startLive} title="Restart From">
                      ⟲
                    </button>
                  </>
                )}
                <button className={`studio-btn text-xs ${shaking ? 'text-studio-accent border-studio-accent' : ''}`} disabled={!fromRef || !toRef} onClick={toggleShake} title="Fire switches at random 150–900 ms intervals">
                  {shaking ? '■ Stop shake' : '〰 Shake test'}
                </button>
              </div>
              <span className={label}>Switches never pass through Idle — select an Idle clip explicitly if you want one.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
