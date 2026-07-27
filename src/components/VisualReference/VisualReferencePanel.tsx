import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/state/store'
import type { ApplyVisualReferenceOptions } from '@/state/store'
import { clampFps, DISPLAY_RANGES, EYE_COLOR_RANGES, EYE_PARAM_RANGES } from '@/types'
import type { DisplayShape } from '@/types'
import { Slider } from '@/components/ui/Slider'
import { ColorField } from '@/components/ui/ColorField'
import { renderFace } from '@/renderer/faceRenderer'
import { fitDisplayToBox } from '@/renderer/displayMask'
import { ReferenceImportPanel } from '@/components/Import/ReferenceImportPanel'
import { PanelTabs } from '@/components/ui/PanelTabs'

const PREVIEW_SIZE = 160

const DISPLAY_SHAPES: { value: DisplayShape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' }
]

// Top-level tabs mirror the right panel's Controls/Colors/Display tab names 1:1 — 'Personality'
// is the one exception, since none of its fields (blink frequency, curiosity, idle timing...)
// are eye appearance at all, shared or otherwise.
//
// 'Display' and the Controls 'Timing' sub-tab below edit project.display/project.timing
// directly (setDisplay/setTiming) rather than going through the style-override system: those
// are already single global values with no per-expression/animation copy to protect, so
// there's nothing to "apply" — editing them here IS editing them everywhere, same as editing
// them from the right-hand Display/Controls panels.
type VRTab = 'controls' | 'colors' | 'display' | 'apply' | 'import'

const VR_TABS: { value: VRTab; label: string }[] = [
  { value: 'controls', label: 'Controls' },
  { value: 'colors', label: 'Colors' },
  { value: 'display', label: 'Display' },
  { value: 'apply', label: 'Apply' },
  { value: 'import', label: 'Import Image' }
]

// Nested under the 'Controls' tab — same 4 labels as ControlsPanel's own sub-tabs, now with
// full field parity. Only width/height/radius, irisWidth/Height, pupilWidth/Height, highlight
// x/y/size, and eyelid curvature are style-eligible (tracked by styleOverrides, changed by
// Apply Visual Reference). The rest — distance, rotation, pupil x/y/rotation, eyelid coverage,
// eyelid tilt — are shown here too so you can shape the VR preview's full pose, but stay
// "Preview only": Apply Visual Reference never touches them on any expression or animation,
// exactly like the original spec requires (a blink must stay a blink, look-left must keep its
// pupil offset, angry must keep its tilt, surprised must keep its size).
type VRControlsTab = 'shape' | 'iris-pupil' | 'eyelids' | 'timing'

const VR_CONTROLS_TABS: { value: VRControlsTab; label: string }[] = [
  { value: 'shape', label: 'Shape' },
  { value: 'iris-pupil', label: 'Iris & Pupil' },
  { value: 'eyelids', label: 'Eyelids' },
  { value: 'timing', label: 'Timing' }
]

function PreviewOnlyNote() {
  return (
    <p className="text-[11px] text-studio-muted italic">
      Preview only — this is behavioral, not shared style, so "Apply Visual Reference" never changes it on any
      expression or animation.
    </p>
  )
}

// Nested under the 'Colors' tab — identical to ColorPanel's own sub-tabs; every EyeColors
// field is VR-eligible, so this has full parity with ColorPanel.
type VRColorsTab = 'colors' | 'effects'

const VR_COLORS_TABS: { value: VRColorsTab; label: string }[] = [
  { value: 'colors', label: 'Colors' },
  { value: 'effects', label: 'Effects' }
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

function RadioRow<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="studio-label">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`studio-tab text-xs px-2 py-1 ${value === opt.value ? 'studio-tab-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function VisualReferencePanel() {
  const project = useStore((s) => s.project)
  const setVisualReferenceParam = useStore((s) => s.setVisualReferenceParam)
  const setVisualReferenceColor = useStore((s) => s.setVisualReferenceColor)
  const applyVisualReference = useStore((s) => s.applyVisualReference)
  const checkpoint = useStore((s) => s.checkpoint)
  const referenceImportOpen = useStore((s) => s.referenceImportOpen)
  const setReferenceImportOpen = useStore((s) => s.setReferenceImportOpen)
  const setDisplay = useStore((s) => s.setDisplay)
  const toggleBezel = useStore((s) => s.toggleBezel)
  const setTiming = useStore((s) => s.setTiming)

  const vr = project.visualReference
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [tab, setTab] = useState<VRTab>('controls')
  const [controlsTab, setControlsTab] = useState<VRControlsTab>('shape')
  const [colorsTab, setColorsTab] = useState<VRColorsTab>('colors')
  const [scope, setScope] = useState<ApplyVisualReferenceOptions['scope']>('all')
  const [eyeTargetOpt, setEyeTargetOpt] = useState<ApplyVisualReferenceOptions['eyeTarget']>('both')
  const [overrideMode, setOverrideMode] = useState<ApplyVisualReferenceOptions['overrideMode']>('preserve')
  const [status, setStatus] = useState<string | null>(null)

  // Toolbar's "Import Reference..." button sets this one-shot signal (and switches the left
  // panel here) to jump straight to the Import Image tab; consume it immediately so it fires
  // again next time the button is clicked even if this tab is already open.
  useEffect(() => {
    if (referenceImportOpen) {
      setTab('import')
      setReferenceImportOpen(false)
    }
  }, [referenceImportOpen, setReferenceImportOpen])

  const previewFit = fitDisplayToBox(project.display, PREVIEW_SIZE)
  // The <canvas> itself is always a plain rectangle — applyDisplayMask's internal clip only
  // shapes what gets *drawn* inside it, not the element's own visible outline. The actual
  // on-screen circle/square/rounded look comes from CSS border-radius on the canvas element,
  // same trick PreviewCanvas.tsx and ReferenceImportPanel.tsx use, so it has to track
  // project.display.shape here too instead of a fixed Tailwind class.
  const previewBorderRadius = previewFit.shape === 'circle' ? '50%' : previewFit.shape === 'rounded' ? `${previewFit.cornerRadius}px` : '0px'

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
    renderFace(ctx, vr.params, { ...fitDisplayToBox(project.display, PREVIEW_SIZE), theme: vr.colors })
  }, [vr, project.display])

  const overrideCountInScope = (): number => {
    let count = 0
    if (scope === 'all' || scope === 'expressions') {
      count += project.expressions.reduce((sum, e) => sum + e.styleOverrides.length, 0)
    } else if (scope === 'selected') {
      const expr = project.expressions.find((e) => e.id === useStore.getState().selectedExpressionId)
      if (expr) count += expr.styleOverrides.length
    }
    if (scope === 'all' || scope === 'animations') {
      count += project.animations.reduce((sum, a) => sum + a.keyframes.reduce((s2, k) => s2 + k.styleOverrides.length, 0), 0)
    } else if (scope === 'selected') {
      const anim = project.animations.find((a) => a.id === useStore.getState().activeAnimationId)
      if (anim) count += anim.keyframes.reduce((sum, k) => sum + k.styleOverrides.length, 0)
    }
    return count
  }

  const handleApply = () => {
    if (overrideMode === 'replace') {
      const count = overrideCountInScope()
      const proceed = window.confirm(
        `Replace mode will clear ${count} custom style override${count === 1 ? '' : 's'} in the selected scope and reset ` +
          'every style field (colors, eye/pupil size, corner radius, eyelid curvature, highlight) to the Visual ' +
          'Reference. Movement, timing, keyframe positions, and other behavioral settings are never affected either way. ' +
          'This can be undone with Undo. Continue?'
      )
      if (!proceed) return
    }
    checkpoint()
    applyVisualReference({ scope, eyeTarget: eyeTargetOpt, overrideMode })
    setStatus('Visual Reference applied.')
    setTimeout(() => setStatus(null), 2500)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-4 p-3">
        <p className="text-xs text-studio-muted leading-relaxed">
          Design the project's single shared default appearance here. Applying it updates every expression and
          animation's matching fields, without touching their movement, timing, or emotion-specific customizations.
        </p>

        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            width={PREVIEW_SIZE}
            height={PREVIEW_SIZE}
            className="border border-studio-border bg-black"
            style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: previewBorderRadius }}
          />
        </div>
      </div>

      <PanelTabs tabs={VR_TABS} active={tab} onChange={setTab} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === 'controls' && (
          <div className="flex flex-col gap-4">
            <PanelTabs tabs={VR_CONTROLS_TABS} active={controlsTab} onChange={setControlsTab} />

            {controlsTab === 'shape' && (
              <div className="flex flex-col gap-5">
                <Section title="Eye Shape">
                  <Slider label="Eye Width" value={vr.params.width} min={EYE_PARAM_RANGES.width[0]} max={EYE_PARAM_RANGES.width[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('width', v)} />
                  <Slider label="Eye Height" value={vr.params.height} min={EYE_PARAM_RANGES.height[0]} max={EYE_PARAM_RANGES.height[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('height', v)} />
                  <Slider label="Eye Corner Radius" value={vr.params.radius} min={EYE_PARAM_RANGES.radius[0]} max={EYE_PARAM_RANGES.radius[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('radius', v)} />
                  <Slider label="Eye Distance" value={vr.params.distance} min={EYE_PARAM_RANGES.distance[0]} max={EYE_PARAM_RANGES.distance[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('distance', v)} />
                  <Slider label="Eye Rotation" value={vr.params.rotation} min={EYE_PARAM_RANGES.rotation[0]} max={EYE_PARAM_RANGES.rotation[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('rotation', v)} />
                  <PreviewOnlyNote />
                </Section>
              </div>
            )}

            {controlsTab === 'iris-pupil' && (
              <div className="flex flex-col gap-5">
                <Section title="Iris & Pupil">
                  <Slider label="Iris Width" value={vr.params.irisWidth} min={EYE_PARAM_RANGES.irisWidth[0]} max={EYE_PARAM_RANGES.irisWidth[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('irisWidth', v)} />
                  <Slider label="Iris Height" value={vr.params.irisHeight} min={EYE_PARAM_RANGES.irisHeight[0]} max={EYE_PARAM_RANGES.irisHeight[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('irisHeight', v)} />
                  <Slider label="Pupil Width" value={vr.params.pupilWidth} min={EYE_PARAM_RANGES.pupilWidth[0]} max={EYE_PARAM_RANGES.pupilWidth[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('pupilWidth', v)} />
                  <Slider label="Pupil Height" value={vr.params.pupilHeight} min={EYE_PARAM_RANGES.pupilHeight[0]} max={EYE_PARAM_RANGES.pupilHeight[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('pupilHeight', v)} />
                  <Slider label="Pupil X" value={vr.params.pupilX} min={EYE_PARAM_RANGES.pupilX[0]} max={EYE_PARAM_RANGES.pupilX[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('pupilX', v)} />
                  <Slider label="Pupil Y" value={vr.params.pupilY} min={EYE_PARAM_RANGES.pupilY[0]} max={EYE_PARAM_RANGES.pupilY[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('pupilY', v)} />
                  <Slider label="Pupil Rotation" value={vr.params.pupilRotation} min={EYE_PARAM_RANGES.pupilRotation[0]} max={EYE_PARAM_RANGES.pupilRotation[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('pupilRotation', v)} />
                  <PreviewOnlyNote />
                </Section>

                <Section title="Highlight">
                  <Slider label="Highlight Position X" value={vr.params.highlightX} min={EYE_PARAM_RANGES.highlightX[0]} max={EYE_PARAM_RANGES.highlightX[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('highlightX', v)} />
                  <Slider label="Highlight Position Y" value={vr.params.highlightY} min={EYE_PARAM_RANGES.highlightY[0]} max={EYE_PARAM_RANGES.highlightY[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('highlightY', v)} />
                  <Slider label="Highlight Size" value={vr.params.highlightSize} min={EYE_PARAM_RANGES.highlightSize[0]} max={EYE_PARAM_RANGES.highlightSize[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('highlightSize', v)} />
                </Section>
              </div>
            )}

            {controlsTab === 'eyelids' && (
              <Section title="Eyelids">
                <Slider label="Upper Eyelid" value={vr.params.upperEyelid} min={EYE_PARAM_RANGES.upperEyelid[0]} max={EYE_PARAM_RANGES.upperEyelid[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('upperEyelid', v)} />
                <Slider label="Lower Eyelid" value={vr.params.lowerEyelid} min={EYE_PARAM_RANGES.lowerEyelid[0]} max={EYE_PARAM_RANGES.lowerEyelid[1]} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('lowerEyelid', v)} />
                <Slider label="Upper Eyelid Tilt" value={vr.params.upperEyelidTilt} min={EYE_PARAM_RANGES.upperEyelidTilt[0]} max={EYE_PARAM_RANGES.upperEyelidTilt[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('upperEyelidTilt', v)} />
                <Slider label="Lower Eyelid Tilt" value={vr.params.lowerEyelidTilt} min={EYE_PARAM_RANGES.lowerEyelidTilt[0]} max={EYE_PARAM_RANGES.lowerEyelidTilt[1]} suffix="°" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceParam('lowerEyelidTilt', v)} />
                <PreviewOnlyNote />
                <Slider
                  label="Upper Eyelid Curvature"
                  value={vr.params.upperEyelidCurvature}
                  min={EYE_PARAM_RANGES.upperEyelidCurvature[0]}
                  max={EYE_PARAM_RANGES.upperEyelidCurvature[1]}
                  onCommitStart={checkpoint}
                  onChange={(v) => setVisualReferenceParam('upperEyelidCurvature', v)}
                />
                <Slider
                  label="Lower Eyelid Curvature"
                  value={vr.params.lowerEyelidCurvature}
                  min={EYE_PARAM_RANGES.lowerEyelidCurvature[0]}
                  max={EYE_PARAM_RANGES.lowerEyelidCurvature[1]}
                  onCommitStart={checkpoint}
                  onChange={(v) => setVisualReferenceParam('lowerEyelidCurvature', v)}
                />
                <p className="text-[11px] text-studio-muted">
                  Curvature above is shared style (applies everywhere) — coverage and tilt above are preview-only,
                  per the note above them.
                </p>
              </Section>
            )}

            {controlsTab === 'timing' && (
              <Section title="Timing">
                <Slider label="Animation Speed" value={project.timing.animationSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('animationSpeed', v)} />
                <Slider label="Blink Speed" value={project.timing.blinkSpeed} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('blinkSpeed', v)} />
                <Slider label="Breathing Amount" value={project.timing.breathingAmount} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => setTiming('breathingAmount', v)} />
                <p className="text-[11px] text-studio-muted italic">
                  Timing is already a single project-wide setting (not duplicated per expression/animation), so
                  editing it here is the same as editing it from the Controls panel.
                </p>
              </Section>
            )}
          </div>
        )}

        {tab === 'colors' && (
          <div className="flex flex-col gap-4">
            <PanelTabs tabs={VR_COLORS_TABS} active={colorsTab} onChange={setColorsTab} />

            {colorsTab === 'colors' && (
              <div className="flex flex-col gap-2.5">
                <ColorField label="Sclera (fill)" value={vr.colors.sclera} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('sclera', v)} />
                <ColorField label="Iris" value={vr.colors.iris} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('iris', v)} />
                <ColorField label="Pupil" value={vr.colors.pupil} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('pupil', v)} />
                <ColorField label="Highlight" value={vr.colors.highlight} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('highlight', v)} />
                <ColorField label="Shadow" value={vr.colors.shadow} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('shadow', v)} />
                <ColorField label="Glow" value={vr.colors.glow} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('glow', v)} />
                <ColorField label="Border" value={vr.colors.border} onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('border', v)} />
              </div>
            )}

            {colorsTab === 'effects' && (
              <div className="flex flex-col gap-2.5">
                <Slider label="Shadow Intensity" value={vr.colors.shadowIntensity} min={EYE_COLOR_RANGES.shadowIntensity[0]} max={EYE_COLOR_RANGES.shadowIntensity[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('shadowIntensity', v)} />
                <Slider label="Glow Intensity" value={vr.colors.glowIntensity} min={EYE_COLOR_RANGES.glowIntensity[0]} max={EYE_COLOR_RANGES.glowIntensity[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('glowIntensity', v)} />
                <Slider label="Border Opacity" value={vr.colors.borderOpacity} min={EYE_COLOR_RANGES.borderOpacity[0]} max={EYE_COLOR_RANGES.borderOpacity[1]} suffix="%" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('borderOpacity', v)} />
                <Slider label="Border Thickness" value={vr.colors.borderWidth} min={EYE_COLOR_RANGES.borderWidth[0]} max={EYE_COLOR_RANGES.borderWidth[1]} suffix="px" onCommitStart={checkpoint} onChange={(v) => setVisualReferenceColor('borderWidth', v)} />
              </div>
            )}
          </div>
        )}

        {tab === 'display' && (
          <div className="flex flex-col gap-5">
            <p className="text-[11px] text-studio-muted italic">
              The simulated display is already a single project-wide setting — editing it here is the same as
              editing it from the right-hand Display panel.
            </p>

            <div className="flex flex-col gap-2">
              <span className="studio-label">Shape</span>
              <div className="flex items-center bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
                {DISPLAY_SHAPES.map((s) => (
                  <button
                    key={s.value}
                    className={`studio-tab flex-1 ${project.display.shape === s.value ? 'studio-tab-active' : ''}`}
                    onClick={() => {
                      checkpoint()
                      setDisplay('shape', s.value)
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <Slider
                label="Display Width"
                value={project.display.width}
                min={DISPLAY_RANGES.width[0]}
                max={DISPLAY_RANGES.width[1]}
                suffix="px"
                onCommitStart={checkpoint}
                onChange={(v) => setDisplay('width', v)}
              />
              <Slider
                label="Display Height"
                value={project.display.height}
                min={DISPLAY_RANGES.height[0]}
                max={DISPLAY_RANGES.height[1]}
                suffix="px"
                onCommitStart={checkpoint}
                onChange={(v) => setDisplay('height', v)}
              />
              <button
                className="studio-btn self-start"
                onClick={() => {
                  checkpoint()
                  setDisplay('height', project.display.width)
                }}
              >
                Match Height to Width
              </button>
              {project.display.shape === 'rounded' && (
                <Slider
                  label="Corner Radius"
                  value={project.display.cornerRadius}
                  min={DISPLAY_RANGES.cornerRadius[0]}
                  max={DISPLAY_RANGES.cornerRadius[1]}
                  suffix="px"
                  onCommitStart={checkpoint}
                  onChange={(v) => setDisplay('cornerRadius', v)}
                />
              )}
              <Slider
                label="Display FPS"
                value={project.display.fps}
                min={DISPLAY_RANGES.fps[0]}
                max={DISPLAY_RANGES.fps[1]}
                suffix=" fps"
                onCommitStart={checkpoint}
                onChange={(v) => setDisplay('fps', clampFps(v))}
              />
            </div>

            <ColorField
              label="Background Color"
              value={project.display.backgroundColor}
              onCommitStart={checkpoint}
              onChange={(v) => setDisplay('backgroundColor', v)}
            />

            <label className="flex items-center justify-between">
              <span className="studio-label">Show Bezel</span>
              <input
                type="checkbox"
                className="w-4 h-4 accent-studio-accent"
                checked={project.display.showBezel}
                onChange={() => {
                  checkpoint()
                  toggleBezel()
                }}
              />
            </label>
          </div>
        )}

        {tab === 'apply' && (
          <div className="flex flex-col gap-2.5">
            <RadioRow
              label="Apply to"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'expressions', label: 'Expressions only' },
                { value: 'animations', label: 'Animations only' },
                { value: 'selected', label: 'Selected item' }
              ]}
            />
            <RadioRow
              label="Eyes"
              value={eyeTargetOpt}
              onChange={setEyeTargetOpt}
              options={[
                { value: 'both', label: 'Both eyes' },
                { value: 'left', label: 'Left eye only' },
                { value: 'right', label: 'Right eye only' }
              ]}
            />
            <p className="text-[11px] text-studio-muted -mt-1">Left/right only affects expressions — animation keyframes always share one pose.</p>
            <RadioRow
              label="Custom overrides"
              value={overrideMode}
              onChange={setOverrideMode}
              options={[
                { value: 'preserve', label: 'Preserve (recommended)' },
                { value: 'replace', label: 'Replace' }
              ]}
            />
            <button className="studio-btn-primary self-start" onClick={handleApply}>
              Apply Visual Reference
            </button>
            {status && <p className="text-xs text-green-400">{status}</p>}
          </div>
        )}

        {tab === 'import' && <ReferenceImportPanel />}
      </div>
    </div>
  )
}
