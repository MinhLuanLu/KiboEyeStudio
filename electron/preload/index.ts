import { contextBridge, ipcRenderer } from 'electron'

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

const kiboApi = {
  saveProjectAs: (json: string, suggestedName: string): Promise<SaveResult> =>
    ipcRenderer.invoke('project:save-as', json, suggestedName),
  saveProjectToPath: (filePath: string, json: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('project:save-to-path', filePath, json),
  openProject: (): Promise<OpenResult> => ipcRenderer.invoke('project:open'),
  openProjectPath: (filePath: string): Promise<{ ok: boolean; json?: string }> => ipcRenderer.invoke('project:open-path', filePath),
  autosaveWrite: (json: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:autosave-write', json),
  autosaveRead: (): Promise<AutosaveReadResult> => ipcRenderer.invoke('project:autosave-read'),
  exportSaveFile: (defaultName: string, contents: string, filters: ExtFilter[]): Promise<SaveResult> =>
    ipcRenderer.invoke('export:save-file', defaultName, contents, filters),
  exportSaveBinaryFile: (defaultName: string, base64Contents: string, filters: ExtFilter[]): Promise<SaveResult> =>
    ipcRenderer.invoke('export:save-binary-file', defaultName, base64Contents, filters),
  importOpenJson: (): Promise<OpenResult> => ipcRenderer.invoke('import:open-json'),
  // One-way notifications the main process uses to decide whether it's safe to close the
  // window without asking, and to know when a save it requested (via
  // 'menu:save-project-then-close') has actually completed.
  notifyDirty: (dirty: boolean): void => ipcRenderer.send('app:dirty-changed', dirty),
  notifySaveThenCloseComplete: (): void => ipcRenderer.send('app:save-then-close-complete'),
  onMenu: (channel: string, callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

export type KiboApi = typeof kiboApi

contextBridge.exposeInMainWorld('kibo', kiboApi)
