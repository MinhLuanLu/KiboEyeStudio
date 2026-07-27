import { useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import { effectiveEyeParams, EYE_PARAM_RANGES } from '@/types'
import type { EyeParams } from '@/types'
import { Slider } from '@/components/ui/Slider'
import { EyeTargetSelector } from '@/components/ui/EyeTargetSelector'
import { StyleFieldRow } from '@/components/ui/StyleFieldRow'
import { PanelTabs } from '@/components/ui/PanelTabs'

type ControlsTab = 'shape' | 'iris-pupil' | 'eyelids' | 'timing'

const CONTROLS_TABS: { value: ControlsTab; label: string }[] = [
  { value: 'shape', label: 'Shape' },
  { value: 'iris-pupil', label: 'Iris & Pupil' },
  { value: 'eyelids', label: 'Eyelids' },
  { value: 'timing', label: 'Timing' }
]

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

export function ControlsPanel() {
  const project = useStore((s) => s.project)
  const eyeTarget = useStore((s) => s.eyeTarget)
  const timing = useStore((s) => s.project.timing)
  const setEyeParam = useStore((s) => s.setEyeParam)
  const setTiming = useStore((s) => s.setTiming)
  const checkpoint = useStore((s) => s.checkpoint)

  const mode = useStore((s) => s.mode)
  const selectedKeyframeId = useStore((s) => s.selectedKeyframeId)
  const selectedExpressionId = useStore((s) => s.selectedExpressionId)
  const updateKeyframeParams = useStore((s) => s.updateKeyframeParams)
  const anim = useStore(() => getActiveAnimation())
  const selectedKeyframe = mode === 'animate' ? anim?.keyframes.find((k) => k.id === selectedKeyframeId) : undefined

  const [tab, setTab] = useState<ControlsTab>('shape')

  // Keyframes stay a single shared pose (mirrored for both eyes) — the Eye Target selector
  // only applies to the live base pose, so it's disabled while a keyframe is selected.
  const target: EyeParams = selectedKeyframe ? selectedKeyframe.params : effectiveEyeParams(project, eyeTarget)
  const setParam = <K extends keyof EyeParams>(key: K, value: EyeParams[K]) => {
    if (selectedKeyframe) updateKeyframeParams(selectedKeyframe.id, { [key]: value } as Partial<EyeParams>)
    else setEyeParam(key, value)
  }

  // Inherited/Custom indicators only make sense while editing a specific, nameable thing
  // that can have Visual Reference overrides — a selected keyframe, or (in Design mode) the
  // expression currently loaded live. The raw "Both Eyes" base pose with nothing selected
  // isn't itself an overridable entity, so no indicators show there.
  const editingContext: 'keyframe' | 'expression' | null = selectedKeyframe ? 'keyframe' : selectedExpressionId ? 'expression' : null
  const visualReference = project.visualReference
  const isStyleOverridden = (field: keyof EyeParams) => target[field] !== visualReference.params[field]
  const resetStyleField = (field: keyof EyeParams) => {
    checkpoint()
    setParam(field, visualReference.params[field])
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-3 p-3">
        {selectedKeyframe ? (
          <div className="text-xs bg-studio-accent/15 text-studio-accent border border-studio-accent/40 rounded-md px-2 py-1.5">
            Editing selected keyframe (shared, both eyes)
          </div>
        ) : (
          <div className="text-xs bg-studio-panel2 text-studio-muted border border-studio-border rounded-md px-2 py-1.5">
            Editing base design pose — {eyeTarget === 'both' ? 'Both Eyes' : eyeTarget === 'left' ? 'Left Eye' : 'Right Eye'}
          </div>
        )}

        <EyeTargetSelector disabled={!!selectedKeyframe} />
      </div>

      <PanelTabs tabs={CONTROLS_TABS} active={tab} onChange={setTab} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === 'shape' && (
          <Section title="Eye Shape">
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('width')} onReset={() => resetStyleField('width')}>
              <Slider label="Eye Width" value={target.width} min={EYE_PARAM_RANGES.width[0]} max={EYE_PARAM_RANGES.width[1]} onCommitStart={checkpoint} onChange={(v) => setParam('width', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('height')} onReset={() => resetStyleField('height')}>
              <Slider label="Eye Height" value={target.height} min={EYE_PARAM_RANGES.height[0]} max={EYE_PARAM_RANGES.height[1]} onCommitStart={checkpoint} onChange={(v) => setParam('height', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('radius')} onReset={() => resetStyleField('radius')}>
              <Slider label="Eye Radius" value={target.radius} min={EYE_PARAM_RANGES.radius[0]} max={EYE_PARAM_RANGES.radius[1]} onCommitStart={checkpoint} onChange={(v) => setParam('radius', v)} />
            </StyleFieldRow>
            <Slider label="Eye Distance" value={target.distance} min={EYE_PARAM_RANGES.distance[0]} max={EYE_PARAM_RANGES.distance[1]} onCommitStart={checkpoint} onChange={(v) => setParam('distance', v)} />
            <Slider label="Eye Rotation" value={target.rotation} min={EYE_PARAM_RANGES.rotation[0]} max={EYE_PARAM_RANGES.rotation[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam('rotation', v)} />
          </Section>
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
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('pupilWidth')} onReset={() => resetStyleField('pupilWidth')}>
                <Slider label="Pupil Width" value={target.pupilWidth} min={EYE_PARAM_RANGES.pupilWidth[0]} max={EYE_PARAM_RANGES.pupilWidth[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilWidth', v)} />
              </StyleFieldRow>
              <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('pupilHeight')} onReset={() => resetStyleField('pupilHeight')}>
                <Slider label="Pupil Height" value={target.pupilHeight} min={EYE_PARAM_RANGES.pupilHeight[0]} max={EYE_PARAM_RANGES.pupilHeight[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilHeight', v)} />
              </StyleFieldRow>
              <Slider label="Pupil X" value={target.pupilX} min={EYE_PARAM_RANGES.pupilX[0]} max={EYE_PARAM_RANGES.pupilX[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilX', v)} />
              <Slider label="Pupil Y" value={target.pupilY} min={EYE_PARAM_RANGES.pupilY[0]} max={EYE_PARAM_RANGES.pupilY[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilY', v)} />
              <Slider label="Pupil Rotation" value={target.pupilRotation} min={EYE_PARAM_RANGES.pupilRotation[0]} max={EYE_PARAM_RANGES.pupilRotation[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam('pupilRotation', v)} />
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
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('upperEyelidCurvature')} onReset={() => resetStyleField('upperEyelidCurvature')}>
              <Slider label="Upper Eyelid Curvature" value={target.upperEyelidCurvature} min={EYE_PARAM_RANGES.upperEyelidCurvature[0]} max={EYE_PARAM_RANGES.upperEyelidCurvature[1]} onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelidCurvature', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={!!editingContext} overridden={isStyleOverridden('lowerEyelidCurvature')} onReset={() => resetStyleField('lowerEyelidCurvature')}>
              <Slider label="Lower Eyelid Curvature" value={target.lowerEyelidCurvature} min={EYE_PARAM_RANGES.lowerEyelidCurvature[0]} max={EYE_PARAM_RANGES.lowerEyelidCurvature[1]} onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelidCurvature', v)} />
            </StyleFieldRow>
          </Section>
        )}

        {tab === 'timing' && (
          <Section title="Timing">
            <Slider label="Animation Speed" value={timing.animationSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('animationSpeed', v)} />
            <Slider label="Blink Speed" value={timing.blinkSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('blinkSpeed', v)} />
            <Slider label="Breathing Amount" value={timing.breathingAmount} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('breathingAmount', v)} />
          </Section>
        )}
      </div>
    </div>
  )
}
