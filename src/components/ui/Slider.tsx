interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onCommitStart?: () => void
  suffix?: string
}

export function Slider({ label, value, min, max, step = 1, onChange, onCommitStart, suffix = '' }: SliderProps) {
  return (
    <label className="flex flex-col gap-1 select-none">
      <span className="flex items-center justify-between">
        <span className="studio-label">{label}</span>
        <span className="text-xs font-mono text-studio-text/80">
          {Math.round(value * 100) / 100}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        className="studio-input-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onCommitStart}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
