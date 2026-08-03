import { useStore } from '@/state/store'
import type { UiVariable, UiVariableScope, UiVariableType } from '@/types'

const TYPE_OPTIONS: UiVariableType[] = ['number', 'text', 'boolean', 'color', 'list', 'image', 'object']
const SCOPE_OPTIONS: UiVariableScope[] = ['global', 'screen', 'component', 'sensor', 'api', 'hardware']

function defaultValueForType(type: UiVariableType): string | number | boolean {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'color') return '#ffffff'
  return ''
}

function coerceDefault(type: UiVariableType, raw: string): string | number | boolean {
  if (type === 'number') return Number(raw) || 0
  if (type === 'boolean') return raw === 'true'
  return raw
}

const SELECT_CLASS = 'bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs'
const INPUT_CLASS = 'bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono w-full'

/** The Variable Manager — a central, no-code table of named data ("Temperature",
 * "Brightness", "Light Enabled", ...) that Events/Actions, Conditions, and Data Bindings can all
 * reference via `data.<name>` (see types/uiDesign.ts's UiVariable doc comment for why this is a
 * real persisted model rather than a script-text pattern like Events/Bindings). "Current value"
 * reflects the live script sandbox while it's running (see store.ts's runtimeVariableValues,
 * fed by sandboxRuntime.ts's `data` object) — otherwise it shows the default. */
export function VariableManagerPanel() {
  const variables = useStore((s) => s.project.uiDesign.variables)
  const runtimeValues = useStore((s) => s.runtimeVariableValues)
  const screens = useStore((s) => s.project.uiDesign.screens)
  const widgets = useStore((s) => s.project.uiDesign.widgets)
  const addUiVariable = useStore((s) => s.addUiVariable)
  const updateUiVariable = useStore((s) => s.updateUiVariable)
  const deleteUiVariable = useStore((s) => s.deleteUiVariable)
  const duplicateUiVariable = useStore((s) => s.duplicateUiVariable)
  const checkpoint = useStore((s) => s.checkpoint)

  const namedWidgets = Object.values(widgets).filter((w) => w.tagId)

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="studio-label">Variables</span>
        <button
          className="text-[11px] text-studio-accent hover:underline"
          onClick={() => {
            checkpoint()
            const n = variables.length + 1
            addUiVariable(`variable${n}`, 'number', 'global')
          }}
        >
          + Add Variable
        </button>
      </div>

      {variables.length === 0 && (
        <span className="text-[11px] text-studio-muted">
          No variables yet — click "+ Add Variable" to create named data that Events, Conditions, and Data Bindings can all reference as{' '}
          <code>data.&lt;name&gt;</code>.
        </span>
      )}

      <div className="flex flex-col gap-1.5">
        {variables.map((v) => (
          <VariableRow
            key={v.id}
            variable={v}
            currentValue={v.name in runtimeValues ? runtimeValues[v.name] : v.defaultValue}
            screens={screens}
            namedWidgets={namedWidgets}
            onChange={(partial) => {
              checkpoint()
              updateUiVariable(v.id, partial)
            }}
            onDuplicate={() => {
              checkpoint()
              duplicateUiVariable(v.id)
            }}
            onDelete={() => {
              checkpoint()
              deleteUiVariable(v.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function VariableRow({
  variable,
  currentValue,
  screens,
  namedWidgets,
  onChange,
  onDuplicate,
  onDelete
}: {
  variable: UiVariable
  currentValue: string | number | boolean
  screens: { id: string; name: string }[]
  namedWidgets: { id: string; tagId?: string }[]
  onChange: (partial: Partial<Omit<UiVariable, 'id'>>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div className="studio-panel2 border border-studio-border rounded p-2 flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Name</span>
          <input
            className={INPUT_CLASS}
            defaultValue={variable.name}
            key={variable.name}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name) onChange({ name })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Type</span>
          <select
            className={SELECT_CLASS}
            value={variable.type}
            onChange={(e) => {
              const type = e.target.value as UiVariableType
              onChange({ type, defaultValue: defaultValueForType(type) })
            }}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Scope</span>
          <select className={SELECT_CLASS} value={variable.scope} onChange={(e) => onChange({ scope: e.target.value as UiVariableScope })}>
            {SCOPE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(variable.scope === 'screen' || variable.scope === 'component') && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">{variable.scope === 'screen' ? 'Screen' : 'Component'}</span>
          {variable.scope === 'screen' ? (
            <select className={SELECT_CLASS} value={variable.screenId ?? ''} onChange={(e) => onChange({ screenId: e.target.value || undefined })}>
              <option value="">(none)</option>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <select className={SELECT_CLASS} value={variable.componentId ?? ''} onChange={(e) => onChange({ componentId: e.target.value || undefined })}>
              <option value="">(none)</option>
              {namedWidgets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.tagId}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Default value</span>
          {variable.type === 'boolean' ? (
            <select className={SELECT_CLASS} value={String(variable.defaultValue)} onChange={(e) => onChange({ defaultValue: e.target.value === 'true' })}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : variable.type === 'color' ? (
            <input type="color" className="w-full h-6 rounded border border-studio-border bg-transparent" value={String(variable.defaultValue || '#ffffff')} onChange={(e) => onChange({ defaultValue: e.target.value })} />
          ) : (
            <input
              className={INPUT_CLASS}
              defaultValue={String(variable.defaultValue)}
              key={String(variable.defaultValue)}
              onBlur={(e) => onChange({ defaultValue: coerceDefault(variable.type, e.target.value) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Current value</span>
          <span className="text-xs font-mono px-1.5 py-0.5 text-studio-text truncate" title={String(currentValue)}>
            {String(currentValue)}
          </span>
        </div>
      </div>

      {variable.type === 'number' && (
        <div className="grid grid-cols-3 gap-1.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-studio-muted uppercase tracking-wide">Min</span>
            <input
              className={INPUT_CLASS}
              defaultValue={variable.min ?? ''}
              key={variable.min}
              placeholder="none"
              onBlur={(e) => onChange({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-studio-muted uppercase tracking-wide">Max</span>
            <input
              className={INPUT_CLASS}
              defaultValue={variable.max ?? ''}
              key={variable.max}
              placeholder="none"
              onBlur={(e) => onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-studio-muted uppercase tracking-wide">Unit</span>
            <input className={INPUT_CLASS} defaultValue={variable.unit ?? ''} key={variable.unit} placeholder="e.g. °C" onBlur={(e) => onChange({ unit: e.target.value || undefined })} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Format (used by Data Bindings — "value" is replaced with the current value)</span>
        <input
          className={INPUT_CLASS}
          defaultValue={variable.format ?? ''}
          key={variable.format}
          placeholder={variable.unit ? `{value}${variable.unit}` : '{value}'}
          onBlur={(e) => onChange({ format: e.target.value || undefined })}
        />
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[10px] text-studio-muted">
          <code>data.{variable.name}</code>
        </span>
        <div className="flex items-center gap-2">
          <button className="text-[11px] text-studio-muted hover:text-studio-text" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="text-[11px] text-studio-muted hover:text-red-400" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
