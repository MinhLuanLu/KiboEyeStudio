import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import type {
  Animation,
  DisplaySettings,
  EasingType,
  EyeColors,
  EyeParams,
  GlobalTiming,
  Keyframe,
  Personality,
  PlaybackMode,
  PlaybackState,
  Project
} from '@/types'
import { DEFAULT_DISPLAY, DEFAULT_EYE_COLORS, DEFAULT_EYE_PARAMS, DEFAULT_PERSONALITY, DEFAULT_TIMING } from '@/types'
import { builtinAnimations } from '@/data/builtinAnimations'
import { builtinExpressions } from '@/data/builtinExpressions'
import { animationDuration } from '@/engine/interpolate'

const HISTORY_LIMIT = 60
const FRAME_STEP_MS = 1000 / 30

export function createDefaultProject(name = 'Untitled Project'): Project {
  const now = Date.now()
  return {
    id: nanoid(10),
    name,
    createdAt: now,
    updatedAt: now,
    eyeBase: { ...DEFAULT_EYE_PARAMS },
    colors: { ...DEFAULT_EYE_COLORS },
    display: { ...DEFAULT_DISPLAY },
    personality: { ...DEFAULT_PERSONALITY },
    timing: { ...DEFAULT_TIMING },
    animations: builtinAnimations.map((a) => ({ ...a, id: nanoid(10), keyframes: a.keyframes.map((k) => ({ ...k, id: nanoid(10) })) })),
    expressions: builtinExpressions.map((e) => ({ ...e, id: nanoid(10) }))
  }
}

export interface DevStats {
  fps: number
  frame: number
  timeMs: number
}

interface StoreState {
  project: Project
  filePath: string | null
  dirty: boolean

  activeAnimationId: string
  selectedKeyframeId: string | null

  mode: PlaybackMode
  playbackState: PlaybackState
  playbackTimeMs: number

  devModeOpen: boolean
  devStats: DevStats
  exportDialogOpen: boolean
  referenceImportOpen: boolean

  past: Project[]
  future: Project[]

  // history
  checkpoint: () => void
  undo: () => void
  redo: () => void

  // project management
  newProject: () => void
  loadProject: (project: Project, filePath: string | null) => void
  renameProject: (name: string) => void
  setFilePath: (path: string | null) => void
  markSaved: () => void
  touch: () => void

  // design
  setEyeParam: <K extends keyof EyeParams>(key: K, value: EyeParams[K]) => void
  setEyeParams: (partial: Partial<EyeParams>) => void

  // colors
  setColor: <K extends keyof EyeColors>(key: K, value: EyeColors[K]) => void
  applyGeneratedEye: (params: Partial<EyeParams>, colors: EyeColors, expressionName: string) => void

  // display
  setDisplay: <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => void
  toggleBezel: () => void

  // personality / timing
  setPersonality: <K extends keyof Personality>(key: K, value: Personality[K]) => void
  setTiming: <K extends keyof GlobalTiming>(key: K, value: GlobalTiming[K]) => void

  // animations
  selectAnimation: (id: string) => void
  addAnimation: (name?: string) => string
  duplicateAnimation: (id: string) => string
  renameAnimation: (id: string, name: string) => void
  deleteAnimation: (id: string) => void
  setAnimationLoop: (id: string, loop: boolean) => void
  importAnimation: (animation: Animation) => void

  // keyframes
  selectKeyframe: (id: string | null) => void
  addKeyframe: (afterKeyframeId?: string) => void
  updateKeyframeParams: (keyframeId: string, partial: Partial<EyeParams>) => void
  updateKeyframeDuration: (keyframeId: string, duration: number) => void
  updateKeyframeEasing: (keyframeId: string, easing: EasingType, customBezier?: [number, number, number, number]) => void
  duplicateKeyframe: (keyframeId: string) => void
  deleteKeyframe: (keyframeId: string) => void
  reorderKeyframe: (keyframeId: string, newIndex: number) => void

  // expressions
  addExpression: (name: string) => void
  applyExpression: (id: string) => void
  renameExpression: (id: string, name: string) => void
  deleteExpression: (id: string) => void

  // playback
  setMode: (mode: PlaybackMode) => void
  play: () => void
  pause: () => void
  stop: () => void
  restart: () => void
  nextFrame: () => void
  prevFrame: () => void
  toggleLoop: () => void
  seek: (ms: number) => void
  tickPlayback: (timeMs: number, playing: boolean) => void

  // dev mode
  toggleDevMode: () => void
  setDevStats: (stats: DevStats) => void
  setExportDialogOpen: (open: boolean) => void
  setReferenceImportOpen: (open: boolean) => void
}

function activeAnimationOf(project: Project, id: string): Animation | undefined {
  return project.animations.find((a) => a.id === id)
}

export const useStore = create<StoreState>()(
  immer((set) => ({
    project: createDefaultProject(),
    filePath: null,
    dirty: false,

    activeAnimationId: '',
    selectedKeyframeId: null,

    mode: 'design',
    playbackState: 'stopped',
    playbackTimeMs: 0,

    devModeOpen: false,
    devStats: { fps: 0, frame: 0, timeMs: 0 },
    exportDialogOpen: false,
    referenceImportOpen: false,

    past: [],
    future: [],

    checkpoint: () =>
      set((s) => {
        s.past.push(JSON.parse(JSON.stringify(s.project)))
        if (s.past.length > HISTORY_LIMIT) s.past.shift()
        s.future = []
      }),

    undo: () =>
      set((s) => {
        const prev = s.past.pop()
        if (!prev) return
        s.future.push(JSON.parse(JSON.stringify(s.project)))
        s.project = prev
        s.dirty = true
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop()
        if (!next) return
        s.past.push(JSON.parse(JSON.stringify(s.project)))
        s.project = next
        s.dirty = true
      }),

    newProject: () =>
      set((s) => {
        s.project = createDefaultProject()
        s.filePath = null
        s.dirty = false
        s.past = []
        s.future = []
        s.activeAnimationId = s.project.animations[0]?.id ?? ''
        s.selectedKeyframeId = null
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
      }),

    loadProject: (project, filePath) =>
      set((s) => {
        s.project = project
        s.filePath = filePath
        s.dirty = false
        s.past = []
        s.future = []
        s.activeAnimationId = project.animations[0]?.id ?? ''
        s.selectedKeyframeId = null
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
      }),

    renameProject: (name) =>
      set((s) => {
        s.project.name = name
        s.dirty = true
      }),

    setFilePath: (path) => set((s) => void (s.filePath = path)),
    markSaved: () => set((s) => void (s.dirty = false)),
    touch: () =>
      set((s) => {
        s.project.updatedAt = Date.now()
        s.dirty = true
      }),

    setEyeParam: (key, value) =>
      set((s) => {
        s.project.eyeBase[key] = value
        s.dirty = true
      }),

    setEyeParams: (partial) =>
      set((s) => {
        Object.assign(s.project.eyeBase, partial)
        s.dirty = true
      }),

    setColor: (key, value) =>
      set((s) => {
        s.project.colors[key] = value
        s.dirty = true
      }),

    applyGeneratedEye: (params, colors, expressionName) =>
      set((s) => {
        Object.assign(s.project.eyeBase, params)
        s.project.colors = { ...colors }
        s.project.expressions.push({ id: nanoid(10), name: expressionName, params: { ...s.project.eyeBase, ...params } })
        s.mode = 'design'
        s.dirty = true
      }),

    setDisplay: (key, value) =>
      set((s) => {
        s.project.display[key] = value
        s.dirty = true
      }),

    toggleBezel: () =>
      set((s) => {
        s.project.display.showBezel = !s.project.display.showBezel
        s.dirty = true
      }),

    setPersonality: (key, value) =>
      set((s) => {
        s.project.personality[key] = value
        s.dirty = true
      }),

    setTiming: (key, value) =>
      set((s) => {
        s.project.timing[key] = value
        s.dirty = true
      }),

    selectAnimation: (id) =>
      set((s) => {
        s.activeAnimationId = id
        s.selectedKeyframeId = null
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
      }),

    addAnimation: (name = 'New Animation') => {
      const id = nanoid(10)
      set((s) => {
        s.project.animations.push({
          id,
          name,
          loop: false,
          keyframes: [
            { id: nanoid(10), duration: 500, easing: 'easeInOut', params: { ...s.project.eyeBase } },
            { id: nanoid(10), duration: 500, easing: 'easeInOut', params: { ...s.project.eyeBase } }
          ]
        })
        s.dirty = true
      })
      return id
    },

    duplicateAnimation: (id) => {
      const newId = nanoid(10)
      set((s) => {
        const src = activeAnimationOf(s.project, id)
        if (!src) return
        const copy: Animation = JSON.parse(JSON.stringify(src))
        copy.id = newId
        copy.name = `${src.name} Copy`
        copy.keyframes = copy.keyframes.map((k) => ({ ...k, id: nanoid(10) }))
        s.project.animations.push(copy)
        s.dirty = true
      })
      return newId
    },

    renameAnimation: (id, name) =>
      set((s) => {
        const a = activeAnimationOf(s.project, id)
        if (a) a.name = name
        s.dirty = true
      }),

    deleteAnimation: (id) =>
      set((s) => {
        s.project.animations = s.project.animations.filter((a) => a.id !== id)
        if (s.activeAnimationId === id) {
          s.activeAnimationId = s.project.animations[0]?.id ?? ''
          s.selectedKeyframeId = null
        }
        s.dirty = true
      }),

    setAnimationLoop: (id, loop) =>
      set((s) => {
        const a = activeAnimationOf(s.project, id)
        if (a) a.loop = loop
        s.dirty = true
      }),

    importAnimation: (animation) =>
      set((s) => {
        const copy = { ...animation, id: nanoid(10), keyframes: animation.keyframes.map((k) => ({ ...k, id: nanoid(10) })) }
        s.project.animations.push(copy)
        s.activeAnimationId = copy.id
        s.dirty = true
      }),

    selectKeyframe: (id) => set((s) => void (s.selectedKeyframeId = id)),

    addKeyframe: (afterKeyframeId) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const insertAt = afterKeyframeId ? a.keyframes.findIndex((k) => k.id === afterKeyframeId) + 1 : a.keyframes.length
        const template = a.keyframes[Math.max(0, insertAt - 1)]?.params ?? s.project.eyeBase
        const newKf: Keyframe = { id: nanoid(10), duration: 400, easing: 'easeInOut', params: { ...template } }
        a.keyframes.splice(insertAt, 0, newKf)
        s.selectedKeyframeId = newKf.id
        s.dirty = true
      }),

    updateKeyframeParams: (keyframeId, partial) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        if (kf) Object.assign(kf.params, partial)
        s.dirty = true
      }),

    updateKeyframeDuration: (keyframeId, duration) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        if (kf) kf.duration = Math.max(1, duration)
        s.dirty = true
      }),

    updateKeyframeEasing: (keyframeId, easing, customBezier) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        if (kf) {
          kf.easing = easing
          kf.customBezier = customBezier
        }
        s.dirty = true
      }),

    duplicateKeyframe: (keyframeId) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const idx = a.keyframes.findIndex((k) => k.id === keyframeId)
        if (idx === -1) return
        const copy: Keyframe = JSON.parse(JSON.stringify(a.keyframes[idx]))
        copy.id = nanoid(10)
        a.keyframes.splice(idx + 1, 0, copy)
        s.selectedKeyframeId = copy.id
        s.dirty = true
      }),

    deleteKeyframe: (keyframeId) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a || a.keyframes.length <= 1) return
        a.keyframes = a.keyframes.filter((k) => k.id !== keyframeId)
        if (s.selectedKeyframeId === keyframeId) s.selectedKeyframeId = null
        s.dirty = true
      }),

    reorderKeyframe: (keyframeId, newIndex) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const idx = a.keyframes.findIndex((k) => k.id === keyframeId)
        if (idx === -1) return
        const clamped = Math.max(0, Math.min(a.keyframes.length - 1, newIndex))
        const [item] = a.keyframes.splice(idx, 1)
        a.keyframes.splice(clamped, 0, item)
        s.dirty = true
      }),

    addExpression: (name) =>
      set((s) => {
        s.project.expressions.push({ id: nanoid(10), name, params: { ...s.project.eyeBase } })
        s.dirty = true
      }),

    applyExpression: (id) =>
      set((s) => {
        const expr = s.project.expressions.find((e) => e.id === id)
        if (expr) {
          s.project.eyeBase = { ...expr.params }
          s.mode = 'design'
        }
        s.dirty = true
      }),

    renameExpression: (id, name) =>
      set((s) => {
        const e = s.project.expressions.find((x) => x.id === id)
        if (e) e.name = name
        s.dirty = true
      }),

    deleteExpression: (id) =>
      set((s) => {
        s.project.expressions = s.project.expressions.filter((e) => e.id !== id)
        s.dirty = true
      }),

    setMode: (mode) =>
      set((s) => {
        s.mode = mode
        s.playbackState = mode === 'animate' ? s.playbackState : 'stopped'
        if (mode !== 'animate') s.playbackTimeMs = 0
      }),

    play: () => set((s) => void (s.playbackState = 'playing')),
    pause: () => set((s) => void (s.playbackState = 'paused')),
    stop: () =>
      set((s) => {
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
      }),
    restart: () =>
      set((s) => {
        s.playbackTimeMs = 0
        s.playbackState = 'playing'
      }),

    nextFrame: () =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const dur = a ? animationDuration(a) : 0
        s.playbackState = 'paused'
        s.playbackTimeMs = Math.min(dur, s.playbackTimeMs + FRAME_STEP_MS)
      }),

    prevFrame: () =>
      set((s) => {
        s.playbackState = 'paused'
        s.playbackTimeMs = Math.max(0, s.playbackTimeMs - FRAME_STEP_MS)
      }),

    toggleLoop: () =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (a) a.loop = !a.loop
        s.dirty = true
      }),

    seek: (ms) => set((s) => void (s.playbackTimeMs = Math.max(0, ms))),

    tickPlayback: (timeMs, playing) =>
      set((s) => {
        s.playbackTimeMs = timeMs
        if (!playing) s.playbackState = 'paused'
      }),

    toggleDevMode: () => set((s) => void (s.devModeOpen = !s.devModeOpen)),
    setDevStats: (stats) => set((s) => void (s.devStats = stats)),
    setExportDialogOpen: (open) => set((s) => void (s.exportDialogOpen = open)),
    setReferenceImportOpen: (open) => set((s) => void (s.referenceImportOpen = open))
  }))
)

useStore.setState((s) => ({ activeAnimationId: s.project.animations[0]?.id ?? '' }))

export function getActiveAnimation(): Animation | undefined {
  const s = useStore.getState()
  return activeAnimationOf(s.project, s.activeAnimationId)
}
