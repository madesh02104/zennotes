import { create } from 'zustand'
import type { NoteContent, NoteFolder, NoteMeta, VaultChangeEvent, VaultInfo } from '@shared/ipc'
import { DEFAULT_THEME_ID, THEMES, type ThemeFamily, type ThemeMode } from './lib/themes'

const PREFS_KEY = 'zen:prefs:v2'
const VALID_FAMILIES: ThemeFamily[] = ['apple', 'gruvbox', 'catppuccin', 'github']
const VALID_MODES: ThemeMode[] = ['light', 'dark', 'auto']

interface Prefs {
  vimMode: boolean
  livePreview: boolean      // hide markdown syntax on inactive lines
  themeId: string
  themeFamily: ThemeFamily
  themeMode: ThemeMode
  editorFontSize: number    // px — affects editor + preview
  editorLineHeight: number  // unitless multiplier
  /** Font used by the whole app chrome (sidebar, menus, title bar). */
  interfaceFont: string | null
  /** Font used inside the editor + preview content. */
  textFont: string | null
  /** Font used for inline code + fenced code blocks + frontmatter. */
  monoFont: string | null
  /** Ctrl/Cmd + scroll adjusts editor font size. */
  quickFontSizeAdjust: boolean
  /** Enable the Liquid Glass translucency. When off the UI is opaque. */
  transparentUi: boolean
}
const DEFAULT_PREFS: Prefs = {
  vimMode: true,
  livePreview: true,
  themeId: DEFAULT_THEME_ID,
  themeFamily: 'apple',
  themeMode: 'auto',
  editorFontSize: 16,
  editorLineHeight: 1.7,
  interfaceFont: null,
  textFont: null,
  monoFont: null,
  quickFontSizeAdjust: true,
  transparentUi: true
}
/** Coerce any loaded prefs blob into a valid Prefs object, dropping
 *  anything unknown (e.g. tokyo-night left over from earlier versions). */
function normalizePrefs(p: Partial<Prefs>): Prefs {
  const themeFamily: ThemeFamily =
    p.themeFamily && VALID_FAMILIES.includes(p.themeFamily)
      ? p.themeFamily
      : DEFAULT_PREFS.themeFamily
  const themeMode: ThemeMode =
    p.themeMode && VALID_MODES.includes(p.themeMode)
      ? p.themeMode
      : DEFAULT_PREFS.themeMode
  const themeId =
    p.themeId && THEMES.some((t) => t.id === p.themeId)
      ? p.themeId
      : DEFAULT_PREFS.themeId
  return {
    vimMode: typeof p.vimMode === 'boolean' ? p.vimMode : DEFAULT_PREFS.vimMode,
    livePreview:
      typeof p.livePreview === 'boolean' ? p.livePreview : DEFAULT_PREFS.livePreview,
    themeId,
    themeFamily,
    themeMode,
    editorFontSize:
      typeof p.editorFontSize === 'number'
        ? p.editorFontSize
        : DEFAULT_PREFS.editorFontSize,
    editorLineHeight:
      typeof p.editorLineHeight === 'number'
        ? p.editorLineHeight
        : DEFAULT_PREFS.editorLineHeight,
    interfaceFont:
      typeof p.interfaceFont === 'string' || p.interfaceFont === null
        ? (p.interfaceFont as string | null)
        : DEFAULT_PREFS.interfaceFont,
    textFont:
      typeof p.textFont === 'string' || p.textFont === null
        ? (p.textFont as string | null)
        : DEFAULT_PREFS.textFont,
    monoFont:
      typeof p.monoFont === 'string' || p.monoFont === null
        ? (p.monoFont as string | null)
        : DEFAULT_PREFS.monoFont,
    quickFontSizeAdjust:
      typeof p.quickFontSizeAdjust === 'boolean'
        ? p.quickFontSizeAdjust
        : DEFAULT_PREFS.quickFontSizeAdjust,
    transparentUi:
      typeof p.transparentUi === 'boolean'
        ? p.transparentUi
        : DEFAULT_PREFS.transparentUi
  }
}
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return normalizePrefs(JSON.parse(raw) as Partial<Prefs>)
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS
}
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

/** Snapshot prefs-shaped fields out of the live store. */
function collectPrefs(s: {
  vimMode: boolean
  livePreview: boolean
  themeId: string
  themeFamily: ThemeFamily
  themeMode: ThemeMode
  editorFontSize: number
  editorLineHeight: number
  interfaceFont: string | null
  textFont: string | null
  monoFont: string | null
  quickFontSizeAdjust: boolean
  transparentUi: boolean
}): Prefs {
  return {
    vimMode: s.vimMode,
    livePreview: s.livePreview,
    themeId: s.themeId,
    themeFamily: s.themeFamily,
    themeMode: s.themeMode,
    editorFontSize: s.editorFontSize,
    editorLineHeight: s.editorLineHeight,
    interfaceFont: s.interfaceFont,
    textFont: s.textFont,
    monoFont: s.monoFont,
    quickFontSizeAdjust: s.quickFontSizeAdjust,
    transparentUi: s.transparentUi
  }
}

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
  sidebarOpen: boolean
  noteListOpen: boolean
  vimMode: boolean
  livePreview: boolean
  settingsOpen: boolean
  themeId: string
  themeFamily: ThemeFamily
  themeMode: ThemeMode
  editorFontSize: number
  editorLineHeight: number
  interfaceFont: string | null
  textFont: string | null
  monoFont: string | null
  quickFontSizeAdjust: boolean
  transparentUi: boolean

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
  toggleSidebar: () => void
  toggleNoteList: () => void
  setFocusMode: (focus: boolean) => void
  setVimMode: (on: boolean) => void
  setLivePreview: (on: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setTheme: (next: { id: string; family: ThemeFamily; mode: ThemeMode }) => void
  setEditorFontSize: (px: number) => void
  setEditorLineHeight: (mult: number) => void
  setInterfaceFont: (family: string | null) => void
  setTextFont: (family: string | null) => void
  setMonoFont: (family: string | null) => void
  setQuickFontSizeAdjust: (on: boolean) => void
  setTransparentUi: (on: boolean) => void
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
  sidebarOpen: true,
  noteListOpen: true,
  vimMode: loadPrefs().vimMode,
  livePreview: loadPrefs().livePreview,
  settingsOpen: false,
  themeId: loadPrefs().themeId,
  themeFamily: loadPrefs().themeFamily,
  themeMode: loadPrefs().themeMode,
  editorFontSize: loadPrefs().editorFontSize,
  editorLineHeight: loadPrefs().editorLineHeight,
  interfaceFont: loadPrefs().interfaceFont,
  textFont: loadPrefs().textFont,
  monoFont: loadPrefs().monoFont,
  quickFontSizeAdjust: loadPrefs().quickFontSizeAdjust,
  transparentUi: loadPrefs().transparentUi,

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
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleNoteList: () => set((s) => ({ noteListOpen: !s.noteListOpen })),
  setFocusMode: (focus) =>
    set({ sidebarOpen: !focus, noteListOpen: !focus }),
  setVimMode: (on) => {
    set({ vimMode: on })
    savePrefs(collectPrefs(get()))
  },
  setLivePreview: (on) => {
    set({ livePreview: on })
    savePrefs(collectPrefs(get()))
  },
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setTheme: ({ id, family, mode }) => {
    set({ themeId: id, themeFamily: family, themeMode: mode })
    savePrefs(collectPrefs(get()))
  },
  setEditorFontSize: (px) => {
    set({ editorFontSize: px })
    savePrefs(collectPrefs(get()))
  },
  setEditorLineHeight: (mult) => {
    set({ editorLineHeight: mult })
    savePrefs(collectPrefs(get()))
  },
  setInterfaceFont: (family) => {
    set({ interfaceFont: family })
    savePrefs(collectPrefs(get()))
  },
  setTextFont: (family) => {
    set({ textFont: family })
    savePrefs(collectPrefs(get()))
  },
  setMonoFont: (family) => {
    set({ monoFont: family })
    savePrefs(collectPrefs(get()))
  },
  setQuickFontSizeAdjust: (on) => {
    set({ quickFontSizeAdjust: on })
    savePrefs(collectPrefs(get()))
  },
  setTransparentUi: (on) => {
    set({ transparentUi: on })
    savePrefs(collectPrefs(get()))
  },

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
