import { parseScript } from './parser'
import { checkRestrictedSubset } from './restrictedSubset'
import { generateScriptCpp, type CodegenContext } from './codegen'
import type { ScriptError } from './parser'

// Structurally identical to lib/export/validateLvglExport.ts's LvglValidationResult — kept as
// its own local type rather than imported from there, since that file imports validateScript()
// FROM this module; importing the type back would be a needless circular import for something
// this small. validateLvglExport.ts concatenates this module's rows onto its own array (both
// shapes match by structure), so there's exactly one validation panel, not a second one.
export type ScriptValidationStatus = 'passed' | 'warning' | 'failed'
export interface ScriptValidationResult {
  category: string
  status: ScriptValidationStatus
  messages: string[]
}

function errLine(e: ScriptError): string {
  return `Line ${e.line}: ${e.message}${e.suggestion ? ` (${e.suggestion})` : ''}`
}

function bucketFor(e: ScriptError): 'events' | 'timers' | 'screens' | 'animations' | 'other' {
  const m = e.message.toLowerCase()
  if (m.includes('.on(') || m.includes('widget refers to') || m.includes('doesn’t apply to') || m.includes("doesn't apply to")) return 'events'
  if (m.includes('timer') || m.includes('setinterval') || m.includes('settimeout') || m.includes('clearinterval')) return 'timers'
  if (m.includes('showscreen') || m.includes('goback') || m.includes('screen named')) return 'screens'
  if (m.includes('animate')) return 'animations'
  return 'other'
}

/** Runs parse + the restricted-subset syntax check + a full codegen dry-run (codegen surfaces
 * its own semantic errors — unresolved widget references, non-literal color/asset arguments,
 * unsupported method names — beyond what pure syntax validation can catch), producing one row
 * per category the spec's own "Supported Script Validation" section asks for. Every problem
 * found anywhere in this pipeline ends up in some row's messages — never silently dropped. */
export function validateScript(script: string, ctx: CodegenContext): ScriptValidationResult[] {
  if (!script.trim()) {
    return [{ category: 'Script', status: 'passed', messages: ['No script authored yet — every widget behaves with its default LVGL behavior only.'] }]
  }

  const parsed = parseScript(script)
  if (!parsed.program) {
    return [
      {
        category: 'Script syntax',
        status: 'failed',
        messages: parsed.errors.map(errLine)
      }
    ]
  }

  const subset = checkRestrictedSubset(parsed.program)
  const codegen = generateScriptCpp(parsed.program, script, ctx)
  const allErrors = [...subset.errors, ...codegen.errors]

  const results: ScriptValidationResult[] = []

  const other = allErrors.filter((e) => bucketFor(e) === 'other')
  results.push({
    category: 'Unsupported JavaScript API',
    status: other.length > 0 ? 'failed' : 'passed',
    messages: other.length > 0 ? other.map(errLine) : ['Every construct in this script is supported for LVGL export.']
  })

  const eventErrors = allErrors.filter((e) => bucketFor(e) === 'events')
  results.push({
    category: 'Widget events',
    status: eventErrors.length > 0 ? 'failed' : 'passed',
    messages: eventErrors.length > 0 ? eventErrors.map(errLine) : [`${codegen.eventHandlers.length} event handler(s) will be generated.`]
  })

  const timerErrors = allErrors.filter((e) => bucketFor(e) === 'timers')
  results.push({
    category: 'Timers',
    status: timerErrors.length > 0 ? 'failed' : 'passed',
    messages: timerErrors.length > 0 ? timerErrors.map(errLine) : [`${codegen.timers.length} timer(s) will be generated (lv_timer_create/lv_timer_del).`]
  })

  const screenErrors = allErrors.filter((e) => bucketFor(e) === 'screens')
  results.push({
    category: 'Screen navigation',
    status: screenErrors.length > 0 ? 'failed' : 'passed',
    messages: screenErrors.length > 0 ? screenErrors.map(errLine) : ['Screen navigation calls resolve to real screens.']
  })

  const animErrors = allErrors.filter((e) => bucketFor(e) === 'animations')
  results.push({
    category: 'Animations',
    status: animErrors.length > 0 ? 'failed' : 'passed',
    messages: animErrors.length > 0 ? animErrors.map(errLine) : ['Animation calls are supported for export.']
  })

  results.push({
    category: 'Variables',
    status: 'passed',
    messages: [`${codegen.variables.length} variable(s) exported as static C++ variables.`]
  })

  results.push({
    category: 'Hardware bindings',
    status: codegen.hardwareStubs.length > 0 ? 'warning' : 'passed',
    messages:
      codegen.hardwareStubs.length > 0
        ? [`${codegen.hardwareStubs.length} hardware handler(s) will export as named stub functions you must wire to your own GPIO/sensor/radio code — see the generated TODO comments.`]
        : ['No hardware event handlers used.']
  })

  return results
}
