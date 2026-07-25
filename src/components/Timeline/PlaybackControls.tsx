import { useStore, getActiveAnimation } from '@/state/store'

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
      <path d={path} />
    </svg>
  )
}

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  stop: 'M6 6h12v12H6z',
  restart: 'M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M16 6h2v12h-2zM6 6l8.5 6L6 18z',
  loop: 'M7 7h7a4 4 0 0 1 4 4v1h-2v-1a2 2 0 0 0-2-2H7v3l-4-4 4-4zm10 10H10a4 4 0 0 1-4-4v-1h2v1a2 2 0 0 0 2 2h7v-3l4 4-4 4z'
}

export function PlaybackControls() {
  const mode = useStore((s) => s.mode)
  const playbackState = useStore((s) => s.playbackState)
  const setMode = useStore((s) => s.setMode)
  const play = useStore((s) => s.play)
  const pause = useStore((s) => s.pause)
  const stop = useStore((s) => s.stop)
  const restart = useStore((s) => s.restart)
  const nextFrame = useStore((s) => s.nextFrame)
  const prevFrame = useStore((s) => s.prevFrame)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const anim = useStore(() => getActiveAnimation())

  const disabled = mode !== 'animate'

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center bg-studio-panel2 rounded-md p-0.5 mr-2 border border-studio-border">
        {(['design', 'animate', 'idle'] as const).map((m) => (
          <button
            key={m}
            className={`studio-tab capitalize ${mode === m ? 'studio-tab-active' : ''}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      <button className="studio-btn" title="Previous Frame" disabled={disabled} onClick={prevFrame}>
        <Icon path={ICONS.prev} />
      </button>
      {playbackState === 'playing' ? (
        <button className="studio-btn-primary" title="Pause" disabled={disabled} onClick={pause}>
          <Icon path={ICONS.pause} />
        </button>
      ) : (
        <button className="studio-btn-primary" title="Play" disabled={disabled} onClick={play}>
          <Icon path={ICONS.play} />
        </button>
      )}
      <button className="studio-btn" title="Stop" disabled={disabled} onClick={stop}>
        <Icon path={ICONS.stop} />
      </button>
      <button className="studio-btn" title="Restart" disabled={disabled} onClick={restart}>
        <Icon path={ICONS.restart} />
      </button>
      <button className="studio-btn" title="Next Frame" disabled={disabled} onClick={nextFrame}>
        <Icon path={ICONS.next} />
      </button>
      <button
        className={`studio-btn ${anim?.loop ? 'text-studio-accent border-studio-accent' : ''}`}
        title="Toggle Loop"
        disabled={disabled || !anim}
        onClick={toggleLoop}
      >
        <Icon path={ICONS.loop} />
      </button>
    </div>
  )
}
