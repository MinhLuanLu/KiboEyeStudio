import { useStore } from '@/state/store'
import { DEFAULT_EYE_COLORS, effectiveEyeColors } from '@/types'
import { ColorField } from '@/components/ui/ColorField'
import { Slider } from '@/components/ui/Slider'
import { EyeTargetSelector } from '@/components/ui/EyeTargetSelector'

export function ColorPanel() {
  const project = useStore((s) => s.project)
  const eyeTarget = useStore((s) => s.eyeTarget)
  const colors = effectiveEyeColors(project, eyeTarget)
  const setColor = useStore((s) => s.setColor)
  const checkpoint = useStore((s) => s.checkpoint)

  const reset = () => {
    checkpoint()
    ;(Object.keys(DEFAULT_EYE_COLORS) as (keyof typeof DEFAULT_EYE_COLORS)[]).forEach((key) => {
      setColor(key, DEFAULT_EYE_COLORS[key])
    })
  }

  return (
    <div className="flex flex-col gap-5 p-3 overflow-y-auto h-full">
      <p className="text-xs text-studio-muted leading-relaxed">
        Customize every layer of the eye. Changes preview live on the round display.
      </p>

      <EyeTargetSelector />

      <div className="flex flex-col gap-2.5">
        <ColorField label="Sclera" value={colors.sclera} onCommitStart={checkpoint} onChange={(v) => setColor('sclera', v)} />
        <ColorField label="Iris" value={colors.iris} onCommitStart={checkpoint} onChange={(v) => setColor('iris', v)} />
        <ColorField label="Pupil" value={colors.pupil} onCommitStart={checkpoint} onChange={(v) => setColor('pupil', v)} />
        <ColorField label="Highlight" value={colors.highlight} onCommitStart={checkpoint} onChange={(v) => setColor('highlight', v)} />
        <ColorField label="Shadow" value={colors.shadow} onCommitStart={checkpoint} onChange={(v) => setColor('shadow', v)} />
        <ColorField label="Glow" value={colors.glow} onCommitStart={checkpoint} onChange={(v) => setColor('glow', v)} />
        <ColorField label="Border" value={colors.border} onCommitStart={checkpoint} onChange={(v) => setColor('border', v)} />
      </div>

      <div className="flex flex-col gap-2.5">
        <Slider
          label="Shadow Intensity"
          value={colors.shadowIntensity}
          min={0}
          max={100}
          suffix="%"
          onCommitStart={checkpoint}
          onChange={(v) => setColor('shadowIntensity', v)}
        />
        <Slider
          label="Glow Intensity"
          value={colors.glowIntensity}
          min={0}
          max={100}
          suffix="%"
          onCommitStart={checkpoint}
          onChange={(v) => setColor('glowIntensity', v)}
        />
        <Slider
          label="Border Opacity"
          value={colors.borderOpacity}
          min={0}
          max={100}
          suffix="%"
          onCommitStart={checkpoint}
          onChange={(v) => setColor('borderOpacity', v)}
        />
      </div>

      <button className="studio-btn self-start" onClick={reset}>
        Reset to Defaults
      </button>
    </div>
  )
}
