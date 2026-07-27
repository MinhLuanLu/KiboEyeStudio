import type { ReactNode } from 'react'

/** Shared presentational building blocks for User Guide content — kept tiny and dumb on
 * purpose so src/data/userGuideSections.tsx can stay focused on writing/prose rather than
 * markup, and so the guide's visual style stays consistent across every section without
 * each one hand-rolling its own Tailwind classes. */

export function GuideP({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-studio-text/90 mb-3">{children}</p>
}

export function GuideH3({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-studio-text mt-5 mb-2 first:mt-0">{children}</h3>
}

export function GuideUl({ children }: { children: ReactNode }) {
  return <ul className="list-disc list-outside pl-5 space-y-1.5 text-sm text-studio-text/90 mb-3">{children}</ul>
}

export function GuideOl({ children }: { children: ReactNode }) {
  return <ol className="list-decimal list-outside pl-5 space-y-1.5 text-sm text-studio-text/90 mb-3">{children}</ol>
}

/** A single labeled control reference row, e.g. "Eye Width — 20 to 130, default 78." Used
 * heavily in the Eye/Pupil/Eyelid Controls sections so every slider gets one consistent,
 * scannable line instead of prose. */
export function GuideControlRow({ name, range, children }: { name: string; range?: string; children: ReactNode }) {
  return (
    <div className="mb-2.5 text-sm">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-studio-text">{name}</span>
        {range && <span className="text-xs text-studio-muted font-mono">{range}</span>}
      </div>
      <div className="text-studio-text/80 leading-snug">{children}</div>
    </div>
  )
}

type CalloutTone = 'tip' | 'note' | 'warning'

const CALLOUT_STYLES: Record<CalloutTone, { label: string; classes: string }> = {
  tip: { label: 'Tip', classes: 'border-studio-accent/40 bg-studio-accent/10 text-studio-text' },
  note: { label: 'Note', classes: 'border-studio-border2 bg-studio-panel2 text-studio-text/90' },
  warning: { label: 'Watch out', classes: 'border-studio-warn/40 bg-studio-warn/10 text-studio-text' }
}

export function GuideCallout({ tone = 'note', children }: { tone?: CalloutTone; children: ReactNode }) {
  const style = CALLOUT_STYLES[tone]
  return (
    <div className={`border rounded-md px-3 py-2 text-sm mb-3 ${style.classes}`}>
      <span className="font-semibold mr-1.5">{style.label}:</span>
      {children}
    </div>
  )
}

/** A numbered "Try it" tutorial box — visually distinct from a plain <GuideOl> so the many
 * step-by-step walkthroughs the Animation Guide asks for don't blend into surrounding prose. */
export function GuideTutorial({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-studio-accent/30 rounded-lg overflow-hidden mb-4">
      <div className="bg-studio-accent/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-studio-accent">Try it: {title}</div>
      <div className="p-3 bg-studio-panel2/50">{children}</div>
    </div>
  )
}

export function GuideTable({ headers, rows }: { headers: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto mb-3 border border-studio-border rounded-md">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-studio-panel2">
            {headers.map((h, i) => (
              <th key={i} className="text-left font-semibold text-studio-muted uppercase text-xs tracking-wide px-3 py-2 border-b border-studio-border">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-studio-border last:border-b-0 odd:bg-transparent even:bg-studio-panel2/40">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A single key or key-combo badge, e.g. <KeyCap>Ctrl</KeyCap><span>+</span><KeyCap>S</KeyCap>.
 * KeyCombo below is the usual way to use it — this is exported separately only for the rare
 * single-key case (e.g. Space, Delete). */
export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded border border-studio-border2 bg-studio-panel2 text-xs font-mono text-studio-text shadow-sm">
      {children}
    </kbd>
  )
}

/** Renders a shortcut as platform-specific chips, e.g. keys=['Ctrl','S'] -> "Ctrl+S" on
 * Windows/Linux and "⌘S" on macOS, since the guide is expected to show both per the request. */
export function KeyCombo({ mac, winLinux }: { mac: string[]; winLinux: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-studio-muted w-16 shrink-0">Win/Linux</span>
        {winLinux.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-studio-muted text-xs">+</span>}
            <KeyCap>{k}</KeyCap>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-studio-muted w-16 shrink-0">macOS</span>
        {mac.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-studio-muted text-xs">+</span>}
            <KeyCap>{k}</KeyCap>
          </span>
        ))}
      </div>
    </div>
  )
}

export function GuideCode({ children }: { children: ReactNode }) {
  return (
    <pre className="bg-studio-bg border border-studio-border rounded-md p-3 text-xs font-mono overflow-x-auto mb-3 leading-relaxed text-studio-text/90">
      {children}
    </pre>
  )
}
