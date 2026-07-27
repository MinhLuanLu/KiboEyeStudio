export interface EyeParams {
  width: number
  height: number
  radius: number
  distance: number
  rotation: number
  irisWidth: number
  irisHeight: number
  pupilWidth: number
  pupilHeight: number
  pupilX: number
  pupilY: number
  /** Pupil's own tilt, independent of the eye's rotation — 0-360°. */
  pupilRotation: number
  /** Which outline the pupil renders as. 'circle'/'oval' both draw via the same ellipse path
   * (identical rendering) — 'circle' is purely a UI convenience that snaps pupilWidth/Height
   * equal when selected; the renderer never distinguishes them. Every other value draws a
   * shared normalized polygon from src/renderer/pupilShapes.ts, scaled/rotated/positioned by
   * pupilWidth/Height/X/Y/Rotation exactly like the ellipse is today. Not numerically
   * interpolatable — see lerpParams()'s explicit step-at-midpoint handling in interpolate.ts. */
  pupilShape: PupilShapeId
  /** Id into Project.customPupilShapes — only meaningful when pupilShape === 'custom'. */
  pupilCustomShapeId: string | null
  upperEyelid: number
  lowerEyelid: number
  /** Tilts each lid's covering edge independently, -45..45°. */
  upperEyelidTilt: number
  lowerEyelidTilt: number
  /** How pronounced each lid's soft curved edge is: 0 (flat/neutral), -100 (curved inward) to 100 (curved outward). */
  upperEyelidCurvature: number
  lowerEyelidCurvature: number
  highlightX: number
  highlightY: number
  highlightSize: number
}

/** Built-in pupil outlines plus 'custom' (an imported SVG shape, referenced by
 * EyeParams.pupilCustomShapeId). 'circle' and 'oval' render identically (see
 * EyeParams.pupilShape) — kept as separate ids only so the shape picker can offer both. */
export type PupilShapeId = 'circle' | 'oval' | 'heart' | 'star' | 'diamond' | 'square' | 'triangle' | 'custom'

/** A user-imported pupil shape, normalized to a [-1,1]-centered bounding box — the same space
 * every built-in polygon shape in src/renderer/pupilShapes.ts uses, so the renderer and C++
 * export need exactly one "draw a polygon pupil" code path regardless of built-in vs. custom.
 * Reusable across any number of expressions/keyframes (referenced by id, not copied). */
export interface CustomPupilShape {
  id: string
  name: string
  points: [number, number][]
}

export interface EyeColors {
  sclera: string
  iris: string
  pupil: string
  highlight: string
  shadow: string
  glow: string
  border: string
  shadowIntensity: number
  glowIntensity: number
  borderOpacity: number
  /** RGB565 has no alpha channel — pre-blended against the iris at export time into a single
   * flat color, same pattern as borderOpacity (see colorSetLiteral() in cppExport.ts). */
  pupilOpacity: number
  /** Ring thickness in device pixels. Was a fixed constant (3px, matched between preview and
   * export) until the Visual Reference system made it an adjustable, shared style property. */
  borderWidth: number
}

export type DisplayShape = 'circle' | 'square' | 'rounded'

export interface DisplaySettings {
  shape: DisplayShape
  width: number
  height: number
  cornerRadius: number
  backgroundColor: string
  showBezel: boolean
  fps: number
}

export type EasingType =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'bounce'
  | 'elastic'
  | 'bezier'

export interface Keyframe {
  id: string
  duration: number
  easing: EasingType
  customBezier?: [number, number, number, number]
  params: EyeParams
  /** Names of `params` fields (from STYLE_EYE_PARAM_FIELDS) that are pinned as intentional
   * customizations for this keyframe — e.g. a blink's eyelid values, a look's pupil offset.
   * Fields NOT listed here track the project's Visual Reference and get overwritten whenever
   * it's applied. See STYLE_EYE_PARAM_FIELDS and computeStyleOverrides below. */
  styleOverrides: string[]
}

export interface Animation {
  id: string
  name: string
  loop: boolean
  keyframes: Keyframe[]
  /** Stickers visible only while this animation is playing — see StickerInstance below. */
  stickers: StickerInstance[]
}

/** Which eye(s) the Controls/Colors panels currently write to. Editor/session state rather
 * than project data — it lives outside `Project` (the *result* of edits made under
 * 'left'/'right' is what gets saved, via the params/colors override fields below), but it
 * IS persisted to disk alongside the project via `ProjectFile.editorState` so reopening a
 * saved project resumes with the same Eye Target selected. */
export type EyeSide = 'both' | 'left' | 'right'

export interface Expression {
  id: string
  name: string
  params: EyeParams
  colors: EyeColors
  /** Per-eye overrides captured at Save time. `null` means this eye had no divergence from
   * `params`/`colors` (the "both eyes" baseline) when the expression was saved. */
  leftParams: EyeParams | null
  rightParams: EyeParams | null
  leftColors: EyeColors | null
  rightColors: EyeColors | null
  /** Names of `params`/`colors` fields (from STYLE_EYE_PARAM_FIELDS/STYLE_EYE_COLOR_FIELDS)
   * that are pinned as intentional customizations for this expression — e.g. Angry's eyelid
   * tilt, Surprised's eye size. Fields NOT listed here track the project's Visual Reference
   * and get overwritten whenever it's applied. Shared across this expression's base pose and
   * any left/right divergence (leftParams/rightParams/leftColors/rightColors) rather than
   * tracked separately per eye, to keep the override model simple. */
  styleOverrides: string[]
  /** Stickers visible only while this expression is applied — see StickerInstance below. */
  stickers: StickerInstance[]
}

export interface Personality {
  blinkFrequency: number
  curiosity: number
  energy: number
  confidence: number
  sleepiness: number
  movementSpeed: number
  randomEyeDrift: number
  microMovement: number
  idleDelay: number
}

export interface GlobalTiming {
  animationSpeed: number
  blinkSpeed: number
  breathingAmount: number
}

// ---- Visual Reference (shared style inheritance) ---------------------------------------
//
// Kibo Eye Studio separates project data into two kinds:
//   - Visual style: the shared, project-wide appearance (shape, colors, border, curvature
//     defaults, highlight) — authored once in the Visual Reference tab.
//   - Animation/expression data: movement, timing, positions, transitions, and the
//     emotion-specific overrides that make a look distinctly "angry" or a motion distinctly
//     "look left" — always local to that expression/keyframe, never shared.
//
// Every Expression and Keyframe still stores a complete, fully-resolved EyeParams (and, for
// Expressions, EyeColors) — exactly as before — so the renderer and C++ export never need to
// know this system exists; they only ever see concrete values. `styleOverrides` is pure
// bookkeeping layered on top: it names which of those already-resolved fields are pinned
// custom values versus which ones should be kept in sync with the Visual Reference the next
// time it's applied. This is what lets Apply update a field in place without needing any
// separate "resolve inherited value" step anywhere else in the codebase.

/** Which EyeParams fields count as shared visual style (eligible for Visual Reference
 * inheritance) rather than movement/position/timing data, which is always local. Kept in one
 * place so the Visual Reference tab, the per-field override indicators, and the Apply logic
 * all agree on exactly the same set. */
export const STYLE_EYE_PARAM_FIELDS: (keyof EyeParams)[] = [
  'width',
  'height',
  'radius',
  'irisWidth',
  'irisHeight',
  'pupilWidth',
  'pupilHeight',
  'pupilShape',
  'pupilCustomShapeId',
  'upperEyelidCurvature',
  'lowerEyelidCurvature',
  'highlightX',
  'highlightY',
  'highlightSize'
]

/** Every EyeColors field is shared visual style — colors were never per-keyframe to begin
 * with (see Keyframe — it has no `colors` field at all), and Expression color divergence has
 * always been a studio preview/thumbnail concept rather than something the C++ export reads
 * per-expression (export colors always come from the project's shared base, see
 * leftEyeColors/rightEyeColors). */
export const STYLE_EYE_COLOR_FIELDS: (keyof EyeColors)[] = [
  'sclera',
  'iris',
  'pupil',
  'highlight',
  'shadow',
  'glow',
  'border',
  'shadowIntensity',
  'glowIntensity',
  'borderOpacity',
  'borderWidth',
  'pupilOpacity'
]

export interface VisualReferenceStyle {
  params: EyeParams
  colors: EyeColors
  /** Optional per-eye overrides for the Visual Reference's own authored style — same
   * null-means-follow-shared convention as Project.eyeLeftOverride/eyeRightOverride below.
   * Most projects never touch these (Visual Reference is normally authored once for both
   * eyes); Apply Visual Reference reads whichever is effective for the eye(s) it targets. */
  paramsLeftOverride: EyeParams | null
  paramsRightOverride: EyeParams | null
  colorsLeftOverride: EyeColors | null
  colorsRightOverride: EyeColors | null
}

/** A field is "overridden" (pinned/custom) if it's listed by name in a styleOverrides array;
 * anything not listed is "inherited" and tracks the Visual Reference. */
export function isStyleFieldOverridden(styleOverrides: string[], field: string): boolean {
  return styleOverrides.includes(field)
}

/** Computes which style fields in `params`/`colors` already differ from the Visual
 * Reference's values, so they can be pinned as intentional customizations rather than
 * silently reset on the next Apply. Used for: migrating legacy project files that predate
 * this system (every field they happen to differ on becomes a protected override), and for
 * seeding new expressions/keyframes (whatever they were created from is preserved as-is;
 * only fields that already match the Visual Reference start out "inherited"). */
export function computeStyleOverrides(params: EyeParams, colors: EyeColors | null, vr: VisualReferenceStyle): string[] {
  const overrides: string[] = []
  for (const f of STYLE_EYE_PARAM_FIELDS) {
    if (params[f] !== vr.params[f]) overrides.push(f)
  }
  if (colors) {
    for (const f of STYLE_EYE_COLOR_FIELDS) {
      if (colors[f] !== vr.colors[f]) overrides.push(f)
    }
  }
  return overrides
}

/** Copies every Visual-Reference-eligible EyeParams field from `vr` into `target` EXCEPT
 * fields listed in `overrides` — mutates `target` in place (called from Immer producers).
 * Mostly-numeric fields, plus pupilShape/pupilCustomShapeId (string/string|null). */
export function applyStyleToParams(target: EyeParams, vr: EyeParams, overrides: string[]): void {
  const t = target as unknown as Record<string, number | string | null>
  const v = vr as unknown as Record<string, number | string | null>
  for (const f of STYLE_EYE_PARAM_FIELDS) {
    if (!overrides.includes(f)) t[f] = v[f]
  }
}

/** Same as applyStyleToParams, for EyeColors. */
export function applyStyleToColors(target: EyeColors, vr: EyeColors, overrides: string[]): void {
  const t = target as unknown as Record<string, number | string>
  const v = vr as unknown as Record<string, number | string>
  for (const f of STYLE_EYE_COLOR_FIELDS) {
    if (!overrides.includes(f)) t[f] = v[f]
  }
}

// ---- Stickers -----------------------------------------------------------
//
// Stickers are decorations (rain, snow, "Zzz", hearts, a custom imported PNG/GIF, ...) placed
// behind or in front of the eyes. Like pupil shapes, they split into a reusable *asset*
// (StickerAsset — either a built-in procedural drawer or an imported raster image/GIF's
// frames) and any number of placed *instances* (StickerInstance — position/size/rotation/
// opacity/tint/animation for one placement of that asset), referenced by id so the same
// asset can be placed many times with different settings.
//
// Instances attach at three levels — Project.stickers (always visible), Expression.stickers
// (visible while that expression is applied), Animation.stickers (visible while that
// animation plays) — the same "project vs. expression vs. animation" scoping this codebase
// already uses elsewhere, just for a new kind of data. See effectiveStickers() below.

export type StickerLayer = 'behind' | 'front'
/** Which sticker list the Sticker Manager's add/edit actions currently target — editor/session
 * state, same role EyeSide plays for eyeTarget (see state/store.ts's stickerScope). */
export type StickerScope = 'project' | 'expression' | 'animation'
export type StickerLoopMode = 'once' | 'loop' | 'pingpong'
export type StickerAssetKind = 'procedural' | 'raster'

/** Built-in procedural sticker ids — see src/renderer/builtinStickers.ts for their drawers. */
export type BuiltinStickerId =
  | 'rain'
  | 'snow'
  | 'zzz'
  | 'stars'
  | 'hearts'
  | 'sparkles'
  | 'clouds'
  | 'tears'
  | 'fire'
  | 'smoke'
  | 'lightning'
  | 'burstLines'
  | 'expandingCircles'
  | 'confetti'

/** A sticker's reusable *source* — either a built-in procedural drawer (kind 'procedural') or
 * an imported image's frame(s) (kind 'raster', PNG = 1 frame, GIF = many). Shared across any
 * number of StickerInstance placements, same asset/instance split as CustomPupilShape. */
export interface StickerAsset {
  id: string
  name: string
  kind: StickerAssetKind
  /** Set when kind === 'procedural'. */
  builtinId?: BuiltinStickerId
  /** Set when kind === 'raster' — data URLs (already-decoded PNG/GIF frames), one per frame. */
  frames?: string[]
  /** Per-frame delay in ms, preserved from the source GIF's own timing. Same length as
   * `frames`. A single-frame PNG asset still gets a 1-length array (delay is irrelevant but
   * kept for a uniform shape). */
  frameDelaysMs?: number[]
  naturalWidth?: number
  naturalHeight?: number
  /** Raw RGBA pixel data per frame (capped at 64x64 — see stickerImport.ts), stored alongside
   * `frames` specifically so the C++ export (cppExport.ts) can resize/quantize to RGB565 and
   * bake PROGMEM pixel arrays *synchronously*, with no DOM/Image decoding at export time —
   * `frames`'s data URLs need an async `<img>` load to get pixels back out, which the export
   * pipeline can't do (it also has to run in a plain Node script, with no DOM at all, for
   * this project's established arduino-cli compile-verification workflow). Same length as
   * `frames`. Only present on 'raster' assets. */
  frameRgba?: { width: number; height: number; data: number[] }[]
}

/** All per-sticker animation controls — evaluated as a closed-form function of elapsed time
 * rather than authored as a second keyframe timeline (deliberate scope decision — see the
 * Stickers plan). `speed`/`fps`/`reverse` govern raster GIF frame playback; the rest
 * (drift/spin/pulse) are simple parametric motion layered on top of the base transform,
 * applicable to procedural and raster stickers alike. */
export interface StickerAnimSettings {
  speed: number // % playback-speed multiplier for raster frame advance, default 100
  fps: number | null // overrides the raster asset's natural per-frame delays; null = use them as-authored
  startDelayMs: number
  loopMode: StickerLoopMode
  reverse: boolean
  fadeInMs: number
  fadeOutMs: number
  /** Visibility window relative to the owning expression/animation's own start time.
   * endTimeMs null = stays visible indefinitely once startTimeMs has elapsed. */
  startTimeMs: number
  endTimeMs: number | null
  driftX: number // px/s
  driftY: number // px/s
  spin: number // deg/s
  pulseScale: number // 0-100, sinusoidal amplitude on scale
  pulseOpacity: number // 0-100, sinusoidal amplitude on opacity
}

/** One placed sticker. */
export interface StickerInstance {
  id: string
  assetId: string
  name: string
  layer: StickerLayer
  /** Manual sort key within its layer (drag-reorder in the Sticker Manager). Lower draws
   * first (further back within that layer). */
  order: number
  x: number
  y: number
  width: number
  height: number
  /** % multiplier applied on top of width/height, default 100 — a separate control from
   * width/height per the spec's explicit "width, height, scale" wording. */
  scale: number
  rotation: number
  opacity: number
  /** null = the asset's native colors/frames, unmodified. */
  tint: string | null
  flipH: boolean
  flipV: boolean
  visible: boolean
  /** Blocks drag/edit only — a locked sticker still renders/animates normally. */
  locked: boolean
  anim: StickerAnimSettings
}

export const DEFAULT_STICKER_ANIM: StickerAnimSettings = {
  speed: 100,
  fps: null,
  startDelayMs: 0,
  loopMode: 'loop',
  reverse: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  startTimeMs: 0,
  endTimeMs: null,
  driftX: 0,
  driftY: 0,
  spin: 0,
  pulseScale: 0,
  pulseOpacity: 0
}

/** Merges project/expression/animation stickers into the single list the renderer and C++
 * export both draw from, sorted by layer then manual order — 'behind' stickers first (so
 * eyesDrawEyePair()/renderFace() can draw them, then the eyes, then 'front' stickers) and,
 * within a layer, by `order` ascending (lower draws first = further back). `activeExpression`/
 * `activeAnimation` are optional since not every render (e.g. idle mode with no expression
 * applied) has one. */
export function effectiveStickers(project: Project, activeExpression: Expression | null, activeAnimation: Animation | null): StickerInstance[] {
  const all = [...project.stickers, ...(activeExpression?.stickers ?? []), ...(activeAnimation?.stickers ?? [])]
  return all.sort((a, b) => {
    if (a.layer !== b.layer) return a.layer === 'behind' ? -1 : 1
    return a.order - b.order
  })
}

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  eyeBase: EyeParams
  colors: EyeColors
  /** Per-eye overrides for the live/base pose. `null` = this eye follows eyeBase/colors
   * (no divergence yet) — see the effectiveEyeParams/leftEyeParams/rightEyeParams helpers below. */
  eyeLeftOverride: EyeParams | null
  eyeRightOverride: EyeParams | null
  colorsLeftOverride: EyeColors | null
  colorsRightOverride: EyeColors | null
  display: DisplaySettings
  personality: Personality
  timing: GlobalTiming
  animations: Animation[]
  expressions: Expression[]
  /** The project's single shared default appearance — see VisualReferenceStyle below. */
  visualReference: VisualReferenceStyle
  /** Reusable library of imported custom pupil shapes — see CustomPupilShape above. */
  customPupilShapes: CustomPupilShape[]
  /** Reusable library of sticker assets (built-ins seeded once, plus custom imports) — see
   * StickerAsset above. */
  stickerAssets: StickerAsset[]
  /** Stickers always visible regardless of active expression/animation — see StickerInstance
   * and effectiveStickers() above. */
  stickers: StickerInstance[]
}

export type PlaybackMode = 'design' | 'animate' | 'idle'
export type PlaybackState = 'playing' | 'paused' | 'stopped'

// ---- Project file (save/load) ----------------------------------------------
//
// A saved `.kiboeyes` file is a versioned envelope around a `Project`, plus a small bit of
// "which tab/expression/eye was open" editor state — kept separate from `Project` itself so
// undo/redo (which snapshots `Project` only) doesn't also rewind which eye you're editing.
// `formatVersion` lets a future release detect and migrate older files (see
// migrateProjectFile in state/persistence.ts) rather than silently misreading them.

export const PROJECT_FILE_VERSION = 1

export interface EditorState {
  eyeTarget: EyeSide
  selectedExpressionId: string | null
  activeAnimationId: string
  mode: PlaybackMode
}

export function defaultEditorState(project: Project): EditorState {
  return {
    eyeTarget: 'both',
    selectedExpressionId: null,
    activeAnimationId: project.animations[0]?.id ?? '',
    mode: 'design'
  }
}

export interface ProjectFile {
  formatVersion: number
  project: Project
  editorState: EditorState
}

export const DEFAULT_EYE_PARAMS: EyeParams = {
  width: 78,
  height: 78,
  radius: 26,
  distance: 96,
  rotation: 0,
  irisWidth: 58,
  irisHeight: 58,
  pupilWidth: 32,
  pupilHeight: 32,
  pupilX: 0,
  pupilY: 0,
  pupilRotation: 0,
  pupilShape: 'circle',
  pupilCustomShapeId: null,
  upperEyelid: 0,
  lowerEyelid: 0,
  upperEyelidTilt: 0,
  lowerEyelidTilt: 0,
  upperEyelidCurvature: 0,
  lowerEyelidCurvature: 0,
  highlightX: -18,
  highlightY: -18,
  highlightSize: 22
}

export const DEFAULT_EYE_COLORS: EyeColors = {
  sclera: '#f4faff',
  iris: '#4fa8ff',
  pupil: '#0a1220',
  highlight: '#ffffff',
  shadow: '#000010',
  glow: '#5b8cff',
  border: '#ffffff',
  shadowIntensity: 30,
  glowIntensity: 25,
  borderOpacity: 5,
  borderWidth: 3,
  pupilOpacity: 100
}

export const EYE_COLOR_RANGES = {
  shadowIntensity: [0, 100] as [number, number],
  glowIntensity: [0, 100] as [number, number],
  borderOpacity: [0, 100] as [number, number],
  borderWidth: [0, 12] as [number, number],
  pupilOpacity: [0, 100] as [number, number]
}

export function defaultVisualReference(): VisualReferenceStyle {
  return {
    params: { ...DEFAULT_EYE_PARAMS },
    colors: { ...DEFAULT_EYE_COLORS },
    paramsLeftOverride: null,
    paramsRightOverride: null,
    colorsLeftOverride: null,
    colorsRightOverride: null
  }
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  shape: 'circle',
  width: 240,
  height: 240,
  cornerRadius: 24,
  backgroundColor: '#000000',
  showBezel: true,
  fps: 30
}

export const DISPLAY_RANGES = {
  width: [60, 480] as [number, number],
  height: [60, 480] as [number, number],
  cornerRadius: [0, 160] as [number, number],
  fps: [1, 120] as [number, number]
}

/** Clamps to the supported FPS range — used both by the live preview loop and the C++
 * export so a malformed/hand-edited project file can never push an out-of-range value into
 * either place, even though the Display panel's slider already can't produce one itself. */
export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return DEFAULT_DISPLAY.fps
  return Math.min(DISPLAY_RANGES.fps[1], Math.max(DISPLAY_RANGES.fps[0], Math.round(fps)))
}

export const DEFAULT_PERSONALITY: Personality = {
  blinkFrequency: 50,
  curiosity: 50,
  energy: 50,
  confidence: 50,
  sleepiness: 10,
  movementSpeed: 50,
  randomEyeDrift: 30,
  microMovement: 25,
  idleDelay: 40
}

export const DEFAULT_TIMING: GlobalTiming = {
  animationSpeed: 100,
  blinkSpeed: 100,
  breathingAmount: 20
}

// pupilShape/pupilCustomShapeId are deliberately excluded — they're not numeric-range fields
// (see EyeParams.pupilShape's doc comment). The shape picker UI and jsonImport.ts's
// isEyeParams() both branch around these two fields explicitly instead of reading a range.
export const EYE_PARAM_RANGES: Record<Exclude<keyof EyeParams, 'pupilShape' | 'pupilCustomShapeId'>, [number, number]> = {
  width: [20, 130],
  height: [20, 130],
  radius: [0, 130],
  distance: [0, 160],
  rotation: [-45, 45],
  irisWidth: [10, 100],
  irisHeight: [10, 100],
  pupilWidth: [5, 100],
  pupilHeight: [5, 100],
  // Percent of half the eye's own width/height — already scales with eye size. +-100 lets
  // the pupil's center reach all the way to the eye's edge (previously capped at 40%, which
  // kept the pupil confined to the middle of the eye and unable to reach the corners).
  pupilX: [-100, 100],
  pupilY: [-100, 100],
  pupilRotation: [0, 360],
  upperEyelid: [0, 100],
  lowerEyelid: [0, 100],
  upperEyelidTilt: [-45, 45],
  lowerEyelidTilt: [-45, 45],
  upperEyelidCurvature: [-100, 100],
  lowerEyelidCurvature: [-100, 100],
  highlightX: [-40, 40],
  highlightY: [-40, 40],
  highlightSize: [0, 60]
}

// ---- Per-eye (Eye Target) helpers ------------------------------------------
//
// The live/base pose and each Expression store one shared params/colors pair plus optional
// left/right *override* pairs. A `null` override means that eye simply follows the shared
// value — these helpers resolve "what should this eye actually look like" without every
// caller (renderer, panels, export) needing to know about the null-means-shared convention.

export function leftEyeParams(project: Project): EyeParams {
  return project.eyeLeftOverride ?? project.eyeBase
}
export function rightEyeParams(project: Project): EyeParams {
  return project.eyeRightOverride ?? project.eyeBase
}
export function leftEyeColors(project: Project): EyeColors {
  return project.colorsLeftOverride ?? project.colors
}
export function rightEyeColors(project: Project): EyeColors {
  return project.colorsRightOverride ?? project.colors
}

/** The params/colors the Controls/Colors panels should currently display and edit, given
 * the selected Eye Target. */
export function effectiveEyeParams(project: Project, target: EyeSide): EyeParams {
  if (target === 'left') return leftEyeParams(project)
  if (target === 'right') return rightEyeParams(project)
  return project.eyeBase
}
export function effectiveEyeColors(project: Project, target: EyeSide): EyeColors {
  if (target === 'left') return leftEyeColors(project)
  if (target === 'right') return rightEyeColors(project)
  return project.colors
}

export function leftVisualReferenceParams(vr: VisualReferenceStyle): EyeParams {
  return vr.paramsLeftOverride ?? vr.params
}
export function rightVisualReferenceParams(vr: VisualReferenceStyle): EyeParams {
  return vr.paramsRightOverride ?? vr.params
}
export function leftVisualReferenceColors(vr: VisualReferenceStyle): EyeColors {
  return vr.colorsLeftOverride ?? vr.colors
}
export function rightVisualReferenceColors(vr: VisualReferenceStyle): EyeColors {
  return vr.colorsRightOverride ?? vr.colors
}

/** The params/colors the Controls/Colors panels should display and edit for the Visual
 * Reference itself, given the selected Eye Target — same resolution rule as
 * effectiveEyeParams/effectiveEyeColors above. */
export function effectiveVisualReferenceParams(vr: VisualReferenceStyle, target: EyeSide): EyeParams {
  if (target === 'left') return leftVisualReferenceParams(vr)
  if (target === 'right') return rightVisualReferenceParams(vr)
  return vr.params
}
export function effectiveVisualReferenceColors(vr: VisualReferenceStyle, target: EyeSide): EyeColors {
  if (target === 'left') return leftVisualReferenceColors(vr)
  if (target === 'right') return rightVisualReferenceColors(vr)
  return vr.colors
}

export function expressionLeftParams(e: Expression): EyeParams {
  return e.leftParams ?? e.params
}
export function expressionRightParams(e: Expression): EyeParams {
  return e.rightParams ?? e.params
}
export function expressionLeftColors(e: Expression): EyeColors {
  return e.leftColors ?? e.colors
}
export function expressionRightColors(e: Expression): EyeColors {
  return e.rightColors ?? e.colors
}

/** True when this expression's two eyes would actually render differently — used to decide
 * whether the C++ export needs separate left/right constants or can share one. */
export function expressionShapeDiverges(e: Expression): boolean {
  return JSON.stringify(expressionLeftParams(e)) !== JSON.stringify(expressionRightParams(e))
}
export function expressionColorsDiverge(e: Expression): boolean {
  return JSON.stringify(expressionLeftColors(e)) !== JSON.stringify(expressionRightColors(e))
}
