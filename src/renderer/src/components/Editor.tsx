import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
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
import { StatusBar } from './StatusBar'
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  ColumnsIcon,
  MoreIcon,
  PanelLeftIcon,
  TrashIcon
} from './icons'

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
              <IconBtn title="Show sidebar (⌘1)" onClick={toggleSidebar}>
                <PanelLeftIcon />
              </IconBtn>
            )}
            {!noteListOpen && (
              <IconBtn title="Show note list (⌘2)" onClick={toggleNoteList}>
                <ColumnsIcon />
              </IconBtn>
            )}
            <Breadcrumb
              note={activeNote}
              onRename={(next) => {
                if (next && next !== activeNote.title) void renameActive(next)
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
      {activeNote && <StatusBar note={activeNote} />}
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

function Breadcrumb({
  note,
  onRename
}: {
  note: { path: string; title: string; folder: string }
  onRename: (next: string) => void
}): JSX.Element {
  const setView = useStore((s) => s.setView)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(note.title)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => setValue(note.title), [note.title])
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing])

  // `note.path` is vault-relative like "inbox/Work/Research/foo.md".
  // We render the trail of ancestor folders + the title as the last
  // segment. Every segment is the same `text-sm`, only the last is
  // bold — matching Obsidian's breadcrumb style.
  const parts = note.path.split('/')
  const topFolder = parts[0] as 'inbox' | 'archive' | 'trash'
  const segments = parts.slice(1, -1)

  const ancestors: { label: string; onClick: () => void }[] = [
    {
      label: topFolder.charAt(0).toUpperCase() + topFolder.slice(1),
      onClick: () => setView({ kind: 'folder', folder: topFolder, subpath: '' })
    }
  ]
  let acc = ''
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg
    const subpath = acc
    ancestors.push({
      label: seg,
      onClick: () => setView({ kind: 'folder', folder: topFolder, subpath })
    })
  }

  return (
    <div className="flex min-w-0 shrink items-center gap-1 overflow-hidden text-sm text-ink-500">
      {ancestors.map((c, i) => (
        <span key={i} className="flex shrink-0 items-center gap-1">
          <button
            onClick={c.onClick}
            className="truncate rounded px-1 hover:bg-paper-200/70 hover:text-ink-800"
            title={`Go to ${c.label}`}
          >
            {c.label}
          </button>
          <span className="text-ink-400">›</span>
        </span>
      ))}
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            onRename(value.trim())
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              setValue(note.title)
              setEditing(false)
            }
          }}
          className="min-w-[80px] max-w-[360px] rounded bg-paper-200/60 px-1 text-sm font-semibold text-ink-900 outline-none"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
          className="truncate rounded px-1 text-sm font-semibold text-ink-900 hover:bg-paper-200/70"
        >
          {note.title || 'Untitled'}
        </button>
      )}
    </div>
  )
}

