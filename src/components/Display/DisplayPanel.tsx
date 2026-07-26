import { useStore } from '@/state/store'
import { clampFps, DISPLAY_RANGES } from '@/types'
import type { DisplayShape } from '@/types'
import { Slider } from '@/components/ui/Slider'
import { ColorField } from '@/components/ui/ColorField'

const SHAPES: { value: DisplayShape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' }
]

export function DisplayPanel() {
  const display = useStore((s) => s.project.display)
  const setDisplay = useStore((s) => s.setDisplay)
  const toggleBezel = useStore((s) => s.toggleBezel)
  const checkpoint = useStore((s) => s.checkpoint)

  return (
    <div className="flex flex-col gap-5 p-3 overflow-y-auto h-full">
      <p className="text-xs text-studio-muted leading-relaxed">
        Match your physical panel — shape, resolution, and background color of the simulated
        display. GC9A01 is 240×240 round; change these if you're targeting a different screen.
      </p>

      <div className="flex flex-col gap-2">
        <span className="studio-label">Shape</span>
        <div className="flex items-center bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
          {SHAPES.map((s) => (
            <button
              key={s.value}
              className={`studio-tab flex-1 ${display.shape === s.value ? 'studio-tab-active' : ''}`}
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
          value={display.width}
          min={DISPLAY_RANGES.width[0]}
          max={DISPLAY_RANGES.width[1]}
          suffix="px"
          onCommitStart={checkpoint}
          onChange={(v) => setDisplay('width', v)}
        />
        <Slider
          label="Display Height"
          value={display.height}
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
            setDisplay('height', display.width)
          }}
        >
          Match Height to Width
        </button>
        {display.shape === 'rounded' && (
          <Slider
            label="Corner Radius"
            value={display.cornerRadius}
            min={DISPLAY_RANGES.cornerRadius[0]}
            max={DISPLAY_RANGES.cornerRadius[1]}
            suffix="px"
            onCommitStart={checkpoint}
            onChange={(v) => setDisplay('cornerRadius', v)}
          />
        )}
        <Slider
          label="Display FPS"
          value={display.fps}
          min={DISPLAY_RANGES.fps[0]}
          max={DISPLAY_RANGES.fps[1]}
          suffix=" fps"
          onCommitStart={checkpoint}
          onChange={(v) => setDisplay('fps', clampFps(v))}
        />
      </div>

      <ColorField
        label="Background Color"
        value={display.backgroundColor}
        onCommitStart={checkpoint}
        onChange={(v) => setDisplay('backgroundColor', v)}
      />

      <label className="flex items-center justify-between">
        <span className="studio-label">Show Bezel</span>
        <input
          type="checkbox"
          className="w-4 h-4 accent-studio-accent"
          checked={display.showBezel}
          onChange={() => {
            checkpoint()
            toggleBezel()
          }}
        />
      </label>
    </div>
  )
}
