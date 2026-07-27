/** Small hand-authored SVG diagrams for the User Guide — there are no product screenshots to
 * draw on, so these illustrate the two concepts that are hardest to explain in prose alone
 * (timeline anatomy, and how the different easing curves actually shape motion). */

export function TimelineAnatomyDiagram() {
  return (
    <svg viewBox="0 0 640 160" className="w-full h-auto mb-3" role="img" aria-label="Diagram of a timeline showing keyframes, segments, and the playhead">
      <rect x="0" y="0" width="640" height="160" fill="#1c1c21" rx="8" />
      {/* track */}
      <line x1="40" y1="90" x2="600" y2="90" stroke="#3a3b42" strokeWidth="4" strokeLinecap="round" />
      {/* segments (alternating shade to show duration spans) */}
      <rect x="40" y="82" width="180" height="16" fill="#5b8cff" opacity="0.25" rx="4" />
      <rect x="220" y="82" width="120" height="16" fill="#5b8cff" opacity="0.12" rx="4" />
      <rect x="340" y="82" width="260" height="16" fill="#5b8cff" opacity="0.25" rx="4" />
      {/* keyframe diamonds */}
      {[40, 220, 340, 600].map((x, i) => (
        <g key={i} transform={`translate(${x},90)`}>
          <rect x="-8" y="-8" width="16" height="16" fill="#5b8cff" stroke="#e6e6ea" strokeWidth="1.5" transform="rotate(45)" />
        </g>
      ))}
      {/* playhead */}
      <line x1="260" y1="60" x2="260" y2="120" stroke="#ffb454" strokeWidth="2" />
      <polygon points="260,60 252,48 268,48" fill="#ffb454" />
      {/* labels */}
      <text x="40" y="130" fill="#8b8c96" fontSize="11" textAnchor="middle">Keyframe 1{'\n'}</text>
      <text x="40" y="130" fill="#8b8c96" fontSize="11" textAnchor="middle">0ms</text>
      <text x="220" y="130" fill="#8b8c96" fontSize="11" textAnchor="middle">Keyframe 2</text>
      <text x="340" y="130" fill="#8b8c96" fontSize="11" textAnchor="middle">Keyframe 3</text>
      <text x="600" y="130" fill="#8b8c96" fontSize="11" textAnchor="middle">Keyframe 4</text>
      <text x="260" y="40" fill="#ffb454" fontSize="11" textAnchor="middle">Playhead</text>
      <text x="130" y="70" fill="#5b8cff" fontSize="11" textAnchor="middle">Segment (duration + easing)</text>
      <text x="600" y="110" fill="#e6e6ea" fontSize="10" textAnchor="end">Total duration →</text>
    </svg>
  )
}

// t -> eased value, 0..1, mirroring src/engine/easing.ts's own math for accuracy — this
// diagram is meant to show real curve shapes, not artistic approximations of them.
function easeSample(kind: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bounce' | 'elastic', t: number): number {
  switch (kind) {
    case 'linear':
      return t
    case 'easeIn':
      return t * t * t
    case 'easeOut': {
      const u = 1 - t
      return 1 - u * u * u
    }
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'bounce': {
      const n1 = 7.5625,
        d1 = 2.75
      let x = t
      if (x < 1 / d1) return n1 * x * x
      if (x < 2 / d1) {
        x -= 1.5 / d1
        return n1 * x * x + 0.75
      }
      if (x < 2.5 / d1) {
        x -= 2.25 / d1
        return n1 * x * x + 0.9375
      }
      x -= 2.625 / d1
      return n1 * x * x + 0.984375
    }
    case 'elastic': {
      if (t <= 0 || t >= 1) return t
      const c4 = (2 * Math.PI) / 3
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
    }
  }
}

function curvePath(kind: Parameters<typeof easeSample>[0], w: number, h: number): string {
  const steps = 40
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const v = easeSample(kind, t)
    const x = t * w
    const y = h - v * h
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `
  }
  return d
}

const EASING_SWATCHES: { kind: Parameters<typeof easeSample>[0]; label: string; color: string }[] = [
  { kind: 'linear', label: 'Linear', color: '#8b8c96' },
  { kind: 'easeIn', label: 'Ease In', color: '#5b8cff' },
  { kind: 'easeOut', label: 'Ease Out', color: '#7c5cff' },
  { kind: 'easeInOut', label: 'Ease In Out', color: '#ffb454' },
  { kind: 'bounce', label: 'Bounce', color: '#ff5c5c' },
  { kind: 'elastic', label: 'Elastic', color: '#4ade80' }
]

export function EasingCurvesDiagram() {
  const w = 140
  const h = 90
  const pad = 10
  return (
    <svg viewBox="0 0 640 220" className="w-full h-auto mb-3" role="img" aria-label="Comparison of easing curve shapes">
      <rect x="0" y="0" width="640" height="220" fill="#1c1c21" rx="8" />
      {EASING_SWATCHES.map((s, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const ox = 20 + col * 210
        const oy = 15 + row * 110
        return (
          <g key={s.kind} transform={`translate(${ox},${oy})`}>
            <rect x={-pad} y={-pad} width={w + pad * 2} height={h + pad * 2} fill="#141417" rx="6" />
            <line x1="0" y1={h} x2={w} y2={h} stroke="#3a3b42" strokeWidth="1" />
            <line x1="0" y1="0" x2="0" y2={h} stroke="#3a3b42" strokeWidth="1" />
            <path d={curvePath(s.kind, w, h)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" />
            <text x={w / 2} y={h + 20} fill="#e6e6ea" fontSize="11" textAnchor="middle">
              {s.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
