import { create } from 'zustand'
import type { NoteContent, NoteFolder, NoteMeta, VaultChangeEvent, VaultInfo } from '@shared/ipc'

export type View =
  | { kind: 'folder'; folder: NoteFolder }
  | { kind: 'tag'; tag: string }

interface Store {
  vault: VaultInfo | null
  notes: NoteMeta[]
  view: View
  selectedPath: string | null
  activeNote: NoteContent | null
  /** Notes still loading the full content. */
  loadingNote: boolean
  searchOpen: boolean
  query: string
  initialized: boolean

  setVault: (v: VaultInfo | null) => void
  setNotes: (notes: NoteMeta[]) => void
  setView: (view: View) => void
  selectNote: (relPath: string | null) => Promise<void>
  applyChange: (ev: VaultChangeEvent) => Promise<void>
  refreshNotes: () => Promise<void>
  updateActiveBody: (body: string) => void
  persistActive: () => Promise<void>
  renameActive: (nextTitle: string) => Promise<void>
  createAndOpen: (folder: NoteFolder) => Promise<void>
  trashActive: () => Promise<void>
  restoreActive: () => Promise<void>
  archiveActive: () => Promise<void>
  unarchiveActive: () => Promise<void>
  setSearchOpen: (open: boolean) => void
  setQuery: (q: string) => void
  init: () => Promise<void>
  openVaultPicker: () => Promise<void>
}

export const useStore = create<Store>((set, get) => ({
  vault: null,
  notes: [],
  view: { kind: 'folder', folder: 'inbox' },
  selectedPath: null,
  activeNote: null,
  loadingNote: false,
  searchOpen: false,
  query: '',
  initialized: false,

  setVault: (v) => set({ vault: v }),
  setNotes: (notes) => set({ notes }),
  setView: (view) => set({ view, selectedPath: null, activeNote: null }),

  selectNote: async (relPath) => {
    if (!relPath) {
      set({ selectedPath: null, activeNote: null })
      return
    }
    set({ selectedPath: relPath, loadingNote: true })
    try {
      const content = await window.zen.readNote(relPath)
      set({ activeNote: content, loadingNote: false })
    } catch (err) {
      console.error('readNote failed', err)
      set({ loadingNote: false, activeNote: null })
    }
  },

  refreshNotes: async () => {
    try {
      const notes = await window.zen.listNotes()
      set({ notes })
    } catch (err) {
      console.error('listNotes failed', err)
    }
  },

  applyChange: async (ev) => {
    const state = get()
    await state.refreshNotes()
    if (state.selectedPath && ev.path === state.selectedPath) {
      if (ev.kind === 'unlink') {
        set({ selectedPath: null, activeNote: null })
      } else if (ev.kind === 'change') {
        try {
          const content = await window.zen.readNote(state.selectedPath)
          // Only refresh the editor if the on-disk body diverged from ours.
          if (!state.activeNote || state.activeNote.body !== content.body) {
            set({ activeNote: content })
          }
        } catch {
          /* ignore */
        }
      }
    }
  },

  updateActiveBody: (body) => {
    const active = get().activeNote
    if (!active) return
    set({ activeNote: { ...active, body } })
  },

  persistActive: async () => {
    const active = get().activeNote
    if (!active) return
    try {
      const meta = await window.zen.writeNote(active.path, active.body)
      set((s) => ({
        notes: s.notes.map((n) => (n.path === meta.path ? { ...n, ...meta } : n))
      }))
    } catch (err) {
      console.error('writeNote failed', err)
    }
  },

  renameActive: async (nextTitle) => {
    const active = get().activeNote
    if (!active) return
    try {
      const meta = await window.zen.renameNote(active.path, nextTitle)
      set({
        activeNote: { ...active, ...meta },
        selectedPath: meta.path
      })
      await get().refreshNotes()
    } catch (err) {
      console.error('renameNote failed', err)
    }
  },

  createAndOpen: async (folder) => {
    try {
      const meta = await window.zen.createNote(folder)
      await get().refreshNotes()
      set({ view: { kind: 'folder', folder } })
      await get().selectNote(meta.path)
    } catch (err) {
      console.error('createNote failed', err)
    }
  },

  trashActive: async () => {
    const active = get().activeNote
    if (!active) return
    try {
      await window.zen.moveToTrash(active.path)
      set({ activeNote: null, selectedPath: null })
      await get().refreshNotes()
    } catch (err) {
      console.error('moveToTrash failed', err)
    }
  },

  restoreActive: async () => {
    const active = get().activeNote
    if (!active) return
    const meta = await window.zen.restoreFromTrash(active.path)
    await get().refreshNotes()
    await get().selectNote(meta.path)
  },

  archiveActive: async () => {
    const active = get().activeNote
    if (!active) return
    await window.zen.archiveNote(active.path)
    set({ activeNote: null, selectedPath: null })
    await get().refreshNotes()
  },

  unarchiveActive: async () => {
    const active = get().activeNote
    if (!active) return
    const meta = await window.zen.unarchiveNote(active.path)
    await get().refreshNotes()
    await get().selectNote(meta.path)
  },

  setSearchOpen: (open) => set({ searchOpen: open, query: open ? get().query : '' }),
  setQuery: (q) => set({ query: q }),

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    try {
      const vault = await window.zen.getCurrentVault()
      if (vault) {
        set({ vault })
        await get().refreshNotes()
      }
    } catch (err) {
      console.error('init failed', err)
    }
    window.zen.onVaultChange((ev) => {
      void get().applyChange(ev)
    })
  },

  openVaultPicker: async () => {
    const vault = await window.zen.pickVault()
    if (vault) {
      set({ vault, view: { kind: 'folder', folder: 'inbox' } })
      await get().refreshNotes()
    }
  }
}))
