export interface SaveResult {
  canceled: boolean
  filePath?: string
}

export interface OpenResult {
  canceled: boolean
  filePath?: string
  json?: string
}

export interface AutosaveReadResult {
  exists: boolean
  json?: string
}

export interface ExtFilter {
  name: string
  extensions: string[]
}

export interface AuthStatusResult {
  sessionEmail: string | null
}

export interface KiboApi {
  saveProjectAs: (json: string, suggestedName: string) => Promise<SaveResult>
  saveProjectToPath: (filePath: string, json: string) => Promise<{ ok: boolean }>
  openProject: () => Promise<OpenResult>
  openProjectPath: (filePath: string) => Promise<{ ok: boolean; json?: string }>
  autosaveWrite: (json: string) => Promise<{ ok: boolean }>
  autosaveRead: () => Promise<AutosaveReadResult>
  exportSaveFile: (defaultName: string, contents: string, filters: ExtFilter[]) => Promise<SaveResult>
  exportSaveBinaryFile: (defaultName: string, base64Contents: string, filters: ExtFilter[]) => Promise<SaveResult>
  importOpenJson: () => Promise<OpenResult>
  authStatus: () => Promise<AuthStatusResult>
  authSetSession: (email: string | null) => Promise<{ ok: boolean }>
  notifyDirty: (dirty: boolean) => void
  notifySaveThenCloseComplete: () => void
  onMenu: (channel: string, callback: () => void) => () => void
}

declare global {
  interface Window {
    kibo?: KiboApi
  }
}
