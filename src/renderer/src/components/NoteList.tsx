import { useMemo } from 'react'
import { useStore } from '../store'
import type { NoteMeta } from '@shared/ipc'
import { PlusIcon } from './icons'

function formatDate(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric'
  })
}

export function NoteList(): JSX.Element {
  const notes = useStore((s) => s.notes)
  const view = useStore((s) => s.view)
  const selectedPath = useStore((s) => s.selectedPath)
  const selectNote = useStore((s) => s.selectNote)
  const createAndOpen = useStore((s) => s.createAndOpen)
  const emptyTrash = async (): Promise<void> => {
    await window.zen.emptyTrash()
    await useStore.getState().refreshNotes()
  }

  const filtered = useMemo<NoteMeta[]>(() => {
    if (view.kind === 'folder') {
      return notes.filter((n) => n.folder === view.folder)
    }
    return notes.filter((n) => n.folder !== 'trash' && n.tags.includes(view.tag))
  }, [notes, view])

  const heading =
    view.kind === 'folder'
      ? view.folder[0].toUpperCase() + view.folder.slice(1)
      : `#${view.tag}`

  const newTargetFolder = view.kind === 'folder' && view.folder !== 'trash' ? view.folder : 'inbox'

  return (
    <section className="flex w-[300px] shrink-0 flex-col border-r border-paper-300/70 bg-paper-100">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-paper-300/70 px-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink-900">{heading}</h2>
          <span className="text-xs text-ink-400">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {view.kind === 'folder' && view.folder === 'trash' && filtered.length > 0 && (
            <button
              onClick={() => void emptyTrash()}
              className="rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-paper-200 hover:text-ink-800"
            >
              Empty
            </button>
          )}
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-ink-800"
            title="New note"
            onClick={() => void createAndOpen(newTargetFolder)}
          >
            <PlusIcon />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-400">
            {view.kind === 'folder' && view.folder === 'trash'
              ? 'Trash is empty.'
              : 'No notes yet.'}
          </div>
        ) : (
          filtered.map((n) => (
            <NoteRow
              key={n.path}
              note={n}
              active={n.path === selectedPath}
              onSelect={() => void selectNote(n.path)}
            />
          ))
        )}
      </div>
    </section>
  )
}

function NoteRow({
  note,
  active,
  onSelect
}: {
  note: NoteMeta
  active: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      className={[
        'list-row mb-1 flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left',
        active
          ? 'bg-paper-200 shadow-[inset_0_0_0_1px_rgba(233,123,60,0.18)]'
          : 'hover:bg-paper-200/60'
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink-900">{note.title}</span>
        <span className="shrink-0 text-[11px] text-ink-400">{formatDate(note.updatedAt)}</span>
      </div>
      <span className="line-clamp-2 text-xs text-ink-500">
        {note.excerpt || 'Empty note'}
      </span>
    </button>
  )
}
