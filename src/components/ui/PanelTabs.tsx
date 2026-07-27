// Shared internal sub-tab row for editor panels (Visual Reference, Controls, Colors, Display,
// Personality) — same studio-tab/studio-tab-active styling as the top-level Animations/
// Expressions/Visual Reference and Controls/Colors/Display/Personality tab bars, so every
// level of navigation in the app looks and behaves the same way.
export function PanelTabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: { value: T; label: string }[]
  active: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex border-b border-studio-border">
      {tabs.map((t) => (
        <button
          key={t.value}
          className={`studio-tab flex-1 ${active === t.value ? 'studio-tab-active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
