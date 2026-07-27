import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import type {
  Animation,
  DisplaySettings,
  EasingType,
  EditorState,
  Expression,
  EyeColors,
  EyeParams,
  EyeSide,
  GlobalTiming,
  Keyframe,
  Personality,
  PlaybackMode,
  PlaybackState,
  Project
} from '@/types'
import {
  DEFAULT_DISPLAY,
  DEFAULT_EYE_COLORS,
  DEFAULT_EYE_PARAMS,
  DEFAULT_PERSONALITY,
  DEFAULT_TIMING,
  STYLE_EYE_COLOR_FIELDS,
  STYLE_EYE_PARAM_FIELDS,
  applyStyleToColors,
  applyStyleToParams,
  computeStyleOverrides,
  defaultVisualReference
} from '@/types'
import { builtinAnimations } from '@/data/builtinAnimations'
import { builtinExpressions } from '@/data/builtinExpressions'
import { animationDuration } from '@/engine/interpolate'

const HISTORY_LIMIT = 60
const FRAME_STEP_MS = 1000 / 30

export function createDefaultProject(name = 'Untitled Project'): Project {
  const now = Date.now()
  // The Visual Reference starts identical to the plain defaults, so a fresh project's
  // built-in animations/expressions compute styleOverrides against the exact same baseline
  // they were authored against — anything they deliberately changed (Happy's squashed eye
  // shape, Sleepy's curvature) becomes a protected override; anything left at the default
  // (Blink's untouched eye shape, only its behavioral eyelid values differ) stays inherited.
  const visualReference = defaultVisualReference()
  const animations: Animation[] = builtinAnimations.map((a) => ({
    ...a,
    id: nanoid(10),
    keyframes: a.keyframes.map((k) => ({
      ...k,
      id: nanoid(10),
      styleOverrides: computeStyleOverrides(k.params, null, visualReference)
    }))
  }))
  const expressions: Expression[] = builtinExpressions.map((e) => ({
    ...e,
    id: nanoid(10),
    styleOverrides: computeStyleOverrides(e.params, e.colors, visualReference)
  }))
  return {
    id: nanoid(10),
    name,
    createdAt: now,
    updatedAt: now,
    eyeBase: { ...DEFAULT_EYE_PARAMS },
    colors: { ...DEFAULT_EYE_COLORS },
    eyeLeftOverride: null,
    eyeRightOverride: null,
    colorsLeftOverride: null,
    colorsRightOverride: null,
    display: { ...DEFAULT_DISPLAY },
    personality: { ...DEFAULT_PERSONALITY },
    timing: { ...DEFAULT_TIMING },
    animations,
    expressions,
    visualReference
  }
}

export interface DevStats {
  fps: number
  frame: number
  timeMs: number
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type LeftTab = 'animations' | 'expressions'
export type RightTab = 'controls' | 'colors' | 'display' | 'personality' | 'visual-reference'

export interface ApplyVisualReferenceOptions {
  scope: 'all' | 'expressions' | 'animations' | 'selected'
  eyeTarget: EyeSide
  overrideMode: 'preserve' | 'replace'
}

interface StoreState {
  project: Project
  filePath: string | null
  dirty: boolean
  /** Purely a UI hint for the toolbar's saved-status readout — never persisted, and not
   * itself the source of truth for whether a save happened (`dirty`/`filePath` are). */
  saveStatus: SaveStatus

  activeAnimationId: string
  selectedKeyframeId: string | null
  selectedExpressionId: string | null

  /** Which eye(s) setEyeParam/setEyeParams/setColor currently write to. Switching this
   * alone never mutates the project — only a subsequent edit does. */
  eyeTarget: EyeSide

  mode: PlaybackMode
  playbackState: PlaybackState
  playbackTimeMs: number

  devModeOpen: boolean
  devStats: DevStats
  exportDialogOpen: boolean
  /** One-shot navigation signal: Toolbar sets this true to ask the Visual Reference panel to
   * jump to its Import Image sub-tab; the panel consumes it (flips back to false) once seen. */
  referenceImportOpen: boolean
  guideOpen: boolean

  /** Which top-level section the left library panel shows. Lives in the store (not local
   * component state) so actions like the toolbar's "Import Reference..." button can drive
   * navigation into it directly. */
  leftTab: LeftTab
  /** Which top-level section the right editor panel shows — same reasoning as leftTab: the
   * toolbar's "Import Reference..." button needs to be able to jump straight to the Visual
   * Reference tab here. */
  rightTab: RightTab

  past: Project[]
  future: Project[]

  // history
  checkpoint: () => void
  undo: () => void
  redo: () => void

  // project management
  newProject: () => void
  loadProject: (project: Project, editorState: EditorState, filePath: string | null) => void
  renameProject: (name: string) => void
  setFilePath: (path: string | null) => void
  markSaved: () => void
  setSaveStatus: (status: SaveStatus) => void
  touch: () => void

  // design
  setEyeTarget: (target: EyeSide) => void
  setEyeParam: <K extends keyof EyeParams>(key: K, value: EyeParams[K]) => void
  setEyeParams: (partial: Partial<EyeParams>) => void

  // colors
  setColor: <K extends keyof EyeColors>(key: K, value: EyeColors[K]) => void
  applyGeneratedEye: (params: Partial<EyeParams>, colors: EyeColors, expressionName: string) => void

  // visual reference (shared style inheritance — see types/index.ts)
  setVisualReferenceParam: <K extends keyof EyeParams>(key: K, value: EyeParams[K]) => void
  setVisualReferenceColor: <K extends keyof EyeColors>(key: K, value: EyeColors[K]) => void
  applyVisualReference: (options: ApplyVisualReferenceOptions) => void
  resetFieldToVisualReference: (kind: 'expression' | 'keyframe', id: string, field: string) => void

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
  saveExpression: (id: string) => void
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
  setGuideOpen: (open: boolean) => void
  setLeftTab: (tab: LeftTab) => void
  setRightTab: (tab: RightTab) => void
  openReferenceImport: () => void
}

function activeAnimationOf(project: Project, id: string): Animation | undefined {
  return project.animations.find((a) => a.id === id)
}

export const useStore = create<StoreState>()(
  immer((set) => ({
    project: createDefaultProject(),
    filePath: null,
    dirty: false,
    saveStatus: 'idle',

    activeAnimationId: '',
    selectedKeyframeId: null,
    selectedExpressionId: null,
    eyeTarget: 'both',

    mode: 'design',
    playbackState: 'stopped',
    playbackTimeMs: 0,

    devModeOpen: false,
    devStats: { fps: 0, frame: 0, timeMs: 0 },
    exportDialogOpen: false,
    referenceImportOpen: false,
    guideOpen: false,
    leftTab: 'animations',
    rightTab: 'controls',

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
        s.saveStatus = 'idle'
        s.past = []
        s.future = []
        s.activeAnimationId = s.project.animations[0]?.id ?? ''
        s.selectedKeyframeId = null
        s.selectedExpressionId = null
        s.eyeTarget = 'both'
        s.mode = 'design'
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
      }),

    loadProject: (project, editorState, filePath) =>
      set((s) => {
        s.project = project
        s.filePath = filePath
        s.dirty = false
        s.saveStatus = 'idle'
        s.past = []
        s.future = []
        s.activeAnimationId = editorState.activeAnimationId || (project.animations[0]?.id ?? '')
        s.selectedKeyframeId = null
        s.selectedExpressionId = editorState.selectedExpressionId
        s.eyeTarget = editorState.eyeTarget
        s.mode = editorState.mode
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
      }),

    renameProject: (name) =>
      set((s) => {
        s.project.name = name
        s.dirty = true
      }),

    setFilePath: (path) => set((s) => void (s.filePath = path)),
    markSaved: () =>
      set((s) => {
        s.dirty = false
      }),
    setSaveStatus: (status) => set((s) => void (s.saveStatus = status)),
    touch: () =>
      set((s) => {
        s.project.updatedAt = Date.now()
        s.dirty = true
      }),

    setEyeTarget: (target) => set((s) => void (s.eyeTarget = target)),

    setEyeParam: (key, value) =>
      set((s) => {
        if (s.eyeTarget === 'both') {
          s.project.eyeBase[key] = value
          s.project.eyeLeftOverride = null
          s.project.eyeRightOverride = null
        } else if (s.eyeTarget === 'left') {
          if (!s.project.eyeLeftOverride) s.project.eyeLeftOverride = { ...s.project.eyeBase }
          s.project.eyeLeftOverride[key] = value
        } else {
          if (!s.project.eyeRightOverride) s.project.eyeRightOverride = { ...s.project.eyeBase }
          s.project.eyeRightOverride[key] = value
        }
        s.dirty = true
      }),

    setEyeParams: (partial) =>
      set((s) => {
        if (s.eyeTarget === 'both') {
          Object.assign(s.project.eyeBase, partial)
          s.project.eyeLeftOverride = null
          s.project.eyeRightOverride = null
        } else if (s.eyeTarget === 'left') {
          if (!s.project.eyeLeftOverride) s.project.eyeLeftOverride = { ...s.project.eyeBase }
          Object.assign(s.project.eyeLeftOverride, partial)
        } else {
          if (!s.project.eyeRightOverride) s.project.eyeRightOverride = { ...s.project.eyeBase }
          Object.assign(s.project.eyeRightOverride, partial)
        }
        s.dirty = true
      }),

    setColor: (key, value) =>
      set((s) => {
        if (s.eyeTarget === 'both') {
          s.project.colors[key] = value
          s.project.colorsLeftOverride = null
          s.project.colorsRightOverride = null
        } else if (s.eyeTarget === 'left') {
          if (!s.project.colorsLeftOverride) s.project.colorsLeftOverride = { ...s.project.colors }
          s.project.colorsLeftOverride[key] = value
        } else {
          if (!s.project.colorsRightOverride) s.project.colorsRightOverride = { ...s.project.colors }
          s.project.colorsRightOverride[key] = value
        }
        s.dirty = true
      }),

    applyGeneratedEye: (params, colors, expressionName) =>
      set((s) => {
        Object.assign(s.project.eyeBase, params)
        s.project.colors = { ...colors }
        s.project.eyeLeftOverride = null
        s.project.eyeRightOverride = null
        s.project.colorsLeftOverride = null
        s.project.colorsRightOverride = null
        const newId = nanoid(10)
        const newParams = { ...s.project.eyeBase, ...params }
        const newColors = { ...colors }
        s.project.expressions.push({
          id: newId,
          name: expressionName,
          params: newParams,
          colors: newColors,
          leftParams: null,
          rightParams: null,
          leftColors: null,
          rightColors: null,
          styleOverrides: computeStyleOverrides(newParams, newColors, s.project.visualReference)
        })
        s.selectedExpressionId = newId
        s.mode = 'design'
        s.dirty = true
      }),

    setVisualReferenceParam: (key, value) =>
      set((s) => {
        const vr = s.project.visualReference
        if (s.eyeTarget === 'both') {
          vr.params[key] = value
          vr.paramsLeftOverride = null
          vr.paramsRightOverride = null
        } else if (s.eyeTarget === 'left') {
          if (!vr.paramsLeftOverride) vr.paramsLeftOverride = { ...vr.params }
          vr.paramsLeftOverride[key] = value
        } else {
          if (!vr.paramsRightOverride) vr.paramsRightOverride = { ...vr.params }
          vr.paramsRightOverride[key] = value
        }
        s.dirty = true
      }),

    setVisualReferenceColor: (key, value) =>
      set((s) => {
        const vr = s.project.visualReference
        if (s.eyeTarget === 'both') {
          vr.colors[key] = value
          vr.colorsLeftOverride = null
          vr.colorsRightOverride = null
        } else if (s.eyeTarget === 'left') {
          if (!vr.colorsLeftOverride) vr.colorsLeftOverride = { ...vr.colors }
          vr.colorsLeftOverride[key] = value
        } else {
          if (!vr.colorsRightOverride) vr.colorsRightOverride = { ...vr.colors }
          vr.colorsRightOverride[key] = value
        }
        s.dirty = true
      }),

    // Applies the current Visual Reference to every field NOT pinned as a custom override
    // (or, in 'replace' mode, clears all pins first and applies to everything). Runs as one
    // synchronous Immer producer, so it's atomic — if anything here threw, none of it would
    // commit — and it's one single entry on the undo stack when the caller checkpoints
    // beforehand (see VisualReferencePanel's Apply button).
    applyVisualReference: (options) =>
      set((s) => {
        const vr = s.project.visualReference
        // Resolves whichever of the VR's own params/colors is effective for a given eye —
        // the shared base for 'base', or that eye's VR override if one was authored (see
        // VisualReferenceStyle.paramsLeftOverride/paramsRightOverride/colorsLeftOverride/
        // colorsRightOverride in types/index.ts). Lets Apply carry the VR's own per-eye
        // divergence (if any) into the matching per-eye target instead of flattening
        // everything to the shared base.
        const vrParamsFor = (side: 'base' | 'left' | 'right'): EyeParams =>
          side === 'left' ? (vr.paramsLeftOverride ?? vr.params) : side === 'right' ? (vr.paramsRightOverride ?? vr.params) : vr.params
        const vrColorsFor = (side: 'base' | 'left' | 'right'): EyeColors =>
          side === 'left' ? (vr.colorsLeftOverride ?? vr.colors) : side === 'right' ? (vr.colorsRightOverride ?? vr.colors) : vr.colors

        // The shared base pose has no protected identity of its own to worry about — UNLESS
        // it's currently mirroring a selected Expression (applyExpression copies the
        // expression's pose into eyeBase for live editing). In that case eyeBase must respect
        // that expression's own styleOverrides too, or the live view would visibly "lose" the
        // expression's protected customizations the instant Apply runs, even though the
        // expression's own saved params (handled below) were correctly protected — leaving
        // the live preview and the saved data inconsistent with each other until the user
        // re-selects the expression (which a stray click can't even do — see applyExpression's
        // already-open guard).
        const liveExpr = s.selectedExpressionId ? s.project.expressions.find((e) => e.id === s.selectedExpressionId) : undefined
        // In 'replace' mode the expression's own overrides get cleared below too (see
        // applyToExpression), so the base pose must match that — otherwise eyeBase and the
        // expression's saved params would disagree about a field this exact Apply call was
        // supposed to reset.
        const baseOverrides = options.overrideMode === 'replace' ? [] : liveExpr ? liveExpr.styleOverrides : []

        if (options.eyeTarget === 'both') {
          applyStyleToParams(s.project.eyeBase, vrParamsFor('base'), baseOverrides)
          applyStyleToColors(s.project.colors, vrColorsFor('base'), baseOverrides)
          if (s.project.eyeLeftOverride) applyStyleToParams(s.project.eyeLeftOverride, vrParamsFor('left'), baseOverrides)
          if (s.project.eyeRightOverride) applyStyleToParams(s.project.eyeRightOverride, vrParamsFor('right'), baseOverrides)
          if (s.project.colorsLeftOverride) applyStyleToColors(s.project.colorsLeftOverride, vrColorsFor('left'), baseOverrides)
          if (s.project.colorsRightOverride) applyStyleToColors(s.project.colorsRightOverride, vrColorsFor('right'), baseOverrides)
        } else if (options.eyeTarget === 'left') {
          if (!s.project.eyeLeftOverride) s.project.eyeLeftOverride = { ...s.project.eyeBase }
          if (!s.project.colorsLeftOverride) s.project.colorsLeftOverride = { ...s.project.colors }
          applyStyleToParams(s.project.eyeLeftOverride, vrParamsFor('left'), baseOverrides)
          applyStyleToColors(s.project.colorsLeftOverride, vrColorsFor('left'), baseOverrides)
        } else {
          if (!s.project.eyeRightOverride) s.project.eyeRightOverride = { ...s.project.eyeBase }
          if (!s.project.colorsRightOverride) s.project.colorsRightOverride = { ...s.project.colors }
          applyStyleToParams(s.project.eyeRightOverride, vrParamsFor('right'), baseOverrides)
          applyStyleToColors(s.project.colorsRightOverride, vrColorsFor('right'), baseOverrides)
        }

        const applyToExpression = (expr: Expression) => {
          if (options.overrideMode === 'replace') expr.styleOverrides = []
          const overrides = expr.styleOverrides
          if (options.eyeTarget === 'both') {
            applyStyleToParams(expr.params, vrParamsFor('base'), overrides)
            applyStyleToColors(expr.colors, vrColorsFor('base'), overrides)
            if (expr.leftParams) applyStyleToParams(expr.leftParams, vrParamsFor('left'), overrides)
            if (expr.rightParams) applyStyleToParams(expr.rightParams, vrParamsFor('right'), overrides)
            if (expr.leftColors) applyStyleToColors(expr.leftColors, vrColorsFor('left'), overrides)
            if (expr.rightColors) applyStyleToColors(expr.rightColors, vrColorsFor('right'), overrides)
          } else if (options.eyeTarget === 'left') {
            if (!expr.leftParams) expr.leftParams = { ...expr.params }
            if (!expr.leftColors) expr.leftColors = { ...expr.colors }
            applyStyleToParams(expr.leftParams, vrParamsFor('left'), overrides)
            applyStyleToColors(expr.leftColors, vrColorsFor('left'), overrides)
          } else {
            if (!expr.rightParams) expr.rightParams = { ...expr.params }
            if (!expr.rightColors) expr.rightColors = { ...expr.colors }
            applyStyleToParams(expr.rightParams, vrParamsFor('right'), overrides)
            applyStyleToColors(expr.rightColors, vrColorsFor('right'), overrides)
          }
        }

        // Animations have no left/right concept (keyframes always share one pose between
        // both eyes) and no colors of their own (colors are always project-global) — so
        // eyeTarget only matters for expressions/the base pose above, and only EyeParams
        // style fields need updating per keyframe here.
        const applyToAnimation = (anim: Animation) => {
          for (const kf of anim.keyframes) {
            if (options.overrideMode === 'replace') kf.styleOverrides = []
            applyStyleToParams(kf.params, vrParamsFor('base'), kf.styleOverrides)
          }
        }

        if (options.scope === 'all' || options.scope === 'expressions') {
          s.project.expressions.forEach(applyToExpression)
        } else if (options.scope === 'selected' && s.selectedExpressionId) {
          const expr = s.project.expressions.find((e) => e.id === s.selectedExpressionId)
          if (expr) applyToExpression(expr)
        }

        if (options.scope === 'all' || options.scope === 'animations') {
          s.project.animations.forEach(applyToAnimation)
        } else if (options.scope === 'selected') {
          const anim = activeAnimationOf(s.project, s.activeAnimationId)
          if (anim) applyToAnimation(anim)
        }

        s.dirty = true
      }),

    resetFieldToVisualReference: (kind, id, field) =>
      set((s) => {
        const vr = s.project.visualReference
        const isParamField = (STYLE_EYE_PARAM_FIELDS as string[]).includes(field)
        const isColorField = (STYLE_EYE_COLOR_FIELDS as string[]).includes(field)
        if (kind === 'expression') {
          const expr = s.project.expressions.find((e) => e.id === id)
          if (!expr) return
          expr.styleOverrides = expr.styleOverrides.filter((f) => f !== field)
          if (isParamField) {
            const f = field as keyof EyeParams
            expr.params[f] = vr.params[f]
            if (expr.leftParams) expr.leftParams[f] = (vr.paramsLeftOverride ?? vr.params)[f]
            if (expr.rightParams) expr.rightParams[f] = (vr.paramsRightOverride ?? vr.params)[f]
          } else if (isColorField) {
            // EyeColors mixes string (hex colors) and number (intensities/opacity/width)
            // fields, so a generic keyof-indexed assignment needs a loosened view here —
            // same reasoning as applyStyleToColors in types/index.ts.
            const baseValue = (vr.colors as unknown as Record<string, string | number>)[field]
            const leftValue = ((vr.colorsLeftOverride ?? vr.colors) as unknown as Record<string, string | number>)[field]
            const rightValue = ((vr.colorsRightOverride ?? vr.colors) as unknown as Record<string, string | number>)[field]
            ;(expr.colors as unknown as Record<string, string | number>)[field] = baseValue
            if (expr.leftColors) (expr.leftColors as unknown as Record<string, string | number>)[field] = leftValue
            if (expr.rightColors) (expr.rightColors as unknown as Record<string, string | number>)[field] = rightValue
          }
        } else {
          const a = activeAnimationOf(s.project, s.activeAnimationId)
          const kf = a?.keyframes.find((k) => k.id === id)
          if (!kf) return
          kf.styleOverrides = kf.styleOverrides.filter((f) => f !== field)
          if (isParamField) {
            kf.params[field as keyof EyeParams] = vr.params[field as keyof EyeParams]
          }
        }
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
        const overrides = computeStyleOverrides(s.project.eyeBase, null, s.project.visualReference)
        s.project.animations.push({
          id,
          name,
          loop: false,
          keyframes: [
            { id: nanoid(10), duration: 500, easing: 'easeInOut', params: { ...s.project.eyeBase }, styleOverrides: overrides },
            { id: nanoid(10), duration: 500, easing: 'easeInOut', params: { ...s.project.eyeBase }, styleOverrides: overrides }
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
        const copy = {
          ...animation,
          id: nanoid(10),
          // Older/external animation JSON predates styleOverrides — fall back to computing
          // it fresh against the current Visual Reference, same as loading a legacy project.
          keyframes: animation.keyframes.map((k) => ({
            ...k,
            id: nanoid(10),
            styleOverrides: k.styleOverrides ?? computeStyleOverrides(k.params, null, s.project.visualReference)
          }))
        }
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
        const newParams = { ...template }
        const newKf: Keyframe = {
          id: nanoid(10),
          duration: 400,
          easing: 'easeInOut',
          params: newParams,
          styleOverrides: computeStyleOverrides(newParams, null, s.project.visualReference)
        }
        a.keyframes.splice(insertAt, 0, newKf)
        s.selectedKeyframeId = newKf.id
        s.dirty = true
      }),

    updateKeyframeParams: (keyframeId, partial) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        if (kf) {
          Object.assign(kf.params, partial)
          // Editing a keyframe directly IS its save point (there's no separate save step
          // like expressions have) — recompute which fields now differ from the Visual
          // Reference so the next Apply knows what to protect.
          kf.styleOverrides = computeStyleOverrides(kf.params, null, s.project.visualReference)
        }
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
        const newId = nanoid(10)
        const newParams = { ...s.project.eyeBase }
        const newColors = { ...s.project.colors }
        s.project.expressions.push({
          id: newId,
          name,
          params: newParams,
          colors: newColors,
          leftParams: s.project.eyeLeftOverride ? { ...s.project.eyeLeftOverride } : null,
          rightParams: s.project.eyeRightOverride ? { ...s.project.eyeRightOverride } : null,
          leftColors: s.project.colorsLeftOverride ? { ...s.project.colorsLeftOverride } : null,
          rightColors: s.project.colorsRightOverride ? { ...s.project.colorsRightOverride } : null,
          styleOverrides: computeStyleOverrides(newParams, newColors, s.project.visualReference)
        })
        s.selectedExpressionId = newId
        s.dirty = true
      }),

    applyExpression: (id) =>
      set((s) => {
        if (s.selectedExpressionId === id) return // already open — avoid discarding live edits on a stray click
        const expr = s.project.expressions.find((e) => e.id === id)
        if (expr) {
          s.project.eyeBase = { ...expr.params }
          s.project.colors = { ...expr.colors }
          s.project.eyeLeftOverride = expr.leftParams ? { ...expr.leftParams } : null
          s.project.eyeRightOverride = expr.rightParams ? { ...expr.rightParams } : null
          s.project.colorsLeftOverride = expr.leftColors ? { ...expr.leftColors } : null
          s.project.colorsRightOverride = expr.rightColors ? { ...expr.rightColors } : null
          s.selectedExpressionId = id
          s.mode = 'design'
        }
        s.dirty = true
      }),

    saveExpression: (id) =>
      set((s) => {
        const expr = s.project.expressions.find((e) => e.id === id)
        if (expr) {
          expr.params = { ...s.project.eyeBase }
          expr.colors = { ...s.project.colors }
          expr.leftParams = s.project.eyeLeftOverride ? { ...s.project.eyeLeftOverride } : null
          expr.rightParams = s.project.eyeRightOverride ? { ...s.project.eyeRightOverride } : null
          expr.leftColors = s.project.colorsLeftOverride ? { ...s.project.colorsLeftOverride } : null
          expr.rightColors = s.project.colorsRightOverride ? { ...s.project.colorsRightOverride } : null
          // Saving an expression IS its style-override save point (live edits before this
          // don't touch expr.params at all — see applyExpression) — recompute fresh so any
          // field the user just changed away from the Visual Reference becomes protected,
          // and any field they changed back to match it becomes inherited again.
          expr.styleOverrides = computeStyleOverrides(expr.params, expr.colors, s.project.visualReference)
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
        if (s.selectedExpressionId === id) s.selectedExpressionId = null
        s.dirty = true
      }),

    setMode: (mode) =>
      set((s) => {
        s.mode = mode
        s.playbackState = mode === 'animate' ? s.playbackState : 'stopped'
        if (mode !== 'animate') s.playbackTimeMs = 0
        if (mode !== 'design') s.selectedExpressionId = null
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
    setReferenceImportOpen: (open) => set((s) => void (s.referenceImportOpen = open)),
    setGuideOpen: (open) => set((s) => void (s.guideOpen = open)),
    setLeftTab: (tab) => set((s) => void (s.leftTab = tab)),
    setRightTab: (tab) => set((s) => void (s.rightTab = tab)),
    openReferenceImport: () =>
      set((s) => {
        s.rightTab = 'visual-reference'
        s.referenceImportOpen = true
      })
  }))
)

useStore.setState((s) => ({ activeAnimationId: s.project.animations[0]?.id ?? '' }))

export function getActiveAnimation(): Animation | undefined {
  const s = useStore.getState()
  return activeAnimationOf(s.project, s.activeAnimationId)
}
