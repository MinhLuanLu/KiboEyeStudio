import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { is } from './is'

let mainWindow: BrowserWindow | null = null

function send(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args)
}

function autosavePath(): string {
  return join(app.getPath('userData'), 'autosave.kiboproj.json')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#141417',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

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
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

ipcMain.handle('project:save-as', async (_e, json: string, suggestedName: string) => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Kibo Eye Studio Project',
    defaultPath: suggestedName,
    filters: [{ name: 'Kibo Project', extensions: ['kiboproj.json', 'json'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await writeFile(result.filePath, json, 'utf-8')
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('project:save-to-path', async (_e, filePath: string, json: string) => {
  await writeFile(filePath, json, 'utf-8')
  return { ok: true }
})

ipcMain.handle('project:open', async () => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Kibo Eye Studio Project',
    properties: ['openFile'],
    filters: [{ name: 'Kibo Project', extensions: ['json'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const filePath = result.filePaths[0]
  const json = await readFile(filePath, 'utf-8')
  return { canceled: false, filePath, json }
})

ipcMain.handle('project:autosave-write', async (_e, json: string) => {
  await writeFile(autosavePath(), json, 'utf-8')
  return { ok: true }
})

ipcMain.handle('project:autosave-read', async () => {
  const p = autosavePath()
  if (!existsSync(p)) return { exists: false }
  const json = await readFile(p, 'utf-8')
  return { exists: true, json }
})

ipcMain.handle('export:save-file', async (_e, defaultName: string, contents: string, extFilters: { name: string; extensions: string[] }[]) => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export',
    defaultPath: defaultName,
    filters: extFilters
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await writeFile(result.filePath, contents, 'utf-8')
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
