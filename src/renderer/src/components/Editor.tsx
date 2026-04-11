import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { searchKeymap } from '@codemirror/search'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { useStore } from '../store'
import { Preview } from './Preview'
import { ArchiveIcon, ArrowUpRightIcon, MoreIcon, TrashIcon } from './icons'

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

  const [mode, setMode] = useState<Mode>('edit')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void persistActive()
    }, 350)
  }, [persistActive])

  // Initialize editor once, then swap documents when the active note changes.
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return
    const state = EditorState.create({
      doc: '',
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
        syntaxHighlighting(paperHighlight),
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
    viewRef.current = new EditorView({ state, parent: containerRef.current })
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [scheduleSave, updateActiveBody])

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

  if (!activeNote) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center bg-paper-50/50 text-ink-400">
        <div className="text-sm">
          {loading ? 'Loading…' : 'Select or create a note to start writing.'}
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-paper-50/40">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-paper-300/70 px-6">
        <TitleInput
          title={activeNote.title}
          onCommit={(v) => {
            if (v && v !== activeNote.title) void renameActive(v)
          }}
        />
        {toolbar}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === 'edit' ? (
          <div ref={containerRef} className="h-full" />
        ) : (
          <Preview markdown={activeNote.body} />
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
      placeholder="Untitled"
    />
  )
}
