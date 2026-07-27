import { useState } from 'react'
import { useStore } from '@/state/store'
import { Slider } from '@/components/ui/Slider'
import { PanelTabs } from '@/components/ui/PanelTabs'

type PersonalityTab = 'behavior' | 'movement'

const PERSONALITY_TABS: { value: PersonalityTab; label: string }[] = [
  { value: 'behavior', label: 'Behavior' },
  { value: 'movement', label: 'Movement' }
]

const BEHAVIOR_FIELDS: { key: keyof import('@/types').Personality; label: string }[] = [
  { key: 'blinkFrequency', label: 'Blink Frequency' },
  { key: 'curiosity', label: 'Curiosity' },
  { key: 'energy', label: 'Energy' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'sleepiness', label: 'Sleepiness' }
]

const MOVEMENT_FIELDS: { key: keyof import('@/types').Personality; label: string }[] = [
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

  const [tab, setTab] = useState<PersonalityTab>('behavior')
  const fields = tab === 'behavior' ? BEHAVIOR_FIELDS : MOVEMENT_FIELDS

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-col gap-3 p-3">
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
      </div>

      <PanelTabs tabs={PERSONALITY_TABS} active={tab} onChange={setTab} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="flex flex-col gap-2.5">
          {fields.map(({ key, label }) => (
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
    </div>
  )
}
