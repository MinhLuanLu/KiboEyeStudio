import { useStore, getActiveAnimation } from '@/state/store'
import { estimateProjectSize, formatBytes } from '@/lib/export/sizeEstimate'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs font-mono">
      <span className="text-studio-muted">{label}</span>
      <span className="text-studio-text">{value}</span>
    </div>
  )
}

export function DevModePanel() {
  const devModeOpen = useStore((s) => s.devModeOpen)
  const devStats = useStore((s) => s.devStats)
  const eyeBase = useStore((s) => s.project.eyeBase)
  const project = useStore((s) => s.project)
  const anim = useStore(() => getActiveAnimation())

  if (!devModeOpen) return null

  const size = estimateProjectSize(project)

  return (
    <div className="absolute top-3 left-3 z-20 w-56 studio-panel p-3 flex flex-col gap-2 backdrop-blur-sm bg-studio-panel/90">
      <h4 className="studio-label">Developer Mode</h4>
      <Row label="Eye Width" value={eyeBase.width.toFixed(1)} />
      <Row label="Eye Height" value={eyeBase.height.toFixed(1)} />
      <Row label="Pupil X" value={eyeBase.pupilX.toFixed(1)} />
      <Row label="Pupil Y" value={eyeBase.pupilY.toFixed(1)} />
      <div className="h-px bg-studio-border my-0.5" />
      <Row label="Frame #" value={String(devStats.frame)} />
      <Row label="FPS" value={devStats.fps.toFixed(0)} />
      <Row label="Anim Time" value={`${devStats.timeMs.toFixed(0)} ms`} />
      <Row label="Active Anim" value={anim?.name ?? '—'} />
      <div className="h-px bg-studio-border my-0.5" />
      <Row label="Keyframes (project)" value={String(size.keyframeCount)} />
      <Row label="Stickers (all scopes)" value={String(size.stickerCount)} />
      <Row label="Est. Flash Usage" value={formatBytes(size.flashBytes)} />
      <Row label="Est. RAM Usage" value={formatBytes(size.ramBytes)} />
      {size.stickerWarnings.length > 0 && (
        <div className="flex flex-col gap-1 mt-1 pt-1.5 border-t border-studio-border">
          {size.stickerWarnings.map((w, i) => (
            <p key={i} className="text-[10px] leading-snug text-amber-400">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
