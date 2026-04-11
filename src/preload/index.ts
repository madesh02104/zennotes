import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  NoteContent,
  NoteFolder,
  NoteMeta,
  VaultChangeEvent,
  VaultInfo
} from '@shared/ipc'

const api = {
  platform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke(IPC.APP_PLATFORM),
  listSystemFonts: (): Promise<string[]> => ipcRenderer.invoke(IPC.APP_LIST_FONTS),

  getCurrentVault: (): Promise<VaultInfo | null> => ipcRenderer.invoke(IPC.VAULT_GET_CURRENT),
  pickVault: (): Promise<VaultInfo | null> => ipcRenderer.invoke(IPC.VAULT_PICK),

  listNotes: (): Promise<NoteMeta[]> => ipcRenderer.invoke(IPC.VAULT_LIST_NOTES),
  readNote: (relPath: string): Promise<NoteContent> =>
    ipcRenderer.invoke(IPC.VAULT_READ_NOTE, relPath),
  writeNote: (relPath: string, body: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_WRITE_NOTE, relPath, body),
  createNote: (folder: NoteFolder, title?: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_CREATE_NOTE, folder, title),
  renameNote: (relPath: string, nextTitle: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_RENAME_NOTE, relPath, nextTitle),
  deleteNote: (relPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.VAULT_DELETE_NOTE, relPath),
  moveToTrash: (relPath: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_MOVE_TO_TRASH, relPath),
  restoreFromTrash: (relPath: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_RESTORE_FROM_TRASH, relPath),
  emptyTrash: (): Promise<void> => ipcRenderer.invoke(IPC.VAULT_EMPTY_TRASH),
  archiveNote: (relPath: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_ARCHIVE_NOTE, relPath),
  unarchiveNote: (relPath: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_UNARCHIVE_NOTE, relPath),
  duplicateNote: (relPath: string): Promise<NoteMeta> =>
    ipcRenderer.invoke(IPC.VAULT_DUPLICATE_NOTE, relPath),
  revealNote: (relPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.VAULT_REVEAL_NOTE, relPath),

  onVaultChange: (cb: (ev: VaultChangeEvent) => void): (() => void) => {
    const listener = (_: unknown, ev: VaultChangeEvent): void => cb(ev)
    ipcRenderer.on(IPC.VAULT_ON_CHANGE, listener)
    return () => ipcRenderer.removeListener(IPC.VAULT_ON_CHANGE, listener)
  },

  windowMinimize: (): void => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  windowToggleMaximize: (): void => ipcRenderer.send(IPC.WINDOW_TOGGLE_MAXIMIZE),
  windowClose: (): void => ipcRenderer.send(IPC.WINDOW_CLOSE)
}

export type ZenApi = typeof api

contextBridge.exposeInMainWorld('zen', api)
