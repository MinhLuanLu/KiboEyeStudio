/**
 * Screen-Only export ISOLATION guard (regression test for the symbol-collision fix).
 *
 * Run with: npx tsx scripts/verifyScreenOnlyIsolation.ts   (or: npm run verify:screen-only)
 *
 * A "UI Screen Only" export must behave like an independent module: it must NEVER reuse a generic
 * internal name from the Complete Project exporter, nor from another Screen-Only export. This script
 * builds a project with two screens (both containing a widget with the SAME id/name, to force the
 * worst case), exports:
 *    - one Complete Project export (ui.h / ui.cpp),
 *    - "wifi_screen" as Screen Only,
 *    - "settings_screen" as Screen Only,
 * and asserts that all three headers can be #include'd into ONE translation unit with zero
 * redefinition / conflicting-declaration / duplicate-symbol errors. It approximates a C++ single-TU
 * compile by collecting every file-scope symbol DEFINITION each header exposes globally, and
 * flags any name defined by more than one of them (or any known-generic name leaking out of a
 * Screen-Only header).
 */
import { useStore } from '../src/state/store'
import { generateUiScreenExport, generateLvglExport, screenSymbolPrefix } from '../src/lib/export/lvglExport'
import { KIBO_PROJECT_PRESET } from '../src/lib/export/exportTarget'

function fail(msg: string): never {
  console.error('FAIL: ' + msg)
  process.exit(1)
}
function ok(msg: string) {
  console.log('ok: ' + msg)
}

// ---- Build a 2-screen project; both screens get a focusable, event-enabled button tagged
// "saveBtn" so widget-var / event-callback / builder names would collide if not isolated. ----
// Populate a screen root with a diverse, identically-named widget set so as many emit paths as
// possible (event callbacks, focus helpers, LED runtime helpers, named builders, per-widget vars)
// are exercised AND forced to overlap between the two screens if anything isn't screen-isolated.
function populate(rootId: string) {
  const s = useStore.getState()
  const btn = s.addUiWidget('button', rootId, 10, 10)
  const sw = s.addUiWidget('switch', rootId, 10, 40)
  const sld = s.addUiWidget('slider', rootId, 10, 70)
  const led = s.addUiWidget('led', rootId, 10, 100)
  useStore.getState().updateUiWidgetMeta(btn, { tagId: 'saveBtn', eventCallbackEnabled: true })
  useStore.getState().updateUiWidgetMeta(sw, { tagId: 'wifiToggle', eventCallbackEnabled: true })
  useStore.getState().updateUiWidgetMeta(sld, { tagId: 'level' })
  useStore.getState().updateUiWidgetMeta(led, { tagId: 'statusLed' })
}

const st = useStore.getState()
populate(st.project.uiDesign.screens[0].rootWidgetId)
const screen2Id = useStore.getState().addUiScreen('Settings Screen')
const root2 = useStore.getState().project.uiDesign.screens.find((s) => s.id === screen2Id)!.rootWidgetId
populate(root2)

const project = useStore.getState().project
const wifiScreenId = project.uiDesign.screens[0].id

const complete = await generateLvglExport(project, KIBO_PROJECT_PRESET)
const wifiFiles = (await generateUiScreenExport(project, wifiScreenId, 'wifi_screen')).files
const setFiles = (await generateUiScreenExport(project, screen2Id, 'settings_screen')).files

const uiH = complete.find((f) => f.name === 'ui.h')!.content
const uiCpp = complete.find((f) => f.name === 'ui.cpp')!.content
const wifiH = wifiFiles.find((f) => f.name.endsWith('_screen.h') && !f.name.includes('assets'))!.content
const setH = setFiles.find((f) => f.name.endsWith('_screen.h') && !f.name.includes('assets'))!.content

// ---- Collect the file-scope symbols each header exposes at GLOBAL scope (i.e. NOT inside a
// `namespace`). A single-TU compile fails if two included headers each globally define the same
// name. Lines inside a `namespace { ... }` block are private and excluded (brace-depth tracked). ----
function globalDefs(code: string): Set<string> {
  const names = new Set<string>()
  let depth = 0
  for (const rawLn of code.split('\n')) {
    const ln = rawLn.trim()
    const nsOpen = ln.match(/^namespace\s+\w+\s*\{/)
    if (nsOpen) {
      depth++
      continue
    }
    if (depth > 0) {
      // track nested braces so we know when the namespace closes
      depth += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length
      if (depth < 0) depth = 0
      continue
    }
    // At global scope (depth 0). Record symbol-defining forms that would ODR-clash across headers.
    let m = rawLn.match(/^inline\s+[\w:<>*&\s]*?([A-Za-z_]\w*)\s*[({=;]/)
    if (m) names.add(m[1])
    m = rawLn.match(/^#define\s+([A-Z0-9_]+)/)
    if (m) names.add('#define ' + m[1])
    m = rawLn.match(/^using\s+[\w:]*::(\w+)\s*;/)
    if (m) names.add(m[1]) // a `using` at global scope also introduces the name globally
  }
  return names
}

const wifiG = globalDefs(wifiH)
const setG = globalDefs(setH)
const prefixW = screenSymbolPrefix('wifi_screen')
const prefixS = screenSymbolPrefix('settings_screen')

// 1. No generic internal name leaks out of a Screen-Only header at global scope.
const GENERIC = ['Project_Register', 's_widgetIds', 's_widgetObjs', 's_widgetCount', 'clearFocus', 'Ui_InitStyles', 'saveBtn_obj', 'saveBtn_event_cb', 'CreateSaveBtnButton']
for (const [name, g] of [['wifi_screen.h', wifiG], ['settings_screen.h', setG]] as const) {
  const leaked = GENERIC.filter((x) => g.has(x))
  if (leaked.length) fail(`${name} exposes generic internal name(s) at global scope: ${leaked.join(', ')}`)
}
ok('no generic internal names leak out of either Screen-Only header')

// 2. Every global symbol a Screen-Only header DOES expose is prefixed with THAT screen's own name.
for (const [name, g, pfx] of [['wifi_screen.h', wifiG, prefixW], ['settings_screen.h', setG, prefixS]] as const) {
  const bad = [...g].filter((n) => !n.startsWith('#define') && !n.startsWith(pfx) && !n.startsWith(pfx.replace(/_screen$/, '')) && !/^[A-Z]/.test(n))
  // Allow the back-compat `using` names (create_<snake>_screen / show_<snake>_screen / find_..._widget / <snake>_focus_group)
  const stillBad = bad.filter((n) => !n.includes('_screen') && !n.endsWith('_focus_group') && !n.startsWith('create_') && !n.startsWith('show_') && !n.startsWith('find_'))
  if (stillBad.length) fail(`${name} exposes non-screen-scoped global symbol(s): ${stillBad.join(', ')}`)
}
ok('every global symbol in each Screen-Only header is screen-prefixed')

// 3. The two Screen-Only headers share NO global symbol (screen+screen coexistence).
const sharedScreens = [...wifiG].filter((n) => setG.has(n) && !n.startsWith('#define'))
if (sharedScreens.length) fail(`wifi_screen.h and settings_screen.h both define: ${sharedScreens.join(', ')}`)
ok('the two Screen-Only headers define no common global symbol')

// 4. Neither Screen-Only header redefines anything ui.h defines globally, nor anything ui.cpp
//    defines as a file-scope static (the exact clash from the bug report: static s_widgetIds in
//    ui.cpp vs inline s_widgetIds in a screen header, when the header is #include'd into ui.cpp).
const uiHG = globalDefs(uiH)
const uiCppStatics = new Set(
  uiCpp
    .split('\n')
    .map((l) => l.match(/^static\s+[\w:<>*&\s]*?([A-Za-z_]\w*)\s*[({=;[]/))
    .filter(Boolean)
    .map((m) => (m as RegExpMatchArray)[1])
)
for (const [name, g] of [['wifi_screen.h', wifiG], ['settings_screen.h', setG]] as const) {
  const vsUiH = [...g].filter((n) => !n.startsWith('#define') && uiHG.has(n))
  if (vsUiH.length) fail(`${name} redefines symbol(s) already global in ui.h: ${vsUiH.join(', ')}`)
  const vsCpp = [...g].filter((n) => !n.startsWith('#define') && uiCppStatics.has(n))
  if (vsCpp.length) fail(`${name} collides with ui.cpp file-scope static(s): ${vsCpp.join(', ')}`)
}
ok('neither Screen-Only header collides with ui.h globals or ui.cpp statics')

// 5. Each screen keeps its own private internal namespace, and they differ.
if (!wifiH.includes(`namespace ${prefixW}_internal {`)) fail('wifi_screen.h is missing its internal namespace')
if (!setH.includes(`namespace ${prefixS}_internal {`)) fail('settings_screen.h is missing its internal namespace')
if (prefixW === prefixS) fail('two different screens produced the same symbol prefix')
ok(`internal namespaces present and distinct: ${prefixW}_internal / ${prefixS}_internal`)

// 6. The readable, screen-prefixed public API is present (item 3 + item 7).
for (const [name, code, pfx] of [['wifi_screen.h', wifiH, prefixW], ['settings_screen.h', setH, prefixS]] as const) {
  for (const api of [`${pfx}_create(`, `${pfx}_show(`, `${pfx}_Register(`, `${pfx}_find_widget(`, `${pfx}_focus_next(`, `${pfx}_focus_previous(`, `${pfx}_press(`, `${pfx}_clear_focus(`]) {
    if (!code.includes(api)) fail(`${name} is missing public API ${api})`)
  }
}
ok('both headers expose the full screen-prefixed public API (create/show/Register/find_widget/focus_next/focus_previous/press/clear_focus)')

console.log('\nSCREEN-ONLY ISOLATION VERIFIED — Complete Project + wifi_screen + settings_screen coexist with no symbol conflicts.')
