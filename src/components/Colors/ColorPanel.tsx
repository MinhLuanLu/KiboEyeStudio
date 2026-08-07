import { useState } from 'react'
import { useStore, getActiveAnimation } from '@/state/store'
import { DEFAULT_EYE_COLORS, effectiveEyeColors, effectiveVisualReferenceColors, keyframeColors, EYE_COLOR_RANGES } from '@/types'
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

// editTarget defaults to 'live' (the normal base-pose/expression color editing this panel has
// always done). Passing 'visual-reference' (used when reused inside the right panel's Visual
// Reference tab) points every field at project.visualReference.colors via
// setVisualReferenceColor instead — same sliders, different write target.
export function ColorPanel({ editTarget = 'live' }: { editTarget?: 'live' | 'visual-reference' }) {
  const project = useStore((s) => s.project)
  const eyeTarget = useStore((s) => s.eyeTarget)
  const mode = useStore((s) => s.mode)
  const timelineSelection = useStore((s) => s.timelineSelection)
  const anim = useStore(() => getActiveAnimation())
  const setColorLive = useStore((s) => s.setColor)
  const setVisualReferenceColor = useStore((s) => s.setVisualReferenceColor)
  const updateTrackKeyframeColors = useStore((s) => s.updateTrackKeyframeColors)
  const checkpoint = useStore((s) => s.checkpoint)

  // Which single pose ("Expression") track keyframe (if any) the Timeline currently has
  // selected — colors live only on the pose track (see Keyframe.colors), so a leftEye/pupils/
  // eyelids/sticker selection doesn't route color here (it keeps editing the base palette, same
  // as before). While one IS selected, every field below reads that keyframe's own palette and
  // writes only to it via updateTrackKeyframeColors, so changing a color affects that keyframe
  // alone instead of the whole project.
  const selectedPoseKeyframe =
    editTarget === 'live' && mode === 'animate' && timelineSelection.length === 1 && timelineSelection[0].kind === 'keyframe' && timelineSelection[0].trackId === 'pose' && anim
      ? anim.keyframes.find((k) => k.id === timelineSelection[0].id)
      : undefined

  const colors: EyeColors =
    editTarget === 'visual-reference'
      ? effectiveVisualReferenceColors(project.visualReference, eyeTarget)
      : selectedPoseKeyframe
        ? keyframeColors(selectedPoseKeyframe, project.colors)
        : effectiveEyeColors(project, eyeTarget)

  const setColor = <K extends keyof EyeColors>(key: K, value: EyeColors[K]) => {
    if (editTarget === 'visual-reference') setVisualReferenceColor(key, value)
    else if (selectedPoseKeyframe) updateTrackKeyframeColors(selectedPoseKeyframe.id, { [key]: value } as Partial<EyeColors>)
    else setColorLive(key, value)
  }

  const [tab, setTab] = useState<ColorTab>('colors')

  // Always compare against the Visual Reference for live editing — whether editing a
  // selected expression's colors or the plain base palette with nothing selected — so it's
  // never ambiguous whether the current colors are actually in sync with the reference or
  // holding stale values. Editing the Visual Reference itself has nothing to compare against
  // (it IS the reference), so no indicators there.
  const editingContext = editTarget === 'live'
  const visualReference = project.visualReference
  const vrReference = effectiveVisualReferenceColors(visualReference, eyeTarget)
  const isStyleOverridden = (field: keyof EyeColors) => colors[field] !== vrReference[field]
  const resetStyleField = (field: keyof EyeColors) => {
    checkpoint()
    setColor(field, vrReference[field])
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
        {editTarget === 'visual-reference' ? (
          <div className="text-xs bg-studio-accent/15 text-studio-accent border border-studio-accent/40 rounded-md px-2 py-1.5">
            Editing the Visual Reference's default colors — {eyeTarget === 'both' ? 'Both Eyes' : eyeTarget === 'left' ? 'Left Eye' : 'Right Eye'}
          </div>
        ) : selectedPoseKeyframe ? (
          <div className="flex flex-col gap-1">
            <div className="text-xs bg-studio-accent/15 text-studio-accent border border-studio-accent/40 rounded-md px-2 py-1.5">
              Editing selected keyframe color — {Math.round(selectedPoseKeyframe.timeMs)}ms
            </div>
            <p className="text-[11px] text-studio-muted">
              Only this keyframe changes; the preview interpolates color between keyframes. Firmware export still uses the
              project's base palette.
            </p>
          </div>
        ) : (
          <p className="text-xs text-studio-muted leading-relaxed">
            Customize every layer of the eye. Changes preview live on the round display.
          </p>
        )}
        {!selectedPoseKeyframe && <EyeTargetSelector />}
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
            <StyleFieldRow active={editingContext} overridden={isStyleOverridden('pupilOpacity')} onReset={() => resetStyleField('pupilOpacity')}>
              <Slider
                label="Pupil Opacity"
                value={colors.pupilOpacity}
                min={EYE_COLOR_RANGES.pupilOpacity[0]}
                max={EYE_COLOR_RANGES.pupilOpacity[1]}
                suffix="%"
                onCommitStart={checkpoint}
                onChange={(v) => setColor('pupilOpacity', v)}
              />
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
