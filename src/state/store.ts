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
  Project,
  StickerAsset,
  StickerInstance,
  StickerLayer,
  StickerScope,
  UiCssRule,
  UiDisplaySettings,
  UiWidget,
  UiWidgetStateName,
  UiWidgetStyle,
  UiWidgetType
} from '@/types'
import {
  DEFAULT_DISPLAY,
  DEFAULT_EYE_COLORS,
  DEFAULT_EYE_PARAMS,
  DEFAULT_PERSONALITY,
  DEFAULT_STICKER_ANIM,
  DEFAULT_TIMING,
  STYLE_EYE_COLOR_FIELDS,
  STYLE_EYE_PARAM_FIELDS,
  UI_DISPLAY_PRESETS,
  applyStyleToColors,
  applyStyleToParams,
  computeStyleOverrides,
  defaultVisualReference
} from '@/types'
import { builtinAnimations } from '@/data/builtinAnimations'
import { builtinExpressions } from '@/data/builtinExpressions'
import { MIN_SEGMENT_MS, animationDuration, keyframeStartTimes } from '@/engine/interpolate'
import { BUILTIN_STICKER_ASSETS } from '@/renderer/builtinStickers'
import { STICKER_PRESET_BUNDLES } from '@/data/stickerPresets'
import { createDefaultUiDesign, createWidget } from '@/lib/uiDesign/widgetDefaults'

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
    visualReference,
    customPupilShapes: [],
    stickerAssets: [...BUILTIN_STICKER_ASSETS],
    stickers: [],
    uiDesign: createDefaultUiDesign()
  }
}

export interface DevStats {
  fps: number
  frame: number
  timeMs: number
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type LeftTab = 'animations' | 'expressions'
export type RightTab = 'controls' | 'colors' | 'display' | 'personality' | 'visual-reference' | 'stickers'
/** Which top-level screen is showing. 'home' is the landing screen shown at launch; 'eyeStudio'
 * is everything that existed before UI Design Mode (the panel tree in EyeStudioWorkspace.tsx);
 * 'uiDesign' is the structurally separate LVGL screen designer. These three are never tabs or a
 * switcher within a shared shell — each renders as its own fully separate component tree (see
 * AppShell.tsx) with its own top bar, so the two editors can't share layout or accidentally
 * interfere with each other. Session-only (like leftTab/rightTab): never persisted, always
 * resets to 'home' on launch/load, so it can't affect save files or undo/redo. */
export type Workspace = 'home' | 'eyeStudio' | 'uiDesign'

export interface ApplyVisualReferenceOptions {
  scope: 'all' | 'expressions' | 'animations' | 'selected'
  eyeTarget: EyeSide
  overrideMode: 'preserve' | 'replace'
}

interface StoreState {
  project: Project
  filePath: string | null
  dirty: boolean
  workspace: Workspace
  /** Purely a UI hint for the toolbar's saved-status readout — never persisted, and not
   * itself the source of truth for whether a save happened (`dirty`/`filePath` are). */
  saveStatus: SaveStatus

  activeAnimationId: string
  selectedKeyframeId: string | null
  selectedExpressionId: string | null
  /** Session-only clipboard for Copy/Paste Keyframe — a plain deep copy, not tied to the
   * animation it was copied from, so pasting into a different animation just works. Not part
   * of `project` (so it's outside undo/redo and never persisted), matching how
   * `selectedKeyframeId` etc. are already handled. */
  keyframeClipboard: Keyframe | null

  /** Which eye(s) setEyeParam/setEyeParams/setColor currently write to. Switching this
   * alone never mutates the project — only a subsequent edit does. */
  eyeTarget: EyeSide

  mode: PlaybackMode
  playbackState: PlaybackState
  playbackTimeMs: number

  devModeOpen: boolean
  devStats: DevStats
  exportDialogOpen: boolean
  /** Separate from exportDialogOpen — UI Design Mode's own LVGL export dialog is a distinct
   * component (LvglExportDialog.tsx), not a tab within the Eye Studio ExportDialog, matching
   * this app's "no shared editor between workspaces" architecture. */
  lvglExportDialogOpen: boolean
  guideOpen: boolean
  settingsOpen: boolean

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

  // pupil shapes
  /** Appends a new custom pupil shape (already-normalized [-1,1] points — see
   * normalizePoints() in pupilShapes.ts) to the project's reusable library and returns its
   * id, so the caller can immediately select it via setEyeParam('pupilCustomShapeId', id). */
  addCustomPupilShape: (name: string, points: [number, number][]) => string
  deleteCustomPupilShape: (id: string) => void

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
  /** Repositions a keyframe to land at an absolute time (ms) from the animation's start, by
   * adjusting the *previous* keyframe's outgoing duration — the same mechanism dragging a
   * keyframe on the timeline already uses (duration is "time to the next keyframe", so a
   * keyframe's own absolute start time is entirely a function of every earlier keyframe's
   * duration; there's no separate "absolute time" field to write). No-op for the first
   * keyframe, which is always pinned at t=0. */
  setKeyframeAbsoluteTime: (keyframeId: string, absoluteMs: number) => void
  updateKeyframeEasing: (keyframeId: string, easing: EasingType, customBezier?: [number, number, number, number]) => void
  duplicateKeyframe: (keyframeId: string) => void
  deleteKeyframe: (keyframeId: string) => void
  reorderKeyframe: (keyframeId: string, newIndex: number) => void
  /** Deep-copies a keyframe into keyframeClipboard (session-only, see its own comment). */
  copyKeyframe: (keyframeId: string) => void
  /** Inserts keyframeClipboard's contents as a new keyframe in the *active* animation at
   * absoluteMs, splitting whichever segment it lands in (the surrounding keyframes' own
   * positions are preserved — only the segment it's inserted into is divided) rather than
   * shifting everything after it, matching "paste without disturbing the rest of the timeline"
   * — a no-op if the clipboard is empty. */
  pasteKeyframeAt: (absoluteMs: number) => void
  /** Copies fields from an existing Expression into a keyframe's pose. 'styleOnly' (the
   * default — see the Timeline UI) copies just the shared-appearance fields
   * (STYLE_EYE_PARAM_FIELDS: shape/size/curvature/highlight — the same set Visual Reference
   * uses), leaving this keyframe's own movement/pupil-position/eyelid-motion values alone so
   * applying an expression to e.g. a "look left" keyframe doesn't erase the look-left part.
   * 'replace' overwrites the keyframe's entire pose with the expression's. Either way this
   * copies values in *once* — the keyframe has no memory of which expression it came from
   * (see the Timeline "Apply Expression" control's own comment for why a live-linked
   * reference isn't implemented in this pass). */
  applyExpressionToKeyframe: (keyframeId: string, expressionId: string, mode: 'replace' | 'styleOnly') => void

  // expressions
  addExpression: (name: string) => void
  applyExpression: (id: string) => void
  saveExpression: (id: string) => void
  renameExpression: (id: string, name: string) => void
  deleteExpression: (id: string) => void

  // playback
  setMode: (mode: PlaybackMode) => void
  setWorkspace: (workspace: Workspace) => void
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
  setLvglExportDialogOpen: (open: boolean) => void
  setGuideOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setLeftTab: (tab: LeftTab) => void
  setRightTab: (tab: RightTab) => void

  // stickers
  /** Which sticker list add/edit actions below operate on — mirrors eyeTarget's "switching
   * this alone never mutates the project" contract. 'expression'/'animation' with nothing
   * selected/active just means there's nowhere to add a sticker yet (UI should disable Add). */
  stickerScope: StickerScope
  selectedStickerId: string | null
  setStickerScope: (scope: StickerScope) => void
  selectSticker: (id: string | null) => void
  addSticker: (assetId: string, layer?: StickerLayer) => string | null
  duplicateSticker: (id: string) => string | null
  deleteSticker: (id: string) => void
  updateSticker: (id: string, partial: Partial<StickerInstance>) => void
  setStickerVisible: (id: string, visible: boolean) => void
  setStickerLocked: (id: string, locked: boolean) => void
  /** Swaps this sticker's `order` with its neighbor in the same direction, within its own
   * layer only — matches the Sticker Manager's "reorder within the same layer" list. */
  moveStickerOrder: (id: string, direction: 'up' | 'down') => void
  applyStickerPreset: (presetId: string) => void
  /** Appends a new imported (raster) sticker asset to the project's reusable library —
   * same "asset, then place instances that reference it" split addCustomPupilShape()
   * established for pupil shapes. Returns the new asset's id. */
  addStickerAsset: (asset: Omit<StickerAsset, 'id' | 'kind'>) => string
  deleteStickerAsset: (id: string) => void

  // UI Design Mode — see types/uiDesign.ts. Entirely independent of every action above:
  // nothing here reads or writes project.eyeBase/animations/expressions/stickers/etc.
  selectedWidgetId: string | null
  selectUiWidget: (id: string | null) => void
  /** Creates a widget of `type` as a child of `parentId` (typically the active screen's root)
   * at (x, y), selects it, and returns its id. */
  addUiWidget: (type: UiWidgetType, parentId: string, x: number, y: number) => string
  moveUiWidget: (id: string, x: number, y: number) => void
  updateUiWidgetStyle: (id: string, partial: Partial<UiWidgetStyle>) => void
  updateUiWidgetText: (id: string, text: string) => void
  deleteUiWidget: (id: string) => void
  /** Deep-clones a widget (and its subtree) as a new sibling right after the original, offset
   * slightly so the copy is visibly distinct rather than perfectly overlapping. Returns the
   * new root widget's id. */
  duplicateUiWidget: (id: string) => string | null
  setUiWidgetVisible: (id: string, visible: boolean) => void
  setUiWidgetLocked: (id: string, locked: boolean) => void
  /** Swaps this widget with its neighbor in the given direction within its own parent's
   * childIds — matches the Sticker Manager's "reorder within the same layer" list. */
  reorderUiWidget: (id: string, direction: 'up' | 'down') => void
  /** Sets a widget's HTML id (`tagId`, must be unique — used as the exported LVGL function
   * name) and/or class list. Renamed away from "updateUiWidgetStyle" naming since these are
   * structural/selector-relevant fields, not style. */
  updateUiWidgetMeta: (id: string, partial: { tagId?: string | null; classNames?: string[]; allowOutsideBounds?: boolean }) => void

  // UI Design Mode — CSS rules (see UiCssRule in types/uiDesign.ts + lib/uiDesign/cssCascade.ts
  // for how they're applied at render time).
  addUiCssRule: (selector: string) => string
  updateUiCssRuleSelector: (id: string, selector: string) => void
  updateUiCssRuleStyle: (id: string, partial: Partial<UiWidgetStyle>) => void
  deleteUiCssRule: (id: string) => void
  /** Replaces the active screen's entire widget map + root with a freshly-parsed tree (see
   * lib/uiDesign/htmlSync.ts's htmlToWidgetTree) — the HTML editor's "commit on blur" action.
   * Widgets belonging to *other* screens are left untouched. */
  replaceActiveScreenWidgets: (widgets: Record<string, UiWidget>, rootId: string) => void
  replaceUiCssRules: (rules: UiCssRule[]) => void
  updateUiWidgetState: (id: string, state: UiWidgetStateName, partial: Partial<UiWidgetStyle> | null) => void

  // UI Design Mode — asset library (see lib/import/uiAssetImport.ts). Same "asset, then place
  // instances that reference it" split addCustomPupilShape()/addStickerAsset() established.
  addUiAsset: (name: string, dataUrl: string, naturalWidth: number, naturalHeight: number, sourceFormat: string) => string
  deleteUiAsset: (id: string) => void
  renameUiAsset: (id: string, name: string) => void
  /** Deep-copies an asset (new id, same image data) — for reusing an imported image as a
   * starting point under a different name rather than re-importing the same file. */
  duplicateUiAsset: (id: string) => string | null
  /** Swaps an existing asset's image data in place (same id, so every widget/backgroundImage/
   * CSS rule already referencing it picks up the new image automatically) — the Asset Manager's
   * "Replace" action, for updating a logo/icon without having to reassign it everywhere it's used. */
  replaceUiAsset: (id: string, dataUrl: string, naturalWidth: number, naturalHeight: number, sourceFormat: string) => void
  setUiWidgetSrc: (id: string, assetId: string | null) => void

  // UI Design Mode — script runtime support (see lib/uiDesign/scriptLang/). updateUiWidgetProps
  // and setUiActiveScreen are also general-purpose, not just for the script sandbox.
  updateUiWidgetProps: (id: string, partial: Record<string, string | number | boolean>) => void
  setUiActiveScreen: (screenId: string) => void
  /** Direct, non-undoable overwrite of every screen's widget map + activeScreenId — used ONLY
   * to restore the pre-run snapshot when the script sandbox's Stop/Restart controls revert
   * whatever live mutations (progress values, disabled states, screen navigation, ...) a
   * running script made, so runtime-only changes never leak into the saved design. Not a design
   * edit, so it deliberately does NOT go through checkpoint()/undo. */
  restoreUiRuntimeSnapshot: (widgets: Record<string, UiWidget>, activeScreenId: string | null) => void
  setUiScript: (script: string) => void

  // UI Design Mode — display configuration (see UiDisplaySettings in types/uiDesign.ts).
  // Entirely separate from project.display/setDisplay above — see that type's own comment for
  // why the two workspaces must never share this.
  /** Merges `partial` into project.uiDesign.display. When width/height actually change, every
   * widget's numeric (not percent/auto) x/y/width/height is rescaled by the resize ratio, so
   * existing layouts survive a display-size change proportionally instead of being clipped or
   * left tiny in a corner — see updateUiDisplaySettings's own comment. */
  setUiDisplaySettings: (partial: Partial<UiDisplaySettings>) => void
  applyUiDisplayPreset: (presetId: string) => void
  /** Session-only, never persisted — lets the Display panel's "Preview as..." show the canvas
   * at a different size/shape without touching the saved project (see HomeScreenActions-style
   * ephemeral fields elsewhere in this store, e.g. selectedWidgetId). Null = use the real
   * project.uiDesign.display. */
  uiPreviewDisplayOverride: UiDisplaySettings | null
  setUiPreviewDisplayOverride: (display: UiDisplaySettings | null) => void
}

function activeAnimationOf(project: Project, id: string): Animation | undefined {
  return project.animations.find((a) => a.id === id)
}

/** Resolves whichever sticker list `scope` currently points to. Called from inside a `set()`
 * producer with `project` being the live Immer draft, so the returned array is a reference
 * into that draft — mutating it (push/splice/etc.) mutates the project, same as every other
 * store action here. `undefined` means "nothing to add/edit into" (e.g. scope 'expression'
 * with no expression selected) — callers no-op in that case rather than throwing. */
function resolveStickerList(project: Project, scope: StickerScope, selectedExpressionId: string | null, activeAnimationId: string): StickerInstance[] | undefined {
  if (scope === 'project') return project.stickers
  if (scope === 'expression') return project.expressions.find((e) => e.id === selectedExpressionId)?.stickers
  return project.animations.find((a) => a.id === activeAnimationId)?.stickers
}

/** Finds a sticker by id across all three scopes (project + every expression + every
 * animation) — used by edit actions that take just an id (duplicate/delete/update/visible/
 * locked/reorder), so they work regardless of which scope is currently selected in the UI
 * (e.g. clicking an item in the Sticker Manager's list, which shows the merged
 * project+expression+animation set together). Returns the owning array (a draft reference,
 * same mutation contract as resolveStickerList) and the sticker's index within it. */
function findStickerOwner(project: Project, id: string): { list: StickerInstance[]; index: number } | null {
  const lists: StickerInstance[][] = [project.stickers, ...project.expressions.map((e) => e.stickers), ...project.animations.map((a) => a.stickers)]
  for (const list of lists) {
    const index = list.findIndex((s) => s.id === id)
    if (index >= 0) return { list, index }
  }
  return null
}

export const useStore = create<StoreState>()(
  immer((set) => ({
    project: createDefaultProject(),
    filePath: null,
    dirty: false,
    saveStatus: 'idle',
    workspace: 'home',

    activeAnimationId: '',
    selectedKeyframeId: null,
    selectedExpressionId: null,
    keyframeClipboard: null,
    eyeTarget: 'both',

    stickerScope: 'project',
    selectedStickerId: null,
    selectedWidgetId: null,
    uiPreviewDisplayOverride: null,

    mode: 'design',
    playbackState: 'stopped',
    playbackTimeMs: 0,

    devModeOpen: false,
    devStats: { fps: 0, frame: 0, timeMs: 0 },
    exportDialogOpen: false,
    lvglExportDialogOpen: false,
    guideOpen: false,
    settingsOpen: false,
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
          styleOverrides: computeStyleOverrides(newParams, newColors, s.project.visualReference),
          stickers: []
        })
        s.selectedExpressionId = newId
        s.mode = 'design'
        s.dirty = true
      }),

    addCustomPupilShape: (name, points) => {
      const id = nanoid(8)
      set((s) => {
        s.project.customPupilShapes.push({ id, name, points })
        s.dirty = true
      })
      return id
    },

    deleteCustomPupilShape: (id) =>
      set((s) => {
        s.project.customPupilShapes = s.project.customPupilShapes.filter((shape) => shape.id !== id)
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
            // EyeParams mixes number and string/string|null (pupilShape/pupilCustomShapeId)
            // fields, so a generic keyof-indexed assignment needs a loosened view here — same
            // reasoning as the EyeColors cast just below.
            const baseValue = (vr.params as unknown as Record<string, number | string | null>)[field]
            const leftValue = ((vr.paramsLeftOverride ?? vr.params) as unknown as Record<string, number | string | null>)[field]
            const rightValue = ((vr.paramsRightOverride ?? vr.params) as unknown as Record<string, number | string | null>)[field]
            ;(expr.params as unknown as Record<string, number | string | null>)[field] = baseValue
            if (expr.leftParams) (expr.leftParams as unknown as Record<string, number | string | null>)[field] = leftValue
            if (expr.rightParams) (expr.rightParams as unknown as Record<string, number | string | null>)[field] = rightValue
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
            ;(kf.params as unknown as Record<string, number | string | null>)[field] =
              (vr.params as unknown as Record<string, number | string | null>)[field]
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
          ],
          stickers: []
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

    setKeyframeAbsoluteTime: (keyframeId, absoluteMs) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const idx = a.keyframes.findIndex((k) => k.id === keyframeId)
        if (idx <= 0) return // first keyframe is always pinned at t=0, same as the drag handler
        const prevStart = keyframeStartTimes(a)[idx - 1]
        a.keyframes[idx - 1].duration = Math.max(MIN_SEGMENT_MS, Math.round(absoluteMs - prevStart))
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

    copyKeyframe: (keyframeId) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        if (kf) s.keyframeClipboard = JSON.parse(JSON.stringify(kf))
      }),

    pasteKeyframeAt: (absoluteMsRaw) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const clip = s.keyframeClipboard
        if (!a || !clip) return
        const absoluteMs = Math.max(0, absoluteMsRaw)

        const copy: Keyframe = JSON.parse(JSON.stringify(clip))
        copy.id = nanoid(10)

        const starts = keyframeStartTimes(a)
        const lastIdx = a.keyframes.length - 1
        if (a.keyframes.length === 0) {
          a.keyframes.push(copy)
        } else if (absoluteMs >= starts[lastIdx]) {
          // Pasting at/after the last keyframe extends the timeline rather than splitting a
          // segment — there's nothing after it to preserve the position of.
          a.keyframes.push(copy)
        } else {
          // Find which segment [starts[i], starts[i+1]) absoluteMs falls in and split it: the
          // earlier keyframe's own duration shrinks to reach the new keyframe, and the new
          // keyframe's duration covers the remainder — every *other* keyframe's absolute time
          // is unaffected, matching "paste without disturbing the rest of the timeline."
          let i = 0
          while (i < lastIdx && !(absoluteMs >= starts[i] && absoluteMs < starts[i + 1])) i++
          const segStart = starts[i]
          const segEnd = starts[i + 1]
          const clampedMs = Math.max(segStart + MIN_SEGMENT_MS, Math.min(segEnd - MIN_SEGMENT_MS, absoluteMs))
          copy.duration = Math.round(segEnd - clampedMs)
          a.keyframes[i].duration = Math.round(clampedMs - segStart)
          a.keyframes.splice(i + 1, 0, copy)
        }

        s.selectedKeyframeId = copy.id
        s.dirty = true
      }),

    applyExpressionToKeyframe: (keyframeId, expressionId, mode) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        const expr = s.project.expressions.find((e) => e.id === expressionId)
        if (!kf || !expr) return
        if (mode === 'replace') {
          kf.params = { ...expr.params }
        } else {
          const target = kf.params as unknown as Record<string, number | string | null>
          const source = expr.params as unknown as Record<string, number | string | null>
          for (const field of STYLE_EYE_PARAM_FIELDS) target[field] = source[field]
        }
        kf.styleOverrides = computeStyleOverrides(kf.params, null, s.project.visualReference)
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
          styleOverrides: computeStyleOverrides(newParams, newColors, s.project.visualReference),
          stickers: []
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
    setLvglExportDialogOpen: (open) => set((s) => void (s.lvglExportDialogOpen = open)),
    setGuideOpen: (open) => set((s) => void (s.guideOpen = open)),
    setSettingsOpen: (open) => set((s) => void (s.settingsOpen = open)),
    setLeftTab: (tab) => set((s) => void (s.leftTab = tab)),
    setRightTab: (tab) => set((s) => void (s.rightTab = tab)),
    setWorkspace: (workspace) => set((s) => void (s.workspace = workspace)),

    setStickerScope: (scope) => set((s) => void (s.stickerScope = scope)),
    selectSticker: (id) => set((s) => void (s.selectedStickerId = id)),

    addSticker: (assetId, layer = 'behind') => {
      const id = nanoid(8)
      let added = false
      set((s) => {
        const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
        if (!list) return
        const asset = s.project.stickerAssets.find((a) => a.id === assetId)
        const order = list.filter((st) => st.layer === layer).length
        list.push({
          id,
          assetId,
          name: asset?.name ?? 'Sticker',
          layer,
          order,
          x: 0,
          y: 0,
          width: 48,
          height: 48,
          scale: 100,
          rotation: 0,
          opacity: 100,
          tint: null,
          flipH: false,
          flipV: false,
          visible: true,
          locked: false,
          anim: { ...DEFAULT_STICKER_ANIM }
        })
        s.selectedStickerId = id
        s.dirty = true
        added = true
      })
      return added ? id : null
    },

    duplicateSticker: (id) => {
      const newId = nanoid(8)
      let added = false
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (!owner) return
        const copy: StickerInstance = { ...JSON.parse(JSON.stringify(owner.list[owner.index])), id: newId }
        copy.name = `${copy.name} Copy`
        owner.list.push(copy)
        s.selectedStickerId = newId
        s.dirty = true
        added = true
      })
      return added ? newId : null
    },

    deleteSticker: (id) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (!owner) return
        owner.list.splice(owner.index, 1)
        if (s.selectedStickerId === id) s.selectedStickerId = null
        s.dirty = true
      }),

    updateSticker: (id, partial) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (!owner) return
        Object.assign(owner.list[owner.index], partial)
        s.dirty = true
      }),

    setStickerVisible: (id, visible) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (owner) owner.list[owner.index].visible = visible
        s.dirty = true
      }),

    setStickerLocked: (id, locked) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (owner) owner.list[owner.index].locked = locked
        s.dirty = true
      }),

    moveStickerOrder: (id, direction) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (!owner) return
        const sticker = owner.list[owner.index]
        const sameLayer = owner.list.filter((st) => st.layer === sticker.layer).sort((a, b) => a.order - b.order)
        const pos = sameLayer.findIndex((st) => st.id === id)
        const swapPos = direction === 'up' ? pos - 1 : pos + 1
        if (swapPos < 0 || swapPos >= sameLayer.length) return
        const neighbor = sameLayer[swapPos]
        const tmp = sticker.order
        sticker.order = neighbor.order
        neighbor.order = tmp
        s.dirty = true
      }),

    applyStickerPreset: (presetId) =>
      set((s) => {
        const preset = STICKER_PRESET_BUNDLES.find((p) => p.id === presetId)
        const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
        if (!preset || !list) return
        for (const made of preset.make()) {
          const order = list.filter((st) => st.layer === made.layer).length
          list.push({ ...made, order })
        }
        s.dirty = true
      }),

    addStickerAsset: (asset) => {
      const id = nanoid(8)
      set((s) => {
        s.project.stickerAssets.push({ ...asset, id, kind: 'raster' })
        s.dirty = true
      })
      return id
    },

    deleteStickerAsset: (id) =>
      set((s) => {
        s.project.stickerAssets = s.project.stickerAssets.filter((a) => a.id !== id)
        s.dirty = true
      }),

    // UI Design Mode
    selectUiWidget: (id) => set((s) => void (s.selectedWidgetId = id)),

    addUiWidget: (type, parentId, x, y) => {
      const widget = createWidget(type)
      widget.parentId = parentId
      widget.style.x = x
      widget.style.y = y
      set((s) => {
        const parent = s.project.uiDesign.widgets[parentId]
        if (!parent) return
        s.project.uiDesign.widgets[widget.id] = widget
        parent.childIds.push(widget.id)
        s.selectedWidgetId = widget.id
        s.dirty = true
      })
      return widget.id
    },

    moveUiWidget: (id, x, y) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (!w) return
        w.style.x = x
        w.style.y = y
        s.dirty = true
      }),

    updateUiWidgetStyle: (id, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (!w) return
        Object.assign(w.style, partial)
        s.dirty = true
      }),

    updateUiWidgetText: (id, text) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (w) w.text = text
        s.dirty = true
      }),

    deleteUiWidget: (id) =>
      set((s) => {
        const widgets = s.project.uiDesign.widgets
        const w = widgets[id]
        if (!w) return
        // A screen widget is a screen's root — deleting it would leave that UiScreen dangling,
        // so screens are removed via their own (future) screen-management action, not this one.
        if (w.type === 'screen') return
        const removeSubtree = (wid: string) => {
          const node = widgets[wid]
          if (!node) return
          for (const childId of node.childIds) removeSubtree(childId)
          delete widgets[wid]
        }
        if (w.parentId) {
          const parent = widgets[w.parentId]
          if (parent) parent.childIds = parent.childIds.filter((c) => c !== id)
        }
        removeSubtree(id)
        if (s.selectedWidgetId === id) s.selectedWidgetId = null
        s.dirty = true
      }),

    duplicateUiWidget: (id) => {
      const widgets = useStore.getState().project.uiDesign.widgets
      const original = widgets[id]
      if (!original || original.type === 'screen' || !original.parentId) return null

      // Re-ids every node in the cloned subtree (a plain deep-copy would collide with the
      // original's ids, which are also referenced by parentId/childIds throughout the tree) and
      // collects every clone (root + descendants) into a flat list to insert in one pass.
      const clones: UiWidget[] = []
      const cloneSubtree = (wid: string, newParentId: string | null): string => {
        const node = widgets[wid]
        const clone: UiWidget = JSON.parse(JSON.stringify(node))
        clone.id = nanoid(10)
        clone.parentId = newParentId
        clone.childIds = node.childIds.map((childId) => cloneSubtree(childId, clone.id))
        clones.push(clone)
        return clone.id
      }
      const newRootId = cloneSubtree(id, original.parentId)
      const rootClone = clones.find((c) => c.id === newRootId)!
      if (typeof rootClone.style.x === 'number') rootClone.style.x += 12
      if (typeof rootClone.style.y === 'number') rootClone.style.y += 12

      set((s) => {
        for (const clone of clones) s.project.uiDesign.widgets[clone.id] = clone
        const parent = s.project.uiDesign.widgets[rootClone.parentId!]
        if (parent) {
          const idx = parent.childIds.indexOf(id)
          parent.childIds.splice(idx + 1, 0, rootClone.id)
        }
        s.selectedWidgetId = rootClone.id
        s.dirty = true
      })
      return rootClone.id
    },

    setUiWidgetVisible: (id, visible) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (w) w.visible = visible
        s.dirty = true
      }),

    setUiWidgetLocked: (id, locked) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (w) w.locked = locked
        s.dirty = true
      }),

    reorderUiWidget: (id, direction) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (!w || !w.parentId) return
        const parent = s.project.uiDesign.widgets[w.parentId]
        if (!parent) return
        const idx = parent.childIds.indexOf(id)
        const swapWith = direction === 'up' ? idx - 1 : idx + 1
        if (idx === -1 || swapWith < 0 || swapWith >= parent.childIds.length) return
        ;[parent.childIds[idx], parent.childIds[swapWith]] = [parent.childIds[swapWith], parent.childIds[idx]]
        s.dirty = true
      }),

    updateUiWidgetMeta: (id, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (!w) return
        if (partial.tagId !== undefined) w.tagId = partial.tagId ?? undefined
        if (partial.classNames !== undefined) w.classNames = partial.classNames
        if (partial.allowOutsideBounds !== undefined) w.allowOutsideBounds = partial.allowOutsideBounds
        s.dirty = true
      }),

    addUiCssRule: (selector) => {
      const id = nanoid(10)
      set((s) => {
        s.project.uiDesign.css.push({ id, selector, style: {}, states: {} })
        s.dirty = true
      })
      return id
    },

    updateUiCssRuleSelector: (id, selector) =>
      set((s) => {
        const rule = s.project.uiDesign.css.find((r) => r.id === id)
        if (rule) rule.selector = selector
        s.dirty = true
      }),

    updateUiCssRuleStyle: (id, partial) =>
      set((s) => {
        const rule = s.project.uiDesign.css.find((r) => r.id === id)
        if (!rule) return
        Object.assign(rule.style, partial)
        s.dirty = true
      }),

    deleteUiCssRule: (id) =>
      set((s) => {
        s.project.uiDesign.css = s.project.uiDesign.css.filter((r) => r.id !== id)
        s.dirty = true
      }),

    replaceActiveScreenWidgets: (widgets, rootId) =>
      set((s) => {
        const ud = s.project.uiDesign
        const screen = ud.screens.find((sc) => sc.id === ud.activeScreenId) ?? ud.screens[0]
        if (!screen) return
        // Drop this screen's old subtree (widgets belonging to other screens are untouched —
        // screens' subtrees never overlap, so anything reachable from the old root is safe to
        // remove wholesale) and splice in the freshly-parsed tree in its place.
        const otherScreensWidgets: Record<string, UiWidget> = {}
        const oldRoot = ud.widgets[screen.rootWidgetId]
        if (oldRoot) {
          const toDrop = new Set<string>()
          const collect = (wid: string) => {
            toDrop.add(wid)
            const w = ud.widgets[wid]
            if (w) for (const c of w.childIds) collect(c)
          }
          collect(screen.rootWidgetId)
          for (const [wid, w] of Object.entries(ud.widgets)) {
            if (!toDrop.has(wid)) otherScreensWidgets[wid] = w
          }
        }
        ud.widgets = { ...otherScreensWidgets, ...widgets }
        screen.rootWidgetId = rootId
        ud.htmlSource = ''
        s.selectedWidgetId = null
        s.dirty = true
      }),

    replaceUiCssRules: (rules) =>
      set((s) => {
        s.project.uiDesign.css = rules
        s.project.uiDesign.cssSource = ''
        s.dirty = true
      }),

    updateUiWidgetState: (id, state, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (!w) return
        if (partial === null) delete w.states[state]
        else w.states[state] = { ...w.states[state], ...partial }
        s.dirty = true
      }),

    addUiAsset: (name, dataUrl, naturalWidth, naturalHeight, sourceFormat) => {
      const id = nanoid(10)
      set((s) => {
        s.project.uiDesign.assets.push({ id, name, dataUrl, naturalWidth, naturalHeight, sourceFormat })
        s.dirty = true
      })
      return id
    },

    deleteUiAsset: (id) =>
      set((s) => {
        s.project.uiDesign.assets = s.project.uiDesign.assets.filter((a) => a.id !== id)
        for (const w of Object.values(s.project.uiDesign.widgets)) {
          if (w.src === id) w.src = undefined
          if (w.style.backgroundImage === id) w.style.backgroundImage = undefined
          for (const stateStyle of Object.values(w.states)) {
            if (stateStyle && stateStyle.backgroundImage === id) stateStyle.backgroundImage = undefined
          }
        }
        for (const rule of s.project.uiDesign.css) {
          if (rule.style.backgroundImage === id) rule.style.backgroundImage = undefined
          for (const stateStyle of Object.values(rule.states)) {
            if (stateStyle && stateStyle.backgroundImage === id) stateStyle.backgroundImage = undefined
          }
        }
        s.dirty = true
      }),

    renameUiAsset: (id, name) =>
      set((s) => {
        const asset = s.project.uiDesign.assets.find((a) => a.id === id)
        if (asset) asset.name = name
        s.dirty = true
      }),

    duplicateUiAsset: (id) => {
      const source = useStore.getState().project.uiDesign.assets.find((a) => a.id === id)
      if (!source) return null
      const newId = nanoid(10)
      set((s) => {
        s.project.uiDesign.assets.push({ ...source, id: newId, name: `${source.name} copy` })
        s.dirty = true
      })
      return newId
    },

    replaceUiAsset: (id, dataUrl, naturalWidth, naturalHeight, sourceFormat) =>
      set((s) => {
        const asset = s.project.uiDesign.assets.find((a) => a.id === id)
        if (!asset) return
        asset.dataUrl = dataUrl
        asset.naturalWidth = naturalWidth
        asset.naturalHeight = naturalHeight
        asset.sourceFormat = sourceFormat
        s.dirty = true
      }),

    setUiWidgetSrc: (id, assetId) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (w) w.src = assetId ?? undefined
        s.dirty = true
      }),

    updateUiWidgetProps: (id, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (w) Object.assign(w.props, partial)
        s.dirty = true
      }),

    setUiActiveScreen: (screenId) =>
      set((s) => {
        const ud = s.project.uiDesign
        if (ud.screens.some((sc) => sc.id === screenId)) ud.activeScreenId = screenId
      }),

    restoreUiRuntimeSnapshot: (widgets, activeScreenId) =>
      set((s) => {
        s.project.uiDesign.widgets = widgets
        if (activeScreenId) s.project.uiDesign.activeScreenId = activeScreenId
      }),

    setUiScript: (script) =>
      set((s) => {
        s.project.uiDesign.script = script
        s.dirty = true
      }),

    // Merges `partial` into the display config; when width and/or height actually change,
    // every widget's numeric x/y/width/height is rescaled by the resize ratio (percentage/auto
    // sizes are left alone — they're already responsive) so an existing layout keeps its
    // proportions on the new canvas instead of overflowing or shrinking to a corner. This is
    // the concrete, bounded piece of "reposition responsive widgets when appropriate" this pass
    // implements — a full anchor/constraint system is a separate, much larger feature (not
    // built here, see the UI Design Mode plan's deferred-scope notes).
    setUiDisplaySettings: (partial) =>
      set((s) => {
        const display = s.project.uiDesign.display
        const nextWidth = partial.width ?? display.width
        const nextHeight = partial.height ?? display.height
        const scaleX = nextWidth / display.width
        const scaleY = nextHeight / display.height
        if (scaleX !== 1 || scaleY !== 1) {
          for (const w of Object.values(s.project.uiDesign.widgets)) {
            if (typeof w.style.x === 'number') w.style.x = Math.round(w.style.x * scaleX)
            if (typeof w.style.y === 'number') w.style.y = Math.round(w.style.y * scaleY)
            if (typeof w.style.width === 'number') w.style.width = Math.max(1, Math.round(w.style.width * scaleX))
            if (typeof w.style.height === 'number') w.style.height = Math.max(1, Math.round(w.style.height * scaleY))
          }
        }
        Object.assign(display, partial)
        s.dirty = true
      }),

    applyUiDisplayPreset: (presetId) => {
      const preset = UI_DISPLAY_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      useStore.getState().setUiDisplaySettings({ width: preset.width, height: preset.height, shape: preset.shape })
    },

    setUiPreviewDisplayOverride: (display) => set((s) => void (s.uiPreviewDisplayOverride = display))
  }))
)

useStore.setState((s) => ({ activeAnimationId: s.project.animations[0]?.id ?? '' }))

export function getActiveAnimation(): Animation | undefined {
  const s = useStore.getState()
  return activeAnimationOf(s.project, s.activeAnimationId)
}
