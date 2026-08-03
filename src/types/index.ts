import type { UiDesignProject } from './uiDesign'

export interface EyeParams {
  width: number
  height: number
  radius: number
  distance: number
  rotation: number
  /** -100..100px: moves this ENTIRE eye (silhouette, iris, pupil, eyelids, highlight, glow,
   * border — everything drawEye() draws) around the display, on top of the symmetric ±distance/2
   * placement every eye pair already has — unlike eyeShapeOffsetX/Y (which only nudges the
   * traced silhouette within its own box, leaving iris/pupil/eyelids centered), this moves the
   * whole eye as one unit. Sign-mirrored for the right eye exactly like pupilX/highlightX/
   * eyeShapeOffsetX (see faceRenderer.ts's own `sign` convention), so a positive value reads as
   * the same relative direction on both eyes rather than the same absolute screen direction. */
  eyePosX: number
  /** -100..100px, vertical twin of eyePosX — never sign-mirrored (vertical position is already
   * symmetric between the two eyes, same as pupilY/highlightY/eyeShapeOffsetY). */
  eyePosY: number
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
  /** Layers-panel visibility/lock for the Pupil layer — see the comment on eyeShapeVisible
   * below. visible=false skips the pupil draw call entirely without discarding pupil settings. */
  pupilVisible: boolean
  pupilLocked: boolean
  /** Which silhouette the eye's own outer boundary renders as — replaces the plain rounded-rect
   * (via width/height/radius) as the clip every other draw call (sclera/iris/pupil/eyelids/
   * glow/border) relies on. 'default' is today's existing rounded-rect/ellipse path (Circle,
   * Oval, and Rounded Rectangle in the shape picker are all just width/height/radius presets on
   * top of 'default', exactly like pupilShape's circle/oval convenience). Every other value
   * draws a shared normalized polygon from src/renderer/eyeShapes.ts. Not numerically
   * interpolatable — see lerpParams()'s explicit step-at-midpoint handling in interpolate.ts. */
  eyeShape: EyeShapeId
  /** Id into Project.customEyeShapes — only meaningful when eyeShape === 'custom'. */
  eyeCustomShapeId: string | null
  /** 50-200%: scales the traced eye-shape polygon's own silhouette independent of width/height
   * (which control the eye's overall footprint that iris/pupil/eyelid math keys off) — lets the
   * silhouette shrink/grow inside that same footprint. No effect when eyeShape === 'default'. */
  eyeShapeScale: number
  /** -30..30px: nudges the eye's own silhouette within its box without moving iris/pupil/
   * eyelids, which stay centered on the box — applies to every eyeShape, including 'default'
   * (the plain rounded-rect/ellipse boundary), not just the traced polygon shapes. */
  eyeShapeOffsetX: number
  eyeShapeOffsetY: number
  /** Mirrors the traced polygon horizontally/vertically before rotation. No effect when
   * eyeShape === 'default'. */
  eyeShapeFlipH: boolean
  eyeShapeFlipV: boolean
  /** Layers-panel visibility/lock — see the Layers panel comment near StickerInstance below.
   * visible=false renders as if eyeShape were 'default' without discarding the actual eyeShape/
   * eyeCustomShapeId assignment (a real, exported behavior, not studio-only). locked=true is
   * authoring-time only (disables the Eye Shape controls in ControlsPanel); never exported. */
  eyeShapeVisible: boolean
  eyeShapeLocked: boolean
  upperEyelid: number
  lowerEyelid: number
  /** Tilts each lid's covering edge independently, -45..45°. */
  upperEyelidTilt: number
  lowerEyelidTilt: number
  /** How pronounced each lid's soft curved edge is: 0 (flat/neutral), -100 (curved inward) to 100 (curved outward). */
  upperEyelidCurvature: number
  lowerEyelidCurvature: number
  /** 0-100 each: independently blends each END's taper from today's pinched quartic bump (0)
   * toward a wider, flatter-topped profile (100) that reads as a continuous rounded oval/egg
   * arc instead of a single narrow peak — see eyelidCurvePoints() in drawEye.ts for the exact
   * formula. "Left"/"Right" mean the rendered left/right side of THIS eye's own eyelid (not
   * mirrored per-eye — same convention *Skew already uses below), so a left-eye and right-eye
   * both read "Left End Roundness" as their own screen-left end. Splitting one shared knob into
   * two independent ones is safe at every value: the taper's plateau-to-quartic seam has zero
   * slope regardless of plateau width (see eyelidCurvePoints()'s comment), so two differently-
   * sized plateaus glued at u=0 never introduces a corner. Backward compatible: old saved
   * projects/animation JSON only had one `upperEyelidRoundness`/`lowerEyelidRoundness` field —
   * normalizeEyeParams()/normalizeImportedParams() copy that value into both new fields on load. */
  upperEyelidLeftRoundness: number
  upperEyelidRightRoundness: number
  lowerEyelidLeftRoundness: number
  lowerEyelidRightRoundness: number
  /** 0-100: compresses the taper into a narrower central portion (100 = today's full-width
   * taper, lower = more pinched) — the inverse-direction complement to roundness, so together
   * they cover the full range from "very narrow bump" to "very wide/flat" while always staying
   * pinned to exactly zero at the eye's own flat-side edge (no new kinks possible). */
  upperEyelidStretchX: number
  lowerEyelidStretchX: number
  /** 0-200%: multiplies the curve's vertical amplitude on top of curvature — a pure scale on
   * offset, safe at any value since it never touches the taper's horizontal (x) domain. */
  upperEyelidStretchY: number
  lowerEyelidStretchY: number
  /** -100 to 100: shifts the curve's center point (peak or valley — see centerDepth) left/right,
   * off this eye's own u=0 midpoint. UI label "Center Position X" — reused directly by
   * eyelidTaper()'s `centerX`, see src/renderer/eyelidCurve.ts for the full curve model this
   * (and roundness/stretchX/centerDepth/smoothness/tension below) now feeds. */
  upperEyelidSkew: number
  lowerEyelidSkew: number
  /** 0-100: how deep the curve's center point (see skew/"Center Position X" above) sits below
   * the two edges' own roundness height — 0 = the center matches the (possibly asymmetric) edge
   * heights, reproducing a flat-topped dome; 100 = the center drops all the way to the curve's
   * own baseline, a full valley. Default 0, so an untouched project's curve keeps behaving like
   * the plain roundness-only dome it always has. See eyelidTaper()'s `centerDepth`. */
  upperEyelidCenterDepth: number
  lowerEyelidCenterDepth: number
  /** -100..100: nudges the WHOLE curve (not just its taper shape) up/down, independent of
   * `upperEyelid`/`lowerEyelid` coverage — applied as a flat additive offset in drawEye.ts/
   * eyesFillEyelid(), scaled by a fraction of the eye's own height. UI label "Center Position
   * Y". Default 0 (no shift). */
  upperEyelidCenterY: number
  lowerEyelidCenterY: number
  /** 0-100: blends eyelidTaper()'s transition ease between a cubic and quintic S-curve — purely
   * a "how gradual does the curve leave its flat shoulder" knob, safe at any value (see
   * eyelidCurve.ts's own doc comment for why this can never introduce a kink). UI label
   * "Smoothness". */
  upperEyelidSmoothness: number
  lowerEyelidSmoothness: number
  /** 0-100: biases the transition to linger near the edge height before rushing toward the
   * center height (see eyelidTaper()'s `tension`). UI label "Tension". */
  upperEyelidTension: number
  lowerEyelidTension: number
  /** Layers-panel visibility/lock for the Upper/Lower Eyelid layers — see the comment on
   * eyeShapeVisible above. visible=false renders as if this lid's coverage were 0 without
   * discarding the actual authored eyelid settings (a real, exported behavior). */
  upperEyelidVisible: boolean
  lowerEyelidVisible: boolean
  upperEyelidLocked: boolean
  lowerEyelidLocked: boolean
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

/** Built-in eye-outline silhouettes plus 'custom' (an imported SVG shape, referenced by
 * EyeParams.eyeCustomShapeId). 'default' is today's existing rounded-rect/ellipse boundary —
 * Circle, Oval, and Rounded Rectangle in the shape picker are all 'default' with preset
 * width/height/radius values, exactly like pupilShape's circle/oval convenience (nothing new
 * needed for those 3 beyond the picker UI). Every other value draws a shared normalized polygon
 * from src/renderer/eyeShapes.ts — heart/star/diamond are the exact same point tables
 * pupilShapes.ts already defines, reused as-is. */
export type EyeShapeId =
  | 'default'
  | 'heart'
  | 'star'
  | 'diamond'
  | 'hexagon'
  | 'cloud'
  | 'teardrop'
  | 'leaf'
  | 'bean'
  | 'crescent'
  | 'catEye'
  | 'animeEye'
  | 'robotEye'
  | 'happyArc'
  | 'custom'

/** A user-imported eye shape, normalized to a [-1,1]-centered bounding box — same space and
 * purpose as CustomPupilShape above, one level up (replaces the eye's own outer silhouette
 * instead of just the pupil fill). `svgSource` preserves the original uploaded SVG text verbatim
 * alongside the derived polygon — the polygon actually used for rendering/export is still a
 * 48-point sample of the SVG's first closed path (same documented limitation CustomPupilShape
 * already has), but the original vector source stays available rather than being discarded, the
 * practical reading of "preserve vector quality" on a renderer with no vector rasterizer. */
export interface CustomEyeShape {
  id: string
  name: string
  points: [number, number][]
  svgSource: string
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
  /** 0-100: the eye shape's own opacity — no existing sclera opacity field to reuse (unlike Fill/
   * Stroke Color, which the Eye Shape panel surfaces from sclera/border directly). Pre-blended
   * against the background at export time, same pattern as pupilOpacity/borderOpacity. */
  eyeShapeOpacity: number
  /** Layers-panel visibility/lock for the Effects layer (glow+shadow together) — see the comment
   * on EyeParams.eyeShapeVisible. visible=false renders as if glowIntensity/shadowIntensity were
   * 0 without discarding their actual values (composes with the existing "0 = off" convention
   * both already have in drawEye.ts/cppExport.ts). locked=true disables the Glow/Shadow controls
   * in ColorPanel; never exported. */
  effectsVisible: boolean
  effectsLocked: boolean
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

/** Which EyeParams fields each parametric timeline track "owns" when merging multiple tracks
 * into one final pose (see sampleAnimationEye in engine/interpolate.ts). A field not listed in
 * PUPIL_TRACK_FIELDS or EYELID_TRACK_FIELDS is a "shape" field, owned by the pose track and,
 * when present, by the leftEye/rightEye tracks. Kept as flat literal lists (not derived from
 * EYE_PARAM_RANGES, which omits pupilShape/pupilCustomShapeId) so this is the one place that
 * needs updating if EyeParams ever gains a field. */
export const PUPIL_TRACK_FIELDS: (keyof EyeParams)[] = [
  'pupilWidth',
  'pupilHeight',
  'pupilX',
  'pupilY',
  'pupilRotation',
  'pupilShape',
  'pupilCustomShapeId',
  'pupilVisible',
  'pupilLocked'
]
export const EYELID_TRACK_FIELDS: (keyof EyeParams)[] = [
  'upperEyelid',
  'lowerEyelid',
  'upperEyelidTilt',
  'lowerEyelidTilt',
  'upperEyelidCurvature',
  'lowerEyelidCurvature',
  'upperEyelidLeftRoundness',
  'upperEyelidRightRoundness',
  'lowerEyelidLeftRoundness',
  'lowerEyelidRightRoundness',
  'upperEyelidStretchX',
  'lowerEyelidStretchX',
  'upperEyelidStretchY',
  'lowerEyelidStretchY',
  'upperEyelidSkew',
  'lowerEyelidSkew',
  'upperEyelidCenterDepth',
  'lowerEyelidCenterDepth',
  'upperEyelidCenterY',
  'lowerEyelidCenterY',
  'upperEyelidSmoothness',
  'lowerEyelidSmoothness',
  'upperEyelidTension',
  'lowerEyelidTension',
  'upperEyelidVisible',
  'lowerEyelidVisible',
  'upperEyelidLocked',
  'lowerEyelidLocked'
]
export const SHAPE_TRACK_FIELDS: (keyof EyeParams)[] = [
  'width',
  'height',
  'radius',
  'distance',
  'rotation',
  'eyePosX',
  'eyePosY',
  'irisWidth',
  'irisHeight',
  'highlightX',
  'highlightY',
  'highlightSize',
  'eyeShape',
  'eyeCustomShapeId',
  'eyeShapeScale',
  'eyeShapeOffsetX',
  'eyeShapeOffsetY',
  'eyeShapeFlipH',
  'eyeShapeFlipV',
  'eyeShapeVisible',
  'eyeShapeLocked'
]

export interface Keyframe {
  id: string
  /** Absolute ms from the owning track's t=0 (the animation's own start). Replaces the old
   * "duration to next keyframe" model — see keyframeStartTimes()/normalizeProject() migration
   * notes for why: with independent per-track timing (pose/leftEye/rightEye/pupils/eyelids),
   * duration-to-next made every cross-track operation (multi-select drag, split-all-at-
   * playhead, snap-to-another-track's-edge) require cascading recomputation of every
   * downstream keyframe. Absolute time makes each of those a direct, independent write. */
  timeMs: number
  easing: EasingType
  customBezier?: [number, number, number, number]
  params: EyeParams
  /** Per-eye divergence for THIS keyframe, `null` meaning "no divergence, follows `params`" —
   * the exact same pattern Expression.leftParams/rightParams already uses (see
   * expressionLeftParams()/expressionRightParams() below). This is what lets the Eye Target
   * selector (Both/Left/Right) act as a pure editing lens on one keyframe — switching it never
   * creates a new keyframe or track; it just changes which of params/leftParams/rightParams the
   * Controls panel reads from and writes to (see keyframeParamsFor()/ControlsPanel.tsx). Only
   * meaningful on pose/pupils/eyelids-track keyframes; a leftEye/rightEye-track keyframe is
   * already tied to one side by which track it's on, so these stay null there and the track's
   * own SHAPE_TRACK_FIELDS-scoped divergence (a separate, explicit mechanism the user still
   * reaches via "+ Track") takes over instead. */
  leftParams: EyeParams | null
  rightParams: EyeParams | null
  /** Names of `params` fields (from STYLE_EYE_PARAM_FIELDS) that are pinned as intentional
   * customizations for this keyframe — e.g. a blink's eyelid values, a look's pupil offset.
   * Fields NOT listed here track the project's Visual Reference and get overwritten whenever
   * it's applied. See STYLE_EYE_PARAM_FIELDS and computeStyleOverrides below. */
  styleOverrides: string[]
  /** Set only on pose-track keyframes created by dragging a saved Expression onto the
   * Expression track. Identifies which Expression this clip represents; `linked: true` means
   * it's still considered a live reference to that Expression (Phase 2 provides a "refresh
   * from source" action) rather than a fully independent, detached keyframe. Editing the
   * clip's timing never touches the source Expression either way. */
  sourceExpressionId?: string
  linked?: boolean
}

export type TrackKind = 'pose' | 'leftEye' | 'rightEye' | 'pupils' | 'eyelids' | 'sticker' | 'marker' | 'comboClip'

/** UI/organizational metadata for one timeline lane. The 5 fixed keyframe-track kinds (pose/
 * leftEye/rightEye/pupils/eyelids) and the single 'marker' track always exist, one each, for
 * every Animation; 'sticker' tracks are user-created (Add Track), any number, purely to group
 * StickerInstances visually — see StickerInstance.trackId. This type carries no actual
 * keyframe/clip data itself (that still lives in Animation.keyframes/leftEyeKeyframes/etc. and
 * StickerInstance) — it's deliberately just display order, name, and mute/lock state.
 * 'comboClip' is not a real Animation track kind at all — it exists only so the Timeline can
 * build one synthetic, non-persisted Track for whichever AnimationCombo is selected (a combo
 * has its own flat `clips` array, no Track[]/lane concept), reusing the same accent-color/
 * ClipView rendering path as every other track kind. */
export interface Track {
  id: string
  kind: TrackKind
  name: string
  order: number
  /** "Mute" — excluded from the sample/merge (keyframe tracks) or from rendering (sticker
   * tracks) while false, without deleting any data. */
  visible: boolean
  /** Blocks drag/edit only — a locked track's contents still render/animate normally. */
  locked: boolean
  /** Only meaningful for kind:'sticker' — which compositing layer its instances draw on
   * (mirrors StickerInstance.layer; every instance assigned to this track should share it). */
  stickerLayer?: StickerLayer
}

/** A studio-only timeline annotation — a labeled point in time, purely for authoring/snapping
 * (e.g. marking "beat 1", "loop point"). Never exported to C++ — see cppExport.ts's comment
 * at the animation-export call site. */
export interface Marker {
  id: string
  timeMs: number
  label: string
  color: string
}

/** The 5 fixed keyframe-track kinds plus 'marker' — one of each always exists on every
 * Animation (see createDefaultTracks). 'sticker' tracks are the only user-created kind. */
export const FIXED_TRACK_KINDS: { kind: TrackKind; name: string }[] = [
  { kind: 'pose', name: 'Expression' },
  { kind: 'leftEye', name: 'Left Eye' },
  { kind: 'rightEye', name: 'Right Eye' },
  { kind: 'pupils', name: 'Pupils' },
  { kind: 'eyelids', name: 'Eyelids' },
  { kind: 'marker', name: 'Markers' }
]

/** Builds the essential default tracks for a brand-new Animation: just the mandatory
 * Expression (pose) track plus one Sticker track to drop stickers on immediately — Left Eye/
 * Right Eye/Pupils/Eyelids/Markers stay out of the way until the user actually wants one (via
 * the Timeline's "+ Track" control, or "+ Diverge from Expression" once added), so a fresh
 * animation's timeline isn't cluttered with five empty rows nobody asked for. Takes an id
 * factory rather than importing nanoid directly here, keeping this file dependency-free like
 * the rest of types/index.ts. */
export function createDefaultTracks(idFactory: () => string): Track[] {
  return [
    { id: idFactory(), kind: 'pose', name: 'Expression', order: 0, visible: true, locked: false },
    { id: idFactory(), kind: 'sticker', name: 'Stickers', order: 1, visible: true, locked: false, stickerLayer: 'front' }
  ]
}

/** Builds one additional track of `kind` — used by the Timeline's "+ Track" control (see
 * addTrack() in state/store.ts) when the user explicitly wants a Left Eye/Right Eye/Pupils/
 * Eyelids/Markers row, or another Sticker track. `order` is the caller's responsibility (append
 * to the end of the current track list). */
export function createTrack(idFactory: () => string, kind: TrackKind, order: number, name?: string, stickerLayer?: StickerLayer): Track {
  const fixed = FIXED_TRACK_KINDS.find((f) => f.kind === kind)
  return {
    id: idFactory(),
    kind,
    name: name?.trim() || fixed?.name || 'Track',
    order,
    visible: true,
    locked: false,
    stickerLayer: kind === 'sticker' ? (stickerLayer ?? 'front') : undefined
  }
}

export type SelectionItemKind = 'keyframe' | 'sticker' | 'marker' | 'comboClip'

/** One uniformly-shaped selectable timeline item, letting the Timeline's selection/clipboard/
 * drag code treat keyframes-on-any-track, sticker clips, markers, and Combination clips
 * identically instead of needing a parallel selection model per kind. `trackId` is one of the
 * 5 fixed keyframe-track kinds ('pose'/'leftEye'/'rightEye'/'pupils'/'eyelids'), a sticker
 * Track.id, 'marker', or (for kind 'comboClip') the owning AnimationCombo's own id — scoping a
 * combo-clip selection to whichever combo is currently being edited, mirroring how a sticker's
 * trackId scopes it to one sticker track. */
export interface SelectionItem {
  kind: SelectionItemKind
  trackId: string
  id: string
}
export type Selection = SelectionItem[]

export interface Animation {
  id: string
  name: string
  loop: boolean
  /** Total timeline length in ms — drives the ruler, the loop-back segment, and lets every
   * track (which may have different keyframe counts/gaps) agree on a shared end/loop point. */
  durationMs: number
  /** The pose / "Expression" track — every project's only keyframe track before this feature,
   * and still the required fallback/baseline every other keyframe track's fields merge onto
   * (see sampleAnimationEye). Name/role unchanged so most existing call sites keep compiling. */
  keyframes: Keyframe[]
  /** Independently-timed parametric tracks. Empty array = this track contributes nothing and
   * the corresponding fields fully inherit the pose track's values for their whole duration —
   * this is what makes old projects (all four arrays backfilled to []) play back identically. */
  leftEyeKeyframes: Keyframe[]
  rightEyeKeyframes: Keyframe[]
  pupilKeyframes: Keyframe[]
  eyelidKeyframes: Keyframe[]
  /** Display order/name/visibility/lock for every lane shown on this animation's timeline —
   * the 5 fixed keyframe tracks + 'marker', plus one entry per user-created sticker track. */
  tracks: Track[]
  /** Stickers visible only while this animation is playing — see StickerInstance below. */
  stickers: StickerInstance[]
  /** Studio-only annotations — see Marker above. */
  markers: Marker[]
}

/** A single reference-only clip inside an animation combination. It points at an existing
 * animation by id and stores only playback settings, so the combo can be edited and exported
 * without copying frame data. */
export interface AnimationComboClip {
  id: string
  animationId: string
  startTimeMs: number
  loopCount: number
  playbackSpeed: number
  transitionMs: number
  endDelayMs: number
}

/** A reusable animation sequence made from references to existing animations. */
export interface AnimationCombo {
  id: string
  name: string
  loop: boolean
  clips: AnimationComboClip[]
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
// Kibo Studio separates project data into two kinds:
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
  'eyeShape',
  'eyeCustomShapeId',
  'eyeShapeScale',
  'eyeShapeFlipH',
  'eyeShapeFlipV',
  'upperEyelidCurvature',
  'lowerEyelidCurvature',
  'upperEyelidLeftRoundness',
  'upperEyelidRightRoundness',
  'lowerEyelidLeftRoundness',
  'lowerEyelidRightRoundness',
  'upperEyelidStretchX',
  'lowerEyelidStretchX',
  'upperEyelidStretchY',
  'lowerEyelidStretchY',
  'upperEyelidSkew',
  'lowerEyelidSkew',
  'upperEyelidCenterDepth',
  'lowerEyelidCenterDepth',
  'upperEyelidCenterY',
  'lowerEyelidCenterY',
  'upperEyelidSmoothness',
  'lowerEyelidSmoothness',
  'upperEyelidTension',
  'lowerEyelidTension',
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
  'pupilOpacity',
  'eyeShapeOpacity'
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
 * Mostly-numeric fields, plus pupilShape/pupilCustomShapeId/eyeShape/eyeCustomShapeId
 * (string/string|null) and eyeShapeFlipH/eyeShapeFlipV (boolean). */
export function applyStyleToParams(target: EyeParams, vr: EyeParams, overrides: string[]): void {
  const t = target as unknown as Record<string, number | string | boolean | null>
  const v = vr as unknown as Record<string, number | string | boolean | null>
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
export type StickerAssetKind = 'procedural' | 'raster' | 'svg'
/** How a placed SVG sticker instance's own hardcoded (non-currentColor) fill/stroke colors are
 * treated — see StickerInstance.svgColorMode. currentColor elements always follow the
 * instance's tint regardless of this mode (there's no "original" color to preserve for them). */
export type StickerSvgColorMode = 'preserveOriginal' | 'overrideWithTint'

/** Structural stats parsed from an SVG sticker source at import time — surfaced in the
 * Sticker Manager's debug panel and used to decide how the recolor engine should treat the
 * asset (e.g. whether currentColor needs resolving). Purely informational beyond that; never
 * used to gate whether recoloring is attempted. */
export interface StickerSvgMeta {
  elementCount: number
  fillCount: number
  strokeCount: number
  usesCurrentColor: boolean
  hasGradients: boolean
  hasClipOrMask: boolean
  /** True if the source couldn't be parsed as an SVG element tree at all (e.g. malformed
   * markup) — the asset still gets a rasterized preview, but recoloring falls back to the old
   * flat-tint overlay instead of selective vector recoloring. */
  rasterizedFallback: boolean
}

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
  /** Set when kind === 'svg' — the original uploaded SVG markup, verbatim (this is what
   * preserves hierarchy/transforms/viewBox: no separate representation is derived for those,
   * the source text already has them). Recolored live per placed instance — see
   * StickerInstance.svgColorMode/resolvedSvg — never mutated on the asset itself, since color
   * is a per-instance concern (multiple placements of one SVG can each have their own color). */
  svgSource?: string
  /** Set when kind === 'svg' — parsed once at import time, informational (debug panel) plus
   * used to decide currentColor handling. */
  svgMeta?: StickerSvgMeta
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
  /** % multipliers applied on top of width/height, default 100 each — a separate control from
   * width/height per the spec's explicit "width, height, scale" wording. Independent X/Y so a
   * sticker can be stretched non-uniformly; set both the same for a uniform scale. */
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  /** null = the asset's native colors/frames, unmodified. For a kind:'svg' asset, this also
   * doubles as the override/currentColor color — see svgColorMode below. */
  tint: string | null
  /** Only meaningful when the referenced asset is kind:'svg'. 'preserveOriginal' (default)
   * keeps every hardcoded fill/stroke color as authored; 'overrideWithTint' rewrites every
   * hardcoded fill/stroke to `tint` too. Either way, any currentColor fill/stroke always
   * resolves to `tint` (there's no original color to preserve for those) — see svgRecolor.ts. */
  svgColorMode: StickerSvgColorMode
  /** Studio-computed cache: `tint`/`svgColorMode` applied to the asset's svgSource, rasterized
   * — recomputed (in the renderer process, where a DOM exists) whenever assetId/tint/
   * svgColorMode change, then persisted here so both the live canvas (fast path — draw from
   * this instead of re-rasterizing every animation frame) and the C++ export (which runs with
   * no DOM at all — see StickerAsset.frameRgba's own comment for why) can use it with zero
   * further parsing. null until first resolved (e.g. immediately after adding an svg sticker,
   * for one frame) or if the asset isn't kind:'svg'. Independent per instance — this is what
   * lets two placements of the same SVG asset carry different colors. */
  resolvedSvg: { dataUrl: string; rgba: { width: number; height: number; data: number[] } } | null
  flipH: boolean
  flipV: boolean
  visible: boolean
  /** Blocks drag/edit only — a locked sticker still renders/animates normally. */
  locked: boolean
  anim: StickerAnimSettings
  /** Which Track (kind:'sticker') lane this instance visually groups under on the timeline.
   * Studio-UI bookkeeping only — effectiveStickers(), the renderer, and the C++ export never
   * read this; they merge/sort purely by layer+order exactly as before. A dangling reference
   * (no matching Track) is non-fatal — the Timeline falls back to an "Ungrouped" lane. */
  trackId: string
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
  animationCombos: AnimationCombo[]
  expressions: Expression[]
  /** The project's single shared default appearance — see VisualReferenceStyle below. */
  visualReference: VisualReferenceStyle
  /** Reusable library of imported custom pupil shapes — see CustomPupilShape above. */
  customPupilShapes: CustomPupilShape[]
  /** Reusable library of imported custom eye shapes — see CustomEyeShape above. */
  customEyeShapes: CustomEyeShape[]
  /** Reusable library of sticker assets (built-ins seeded once, plus custom imports) — see
   * StickerAsset above. */
  stickerAssets: StickerAsset[]
  /** Stickers always visible regardless of active expression/animation — see StickerInstance
   * and effectiveStickers() above. */
  stickers: StickerInstance[]
  /** UI Design Mode's data — a completely independent LVGL screen designer sharing this project
   * file. See types/uiDesign.ts. Structurally separate from every field above it: nothing in
   * the eye/expression/animation/sticker system reads or writes this. */
  uiDesign: UiDesignProject
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
  eyePosX: 0,
  eyePosY: 0,
  irisWidth: 58,
  irisHeight: 58,
  pupilWidth: 32,
  pupilHeight: 32,
  pupilX: 0,
  pupilY: 0,
  pupilRotation: 0,
  pupilShape: 'circle',
  pupilCustomShapeId: null,
  pupilVisible: true,
  pupilLocked: false,
  eyeShape: 'default',
  eyeCustomShapeId: null,
  eyeShapeScale: 100,
  eyeShapeOffsetX: 0,
  eyeShapeOffsetY: 0,
  eyeShapeFlipH: false,
  eyeShapeFlipV: false,
  eyeShapeVisible: true,
  eyeShapeLocked: false,
  upperEyelid: 0,
  lowerEyelid: 0,
  upperEyelidTilt: 0,
  lowerEyelidTilt: 0,
  upperEyelidCurvature: 0,
  lowerEyelidCurvature: 0,
  upperEyelidLeftRoundness: 0,
  upperEyelidRightRoundness: 0,
  lowerEyelidLeftRoundness: 0,
  lowerEyelidRightRoundness: 0,
  upperEyelidStretchX: 100,
  lowerEyelidStretchX: 100,
  upperEyelidStretchY: 100,
  lowerEyelidStretchY: 100,
  upperEyelidSkew: 0,
  lowerEyelidSkew: 0,
  upperEyelidCenterDepth: 0,
  lowerEyelidCenterDepth: 0,
  upperEyelidCenterY: 0,
  lowerEyelidCenterY: 0,
  upperEyelidSmoothness: 70,
  lowerEyelidSmoothness: 70,
  upperEyelidTension: 30,
  lowerEyelidTension: 30,
  upperEyelidVisible: true,
  lowerEyelidVisible: true,
  upperEyelidLocked: false,
  lowerEyelidLocked: false,
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
  pupilOpacity: 100,
  eyeShapeOpacity: 100,
  effectsVisible: true,
  effectsLocked: false
}

export const EYE_COLOR_RANGES = {
  shadowIntensity: [0, 100] as [number, number],
  glowIntensity: [0, 100] as [number, number],
  borderOpacity: [0, 100] as [number, number],
  borderWidth: [0, 12] as [number, number],
  pupilOpacity: [0, 100] as [number, number],
  eyeShapeOpacity: [0, 100] as [number, number]
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

// pupilShape/pupilCustomShapeId/eyeShape/eyeCustomShapeId are deliberately excluded — they're
// not numeric-range fields (see EyeParams.pupilShape's doc comment). The boolean flip/visible/
// locked fields are excluded for the same reason. The shape picker UI and jsonImport.ts's
// isEyeParams() both branch around these fields explicitly instead of reading a range.
export const EYE_PARAM_RANGES: Record<
  Exclude<
    keyof EyeParams,
    | 'pupilShape'
    | 'pupilCustomShapeId'
    | 'pupilVisible'
    | 'pupilLocked'
    | 'eyeShape'
    | 'eyeCustomShapeId'
    | 'eyeShapeFlipH'
    | 'eyeShapeFlipV'
    | 'eyeShapeVisible'
    | 'eyeShapeLocked'
    | 'upperEyelidVisible'
    | 'lowerEyelidVisible'
    | 'upperEyelidLocked'
    | 'lowerEyelidLocked'
  >,
  [number, number]
> = {
  width: [20, 130],
  height: [20, 130],
  radius: [0, 130],
  distance: [0, 160],
  rotation: [-45, 45],
  eyePosX: [-100, 100],
  eyePosY: [-100, 100],
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
  upperEyelidLeftRoundness: [0, 100],
  upperEyelidRightRoundness: [0, 100],
  lowerEyelidLeftRoundness: [0, 100],
  lowerEyelidRightRoundness: [0, 100],
  upperEyelidStretchX: [0, 100],
  lowerEyelidStretchX: [0, 100],
  upperEyelidStretchY: [0, 200],
  lowerEyelidStretchY: [0, 200],
  upperEyelidSkew: [-100, 100],
  lowerEyelidSkew: [-100, 100],
  upperEyelidCenterDepth: [0, 100],
  lowerEyelidCenterDepth: [0, 100],
  upperEyelidCenterY: [-100, 100],
  lowerEyelidCenterY: [-100, 100],
  upperEyelidSmoothness: [0, 100],
  lowerEyelidSmoothness: [0, 100],
  upperEyelidTension: [0, 100],
  lowerEyelidTension: [0, 100],
  highlightX: [-40, 40],
  highlightY: [-40, 40],
  highlightSize: [0, 60],
  eyeShapeScale: [50, 200],
  eyeShapeOffsetX: [-30, 30],
  eyeShapeOffsetY: [-30, 30]
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

// Fields that mean "this eye's own left/right end" rather than an absolute screen direction —
// mirrored below so a shared (non-diverged) pose reads as symmetric across the eye pair (tall
// outer corners on both eyes, both eyes' inner corners tapering toward the shared center) instead
// of both eyes leaning the same visual direction.
const EYELID_SIDED_ROUNDNESS_PAIRS: [keyof EyeParams, keyof EyeParams][] = [
  ['upperEyelidLeftRoundness', 'upperEyelidRightRoundness'],
  ['lowerEyelidLeftRoundness', 'lowerEyelidRightRoundness']
]
const EYELID_SIDED_SIGNED_FIELDS: (keyof EyeParams)[] = ['upperEyelidSkew', 'lowerEyelidSkew']
const EYELID_SIDED_FIELDS: (keyof EyeParams)[] = [
  ...EYELID_SIDED_ROUNDNESS_PAIRS.flat(),
  ...EYELID_SIDED_SIGNED_FIELDS
]

/** True when `a`/`b`'s eyelid-sided fields are identical — i.e. nobody has intentionally
 * diverged the two eyes' eyelid shape yet (the common "editing Both Eyes" case, where left/right
 * literally share one object, but also true for a left/right override that was cloned from the
 * base and never touched these specific fields). */
function eyelidSidedFieldsMatch(a: EyeParams, b: EyeParams): boolean {
  if (a === b) return true
  for (const f of EYELID_SIDED_FIELDS) if (a[f] !== b[f]) return false
  return true
}

/** Swaps each side's Left/Right End Roundness and negates Center Position X (skew) — the
 * transform that turns "this eye's own left/right" into "this eye's own right/left", i.e. what
 * the right eye of a symmetric pair actually needs so its OWN outer corner (not its own literal
 * left) reads as tall/rounded and its OWN inner corner (facing the other eye) reads as the
 * tapered one. */
function mirroredEyelid(params: EyeParams): EyeParams {
  const out = { ...params } as unknown as Record<string, number>
  for (const [a, b] of EYELID_SIDED_ROUNDNESS_PAIRS) {
    out[a] = params[b] as number
    out[b] = params[a] as number
  }
  for (const f of EYELID_SIDED_SIGNED_FIELDS) out[f] = -(params[f] as number)
  return out as unknown as EyeParams
}

/** The params actually used to RENDER (or export) the right eye's eyelids — identical to
 * `rightParams` unless its eyelid-sided fields exactly match `leftParams`'s (see
 * eyelidSidedFieldsMatch), in which case they're mirrored so the pair reads as symmetric. This is
 * a pure rendering/export-time transform: it never writes back into the project, and any real
 * per-eye customization of these specific fields — however small — opts a render out of
 * auto-mirroring entirely, respecting "Left Eye"/"Right Eye" being edited independently.
 * Deliberately generic over WHERE leftParams/rightParams came from (the shared base, a keyframe's
 * own leftParams/rightParams, an animation track sample, a Visual Reference pose, ...) — every
 * call site (studio renderer, ESP32 export baking) gets correct mirroring for free by routing
 * whatever it already resolved as "this pair's left/right params" through this one function
 * right before drawing/exporting, rather than needing pipeline-specific mirroring logic. */
export function renderRightEyeParams(leftParams: EyeParams, rightParams: EyeParams): EyeParams {
  if (!eyelidSidedFieldsMatch(leftParams, rightParams)) return rightParams
  return mirroredEyelid(rightParams)
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

/** Resolves a keyframe's effective EyeParams for a given side — the one place this "leftParams/
 * rightParams null-means-follow-params" resolution happens, mirroring
 * expressionLeftParams()/expressionRightParams() below exactly. Used by both the studio's own
 * sampling (sampleTrack() in interpolate.ts) and ControlsPanel's read/write of whichever
 * keyframe is currently selected. */
export function keyframeParamsFor(kf: Keyframe, side: EyeSide): EyeParams {
  if (side === 'left') return kf.leftParams ?? kf.params
  if (side === 'right') return kf.rightParams ?? kf.params
  return kf.params
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

// UI Design Mode's types live in their own file (this one is already 700+ lines) — re-exported
// here so existing `from '@/types'` imports keep working uniformly across the app.
export * from './uiDesign'
