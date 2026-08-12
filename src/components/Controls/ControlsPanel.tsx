import { useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import type { KeyframeTrackKind } from '@/state/store'
import {
  effectiveEyeParams,
  effectiveVisualReferenceParams,
  effectiveEyeColors,
  effectiveVisualReferenceColors,
  keyframeParamsFor,
  keyframeColors,
  EYE_PARAM_RANGES,
  EYE_COLOR_RANGES,
  DEFAULT_EYE_PARAMS
} from '@/types'
import type { EyeParams, EyeColors, EyeShapeId, PupilShapeId, Keyframe, EyeSide } from '@/types'
import { Slider } from '@/components/ui/Slider'
import { ColorField } from '@/components/ui/ColorField'
import { EyeTargetSelector } from '@/components/ui/EyeTargetSelector'
import { StyleFieldRow } from '@/components/ui/StyleFieldRow'
import { PanelTabs } from '@/components/ui/PanelTabs'
import { PupilShapePicker } from './PupilShapePicker'
import { EyeShapePicker } from './EyeShapePicker'

type ControlsTab = 'shape' | 'iris-pupil' | 'eyelids' | 'timing'

const CONTROLS_TABS: { value: ControlsTab; label: string }[] = [
  { value: 'shape', label: 'Shape' },
  { value: 'iris-pupil', label: 'Iris & Pupil' },
  { value: 'eyelids', label: 'Eyelids' },
  { value: 'timing', label: 'Timing' }
]

/** A selected Timeline keyframe can live on any of the 5 keyframe tracks, not just the pose
 * ("Expression") track — this is the one place that mapping is spelled out for ControlsPanel,
 * mirroring the identical local helper TimelineInspector.tsx already has for the same reason
 * (no shared export exists for it, matching that file's own precedent). */
function keyframeListForKind(anim: NonNullable<ReturnType<typeof getActiveAnimation>>, trackKind: KeyframeTrackKind): Keyframe[] {
  switch (trackKind) {
    case 'pose':
      return anim.keyframes
    case 'leftEye':
      return anim.leftEyeKeyframes
    case 'rightEye':
      return anim.rightEyeKeyframes
    case 'pupils':
      return anim.pupilKeyframes
    case 'eyelids':
      return anim.eyelidKeyframes
  }
}

/** Every field the new curvature curve model touches, per lid — used by the "Reset Curvature"
 * button (resets exactly these back to DEFAULT_EYE_PARAMS, leaving coverage/tilt untouched) and
 * by EYELID_STYLE_PRESETS below (each preset only needs to name the fields it actually wants to
 * change; anything it omits keeps whatever the pose already had, same "partial patch" convention
 * every other preset/bundle in this app already uses). */
const EYELID_CURVATURE_FIELDS: (keyof EyeParams)[] = [
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
  'lowerEyelidTension'
]

/** Bundles of curvature (+coverage/tilt where useful) field values that demonstrate the new
 * curve model can produce genuinely different cartoon eye styles from the same handful of
 * sliders — a starting point users can tweak further, not a locked/final look (same "flagged as
 * subject to visual iteration" caveat this project's other hand-tuned presets — pupil/eye shape
 * point tables, sticker presets — already carry). */
const EYELID_STYLE_PRESETS: { id: string; label: string; patch: Partial<EyeParams> }[] = [
  {
    // The soft, droopy rounded upper lid from the reference robot eyes — a big smooth downward
    // arc covering the top ~half of the eye, with the lower lid fully open.
    id: 'cute',
    label: 'Cute',
    patch: {
      upperEyelid: 50,
      upperEyelidCurvature: 45,
      upperEyelidLeftRoundness: 0,
      upperEyelidRightRoundness: 0,
      upperEyelidStretchX: 100,
      upperEyelidStretchY: 100,
      upperEyelidCenterDepth: 0,
      upperEyelidSkew: 0,
      upperEyelidCenterY: 0,
      upperEyelidTilt: 0,
      upperEyelidSmoothness: 90,
      upperEyelidTension: 25,
      lowerEyelid: 0
    }
  },
  {
    id: 'default',
    label: 'Default',
    patch: {
      upperEyelidCurvature: 0,
      lowerEyelidCurvature: 0,
      upperEyelidLeftRoundness: 0,
      upperEyelidRightRoundness: 0,
      lowerEyelidLeftRoundness: 0,
      lowerEyelidRightRoundness: 0,
      upperEyelidCenterDepth: 0,
      lowerEyelidCenterDepth: 0,
      upperEyelidSkew: 0,
      lowerEyelidSkew: 0
    }
  },
  {
    id: 'rounded',
    label: 'Rounded',
    patch: {
      upperEyelidCurvature: 55,
      lowerEyelidCurvature: 15,
      upperEyelidLeftRoundness: 100,
      upperEyelidRightRoundness: 100,
      lowerEyelidLeftRoundness: 100,
      lowerEyelidRightRoundness: 100,
      upperEyelidStretchX: 80,
      lowerEyelidStretchX: 85,
      upperEyelidCenterDepth: 60,
      lowerEyelidCenterDepth: 20,
      upperEyelidSkew: 0,
      lowerEyelidSkew: 0,
      upperEyelidSmoothness: 90,
      lowerEyelidSmoothness: 90
    }
  },
  {
    id: 'sleepy',
    label: 'Sleepy',
    patch: {
      upperEyelid: 55,
      lowerEyelid: 5,
      upperEyelidCurvature: 20,
      upperEyelidLeftRoundness: 60,
      upperEyelidRightRoundness: 60,
      upperEyelidStretchX: 90,
      upperEyelidCenterDepth: 10
    }
  },
  {
    id: 'happy',
    label: 'Happy',
    patch: {
      upperEyelid: 5,
      lowerEyelid: 35,
      lowerEyelidCurvature: -60,
      lowerEyelidLeftRoundness: 100,
      lowerEyelidRightRoundness: 100,
      lowerEyelidStretchX: 70,
      lowerEyelidCenterDepth: 0,
      lowerEyelidSmoothness: 90
    }
  },
  {
    id: 'angry',
    label: 'Angry',
    patch: {
      upperEyelid: 25,
      upperEyelidTilt: -25,
      lowerEyelidTilt: 25,
      upperEyelidCurvature: -40,
      lowerEyelidCurvature: -30,
      upperEyelidLeftRoundness: 30,
      upperEyelidRightRoundness: 30,
      upperEyelidStretchX: 60,
      upperEyelidCenterDepth: 40,
      upperEyelidTension: 70
    }
  },
  {
    id: 'curious',
    label: 'Curious',
    patch: {
      upperEyelidCurvature: 30,
      upperEyelidSkew: 60,
      upperEyelidLeftRoundness: 80,
      upperEyelidRightRoundness: 40,
      upperEyelidStretchX: 70,
      upperEyelidCenterDepth: 30
    }
  }
]

/** The two simplified eyelid panels. Each names the exact EyeParams/EyeColors fields its
 * controls read/write, so the Upper/Lower panels render from one shared JSX block with no
 * duplication. `as const` keeps the field names as literal keys (number-valued for the params,
 * so Sliders type-check without casts; string/number for Color/Opacity). */
const EYELID_PANELS = [
  {
    which: 'upper',
    title: 'Upper Eyelid',
    open: 'upperEyelid',
    curvature: 'upperEyelidCurvature',
    thickness: 'upperEyelidThickness',
    offsetY: 'upperEyelidCenterY',
    leftRound: 'upperEyelidLeftRoundness',
    rightRound: 'upperEyelidRightRoundness',
    tilt: 'upperEyelidTilt',
    stretchX: 'upperEyelidStretchX',
    stretchY: 'upperEyelidStretchY',
    centerDepth: 'upperEyelidCenterDepth',
    skew: 'upperEyelidSkew',
    smoothness: 'upperEyelidSmoothness',
    tension: 'upperEyelidTension',
    color: 'upperEyelidColor',
    opacity: 'upperEyelidOpacity'
  },
  {
    which: 'lower',
    title: 'Lower Eyelid',
    open: 'lowerEyelid',
    curvature: 'lowerEyelidCurvature',
    thickness: 'lowerEyelidThickness',
    offsetY: 'lowerEyelidCenterY',
    leftRound: 'lowerEyelidLeftRoundness',
    rightRound: 'lowerEyelidRightRoundness',
    tilt: 'lowerEyelidTilt',
    stretchX: 'lowerEyelidStretchX',
    stretchY: 'lowerEyelidStretchY',
    centerDepth: 'lowerEyelidCenterDepth',
    skew: 'lowerEyelidSkew',
    smoothness: 'lowerEyelidSmoothness',
    tension: 'lowerEyelidTension',
    color: 'lowerEyelidColor',
    opacity: 'lowerEyelidOpacity'
  }
] as const

const TRACK_KIND_LABEL: Record<KeyframeTrackKind, string> = {
  pose: 'shared, both eyes',
  leftEye: 'Left Eye',
  rightEye: 'Right Eye',
  pupils: 'Pupils, both eyes',
  eyelids: 'Eyelids, both eyes'
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-studio-text/70 tracking-widest uppercase border-b border-studio-border pb-1">
        {title}
      </h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}

function PreviewOnlyNote() {
  return (
    <p className="text-[11px] text-studio-muted italic">
      Preview only — this is behavioral, not shared style, so "Apply Visual Reference" never changes it on any
      expression or animation.
    </p>
  )
}

// editTarget defaults to 'live' (the normal base-pose/keyframe editing this panel has always
// done). Passing 'visual-reference' (used when this panel is reused inside the right panel's
// Visual Reference tab) instead points every field at project.visualReference.params via
// setVisualReferenceParam — the exact same sliders, just a different write target — so Visual
// Reference editing never needs its own duplicate copy of this UI.
export function ControlsPanel({ editTarget = 'live' }: { editTarget?: 'live' | 'visual-reference' }) {
  const project = useStore((s) => s.project)
  const eyeTarget = useStore((s) => s.eyeTarget)
  const timing = useStore((s) => s.project.timing)
  const setEyeParam = useStore((s) => s.setEyeParam)
  const setVisualReferenceParam = useStore((s) => s.setVisualReferenceParam)
  const setTiming = useStore((s) => s.setTiming)
  const checkpoint = useStore((s) => s.checkpoint)

  const mode = useStore((s) => s.mode)
  const timelineSelection = useStore((s) => s.timelineSelection)
  const selectedExpressionId = useStore((s) => s.selectedExpressionId)
  const updateTrackKeyframeParams = useStore((s) => s.updateTrackKeyframeParams)
  const updateTrackKeyframeEyeParams = useStore((s) => s.updateTrackKeyframeEyeParams)
  // Eyelid Color/Opacity live in EyeColors, so they route through the same color write paths the
  // Colors panel uses (base pose, selected pose keyframe, or Visual Reference).
  const setColorLive = useStore((s) => s.setColor)
  const setVisualReferenceColor = useStore((s) => s.setVisualReferenceColor)
  const updateTrackKeyframeColors = useStore((s) => s.updateTrackKeyframeColors)
  const setEyelidPreviewClose = useStore((s) => s.setEyelidPreviewClose)
  const anim = useStore(() => getActiveAnimation())

  // Which single keyframe (if any) the Timeline currently has selected, and which of the 5
  // tracks it lives on — a leftEye/rightEye/pupils/eyelids selection used to be silently
  // invisible here (this panel only ever looked in the pose track's keyframes), so editing
  // while one of those was selected actually edited the live base pose instead, with no
  // indication anything was wrong. updateTrackKeyframeParams is the track-aware write path
  // every field below now goes through (via setParam) instead of the pose-only legacy action.
  const selectedItem =
    editTarget === 'live' && mode === 'animate' && timelineSelection.length === 1 && timelineSelection[0].kind === 'keyframe'
      ? timelineSelection[0]
      : null
  const selectedTrackKind: KeyframeTrackKind | null = selectedItem ? (selectedItem.trackId as KeyframeTrackKind) : null
  const selectedKeyframe = selectedTrackKind && anim ? keyframeListForKind(anim, selectedTrackKind).find((k) => k.id === selectedItem!.id) : undefined

  // What the Eye Target selector shows/does while a keyframe is selected. 'leftEye'/'rightEye'
  // tracks are already tied to one specific side by which track they're on — the selector is
  // disabled there and just displays that side. 'pupils'/'eyelids' have no left/right concept at
  // all, so they're disabled and shown as 'both'. 'pose' is the one case with real per-keyframe
  // divergence (Keyframe.leftParams/rightParams, see keyframeParamsFor()) — there the selector
  // stays fully interactive and reads/writes the global `eyeTarget`, exactly like the live base
  // pose does; switching it never creates a new keyframe or jumps tracks, it only changes which
  // of the SAME keyframe's params/leftParams/rightParams is being edited.
  const keyframeEyeTargetValue: EyeSide | undefined =
    selectedTrackKind === 'leftEye' ? 'left' : selectedTrackKind === 'rightEye' ? 'right' : selectedTrackKind === 'pose' ? undefined : 'both'
  const keyframeEyeTargetDisabled = selectedTrackKind === 'leftEye' || selectedTrackKind === 'rightEye' || selectedTrackKind === 'pupils' || selectedTrackKind === 'eyelids'

  const [tab, setTab] = useState<ControlsTab>('shape')
  const [advancedOpen, setAdvancedOpen] = useState<{ upper: boolean; lower: boolean }>({ upper: false, lower: false })

  const target: EyeParams =
    editTarget === 'visual-reference'
      ? effectiveVisualReferenceParams(project.visualReference, eyeTarget)
      : selectedKeyframe
        ? selectedTrackKind === 'pose'
          ? keyframeParamsFor(selectedKeyframe, eyeTarget)
          : selectedKeyframe.params
        : effectiveEyeParams(project, eyeTarget)
  const setParam = <K extends keyof EyeParams>(key: K, value: EyeParams[K]) => {
    if (editTarget === 'visual-reference') setVisualReferenceParam(key, value)
    else if (selectedKeyframe && selectedTrackKind === 'pose' && eyeTarget !== 'both')
      updateTrackKeyframeEyeParams('pose', selectedKeyframe.id, eyeTarget, { [key]: value } as Partial<EyeParams>)
    else if (selectedKeyframe && selectedTrackKind) updateTrackKeyframeParams(selectedTrackKind, selectedKeyframe.id, { [key]: value } as Partial<EyeParams>)
    else setEyeParam(key, value)
  }

  // Eyelid Color/Opacity read/write EyeColors. Colors are only per-keyframe on the pose track
  // (see Keyframe.colors); on any other selection they edit the base/Visual-Reference palette —
  // the same rule the Colors panel follows.
  const colors: EyeColors =
    editTarget === 'visual-reference'
      ? effectiveVisualReferenceColors(project.visualReference, eyeTarget)
      : selectedKeyframe && selectedTrackKind === 'pose'
        ? keyframeColors(selectedKeyframe, project.colors)
        : effectiveEyeColors(project, eyeTarget)
  const setEyelidColor = <K extends keyof EyeColors>(key: K, value: EyeColors[K]) => {
    if (editTarget === 'visual-reference') setVisualReferenceColor(key, value)
    else if (selectedKeyframe && selectedTrackKind === 'pose') updateTrackKeyframeColors(selectedKeyframe.id, { [key]: value } as Partial<EyeColors>)
    else setColorLive(key, value)
  }

  // Non-destructive "Preview Blink": animate the store's transient eyelidPreviewClose 0→1→0 over
  // ~0.8s (a smooth close-and-open) so the user sees how the current lids meet, without touching
  // any saved params. Design-mode only (see PreviewCanvas); a no-op elsewhere.
  const previewBlink = () => {
    const start = performance.now()
    const durationMs = 800
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      // 0 → 1 → 0 (fully closed at the midpoint), eased so the close/open feels natural.
      const close = Math.sin(p * Math.PI)
      setEyelidPreviewClose(close)
      if (p < 1) requestAnimationFrame(tick)
      else setEyelidPreviewClose(0)
    }
    requestAnimationFrame(tick)
  }

  // 'circle' additionally snaps pupilWidth/pupilHeight equal (average of the current values) —
  // a one-time UI convenience, not a locked/linked state: dragging Width or Height afterward
  // moves independently exactly like it always has. Every other shape only ever touches
  // pupilShape/pupilCustomShapeId.
  const selectPupilShape = (shape: PupilShapeId, customShapeId: string | null) => {
    setParam('pupilShape', shape)
    setParam('pupilCustomShapeId', customShapeId)
    if (shape === 'circle') {
      const avg = Math.round((target.pupilWidth + target.pupilHeight) / 2)
      setParam('pupilWidth', avg)
      setParam('pupilHeight', avg)
    }
  }
  const resetPupilShape = () => {
    checkpoint()
    selectPupilShape('circle', null)
    setParam('pupilWidth', DEFAULT_EYE_PARAMS.pupilWidth)
    setParam('pupilHeight', DEFAULT_EYE_PARAMS.pupilHeight)
  }

  const applyEyelidPreset = (patch: Partial<EyeParams>) => {
    checkpoint()
    for (const key of Object.keys(patch) as (keyof EyeParams)[]) setParam(key, patch[key] as never)
  }
  const resetCurvature = () => {
    checkpoint()
    for (const key of EYELID_CURVATURE_FIELDS) setParam(key, DEFAULT_EYE_PARAMS[key] as never)
  }

  const selectEyeShape = (shape: EyeShapeId, customShapeId: string | null) => {
    setParam('eyeShape', shape)
    setParam('eyeCustomShapeId', customShapeId)
  }
  const resetEyeShape = () => {
    checkpoint()
    selectEyeShape('default', null)
    setParam('eyeShapeScale', DEFAULT_EYE_PARAMS.eyeShapeScale)
    setParam('eyeShapeOffsetX', DEFAULT_EYE_PARAMS.eyeShapeOffsetX)
    setParam('eyeShapeOffsetY', DEFAULT_EYE_PARAMS.eyeShapeOffsetY)
    setParam('eyeShapeFlipH', DEFAULT_EYE_PARAMS.eyeShapeFlipH)
    setParam('eyeShapeFlipV', DEFAULT_EYE_PARAMS.eyeShapeFlipV)
    setParam('width', DEFAULT_EYE_PARAMS.width)
    setParam('height', DEFAULT_EYE_PARAMS.height)
    setParam('radius', DEFAULT_EYE_PARAMS.radius)
  }

  // Inherited/Custom indicators compare `target` against the current Visual Reference —
  // always shown for live editing (keyframe, expression, AND the plain base pose with
  // nothing selected) so it's never ambiguous whether the base pose is actually in sync with
  // the reference or just holding stale values from an earlier edit/Apply. Editing the
  // Visual Reference itself has nothing to compare against (it IS the reference), so no
  // indicators there.
  const editingContext: 'keyframe' | 'expression' | 'base' | null =
    editTarget === 'visual-reference' ? null : selectedKeyframe ? 'keyframe' : selectedExpressionId ? 'expression' : 'base'
  const visualReference = project.visualReference
  // Pupils/eyelids keyframes have no left/right concept (always one shared pose), so they
  // compare against/reset to the VR's shared base regardless of the current Eye Target. A
  // leftEye/rightEye-track keyframe IS tied to one specific side by which track it's on, so it
  // compares against that side's own VR variant instead. A pose-track keyframe now has real
  // per-eye divergence of its own (leftParams/rightParams), so it resolves exactly like the base
  // pose/expressions do — via the current `eyeTarget`.
  const vrReference: EyeParams = selectedKeyframe
    ? selectedTrackKind === 'leftEye' || selectedTrackKind === 'rightEye'
      ? effectiveVisualReferenceParams(visualReference, selectedTrackKind === 'leftEye' ? 'left' : 'right')
      : selectedTrackKind === 'pose'
        ? effectiveVisualReferenceParams(visualReference, eyeTarget)
        : visualReference.params
    : effectiveVisualReferenceParams(visualReference, eyeTarget)
  const isStyleOverridden = (field: keyof EyeParams) => target[field] !== vrReference[field]
  const resetStyleField = (field: keyof EyeParams) => {
    checkpoint()
    setParam(field, vrReference[field])
  }
  // pupilShape/pupilCustomShapeId only mean something as a pair (a 'custom' shape id is
  // meaningless without knowing it's 'custom', and two different custom ids both count as
  // "diverged" even when pupilShape itself matches) — treated as one combined override/reset
  // unit rather than two independent StyleFieldRow fields.
  const pupilShapeOverridden = target.pupilShape !== vrReference.pupilShape || target.pupilCustomShapeId !== vrReference.pupilCustomShapeId
  const resetPupilShapeStyle = () => {
    checkpoint()
    setParam('pupilShape', vrReference.pupilShape)
    setParam('pupilCustomShapeId', vrReference.pupilCustomShapeId)
  }
  const eyeShapeOverridden =
    target.eyeShape !== vrReference.eyeShape ||
    target.eyeCustomShapeId !== vrReference.eyeCustomShapeId ||
    target.eyeShapeScale !== vrReference.eyeShapeScale ||
    target.eyeShapeFlipH !== vrReference.eyeShapeFlipH ||
    target.eyeShapeFlipV !== vrReference.eyeShapeFlipV
  const resetEyeShapeStyle = () => {
    checkpoint()
    setParam('eyeShape', vrReference.eyeShape)
    setParam('eyeCustomShapeId', vrReference.eyeCustomShapeId)
    setParam('eyeShapeScale', vrReference.eyeShapeScale)
    setParam('eyeShapeFlipH', vrReference.eyeShapeFlipH)
    setParam('eyeShapeFlipV', vrReference.eyeShapeFlipV)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-3 p-3">
        {editTarget === 'visual-reference' ? (
          <div className="text-xs bg-studio-accent/15 text-studio-accent border border-studio-accent/40 rounded-md px-2 py-1.5">
            Editing the Visual Reference's default shape — {eyeTarget === 'both' ? 'Both Eyes' : eyeTarget === 'left' ? 'Left Eye' : 'Right Eye'}
          </div>
        ) : selectedKeyframe && selectedTrackKind ? (
          <div className="text-xs bg-studio-accent/15 text-studio-accent border border-studio-accent/40 rounded-md px-2 py-1.5">
            Editing selected keyframe — {TRACK_KIND_LABEL[selectedTrackKind]}
          </div>
        ) : (
          <div className="text-xs bg-studio-panel2 text-studio-muted border border-studio-border rounded-md px-2 py-1.5">
            Editing base design pose — {eyeTarget === 'both' ? 'Both Eyes' : eyeTarget === 'left' ? 'Left Eye' : 'Right Eye'}
          </div>
        )}

        {editTarget === 'visual-reference' && (
          <p className="text-[11px] text-studio-muted -mt-1">
            Optional — most projects leave this at Both Eyes. Editing Left/Right Eye here authors a per-eye Visual
            Reference variant that Apply carries into matching left/right targets.
          </p>
        )}

        {selectedKeyframe && keyframeEyeTargetDisabled && (
          <p className="text-[11px] text-studio-muted -mt-1">
            {selectedTrackKind === 'pupils'
              ? "This track only contributes the Iris & Pupil tab's pupil fields when merged with the Expression track — values on other tabs are stored but not used from here. Pupils has no separate left/right track, so Eye Target isn't switchable here."
              : selectedTrackKind === 'eyelids'
                ? "This track only contributes the Eyelids tab's fields when merged with the Expression track — values on other tabs are stored but not used from here. Eyelids has no separate left/right track, so Eye Target isn't switchable here."
                : `This keyframe is on its own dedicated ${selectedTrackKind === 'leftEye' ? 'Left' : 'Right'} Eye track, so it's already tied to that side — Eye Target isn't switchable here.`}
          </p>
        )}

        <EyeTargetSelector disabled={selectedKeyframe ? keyframeEyeTargetDisabled : false} value={selectedKeyframe ? keyframeEyeTargetValue : undefined} />

        {selectedKeyframe && !keyframeEyeTargetDisabled && (
          <p className="text-[11px] text-studio-muted -mt-1">
            {selectedTrackKind === 'pose'
              ? 'Picking Left Eye or Right Eye edits this same keyframe’s own per-eye values — it never creates a new keyframe or track.'
              : "This track only contributes the Shape tab's fields (position, size, rotation, eye shape) when merged with the Expression track — values on other tabs are stored but not used from here."}
          </p>
        )}
      </div>

      <PanelTabs tabs={CONTROLS_TABS} active={tab} onChange={setTab} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === 'shape' && (
          <div className="flex flex-col gap-5">
            <Section title="Eye Shape">
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('width')} onReset={() => resetStyleField('width')}>
                <Slider label="Eye Width" value={target.width} min={EYE_PARAM_RANGES.width[0]} max={EYE_PARAM_RANGES.width[1]} onCommitStart={checkpoint} onChange={(v) => setParam('width', v)} />
              </StyleFieldRow>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('height')} onReset={() => resetStyleField('height')}>
                <Slider label="Eye Height" value={target.height} min={EYE_PARAM_RANGES.height[0]} max={EYE_PARAM_RANGES.height[1]} onCommitStart={checkpoint} onChange={(v) => setParam('height', v)} />
              </StyleFieldRow>
              {target.eyeShape === 'default' && (
                <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('radius')} onReset={() => resetStyleField('radius')}>
                  <Slider label="Eye Radius" value={target.radius} min={EYE_PARAM_RANGES.radius[0]} max={EYE_PARAM_RANGES.radius[1]} onCommitStart={checkpoint} onChange={(v) => setParam('radius', v)} />
                </StyleFieldRow>
              )}
              <Slider label="Eye Distance" value={target.distance} min={EYE_PARAM_RANGES.distance[0]} max={EYE_PARAM_RANGES.distance[1]} onCommitStart={checkpoint} onChange={(v) => setParam('distance', v)} />
              <Slider label="Eye Rotation" value={target.rotation} min={EYE_PARAM_RANGES.rotation[0]} max={EYE_PARAM_RANGES.rotation[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam('rotation', v)} />
              {/* Moves the whole eye around the display, on top of the symmetric ±distance/2
                  placement above — see EyeParams.eyePosX's own comment. Distinct from "Shape
                  Offset X/Y" below, which only nudges the traced silhouette within its own box. */}
              <Slider label="Eye Position X" value={target.eyePosX} min={EYE_PARAM_RANGES.eyePosX[0]} max={EYE_PARAM_RANGES.eyePosX[1]} suffix="px" onCommitStart={checkpoint} onChange={(v) => setParam('eyePosX', v)} />
              <Slider label="Eye Position Y" value={target.eyePosY} min={EYE_PARAM_RANGES.eyePosY[0]} max={EYE_PARAM_RANGES.eyePosY[1]} suffix="px" onCommitStart={checkpoint} onChange={(v) => setParam('eyePosY', v)} />
              {editTarget === 'visual-reference' && <PreviewOnlyNote />}
            </Section>

            <Section title="Eye Shape Library">
              <StyleFieldRow active={!!editingContext} overridden={eyeShapeOverridden} onReset={resetEyeShapeStyle}>
                <div className="flex flex-col gap-2">
                  <EyeShapePicker
                    shape={target.eyeShape}
                    customShapeId={target.eyeCustomShapeId}
                    currentWidth={target.width}
                    currentHeight={target.height}
                    currentRadius={target.radius}
                    onSelectShape={selectEyeShape}
                    onSelectDefaultPreset={(p) => {
                      setParam('width', p.width)
                      setParam('height', p.height)
                      setParam('radius', p.radius)
                    }}
                  />
                  <button className="studio-btn self-start text-xs" onClick={resetEyeShape}>
                    Reset to Default
                  </button>
                </div>
              </StyleFieldRow>

              {target.eyeShape !== 'default' && (
                <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('eyeShapeScale')} onReset={() => resetStyleField('eyeShapeScale')}>
                  <Slider
                    label="Shape Scale"
                    value={target.eyeShapeScale}
                    min={EYE_PARAM_RANGES.eyeShapeScale[0]}
                    max={EYE_PARAM_RANGES.eyeShapeScale[1]}
                    suffix="%"
                    onCommitStart={checkpoint}
                    onChange={(v) => setParam('eyeShapeScale', v)}
                  />
                </StyleFieldRow>
              )}
              {/* Shape Offset X/Y works for every eye shape, including 'default' (the plain
                  rounded-rect/ellipse boundary) — see roundedRectPath()'s offsetX/offsetY
                  params in drawEye.ts and eyesEyeHalfWidthAtShape()/eyesEyeHalfHeightAtShape()'s
                  default branch in cppExport.ts, both of which now honor it unconditionally. */}
              <Slider
                label="Shape Offset X"
                value={target.eyeShapeOffsetX}
                min={EYE_PARAM_RANGES.eyeShapeOffsetX[0]}
                max={EYE_PARAM_RANGES.eyeShapeOffsetX[1]}
                onCommitStart={checkpoint}
                onChange={(v) => setParam('eyeShapeOffsetX', v)}
              />
              <Slider
                label="Shape Offset Y"
                value={target.eyeShapeOffsetY}
                min={EYE_PARAM_RANGES.eyeShapeOffsetY[0]}
                max={EYE_PARAM_RANGES.eyeShapeOffsetY[1]}
                onCommitStart={checkpoint}
                onChange={(v) => setParam('eyeShapeOffsetY', v)}
              />
              {target.eyeShape !== 'default' && (
                <>
                  <div className="flex gap-2">
                    <button
                      className={`studio-btn text-xs flex-1 ${target.eyeShapeFlipH ? 'border-studio-accent text-studio-accent' : ''}`}
                      onClick={() => {
                        checkpoint()
                        setParam('eyeShapeFlipH', !target.eyeShapeFlipH)
                      }}
                    >
                      Flip Horizontal
                    </button>
                    <button
                      className={`studio-btn text-xs flex-1 ${target.eyeShapeFlipV ? 'border-studio-accent text-studio-accent' : ''}`}
                      onClick={() => {
                        checkpoint()
                        setParam('eyeShapeFlipV', !target.eyeShapeFlipV)
                      }}
                    >
                      Flip Vertical
                    </button>
                  </div>
                  <p className="text-[11px] text-studio-muted">
                    Fill Color and Stroke Color/Width for the eye shape are the same Sclera and Border controls on the
                    Colors tab.
                  </p>
                </>
              )}
              {editTarget === 'visual-reference' && <PreviewOnlyNote />}
            </Section>
          </div>
        )}

        {tab === 'iris-pupil' && (
          <div className="flex flex-col gap-5">
            <Section title="Iris & Pupil">
              <label className="flex items-center justify-between text-sm cursor-pointer select-none">
                <span className="studio-label">Iris</span>
                <span className="flex items-center gap-1.5 text-xs text-studio-muted">
                  <input type="checkbox" checked={target.irisVisible} onChange={(e) => { checkpoint(); setParam('irisVisible', e.target.checked) }} />
                  Visible
                </span>
              </label>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('irisWidth')} onReset={() => resetStyleField('irisWidth')}>
                <Slider label="Iris Width" value={target.irisWidth} min={EYE_PARAM_RANGES.irisWidth[0]} max={EYE_PARAM_RANGES.irisWidth[1]} onCommitStart={checkpoint} onChange={(v) => setParam('irisWidth', v)} />
              </StyleFieldRow>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('irisHeight')} onReset={() => resetStyleField('irisHeight')}>
                <Slider label="Iris Height" value={target.irisHeight} min={EYE_PARAM_RANGES.irisHeight[0]} max={EYE_PARAM_RANGES.irisHeight[1]} onCommitStart={checkpoint} onChange={(v) => setParam('irisHeight', v)} />
              </StyleFieldRow>

              <label className="flex items-center justify-between text-sm cursor-pointer select-none">
                <span className="studio-label">Pupil</span>
                <span className="flex items-center gap-1.5 text-xs text-studio-muted">
                  <input type="checkbox" checked={target.pupilVisible} onChange={(e) => { checkpoint(); setParam('pupilVisible', e.target.checked) }} />
                  Visible
                </span>
              </label>
              <StyleFieldRow active={!!editingContext} overridden={pupilShapeOverridden} onReset={resetPupilShapeStyle}>
                <div className="flex flex-col gap-2">
                  <PupilShapePicker shape={target.pupilShape} customShapeId={target.pupilCustomShapeId} onSelectShape={selectPupilShape} />
                  <button className="studio-btn self-start text-xs" onClick={resetPupilShape}>
                    Reset to Default (Circle)
                  </button>
                </div>
              </StyleFieldRow>

              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('pupilWidth')} onReset={() => resetStyleField('pupilWidth')}>
                <Slider label="Pupil Width" value={target.pupilWidth} min={EYE_PARAM_RANGES.pupilWidth[0]} max={EYE_PARAM_RANGES.pupilWidth[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilWidth', v)} />
              </StyleFieldRow>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('pupilHeight')} onReset={() => resetStyleField('pupilHeight')}>
                <Slider label="Pupil Height" value={target.pupilHeight} min={EYE_PARAM_RANGES.pupilHeight[0]} max={EYE_PARAM_RANGES.pupilHeight[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilHeight', v)} />
              </StyleFieldRow>
              <Slider label="Pupil X" value={target.pupilX} min={EYE_PARAM_RANGES.pupilX[0]} max={EYE_PARAM_RANGES.pupilX[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilX', v)} />
              <Slider label="Pupil Y" value={target.pupilY} min={EYE_PARAM_RANGES.pupilY[0]} max={EYE_PARAM_RANGES.pupilY[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilY', v)} />
              <Slider label="Pupil Rotation" value={target.pupilRotation} min={EYE_PARAM_RANGES.pupilRotation[0]} max={EYE_PARAM_RANGES.pupilRotation[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam('pupilRotation', v)} />
              {editTarget === 'visual-reference' && <PreviewOnlyNote />}
            </Section>

            <Section title="Highlight">
              <label className="flex items-center justify-between text-sm cursor-pointer select-none">
                <span className="studio-label">Highlight</span>
                <span className="flex items-center gap-1.5 text-xs text-studio-muted">
                  <input type="checkbox" checked={target.highlightVisible} onChange={(e) => { checkpoint(); setParam('highlightVisible', e.target.checked) }} />
                  Visible
                </span>
              </label>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('highlightX')} onReset={() => resetStyleField('highlightX')}>
                <Slider label="Highlight Position X" value={target.highlightX} min={EYE_PARAM_RANGES.highlightX[0]} max={EYE_PARAM_RANGES.highlightX[1]} onCommitStart={checkpoint} onChange={(v) => setParam('highlightX', v)} />
              </StyleFieldRow>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('highlightY')} onReset={() => resetStyleField('highlightY')}>
                <Slider label="Highlight Position Y" value={target.highlightY} min={EYE_PARAM_RANGES.highlightY[0]} max={EYE_PARAM_RANGES.highlightY[1]} onCommitStart={checkpoint} onChange={(v) => setParam('highlightY', v)} />
              </StyleFieldRow>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('highlightSize')} onReset={() => resetStyleField('highlightSize')}>
                <Slider label="Highlight Size" value={target.highlightSize} min={EYE_PARAM_RANGES.highlightSize[0]} max={EYE_PARAM_RANGES.highlightSize[1]} onCommitStart={checkpoint} onChange={(v) => setParam('highlightSize', v)} />
              </StyleFieldRow>
            </Section>
          </div>
        )}

        {tab === 'eyelids' && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="studio-label">Eyelid Style Preset</span>
              <div className="flex flex-wrap gap-1.5">
                {EYELID_STYLE_PRESETS.map((preset) => (
                  <button key={preset.id} className="studio-btn text-xs" onClick={() => applyEyelidPreset(preset.patch)}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {editTarget === 'live' && (
                  <button className="studio-btn text-xs" onClick={previewBlink} title="Preview how the eyelids close (Design mode)">
                    Preview Blink
                  </button>
                )}
                <button className="studio-btn text-xs" onClick={resetCurvature} title="Reset both lids' curve shape to default">
                  Reset Curvature
                </button>
              </div>
              {editTarget === 'visual-reference' && <PreviewOnlyNote />}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="flex items-center justify-between text-sm cursor-pointer select-none">
                <span className="studio-label">Disable Eyelid</span>
                <span className="flex items-center gap-1.5 text-xs text-studio-muted">
                  <input type="checkbox" checked={target.disableEyelid} onChange={(e) => { checkpoint(); setParam('disableEyelid', e.target.checked) }} />
                  On
                </span>
              </label>
              <p className="text-[11px] text-studio-muted">
                Hides the eye-shape outline/border so no ring shows around the part of the eye an
                eyelid covers. The sclera, iris, pupil and highlight still render and stay clipped by
                the eyelids.
              </p>
            </div>

            {EYELID_PANELS.map((cfg) => {
              const cornerOverridden = isStyleOverridden(cfg.leftRound) || isStyleOverridden(cfg.rightRound)
              const setCorner = (v: number) => {
                setParam(cfg.leftRound, v)
                setParam(cfg.rightRound, v)
              }
              const resetCorner = () => {
                checkpoint()
                setParam(cfg.leftRound, vrReference[cfg.leftRound])
                setParam(cfg.rightRound, vrReference[cfg.rightRound])
              }
              const adv = advancedOpen[cfg.which]
              return (
                <Section key={cfg.which} title={cfg.title}>
                  {/* Open Amount: 100% = fully open. Stored as coverage (100 − open), so keyframes/
                      export are unchanged. */}
                  <Slider label="Open Amount" value={100 - target[cfg.open]} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.open, 100 - v)} />
                  <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.curvature)} onReset={() => resetStyleField(cfg.curvature)}>
                    <Slider label="Curvature" value={target[cfg.curvature]} min={EYE_PARAM_RANGES[cfg.curvature][0]} max={EYE_PARAM_RANGES[cfg.curvature][1]} onCommitStart={checkpoint} onChange={(v) => setParam(cfg.curvature, v)} />
                  </StyleFieldRow>
                  <Slider label="Thickness" value={target[cfg.thickness]} min={EYE_PARAM_RANGES[cfg.thickness][0]} max={EYE_PARAM_RANGES[cfg.thickness][1]} suffix="px" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.thickness, v)} />
                  <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.offsetY)} onReset={() => resetStyleField(cfg.offsetY)}>
                    <Slider label="Offset Y" value={target[cfg.offsetY]} min={EYE_PARAM_RANGES[cfg.offsetY][0]} max={EYE_PARAM_RANGES[cfg.offsetY][1]} onCommitStart={checkpoint} onChange={(v) => setParam(cfg.offsetY, v)} />
                  </StyleFieldRow>
                  <StyleFieldRow active={!!editingContext} overridden={cornerOverridden} onReset={resetCorner}>
                    <Slider label="Corner Roundness" value={target[cfg.leftRound]} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={setCorner} />
                  </StyleFieldRow>
                  <Slider label="Tilt" value={target[cfg.tilt]} min={EYE_PARAM_RANGES[cfg.tilt][0]} max={EYE_PARAM_RANGES[cfg.tilt][1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.tilt, v)} />
                  <ColorField label="Color" value={colors[cfg.color]} onCommitStart={checkpoint} onChange={(v) => setEyelidColor(cfg.color, v)} />
                  <Slider label="Opacity" value={colors[cfg.opacity]} min={EYE_COLOR_RANGES[cfg.opacity][0]} max={EYE_COLOR_RANGES[cfg.opacity][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setEyelidColor(cfg.opacity, v)} />
                  {editTarget === 'visual-reference' && <PreviewOnlyNote />}

                  <button className="studio-btn self-start text-xs" onClick={() => setAdvancedOpen((o) => ({ ...o, [cfg.which]: !o[cfg.which] }))}>
                    {adv ? '▾ Advanced' : '▸ Advanced'}
                  </button>
                  {adv && (
                    <div className="flex flex-col gap-2.5 border-l-2 border-studio-border pl-2">
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.stretchX)} onReset={() => resetStyleField(cfg.stretchX)}>
                        <Slider label="Curve Width" value={target[cfg.stretchX]} min={EYE_PARAM_RANGES[cfg.stretchX][0]} max={EYE_PARAM_RANGES[cfg.stretchX][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.stretchX, v)} />
                      </StyleFieldRow>
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.stretchY)} onReset={() => resetStyleField(cfg.stretchY)}>
                        <Slider label="Curve Amplitude" value={target[cfg.stretchY]} min={EYE_PARAM_RANGES[cfg.stretchY][0]} max={EYE_PARAM_RANGES[cfg.stretchY][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.stretchY, v)} />
                      </StyleFieldRow>
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.centerDepth)} onReset={() => resetStyleField(cfg.centerDepth)}>
                        <Slider label="Center Depth" value={target[cfg.centerDepth]} min={EYE_PARAM_RANGES[cfg.centerDepth][0]} max={EYE_PARAM_RANGES[cfg.centerDepth][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.centerDepth, v)} />
                      </StyleFieldRow>
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.skew)} onReset={() => resetStyleField(cfg.skew)}>
                        <Slider label="Center Position X" value={target[cfg.skew]} min={EYE_PARAM_RANGES[cfg.skew][0]} max={EYE_PARAM_RANGES[cfg.skew][1]} onCommitStart={checkpoint} onChange={(v) => setParam(cfg.skew, v)} />
                      </StyleFieldRow>
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.leftRound)} onReset={() => resetStyleField(cfg.leftRound)}>
                        <Slider label="Left End Roundness" value={target[cfg.leftRound]} min={EYE_PARAM_RANGES[cfg.leftRound][0]} max={EYE_PARAM_RANGES[cfg.leftRound][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.leftRound, v)} />
                      </StyleFieldRow>
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.rightRound)} onReset={() => resetStyleField(cfg.rightRound)}>
                        <Slider label="Right End Roundness" value={target[cfg.rightRound]} min={EYE_PARAM_RANGES[cfg.rightRound][0]} max={EYE_PARAM_RANGES[cfg.rightRound][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.rightRound, v)} />
                      </StyleFieldRow>
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.smoothness)} onReset={() => resetStyleField(cfg.smoothness)}>
                        <Slider label="Smoothness" value={target[cfg.smoothness]} min={EYE_PARAM_RANGES[cfg.smoothness][0]} max={EYE_PARAM_RANGES[cfg.smoothness][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.smoothness, v)} />
                      </StyleFieldRow>
                      <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden(cfg.tension)} onReset={() => resetStyleField(cfg.tension)}>
                        <Slider label="Tension" value={target[cfg.tension]} min={EYE_PARAM_RANGES[cfg.tension][0]} max={EYE_PARAM_RANGES[cfg.tension][1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam(cfg.tension, v)} />
                      </StyleFieldRow>
                    </div>
                  )}
                </Section>
              )
            })}
          </div>
        )}

        {tab === 'timing' && (
          <Section title="Timing">
            <Slider label="Animation Speed" value={timing.animationSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('animationSpeed', v)} />
            <Slider label="Blink Speed" value={timing.blinkSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('blinkSpeed', v)} />
            <Slider label="Breathing Amount" value={timing.breathingAmount} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('breathingAmount', v)} />
            {editTarget === 'visual-reference' && (
              <p className="text-[11px] text-studio-muted italic">
                Timing is already a single project-wide setting (not duplicated per expression/animation), so
                editing it here is the same as editing it anywhere else.
              </p>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}
