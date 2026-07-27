import { useState } from 'react'
import { useStore } from '@/state/store'
import { DEFAULT_EYE_COLORS, EYE_COLOR_RANGES, effectiveEyeColors } from '@/types'
import type { EyeColors } from '@/types'
import { ColorField } from '@/components/ui/ColorField'
import { Slider } from '@/components/ui/Slider'
import { EyeTargetSelector } from '@/components/ui/EyeTargetSelector'
import { StyleFieldRow } from '@/components/ui/StyleFieldRow'
import { PanelTabs } from '@/components/ui/PanelTabs'

type ColorTab = 'colors' | 'effects'

const COLOR_TABS: { value: ColorTab; label: string }[] = [
  { value: 'colors', label: 'Colors' },
  { value: 'effects', label: 'Effects' }
]

export function ColorPanel() {
  const project = useStore((s) => s.project)
  const eyeTarget = useStore((s) => s.eyeTarget)
  const colors = effectiveEyeColors(project, eyeTarget)
  const setColor = useStore((s) => s.setColor)
  const checkpoint = useStore((s) => s.checkpoint)
  const selectedExpressionId = useStore((s) => s.selectedExpressionId)

  const [tab, setTab] = useState<ColorTab>('colors')

  // Unlike EyeParams, colors have no per-keyframe concept at all (an animation's colors
  // always come from the shared project palette, never from a keyframe) — so the only
  // overridable "thing" for colors is the expression currently loaded live, if any.
  const editingContext = !!selectedExpressionId
  const visualReference = project.visualReference
  const isStyleOverridden = (field: keyof EyeColors) => colors[field] !== visualReference.colors[field]
  const resetStyleField = (field: keyof EyeColors) => {
    checkpoint()
    setColor(field, visualReference.colors[field])
  }

  const reset = () => {
    checkpoint()
    ;(Object.keys(DEFAULT_EYE_COLORS) as (keyof typeof DEFAULT_EYE_COLORS)[]).forEach((key) => {
      setColor(key, DEFAULT_EYE_COLORS[key])
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-3 p-3">
        <p className="text-xs text-studio-muted leading-relaxed">
          Customize every layer of the eye. Changes preview live on the round display.
        </p>
        <EyeTargetSelector />
      </div>

      <PanelTabs tabs={COLOR_TABS} active={tab} onChange={setTab} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === 'colors' && (
          <div className="flex flex-col gap-2.5">
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('sclera')} onReset={() => resetStyleField('sclera')}>
              <ColorField label="Sclera" value={colors.sclera} onCommitStart={checkpoint} onChange={(v) => setColor('sclera', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('iris')} onReset={() => resetStyleField('iris')}>
              <ColorField label="Iris" value={colors.iris} onCommitStart={checkpoint} onChange={(v) => setColor('iris', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('pupil')} onReset={() => resetStyleField('pupil')}>
              <ColorField label="Pupil" value={colors.pupil} onCommitStart={checkpoint} onChange={(v) => setColor('pupil', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('highlight')} onReset={() => resetStyleField('highlight')}>
              <ColorField label="Highlight" value={colors.highlight} onCommitStart={checkpoint} onChange={(v) => setColor('highlight', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('shadow')} onReset={() => resetStyleField('shadow')}>
              <ColorField label="Shadow" value={colors.shadow} onCommitStart={checkpoint} onChange={(v) => setColor('shadow', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('glow')} onReset={() => resetStyleField('glow')}>
              <ColorField label="Glow" value={colors.glow} onCommitStart={checkpoint} onChange={(v) => setColor('glow', v)} />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('border')} onReset={() => resetStyleField('border')}>
              <ColorField label="Border" value={colors.border} onCommitStart={checkpoint} onChange={(v) => setColor('border', v)} />
            </StyleFieldRow>
          </div>
        )}

        {tab === 'effects' && (
          <div className="flex flex-col gap-2.5">
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('shadowIntensity')} onReset={() => resetStyleField('shadowIntensity')}>
              <Slider
                label="Shadow Intensity"
                value={colors.shadowIntensity}
                min={0}
                max={100}
                suffix="%"
                onCommitStart={checkpoint}
                onChange={(v) => setColor('shadowIntensity', v)}
              />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('glowIntensity')} onReset={() => resetStyleField('glowIntensity')}>
              <Slider
                label="Glow Intensity"
                value={colors.glowIntensity}
                min={0}
                max={100}
                suffix="%"
                onCommitStart={checkpoint}
                onChange={(v) => setColor('glowIntensity', v)}
              />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('borderOpacity')} onReset={() => resetStyleField('borderOpacity')}>
              <Slider
                label="Border Opacity"
                value={colors.borderOpacity}
                min={0}
                max={100}
                suffix="%"
                onCommitStart={checkpoint}
                onChange={(v) => setColor('borderOpacity', v)}
              />
            </StyleFieldRow>
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('borderWidth')} onReset={() => resetStyleField('borderWidth')}>
              <Slider
                label="Border Thickness"
                value={colors.borderWidth}
                min={EYE_COLOR_RANGES.borderWidth[0]}
                max={EYE_COLOR_RANGES.borderWidth[1]}
                suffix="px"
                onCommitStart={checkpoint}
                onChange={(v) => setColor('borderWidth', v)}
              />
            </StyleFieldRow>
          </div>
        )}
      </div>

      <div className="p-3 pt-0">
        <button className="studio-btn self-start" onClick={reset}>
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}
