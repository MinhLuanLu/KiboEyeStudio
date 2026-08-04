// Turns a user's free-form Project Name into safe C++ identifiers and filenames — the one
// place both LVGL export (lvglExport.ts) and the export dialog's live name-preview (B5) derive
// the exported namespace/macro-prefix/ZIP-filename/folder-name/.ino-filename from, so they can
// never disagree. See the "Project naming" section of the no-code/de-branding plan: the ZIP
// filename, root folder, and main sketch are all derived from `sanitizeFilename`; the internal
// C++ namespace and every internal identifier/macro derived from it use `sanitizeIdentifier`.

const DEFAULT_IDENTIFIER = 'MyUiProject'
const DEFAULT_FILENAME = 'My-Ui-Project'

/** PascalCase C++ identifier from a project name — `"Office Control Panel"` -> `"OfficeControlPanel"`.
 * Falls back to a generic default when the name is empty/whitespace-only, has no alphanumeric
 * content at all (e.g. a name that's purely punctuation/emoji), OR sanitizes to literally
 * "UntitledProject" — createDefaultProject()'s own default project name is "Untitled Project"
 * (see store.ts), so exporting a brand-new project before renaming it would otherwise generate
 * this exact placeholder-looking namespace throughout the code; falling back to the same generic
 * default used for a genuinely empty name keeps every export free of "UntitledProject" without
 * requiring the user to rename their project first. A leading digit is prefixed with `P` since
 * C++ identifiers can't start with one. */
export function sanitizeIdentifier(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? []
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  if (!pascal || pascal === 'UntitledProject') return DEFAULT_IDENTIFIER
  return /^[0-9]/.test(pascal) ? `P${pascal}` : pascal
}

/** Filesystem-safe, kebab-preserving name from a project name — `"Office Control Panel"` ->
 * `"Office-Control-Panel"` — used for the exported ZIP filename, root folder, and main sketch
 * (Arduino requires the `.ino` file to be named exactly after its containing folder). Falls back
 * to a generic default under the same empty/no-alphanumeric-content/literal-"Untitled Project"
 * conditions as sanitizeIdentifier (see that function's own comment). */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return !cleaned || cleaned === 'Untitled-Project' ? DEFAULT_FILENAME : cleaned
}
