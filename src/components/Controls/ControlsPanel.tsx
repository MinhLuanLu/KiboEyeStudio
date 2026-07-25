import { useStore, getActiveAnimation } from '@/state/store'
import { EYE_PARAM_RANGES } from '@/types'
import type { EyeParams } from '@/types'
import { Slider } from '@/components/ui/Slider'

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
  const eyeBase = useStore((s) => s.project.eyeBase)
  const timing = useStore((s) => s.project.timing)
  const setEyeParam = useStore((s) => s.setEyeParam)
  const setTiming = useStore((s) => s.setTiming)
  const checkpoint = useStore((s) => s.checkpoint)

  const mode = useStore((s) => s.mode)
  const selectedKeyframeId = useStore((s) => s.selectedKeyframeId)
  const updateKeyframeParams = useStore((s) => s.updateKeyframeParams)
  const anim = useStore(() => getActiveAnimation())
  const selectedKeyframe = mode === 'animate' ? anim?.keyframes.find((k) => k.id === selectedKeyframeId) : undefined

  const target: EyeParams = selectedKeyframe ? selectedKeyframe.params : eyeBase
  const setParam = <K extends keyof EyeParams>(key: K, value: EyeParams[K]) => {
    if (selectedKeyframe) updateKeyframeParams(selectedKeyframe.id, { [key]: value } as Partial<EyeParams>)
    else setEyeParam(key, value)
  }

  return (
    <div className="flex flex-col gap-5 p-3 overflow-y-auto h-full">
      {selectedKeyframe ? (
        <div className="text-xs bg-studio-accent/15 text-studio-accent border border-studio-accent/40 rounded-md px-2 py-1.5">
          Editing selected keyframe
        </div>
      ) : (
        <div className="text-xs bg-studio-panel2 text-studio-muted border border-studio-border rounded-md px-2 py-1.5">
          Editing base design pose
        </div>
      )}

      <Section title="Eye Shape">
        <Slider label="Eye Width" value={target.width} min={EYE_PARAM_RANGES.width[0]} max={EYE_PARAM_RANGES.width[1]} onCommitStart={checkpoint} onChange={(v) => setParam('width', v)} />
        <Slider label="Eye Height" value={target.height} min={EYE_PARAM_RANGES.height[0]} max={EYE_PARAM_RANGES.height[1]} onCommitStart={checkpoint} onChange={(v) => setParam('height', v)} />
        <Slider label="Eye Radius" value={target.radius} min={EYE_PARAM_RANGES.radius[0]} max={EYE_PARAM_RANGES.radius[1]} onCommitStart={checkpoint} onChange={(v) => setParam('radius', v)} />
        <Slider label="Eye Distance" value={target.distance} min={EYE_PARAM_RANGES.distance[0]} max={EYE_PARAM_RANGES.distance[1]} onCommitStart={checkpoint} onChange={(v) => setParam('distance', v)} />
        <Slider label="Eye Rotation" value={target.rotation} min={EYE_PARAM_RANGES.rotation[0]} max={EYE_PARAM_RANGES.rotation[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setParam('rotation', v)} />
      </Section>

      <Section title="Pupil">
        <Slider label="Pupil Size" value={target.pupilSize} min={EYE_PARAM_RANGES.pupilSize[0]} max={EYE_PARAM_RANGES.pupilSize[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilSize', v)} />
        <Slider label="Pupil X" value={target.pupilX} min={EYE_PARAM_RANGES.pupilX[0]} max={EYE_PARAM_RANGES.pupilX[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilX', v)} />
        <Slider label="Pupil Y" value={target.pupilY} min={EYE_PARAM_RANGES.pupilY[0]} max={EYE_PARAM_RANGES.pupilY[1]} onCommitStart={checkpoint} onChange={(v) => setParam('pupilY', v)} />
      </Section>

      <Section title="Eyelids">
        <Slider label="Upper Eyelid" value={target.upperEyelid} min={EYE_PARAM_RANGES.upperEyelid[0]} max={EYE_PARAM_RANGES.upperEyelid[1]} onCommitStart={checkpoint} onChange={(v) => setParam('upperEyelid', v)} />
        <Slider label="Lower Eyelid" value={target.lowerEyelid} min={EYE_PARAM_RANGES.lowerEyelid[0]} max={EYE_PARAM_RANGES.lowerEyelid[1]} onCommitStart={checkpoint} onChange={(v) => setParam('lowerEyelid', v)} />
      </Section>

      <Section title="Highlight">
        <Slider label="Highlight Position X" value={target.highlightX} min={EYE_PARAM_RANGES.highlightX[0]} max={EYE_PARAM_RANGES.highlightX[1]} onCommitStart={checkpoint} onChange={(v) => setParam('highlightX', v)} />
        <Slider label="Highlight Position Y" value={target.highlightY} min={EYE_PARAM_RANGES.highlightY[0]} max={EYE_PARAM_RANGES.highlightY[1]} onCommitStart={checkpoint} onChange={(v) => setParam('highlightY', v)} />
        <Slider label="Highlight Size" value={target.highlightSize} min={EYE_PARAM_RANGES.highlightSize[0]} max={EYE_PARAM_RANGES.highlightSize[1]} onCommitStart={checkpoint} onChange={(v) => setParam('highlightSize', v)} />
      </Section>

      <Section title="Timing">
        <Slider label="Animation Speed" value={timing.animationSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('animationSpeed', v)} />
        <Slider label="Blink Speed" value={timing.blinkSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('blinkSpeed', v)} />
        <Slider label="Breathing Amount" value={timing.breathingAmount} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('breathingAmount', v)} />
      </Section>
    </div>
  )
}
