import { useStore } from '@/state/store'
import { Slider } from '@/components/ui/Slider'

const FIELDS: { key: keyof import('@/types').Personality; label: string }[] = [
  { key: 'blinkFrequency', label: 'Blink Frequency' },
  { key: 'curiosity', label: 'Curiosity' },
  { key: 'energy', label: 'Energy' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'sleepiness', label: 'Sleepiness' },
  { key: 'movementSpeed', label: 'Movement Speed' },
  { key: 'randomEyeDrift', label: 'Random Eye Drift' },
  { key: 'microMovement', label: 'Micro Movement' },
  { key: 'idleDelay', label: 'Idle Delay' }
]

export function PersonalityPanel() {
  const personality = useStore((s) => s.project.personality)
  const setPersonality = useStore((s) => s.setPersonality)
  const checkpoint = useStore((s) => s.checkpoint)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto h-full">
      <p className="text-xs text-studio-muted leading-relaxed">
        Drives the procedural <span className="text-studio-text">Idle</span> preview mode — random blinks, glances,
        pauses, and micro-movement. Switch to Idle mode to see it live.
      </p>
      <button
        className={`studio-btn-primary ${mode === 'idle' ? 'opacity-100' : ''}`}
        onClick={() => setMode(mode === 'idle' ? 'design' : 'idle')}
      >
        {mode === 'idle' ? 'Stop Idle Preview' : 'Preview Idle Behavior'}
      </button>
      <div className="flex flex-col gap-2.5">
        {FIELDS.map(({ key, label }) => (
          <Slider
            key={key}
            label={label}
            value={personality[key]}
            min={0}
            max={100}
            suffix="%"
            onCommitStart={checkpoint}
            onChange={(v) => setPersonality(key, v)}
          />
        ))}
      </div>
    </div>
  )
}
