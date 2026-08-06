import { useState } from 'react'
import { useStore } from '@/state/store'
import type { UiDataSource, UiDataSourceField, UiDataSourceFieldType, UiDataSourceKind } from '@/types'

const FIELD_TYPE_OPTIONS: UiDataSourceFieldType[] = ['string', 'int', 'double', 'bool']
const SOURCE_KIND_OPTIONS: UiDataSourceKind[] = [
  'static',
  'cppArray',
  'cppStructArray',
  'stdArray',
  'stdVector',
  'jsonObject',
  'jsonArray',
  'httpResponse',
  'mqttPayload',
  'sensorValue',
  'appVariable',
  'callbackFunction',
  'custom'
]
const SOURCE_KIND_LABELS: Record<UiDataSourceKind, string> = {
  static: 'Static sample data',
  cppArray: 'C++ array',
  cppStructArray: 'C++ struct array',
  stdArray: 'std::array',
  stdVector: 'std::vector',
  jsonObject: 'JSON object',
  jsonArray: 'JSON array',
  httpResponse: 'HTTP response',
  mqttPayload: 'MQTT payload',
  sensorValue: 'Sensor value',
  appVariable: 'Application variable',
  callbackFunction: 'Callback function',
  custom: 'Custom provider'
}

const SELECT_CLASS = 'bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs'
const INPUT_CLASS = 'bg-studio-panel2 border border-studio-border rounded px-1.5 py-0.5 text-xs font-mono w-full'

/** Derives the same struct-name preview lvglExport.ts's dataSourceStructName() computes at export
 * time (a simple trailing-'s' strip + "Item" suffix) — shown here so a "sourceKind is purely
 * descriptive" data source still gives the user a concrete sense of what C++ name it'll become. */
function structNamePreview(source: UiDataSource): string {
  if (source.structNameOverride) return source.structNameOverride
  const pascal = source.name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  const stripped = pascal.length > 1 && pascal.toLowerCase().endsWith('s') && !pascal.toLowerCase().endsWith('ss') ? pascal.slice(0, -1) : pascal
  return `${stripped || 'DataSource'}Item`
}

/** The Data Source Manager — reusable named data sources (a field schema + hand-authored sample
 * JSON, see UiDataSource's own doc comment for why this is a new sibling model to UiVariable, not
 * an extension of it). A Data List widget binds to one of these (see DataListSection in
 * PropertiesPanel.tsx); at export time the field list becomes a real C++ struct and the sample
 * data is used ONLY for design-time preview — see lib/export/lvglExport.ts's Data List codegen. */
export function DataSourceManagerPanel() {
  const dataSources = useStore((s) => s.project.uiDesign.dataSources)
  const addUiDataSource = useStore((s) => s.addUiDataSource)
  const updateUiDataSource = useStore((s) => s.updateUiDataSource)
  const deleteUiDataSource = useStore((s) => s.deleteUiDataSource)
  const duplicateUiDataSource = useStore((s) => s.duplicateUiDataSource)
  const addUiDataSourceField = useStore((s) => s.addUiDataSourceField)
  const updateUiDataSourceField = useStore((s) => s.updateUiDataSourceField)
  const deleteUiDataSourceField = useStore((s) => s.deleteUiDataSourceField)
  const reorderUiDataSourceField = useStore((s) => s.reorderUiDataSourceField)
  const checkpoint = useStore((s) => s.checkpoint)

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="studio-label">Data Sources</span>
        <button
          className="text-[11px] text-studio-accent hover:underline"
          onClick={() => {
            checkpoint()
            addUiDataSource()
          }}
        >
          + Add Data Source
        </button>
      </div>

      {dataSources.length === 0 && (
        <span className="text-[11px] text-studio-muted">
          No data sources yet — click "+ Add Data Source" to define a reusable field schema + sample data a Data List widget can bind to.
        </span>
      )}

      <div className="flex flex-col gap-1.5">
        {dataSources.map((source) => (
          <DataSourceRow
            key={source.id}
            source={source}
            onChange={(partial) => {
              checkpoint()
              updateUiDataSource(source.id, partial)
            }}
            onDuplicate={() => {
              checkpoint()
              duplicateUiDataSource(source.id)
            }}
            onDelete={() => {
              checkpoint()
              deleteUiDataSource(source.id)
            }}
            onAddField={() => {
              checkpoint()
              addUiDataSourceField(source.id)
            }}
            onUpdateField={(fieldId, partial) => {
              checkpoint()
              updateUiDataSourceField(source.id, fieldId, partial)
            }}
            onDeleteField={(fieldId) => {
              checkpoint()
              deleteUiDataSourceField(source.id, fieldId)
            }}
            onMoveField={(fromIndex, toIndex) => {
              checkpoint()
              reorderUiDataSourceField(source.id, fromIndex, toIndex)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function DataSourceRow({
  source,
  onChange,
  onDuplicate,
  onDelete,
  onAddField,
  onUpdateField,
  onDeleteField,
  onMoveField
}: {
  source: UiDataSource
  onChange: (partial: Partial<Omit<UiDataSource, 'id'>>) => void
  onDuplicate: () => void
  onDelete: () => void
  onAddField: () => void
  onUpdateField: (fieldId: string, partial: Partial<Omit<UiDataSourceField, 'id'>>) => void
  onDeleteField: (fieldId: string) => void
  onMoveField: (fromIndex: number, toIndex: number) => void
}) {
  const [sampleDraft, setSampleDraft] = useState(source.sampleData)
  const parseError = (() => {
    try {
      const parsed = JSON.parse(sampleDraft)
      return Array.isArray(parsed) ? null : 'Sample data must be a JSON array of objects.'
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON.'
    }
  })()

  return (
    <div className="studio-panel2 border border-studio-border rounded p-2 flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Name</span>
          <input
            className={INPUT_CLASS}
            defaultValue={source.name}
            key={source.name}
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
          <select className={SELECT_CLASS} value={source.sourceKind} onChange={(e) => onChange({ sourceKind: e.target.value as UiDataSourceKind })}>
            {SOURCE_KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-studio-muted">
          Generated struct: <code className="text-studio-text">{structNamePreview(source)}</code>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-studio-muted uppercase tracking-wide">Fields</span>
          <button className="text-[11px] text-studio-accent hover:underline" onClick={onAddField}>
            + Add Field
          </button>
        </div>
        {source.fields.length === 0 && <span className="text-[11px] text-studio-muted">No fields yet.</span>}
        {source.fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-1">
            <div className="flex flex-col">
              <button
                className="text-[9px] text-studio-muted hover:text-studio-text leading-none disabled:opacity-30"
                disabled={index === 0}
                onClick={() => onMoveField(index, index - 1)}
              >
                ▲
              </button>
              <button
                className="text-[9px] text-studio-muted hover:text-studio-text leading-none disabled:opacity-30"
                disabled={index === source.fields.length - 1}
                onClick={() => onMoveField(index, index + 1)}
              >
                ▼
              </button>
            </div>
            <input
              className={`${INPUT_CLASS} flex-1`}
              defaultValue={field.name}
              key={field.name}
              placeholder="field name"
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name) onUpdateField(field.id, { name })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
            <select className={SELECT_CLASS} value={field.type} onChange={(e) => onUpdateField(field.id, { type: e.target.value as UiDataSourceFieldType })}>
              {FIELD_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              className={`text-[10px] px-1 rounded ${source.keyFieldId === field.id ? 'bg-studio-accent text-white' : 'text-studio-muted hover:text-studio-text'}`}
              title="Use as key field"
              onClick={() => onChange({ keyFieldId: source.keyFieldId === field.id ? null : field.id })}
            >
              key
            </button>
            <button className="text-[11px] text-studio-muted hover:text-red-400" onClick={() => onDeleteField(field.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-studio-muted uppercase tracking-wide">Sample data (JSON array — design-time preview only, never exported)</span>
        <textarea
          className={`${INPUT_CLASS} h-24 resize-y`}
          value={sampleDraft}
          onChange={(e) => setSampleDraft(e.target.value)}
          onBlur={() => {
            if (!parseError) onChange({ sampleData: sampleDraft })
          }}
          spellCheck={false}
        />
        {parseError && <span className="text-[10px] text-red-400">{parseError}</span>}
      </div>

      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button className="text-[11px] text-studio-muted hover:text-studio-text" onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="text-[11px] text-studio-muted hover:text-red-400" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
