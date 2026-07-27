import { useStore } from '@/state/store'
import type { StickerAnimSettings, StickerInstance, StickerLayer, StickerLoopMode } from '@/types'
import { Slider } from '@/components/ui/Slider'
import { ColorField } from '@/components/ui/ColorField'

const LAYERS: { value: StickerLayer; label: string }[] = [
  { value: 'behind', label: 'Behind' },
  { value: 'front', label: 'Front' }
]

const LOOP_MODES: { value: StickerLoopMode; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'loop', label: 'Loop' },
  { value: 'pingpong', label: 'Ping-Pong' }
]

function SegmentedPicker<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center bg-studio-panel2 rounded-md p-0.5 border border-studio-border">
      {options.map((o) => (
        <button
          key={o.value}
          className={`studio-tab flex-1 ${value === o.value ? 'studio-tab-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Transform + animation controls for one selected sticker. Every field routes through
 * updateSticker() — the same single dispatch path canvas-drag (PreviewCanvas.tsx) and these
 * sliders both use for x/y, so there's one source of truth for "how a sticker's position
 * changes," not two. */
export function StickerControls({ sticker }: { sticker: StickerInstance }) {
  const updateSticker = useStore((s) => s.updateSticker)
  const checkpoint = useStore((s) => s.checkpoint)

  const set = <K extends keyof StickerInstance>(key: K, value: StickerInstance[K]) => updateSticker(sticker.id, { [key]: value } as Partial<StickerInstance>)
  const setAnim = <K extends keyof StickerAnimSettings>(key: K, value: StickerAnimSettings[K]) =>
    updateSticker(sticker.id, { anim: { ...sticker.anim, [key]: value } })

  return (
    <div className="flex flex-col gap-4 p-3 border-t border-studio-border">
      <div className="flex flex-col gap-2">
        <span className="studio-label">Layer</span>
        <SegmentedPicker value={sticker.layer} options={LAYERS} onChange={(v) => { checkpoint(); set('layer', v) }} />
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="studio-label">Transform</span>
        <Slider label="X" value={sticker.x} min={-160} max={160} onCommitStart={checkpoint} onChange={(v) => set('x', v)} />
        <Slider label="Y" value={sticker.y} min={-160} max={160} onCommitStart={checkpoint} onChange={(v) => set('y', v)} />
        <Slider label="Width" value={sticker.width} min={4} max={240} onCommitStart={checkpoint} onChange={(v) => set('width', v)} />
        <Slider label="Height" value={sticker.height} min={4} max={240} onCommitStart={checkpoint} onChange={(v) => set('height', v)} />
        <Slider label="Scale" value={sticker.scale} min={10} max={300} suffix="%" onCommitStart={checkpoint} onChange={(v) => set('scale', v)} />
        <Slider label="Rotation" value={sticker.rotation} min={-180} max={180} suffix="°" onCommitStart={checkpoint} onChange={(v) => set('rotation', v)} />
        <Slider label="Opacity" value={sticker.opacity} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => set('opacity', v)} />
        <div className="flex items-center justify-between">
          <span className="studio-label">Tint</span>
          <div className="flex items-center gap-2">
            {sticker.tint && (
              <button className="text-xs text-studio-muted hover:text-studio-text" onClick={() => { checkpoint(); set('tint', null) }}>
                Clear
              </button>
            )}
            <ColorField label="" value={sticker.tint ?? '#ffffff'} onCommitStart={checkpoint} onChange={(v) => set('tint', v)} />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className={`studio-btn flex-1 text-xs ${sticker.flipH ? 'studio-tab-active' : ''}`}
            onClick={() => { checkpoint(); set('flipH', !sticker.flipH) }}
          >
            Flip H
          </button>
          <button
            className={`studio-btn flex-1 text-xs ${sticker.flipV ? 'studio-tab-active' : ''}`}
            onClick={() => { checkpoint(); set('flipV', !sticker.flipV) }}
          >
            Flip V
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="studio-label">Animation</span>
        <div className="flex flex-col gap-2">
          <span className="studio-label text-[10px]">Loop Mode</span>
          <SegmentedPicker value={sticker.anim.loopMode} options={LOOP_MODES} onChange={(v) => { checkpoint(); setAnim('loopMode', v) }} />
        </div>
        <button
          className={`studio-btn text-xs self-start ${sticker.anim.reverse ? 'studio-tab-active' : ''}`}
          onClick={() => { checkpoint(); setAnim('reverse', !sticker.anim.reverse) }}
        >
          Reverse Playback
        </button>
        <Slider label="Speed" value={sticker.anim.speed} min={10} max={400} suffix="%" onCommitStart={checkpoint} onChange={(v) => setAnim('speed', v)} />
        <Slider
          label="FPS Override"
          value={sticker.anim.fps ?? 0}
          min={0}
          max={60}
          suffix={sticker.anim.fps ? '' : ' (natural)'}
          onCommitStart={checkpoint}
          onChange={(v) => setAnim('fps', v === 0 ? null : v)}
        />
        <Slider label="Start Delay" value={sticker.anim.startDelayMs} min={0} max={5000} step={50} suffix="ms" onCommitStart={checkpoint} onChange={(v) => setAnim('startDelayMs', v)} />
        <Slider label="Fade In" value={sticker.anim.fadeInMs} min={0} max={3000} step={50} suffix="ms" onCommitStart={checkpoint} onChange={(v) => setAnim('fadeInMs', v)} />
        <Slider label="Fade Out" value={sticker.anim.fadeOutMs} min={0} max={3000} step={50} suffix="ms" onCommitStart={checkpoint} onChange={(v) => setAnim('fadeOutMs', v)} />
        <Slider label="Start Time" value={sticker.anim.startTimeMs} min={0} max={10000} step={50} suffix="ms" onCommitStart={checkpoint} onChange={(v) => setAnim('startTimeMs', v)} />
        <Slider
          label="End Time"
          value={sticker.anim.endTimeMs ?? 0}
          min={0}
          max={20000}
          step={50}
          suffix={sticker.anim.endTimeMs != null ? 'ms' : ' (never)'}
          onCommitStart={checkpoint}
          onChange={(v) => setAnim('endTimeMs', v === 0 ? null : v)}
        />
        <Slider label="Drift X" value={sticker.anim.driftX} min={-100} max={100} suffix="px/s" onCommitStart={checkpoint} onChange={(v) => setAnim('driftX', v)} />
        <Slider label="Drift Y" value={sticker.anim.driftY} min={-100} max={100} suffix="px/s" onCommitStart={checkpoint} onChange={(v) => setAnim('driftY', v)} />
        <Slider label="Spin" value={sticker.anim.spin} min={-360} max={360} suffix="°/s" onCommitStart={checkpoint} onChange={(v) => setAnim('spin', v)} />
        <Slider label="Pulse Scale" value={sticker.anim.pulseScale} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => setAnim('pulseScale', v)} />
        <Slider label="Pulse Opacity" value={sticker.anim.pulseOpacity} min={0} max={100} suffix="%" onCommitStart={checkpoint} onChange={(v) => setAnim('pulseOpacity', v)} />
      </div>
    </div>
  )
}
