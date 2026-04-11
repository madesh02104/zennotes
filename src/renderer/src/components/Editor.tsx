import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { vim, Vim } from '@replit/codemirror-vim'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { searchKeymap } from '@codemirror/search'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { useStore } from '../store'
import { livePreviewPlugin } from '../lib/cm-live-preview'
import { Preview } from './Preview'
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  ColumnsIcon,
  MoreIcon,
  PanelLeftIcon,
  TrashIcon
} from './icons'

// Register Zen-specific Vim actions + leader bindings once. The Vim
// singleton is initialized on import, so this runs before any view is
// constructed. Leader is Space (VS Code / Obsidian convention).
let vimConfigured = false
function configureVim(): void {
  if (vimConfigured) return
  vimConfigured = true

  // defineAction takes a (cm, actionArgs, vim) callback; we only need
  // to bounce into our zustand store. mapCommand then binds a key
  // sequence to that action in normal mode.
  Vim.defineAction('zenSearch', () => {
    useStore.getState().setSearchOpen(true)
  })
  Vim.defineAction('zenToggleNoteList', () => {
    useStore.getState().toggleNoteList()
  })
  Vim.defineAction('zenToggleSidebar', () => {
    useStore.getState().toggleSidebar()
  })
  Vim.defineAction('zenNewNote', () => {
    void useStore.getState().createAndOpen('inbox')
  })

  const ctx = { context: 'normal' as const }
  // <Space> f — fuzzy search
  Vim.mapCommand('<Space>f', 'action', 'zenSearch', {}, ctx)
  // <Space> e — toggle the note list (inbox column)
  Vim.mapCommand('<Space>e', 'action', 'zenToggleNoteList', {}, ctx)
  // <Space> b — toggle the main sidebar
  Vim.mapCommand('<Space>b', 'action', 'zenToggleSidebar', {}, ctx)
  // <Space> n — new note in inbox
  Vim.mapCommand('<Space>n', 'action', 'zenNewNote', {}, ctx)
}

const paperHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'tok-heading1' },
  { tag: t.heading2, class: 'tok-heading2' },
  { tag: t.heading3, class: 'tok-heading3' },
  { tag: t.heading4, class: 'tok-heading4' },
  { tag: t.heading5, class: 'tok-heading5' },
  { tag: t.heading6, class: 'tok-heading6' },
  { tag: t.emphasis, class: 'tok-emphasis' },
  { tag: t.strong, class: 'tok-strong' },
  { tag: t.link, class: 'tok-link' },
  { tag: t.url, class: 'tok-url' },
  { tag: t.monospace, class: 'tok-monospace' },
  { tag: t.quote, class: 'tok-quote' },
  { tag: t.list, class: 'tok-list' },
  { tag: t.meta, class: 'tok-meta' }
])

type Mode = 'edit' | 'preview'

export function Editor(): JSX.Element {
  const activeNote = useStore((s) => s.activeNote)
  const loading = useStore((s) => s.loadingNote)
  const updateActiveBody = useStore((s) => s.updateActiveBody)
  const persistActive = useStore((s) => s.persistActive)
  const trashActive = useStore((s) => s.trashActive)
  const archiveActive = useStore((s) => s.archiveActive)
  const restoreActive = useStore((s) => s.restoreActive)
  const unarchiveActive = useStore((s) => s.unarchiveActive)
  const renameActive = useStore((s) => s.renameActive)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const noteListOpen = useStore((s) => s.noteListOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const toggleNoteList = useStore((s) => s.toggleNoteList)
  const vimMode = useStore((s) => s.vimMode)
  const livePreview = useStore((s) => s.livePreview)
  const editorFontSize = useStore((s) => s.editorFontSize)
  const editorLineHeight = useStore((s) => s.editorLineHeight)
  const textFont = useStore((s) => s.textFont)

  const [mode, setMode] = useState<Mode>('edit')
  const viewRef = useRef<EditorView | null>(null)
  const vimCompartmentRef = useRef<Compartment | null>(null)
  const livePreviewCompartmentRef = useRef<Compartment | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void persistActive()
    }, 350)
  }, [persistActive])

  // Callback ref: create the CodeMirror view the moment the host div mounts,
  // and destroy it when the div detaches. This avoids the gotcha where a
  // useEffect gated on a ref runs before the ref is attached on first render.
  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        viewRef.current?.destroy()
        viewRef.current = null
        return
      }
      if (viewRef.current) return
      configureVim()
      // Vim and live-preview each live in their own Compartment so
      // toggling them at runtime just dispatches a reconfigure effect —
      // no view teardown, no lost state. Vim must be placed BEFORE the
      // default keymap so its bindings win.
      const vimCompartment = new Compartment()
      const livePreviewCompartment = new Compartment()
      vimCompartmentRef.current = vimCompartment
      livePreviewCompartmentRef.current = livePreviewCompartment
      const currentVim = useStore.getState().vimMode
      const currentLive = useStore.getState().livePreview
      const state = EditorState.create({
        doc: '',
        extensions: [
          vimCompartment.of(currentVim ? vim() : []),
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
          syntaxHighlighting(paperHighlight),
          livePreviewCompartment.of(currentLive ? livePreviewPlugin : []),
          autocompletion(),
          keymap.of([
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap
          ]),
          EditorView.updateListener.of((upd) => {
            if (!upd.docChanged) return
            const text = upd.state.doc.toString()
            updateActiveBody(text)
            scheduleSave()
          })
        ]
      })
      viewRef.current = new EditorView({ state, parent: el })
    },
    [scheduleSave, updateActiveBody]
  )

  // Toggle Vim extension without rebuilding the view.
  useEffect(() => {
    const view = viewRef.current
    const comp = vimCompartmentRef.current
    if (!view || !comp) return
    view.dispatch({
      effects: comp.reconfigure(vimMode ? vim() : [])
    })
  }, [vimMode])

  // Toggle live-preview decoration plugin.
  useEffect(() => {
    const view = viewRef.current
    const comp = livePreviewCompartmentRef.current
    if (!view || !comp) return
    view.dispatch({
      effects: comp.reconfigure(livePreview ? livePreviewPlugin : [])
    })
  }, [livePreview])

  // Font / line-height / font-family changes: CM caches line geometry
  // from the DOM, so a pure CSS change doesn't invalidate the cached
  // measurements. Nudge it on the next frame whenever these prefs move.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const raf = requestAnimationFrame(() => {
      view.requestMeasure()
    })
    return () => cancelAnimationFrame(raf)
  }, [editorFontSize, editorLineHeight, textFont])

  // When switching notes, replace the document wholesale (no history merge).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    const next = activeNote?.body ?? ''
    if (current === next) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next }
    })
  }, [activeNote?.path, activeNote?.body])

  // Flush pending save on unmount / when navigating away.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        void persistActive()
      }
    }
  }, [persistActive])

  const toolbar = useMemo(() => {
    if (!activeNote) return null
    const folder = activeNote.folder
    return (
      <div className="flex items-center gap-1 text-ink-500">
        <ToggleGroup mode={mode} onChange={setMode} />
        <div className="mx-2 h-4 w-px bg-paper-300" />
        {folder === 'trash' ? (
          <IconBtn title="Restore" onClick={() => void restoreActive()}>
            <ArrowUpRightIcon />
          </IconBtn>
        ) : folder === 'archive' ? (
          <IconBtn title="Unarchive" onClick={() => void unarchiveActive()}>
            <ArrowUpRightIcon />
          </IconBtn>
        ) : (
          <IconBtn title="Archive" onClick={() => void archiveActive()}>
            <ArchiveIcon />
          </IconBtn>
        )}
        <IconBtn title="Move to trash" onClick={() => void trashActive()}>
          <TrashIcon />
        </IconBtn>
        <IconBtn title="More" onClick={() => undefined}>
          <MoreIcon />
        </IconBtn>
      </div>
    )
  }, [activeNote, mode, trashActive, archiveActive, restoreActive, unarchiveActive])

  // Always mount the CodeMirror host so the view is created on first render,
  // even before a note is selected. Empty state is an overlay.
  const showEditor = !!activeNote && mode === 'edit'
  const showPreview = !!activeNote && mode === 'preview'

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {activeNote && (
        <header className="glass-header flex h-12 shrink-0 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {!sidebarOpen && (
              <IconBtn title="Show sidebar (⌘\)" onClick={toggleSidebar}>
                <PanelLeftIcon />
              </IconBtn>
            )}
            {!noteListOpen && (
              <IconBtn title="Show note list (⌘⇧\)" onClick={toggleNoteList}>
                <ColumnsIcon />
              </IconBtn>
            )}
            <TitleInput
              title={activeNote.title}
              onCommit={(v) => {
                if (v && v !== activeNote.title) void renameActive(v)
              }}
            />
          </div>
          {toolbar}
        </header>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/*
          Always mounted so the callback ref fires on first render. When not
          in edit mode, we hide via display:none — the view stays alive and
          keeps its cursor/history.
         */}
        <div
          ref={setContainerRef}
          className="min-h-0 min-w-0 flex-1"
          style={{ display: showEditor ? 'block' : 'none' }}
        />
        {showPreview && (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Preview markdown={activeNote!.body} />
          </div>
        )}
        {!activeNote && (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-400">
            {loading ? 'Loading…' : 'Select or create a note to start writing.'}
          </div>
        )}
      </div>
    </section>
  )
}

function ToggleGroup({
  mode,
  onChange
}: {
  mode: Mode
  onChange: (m: Mode) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 rounded-md bg-paper-200/70 p-0.5 text-xs">
      {(['edit', 'preview'] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={[
            'rounded px-2 py-1 transition-colors',
            mode === m ? 'bg-paper-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
          ].join(' ')}
        >
          {m === 'edit' ? 'Edit' : 'Preview'}
        </button>
      ))}
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title
}: {
  children: JSX.Element
  onClick: () => void
  title: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-ink-900"
    >
      {children}
    </button>
  )
}

function TitleInput({
  title,
  onCommit
}: {
  title: string
  onCommit: (v: string) => void
}): JSX.Element {
  const [value, setValue] = useState(title)
  useEffect(() => setValue(title), [title])
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          setValue(title)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className="w-[50%] min-w-[200px] max-w-[520px] truncate bg-transparent text-base font-semibold text-ink-900 outline-none placeholder:text-ink-400"
      style={{
        fontFamily:
          'var(--z-text-font, "SF Mono", "SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace)'
      }}
      placeholder="Untitled"
    />
  )
}
