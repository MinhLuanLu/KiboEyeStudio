import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { readFile, writeFile, rename, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { is } from './is'

let mainWindow: BrowserWindow | null = null

// Tracks whether the renderer currently has unsaved changes (kept in sync via the
// 'app:dirty-changed' channel below) so the window-close handler knows whether it needs to
// ask before letting the window actually close.
let rendererDirty = false
// Set right before we deliberately close the window ourselves (after the user picked "Save"
// or "Don't Save" in that prompt) so the 'close' handler doesn't intercept its own close.
let allowClose = false

function send(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args)
}

function autosavePath(): string {
  return join(app.getPath('userData'), 'autosave.kiboeyes')
}

/** The autosave filename before the dedicated .kiboeyes extension was introduced — checked
 * as a one-time fallback so an in-progress autosave from an older build isn't silently lost. */
function legacyAutosavePath(): string {
  return join(app.getPath('userData'), 'autosave.kiboproj.json')
}

/** Writes via a temp file + rename so a crash or power loss mid-write can never leave an
 * existing project file half-written/corrupted — the rename is atomic on both POSIX and
 * Windows, so the destination is either the old contents or the fully-written new contents,
 * never something in between. */
async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(tmpPath, contents, 'utf-8')
    await rename(tmpPath, filePath)
  } catch (err) {
    try {
      await unlink(tmpPath)
    } catch {
      // Best-effort cleanup — the write itself already failed, so surface that error.
    }
    throw err
  }
}

function createWindow(): void {
  allowClose = false
  rendererDirty = false

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#141417',
    autoHideMenuBar: false,
    webPreferences: {
      // electron-vite builds the preload script as ESM (this package.json is
      // "type": "module") and names it index.mjs accordingly — Electron's preload loader
      // needs that exact extension to load it as ESM. Referencing index.js here (a file
      // that doesn't exist) used to fail silently: Electron logs a "cannot find module"
      // warning to the renderer's DevTools console and simply never injects the preload,
      // so window.kibo stayed undefined and every native Save/Open/menu feature silently
      // fell back to (or failed to reach) its browser-only code path.
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Ask before losing unsaved work, whether the user clicked the window's close button or
  // chose Quit — Electron routes both through each window's 'close' event first.
  mainWindow.on('close', (e) => {
    if (allowClose || !rendererDirty) return
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'You have unsaved changes',
      detail: 'Do you want to save your changes before closing?'
    })
    if (choice === 2) return // Cancel
    if (choice === 1) {
      allowClose = true
      mainWindow?.close()
      return
    }
    // 'Save' — ask the renderer to save, then close once it confirms the save succeeded.
    // If the save fails or the user cancels a Save As prompt it triggers, no confirmation
    // arrives and the window simply stays open with its unsaved-changes state intact.
    send('menu:save-project-then-close')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  buildMenu()
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new-project') },
        { label: 'Open Project...', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open-project') },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save-project') },
        { label: 'Save Project As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:save-project-as') },
        { type: 'separator' },
        { label: 'Export...', accelerator: 'CmdOrCtrl+E', click: () => send('menu:export') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu:redo') },
        { type: 'separator' },
        { label: 'Duplicate Keyframe', accelerator: 'CmdOrCtrl+D', click: () => send('menu:duplicate-keyframe') },
        { label: 'Delete Keyframe', accelerator: 'Delete', click: () => send('menu:delete-keyframe') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Developer Mode', accelerator: 'CmdOrCtrl+.', click: () => send('menu:toggle-dev-mode') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Playback',
      submenu: [
        { label: 'Play / Pause', accelerator: 'Space', click: () => send('menu:play-pause') },
        { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: () => send('menu:stop') },
        { label: 'Restart', accelerator: 'CmdOrCtrl+R', click: () => send('menu:restart') },
        { label: 'Next Frame', accelerator: 'Right', click: () => send('menu:next-frame') },
        { label: 'Previous Frame', accelerator: 'Left', click: () => send('menu:prev-frame') }
      ]
    },
    {
      label: 'Help',
      submenu: [{ label: 'User Guide', accelerator: 'F1', click: () => send('menu:user-guide') }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

ipcMain.handle('project:save-as', async (_e, json: string, suggestedName: string) => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Kibo  Studio Project',
    defaultPath: suggestedName,
    filters: [{ name: 'Kibo  Studio Project', extensions: ['kiboeyes'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await atomicWriteFile(result.filePath, json)
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('project:save-to-path', async (_e, filePath: string, json: string) => {
  await atomicWriteFile(filePath, json)
  return { ok: true }
})

ipcMain.handle('project:open', async () => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Kibo  Studio Project',
    properties: ['openFile'],
    // 'json' stays accepted so projects saved before the dedicated extension existed can
    // still be opened — parseProjectFile() on the renderer side handles both formats.
    filters: [{ name: 'Kibo  Studio Project', extensions: ['kiboeyes', 'json'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const filePath = result.filePaths[0]
  const json = await readFile(filePath, 'utf-8')
  return { canceled: false, filePath, json }
})

ipcMain.handle('project:autosave-write', async (_e, json: string) => {
  await atomicWriteFile(autosavePath(), json)
  return { ok: true }
})

ipcMain.handle('project:autosave-read', async () => {
  const p = autosavePath()
  if (existsSync(p)) {
    const json = await readFile(p, 'utf-8')
    return { exists: true, json }
  }
  const legacy = legacyAutosavePath()
  if (existsSync(legacy)) {
    const json = await readFile(legacy, 'utf-8')
    return { exists: true, json }
  }
  return { exists: false }
})

ipcMain.on('app:dirty-changed', (_e, dirty: boolean) => {
  rendererDirty = dirty
})

ipcMain.on('app:save-then-close-complete', () => {
  allowClose = true
  mainWindow?.close()
})

ipcMain.handle('export:save-file', async (_e, defaultName: string, contents: string, extFilters: { name: string; extensions: string[] }[]) => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export',
    defaultPath: defaultName,
    filters: extFilters
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await atomicWriteFile(result.filePath, contents)
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('import:open-json', async () => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Animation JSON',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const filePath = result.filePaths[0]
  const json = await readFile(filePath, 'utf-8')
  return { canceled: false, filePath, json }
})

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData')
  if (!existsSync(userDataDir)) await mkdir(userDataDir, { recursive: true })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
