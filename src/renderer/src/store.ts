import { create } from 'zustand'
import type {
  FolderEntry,
  NoteContent,
  NoteFolder,
  NoteMeta,
  VaultChangeEvent,
  VaultInfo
} from '@shared/ipc'
import { DEFAULT_THEME_ID, THEMES, type ThemeFamily, type ThemeMode } from './lib/themes'

export type NoteSortOrder =
  | 'updated-desc'
  | 'updated-asc'
  | 'created-desc'
  | 'created-asc'
  | 'name-asc'
  | 'name-desc'

const PREFS_KEY = 'zen:prefs:v2'
const VALID_FAMILIES: ThemeFamily[] = ['apple', 'gruvbox', 'catppuccin', 'github']
const VALID_MODES: ThemeMode[] = ['light', 'dark', 'auto']
const VALID_SORTS: NoteSortOrder[] = [
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
  'name-asc',
  'name-desc'
]

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
  /** Enable the Liquid Glass translucency. When off the UI is opaque. */
  transparentUi: boolean
  sidebarWidth: number
  noteListWidth: number
  noteSortOrder: NoteSortOrder
  /** Auto-expand the sidebar tree to reveal the currently open note. */
  autoReveal: boolean
  /** Collapse the dedicated note list column and render notes inside
   *  the sidebar tree (Obsidian "File Explorer" layout). */
  unifiedSidebar: boolean
  /** Tint the sidebar surface a step darker than the main canvas. */
  darkSidebar: boolean
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
  transparentUi: true,
  sidebarWidth: 232,
  noteListWidth: 300,
  noteSortOrder: 'updated-desc',
  autoReveal: true,
  unifiedSidebar: true,
  darkSidebar: true
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
    transparentUi:
      typeof p.transparentUi === 'boolean'
        ? p.transparentUi
        : DEFAULT_PREFS.transparentUi,
    sidebarWidth:
      typeof p.sidebarWidth === 'number'
        ? Math.min(520, Math.max(160, p.sidebarWidth))
        : DEFAULT_PREFS.sidebarWidth,
    noteListWidth:
      typeof p.noteListWidth === 'number'
        ? Math.min(560, Math.max(200, p.noteListWidth))
        : DEFAULT_PREFS.noteListWidth,
    noteSortOrder:
      p.noteSortOrder && VALID_SORTS.includes(p.noteSortOrder)
        ? p.noteSortOrder
        : DEFAULT_PREFS.noteSortOrder,
    autoReveal:
      typeof p.autoReveal === 'boolean'
        ? p.autoReveal
        : DEFAULT_PREFS.autoReveal,
    unifiedSidebar:
      typeof p.unifiedSidebar === 'boolean'
        ? p.unifiedSidebar
        : DEFAULT_PREFS.unifiedSidebar,
    darkSidebar:
      typeof p.darkSidebar === 'boolean'
        ? p.darkSidebar
        : DEFAULT_PREFS.darkSidebar
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

/**
 * Rewrite every occurrence of `#oldTag` across all non-trash notes.
 * When `newTag` is null the hashtag is stripped (delete semantics);
 * otherwise it's replaced with `#newTag`.
 *
 * We only rewrite notes whose cached tag list contains `oldTag` (so
 * the iteration is bounded by the sidebar index) and we match tags
 * with a word-boundary regex so `#test` doesn't accidentally chew
 * into `#testing`. Fenced / inline code spans are left alone.
 */
async function rewriteTagAcrossVault(
  get: () => { notes: NoteMeta[]; activeNote: NoteContent | null },
  oldTag: string,
  newTag: string | null
): Promise<void> {
  const { notes, activeNote } = get()
  const escaped = oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match `#tag` preceded by start/whitespace and followed by a non
  // tag-character or end-of-string, keeping the leading separator.
  const pattern = new RegExp(`(^|\\s)#${escaped}(?=[^\\w\\-/]|$)`, 'gm')

  const rewriteBody = (src: string): string => {
    // Preserve code fences and inline code exactly. Split the body
    // into alternating "safe" and "code" segments, rewrite only the
    // safe ones, then re-stitch.
    const fenceRe = /(```[\s\S]*?```|`[^`\n]*`)/g
    const parts: string[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = fenceRe.exec(src)) !== null) {
      parts.push(src.slice(last, m.index)) // prose
      parts.push(m[0]) // code (kept as-is)
      last = fenceRe.lastIndex
    }
    parts.push(src.slice(last))
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(
        pattern,
        newTag === null ? '$1' : `$1#${newTag}`
      )
    }
    return parts.join('')
  }

  for (const note of notes) {
    if (note.folder === 'trash') continue
    if (!note.tags.includes(oldTag)) continue
    try {
      const content = await window.zen.readNote(note.path)
      const next = rewriteBody(content.body)
      if (next !== content.body) {
        await window.zen.writeNote(note.path, next)
      }
    } catch (err) {
      console.error('rewriteTagAcrossVault: failed on', note.path, err)
    }
  }

  // Keep the currently-edited note's in-memory body in sync so the
  // editor reflects the change without a reload.
  if (activeNote) {
    try {
      const fresh = await window.zen.readNote(activeNote.path)
      useStore.setState({ activeNote: fresh })
    } catch {
      /* ignore — note may have been moved/deleted */
    }
  }

  // Refresh the sidebar tag index.
  await useStore.getState().refreshNotes()
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
  transparentUi: boolean
  sidebarWidth: number
  noteListWidth: number
  noteSortOrder: NoteSortOrder
  autoReveal: boolean
  unifiedSidebar: boolean
  darkSidebar: boolean
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
    transparentUi: s.transparentUi,
    sidebarWidth: s.sidebarWidth,
    noteListWidth: s.noteListWidth,
    noteSortOrder: s.noteSortOrder,
    autoReveal: s.autoReveal,
    unifiedSidebar: s.unifiedSidebar,
    darkSidebar: s.darkSidebar
  }
}

export type View =
  | {
      kind: 'folder'
      folder: NoteFolder
      /**
       * Subfolder path relative to the top-level folder, POSIX-style.
       * Empty = the top-level itself. Examples: "", "Work",
       * "Work/Research".
       */
      subpath: string
    }
  | { kind: 'tag'; tag: string }

interface Store {
  vault: VaultInfo | null
  notes: NoteMeta[]
  folders: FolderEntry[]
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
  transparentUi: boolean
  sidebarWidth: number
  noteListWidth: number
  noteSortOrder: NoteSortOrder
  autoReveal: boolean
  unifiedSidebar: boolean
  darkSidebar: boolean
  /** Sidebar tree collapsed-folder keys. Kept in the store so the
   *  state survives Sidebar unmount/mount (e.g. toggling the sidebar). */
  collapsedFolders: string[]

  setVault: (v: VaultInfo | null) => void
  setNotes: (notes: NoteMeta[]) => void
  setView: (view: View) => void
  selectNote: (relPath: string | null) => Promise<void>
  applyChange: (ev: VaultChangeEvent) => Promise<void>
  refreshNotes: () => Promise<void>
  updateActiveBody: (body: string) => void
  persistActive: () => Promise<void>
  renameActive: (nextTitle: string) => Promise<void>
  createAndOpen: (folder: NoteFolder, subpath?: string) => Promise<void>
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
  setTransparentUi: (on: boolean) => void
  setSidebarWidth: (px: number) => void
  setNoteListWidth: (px: number) => void
  setNoteSortOrder: (order: NoteSortOrder) => void
  setAutoReveal: (on: boolean) => void
  setUnifiedSidebar: (on: boolean) => void
  setDarkSidebar: (on: boolean) => void
  toggleCollapseFolder: (key: string) => void
  setCollapsedFolders: (keys: string[]) => void
  /** Rewrite `#oldTag` → `#newTag` across every non-trash note. */
  renameTag: (oldTag: string, newTag: string) => Promise<void>
  /** Remove `#tag` from every non-trash note. */
  deleteTag: (tag: string) => Promise<void>
  createFolder: (folder: NoteFolder, subpath: string) => Promise<void>
  renameFolder: (
    folder: NoteFolder,
    oldSubpath: string,
    newSubpath: string
  ) => Promise<void>
  deleteFolder: (folder: NoteFolder, subpath: string) => Promise<void>
  duplicateFolder: (folder: NoteFolder, subpath: string) => Promise<void>
  revealFolder: (folder: NoteFolder, subpath: string) => Promise<void>
  /** Move a note to a different folder + subpath. */
  moveNote: (
    relPath: string,
    targetFolder: NoteFolder,
    targetSubpath: string
  ) => Promise<void>
  init: () => Promise<void>
  openVaultPicker: () => Promise<void>
}

export const useStore = create<Store>((set, get) => ({
  vault: null,
  notes: [],
  folders: [],
  view: { kind: 'folder', folder: 'inbox', subpath: '' },
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
  transparentUi: loadPrefs().transparentUi,
  sidebarWidth: loadPrefs().sidebarWidth,
  noteListWidth: loadPrefs().noteListWidth,
  noteSortOrder: loadPrefs().noteSortOrder,
  autoReveal: loadPrefs().autoReveal,
  unifiedSidebar: loadPrefs().unifiedSidebar,
  darkSidebar: loadPrefs().darkSidebar,
  collapsedFolders: [],

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
      const [notes, folders] = await Promise.all([
        window.zen.listNotes(),
        window.zen.listFolders()
      ])
      set({ notes, folders })
    } catch (err) {
      console.error('refresh failed', err)
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

  createAndOpen: async (folder, subpath = '') => {
    try {
      const meta = await window.zen.createNote(folder, undefined, subpath)
      await get().refreshNotes()
      set({ view: { kind: 'folder', folder, subpath } })
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
  setTransparentUi: (on) => {
    set({ transparentUi: on })
    savePrefs(collectPrefs(get()))
  },
  setSidebarWidth: (px) => {
    const clamped = Math.min(520, Math.max(160, Math.round(px)))
    set({ sidebarWidth: clamped })
    savePrefs(collectPrefs(get()))
  },
  setNoteListWidth: (px) => {
    const clamped = Math.min(560, Math.max(200, Math.round(px)))
    set({ noteListWidth: clamped })
    savePrefs(collectPrefs(get()))
  },
  setNoteSortOrder: (order) => {
    set({ noteSortOrder: order })
    savePrefs(collectPrefs(get()))
  },
  setAutoReveal: (on) => {
    set({ autoReveal: on })
    savePrefs(collectPrefs(get()))
  },
  setUnifiedSidebar: (on) => {
    set({ unifiedSidebar: on })
    savePrefs(collectPrefs(get()))
  },
  setDarkSidebar: (on) => {
    set({ darkSidebar: on })
    savePrefs(collectPrefs(get()))
  },
  toggleCollapseFolder: (key) =>
    set((s) =>
      s.collapsedFolders.includes(key)
        ? { collapsedFolders: s.collapsedFolders.filter((k) => k !== key) }
        : { collapsedFolders: [...s.collapsedFolders, key] }
    ),
  setCollapsedFolders: (keys) => set({ collapsedFolders: keys }),

  renameTag: async (oldTag, newTag) => {
    await rewriteTagAcrossVault(get, oldTag, newTag)
  },
  deleteTag: async (tag) => {
    await rewriteTagAcrossVault(get, tag, null)
  },

  createFolder: async (folder, subpath) => {
    await window.zen.createFolder(folder, subpath)
    await get().refreshNotes()
    set({ view: { kind: 'folder', folder, subpath } })
  },

  renameFolder: async (folder, oldSubpath, newSubpath) => {
    await window.zen.renameFolder(folder, oldSubpath, newSubpath)
    await get().refreshNotes()
    // If the current view was inside the folder we just renamed,
    // rewrite its subpath so we stay on the same folder visually.
    const v = get().view
    if (v.kind === 'folder' && v.folder === folder) {
      if (v.subpath === oldSubpath) {
        set({ view: { ...v, subpath: newSubpath } })
      } else if (v.subpath.startsWith(`${oldSubpath}/`)) {
        const tail = v.subpath.slice(oldSubpath.length + 1)
        set({ view: { ...v, subpath: `${newSubpath}/${tail}` } })
      }
    }
    // Active note's path will have changed too — re-read it if needed.
    const active = get().activeNote
    if (active && active.folder === folder && active.path.includes(`/${oldSubpath}/`)) {
      // Find the renamed path by refreshing; the file-watcher race is
      // already handled by refreshNotes above. Re-read from the new
      // location if we can find it, otherwise drop the active note.
      const notes = get().notes
      const match = notes.find((n) => n.path.endsWith('/' + active.title + '.md'))
      if (match) await get().selectNote(match.path)
      else set({ activeNote: null, selectedPath: null })
    }
  },

  deleteFolder: async (folder, subpath) => {
    await window.zen.deleteFolder(folder, subpath)
    await get().refreshNotes()
    // If the current view lived inside the deleted folder, bounce
    // back to the top-level.
    const v = get().view
    if (
      v.kind === 'folder' &&
      v.folder === folder &&
      (v.subpath === subpath || v.subpath.startsWith(`${subpath}/`))
    ) {
      set({ view: { kind: 'folder', folder, subpath: '' } })
    }
    // Drop the active note if it was inside that folder.
    const active = get().activeNote
    if (active && active.path.startsWith(`${folder}/${subpath}/`)) {
      set({ activeNote: null, selectedPath: null })
    }
  },

  duplicateFolder: async (folder, subpath) => {
    const newSubpath = await window.zen.duplicateFolder(folder, subpath)
    await get().refreshNotes()
    set({ view: { kind: 'folder', folder, subpath: newSubpath } })
  },

  revealFolder: async (folder, subpath) => {
    await window.zen.revealFolder(folder, subpath)
  },

  moveNote: async (relPath, targetFolder, targetSubpath) => {
    try {
      const meta = await window.zen.moveNote(relPath, targetFolder, targetSubpath)
      await get().refreshNotes()
      // If the moved note was the currently open one, follow it.
      if (get().selectedPath === relPath) {
        await get().selectNote(meta.path)
      }
    } catch (err) {
      console.error('moveNote failed', err)
    }
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
      set({ vault, view: { kind: 'folder', folder: 'inbox', subpath: '' } })
      await get().refreshNotes()
    }
  }
}))
