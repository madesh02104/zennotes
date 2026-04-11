// Shared IPC channel names and types between main + renderer.
// Keeping these in one file gives us a single source of truth.

export const IPC = {
  VAULT_PICK: 'vault:pick',
  VAULT_GET_CURRENT: 'vault:get-current',
  VAULT_LIST_NOTES: 'vault:list-notes',
  VAULT_READ_NOTE: 'vault:read-note',
  VAULT_WRITE_NOTE: 'vault:write-note',
  VAULT_CREATE_NOTE: 'vault:create-note',
  VAULT_RENAME_NOTE: 'vault:rename-note',
  VAULT_DELETE_NOTE: 'vault:delete-note',
  VAULT_MOVE_TO_TRASH: 'vault:move-to-trash',
  VAULT_RESTORE_FROM_TRASH: 'vault:restore-from-trash',
  VAULT_EMPTY_TRASH: 'vault:empty-trash',
  VAULT_ARCHIVE_NOTE: 'vault:archive-note',
  VAULT_UNARCHIVE_NOTE: 'vault:unarchive-note',
  VAULT_ON_CHANGE: 'vault:on-change',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
  APP_PLATFORM: 'app:platform'
} as const

export type NoteFolder = 'inbox' | 'archive' | 'trash'

export interface NoteMeta {
  /** Path relative to the vault root, always POSIX-style. */
  path: string
  /** File name without extension. */
  title: string
  folder: NoteFolder
  createdAt: number
  updatedAt: number
  size: number
  /** Extracted #tags (unique, lowercase not enforced). */
  tags: string[]
  /** First ~200 chars of the body stripped of markdown noise, for list previews. */
  excerpt: string
}

export interface NoteContent extends NoteMeta {
  /** Raw markdown body including any frontmatter. */
  body: string
}

export interface VaultInfo {
  root: string
  name: string
}

export type VaultChangeKind = 'add' | 'change' | 'unlink'

export interface VaultChangeEvent {
  kind: VaultChangeKind
  path: string
  folder: NoteFolder
}
