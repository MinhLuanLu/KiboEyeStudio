import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import type {
  Animation,
  AnimationCombo,
  AnimationComboClip,
  DisplaySettings,
  EasingType,
  EditorState,
  Expression,
  EyeColors,
  EyeParams,
  EyeSide,
  GlobalTiming,
  Keyframe,
  Marker,
  Personality,
  PlaybackMode,
  PlaybackState,
  Project,
  SelectionItem,
  StickerAsset,
  StickerInstance,
  StickerLayer,
  StickerScope,
  TrackKind,
  UiCssRule,
  UiDataListConfig,
  UiDataSource,
  UiDataSourceField,
  UiDisplaySettings,
  UiKeyboardConfig,
  UiKeyboardCustomKey,
  UiOptionsSourceConfig,
  UiListItem,
  UiThemeableStyleField,
  UiScreenDisplayStyle,
  UiThemeId,
  UiThemeTokens,
  UiVariable,
  UiWidget,
  UiWidgetStateName,
  UiWidgetStyle,
  UiWidgetType,
  UiWorkspaceViewSettings
} from '@/types'
import type { MaterialPresetId } from '@/lib/uiDesign/materialPresets'
import type { ComponentTemplateId } from '@/lib/uiDesign/componentTemplates'
import { createComponentTemplate } from '@/lib/uiDesign/componentTemplates'
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
  createDefaultTracks,
  createTrack,
  defaultUiWorkspaceView,
  defaultVisualReference,
  effectiveEyeColors,
  effectiveEyeParams,
  leftEyeColors,
  leftEyeParams,
  rightEyeColors,
  rightEyeParams
} from '@/types'
import { builtinAnimations } from '@/data/builtinAnimations'
import { MATERIAL_PRESETS } from '@/lib/uiDesign/materialPresets'
import { DEFAULT_CUSTOM_THEME_TOKENS } from '@/lib/uiDesign/themes'
import { builtinExpressions } from '@/data/builtinExpressions'
import { MIN_SEGMENT_MS, animationDuration, sampleAnimationColors, sampleAnimationEye, sampleTrack } from '@/engine/interpolate'
import { computeComboTimeline, loopCountForDuration } from '@/engine/comboPlayback'
import { BUILTIN_STICKER_ASSETS } from '@/renderer/builtinStickers'
import { STICKER_PRESET_BUNDLES } from '@/data/stickerPresets'
import { createDefaultUiDesign, createWidget } from '@/lib/uiDesign/widgetDefaults'
import { parseDeclaredCodepoints } from '@/lib/uiDesign/fontImport'
import { applyKeyboardKeyPress, defaultKeyboardRuntimeState, resolveKeyboardMap, type UiKeyboardRuntimeState } from '@/lib/uiDesign/keyboardLayouts'
import { EVENT_CAPABLE_WIDGET_TYPES, reachableWidgetsForScreen } from '@/lib/export/lvglExport'

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
    })),
    // Builtin animations never author left/right/pupil/eyelid tracks or stickers, so these
    // just need fresh ids, not any styleOverrides recomputation.
    tracks: a.tracks.map((t) => ({ ...t, id: nanoid(10) }))
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
    animationFolders: [],
    animationCombos: [],
    expressions,
    expressionFolders: [],
    visualReference,
    customPupilShapes: [],
    customEyeShapes: [],
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

export type LeftTab = 'animations' | 'combinations' | 'expressions'
export type RightTab = 'controls' | 'colors' | 'display' | 'personality' | 'visual-reference' | 'stickers' | 'layers'
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

/** The 5 independently-timed keyframe tracks an Animation can hold — 'pose' is the original/
 * only track before this feature (still the required baseline every other track's fields
 * merge onto, see sampleAnimationEye in engine/interpolate.ts). Distinct from the broader
 * `TrackKind` (which also covers 'sticker'/'marker' — kinds with no `Keyframe[]` to resolve). */
export type KeyframeTrackKind = 'pose' | 'leftEye' | 'rightEye' | 'pupils' | 'eyelids'

/** One clipboard entry for the Timeline's Copy/Cut/Paste/Duplicate. Keeps enough context to
 * reinsert correctly: which keyframe track a keyframe came from (so paste can put it back on
 * an equivalent track, including in a different animation), or nothing extra for stickers/
 * markers (a sticker already carries its own `layer`/`trackId`; pasting into a different
 * animation just leaves `trackId` unresolved — see normalizeTracks()'s dangling-trackId
 * handling in persistence.ts, same fallback). `comboClip` entries carry a full
 * AnimationComboClip (including its own `animationId`) so pasting into a *different* combo
 * just works, same reasoning as keyframes pasting into a different animation — a clip whose
 * `animationId` doesn't resolve in the target project already renders as "Missing animation",
 * an existing, reused fallback. */
export type TimelineClipboardEntry =
  | { kind: 'keyframe'; trackKind: KeyframeTrackKind; data: Keyframe }
  | { kind: 'sticker'; data: StickerInstance }
  | { kind: 'marker'; data: Marker }
  | { kind: 'comboClip'; data: AnimationComboClip }

// ---------------------------------------------------------------------------------------------
// Layers panel — six fixed rows (Eye Shape / Upper Eyelid / Lower Eyelid / Pupil / Stickers /
// Effects) generic over `LayerKind`, mirroring `eyeTarget`/`setEyeParam`'s existing "one
// mechanism, keyed by field" precedent instead of writing five near-identical action sets by
// hand. Five of the six kinds are just named slices of `EyeParams`/`EyeColors` (each already has
// its own `*Visible`/`*Locked` pair, see types/index.ts); `'stickers'` is handled separately
// wherever it appears below since it's a per-instance list, not a handful of scalar fields.
// ---------------------------------------------------------------------------------------------

export type EyeLayerKind = 'eyeShape' | 'upperEyelid' | 'lowerEyelid' | 'pupil' | 'effects'
export type LayerKind = EyeLayerKind | 'stickers'

const LAYER_PARAM_FIELDS: Record<EyeLayerKind, (keyof EyeParams)[]> = {
  eyeShape: ['eyeShape', 'eyeCustomShapeId', 'eyeShapeScale', 'eyeShapeOffsetX', 'eyeShapeOffsetY', 'eyeShapeFlipH', 'eyeShapeFlipV'],
  upperEyelid: ['upperEyelid', 'upperEyelidTilt', 'upperEyelidCurvature', 'upperEyelidLeftRoundness', 'upperEyelidRightRoundness', 'upperEyelidStretchX', 'upperEyelidStretchY', 'upperEyelidSkew'],
  lowerEyelid: ['lowerEyelid', 'lowerEyelidTilt', 'lowerEyelidCurvature', 'lowerEyelidLeftRoundness', 'lowerEyelidRightRoundness', 'lowerEyelidStretchX', 'lowerEyelidStretchY', 'lowerEyelidSkew'],
  pupil: ['pupilWidth', 'pupilHeight', 'pupilX', 'pupilY', 'pupilRotation', 'pupilShape', 'pupilCustomShapeId'],
  effects: []
}
const LAYER_COLOR_FIELDS: Record<EyeLayerKind, (keyof EyeColors)[]> = {
  eyeShape: ['eyeShapeOpacity'],
  upperEyelid: [],
  lowerEyelid: [],
  pupil: ['pupilOpacity'],
  effects: ['glowIntensity', 'shadowIntensity']
}
type FieldRef = { obj: 'params'; key: keyof EyeParams } | { obj: 'colors'; key: keyof EyeColors }
const LAYER_VISIBLE_FIELD: Record<EyeLayerKind, FieldRef> = {
  eyeShape: { obj: 'params', key: 'eyeShapeVisible' },
  upperEyelid: { obj: 'params', key: 'upperEyelidVisible' },
  lowerEyelid: { obj: 'params', key: 'lowerEyelidVisible' },
  pupil: { obj: 'params', key: 'pupilVisible' },
  effects: { obj: 'colors', key: 'effectsVisible' }
}
const LAYER_LOCKED_FIELD: Record<EyeLayerKind, FieldRef> = {
  eyeShape: { obj: 'params', key: 'eyeShapeLocked' },
  upperEyelid: { obj: 'params', key: 'upperEyelidLocked' },
  lowerEyelid: { obj: 'params', key: 'lowerEyelidLocked' },
  pupil: { obj: 'params', key: 'pupilLocked' },
  effects: { obj: 'colors', key: 'effectsLocked' }
}

export interface LayerClipboardPayload {
  kind: EyeLayerKind
  params: Partial<EyeParams>
  colors: Partial<EyeColors>
}

/** Pulls just the fields one layer kind owns (its data fields plus its own visible/locked pair)
 * out of a full params/colors pair — the shared read side every copy/duplicate/apply-all/reset
 * action below funnels through, so there's exactly one place that knows which fields belong to
 * which layer. */
function collectLayerPayload(kind: EyeLayerKind, params: EyeParams, colors: EyeColors): LayerClipboardPayload {
  const paramPatch: Partial<EyeParams> = {}
  for (const f of LAYER_PARAM_FIELDS[kind]) (paramPatch as Record<string, unknown>)[f] = params[f]
  const colorPatch: Partial<EyeColors> = {}
  for (const f of LAYER_COLOR_FIELDS[kind]) (colorPatch as Record<string, unknown>)[f] = colors[f]
  const vf = LAYER_VISIBLE_FIELD[kind]
  if (vf.obj === 'params') (paramPatch as Record<string, unknown>)[vf.key] = params[vf.key]
  else (colorPatch as Record<string, unknown>)[vf.key] = colors[vf.key]
  const lf = LAYER_LOCKED_FIELD[kind]
  if (lf.obj === 'params') (paramPatch as Record<string, unknown>)[lf.key] = params[lf.key]
  else (colorPatch as Record<string, unknown>)[lf.key] = colors[lf.key]
  return { kind, params: paramPatch, colors: colorPatch }
}

/** Writes a params/colors patch onto one specific eye side's override (creating it, lazily
 * cloned from the base pose, if this is the side's first divergence) — the write-side twin of
 * `leftEyeParams`/`rightEyeParams`, used wherever a layer action needs to target a specific side
 * rather than the currently-selected Eye Target (e.g. "duplicate to the other eye"). */
function writeEyeSide(s: { project: Project }, side: 'left' | 'right', obj: 'params', patch: Partial<EyeParams>): void
function writeEyeSide(s: { project: Project }, side: 'left' | 'right', obj: 'colors', patch: Partial<EyeColors>): void
function writeEyeSide(s: { project: Project }, side: 'left' | 'right', obj: 'params' | 'colors', patch: Partial<EyeParams> | Partial<EyeColors>): void {
  if (obj === 'params') {
    const overrideKey = side === 'left' ? 'eyeLeftOverride' : 'eyeRightOverride'
    if (!s.project[overrideKey]) s.project[overrideKey] = { ...s.project.eyeBase }
    Object.assign(s.project[overrideKey] as EyeParams, patch)
  } else {
    const overrideKey = side === 'left' ? 'colorsLeftOverride' : 'colorsRightOverride'
    if (!s.project[overrideKey]) s.project[overrideKey] = { ...s.project.colors }
    Object.assign(s.project[overrideKey] as EyeColors, patch)
  }
}

/** Writes a params/colors patch respecting the current Eye Target radio ('both' collapses back
 * onto the shared base and clears both overrides, exactly like `setEyeParams`/`setColor` already
 * do) — the generic write side every scalar-field layer action (visible/locked/reset) uses. */
function writeEyeTarget(s: { project: Project }, eyeTarget: EyeSide, obj: 'params', patch: Partial<EyeParams>): void
function writeEyeTarget(s: { project: Project }, eyeTarget: EyeSide, obj: 'colors', patch: Partial<EyeColors>): void
function writeEyeTarget(s: { project: Project }, eyeTarget: EyeSide, obj: 'params' | 'colors', patch: Partial<EyeParams> | Partial<EyeColors>): void {
  if (eyeTarget === 'both') {
    if (obj === 'params') {
      Object.assign(s.project.eyeBase, patch)
      s.project.eyeLeftOverride = null
      s.project.eyeRightOverride = null
    } else {
      Object.assign(s.project.colors, patch)
      s.project.colorsLeftOverride = null
      s.project.colorsRightOverride = null
    }
  } else if (obj === 'params') {
    writeEyeSide(s, eyeTarget, 'params', patch as Partial<EyeParams>)
  } else {
    writeEyeSide(s, eyeTarget, 'colors', patch as Partial<EyeColors>)
  }
}

interface StoreState {
  project: Project
  filePath: string | null
  dirty: boolean
  workspace: Workspace
  /** Local login gate shown before any workspace is reachable — see LoginScreen.tsx. Purely
   * ephemeral session state, never part of `project`/EditorState: `authChecked` starts false
   * so App.tsx can show nothing (not a flash of the login form) while it asks
   * authPersistence.getAuthStatus() whether a remembered session exists; `authenticated` gates
   * rendering AppShell vs LoginScreen. */
  authChecked: boolean
  authenticated: boolean
  authUserEmail: string | null
  /** Purely a UI hint for the toolbar's saved-status readout — never persisted, and not
   * itself the source of truth for whether a save happened (`dirty`/`filePath` are). */
  saveStatus: SaveStatus

  activeAnimationId: string
  selectedKeyframeId: string | null
  selectedExpressionId: string | null
  /** Session-only clipboard for Copy/Paste Keyframe — a plain deep copy, not tied to the
   * animation it was copied from, so pasting into a different animation just works. Not part
   * of `project` (so it's outside undo/redo and never persisted), matching how
   * `selectedKeyframeId` etc. are already handled. Kept alongside the newer, more general
   * `timelineClipboard` below rather than replaced by it — this one only ever holds a single
   * pose-track keyframe, for the legacy single-keyframe shortcut fallback (see
   * lib/shortcuts.ts) used when the Timeline has no multi-selection active. */
  keyframeClipboard: Keyframe | null

  /** Every currently-selected timeline item — keyframes (on any of the 5 keyframe tracks),
   * sticker clips, or markers — uniformly, so drag/copy/paste/duplicate/delete can operate on
   * a mixed multi-selection without needing a parallel selection model per kind. Session-only:
   * outside `project`, never persisted, cleared on animation switch. Exactly one selected item
   * is mirrored into `selectedKeyframeId`/`selectedStickerId` (see syncPrimarySelection) so
   * existing single-target panels (ControlsPanel, StickerControls) keep working unmodified. */
  timelineSelection: SelectionItem[]
  /** Session-only clipboard for the Timeline's Copy/Cut/Paste/Duplicate — holds deep copies of
   * whatever was selected (keyframes across tracks, sticker clips, markers) plus enough
   * context (which keyframe track each one came from) to paste back correctly, including into
   * a different animation. Never persisted; excluded from undo/redo, matching
   * `keyframeClipboard`. */
  timelineClipboard: TimelineClipboardEntry[]
  /** Persistent (until toggled) snap-to setting for timeline drags — playhead/clip-edges/
   * frame-boundaries. Holding Alt during a drag disables snapping for that gesture only,
   * without touching this. Session-only, like the rest of this block. */
  snappingEnabled: boolean
  /** Snap grid granularity in ms while snapping is enabled: 0 = snap to frame boundaries (the
   * default), or a fixed interval (10/25/50/100ms) chosen from the Timeline's Snap menu. Clip/
   * keyframe edges and the playhead are always snap targets on top of this; Alt still disables
   * snapping for a single drag. Session-only, like snappingEnabled above. */
  snapIntervalMs: number

  /** 0-1 transient "blink preview" amount for Design mode only — the Eyelids panel's Preview
   * Blink button animates this 0→1→0 and PreviewCanvas lerps both lids' coverage toward fully
   * closed by this fraction WITHOUT mutating any params (purely a live preview, never saved,
   * never in undo). 0 = show the real authored pose. Session-only, like the block above. */
  eyelidPreviewClose: number

  /** Which eye(s) setEyeParam/setEyeParams/setColor currently write to. Switching this
   * alone never mutates the project — only a subsequent edit does. */
  eyeTarget: EyeSide

  mode: PlaybackMode
  playbackState: PlaybackState
  playbackTimeMs: number

  /** Which combo the Combinations panel is editing/previewing, and (for the "Preview from
   * selected timeline position" button) which of its clips. Live in the store rather than
   * local component state so the shared center PreviewCanvas can render the same combo — same
   * reasoning as activeAnimationId/selectedExpressionId above. */
  selectedComboId: string | null
  selectedComboClipId: string | null
  /** Combo playback is its own tiny clock, separate from playbackState/playbackTimeMs (which
   * belong to Animate-mode single-animation playback) so switching to the Combinations tab and
   * back never stomps on either — PreviewCanvas checks leftTab === 'combinations' first and
   * renders from these instead, regardless of `mode`. */
  comboPreviewPlaying: boolean
  comboPreviewTimeMs: number
  comboPreviewLoop: boolean

  devModeOpen: boolean
  devStats: DevStats
  /** ESP32 Export Preview — swaps the live canvas to drawEye()'s `firmwareSim` mode (RGB565
   * color quantization, ring-stepped iris/glow) so the user can compare against normal studio
   * rendering before compiling. Ephemeral UI state, not part of the saved project, same as
   * devModeOpen above. */
  esp32PreviewMode: boolean
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

  // layers panel — see the LAYER_*_FIELD tables + collectLayerPayload/writeEyeTarget/writeEyeSide
  // above. All six actions are generic over LayerKind; 'stickers' is handled as a special case
  // inside each (a per-instance list in the current sticker scope, not a handful of scalar
  // fields) rather than needing its own separate action set.
  layerClipboard: { kind: LayerKind; payload: LayerClipboardPayload | StickerInstance[] } | null
  /** visible=false renders as if this layer's coverage/shape/intensity were off, without
   * discarding the actual authored values (a real, exported behavior — see the *Visible fields'
   * own doc comments in types/index.ts). Applies to whichever eye(s) `eyeTarget` currently
   * selects, same as every other Controls/Colors field. */
  setLayerVisible: (kind: LayerKind, visible: boolean) => void
  /** locked=true is authoring-time only — disables this layer's Controls/Colors sliders; never
   * exported (see the *Locked fields' own doc comments). */
  setLayerLocked: (kind: LayerKind, locked: boolean) => void
  /** Copies this layer's current values from whichever side `eyeTarget` is set to ('left' or
   * 'right' — a no-op when `eyeTarget` is 'both', since there's no single source side to copy
   * from) onto the OTHER side's override. For 'stickers', duplicates every sticker in the
   * current sticker scope instead. */
  duplicateLayerToOtherEye: (kind: LayerKind) => void
  copyLayerToClipboard: (kind: LayerKind) => void
  /** `target: 'base'` pastes onto whichever side `eyeTarget` currently selects (respecting the
   * same both/left/right semantics as setLayerVisible/setLayerLocked above); an expression id
   * pastes directly onto that expression's own base `params`/`colors` (not its left/right
   * divergence, which the expression's own Save flow owns). */
  pasteLayerFromClipboard: (kind: LayerKind, target: 'base' | string) => void
  /** Reads this layer's current values (from whichever side `eyeTarget` selects) and writes them
   * onto every expression's own base `params`/`colors`. */
  applyLayerToAllExpressions: (kind: LayerKind) => void
  /** Resets this layer back to `DEFAULT_EYE_PARAMS`/`DEFAULT_EYE_COLORS`, respecting `eyeTarget`
   * the same way every other reset-this-field control in this app does. For 'stickers', clears
   * the current sticker scope's list. */
  resetLayerToDefault: (kind: LayerKind) => void

  // pupil shapes
  /** Appends a new custom pupil shape (already-normalized [-1,1] points — see
   * normalizePoints() in pupilShapes.ts) to the project's reusable library and returns its
   * id, so the caller can immediately select it via setEyeParam('pupilCustomShapeId', id). */
  addCustomPupilShape: (name: string, points: [number, number][]) => string
  deleteCustomPupilShape: (id: string) => void

  // eye shapes
  /** Same asset/instance split as addCustomPupilShape() above, one level up — appends a new
   * custom eye shape (already-normalized [-1,1] points, plus the original SVG text) to the
   * project's reusable library and returns its id. */
  addCustomEyeShape: (name: string, points: [number, number][], svgSource: string) => string
  /** Re-imports over an existing custom eye shape in place (same id, new points/svgSource) —
   * "Allow replacing the imported SVG with another one" from the spec, so every EyeParams that
   * already reference this id keep working without needing to re-select. */
  replaceCustomEyeShape: (id: string, points: [number, number][], svgSource: string) => void
  deleteCustomEyeShape: (id: string) => void

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
  addAnimation: (name?: string, folderId?: string | null) => string
  duplicateAnimation: (id: string) => string
  renameAnimation: (id: string, name: string) => void
  deleteAnimation: (id: string) => void
  reorderAnimation: (id: string, newIndex: number) => void
  // Animation-panel folder tree (editor organization only — see AnimationFolder). None of these
  // touch animation data/ids or playback; they only rearrange how animations are grouped/displayed.
  addAnimationFolder: (parentId: string | null, name?: string) => string
  renameAnimationFolder: (id: string, name: string) => void
  deleteAnimationFolder: (id: string) => void
  setAnimationFolderExpanded: (id: string, expanded: boolean) => void
  moveAnimationToFolder: (animationId: string, targetFolderId: string | null, index: number) => void
  moveAnimationFolder: (folderId: string, targetParentId: string | null, index: number) => void
  setAnimationLoop: (id: string, loop: boolean) => void
  importAnimation: (animation: Animation) => void

  // animation combinations
  addAnimationCombo: (name?: string) => string
  duplicateAnimationCombo: (id: string) => string
  renameAnimationCombo: (id: string, name: string) => void
  deleteAnimationCombo: (id: string) => void
  /** Drag-to-reorder a combination within the library (persists via the serialized array order). */
  reorderAnimationCombo: (id: string, newIndex: number) => void
  addAnimationComboClip: (comboId: string, animationId: string) => string
  updateAnimationComboClip: (comboId: string, clipId: string, partial: Partial<AnimationComboClip>) => void
  deleteAnimationComboClip: (comboId: string, clipId: string) => void
  reorderAnimationComboClip: (comboId: string, clipId: string, newIndex: number) => void
  // combo preview — drives the shared center PreviewCanvas while leftTab === 'combinations'
  selectAnimationCombo: (id: string | null) => void
  selectAnimationComboClip: (id: string | null) => void
  setComboPreviewPlaying: (playing: boolean) => void
  setComboPreviewTimeMs: (ms: number) => void
  setComboPreviewLoop: (loop: boolean) => void

  // keyframes (pose track only — legacy single-keyframe API kept for ControlsPanel and the
  // shortcut fallback path; see the "timeline (multi-track)" section below for the general,
  // track-aware, multi-selection-capable actions the new Timeline UI drives)
  selectKeyframe: (id: string | null) => void
  addKeyframe: (afterKeyframeId?: string) => void
  updateKeyframeParams: (keyframeId: string, partial: Partial<EyeParams>) => void
  updateKeyframeEasing: (keyframeId: string, easing: EasingType, customBezier?: [number, number, number, number]) => void
  duplicateKeyframe: (keyframeId: string) => void
  deleteKeyframe: (keyframeId: string) => void
  /** Deep-copies a keyframe into keyframeClipboard (session-only, see its own comment). */
  copyKeyframe: (keyframeId: string) => void
  /** Inserts keyframeClipboard's contents as a new keyframe in the *active* animation's pose
   * track at absoluteMs (clamped against its new neighbors' MIN_SEGMENT_MS gap) — a no-op if
   * the clipboard is empty. */
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
  /** Reverse of applyExpressionToKeyframe: snapshot a pose-track keyframe's full visual state into a
   * brand-new reusable Expression (added to project.expressions at root). Returns the new id. */
  saveKeyframeAsExpression: (keyframeId: string, name: string) => string

  // timeline (multi-track, CapCut-style editing) — operates on whichever of the 5 keyframe
  // tracks / sticker clips / markers the caller names, across the active animation, and (for
  // moves/copy/paste/duplicate/delete) on the whole current multi-selection at once.
  setTimelineSelection: (items: SelectionItem[]) => void
  toggleTimelineSelection: (item: SelectionItem, additive: boolean) => void
  clearTimelineSelection: () => void
  setSnappingEnabled: (enabled: boolean) => void
  setSnapIntervalMs: (intervalMs: number) => void
  setEyelidPreviewClose: (amount: number) => void

  /** Sets the active animation's total duration directly, clamping so it never cuts off
   * existing keyframes, sticker clips, or markers. This is the whole-timeline "ms" input
   * the Timeline toolbar edits. */
  setAnimationDuration: (durationMs: number) => void

  /** Continuous-drag primitive (like the old updateKeyframeDuration) — callers checkpoint()
   * once at drag-start, then call this on every pointermove. Clamps against MIN_SEGMENT_MS
   * neighbor gaps; the pose track's first keyframe stays pinned at t=0. Dragging the pose
   * track's last keyframe past the animation's current durationMs extends it. */
  setKeyframeTime: (trackKind: KeyframeTrackKind, keyframeId: string, timeMs: number) => void
  /** Same values-only editing updateKeyframeParams/updateKeyframeEasing do, generalized to any
   * of the 5 keyframe tracks — for the Timeline's Keyframe Inspector. */
  updateTrackKeyframeParams: (trackKind: KeyframeTrackKind, keyframeId: string, partial: Partial<EyeParams>) => void
  updateTrackKeyframeEasing: (trackKind: KeyframeTrackKind, keyframeId: string, easing: EasingType, customBezier?: [number, number, number, number]) => void
  /** Writes into the given keyframe's leftParams/rightParams (Keyframe's own per-eye
   * divergence — see its type comment), lazy-cloning from `params` on first use exactly like
   * Expression's own leftParams/rightParams. This is what the Eye Target selector's Left/Right
   * modes write through while a keyframe is selected — it never creates a new keyframe or
   * track; Both Eyes keeps writing straight to `params` via updateTrackKeyframeParams above. */
  updateTrackKeyframeEyeParams: (trackKind: KeyframeTrackKind, keyframeId: string, side: 'left' | 'right', partial: Partial<EyeParams>) => void
  /** Writes into a pose ("Expression") track keyframe's own `colors` palette (see
   * Keyframe.colors), lazy-cloning from the project's shared base palette on first use so an
   * untouched keyframe starts from exactly what it was already showing. This is what the Colors
   * panel writes through while a pose keyframe is selected, so changing color affects only that
   * keyframe instead of the whole project. No-op for non-pose tracks (they carry no color). */
  updateTrackKeyframeColors: (keyframeId: string, partial: Partial<EyeColors>) => void
  /** Continuous-drag primitive for a sticker clip's start/end handle. */
  resizeStickerClip: (stickerId: string, edge: 'start' | 'end', newMs: number) => void
  /** Continuous-drag primitive for a Combination clip's edge handle — the Timeline's combo-mode
   * equivalent of resizeStickerClip. A combo clip has no independent in/out-frame concept (it's
   * loop-count-based, not a frame range), so "resize" means solving for the whole loop count
   * that best fits the requested edge position, via loopCountForDuration (engine/comboPlayback):
   * `edge:'end'` holds `startTimeMs` fixed and re-derives `loopCount` for the new end; `edge:
   * 'start'` holds the clip's *current end* fixed and re-derives both `startTimeMs` and
   * `loopCount` — the same "trim = solve loop count" semantics already verified in the original
   * Combination Timeline this replaces. */
  resizeComboClip: (comboId: string, clipId: string, edge: 'start' | 'end', newMs: number) => void
  /** Splits a keyframe-track segment (inserting a new keyframe with the interpolated pose at
   * `atMs`) or a sticker clip (dividing it into two adjacent instances, preserving every other
   * setting on both sides) — a no-op if `atMs` isn't at least MIN_SEGMENT_MS from both
   * neighbors/edges. Self-checkpointing (one-shot, not a drag). */
  splitClipAt: (item: SelectionItem, atMs: number) => void
  /** Continuous-drag primitive: shifts every selected keyframe/sticker/marker by the same
   * `deltaMs`, preserving their relative spacing, clamped so the earliest selected item never
   * goes below t=0. The pose track's first keyframe (if selected) never moves. */
  moveSelectionByDelta: (deltaMs: number) => void
  /** Inserts a new keyframe on `trackKind` at `timeMs` (clamped away from neighbors by
   * MIN_SEGMENT_MS), templated from whatever's currently showing at that time (so it starts
   * matching the live pose rather than resetting to defaults) — the toolbar's "+ Keyframe"
   * button and double-clicking an empty spot on a keyframe track both call this. Self-
   * checkpointing. Selects the new keyframe. */
  addKeyframeAt: (trackKind: KeyframeTrackKind, timeMs: number) => void

  /** Adds one more track. For the 5 singleton fixed kinds (pose/leftEye/rightEye/pupils/
   * eyelids/marker) this is idempotent — if one already exists, it's selected/returned as-is
   * rather than creating a duplicate; 'sticker' always creates a new one (any number allowed).
   * Self-checkpointing. Returns the track's id. */
  addTrack: (kind: TrackKind, name?: string, layer?: StickerLayer) => string
  /** Removes any non-pose track. The track's own content goes with it: a removed sticker
   * track's stickers fall back to "Ungrouped" (trackId cleared, not deleted — matches the
   * timing validator's non-fatal dangling-trackId warning); a removed keyframe/marker track's
   * keyframes/markers are cleared, since there's nowhere left to show them. Self-checkpointing. */
  removeTrack: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  reorderTrack: (trackId: string, newOrder: number) => void
  setTrackVisible: (trackId: string, visible: boolean) => void
  setTrackLocked: (trackId: string, locked: boolean) => void
  assignStickerToTrack: (stickerId: string, trackId: string) => void
  /** Phase-1 on-ramp for eye-target conversion: seeds an empty leftEye/rightEye/pupils/eyelids
   * track from the pose track's own keyframe times/values, so the user has somewhere to start
   * diverging from from (a no-op if the target track already has keyframes). */
  detachTrackFromPose: (animId: string, trackKind: Exclude<KeyframeTrackKind, 'pose'>) => void
  /** Creates a new sticker clip directly on `trackId` at `atMs` (the playhead, or a drag-drop
   * position) — the Timeline's own "add a sticker" entry point, independent of the Sticker
   * Manager panel's scope-based add. `trackId` must be an existing 'sticker' track (a no-op
   * otherwise). Selects the new clip. Self-checkpointing. Returns the new sticker's id, or null
   * if the track doesn't exist. */
  addStickerToTrack: (trackId: string, assetId: string, atMs: number) => string | null
  /** Adds a studio-only marker at `atMs` on the active animation's Markers track and selects
   * it. Self-checkpointing. */
  addMarker: (atMs: number, label?: string) => string
  updateMarker: (markerId: string, partial: Partial<Pick<Marker, 'label' | 'color'>>) => void

  /** Deep-copies the current timelineSelection into timelineClipboard. */
  copySelection: () => void
  /** Pastes timelineClipboard at `atMs`: the earliest copied item lands exactly at atMs, every
   * other copied item preserves its original offset from that one. Appends rather than
   * replacing/merging with anything already at that time/track (paste-conflict resolution
   * dialogs are Phase 2). Self-checkpointing. */
  pasteSelectionAt: (atMs: number) => void
  /** Duplicates the current selection in place, immediately after the latest end-time in the
   * group (preserving relative spacing), and selects the new copies. Self-checkpointing. */
  duplicateSelection: () => void
  /** Deletes every currently-selected keyframe/sticker/marker. Never empties the pose track
   * entirely (matches the old deleteKeyframe's guard) — other tracks can go to empty (which
   * just means "fully inherit the pose track" again). Self-checkpointing. */
  deleteSelection: () => void

  // expressions
  addExpression: (name: string, folderId?: string | null) => void
  applyExpression: (id: string) => void
  saveExpression: (id: string) => void
  renameExpression: (id: string, name: string) => void
  deleteExpression: (id: string) => void
  reorderExpression: (id: string, newIndex: number) => void
  // Expressions-panel folder tree (editor organization only — mirrors the Animation panel actions).
  addExpressionFolder: (parentId: string | null, name?: string) => string
  renameExpressionFolder: (id: string, name: string) => void
  deleteExpressionFolder: (id: string) => void
  setExpressionFolderExpanded: (id: string, expanded: boolean) => void
  moveExpressionToFolder: (expressionId: string, targetFolderId: string | null, index: number) => void
  moveExpressionFolder: (folderId: string, targetParentId: string | null, index: number) => void

  // auth
  setAuthSession: (email: string | null) => void
  setAuthChecked: (checked: boolean) => void

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
  toggleEsp32Preview: () => void
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
  /** Ephemeral copy/paste clipboard for copySticker()/pasteSticker() — never saved to the
   * project, same convention as devModeOpen/esp32PreviewMode above. */
  stickerClipboard: StickerInstance | null
  setStickerScope: (scope: StickerScope) => void
  selectSticker: (id: string | null) => void
  addSticker: (assetId: string, layer?: StickerLayer) => string | null
  duplicateSticker: (id: string) => string | null
  deleteSticker: (id: string) => void
  updateSticker: (id: string, partial: Partial<StickerInstance>) => void
  renameSticker: (id: string, name: string) => void
  setStickerVisible: (id: string, visible: boolean) => void
  setStickerLocked: (id: string, locked: boolean) => void
  /** In-memory only (not persisted) — copies one sticker's full settings so pasteSticker()
   * can drop an identical instance into whichever scope is active when Paste is clicked,
   * including a different scope/expression than the one it was copied from. */
  copySticker: (id: string) => void
  /** Pastes the last copySticker() sticker into the current scope's list, with a new id (and
   * trackId reset — a pasted sticker starts ungrouped even if the original was on a track,
   * since that track may not exist in this scope). No-op if nothing has been copied. */
  pasteSticker: () => string | null
  /** Swaps this sticker's `order` with its neighbor in the same direction, within its own
   * layer only — matches the Sticker Manager's "reorder within the same layer" list. */
  moveStickerOrder: (id: string, direction: 'up' | 'down') => void
  applyStickerPreset: (presetId: string) => void
  /** Appends a new imported (raster) sticker asset to the project's reusable library —
   * same "asset, then place instances that reference it" split addCustomPupilShape()
   * established for pupil shapes. Returns the new asset's id. */
  addStickerAsset: (asset: Omit<StickerAsset, 'id'>) => string
  /** Persists the studio-computed recolor result for one svg-kind sticker instance — see
   * StickerInstance.resolvedSvg's own comment for why this needs to be computed here (DOM
   * available) and stored, not recomputed at export time (no DOM there). */
  setStickerResolvedSvg: (id: string, resolved: { dataUrl: string; rgba: { width: number; height: number; data: number[] } } | null) => void
  deleteStickerAsset: (id: string) => void

  // UI Design Mode — see types/uiDesign.ts. Entirely independent of every action above:
  // nothing here reads or writes project.eyeBase/animations/expressions/stickers/etc.
  selectedWidgetId: string | null
  selectUiWidget: (id: string | null) => void
  /** Creates a widget of `type` as a child of `parentId` (typically the active screen's root)
   * at (x, y), selects it, and returns its id. `type === 'keyboard'` additionally creates two
   * linked sibling widgets (a 'textarea' output area and a 'label' debug/event-info panel) and
   * wires keyboardConfig.targetTextareaId/debugLabelId to them — real LVGL has no combined
   * keyboard+textarea widget either, so "drop one Keyboard" -> "get three linked objects" is
   * the truthful shape, not a shortcut. */
  addUiWidget: (type: UiWidgetType, parentId: string, x: number, y: number) => string
  /** Drops a Professional Component template (see lib/uiDesign/componentTemplates.ts) — a
   * pre-styled group of ordinary widget types (container/label/button), not a new UiWidgetType, so
   * it exports through the exact same codegen every other widget already uses. */
  addUiComponentTemplate: (templateId: ComponentTemplateId, parentId: string, x: number, y: number) => string
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
  updateUiWidgetMeta: (
    id: string,
    partial: {
      tagId?: string | null
      classNames?: string[]
      allowOutsideBounds?: boolean
      eventCallbackEnabled?: boolean
      eventCallbackTriggers?: string[]
      focusable?: boolean
      iconSymbol?: string | null
      visibleWhenExpr?: string | null
    }
  ) => void
  /** Sets/clears which project theme token (see UiThemeableStyleField) one of this widget's own
   * color fields should track instead of its literal value — see lib/uiDesign/themes.ts. Passing
   * `null` reverts that field to its plain literal value (unchanged, still whatever it was). */
  setUiWidgetThemeToken: (id: string, field: UiThemeableStyleField, token: keyof UiThemeTokens | null) => void
  /** Merges a Material Preset's style + state-style bundle (see lib/uiDesign/materialPresets.ts)
   * into a widget — a starting point, not a locked mode; every field it sets stays editable
   * afterward through the normal Appearance controls. */
  applyMaterialPreset: (id: string, presetId: MaterialPresetId) => void
  /** Project-level theme (see lib/uiDesign/themes.ts's UI_THEMES) — only visibly affects widgets
   * that opted a color field into theming via setUiWidgetThemeToken; a project using no tokens at
   * all sees zero visual change when this changes. */
  setUiTheme: (theme: UiThemeId) => void
  setUiCustomThemeTokens: (partial: Partial<UiThemeTokens>) => void

  // UI Design Mode — LVGL Code panel manual-edit override (see UiScreen.customCode in
  // types/uiDesign.ts and LvglCodePanel.tsx for the full picture).
  applyUiScreenCustomCode: (screenId: string, code: string, generatedBaseline: string) => void
  resetUiScreenCustomCode: (screenId: string) => void
  /** Forward-sync only (WIDGETS -> CODE) — rewrites the recognized calls already inside an
   * applied override to match current widget values (see codeSync.ts's patchCodeWithWidgetValues).
   * Not a user-initiated edit — no checkpoint semantics implied, callers don't call checkpoint()
   * first (the actual undoable action was whatever widget edit triggered this patch). */
  patchUiScreenCustomCode: (screenId: string, code: string) => void

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

  // UI Design Mode — Variable Manager (see UiVariable in types/uiDesign.ts). A variable's live
  // VALUE while the script sandbox is running lives in runtimeVariableValues below, not here —
  // this is the persisted declaration (name/type/scope/default/...) only.
  addUiVariable: (name: string, type: UiVariable['type'], scope: UiVariable['scope']) => string
  updateUiVariable: (id: string, partial: Partial<Omit<UiVariable, 'id'>>) => void
  deleteUiVariable: (id: string) => void
  duplicateUiVariable: (id: string) => string | null
  /** Live values for every UiVariable while the script sandbox is running — keyed by variable
   * NAME (what `data.<name>` in script/preview reads), not id, since that's what both the
   * sandbox's `data` object and Data Binding expressions address them by. Seeded from each
   * variable's `defaultValue` on Start, reset on Stop — same "runtime-only, never leaks into the
   * saved design" contract as restoreUiRuntimeSnapshot below. The Variable Manager panel's
   * "current value" column reads this same state, so editing from script and watching from the
   * panel always agree. */
  runtimeVariableValues: Record<string, string | number | boolean>
  setRuntimeVariableValue: (name: string, value: string | number | boolean) => void
  resetRuntimeVariableValues: () => void

  // UI Design Mode — Data Source Manager (see UiDataSource in types/uiDesign.ts). Same shape as
  // the Variable Manager actions above: a declared/persisted model here, live row data in
  // runtimeDataListItems below. Field CRUD mirrors the List Items editor's own
  // add/update/delete/reorder shape (see addUiListItem etc. further down).
  addUiDataSource: () => string
  updateUiDataSource: (id: string, partial: Partial<Omit<UiDataSource, 'id'>>) => void
  deleteUiDataSource: (id: string) => void
  duplicateUiDataSource: (id: string) => string | null
  addUiDataSourceField: (dataSourceId: string) => string
  updateUiDataSourceField: (dataSourceId: string, fieldId: string, partial: Partial<Omit<UiDataSourceField, 'id'>>) => void
  deleteUiDataSourceField: (dataSourceId: string, fieldId: string) => void
  reorderUiDataSourceField: (dataSourceId: string, fromIndex: number, toIndex: number) => void
  /** Live rows for a `dataList` widget while the script sandbox is running — keyed by WIDGET id
   * (not data source id, since two Data Lists can share one source with independently-mutated
   * runtime rows), same "separate from the persisted declaration, reset on Stop" contract as
   * runtimeVariableValues above. Falls back to the assigned UiDataSource's own `sampleData`
   * (JSON.parse'd) until a script action (setListItems/addListItem/...) writes here — see
   * WidgetRenderer.tsx's Data List rendering and scriptLang/sandboxRuntime.ts. */
  runtimeDataListItems: Record<string, unknown[]>
  setRuntimeDataListItems: (widgetId: string, items: unknown[]) => void
  resetRuntimeDataListItems: () => void

  /** Live, per-keyboard-widget interactive state for the running preview (typed text, cursor,
   * current language/case/page, last action/callback/character) — ephemeral like
   * runtimeVariableValues above, never persisted, reset on Stop the same way. See
   * UiKeyboardRuntimeState's own doc comment (keyboardLayouts.ts) for the full field list. */
  keyboardRuntime: Record<string, UiKeyboardRuntimeState>
  setKeyboardRuntimeState: (widgetId: string, partial: Partial<UiKeyboardRuntimeState>) => void
  resetKeyboardRuntime: () => void

  /** Simulated rotary-encoder navigation for the live preview (Logic tab's Simulate section) —
   * mirrors the real per-screen `lv_group_t` focus-group behavior every exported screen gets
   * (see lvglExport.ts's screenFocusNextFnName/etc.): `simulatedFocusWidgetId` cycles through the
   * active screen's focusable widgets; pressing while a keyboard widget is focused enters
   * "editing" (`simulatedFocusEditing`), where Next/Previous instead cycle that keyboard's own
   * keys (`simulatedFocusKeyId`) and Press activates the highlighted key — the same two-level
   * navigate/edit split LVGL's own group model uses. Ephemeral, reset on Stop like the other
   * runtime-only state above. */
  simulatedFocusWidgetId: string | null
  simulatedFocusEditing: boolean
  simulatedFocusKeyId: string | null
  simulateFocusNext: () => void
  simulateFocusPrevious: () => void
  simulateFocusPress: () => void
  resetSimulatedFocus: () => void

  // UI Design Mode — script runtime support (see lib/uiDesign/scriptLang/). updateUiWidgetProps
  // and setUiActiveScreen are also general-purpose, not just for the script sandbox.
  updateUiWidgetProps: (id: string, partial: Record<string, string | number | boolean>) => void
  // List Items editor (only meaningful for widget.type === 'list' — see UiListItem). Callers
  // checkpoint() before invoking, same convention as every other UI Design widget mutator above.
  addUiListItem: (widgetId: string) => string
  updateUiListItem: (widgetId: string, itemId: string, partial: Partial<UiListItem>) => void
  deleteUiListItem: (widgetId: string, itemId: string) => void
  duplicateUiListItem: (widgetId: string, itemId: string) => string | null
  reorderUiListItem: (widgetId: string, fromIndex: number, toIndex: number) => void
  // Keyboard widget config (only meaningful for widget.type === 'keyboard' — see UiKeyboardConfig)
  // + its custom-layout key editor, same CRUD/reorder shape as the List Items editor above but
  // over a flat UiKeyboardCustomKey[] (see UiKeyboardCustomLayout's own doc comment for why a
  // flat, `newRow`-flagged list was chosen over rows-of-rows).
  updateUiKeyboardConfig: (widgetId: string, partial: Partial<UiKeyboardConfig>) => void
  addUiKeyboardCustomKey: (widgetId: string) => string
  updateUiKeyboardCustomKey: (widgetId: string, keyId: string, partial: Partial<UiKeyboardCustomKey>) => void
  deleteUiKeyboardCustomKey: (widgetId: string, keyId: string) => void
  reorderUiKeyboardCustomKey: (widgetId: string, fromIndex: number, toIndex: number) => void
  // Data List widget config (only meaningful for widget.type === 'dataList' — see UiDataListConfig).
  updateUiDataListConfig: (widgetId: string, partial: Partial<UiDataListConfig>) => void
  // Options Source binding (only meaningful for dropdown/roller/tabs — see UiOptionsSourceConfig).
  updateUiWidgetOptionsSource: (widgetId: string, partial: Partial<UiOptionsSourceConfig>) => void
  // Custom LVGL fonts (project.uiDesign.customFonts — see UiCustomFont). declaredCodepoints is
  // parsed once here (see lib/uiDesign/fontImport.ts), not re-derived at render time.
  addUiCustomFont: (name: string, cSource: string) => string
  renameUiCustomFont: (id: string, name: string) => void
  deleteUiCustomFont: (id: string) => void
  setUiActiveScreen: (screenId: string) => void
  /** Remembered per-screen selection (screenId -> selectedWidgetId), so switching screen tabs
   * restores whatever layer was selected on the screen you return to — session-only. */
  uiScreenSelection: Record<string, string | null>
  /** Creates a new empty screen (its own `screen`-type root widget), makes it active, returns its
   * id. `name` defaults to a unique "Screen N". Caller checkpoint()s first. */
  addUiScreen: (name?: string) => string
  /** Renames a screen. The screen keeps its stable id; also rewrites `ui.showScreen("old")` script
   * references to the new name so navigation survives the rename. */
  renameUiScreen: (screenId: string, name: string) => void
  /** Deep-clones a screen (its whole widget subtree, re-id'd) as a new screen right after it, makes
   * the copy active, returns its id. Caller checkpoint()s first. */
  duplicateUiScreen: (screenId: string) => string | null
  /** Removes a screen and its entire widget subtree. No-op if it's the last remaining screen.
   * Re-points activeScreenId if the deleted screen was active. */
  deleteUiScreen: (screenId: string) => void
  /** Reorders the screen tab list (drag-and-drop). Indices are into `uiDesign.screens`. */
  reorderUiScreens: (fromIndex: number, toIndex: number) => void
  /** Updates ONE screen's own visual display style (background color/opacity), independent per
   * screen. Hardware/display config stays global in setUiDisplaySettings. Caller checkpoint()s. */
  setUiScreenStyle: (screenId: string, partial: Partial<UiScreenDisplayStyle>) => void
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
  /** UI Design Mode's own "ESP32 Preview" — the LVGL-workspace equivalent of Eye Studio's
   * esp32PreviewMode above (same ephemeral, never-persisted convention). Swaps the live canvas
   * to render the way the exported LVGL firmware actually will: RGB565 color quantization (see
   * lib/color.ts's quantizeToRgb565, the same helper Eye Studio's ESP32 Preview already uses),
   * a single real shadow per widget instead of the richer multi-layer glow+shadow preview
   * (LVGL only has one shadow per style part — see lib/export/lvglExport.ts's
   * resolveEffectiveShadow, shared with the real exporter so this can't drift from what
   * styleSetCalls() actually emits), and font sizes snapped to the nearest built-in Montserrat
   * size instead of arbitrary CSS pixel sizes. */
  uiEsp32PreviewMode: boolean
  toggleUiEsp32Preview: () => void
  /** Which widget state the canvas simulates for the SELECTED widget, so the user can preview
   * hover/pressed/disabled/focused before exporting. 'default' = normal. Ephemeral (never
   * persisted), same convention as uiEsp32PreviewMode. The Properties panel's state tab is bound
   * to this, so switching the tab you edit also renders that state on the canvas. */
  uiPreviewState: 'default' | UiWidgetStateName
  setUiPreviewState: (state: 'default' | UiWidgetStateName) => void

  // UI Design Mode — canvas zoom/pan/rulers/snap/grid preferences (UiWorkspaceViewSettings,
  // see its own doc comment in types/uiDesign.ts for why this lives in EditorState/here rather
  // than on project.uiDesign — in short: undo/redo swaps `project` wholesale, and a view
  // preference must never be reverted by an unrelated Ctrl+Z).
  uiWorkspaceView: UiWorkspaceViewSettings
  /** Deliberately does NOT require the caller to checkpoint() first — a documented deviation
   * from this store's usual "caller checkpoints before every mutator" convention. Zoom/pan/
   * grid/snap settings are view preferences, not design decisions; making every zoom tick or
   * pan drag its own undo-stack entry would make Ctrl+Z useless for real edits. Safe by
   * construction (not just by convention) since uiWorkspaceView lives outside `s.project` and
   * so is never touched by undo()/redo()'s `s.project = prev` swap. */
  updateUiWorkspaceView: (partial: Partial<UiWorkspaceViewSettings>) => void
  /** The single piece of transient per-frame drag/resize state — written by WidgetRenderer's
   * pointer-move handlers on every move, cleared on pointer-up. Read by Canvas.tsx to render
   * ruler markers, alignment guides, spacing labels, and the floating position-info panel from
   * one source, instead of each overlay re-deriving drag state independently. Never persisted. */
  uiDragPreview: UiDragPreview | null
  setUiDragPreview: (preview: UiDragPreview | null) => void
  /** The Canvas viewport div's measured size (via ResizeObserver in Canvas.tsx) — read by
   * UiDesignTopBar's Fit-to-Workspace/Fit-Width buttons (see lib/uiDesign/canvasZoom.ts) since
   * those need to know the available screen space and only Canvas.tsx can measure it. Never
   * persisted. Null until Canvas.tsx has mounted and measured at least once. */
  uiCanvasViewportSize: { width: number; height: number } | null
  setUiCanvasViewportSize: (size: { width: number; height: number } | null) => void
  /** Brief "just selected this from the Layers panel" flash, distinct from the A6
   * affected-widget-highlight channel (which means "a running script's action touched this
   * widget") — a different trigger deserves its own channel rather than overloading that one.
   * Set by LayersPanel's row click, auto-cleared via setTimeout. Never persisted. */
  uiRevealWidgetId: string | null
  setUiRevealWidgetId: (id: string | null) => void
}

/** A single alignment guide line to render while dragging/resizing — 'x' guides are vertical
 * lines (constant x), 'y' guides are horizontal lines (constant y). `label` is set only for the
 * center-alignment cases the spec calls out explicitly ("Centered horizontally" etc). */
export interface UiSnapGuide {
  axis: 'x' | 'y'
  value: number
  source: string
  label?: string
}

/** A "N px" spacing readout between the dragged/resized widget and its nearest neighbor on one
 * axis, rendered at the gap's midpoint. */
export interface UiSpacingIndicator {
  axis: 'x' | 'y'
  distancePx: number
  /** Midpoint of the gap, in the same logical display-px space as everything else. */
  x: number
  y: number
}

export interface UiDragPreview {
  widgetId: string
  rect: { x: number; y: number; width: number; height: number }
  guides: UiSnapGuide[]
  spacing: UiSpacingIndicator[]
}

// ---- Animation-panel folder tree helpers (editor organization only) ----------------------------
/** Reassign 0..n `order` to the folders sharing a parent, preserving current relative order. */
// ---- Shared folder-tree helpers (used by BOTH the Animation and Expression panel trees) ----------
// Folders (AnimationFolder / ExpressionFolder) and items (Animation / Expression) share the same
// shape here — `parentId`/`order` on folders, `folderId`/`order` on items — so these helpers are
// generic and both panels reuse them, keeping the two trees behaviourally identical.
type FolderLike = { id: string; parentId: string | null; order: number }
type FiledItem = { id: string; folderId?: string | null; order?: number }

/**
 * Normalised name key used for duplicate detection — lowercased with all non-alphanumerics stripped,
 * so it matches exactly when two names would collide into the same exported C++ identifier
 * (toIdentifier() in cppExport.ts): "Look Up Right", "LookUpRight" and "look-up-right" all map here to
 * "lookupright". Panels use this to flag duplicates; the store uses it to auto-suffix new names.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Returns `base` if its normalized form is free among `existing`, else `base 2`, `base 3`, … so a
 * newly-created animation/expression/combination never duplicates an existing name. */
function uniqueName(base: string, existing: string[]): string {
  const taken = new Set(existing.map(normalizeName))
  const trimmed = base.trim() || 'Untitled'
  if (!taken.has(normalizeName(trimmed))) return trimmed
  let n = 2
  while (taken.has(normalizeName(`${trimmed} ${n}`))) n++
  return `${trimmed} ${n}`
}

/** Reassign 0..n `order` to the folders sharing a parent (root = null). */
function reindexFolders<T extends FolderLike>(folders: T[], parentId: string | null): void {
  folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .forEach((f, i) => (f.order = i))
}
/** Reassign 0..n `order` to the items sharing a folder (root = null). */
function reindexItems<T extends FiledItem>(items: T[], folderId: string | null): void {
  items
    .filter((a) => (a.folderId ?? null) === folderId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((a, i) => (a.order = i))
}
/** Place `movedId` at position `index` among the target folder's items, then reassign 0..n.
 * The moved item's `folderId` must already equal `folderId` before calling. */
function insertItemAt<T extends FiledItem>(items: T[], folderId: string | null, movedId: string, index: number): void {
  const group = items
    .filter((a) => (a.folderId ?? null) === folderId && a.id !== movedId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const moved = items.find((a) => a.id === movedId)
  if (!moved) return
  const at = Math.max(0, Math.min(group.length, index))
  group.splice(at, 0, moved)
  group.forEach((a, i) => (a.order = i))
}
/** Same, for a folder among its (new) parent's sub-folders. `parentId` must already be set. */
function insertFolderAt<T extends FolderLike>(folders: T[], parentId: string | null, movedId: string, index: number): void {
  const group = folders
    .filter((f) => f.parentId === parentId && f.id !== movedId)
    .sort((a, b) => a.order - b.order)
  const moved = folders.find((f) => f.id === movedId)
  if (!moved) return
  const at = Math.max(0, Math.min(group.length, index))
  group.splice(at, 0, moved)
  group.forEach((f, i) => (f.order = i))
}
/** True if moving `folderId` under `targetParentId` would create a cycle (target IS the folder or a
 * descendant of it). Prevents an "into its own child" drop. */
function wouldCycleFolder<T extends FolderLike>(folders: T[], folderId: string, targetParentId: string | null): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]))
  let cur: string | null = targetParentId
  while (cur) {
    if (cur === folderId) return true
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

function activeAnimationOf(project: Project, id: string): Animation | undefined {
  return project.animations.find((a) => a.id === id)
}

function activeComboOf(project: Project, id: string | null): AnimationCombo | undefined {
  return id ? project.animationCombos.find((c) => c.id === id) : undefined
}

/** UI Design Mode's active screen's own encoder-focusable widgets, in the same tree-creation
 * order the exported firmware's per-screen `lv_group_t` will add them in (see
 * lvglExport.ts's `EVENT_CAPABLE_WIDGET_TYPES`/`isFocusable` checks) — backs the simulated-
 * encoder-navigation store actions below. 'keyboard' is added on top of EVENT_CAPABLE_WIDGET_TYPES
 * since a keyboard is always focusable regardless of its own eventCallbackEnabled setting. */
function focusableWidgetsForActiveScreen(project: Project): UiWidget[] {
  const ud = project.uiDesign
  const screen = ud.screens.find((sc) => sc.id === ud.activeScreenId)
  if (!screen) return []
  return reachableWidgetsForScreen(ud, screen).filter((w) => EVENT_CAPABLE_WIDGET_TYPES.has(w.type) || w.type === 'keyboard')
}

/** The single source of truth for "is the bottom Timeline / center PreviewCanvas currently
 * showing a Combination instead of the active Animation" — shared by both so they can never
 * disagree (the exact bug class hit previously: PreviewCanvas's own inline version of this
 * condition silently blocked real Animate-mode playback whenever leftTab was still stuck on
 * 'combinations'). A genuinely-playing real animation always wins over a merely-selected combo. */
export function isComboTimelineActive(s: Pick<StoreState, 'leftTab' | 'selectedComboId' | 'mode' | 'playbackState'>): boolean {
  return s.leftTab === 'combinations' && s.selectedComboId != null && !(s.mode === 'animate' && s.playbackState === 'playing')
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

/** Resolves which of an Animation's 5 keyframe arrays a given track kind reads from — the one
 * place that mapping is spelled out, so every timeline action agrees on it. Returns the live
 * draft array reference (push/splice/sort on it mutates the project); for *reassigning* the
 * whole array (e.g. filtering it down), use setKeyframeListFor instead, since writing through
 * a returned reference can't replace which array a field points to. */
function keyframeListFor(a: Animation, trackKind: KeyframeTrackKind): Keyframe[] {
  switch (trackKind) {
    case 'pose':
      return a.keyframes
    case 'leftEye':
      return a.leftEyeKeyframes
    case 'rightEye':
      return a.rightEyeKeyframes
    case 'pupils':
      return a.pupilKeyframes
    case 'eyelids':
      return a.eyelidKeyframes
  }
}

function setKeyframeListFor(a: Animation, trackKind: KeyframeTrackKind, list: Keyframe[]): void {
  if (trackKind === 'pose') a.keyframes = list
  else if (trackKind === 'leftEye') a.leftEyeKeyframes = list
  else if (trackKind === 'rightEye') a.rightEyeKeyframes = list
  else if (trackKind === 'pupils') a.pupilKeyframes = list
  else a.eyelidKeyframes = list
}

/** Pushes a checkpoint onto the undo stack from inside an in-progress Immer producer — the
 * same body `checkpoint()` (the standalone action) runs, just callable as a plain function so
 * the ~15 new one-shot timeline actions can self-checkpoint (push once, then mutate, all in
 * the same `set()` call) instead of requiring the UI to remember a separate checkpoint() call
 * before each one, the single biggest error class with the old manual-everywhere pattern.
 * Continuous-drag actions (setKeyframeTime, moveSelectionByDelta, resizeStickerClip) deliberately
 * do NOT use this — those still rely on the UI calling checkpoint() once at drag-start, exactly
 * like the pre-existing updateKeyframeDuration did, so a whole drag stays one undo entry. */
function checkpointDraft(s: StoreState): void {
  s.past.push(JSON.parse(JSON.stringify(s.project)))
  if (s.past.length > HISTORY_LIMIT) s.past.shift()
  s.future = []
}

/** Mirrors a single-item timelineSelection into the legacy single-id selectedKeyframeId/
 * selectedStickerId fields (both cleared for an empty or multi-item selection) so existing
 * single-target panels (ControlsPanel, StickerControls, EasingPicker) keep working unmodified
 * against whichever one timeline item is selected, without needing to know multi-select exists. */
function syncPrimarySelection(s: StoreState): void {
  if (s.timelineSelection.length === 1) {
    const item = s.timelineSelection[0]
    s.selectedKeyframeId = item.kind === 'keyframe' ? item.id : null
    s.selectedStickerId = item.kind === 'sticker' ? item.id : null
  } else {
    s.selectedKeyframeId = null
    s.selectedStickerId = null
  }
}

/** Deep-copies whatever `selection` currently points to into clipboard-entry shape — shared by
 * copySelection (session clipboard) and duplicateSelection (which builds entries from the
 * live selection directly, without touching whatever's already in the clipboard). Only ever
 * called for the animation-editing path (comboClip selections go through
 * collectComboClipboardEntries instead) — the final branch is guarded explicitly rather than a
 * catch-all `else`, so a stray comboClip-kind item in `selection` (which should never happen,
 * but costs nothing to guard) is skipped instead of mis-handled as a marker. */
function collectClipboardEntries(project: Project, a: Animation, selection: SelectionItem[]): TimelineClipboardEntry[] {
  const entries: TimelineClipboardEntry[] = []
  for (const item of selection) {
    if (item.kind === 'keyframe') {
      const list = keyframeListFor(a, item.trackId as KeyframeTrackKind)
      const kf = list.find((k) => k.id === item.id)
      if (kf) entries.push({ kind: 'keyframe', trackKind: item.trackId as KeyframeTrackKind, data: JSON.parse(JSON.stringify(kf)) })
    } else if (item.kind === 'sticker') {
      const owner = findStickerOwner(project, item.id)
      if (owner) entries.push({ kind: 'sticker', data: JSON.parse(JSON.stringify(owner.list[owner.index])) })
    } else if (item.kind === 'marker') {
      const m = a.markers.find((mk) => mk.id === item.id)
      if (m) entries.push({ kind: 'marker', data: JSON.parse(JSON.stringify(m)) })
    }
  }
  return entries
}

/** Deep-copies whatever `selection` currently points to (comboClip items only) into
 * clipboard-entry shape — the combo-editing sibling of collectClipboardEntries, sharing the
 * same TimelineClipboardEntry shape so one timelineClipboard can hold either kind (the paste
 * side filters by kind, see pasteSelectionAt/duplicateSelection). */
function collectComboClipboardEntries(combo: AnimationCombo, selection: SelectionItem[]): TimelineClipboardEntry[] {
  const entries: TimelineClipboardEntry[] = []
  for (const item of selection) {
    if (item.kind !== 'comboClip') continue
    const clip = combo.clips.find((c) => c.id === item.id)
    if (clip) entries.push({ kind: 'comboClip', data: JSON.parse(JSON.stringify(clip)) })
  }
  return entries
}

/** Inserts a set of clipboard entries into the active animation, anchored so the *earliest*
 * entry lands exactly at `atMs` and every other entry keeps its original offset from that one
 * — shared by pasteSelectionAt (entries = timelineClipboard) and duplicateSelection (entries =
 * a fresh copy of the current selection, anchored just after the group's own end instead of
 * the playhead). Returns the newly-inserted items as a ready-to-select SelectionItem[]. Only
 * ever called with keyframe/sticker/marker entries (comboClip entries go through
 * insertComboClipEntriesAt instead) — callers filter by kind before calling this. */
function insertTimelineEntriesAt(a: Animation, entries: TimelineClipboardEntry[], atMs: number): SelectionItem[] {
  if (entries.length === 0) return []
  const timeOf = (e: TimelineClipboardEntry) => (e.kind === 'sticker' ? e.data.anim.startTimeMs : e.kind === 'comboClip' ? e.data.startTimeMs : e.data.timeMs)
  const anchor = Math.min(...entries.map(timeOf))
  const delta = Math.max(0, Math.round(atMs)) - anchor
  const newSelection: SelectionItem[] = []
  for (const entry of entries) {
    if (entry.kind === 'keyframe') {
      const list = keyframeListFor(a, entry.trackKind)
      const copy: Keyframe = { ...entry.data, id: nanoid(10) }
      copy.timeMs = Math.max(0, copy.timeMs + delta)
      list.push(copy)
      list.sort((x, y) => x.timeMs - y.timeMs)
      if (entry.trackKind === 'pose') a.durationMs = Math.max(a.durationMs, copy.timeMs)
      newSelection.push({ kind: 'keyframe', trackId: entry.trackKind, id: copy.id })
    } else if (entry.kind === 'sticker') {
      const copy: StickerInstance = { ...entry.data, id: nanoid(8) }
      const span = copy.anim.endTimeMs != null ? copy.anim.endTimeMs - copy.anim.startTimeMs : null
      copy.anim.startTimeMs = Math.max(0, copy.anim.startTimeMs + delta)
      copy.anim.endTimeMs = span != null ? copy.anim.startTimeMs + span : null
      a.stickers.push(copy)
      newSelection.push({ kind: 'sticker', trackId: copy.trackId, id: copy.id })
    } else if (entry.kind === 'marker') {
      const copy: Marker = { ...entry.data, id: nanoid(8) }
      copy.timeMs = Math.max(0, copy.timeMs + delta)
      a.markers.push(copy)
      a.markers.sort((x, y) => x.timeMs - y.timeMs)
      newSelection.push({ kind: 'marker', trackId: 'marker', id: copy.id })
    }
  }
  return newSelection
}

/** Inserts comboClip clipboard entries into `combo`, same anchor-earliest-at-atMs/preserve-
 * relative-offset contract as insertTimelineEntriesAt — the combo-editing sibling. Every
 * pasted/duplicated clip gets a fresh id; `animationId` carries through verbatim (see
 * TimelineClipboardEntry's comment on the "Missing animation" fallback for a dangling id). */
function insertComboClipEntriesAt(combo: AnimationCombo, entries: TimelineClipboardEntry[], atMs: number): SelectionItem[] {
  const comboEntries = entries.filter((e): e is Extract<TimelineClipboardEntry, { kind: 'comboClip' }> => e.kind === 'comboClip')
  if (comboEntries.length === 0) return []
  const anchor = Math.min(...comboEntries.map((e) => e.data.startTimeMs))
  const delta = Math.max(0, Math.round(atMs)) - anchor
  const newSelection: SelectionItem[] = []
  for (const entry of comboEntries) {
    const copy: AnimationComboClip = { ...entry.data, id: nanoid(10) }
    copy.startTimeMs = Math.max(0, Math.round(copy.startTimeMs + delta))
    combo.clips.push(copy)
    newSelection.push({ kind: 'comboClip', trackId: combo.id, id: copy.id })
  }
  combo.clips.sort((x, y) => x.startTimeMs - y.startTimeMs)
  return newSelection
}

export const useStore = create<StoreState>()(
  immer((set) => ({
    project: createDefaultProject(),
    filePath: null,
    dirty: false,
    saveStatus: 'idle',
    workspace: 'home',
    authChecked: false,
    authenticated: false,
    authUserEmail: null,

    activeAnimationId: '',
    selectedKeyframeId: null,
    selectedExpressionId: null,
    keyframeClipboard: null,
    timelineSelection: [],
    timelineClipboard: [],
    snappingEnabled: true,
    snapIntervalMs: 0,
    eyelidPreviewClose: 0,
    eyeTarget: 'both',

    stickerScope: 'project',
    selectedStickerId: null,
    stickerClipboard: null,
    layerClipboard: null,
    selectedWidgetId: null,
    uiScreenSelection: {},
    uiPreviewDisplayOverride: null,
    uiEsp32PreviewMode: false,
    uiPreviewState: 'default',
    uiWorkspaceView: defaultUiWorkspaceView(),
    uiDragPreview: null,
    uiCanvasViewportSize: null,
    uiRevealWidgetId: null,

    mode: 'design',
    playbackState: 'stopped',
    playbackTimeMs: 0,

    selectedComboId: null,
    selectedComboClipId: null,
    comboPreviewPlaying: false,
    comboPreviewTimeMs: 0,
    comboPreviewLoop: true,

    devModeOpen: false,
    esp32PreviewMode: false,
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
        s.timelineSelection = []
        s.eyeTarget = 'both'
        s.mode = 'design'
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
        s.uiWorkspaceView = defaultUiWorkspaceView()
        s.uiDragPreview = null
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
        s.timelineSelection = []
        s.eyeTarget = editorState.eyeTarget
        s.mode = editorState.mode
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
        s.uiWorkspaceView = editorState.uiWorkspaceView
        s.uiDragPreview = null
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

    setLayerVisible: (kind, visible) =>
      set((s) => {
        if (kind === 'stickers') {
          const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
          if (list) for (const st of list) st.visible = visible
        } else {
          const field = LAYER_VISIBLE_FIELD[kind]
          if (field.obj === 'params') writeEyeTarget(s, s.eyeTarget, 'params', { [field.key]: visible } as Partial<EyeParams>)
          else writeEyeTarget(s, s.eyeTarget, 'colors', { [field.key]: visible } as Partial<EyeColors>)
        }
        s.dirty = true
      }),

    setLayerLocked: (kind, locked) =>
      set((s) => {
        if (kind === 'stickers') {
          const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
          if (list) for (const st of list) st.locked = locked
        } else {
          const field = LAYER_LOCKED_FIELD[kind]
          if (field.obj === 'params') writeEyeTarget(s, s.eyeTarget, 'params', { [field.key]: locked } as Partial<EyeParams>)
          else writeEyeTarget(s, s.eyeTarget, 'colors', { [field.key]: locked } as Partial<EyeColors>)
        }
        s.dirty = true
      }),

    duplicateLayerToOtherEye: (kind) =>
      set((s) => {
        if (kind === 'stickers') {
          const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
          if (!list) return
          for (const st of [...list]) list.push({ ...JSON.parse(JSON.stringify(st)), id: nanoid(8) })
          s.dirty = true
          return
        }
        if (s.eyeTarget === 'both') return // no single source side to copy from
        const fromSide = s.eyeTarget
        const toSide = fromSide === 'left' ? 'right' : 'left'
        const srcParams = fromSide === 'left' ? leftEyeParams(s.project) : rightEyeParams(s.project)
        const srcColors = fromSide === 'left' ? leftEyeColors(s.project) : rightEyeColors(s.project)
        const payload = collectLayerPayload(kind, srcParams, srcColors)
        if (Object.keys(payload.params).length > 0) writeEyeSide(s, toSide, 'params', payload.params)
        if (Object.keys(payload.colors).length > 0) writeEyeSide(s, toSide, 'colors', payload.colors)
        s.dirty = true
      }),

    copyLayerToClipboard: (kind) =>
      set((s) => {
        if (kind === 'stickers') {
          const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
          s.layerClipboard = list ? { kind, payload: JSON.parse(JSON.stringify(list)) } : null
          return
        }
        const params = effectiveEyeParams(s.project, s.eyeTarget)
        const colors = effectiveEyeColors(s.project, s.eyeTarget)
        s.layerClipboard = { kind, payload: collectLayerPayload(kind, params, colors) }
      }),

    pasteLayerFromClipboard: (kind, target) =>
      set((s) => {
        const clip = s.layerClipboard
        if (!clip || clip.kind !== kind) return
        if (kind === 'stickers') {
          const stickers = clip.payload as StickerInstance[]
          const destList =
            target === 'base'
              ? resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
              : s.project.expressions.find((e) => e.id === target)?.stickers
          if (!destList) return
          for (const st of stickers) destList.push({ ...JSON.parse(JSON.stringify(st)), id: nanoid(8) })
          s.dirty = true
          return
        }
        const payload = clip.payload as LayerClipboardPayload
        if (target === 'base') {
          if (Object.keys(payload.params).length > 0) writeEyeTarget(s, s.eyeTarget, 'params', payload.params)
          if (Object.keys(payload.colors).length > 0) writeEyeTarget(s, s.eyeTarget, 'colors', payload.colors)
        } else {
          const expr = s.project.expressions.find((e) => e.id === target)
          if (!expr) return
          Object.assign(expr.params, payload.params)
          Object.assign(expr.colors, payload.colors)
        }
        s.dirty = true
      }),

    applyLayerToAllExpressions: (kind) =>
      set((s) => {
        if (kind === 'stickers') {
          const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
          if (!list) return
          const copy = JSON.parse(JSON.stringify(list)) as StickerInstance[]
          for (const expr of s.project.expressions) {
            expr.stickers = copy.map((st) => ({ ...JSON.parse(JSON.stringify(st)), id: nanoid(8) }))
          }
          s.dirty = true
          return
        }
        const params = effectiveEyeParams(s.project, s.eyeTarget)
        const colors = effectiveEyeColors(s.project, s.eyeTarget)
        const payload = collectLayerPayload(kind, params, colors)
        for (const expr of s.project.expressions) {
          Object.assign(expr.params, payload.params)
          Object.assign(expr.colors, payload.colors)
        }
        s.dirty = true
      }),

    resetLayerToDefault: (kind) =>
      set((s) => {
        if (kind === 'stickers') {
          const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
          if (list) list.length = 0
          s.dirty = true
          return
        }
        const payload = collectLayerPayload(kind, DEFAULT_EYE_PARAMS, DEFAULT_EYE_COLORS)
        if (Object.keys(payload.params).length > 0) writeEyeTarget(s, s.eyeTarget, 'params', payload.params)
        if (Object.keys(payload.colors).length > 0) writeEyeTarget(s, s.eyeTarget, 'colors', payload.colors)
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

    addCustomEyeShape: (name, points, svgSource) => {
      const id = nanoid(8)
      set((s) => {
        s.project.customEyeShapes.push({ id, name, points, svgSource })
        s.dirty = true
      })
      return id
    },

    replaceCustomEyeShape: (id, points, svgSource) =>
      set((s) => {
        const shape = s.project.customEyeShapes.find((sh) => sh.id === id)
        if (shape) {
          shape.points = points
          shape.svgSource = svgSource
        }
        s.dirty = true
      }),

    deleteCustomEyeShape: (id) =>
      set((s) => {
        s.project.customEyeShapes = s.project.customEyeShapes.filter((shape) => shape.id !== id)
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
        s.timelineSelection = []
        s.playbackState = 'stopped'
        s.playbackTimeMs = 0
      }),

    addAnimation: (name = 'New Animation', folderId = null) => {
      const id = nanoid(10)
      set((s) => {
        const overrides = computeStyleOverrides(s.project.eyeBase, null, s.project.visualReference)
        const order = s.project.animations.filter((a) => (a.folderId ?? null) === (folderId ?? null)).length
        s.project.animations.push({
          id,
          name: uniqueName(name, s.project.animations.map((a) => a.name)),
          folderId: folderId ?? null,
          order,
          loop: false,
          durationMs: 500,
          keyframes: [
            { id: nanoid(10), timeMs: 0, easing: 'easeInOut', params: { ...s.project.eyeBase }, leftParams: null, rightParams: null, styleOverrides: overrides },
            { id: nanoid(10), timeMs: 500, easing: 'easeInOut', params: { ...s.project.eyeBase }, leftParams: null, rightParams: null, styleOverrides: overrides }
          ],
          leftEyeKeyframes: [],
          rightEyeKeyframes: [],
          pupilKeyframes: [],
          eyelidKeyframes: [],
          tracks: createDefaultTracks(() => nanoid(10)),
          stickers: [],
          markers: []
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
        // Every id inside this animation must be regenerated so it doesn't collide with the
        // original — including track ids, since StickerInstance.trackId references them.
        const trackIdMap = new Map<string, string>()
        copy.tracks = copy.tracks.map((t) => {
          const newTrackId = nanoid(10)
          trackIdMap.set(t.id, newTrackId)
          return { ...t, id: newTrackId }
        })
        copy.keyframes = copy.keyframes.map((k) => ({ ...k, id: nanoid(10) }))
        copy.leftEyeKeyframes = copy.leftEyeKeyframes.map((k) => ({ ...k, id: nanoid(10) }))
        copy.rightEyeKeyframes = copy.rightEyeKeyframes.map((k) => ({ ...k, id: nanoid(10) }))
        copy.pupilKeyframes = copy.pupilKeyframes.map((k) => ({ ...k, id: nanoid(10) }))
        copy.eyelidKeyframes = copy.eyelidKeyframes.map((k) => ({ ...k, id: nanoid(10) }))
        copy.markers = copy.markers.map((m) => ({ ...m, id: nanoid(10) }))
        copy.stickers = copy.stickers.map((st) => ({ ...st, id: nanoid(8), trackId: trackIdMap.get(st.trackId) ?? '' }))
        // Place the duplicate directly after its source, in the same folder.
        copy.folderId = src.folderId ?? null
        s.project.animations.push(copy)
        insertItemAt(s.project.animations, copy.folderId, newId, (src.order ?? 0) + 1)
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
          s.timelineSelection = []
        }
        s.dirty = true
      }),

    // Drag-to-reorder in the Animations panel. Only changes ordering within project.animations (so
    // related animations can be grouped) — animation contents/playback are untouched. Order is part
    // of the serialized project, so it persists across save/reopen. newIndex is the final 0-based
    // position among the other items.
    reorderAnimation: (id, newIndex) =>
      set((s) => {
        const arr = s.project.animations
        const idx = arr.findIndex((a) => a.id === id)
        if (idx === -1) return
        const clamped = Math.max(0, Math.min(arr.length - 1, newIndex))
        if (clamped === idx) return
        const [anim] = arr.splice(idx, 1)
        arr.splice(clamped, 0, anim)
        // Keep the flat array position and the folder-tree `order` in sync for root animations, so
        // reordering at root behaves the same whether or not folders are in use.
        reindexItems(s.project.animations, null)
        s.dirty = true
      }),

    // ---- Animation-panel folder tree (editor organization only) --------------------------------
    addAnimationFolder: (parentId, name = 'New Folder') => {
      const id = nanoid(8)
      set((s) => {
        const order = s.project.animationFolders.filter((f) => f.parentId === (parentId ?? null)).length
        s.project.animationFolders.push({ id, name, parentId: parentId ?? null, order, expanded: true })
        s.dirty = true
      })
      return id
    },

    renameAnimationFolder: (id, name) =>
      set((s) => {
        const f = s.project.animationFolders.find((x) => x.id === id)
        if (f) f.name = name || f.name
        s.dirty = true
      }),

    deleteAnimationFolder: (id) =>
      set((s) => {
        const folder = s.project.animationFolders.find((f) => f.id === id)
        if (!folder) return
        const parent = folder.parentId // children move up to here (no animations are ever lost)
        for (const f of s.project.animationFolders) if (f.parentId === id) f.parentId = parent
        for (const a of s.project.animations) if ((a.folderId ?? null) === id) a.folderId = parent
        s.project.animationFolders = s.project.animationFolders.filter((f) => f.id !== id)
        reindexFolders(s.project.animationFolders, parent)
        reindexItems(s.project.animations, parent)
        s.dirty = true
      }),

    setAnimationFolderExpanded: (id, expanded) =>
      set((s) => {
        const f = s.project.animationFolders.find((x) => x.id === id)
        if (f) f.expanded = expanded
        s.dirty = true
      }),

    moveAnimationToFolder: (animationId, targetFolderId, index) =>
      set((s) => {
        const anim = s.project.animations.find((a) => a.id === animationId)
        if (!anim) return
        const to = targetFolderId ?? null
        if (to !== null && !s.project.animationFolders.some((f) => f.id === to)) return // unknown target
        const from = anim.folderId ?? null
        anim.folderId = to
        insertItemAt(s.project.animations, to, animationId, index)
        if (from !== to) reindexItems(s.project.animations, from)
        s.dirty = true
      }),

    moveAnimationFolder: (folderId, targetParentId, index) =>
      set((s) => {
        const folder = s.project.animationFolders.find((f) => f.id === folderId)
        if (!folder) return
        const to = targetParentId ?? null
        if (to === folderId) return
        if (to !== null && !s.project.animationFolders.some((f) => f.id === to)) return // unknown target
        if (wouldCycleFolder(s.project.animationFolders, folderId, to)) return // into its own descendant
        const from = folder.parentId
        folder.parentId = to
        insertFolderAt(s.project.animationFolders, to, folderId, index)
        if (from !== to) reindexFolders(s.project.animationFolders, from)
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
        const trackIdMap = new Map<string, string>()
        const tracks = animation.tracks.map((t) => {
          const newTrackId = nanoid(10)
          trackIdMap.set(t.id, newTrackId)
          return { ...t, id: newTrackId }
        })
        const copy: Animation = {
          ...animation,
          id: nanoid(10),
          // Older/external animation JSON predates styleOverrides — fall back to computing
          // it fresh against the current Visual Reference, same as loading a legacy project.
          keyframes: animation.keyframes.map((k) => ({
            ...k,
            id: nanoid(10),
            styleOverrides: k.styleOverrides ?? computeStyleOverrides(k.params, null, s.project.visualReference)
          })),
          leftEyeKeyframes: animation.leftEyeKeyframes.map((k) => ({ ...k, id: nanoid(10) })),
          rightEyeKeyframes: animation.rightEyeKeyframes.map((k) => ({ ...k, id: nanoid(10) })),
          pupilKeyframes: animation.pupilKeyframes.map((k) => ({ ...k, id: nanoid(10) })),
          eyelidKeyframes: animation.eyelidKeyframes.map((k) => ({ ...k, id: nanoid(10) })),
          tracks,
          markers: animation.markers.map((m) => ({ ...m, id: nanoid(10) })),
          stickers: animation.stickers.map((st) => ({ ...st, id: nanoid(8), trackId: trackIdMap.get(st.trackId) ?? '' }))
        }
        s.project.animations.push(copy)
        s.activeAnimationId = copy.id
        s.dirty = true
      }),

    addAnimationCombo: (name = 'New Combo') => {
      const id = nanoid(10)
      set((s) => {
        s.project.animationCombos.push({ id, name: uniqueName(name, s.project.animationCombos.map((c) => c.name)), loop: false, clips: [] })
        s.dirty = true
      })
      return id
    },

    duplicateAnimationCombo: (id) => {
      const newId = nanoid(10)
      set((s) => {
        const src = s.project.animationCombos.find((combo) => combo.id === id)
        if (!src) return
        s.project.animationCombos.push({
          ...JSON.parse(JSON.stringify(src)),
          id: newId,
          name: `${src.name} Copy`,
          clips: src.clips.map((clip) => ({ ...clip, id: nanoid(10) }))
        })
        s.dirty = true
      })
      return newId
    },

    renameAnimationCombo: (id, name) =>
      set((s) => {
        const combo = s.project.animationCombos.find((item) => item.id === id)
        if (combo) combo.name = name
        s.dirty = true
      }),

    deleteAnimationCombo: (id) =>
      set((s) => {
        s.project.animationCombos = s.project.animationCombos.filter((combo) => combo.id !== id)
        s.dirty = true
      }),

    addAnimationComboClip: (comboId, animationId) => {
      const id = nanoid(10)
      set((s) => {
        const combo = s.project.animationCombos.find((item) => item.id === comboId)
        if (!combo) return
        // Appends right after the last clip actually *finishes* (its own end time on the
        // combo's timeline — start + its real duration, accounting for loop/speed/transition/
        // end-delay), not just after the last clip's start — the latter stacked every new clip
        // at the same instant as whichever clip already had the greatest start time, so
        // "Add clip" repeatedly produced overlapping clips instead of a sequential timeline.
        // loopCount:1/playbackSpeed:100/transitionMs:0/endDelayMs:0 already give this new clip
        // exactly the referenced animation's own default duration (see totalClipDuration).
        const startTimeMs = computeComboTimeline(combo, s.project.animations).total
        combo.clips.push({
          id,
          animationId,
          startTimeMs,
          loopCount: 1,
          playbackSpeed: 100,
          transitionMs: 0,
          endDelayMs: 0
        })
        combo.clips.sort((a, b) => a.startTimeMs - b.startTimeMs)
        s.dirty = true
      })
      return id
    },

    updateAnimationComboClip: (comboId, clipId, partial) =>
      set((s) => {
        const combo = s.project.animationCombos.find((item) => item.id === comboId)
        const clip = combo?.clips.find((item) => item.id === clipId)
        if (!combo || !clip) return
        Object.assign(clip, partial)
        clip.startTimeMs = Math.max(0, Math.round(clip.startTimeMs))
        clip.loopCount = Math.max(1, Math.round(clip.loopCount || 1))
        clip.playbackSpeed = Math.max(1, clip.playbackSpeed)
        clip.transitionMs = Math.max(0, Math.round(clip.transitionMs))
        clip.endDelayMs = Math.max(0, Math.round(clip.endDelayMs))
        combo.clips.sort((a, b) => a.startTimeMs - b.startTimeMs)
        s.dirty = true
      }),

    deleteAnimationComboClip: (comboId, clipId) =>
      set((s) => {
        const combo = s.project.animationCombos.find((item) => item.id === comboId)
        if (!combo) return
        combo.clips = combo.clips.filter((clip) => clip.id !== clipId)
        s.dirty = true
      }),

    reorderAnimationComboClip: (comboId, clipId, newIndex) =>
      set((s) => {
        const combo = s.project.animationCombos.find((item) => item.id === comboId)
        if (!combo) return
        const idx = combo.clips.findIndex((clip) => clip.id === clipId)
        if (idx === -1) return
        const clamped = Math.max(0, Math.min(combo.clips.length - 1, newIndex))
        const [clip] = combo.clips.splice(idx, 1)
        combo.clips.splice(clamped, 0, clip)
        combo.clips.forEach((item, index) => (item.startTimeMs = index === 0 ? 0 : Math.max(item.startTimeMs, combo.clips[index - 1].startTimeMs + 1)))
        combo.clips.sort((a, b) => a.startTimeMs - b.startTimeMs)
        s.dirty = true
      }),

    reorderAnimationCombo: (id, newIndex) =>
      set((s) => {
        const arr = s.project.animationCombos
        const idx = arr.findIndex((c) => c.id === id)
        if (idx === -1) return
        const clamped = Math.max(0, Math.min(arr.length - 1, newIndex))
        if (clamped === idx) return
        const [combo] = arr.splice(idx, 1)
        arr.splice(clamped, 0, combo)
        s.dirty = true
      }),

    selectAnimationCombo: (id) =>
      set((s) => {
        s.selectedComboId = id
        s.selectedComboClipId = null
        s.comboPreviewPlaying = false
        s.comboPreviewTimeMs = 0
        // Prevents a stale keyframe/sticker/marker selection (or clipboard) from a previous
        // animation-editing session from leaking into the Timeline's combo-editing mode, and
        // vice versa when switching back — see Timeline.tsx's own comboMode-keyed effect for
        // the belt-and-suspenders case where leftTab flips without a fresh call here.
        s.timelineSelection = []
        s.timelineClipboard = []
        s.selectedKeyframeId = null
        s.selectedStickerId = null
      }),
    selectAnimationComboClip: (id) => set((s) => void (s.selectedComboClipId = id)),
    setComboPreviewPlaying: (playing) => set((s) => void (s.comboPreviewPlaying = playing)),
    setComboPreviewTimeMs: (ms) => set((s) => void (s.comboPreviewTimeMs = Math.max(0, ms))),
    setComboPreviewLoop: (loop) => set((s) => void (s.comboPreviewLoop = loop)),

    selectKeyframe: (id) => set((s) => void (s.selectedKeyframeId = id)),

    addKeyframe: (afterKeyframeId) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const list = a.keyframes
        const afterIdx = afterKeyframeId ? list.findIndex((k) => k.id === afterKeyframeId) : list.length - 1
        const prev = list[Math.max(0, afterIdx)]
        const next = list[Math.max(0, afterIdx) + 1]
        const newParams = { ...(prev?.params ?? s.project.eyeBase) }
        const timeMs = prev && next ? Math.round((prev.timeMs + next.timeMs) / 2) : prev ? prev.timeMs + 400 : 0
        const newKf: Keyframe = {
          id: nanoid(10),
          timeMs,
          easing: 'easeInOut',
          params: newParams,
          leftParams: null,
          rightParams: null,
          // Inherit the neighboring keyframe's own color (if any) so an inserted keyframe keeps
          // a color-animated segment continuous instead of snapping back to the base palette.
          colors: prev?.colors ? { ...prev.colors } : null,
          styleOverrides: computeStyleOverrides(newParams, null, s.project.visualReference)
        }
        list.push(newKf)
        list.sort((x, y) => x.timeMs - y.timeMs)
        if (timeMs > a.durationMs) a.durationMs = timeMs
        s.selectedKeyframeId = newKf.id
        s.timelineSelection = [{ kind: 'keyframe', trackId: 'pose', id: newKf.id }]
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
        const original = a.keyframes[idx]
        const next = a.keyframes[idx + 1]
        const timeMs = Math.max(0, next ? Math.min(next.timeMs - MIN_SEGMENT_MS, original.timeMs + MIN_SEGMENT_MS) : original.timeMs + 200)
        const copy: Keyframe = { ...JSON.parse(JSON.stringify(original)), id: nanoid(10), timeMs }
        a.keyframes.push(copy)
        a.keyframes.sort((x, y) => x.timeMs - y.timeMs)
        if (timeMs > a.durationMs) a.durationMs = timeMs
        s.selectedKeyframeId = copy.id
        s.timelineSelection = [{ kind: 'keyframe', trackId: 'pose', id: copy.id }]
        s.dirty = true
      }),

    deleteKeyframe: (keyframeId) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a || a.keyframes.length <= 1) return
        a.keyframes = a.keyframes.filter((k) => k.id !== keyframeId)
        if (s.selectedKeyframeId === keyframeId) s.selectedKeyframeId = null
        s.timelineSelection = s.timelineSelection.filter((i) => !(i.kind === 'keyframe' && i.trackId === 'pose' && i.id === keyframeId))
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
        const copy: Keyframe = { ...JSON.parse(JSON.stringify(clip)), id: nanoid(10) }
        copy.timeMs = Math.max(0, Math.round(absoluteMsRaw))
        a.keyframes.push(copy)
        a.keyframes.sort((x, y) => x.timeMs - y.timeMs)
        if (copy.timeMs > a.durationMs) a.durationMs = copy.timeMs
        s.selectedKeyframeId = copy.id
        s.timelineSelection = [{ kind: 'keyframe', trackId: 'pose', id: copy.id }]
        s.dirty = true
      }),

    applyExpressionToKeyframe: (keyframeId, expressionId, mode) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        const expr = s.project.expressions.find((e) => e.id === expressionId)
        if (!kf || !expr) return
        const exprLeft = expr.leftParams ?? expr.params
        const exprRight = expr.rightParams ?? expr.params
        if (mode === 'replace') {
          // "Replace all" means the keyframe ends up looking exactly like the expression,
          // including its left/right divergence (or lack of it) — a hard overwrite of
          // params/leftParams/rightParams, not just the shared baseline.
          kf.params = { ...expr.params }
          kf.leftParams = expr.leftParams ? { ...expr.leftParams } : null
          kf.rightParams = expr.rightParams ? { ...expr.rightParams } : null
        } else {
          const copyStyleFields = (target: EyeParams, source: EyeParams) => {
            const t = target as unknown as Record<string, number | string | boolean | null>
            const src = source as unknown as Record<string, number | string | boolean | null>
            for (const field of STYLE_EYE_PARAM_FIELDS) t[field] = src[field]
          }
          copyStyleFields(kf.params, expr.params)
          // Only touch a side's own divergent copy when it already exists (this keyframe has
          // its own left/right override for some other reason, e.g. movement) or the expression
          // itself diverges — otherwise leave it alone/null so a non-diverging expression never
          // introduces new left/right divergence out of nothing. When touched, lazy-clone from
          // the (already style-updated) shared params first, same pattern as
          // updateTrackKeyframeEyeParams above.
          if (kf.leftParams || expr.leftParams) {
            if (!kf.leftParams) kf.leftParams = { ...kf.params }
            copyStyleFields(kf.leftParams, exprLeft)
          }
          if (kf.rightParams || expr.rightParams) {
            if (!kf.rightParams) kf.rightParams = { ...kf.params }
            copyStyleFields(kf.rightParams, exprRight)
          }
        }
        // Also capture the expression's full COLOUR palette. Fill, border (colour/width/opacity),
        // iris, pupil, highlight, shadow and glow all live in EyeColors — a separate object from
        // EyeParams — so copying params alone left the keyframe on its old/base colours (the
        // "not all properties copied" bug). This applies to both modes: colours are visual style,
        // and applyExpressionToKeyframe only ever targets pose-track keyframes (a.keyframes), where
        // a per-keyframe palette is meaningful. `{ ...expr.colors }` is a fresh, independent copy
        // (EyeColors is flat), so later editing the source Expression can't mutate this keyframe,
        // and editing this keyframe can't mutate the Expression or any sibling keyframe.
        kf.colors = { ...expr.colors }
        kf.styleOverrides = computeStyleOverrides(kf.params, null, s.project.visualReference)
        s.dirty = true
      }),

    // Reverse workflow: turn a pose keyframe's current look into a new reusable Expression. Captures
    // the full visual state — pose (params), per-eye divergence (left/right params), and the effective
    // colour palette (the keyframe's own `colors`, or the project base when it has none) — exactly as
    // saveExpression()/addExpression() build one, so it drops straight into the Expressions library and
    // is immediately selectable from any other keyframe's "Use Existing Expression". A keyframe carries
    // no stickers of its own (those are per-animation), so the new Expression starts with none.
    saveKeyframeAsExpression: (keyframeId, name) => {
      const newId = nanoid(10)
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const kf = a?.keyframes.find((k) => k.id === keyframeId)
        if (!kf) return
        const params = { ...kf.params }
        const colors = kf.colors ? { ...kf.colors } : { ...s.project.colors }
        const order = s.project.expressions.filter((e) => (e.folderId ?? null) === null).length
        s.project.expressions.push({
          id: newId,
          name,
          params,
          colors,
          leftParams: kf.leftParams ? { ...kf.leftParams } : null,
          rightParams: kf.rightParams ? { ...kf.rightParams } : null,
          leftColors: null,
          rightColors: null,
          styleOverrides: computeStyleOverrides(params, colors, s.project.visualReference),
          stickers: [],
          folderId: null,
          order
        })
        s.dirty = true
      })
      return newId
    },

    // ---- timeline (multi-track, CapCut-style editing) --------------------------------------

    setTimelineSelection: (items) =>
      set((s) => {
        s.timelineSelection = items
        syncPrimarySelection(s)
      }),

    toggleTimelineSelection: (item, additive) =>
      set((s) => {
        const idx = s.timelineSelection.findIndex((i) => i.kind === item.kind && i.trackId === item.trackId && i.id === item.id)
        if (additive) {
          if (idx >= 0) s.timelineSelection.splice(idx, 1)
          else s.timelineSelection.push(item)
        } else {
          s.timelineSelection = idx >= 0 && s.timelineSelection.length === 1 ? [] : [item]
        }
        syncPrimarySelection(s)
      }),

    clearTimelineSelection: () =>
      set((s) => {
        s.timelineSelection = []
        s.selectedKeyframeId = null
        s.selectedStickerId = null
      }),

    setSnappingEnabled: (enabled) => set((s) => void (s.snappingEnabled = enabled)),
    setSnapIntervalMs: (intervalMs) => set((s) => void (s.snapIntervalMs = Math.max(0, intervalMs))),
    setEyelidPreviewClose: (amount) => set((s) => void (s.eyelidPreviewClose = Math.max(0, Math.min(1, amount)))),

    setAnimationDuration: (durationMs) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const maxKeyframeTime = Math.max(
          0,
          ...a.keyframes.map((k) => k.timeMs),
          ...a.leftEyeKeyframes.map((k) => k.timeMs),
          ...a.rightEyeKeyframes.map((k) => k.timeMs),
          ...a.pupilKeyframes.map((k) => k.timeMs),
          ...a.eyelidKeyframes.map((k) => k.timeMs),
          ...a.stickers.map((st) => st.anim.endTimeMs ?? st.anim.startTimeMs),
          ...a.markers.map((m) => m.timeMs)
        )
        a.durationMs = Math.max(Math.round(durationMs), maxKeyframeTime)
        s.dirty = true
      }),

    setKeyframeTime: (trackKind, keyframeId, timeMs) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const list = keyframeListFor(a, trackKind)
        const idx = list.findIndex((k) => k.id === keyframeId)
        if (idx === -1) return
        if (trackKind === 'pose' && idx === 0) return // pinned at t=0, matches historical behavior
        const isLast = idx === list.length - 1
        const minT = idx > 0 ? list[idx - 1].timeMs + MIN_SEGMENT_MS : 0
        const maxT = isLast ? Infinity : list[idx + 1].timeMs - MIN_SEGMENT_MS
        const clamped = Math.max(minT, Math.min(Math.max(minT, maxT), Math.round(timeMs)))
        list[idx].timeMs = clamped
        if (trackKind === 'pose' && isLast) a.durationMs = Math.max(a.durationMs, clamped)
        s.dirty = true
      }),

    updateTrackKeyframeParams: (trackKind, keyframeId, partial) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const kf = keyframeListFor(a, trackKind).find((k) => k.id === keyframeId)
        if (!kf) return
        Object.assign(kf.params, partial)
        kf.styleOverrides = computeStyleOverrides(kf.params, null, s.project.visualReference)
        s.dirty = true
      }),

    updateTrackKeyframeEasing: (trackKind, keyframeId, easing, customBezier) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const kf = keyframeListFor(a, trackKind).find((k) => k.id === keyframeId)
        if (!kf) return
        kf.easing = easing
        kf.customBezier = customBezier
        s.dirty = true
      }),

    resizeStickerClip: (stickerId, edge, newMs) =>
      set((s) => {
        const owner = findStickerOwner(s.project, stickerId)
        if (!owner) return
        const sticker = owner.list[owner.index]
        const clamped = Math.max(0, Math.round(newMs))
        if (edge === 'start') {
          const maxStart = sticker.anim.endTimeMs != null ? sticker.anim.endTimeMs - MIN_SEGMENT_MS : Infinity
          sticker.anim.startTimeMs = Math.max(0, Math.min(maxStart, clamped))
        } else {
          const minEnd = sticker.anim.startTimeMs + MIN_SEGMENT_MS
          sticker.anim.endTimeMs = Math.max(minEnd, clamped)
        }
        s.dirty = true
      }),

    resizeComboClip: (comboId, clipId, edge, newMs) =>
      set((s) => {
        const combo = s.project.animationCombos.find((c) => c.id === comboId)
        const clip = combo?.clips.find((c) => c.id === clipId)
        if (!combo || !clip) return
        const anim = s.project.animations.find((a) => a.id === clip.animationId)
        if (!anim) return
        const animDurationMs = animationDuration(anim)
        const clamped = Math.round(newMs)
        if (edge === 'end') {
          // Holds the clip's start fixed, solves a new loop count for the requested end.
          const newEnd = Math.max(clip.startTimeMs + 1, clamped)
          clip.loopCount = loopCountForDuration(animDurationMs, clip.playbackSpeed, clip.transitionMs, clip.endDelayMs, newEnd - clip.startTimeMs)
        } else {
          // Holds the clip's *current* end fixed (its own current duration, before this drag),
          // solves both a new startTimeMs and loop count for the requested start.
          const timeline = computeComboTimeline(combo, s.project.animations)
          const entry = timeline.clips.find((e) => e.clip.id === clipId)
          if (!entry) return
          const fixedEnd = entry.end
          const newStart = Math.min(fixedEnd - 1, Math.max(0, clamped))
          clip.loopCount = loopCountForDuration(animDurationMs, clip.playbackSpeed, clip.transitionMs, clip.endDelayMs, fixedEnd - newStart)
          clip.startTimeMs = Math.round(newStart)
        }
        combo.clips.sort((a, b) => a.startTimeMs - b.startTimeMs)
        s.dirty = true
      }),

    splitClipAt: (item, atMs) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const t = Math.round(atMs)

        if (item.kind === 'sticker') {
          const owner = findStickerOwner(s.project, item.id)
          if (!owner) return
          const original = owner.list[owner.index]
          const start = original.anim.startTimeMs
          const end = original.anim.endTimeMs ?? a.durationMs
          if (t <= start + MIN_SEGMENT_MS || t >= end - MIN_SEGMENT_MS) return
          checkpointDraft(s)
          const copy: StickerInstance = JSON.parse(JSON.stringify(original))
          copy.id = nanoid(8)
          copy.anim.startTimeMs = t
          // Preserve a "never ends" (null) endTimeMs on the second half — only the first half
          // gets a real end at the split point.
          original.anim.endTimeMs = t
          owner.list.splice(owner.index + 1, 0, copy)
          s.dirty = true
          return
        }

        if (item.kind === 'keyframe') {
          const trackKind = item.trackId as KeyframeTrackKind
          const list = keyframeListFor(a, trackKind)
          if (list.length < 2) return
          if (t <= list[0].timeMs + MIN_SEGMENT_MS || t >= list[list.length - 1].timeMs - MIN_SEGMENT_MS) return
          const sample = sampleTrack(list, false, a.durationMs, t)
          if (!sample) return
          checkpointDraft(s)
          const from = list[sample.segmentIndex]
          // Preserves per-eye divergence through the split, when any neighboring keyframe on
          // this track actually has some (see Keyframe.leftParams/rightParams) — sampled at the
          // same instant so a split mid-blink-with-a-wink doesn't flatten the two eyes back
          // together at the new keyframe.
          const hasDivergence = list.some((k) => k.leftParams || k.rightParams)
          const leftSample = hasDivergence ? sampleTrack(list, false, a.durationMs, t, 'left') : null
          const rightSample = hasDivergence ? sampleTrack(list, false, a.durationMs, t, 'right') : null
          const newKf: Keyframe = {
            id: nanoid(10),
            timeMs: t,
            easing: from.easing,
            customBezier: from.customBezier,
            params: sample.params,
            leftParams: leftSample?.params ?? null,
            rightParams: rightSample?.params ?? null,
            // Keep per-keyframe color continuous through a pose-track split — sample the
            // interpolated palette at the split instant when any keyframe carries its own color,
            // so splitting a color-animated segment doesn't snap it back to the base palette.
            colors: trackKind === 'pose' && list.some((k) => k.colors) ? sampleAnimationColors(a, t, s.project.colors) : null,
            styleOverrides: computeStyleOverrides(sample.params, null, s.project.visualReference)
          }
          list.push(newKf)
          list.sort((x, y) => x.timeMs - y.timeMs)
          s.dirty = true
        }
      }),

    moveSelectionByDelta: (deltaMs) =>
      set((s) => {
        if (s.timelineSelection.length === 0) return

        if (isComboTimelineActive(s)) {
          const combo = activeComboOf(s.project, s.selectedComboId)
          if (!combo) return
          let comboMinTime = Infinity
          for (const item of s.timelineSelection) {
            if (item.kind !== 'comboClip') continue
            const clip = combo.clips.find((c) => c.id === item.id)
            if (clip) comboMinTime = Math.min(comboMinTime, clip.startTimeMs)
          }
          if (comboMinTime === Infinity) return
          const appliedComboDelta = Math.max(deltaMs, -comboMinTime)
          if (appliedComboDelta === 0) return
          for (const item of s.timelineSelection) {
            if (item.kind !== 'comboClip') continue
            const clip = combo.clips.find((c) => c.id === item.id)
            if (clip) clip.startTimeMs = Math.max(0, Math.round(clip.startTimeMs + appliedComboDelta))
          }
          combo.clips.sort((x, y) => x.startTimeMs - y.startTimeMs)
          s.dirty = true
          return
        }

        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return

        let minTime = Infinity
        for (const item of s.timelineSelection) {
          if (item.kind === 'keyframe') {
            const kf = keyframeListFor(a, item.trackId as KeyframeTrackKind).find((k) => k.id === item.id)
            if (kf) minTime = Math.min(minTime, kf.timeMs)
          } else if (item.kind === 'sticker') {
            const owner = findStickerOwner(s.project, item.id)
            if (owner) minTime = Math.min(minTime, owner.list[owner.index].anim.startTimeMs)
          } else {
            const marker = a.markers.find((m) => m.id === item.id)
            if (marker) minTime = Math.min(minTime, marker.timeMs)
          }
        }
        if (minTime === Infinity) return
        const appliedDelta = Math.max(deltaMs, -minTime)
        if (appliedDelta === 0) return

        for (const item of s.timelineSelection) {
          if (item.kind === 'keyframe') {
            const trackKind = item.trackId as KeyframeTrackKind
            const list = keyframeListFor(a, trackKind)
            const kf = list.find((k) => k.id === item.id)
            if (!kf) continue
            if (trackKind === 'pose' && list[0]?.id === kf.id) continue // pinned at t=0
            kf.timeMs = Math.max(0, kf.timeMs + appliedDelta)
          } else if (item.kind === 'sticker') {
            const owner = findStickerOwner(s.project, item.id)
            if (!owner) continue
            const sticker = owner.list[owner.index]
            sticker.anim.startTimeMs = Math.max(0, sticker.anim.startTimeMs + appliedDelta)
            if (sticker.anim.endTimeMs != null) sticker.anim.endTimeMs = Math.max(sticker.anim.startTimeMs, sticker.anim.endTimeMs + appliedDelta)
          } else {
            const marker = a.markers.find((m) => m.id === item.id)
            if (marker) marker.timeMs = Math.max(0, marker.timeMs + appliedDelta)
          }
        }
        a.keyframes.sort((x, y) => x.timeMs - y.timeMs)
        a.leftEyeKeyframes.sort((x, y) => x.timeMs - y.timeMs)
        a.rightEyeKeyframes.sort((x, y) => x.timeMs - y.timeMs)
        a.pupilKeyframes.sort((x, y) => x.timeMs - y.timeMs)
        a.eyelidKeyframes.sort((x, y) => x.timeMs - y.timeMs)
        a.markers.sort((x, y) => x.timeMs - y.timeMs)
        s.dirty = true
      }),

    addKeyframeAt: (trackKind, timeMs) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        checkpointDraft(s)
        const list = keyframeListFor(a, trackKind)
        const target = Math.max(0, Math.round(timeMs))

        // Clamp away from existing neighbors by MIN_SEGMENT_MS, nudging right past anything
        // already occupying (or too close to) the requested time.
        const sorted = [...list].sort((x, y) => x.timeMs - y.timeMs)
        let clamped = target
        for (const k of sorted) {
          if (Math.abs(k.timeMs - clamped) < MIN_SEGMENT_MS) clamped = k.timeMs + MIN_SEGMENT_MS
        }

        // Template the new keyframe's pose from whatever's currently showing at this time, so
        // it starts matching the live preview instead of resetting to defaults — the merged
        // sample for leftEye/rightEye/pupils/eyelids tracks (sampleAnimationEye), or the pose
        // track's own sample for the pose track itself.
        const eyeSide = trackKind === 'rightEye' ? 'right' : 'left'
        const params: EyeParams =
          trackKind === 'pose'
            ? (sampleTrack(a.keyframes, a.loop, a.durationMs, clamped)?.params ?? { ...s.project.eyeBase })
            : { ...sampleAnimationEye(a, clamped, eyeSide) }

        const newKf: Keyframe = {
          id: nanoid(10),
          timeMs: clamped,
          easing: 'easeInOut',
          params,
          leftParams: null,
          rightParams: null,
          // Match the color currently showing at this time (pose track only) so a new keyframe
          // dropped into a color-animated stretch starts on-palette instead of snapping to base.
          colors: trackKind === 'pose' && a.keyframes.some((k) => k.colors) ? sampleAnimationColors(a, clamped, s.project.colors) : null,
          styleOverrides: computeStyleOverrides(params, null, s.project.visualReference)
        }
        list.push(newKf)
        list.sort((x, y) => x.timeMs - y.timeMs)
        if (trackKind === 'pose' && clamped > a.durationMs) a.durationMs = clamped
        s.timelineSelection = [{ kind: 'keyframe', trackId: trackKind, id: newKf.id }]
        syncPrimarySelection(s)
        s.dirty = true
      }),

    updateTrackKeyframeEyeParams: (trackKind, keyframeId, side, partial) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const kf = keyframeListFor(a, trackKind).find((k) => k.id === keyframeId)
        if (!kf) return
        // Lazy-clone-on-first-divergence — same pattern Expression's own leftParams/rightParams
        // already use (see setEyeParam's write path for the base pose): the first edit while
        // Eye Target is Left/Right snapshots the currently-shared `params` into that side's slot,
        // then every edit after just mutates it in place. Both sides end up independently
        // editable without ever touching `params` (still read by 'both' and by whichever side
        // never diverged) or creating a new keyframe/track.
        const key = side === 'left' ? 'leftParams' : 'rightParams'
        if (!kf[key]) kf[key] = { ...kf.params }
        Object.assign(kf[key]!, partial)
        s.dirty = true
      }),

    updateTrackKeyframeColors: (keyframeId, partial) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        // Color lives on the pose ("Expression") track only (see Keyframe.colors) — the other
        // tracks carry no palette, so this is scoped to a.keyframes.
        const kf = a.keyframes.find((k) => k.id === keyframeId)
        if (!kf) return
        // Lazy-clone from the shared base palette on first divergence, same pattern as
        // updateTrackKeyframeEyeParams above: the first color edit snapshots the base palette the
        // keyframe was already inheriting, then subsequent edits mutate that snapshot in place.
        if (!kf.colors) kf.colors = { ...s.project.colors }
        Object.assign(kf.colors, partial)
        s.dirty = true
      }),

    addTrack: (kind, name, layer) => {
      let resultId = ''
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        if (kind !== 'sticker') {
          // Singleton fixed kind — if one already exists, just select it rather than making a
          // duplicate row (pose always exists already and is never created here).
          const existing = a.tracks.find((t) => t.kind === kind)
          if (existing) {
            resultId = existing.id
            return
          }
        }
        checkpointDraft(s)
        const order = a.tracks.length
        const count = a.tracks.filter((t) => t.kind === 'sticker').length + 1
        const track = createTrack(() => nanoid(8), kind, order, name ?? (kind === 'sticker' ? `Sticker Track ${count}` : undefined), layer)
        a.tracks.push(track)
        resultId = track.id
        s.dirty = true
      })
      return resultId
    },

    removeTrack: (trackId) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const track = a?.tracks.find((t) => t.id === trackId)
        if (!a || !track || track.kind === 'pose') return
        checkpointDraft(s)
        a.tracks = a.tracks.filter((t) => t.id !== trackId)
        if (track.kind === 'sticker') {
          // Stickers that were on this track fall back to "Ungrouped" (an unresolved trackId)
          // rather than being deleted — matches the timing validator's dangling-trackId warning
          // being non-fatal.
          for (const st of a.stickers) {
            if (st.trackId === trackId) st.trackId = ''
          }
        } else if (track.kind === 'marker') {
          a.markers = []
        } else {
          setKeyframeListFor(a, track.kind as KeyframeTrackKind, [])
        }
        s.timelineSelection = s.timelineSelection.filter((i) => i.trackId !== trackId)
        syncPrimarySelection(s)
        s.dirty = true
      }),

    renameTrack: (trackId, name) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const t = a?.tracks.find((tr) => tr.id === trackId)
        if (!t) return
        checkpointDraft(s)
        t.name = name
        s.dirty = true
      }),

    reorderTrack: (trackId, newOrder) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const sorted = [...a.tracks].sort((x, y) => x.order - y.order)
        const idx = sorted.findIndex((t) => t.id === trackId)
        if (idx === -1) return
        checkpointDraft(s)
        const clamped = Math.max(0, Math.min(sorted.length - 1, newOrder))
        const [item] = sorted.splice(idx, 1)
        sorted.splice(clamped, 0, item)
        sorted.forEach((t, i) => (t.order = i))
        a.tracks = sorted
        s.dirty = true
      }),

    setTrackVisible: (trackId, visible) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const t = a?.tracks.find((tr) => tr.id === trackId)
        if (!t) return
        checkpointDraft(s)
        t.visible = visible
        s.dirty = true
      }),

    setTrackLocked: (trackId, locked) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const t = a?.tracks.find((tr) => tr.id === trackId)
        if (!t) return
        checkpointDraft(s)
        t.locked = locked
        s.dirty = true
      }),

    assignStickerToTrack: (stickerId, trackId) =>
      set((s) => {
        const owner = findStickerOwner(s.project, stickerId)
        if (!owner) return
        checkpointDraft(s)
        const sticker = owner.list[owner.index]
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const track = a?.tracks.find((t) => t.id === trackId)
        sticker.trackId = trackId
        if (track?.stickerLayer) sticker.layer = track.stickerLayer
        s.dirty = true
      }),

    detachTrackFromPose: (animId, trackKind) =>
      set((s) => {
        const a = activeAnimationOf(s.project, animId)
        if (!a) return
        const targetList = keyframeListFor(a, trackKind)
        if (targetList.length > 0) return // already has its own keyframes
        checkpointDraft(s)
        const seeded: Keyframe[] = a.keyframes.map((k) => ({
          id: nanoid(10),
          timeMs: k.timeMs,
          easing: k.easing,
          customBezier: k.customBezier,
          params: { ...k.params },
          leftParams: k.leftParams ? { ...k.leftParams } : null,
          rightParams: k.rightParams ? { ...k.rightParams } : null,
          styleOverrides: [...k.styleOverrides]
        }))
        setKeyframeListFor(a, trackKind, seeded)
        s.dirty = true
      }),

    addMarker: (atMs, label) => {
      const id = nanoid(8)
      set((s) => {
        checkpointDraft(s)
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        const timeMs = Math.max(0, Math.round(atMs))
        a.markers.push({ id, timeMs, label: label ?? `Marker ${a.markers.length + 1}`, color: '#f5c542' })
        a.markers.sort((x, y) => x.timeMs - y.timeMs)
        s.timelineSelection = [{ kind: 'marker', trackId: 'marker', id }]
        syncPrimarySelection(s)
        s.dirty = true
      })
      return id
    },

    updateMarker: (markerId, partial) =>
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const m = a?.markers.find((mk) => mk.id === markerId)
        if (!m) return
        Object.assign(m, partial)
        s.dirty = true
      }),

    copySelection: () =>
      set((s) => {
        if (isComboTimelineActive(s)) {
          const combo = activeComboOf(s.project, s.selectedComboId)
          if (!combo) return
          s.timelineClipboard = collectComboClipboardEntries(combo, s.timelineSelection)
          return
        }
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        s.timelineClipboard = collectClipboardEntries(s.project, a, s.timelineSelection)
      }),

    pasteSelectionAt: (atMs) =>
      set((s) => {
        if (s.timelineClipboard.length === 0) return
        if (isComboTimelineActive(s)) {
          const combo = activeComboOf(s.project, s.selectedComboId)
          if (!combo) return
          checkpointDraft(s)
          const newSelection = insertComboClipEntriesAt(combo, s.timelineClipboard, atMs)
          if (newSelection.length === 0) return
          s.timelineSelection = newSelection
          s.dirty = true
          return
        }
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        checkpointDraft(s)
        const newSelection = insertTimelineEntriesAt(a, s.timelineClipboard, atMs)
        s.timelineSelection = newSelection
        syncPrimarySelection(s)
        s.dirty = true
      }),

    duplicateSelection: () =>
      set((s) => {
        if (s.timelineSelection.length === 0) return
        if (isComboTimelineActive(s)) {
          const combo = activeComboOf(s.project, s.selectedComboId)
          if (!combo) return
          checkpointDraft(s)
          const entries = collectComboClipboardEntries(combo, s.timelineSelection)
          if (entries.length === 0) return
          const groupEnd = Math.max(...entries.map((e) => (e.kind === 'comboClip' ? e.data.startTimeMs : 0)))
          const newSelection = insertComboClipEntriesAt(combo, entries, groupEnd + MIN_SEGMENT_MS)
          if (newSelection.length === 0) return
          s.timelineSelection = newSelection
          s.dirty = true
          return
        }
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        checkpointDraft(s)
        const entries = collectClipboardEntries(s.project, a, s.timelineSelection)
        if (entries.length === 0) return
        const endTimeOf = (e: TimelineClipboardEntry) => (e.kind === 'sticker' ? (e.data.anim.endTimeMs ?? e.data.anim.startTimeMs) : e.kind === 'comboClip' ? e.data.startTimeMs : e.data.timeMs)
        const groupEnd = Math.max(...entries.map(endTimeOf))
        const newSelection = insertTimelineEntriesAt(a, entries, groupEnd + MIN_SEGMENT_MS)
        s.timelineSelection = newSelection
        syncPrimarySelection(s)
        s.dirty = true
      }),

    deleteSelection: () =>
      set((s) => {
        if (s.timelineSelection.length === 0) return
        if (isComboTimelineActive(s)) {
          const combo = activeComboOf(s.project, s.selectedComboId)
          if (!combo) return
          checkpointDraft(s)
          const idsToDelete = new Set(s.timelineSelection.filter((i) => i.kind === 'comboClip').map((i) => i.id))
          combo.clips = combo.clips.filter((c) => !idsToDelete.has(c.id))
          s.timelineSelection = []
          s.dirty = true
          return
        }
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        if (!a) return
        checkpointDraft(s)
        for (const item of s.timelineSelection) {
          if (item.kind === 'keyframe') {
            const trackKind = item.trackId as KeyframeTrackKind
            const list = keyframeListFor(a, trackKind)
            // Never delete the pose track down to zero keyframes (matches the old
            // deleteKeyframe's guard); other tracks can go empty (= fully inherit the pose
            // track again).
            if (trackKind === 'pose' && list.length <= 1) continue
            setKeyframeListFor(a, trackKind, list.filter((k) => k.id !== item.id))
          } else if (item.kind === 'sticker') {
            const owner = findStickerOwner(s.project, item.id)
            if (owner) owner.list.splice(owner.index, 1)
          } else if (item.kind === 'marker') {
            a.markers = a.markers.filter((m) => m.id !== item.id)
          }
        }
        s.timelineSelection = []
        s.selectedKeyframeId = null
        s.selectedStickerId = null
        s.dirty = true
      }),

    addExpression: (name, folderId = null) =>
      set((s) => {
        const newId = nanoid(10)
        const newParams = { ...s.project.eyeBase }
        const newColors = { ...s.project.colors }
        const order = s.project.expressions.filter((e) => (e.folderId ?? null) === (folderId ?? null)).length
        s.project.expressions.push({
          id: newId,
          name: uniqueName(name, s.project.expressions.map((e) => e.name)),
          params: newParams,
          colors: newColors,
          leftParams: s.project.eyeLeftOverride ? { ...s.project.eyeLeftOverride } : null,
          rightParams: s.project.eyeRightOverride ? { ...s.project.eyeRightOverride } : null,
          leftColors: s.project.colorsLeftOverride ? { ...s.project.colorsLeftOverride } : null,
          rightColors: s.project.colorsRightOverride ? { ...s.project.colorsRightOverride } : null,
          styleOverrides: computeStyleOverrides(newParams, newColors, s.project.visualReference),
          stickers: [],
          folderId: folderId ?? null,
          order
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

    // Drag-to-reorder in the Expressions panel — same as reorderAnimation: only changes the order
    // within project.expressions (which is serialized, so it persists across save/reopen); the
    // expressions themselves are untouched. newIndex is the final 0-based position.
    reorderExpression: (id, newIndex) =>
      set((s) => {
        const arr = s.project.expressions
        const idx = arr.findIndex((e) => e.id === id)
        if (idx === -1) return
        const clamped = Math.max(0, Math.min(arr.length - 1, newIndex))
        if (clamped === idx) return
        const [expr] = arr.splice(idx, 1)
        arr.splice(clamped, 0, expr)
        reindexItems(s.project.expressions, null) // keep root `order` in sync with the flat position
        s.dirty = true
      }),

    // ---- Expressions-panel folder tree (editor organization only; mirrors the Animation panel) ----
    addExpressionFolder: (parentId, name = 'New Folder') => {
      const id = nanoid(8)
      set((s) => {
        const order = s.project.expressionFolders.filter((f) => f.parentId === (parentId ?? null)).length
        s.project.expressionFolders.push({ id, name, parentId: parentId ?? null, order, expanded: true })
        s.dirty = true
      })
      return id
    },

    renameExpressionFolder: (id, name) =>
      set((s) => {
        const f = s.project.expressionFolders.find((x) => x.id === id)
        if (f) f.name = name || f.name
        s.dirty = true
      }),

    deleteExpressionFolder: (id) =>
      set((s) => {
        const folder = s.project.expressionFolders.find((f) => f.id === id)
        if (!folder) return
        const parent = folder.parentId // children move up to here (no expressions are ever lost)
        for (const f of s.project.expressionFolders) if (f.parentId === id) f.parentId = parent
        for (const e of s.project.expressions) if ((e.folderId ?? null) === id) e.folderId = parent
        s.project.expressionFolders = s.project.expressionFolders.filter((f) => f.id !== id)
        reindexFolders(s.project.expressionFolders, parent)
        reindexItems(s.project.expressions, parent)
        s.dirty = true
      }),

    setExpressionFolderExpanded: (id, expanded) =>
      set((s) => {
        const f = s.project.expressionFolders.find((x) => x.id === id)
        if (f) f.expanded = expanded
        s.dirty = true
      }),

    moveExpressionToFolder: (expressionId, targetFolderId, index) =>
      set((s) => {
        const expr = s.project.expressions.find((e) => e.id === expressionId)
        if (!expr) return
        const to = targetFolderId ?? null
        if (to !== null && !s.project.expressionFolders.some((f) => f.id === to)) return // unknown target
        const from = expr.folderId ?? null
        expr.folderId = to // moving only changes the folder — id/data/references are untouched
        insertItemAt(s.project.expressions, to, expressionId, index)
        if (from !== to) reindexItems(s.project.expressions, from)
        s.dirty = true
      }),

    moveExpressionFolder: (folderId, targetParentId, index) =>
      set((s) => {
        const folder = s.project.expressionFolders.find((f) => f.id === folderId)
        if (!folder) return
        const to = targetParentId ?? null
        if (to === folderId) return
        if (to !== null && !s.project.expressionFolders.some((f) => f.id === to)) return // unknown target
        if (wouldCycleFolder(s.project.expressionFolders, folderId, to)) return // into its own descendant
        const from = folder.parentId
        folder.parentId = to
        insertFolderAt(s.project.expressionFolders, to, folderId, index)
        if (from !== to) reindexFolders(s.project.expressionFolders, from)
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
    toggleEsp32Preview: () => set((s) => void (s.esp32PreviewMode = !s.esp32PreviewMode)),
    setDevStats: (stats) => set((s) => void (s.devStats = stats)),
    setExportDialogOpen: (open) => set((s) => void (s.exportDialogOpen = open)),
    setLvglExportDialogOpen: (open) => set((s) => void (s.lvglExportDialogOpen = open)),
    setGuideOpen: (open) => set((s) => void (s.guideOpen = open)),
    setSettingsOpen: (open) => set((s) => void (s.settingsOpen = open)),
    setLeftTab: (tab) => set((s) => void (s.leftTab = tab)),
    setRightTab: (tab) => set((s) => void (s.rightTab = tab)),
    setWorkspace: (workspace) => set((s) => void (s.workspace = workspace)),

    setAuthSession: (email) =>
      set((s) => {
        s.authenticated = email !== null
        s.authUserEmail = email
        s.authChecked = true
      }),
    setAuthChecked: (checked) => set((s) => void (s.authChecked = checked)),

    setStickerScope: (scope) => set((s) => void (s.stickerScope = scope)),
    selectSticker: (id) => set((s) => void (s.selectedStickerId = id)),

    addSticker: (assetId, layer = 'behind') => {
      const id = nanoid(8)
      let added = false
      set((s) => {
        const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
        if (!list) return
        const asset = s.project.stickerAssets.find((a) => a.id === assetId)
        // Only Animation-scoped stickers land on a Timeline track — Project/Expression scope
        // has no Track[] to resolve against, so trackId stays '' (Ungrouped) for those.
        // Resolved to the first sticker track that exists (by display order), not filtered by
        // layer — a track's stickerLayer is just its own default, not a hard requirement, so a
        // sticker track created with one layer can still receive a sticker added with the
        // other (this mismatch was the root cause of "can't add stickers to a sticker track").
        // The sticker's own layer is aligned to the chosen track's, matching
        // assignStickerToTrack()'s same convention, so behind/front draw order stays consistent
        // with whichever track it visually lives on.
        let trackId = ''
        let effectiveLayer = layer
        if (s.stickerScope === 'animation') {
          const a = activeAnimationOf(s.project, s.activeAnimationId)
          const track = a?.tracks.filter((t) => t.kind === 'sticker').sort((x, y) => x.order - y.order)[0]
          if (track) {
            trackId = track.id
            effectiveLayer = track.stickerLayer ?? layer
          }
        }
        const order = list.filter((st) => st.layer === effectiveLayer).length
        list.push({
          id,
          assetId,
          name: asset?.name ?? 'Sticker',
          layer: effectiveLayer,
          order,
          x: 0,
          y: 0,
          width: 48,
          height: 48,
          scaleX: 100,
          scaleY: 100,
          rotation: 0,
          opacity: 100,
          tint: null,
          svgColorMode: 'preserveOriginal',
          resolvedSvg: null,
          flipH: false,
          flipV: false,
          visible: true,
          locked: false,
          anim: { ...DEFAULT_STICKER_ANIM },
          trackId
        })
        s.selectedStickerId = id
        s.dirty = true
        added = true
      })
      return added ? id : null
    },

    addStickerToTrack: (trackId, assetId, atMs) => {
      const id = nanoid(8)
      let ok = false
      set((s) => {
        const a = activeAnimationOf(s.project, s.activeAnimationId)
        const track = a?.tracks.find((t) => t.id === trackId && t.kind === 'sticker')
        if (!a || !track) return
        checkpointDraft(s)
        const asset = s.project.stickerAssets.find((ast) => ast.id === assetId)
        const layer = track.stickerLayer ?? 'front'
        const order = a.stickers.filter((st) => st.layer === layer).length
        const startTimeMs = Math.max(0, Math.round(atMs))
        const DEFAULT_CLIP_MS = 800
        a.stickers.push({
          id,
          assetId,
          name: asset?.name ?? 'Sticker',
          layer,
          order,
          x: 0,
          y: 0,
          width: 48,
          height: 48,
          scaleX: 100,
          scaleY: 100,
          rotation: 0,
          opacity: 100,
          tint: null,
          svgColorMode: 'preserveOriginal',
          resolvedSvg: null,
          flipH: false,
          flipV: false,
          visible: true,
          locked: false,
          anim: { ...DEFAULT_STICKER_ANIM, startTimeMs, endTimeMs: startTimeMs + DEFAULT_CLIP_MS },
          trackId
        })
        s.timelineSelection = [{ kind: 'sticker', trackId, id }]
        s.selectedStickerId = id
        s.stickerScope = 'animation'
        s.dirty = true
        ok = true
      })
      return ok ? id : null
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

    renameSticker: (id, name) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        const trimmed = name.trim()
        if (owner && trimmed) owner.list[owner.index].name = trimmed
        s.dirty = true
      }),

    copySticker: (id) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (!owner) return
        s.stickerClipboard = JSON.parse(JSON.stringify(owner.list[owner.index]))
      }),

    pasteSticker: () => {
      const newId = nanoid(8)
      let added = false
      set((s) => {
        const clipboard = s.stickerClipboard
        if (!clipboard) return
        const list = resolveStickerList(s.project, s.stickerScope, s.selectedExpressionId, s.activeAnimationId)
        if (!list) return
        const order = list.filter((st) => st.layer === clipboard.layer).length
        list.push({ ...JSON.parse(JSON.stringify(clipboard)), id: newId, trackId: '', order })
        s.selectedStickerId = newId
        s.dirty = true
        added = true
      })
      return added ? newId : null
    },

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
        s.project.stickerAssets.push({ ...asset, id })
        s.dirty = true
      })
      return id
    },

    // Cascades: every placed instance of this asset (across project/expression/animation
    // scopes) is removed too, not just the library entry — otherwise those instances would
    // dangle with an unresolvable assetId, rendering as the Sticker Manager's "Missing asset"
    // placeholder forever instead of actually disappearing. Silent (no confirm dialog), matching
    // this app's existing no-confirm convention for sticker/keyframe delete — Undo is the safety
    // net, same as everywhere else.
    deleteStickerAsset: (id) =>
      set((s) => {
        s.project.stickerAssets = s.project.stickerAssets.filter((a) => a.id !== id)
        const lists = [s.project.stickers, ...s.project.expressions.map((e) => e.stickers), ...s.project.animations.map((a) => a.stickers)]
        for (const list of lists) {
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].assetId === id) list.splice(i, 1)
          }
        }
        if (s.selectedStickerId && !findStickerOwner(s.project, s.selectedStickerId)) s.selectedStickerId = null
        s.dirty = true
      }),

    setStickerResolvedSvg: (id, resolved) =>
      set((s) => {
        const owner = findStickerOwner(s.project, id)
        if (owner) owner.list[owner.index].resolvedSvg = resolved
        s.dirty = true
      }),

    // UI Design Mode
    selectUiWidget: (id) => set((s) => void (s.selectedWidgetId = id)),

    addUiWidget: (type, parentId, x, y) => {
      const widget = createWidget(type)
      widget.parentId = parentId
      widget.style.x = x
      widget.style.y = y

      // Keyboard widgets always arrive with a linked output textarea + debug label — see the
      // action's own doc comment above for why this mirrors real LVGL structure instead of
      // inventing a combined widget type.
      let textareaWidget: ReturnType<typeof createWidget> | null = null
      let labelWidget: ReturnType<typeof createWidget> | null = null
      if (type === 'keyboard' && widget.keyboardConfig) {
        const kbWidth = typeof widget.style.width === 'number' ? widget.style.width : 220

        textareaWidget = createWidget('textarea')
        textareaWidget.parentId = parentId
        textareaWidget.style.x = x
        textareaWidget.style.y = Math.max(0, y - 34)
        textareaWidget.style.width = kbWidth
        textareaWidget.style.height = 30
        textareaWidget.text = ''
        textareaWidget.props = { ...textareaWidget.props, placeholder: 'Enter text...' }

        labelWidget = createWidget('label')
        labelWidget.parentId = parentId
        labelWidget.style.x = x
        labelWidget.style.y = Math.max(0, y - 54)
        labelWidget.style.width = kbWidth
        labelWidget.style.height = 18
        labelWidget.style.fontSize = 10
        labelWidget.text = ''

        widget.keyboardConfig.targetTextareaId = textareaWidget.id
        widget.keyboardConfig.debugLabelId = labelWidget.id
      }

      set((s) => {
        const parent = s.project.uiDesign.widgets[parentId]
        if (!parent) return
        s.project.uiDesign.widgets[widget.id] = widget
        parent.childIds.push(widget.id)
        if (textareaWidget) {
          s.project.uiDesign.widgets[textareaWidget.id] = textareaWidget
          parent.childIds.push(textareaWidget.id)
        }
        if (labelWidget) {
          s.project.uiDesign.widgets[labelWidget.id] = labelWidget
          parent.childIds.push(labelWidget.id)
        }
        s.selectedWidgetId = widget.id
        s.dirty = true
      })
      return widget.id
    },

    addUiComponentTemplate: (templateId, parentId, x, y) => {
      const { root, descendants } = createComponentTemplate(templateId)
      root.parentId = parentId
      root.style.x = x
      root.style.y = y
      set((s) => {
        const parent = s.project.uiDesign.widgets[parentId]
        if (!parent) return
        s.project.uiDesign.widgets[root.id] = root
        parent.childIds.push(root.id)
        for (const d of descendants) s.project.uiDesign.widgets[d.id] = d
        s.selectedWidgetId = root.id
        s.dirty = true
      })
      return root.id
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
        if (partial.eventCallbackEnabled !== undefined) w.eventCallbackEnabled = partial.eventCallbackEnabled
        if (partial.eventCallbackTriggers !== undefined) w.eventCallbackTriggers = partial.eventCallbackTriggers
        if (partial.focusable !== undefined) w.focusable = partial.focusable
        if (partial.iconSymbol !== undefined) w.iconSymbol = partial.iconSymbol ?? undefined
        if (partial.visibleWhenExpr !== undefined) w.visibleWhenExpr = partial.visibleWhenExpr ?? undefined
        s.dirty = true
      }),

    setUiWidgetThemeToken: (id, field, token) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (!w) return
        if (!w.themeTokens) w.themeTokens = {}
        if (token) w.themeTokens[field] = token
        else delete w.themeTokens[field]
        s.dirty = true
      }),

    applyMaterialPreset: (id, presetId) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        const preset = MATERIAL_PRESETS[presetId]
        if (!w || !preset) return
        Object.assign(w.style, preset.style)
        for (const stateName of Object.keys(preset.states) as (keyof typeof preset.states)[]) {
          const statePartial = preset.states[stateName]
          if (!statePartial) continue
          w.states[stateName] = { ...w.states[stateName], ...statePartial }
        }
        s.dirty = true
      }),

    setUiTheme: (theme) =>
      set((s) => {
        s.project.uiDesign.theme = theme
        if (theme === 'custom' && !s.project.uiDesign.customThemeTokens) {
          s.project.uiDesign.customThemeTokens = { ...DEFAULT_CUSTOM_THEME_TOKENS }
        }
        s.dirty = true
      }),

    setUiCustomThemeTokens: (partial) =>
      set((s) => {
        if (!s.project.uiDesign.customThemeTokens) s.project.uiDesign.customThemeTokens = { ...DEFAULT_CUSTOM_THEME_TOKENS }
        Object.assign(s.project.uiDesign.customThemeTokens, partial)
        s.dirty = true
      }),

    applyUiScreenCustomCode: (screenId, code, generatedBaseline) =>
      set((s) => {
        const screen = s.project.uiDesign.screens.find((sc) => sc.id === screenId)
        if (!screen) return
        screen.customCode = code
        screen.customCodeBaseline = generatedBaseline
        s.dirty = true
      }),

    resetUiScreenCustomCode: (screenId) =>
      set((s) => {
        const screen = s.project.uiDesign.screens.find((sc) => sc.id === screenId)
        if (!screen) return
        screen.customCode = undefined
        screen.customCodeBaseline = undefined
        s.dirty = true
      }),

    patchUiScreenCustomCode: (screenId, code) =>
      set((s) => {
        const screen = s.project.uiDesign.screens.find((sc) => sc.id === screenId)
        if (!screen || screen.customCode == null || screen.customCode === code) return
        screen.customCode = code
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

    addUiVariable: (name, type, scope) => {
      const id = nanoid(10)
      const defaultValue: string | number | boolean = type === 'number' ? 0 : type === 'boolean' ? false : type === 'color' ? '#ffffff' : ''
      set((s) => {
        s.project.uiDesign.variables.push({ id, name, type, scope, defaultValue })
        s.dirty = true
      })
      return id
    },

    updateUiVariable: (id, partial) =>
      set((s) => {
        const v = s.project.uiDesign.variables.find((v) => v.id === id)
        if (v) Object.assign(v, partial)
        s.dirty = true
      }),

    deleteUiVariable: (id) =>
      set((s) => {
        s.project.uiDesign.variables = s.project.uiDesign.variables.filter((v) => v.id !== id)
        s.dirty = true
      }),

    duplicateUiVariable: (id) => {
      const source = useStore.getState().project.uiDesign.variables.find((v) => v.id === id)
      if (!source) return null
      const newId = nanoid(10)
      set((s) => {
        s.project.uiDesign.variables.push({ ...source, id: newId, name: `${source.name} copy` })
        s.dirty = true
      })
      return newId
    },

    runtimeVariableValues: {},
    setRuntimeVariableValue: (name, value) =>
      set((s) => {
        s.runtimeVariableValues[name] = value
      }),
    resetRuntimeVariableValues: () =>
      set((s) => {
        s.runtimeVariableValues = {}
      }),

    addUiDataSource: () => {
      const id = nanoid(10)
      set((s) => {
        s.project.uiDesign.dataSources.push({
          id,
          name: `DataSource${s.project.uiDesign.dataSources.length + 1}`,
          sourceKind: 'static',
          fields: [],
          keyFieldId: null,
          sampleData: '[]'
        })
        s.dirty = true
      })
      return id
    },

    updateUiDataSource: (id, partial) =>
      set((s) => {
        const d = s.project.uiDesign.dataSources.find((d) => d.id === id)
        if (d) Object.assign(d, partial)
        s.dirty = true
      }),

    deleteUiDataSource: (id) =>
      set((s) => {
        s.project.uiDesign.dataSources = s.project.uiDesign.dataSources.filter((d) => d.id !== id)
        s.dirty = true
      }),

    duplicateUiDataSource: (id) => {
      const source = useStore.getState().project.uiDesign.dataSources.find((d) => d.id === id)
      if (!source) return null
      const newId = nanoid(10)
      set((s) => {
        s.project.uiDesign.dataSources.push({
          ...source,
          id: newId,
          name: `${source.name} copy`,
          fields: source.fields.map((f) => ({ ...f, id: nanoid(8) }))
        })
        s.dirty = true
      })
      return newId
    },

    addUiDataSourceField: (dataSourceId) => {
      const id = nanoid(8)
      set((s) => {
        const d = s.project.uiDesign.dataSources.find((d) => d.id === dataSourceId)
        if (d) d.fields.push({ id, name: `field${d.fields.length + 1}`, type: 'string' })
        s.dirty = true
      })
      return id
    },

    updateUiDataSourceField: (dataSourceId, fieldId, partial) =>
      set((s) => {
        const d = s.project.uiDesign.dataSources.find((d) => d.id === dataSourceId)
        const f = d?.fields.find((f) => f.id === fieldId)
        if (f) Object.assign(f, partial)
        s.dirty = true
      }),

    deleteUiDataSourceField: (dataSourceId, fieldId) =>
      set((s) => {
        const d = s.project.uiDesign.dataSources.find((d) => d.id === dataSourceId)
        if (d) d.fields = d.fields.filter((f) => f.id !== fieldId)
        s.dirty = true
      }),

    reorderUiDataSourceField: (dataSourceId, fromIndex, toIndex) =>
      set((s) => {
        const d = s.project.uiDesign.dataSources.find((d) => d.id === dataSourceId)
        if (!d) return
        const [moved] = d.fields.splice(fromIndex, 1)
        if (moved) d.fields.splice(toIndex, 0, moved)
        s.dirty = true
      }),

    runtimeDataListItems: {},
    setRuntimeDataListItems: (widgetId, items) =>
      set((s) => {
        s.runtimeDataListItems[widgetId] = items
      }),
    resetRuntimeDataListItems: () =>
      set((s) => {
        s.runtimeDataListItems = {}
      }),

    keyboardRuntime: {},
    setKeyboardRuntimeState: (widgetId, partial) =>
      set((s) => {
        const widget = s.project.uiDesign.widgets[widgetId]
        if (!widget?.keyboardConfig) return
        const existing = s.keyboardRuntime[widgetId] ?? defaultKeyboardRuntimeState(widget.keyboardConfig)
        s.keyboardRuntime[widgetId] = { ...existing, ...partial }
      }),
    resetKeyboardRuntime: () =>
      set((s) => {
        s.keyboardRuntime = {}
      }),

    simulatedFocusWidgetId: null,
    simulatedFocusEditing: false,
    simulatedFocusKeyId: null,

    simulateFocusNext: () =>
      set((s) => {
        const focusable = focusableWidgetsForActiveScreen(s.project)
        if (focusable.length === 0) return
        const focusedWidget = s.simulatedFocusWidgetId ? s.project.uiDesign.widgets[s.simulatedFocusWidgetId] : undefined
        if (s.simulatedFocusEditing && focusedWidget?.type === 'keyboard' && focusedWidget.keyboardConfig) {
          const rt = s.keyboardRuntime[focusedWidget.id] ?? defaultKeyboardRuntimeState(focusedWidget.keyboardConfig)
          const keys = resolveKeyboardMap(focusedWidget.keyboardConfig, rt.case, rt.page).flat()
          if (keys.length === 0) return
          const idx = keys.findIndex((k) => k.keyId === s.simulatedFocusKeyId)
          s.simulatedFocusKeyId = keys[(idx + 1 + keys.length) % keys.length].keyId
          return
        }
        const idx = focusable.findIndex((w) => w.id === s.simulatedFocusWidgetId)
        s.simulatedFocusWidgetId = focusable[(idx + 1 + focusable.length) % focusable.length].id
        s.simulatedFocusEditing = false
        s.simulatedFocusKeyId = null
      }),

    simulateFocusPrevious: () =>
      set((s) => {
        const focusable = focusableWidgetsForActiveScreen(s.project)
        if (focusable.length === 0) return
        const focusedWidget = s.simulatedFocusWidgetId ? s.project.uiDesign.widgets[s.simulatedFocusWidgetId] : undefined
        if (s.simulatedFocusEditing && focusedWidget?.type === 'keyboard' && focusedWidget.keyboardConfig) {
          const rt = s.keyboardRuntime[focusedWidget.id] ?? defaultKeyboardRuntimeState(focusedWidget.keyboardConfig)
          const keys = resolveKeyboardMap(focusedWidget.keyboardConfig, rt.case, rt.page).flat()
          if (keys.length === 0) return
          const idx = keys.findIndex((k) => k.keyId === s.simulatedFocusKeyId)
          s.simulatedFocusKeyId = keys[(idx - 1 + keys.length) % keys.length].keyId
          return
        }
        const idx = focusable.findIndex((w) => w.id === s.simulatedFocusWidgetId)
        s.simulatedFocusWidgetId = focusable[idx === -1 ? 0 : (idx - 1 + focusable.length) % focusable.length].id
        s.simulatedFocusEditing = false
        s.simulatedFocusKeyId = null
      }),

    // Pressing a non-keyboard focused widget is intentionally a no-op here (not routed through
    // the script sandbox's dispatchWidgetEvent) — this simulate control exists to exercise a
    // keyboard's own encoder-driven key navigation (see the store field's own doc comment above),
    // not to duplicate the existing hardware.onEncoderRotate() Simulate section already built for
    // testing script event handlers.
    simulateFocusPress: () =>
      set((s) => {
        const focusable = focusableWidgetsForActiveScreen(s.project)
        if (focusable.length === 0) return
        if (!s.simulatedFocusWidgetId) {
          s.simulatedFocusWidgetId = focusable[0].id
          s.simulatedFocusEditing = false
          s.simulatedFocusKeyId = null
          return
        }
        const focusedWidget = s.project.uiDesign.widgets[s.simulatedFocusWidgetId]
        if (!focusedWidget?.keyboardConfig || focusedWidget.type !== 'keyboard') return

        const config = focusedWidget.keyboardConfig
        const existing = s.keyboardRuntime[focusedWidget.id] ?? defaultKeyboardRuntimeState(config)
        const keys = resolveKeyboardMap(config, existing.case, existing.page).flat()

        if (!s.simulatedFocusEditing) {
          // First press on a keyboard enters it (matches lv_group_set_editing(group, true)) —
          // subsequent Next/Previous navigate its keys instead of screen widgets.
          s.simulatedFocusEditing = true
          s.simulatedFocusKeyId = keys[0]?.keyId ?? null
          return
        }

        const key = keys.find((k) => k.keyId === s.simulatedFocusKeyId)
        if (!key) return
        const targetTextarea = config.targetTextareaId ? s.project.uiDesign.widgets[config.targetTextareaId] : undefined
        const maxLength = typeof targetTextarea?.props.maxLength === 'number' ? targetTextarea.props.maxLength : 0
        let updated = existing
        applyKeyboardKeyPress(focusedWidget.id, config, existing, key, maxLength, (_id, partial) => {
          updated = { ...updated, ...partial }
        })
        s.keyboardRuntime[focusedWidget.id] = updated
      }),

    resetSimulatedFocus: () =>
      set((s) => {
        s.simulatedFocusWidgetId = null
        s.simulatedFocusEditing = false
        s.simulatedFocusKeyId = null
      }),

    updateUiWidgetProps: (id, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[id]
        if (w) Object.assign(w.props, partial)
        s.dirty = true
      }),

    addUiListItem: (widgetId) => {
      const id = nanoid(8)
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        if (!w) return
        const items = w.listItems ?? (w.listItems = [])
        // Auto-suggest a widgetId that doesn't collide with this widget's own existing items —
        // cross-widget collisions are still caught by the Properties panel's inline validation
        // (see ListItemsSection), same "suggest something reasonable, validate the real thing on
        // top" split already used for reorderUiWidget/duplicateUiWidget elsewhere in this file.
        let n = items.length + 1
        while (items.some((it) => it.widgetId === `item_${n}`)) n++
        items.push({ id, widgetId: `item_${n}`, text: `Item ${n}`, iconSymbol: null, clickEventEnabled: true, encoderFocusEnabled: true })
        s.dirty = true
      })
      return id
    },

    updateUiListItem: (widgetId, itemId, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        const item = w?.listItems?.find((it) => it.id === itemId)
        if (!item) return
        Object.assign(item, partial)
        s.dirty = true
      }),

    deleteUiListItem: (widgetId, itemId) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        if (!w?.listItems) return
        w.listItems = w.listItems.filter((it) => it.id !== itemId)
        s.dirty = true
      }),

    duplicateUiListItem: (widgetId, itemId) => {
      let newId: string | null = null
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        const items = w?.listItems
        if (!items) return
        const idx = items.findIndex((it) => it.id === itemId)
        if (idx === -1) return
        const original = items[idx]
        let widgetIdCandidate = `${original.widgetId}_copy`
        let n = 2
        while (items.some((it) => it.widgetId === widgetIdCandidate)) {
          widgetIdCandidate = `${original.widgetId}_copy${n}`
          n++
        }
        newId = nanoid(8)
        items.splice(idx + 1, 0, { ...original, id: newId, widgetId: widgetIdCandidate })
        s.dirty = true
      })
      return newId
    },

    reorderUiListItem: (widgetId, fromIndex, toIndex) =>
      set((s) => {
        const items = s.project.uiDesign.widgets[widgetId]?.listItems
        if (!items || fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) return
        const [moved] = items.splice(fromIndex, 1)
        items.splice(Math.max(0, Math.min(toIndex, items.length)), 0, moved)
        s.dirty = true
      }),

    updateUiKeyboardConfig: (widgetId, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        if (!w?.keyboardConfig) return
        Object.assign(w.keyboardConfig, partial)
        s.dirty = true
      }),

    updateUiDataListConfig: (widgetId, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        if (!w?.dataListConfig) return
        Object.assign(w.dataListConfig, partial)
        s.dirty = true
      }),

    updateUiWidgetOptionsSource: (widgetId, partial) =>
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        if (!w?.optionsSource) return
        Object.assign(w.optionsSource, partial)
        s.dirty = true
      }),

    addUiKeyboardCustomKey: (widgetId) => {
      const id = nanoid(6)
      set((s) => {
        const w = s.project.uiDesign.widgets[widgetId]
        if (!w?.keyboardConfig) return
        const layout = w.keyboardConfig.customLayout ?? (w.keyboardConfig.customLayout = { keys: [] })
        layout.keys.push({ id, label: 'Key', insertText: 'Key' })
        s.dirty = true
      })
      return id
    },

    updateUiKeyboardCustomKey: (widgetId, keyId, partial) =>
      set((s) => {
        const key = s.project.uiDesign.widgets[widgetId]?.keyboardConfig?.customLayout?.keys.find((k) => k.id === keyId)
        if (!key) return
        Object.assign(key, partial)
        s.dirty = true
      }),

    deleteUiKeyboardCustomKey: (widgetId, keyId) =>
      set((s) => {
        const layout = s.project.uiDesign.widgets[widgetId]?.keyboardConfig?.customLayout
        if (!layout) return
        layout.keys = layout.keys.filter((k) => k.id !== keyId)
        s.dirty = true
      }),

    reorderUiKeyboardCustomKey: (widgetId, fromIndex, toIndex) =>
      set((s) => {
        const keys = s.project.uiDesign.widgets[widgetId]?.keyboardConfig?.customLayout?.keys
        if (!keys || fromIndex === toIndex || fromIndex < 0 || fromIndex >= keys.length) return
        const [moved] = keys.splice(fromIndex, 1)
        keys.splice(Math.max(0, Math.min(toIndex, keys.length)), 0, moved)
        s.dirty = true
      }),

    addUiCustomFont: (name, cSource) => {
      const id = nanoid(8)
      const declaredCodepoints = parseDeclaredCodepoints(cSource)
      set((s) => {
        s.project.uiDesign.customFonts.push({ id, name, cSource, declaredCodepoints })
        s.dirty = true
      })
      return id
    },

    renameUiCustomFont: (id, name) =>
      set((s) => {
        const font = s.project.uiDesign.customFonts.find((f) => f.id === id)
        if (font) font.name = name
        s.dirty = true
      }),

    deleteUiCustomFont: (id) =>
      set((s) => {
        s.project.uiDesign.customFonts = s.project.uiDesign.customFonts.filter((f) => f.id !== id)
        // A keyboard/textarea referencing the deleted font falls back to the default font (null)
        // rather than pointing at a dangling id — mirrors how deleteUiAsset-equivalent cleanups
        // elsewhere in this file null out references instead of leaving them dangling.
        for (const w of Object.values(s.project.uiDesign.widgets)) {
          if (w.keyboardConfig?.customFontId === id) w.keyboardConfig.customFontId = null
        }
        s.dirty = true
      }),

    setUiActiveScreen: (screenId) =>
      set((s) => {
        const ud = s.project.uiDesign
        if (!ud.screens.some((sc) => sc.id === screenId)) return
        if (ud.activeScreenId === screenId) return
        // Remember the selection on the screen we're leaving, then restore whatever was selected on
        // the screen we switch to (validated against the current widget map so a stale remembered id
        // never selects a deleted widget). Keeps each tab's "selected layer" intact.
        if (ud.activeScreenId) s.uiScreenSelection[ud.activeScreenId] = s.selectedWidgetId
        ud.activeScreenId = screenId
        const remembered = s.uiScreenSelection[screenId] ?? null
        s.selectedWidgetId = remembered && ud.widgets[remembered] ? remembered : null
      }),

    addUiScreen: (name) => {
      const root = createWidget('screen')
      const id = nanoid(10)
      set((s) => {
        const ud = s.project.uiDesign
        const existing = new Set(ud.screens.map((sc) => sc.name))
        let screenName = name?.trim() || ''
        if (!screenName) {
          let n = ud.screens.length + 1
          while (existing.has(`Screen ${n}`)) n++
          screenName = `Screen ${n}`
        }
        ud.widgets[root.id] = root
        // New screen starts from the project's default background but owns it independently after.
        ud.screens.push({ id, name: screenName, rootWidgetId: root.id, displayStyle: { backgroundColor: ud.display.backgroundColor } })
        if (ud.activeScreenId) s.uiScreenSelection[ud.activeScreenId] = s.selectedWidgetId
        ud.activeScreenId = id
        s.selectedWidgetId = null
        s.dirty = true
      })
      return id
    },

    renameUiScreen: (screenId, name) =>
      set((s) => {
        const ud = s.project.uiDesign
        const sc = ud.screens.find((x) => x.id === screenId)
        const trimmed = name.trim()
        if (!sc || !trimmed || sc.name === trimmed) return
        const oldName = sc.name
        sc.name = trimmed
        // Screens have a stable id, but the script navigation API addresses them by name
        // (`ui.showScreen("Settings")`). Rewrite those refs to the new name so a rename never breaks
        // an existing navigation call — matching a quoted screen name inside a showScreen(...) call
        // only, preserving the quote style, so no other string literal is touched.
        if (ud.script && ud.script.includes(oldName)) {
          const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ud.script = ud.script.replace(new RegExp(`(showScreen\\s*\\(\\s*)(["'])${esc}\\2`, 'g'), (_m, pre, q) => `${pre}${q}${trimmed}${q}`)
        }
        s.dirty = true
      }),

    duplicateUiScreen: (screenId) => {
      const ud = useStore.getState().project.uiDesign
      const src = ud.screens.find((x) => x.id === screenId)
      if (!src) return null
      const widgets = ud.widgets
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
      const newRootId = cloneSubtree(src.rootWidgetId, null)
      const newId = nanoid(10)
      set((s) => {
        const u = s.project.uiDesign
        const existing = new Set(u.screens.map((sc) => sc.name))
        let newName = `${src.name} copy`
        let n = 2
        while (existing.has(newName)) newName = `${src.name} copy ${n++}`
        for (const clone of clones) u.widgets[clone.id] = clone
        const idx = u.screens.findIndex((x) => x.id === screenId)
        u.screens.splice(idx + 1, 0, { id: newId, name: newName, rootWidgetId: newRootId, displayStyle: src.displayStyle ? { ...src.displayStyle } : undefined })
        if (u.activeScreenId) s.uiScreenSelection[u.activeScreenId] = s.selectedWidgetId
        u.activeScreenId = newId
        s.selectedWidgetId = null
        s.dirty = true
      })
      return newId
    },

    deleteUiScreen: (screenId) =>
      set((s) => {
        const ud = s.project.uiDesign
        if (ud.screens.length <= 1) return // a project always keeps at least one screen
        const idx = ud.screens.findIndex((x) => x.id === screenId)
        if (idx === -1) return
        const screen = ud.screens[idx]
        const removeSubtree = (wid: string) => {
          const node = ud.widgets[wid]
          if (!node) return
          for (const childId of node.childIds) removeSubtree(childId)
          delete ud.widgets[wid]
        }
        removeSubtree(screen.rootWidgetId)
        ud.screens.splice(idx, 1)
        delete s.uiScreenSelection[screenId]
        if (ud.activeScreenId === screenId) {
          const next = ud.screens[Math.min(idx, ud.screens.length - 1)]
          ud.activeScreenId = next.id
          const remembered = s.uiScreenSelection[next.id] ?? null
          s.selectedWidgetId = remembered && ud.widgets[remembered] ? remembered : null
        }
        s.dirty = true
      }),

    reorderUiScreens: (fromIndex, toIndex) =>
      set((s) => {
        const scr = s.project.uiDesign.screens
        if (fromIndex < 0 || fromIndex >= scr.length || toIndex < 0 || toIndex >= scr.length || fromIndex === toIndex) return
        const [moved] = scr.splice(fromIndex, 1)
        scr.splice(toIndex, 0, moved)
        s.dirty = true
      }),

    setUiScreenStyle: (screenId, partial) =>
      set((s) => {
        const sc = s.project.uiDesign.screens.find((x) => x.id === screenId)
        if (!sc) return
        // Seed from the current global default the first time this screen gets its own style, so an
        // untouched screen doesn't silently flip color when only (e.g.) opacity is set.
        sc.displayStyle = { backgroundColor: s.project.uiDesign.display.backgroundColor, ...sc.displayStyle, ...partial }
        s.dirty = true
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

    setUiPreviewDisplayOverride: (display) => set((s) => void (s.uiPreviewDisplayOverride = display)),

    setUiRevealWidgetId: (id) => set((s) => void (s.uiRevealWidgetId = id)),
    toggleUiEsp32Preview: () => set((s) => void (s.uiEsp32PreviewMode = !s.uiEsp32PreviewMode)),
    setUiPreviewState: (state) => set((s) => void (s.uiPreviewState = state)),

    updateUiWorkspaceView: (partial) => set((s) => void Object.assign(s.uiWorkspaceView, partial)),
    setUiDragPreview: (preview) => set((s) => void (s.uiDragPreview = preview)),
    setUiCanvasViewportSize: (size) => set((s) => void (s.uiCanvasViewportSize = size))
  }))
)

useStore.setState((s) => ({ activeAnimationId: s.project.animations[0]?.id ?? '' }))

export function getActiveAnimation(): Animation | undefined {
  const s = useStore.getState()
  return activeAnimationOf(s.project, s.activeAnimationId)
}
