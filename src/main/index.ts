import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '@shared/ipc'
import type { NoteFolder, VaultChangeEvent, VaultInfo } from '@shared/ipc'
import {
  archiveNote,
  createNote,
  deleteNote,
  emptyTrash,
  ensureVaultLayout,
  listNotes,
  loadConfig,
  moveToTrash,
  readNote,
  renameNote,
  restoreFromTrash,
  saveConfig,
  unarchiveNote,
  vaultInfo,
  writeNote
} from './vault'
import { VaultWatcher } from './watcher'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let currentVault: VaultInfo | null = null
const watcher = new VaultWatcher()

function isMac(): boolean {
  return process.platform === 'darwin'
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac() ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#faf7f0',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

async function setVault(root: string): Promise<VaultInfo> {
  await ensureVaultLayout(root)
  currentVault = vaultInfo(root)
  await saveConfig({ vaultRoot: root })
  watcher.start(root, (ev: VaultChangeEvent) => {
    mainWindow?.webContents.send(IPC.VAULT_ON_CHANGE, ev)
  })
  return currentVault
}

function requireVault(): VaultInfo {
  if (!currentVault) throw new Error('No vault is open')
  return currentVault
}

function registerIpc(): void {
  ipcMain.handle(IPC.APP_PLATFORM, () => process.platform)

  ipcMain.handle(IPC.VAULT_GET_CURRENT, async () => {
    if (currentVault) return currentVault
    const cfg = await loadConfig()
    if (cfg.vaultRoot) {
      try {
        return await setVault(cfg.vaultRoot)
      } catch {
        return null
      }
    }
    return null
  })

  ipcMain.handle(IPC.VAULT_PICK, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a vault folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open Vault'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return await setVault(result.filePaths[0])
  })

  ipcMain.handle(IPC.VAULT_LIST_NOTES, async () => {
    const v = requireVault()
    return await listNotes(v.root)
  })

  ipcMain.handle(IPC.VAULT_READ_NOTE, async (_e, relPath: string) => {
    const v = requireVault()
    return await readNote(v.root, relPath)
  })

  ipcMain.handle(IPC.VAULT_WRITE_NOTE, async (_e, relPath: string, body: string) => {
    const v = requireVault()
    return await writeNote(v.root, relPath, body)
  })

  ipcMain.handle(IPC.VAULT_CREATE_NOTE, async (_e, folder: NoteFolder, title?: string) => {
    const v = requireVault()
    return await createNote(v.root, folder, title)
  })

  ipcMain.handle(IPC.VAULT_RENAME_NOTE, async (_e, relPath: string, nextTitle: string) => {
    const v = requireVault()
    return await renameNote(v.root, relPath, nextTitle)
  })

  ipcMain.handle(IPC.VAULT_DELETE_NOTE, async (_e, relPath: string) => {
    const v = requireVault()
    await deleteNote(v.root, relPath)
  })

  ipcMain.handle(IPC.VAULT_MOVE_TO_TRASH, async (_e, relPath: string) => {
    const v = requireVault()
    return await moveToTrash(v.root, relPath)
  })

  ipcMain.handle(IPC.VAULT_RESTORE_FROM_TRASH, async (_e, relPath: string) => {
    const v = requireVault()
    return await restoreFromTrash(v.root, relPath)
  })

  ipcMain.handle(IPC.VAULT_EMPTY_TRASH, async () => {
    const v = requireVault()
    await emptyTrash(v.root)
  })

  ipcMain.handle(IPC.VAULT_ARCHIVE_NOTE, async (_e, relPath: string) => {
    const v = requireVault()
    return await archiveNote(v.root, relPath)
  })

  ipcMain.handle(IPC.VAULT_UNARCHIVE_NOTE, async (_e, relPath: string) => {
    const v = requireVault()
    return await unarchiveNote(v.root, relPath)
  })

  ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize())
  ipcMain.on(IPC.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.close())
}

app.whenReady().then(async () => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher.stop()
  if (!isMac()) app.quit()
})

app.on('before-quit', () => {
  watcher.stop()
})
