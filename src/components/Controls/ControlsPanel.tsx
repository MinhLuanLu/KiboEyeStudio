import { useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import type { KeyframeTrackKind } from '@/state/store'
import { effectiveEyeParams, effectiveVisualReferenceParams, keyframeParamsFor, EYE_PARAM_RANGES, DEFAULT_EYE_PARAMS } from '@/types'
import type { EyeParams, EyeShapeId, PupilShapeId, Keyframe, EyeSide } from '@/types'
import { Slider } from '@/components/ui/Slider'
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
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('irisWidth')} onReset={() => resetStyleField('irisWidth')}>
                <Slider label="Iris Width" value={target.irisWidth} min={EYE_PARAM_RANGES.irisWidth[0]} max={EYE_PARAM_RANGES.irisWidth[1]} onCommitStart={checkpoint} onChange={(v) => setParam('irisWidth', v)} />
              </StyleFieldRow>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('irisHeight')} onReset={() => resetStyleField('irisHeight')}>
                <Slider label="Iris Height" value={target.irisHeight} min={EYE_PARAM_RANGES.irisHeight[0]} max={EYE_PARAM_RANGES.irisHeight[1]} onCommitStart={checkpoint} onChange={(v) => setParam('irisHeight', v)} />
              </StyleFieldRow>

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
          <Section title="Eyelids">
            <Slider label="Upper Eyelid" value={target.upperEyelid} min={EYE_PARAM_RANGES.upperEyelid[0]} max={EYE_PARAM_RANGES.upperEyelid[1]} onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelid', v)} />
            <Slider label="Lower Eyelid" value={target.lowerEyelid} min={EYE_PARAM_RANGES.lowerEyelid[0]} max={EYE_PARAM_RANGES.lowerEyelid[1]} onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelid', v)} />
            <Slider label="Upper Eyelid Tilt" value={target.upperEyelidTilt} min={EYE_PARAM_RANGES.upperEyelidTilt[0]} max={EYE_PARAM_RANGES.upperEyelidTilt[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelidTilt', v)} />
            <Slider label="Lower Eyelid Tilt" value={target.lowerEyelidTilt} min={EYE_PARAM_RANGES.lowerEyelidTilt[0]} max={EYE_PARAM_RANGES.lowerEyelidTilt[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelidTilt', v)} />
            {editTarget === 'visual-reference' && <PreviewOnlyNote />}
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('upperEyelidCurvature')} onReset={() => resetStyleField('upperEyelidCurvature')}>
              <Slider label="Upper Eyelid Curvature" value={target.upperEyelidCurvature} min={EYE_PARAM_RANGES.upperEyelidCurvature[0]} max={EYE_PARAM_RANGES.upperEyelidCurvature[1]} onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelidCurvature', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('lowerEyelidCurvature')} onReset={() => resetStyleField('lowerEyelidCurvature')}>
              <Slider label="Lower Eyelid Curvature" value={target.lowerEyelidCurvature} min={EYE_PARAM_RANGES.lowerEyelidCurvature[0]} max={EYE_PARAM_RANGES.lowerEyelidCurvature[1]} onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelidCurvature', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('upperEyelidRoundness')} onReset={() => resetStyleField('upperEyelidRoundness')}>
              <Slider label="Upper Eyelid Roundness" value={target.upperEyelidRoundness} min={EYE_PARAM_RANGES.upperEyelidRoundness[0]} max={EYE_PARAM_RANGES.upperEyelidRoundness[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelidRoundness', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('lowerEyelidRoundness')} onReset={() => resetStyleField('lowerEyelidRoundness')}>
              <Slider label="Lower Eyelid Roundness" value={target.lowerEyelidRoundness} min={EYE_PARAM_RANGES.lowerEyelidRoundness[0]} max={EYE_PARAM_RANGES.lowerEyelidRoundness[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelidRoundness', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('upperEyelidStretchX')} onReset={() => resetStyleField('upperEyelidStretchX')}>
              <Slider label="Upper Eyelid Stretch X" value={target.upperEyelidStretchX} min={EYE_PARAM_RANGES.upperEyelidStretchX[0]} max={EYE_PARAM_RANGES.upperEyelidStretchX[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelidStretchX', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('lowerEyelidStretchX')} onReset={() => resetStyleField('lowerEyelidStretchX')}>
              <Slider label="Lower Eyelid Stretch X" value={target.lowerEyelidStretchX} min={EYE_PARAM_RANGES.lowerEyelidStretchX[0]} max={EYE_PARAM_RANGES.lowerEyelidStretchX[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelidStretchX', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('upperEyelidStretchY')} onReset={() => resetStyleField('upperEyelidStretchY')}>
              <Slider label="Upper Eyelid Stretch Y" value={target.upperEyelidStretchY} min={EYE_PARAM_RANGES.upperEyelidStretchY[0]} max={EYE_PARAM_RANGES.upperEyelidStretchY[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelidStretchY', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('lowerEyelidStretchY')} onReset={() => resetStyleField('lowerEyelidStretchY')}>
              <Slider label="Lower Eyelid Stretch Y" value={target.lowerEyelidStretchY} min={EYE_PARAM_RANGES.lowerEyelidStretchY[0]} max={EYE_PARAM_RANGES.lowerEyelidStretchY[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelidStretchY', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('upperEyelidSkew')} onReset={() => resetStyleField('upperEyelidSkew')}>
              <Slider label="Upper Eyelid Skew" value={target.upperEyelidSkew} min={EYE_PARAM_RANGES.upperEyelidSkew[0]} max={EYE_PARAM_RANGES.upperEyelidSkew[1]} onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelidSkew', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('lowerEyelidSkew')} onReset={() => resetStyleField('lowerEyelidSkew')}>
              <Slider label="Lower Eyelid Skew" value={target.lowerEyelidSkew} min={EYE_PARAM_RANGES.lowerEyelidSkew[0]} max={EYE_PARAM_RANGES.lowerEyelidSkew[1]} onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelidSkew', v)} />
            </StyleFieldRow>
          </Section>
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
