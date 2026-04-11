import { useMemo, useState } from 'react'
import { useStore } from '../store'
import type { NoteMeta } from '@shared/ipc'
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  ColumnsIcon,
  PlusIcon,
  TrashIcon
} from './icons'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { extractTags } from '../lib/tags'

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
  const activeNote = useStore((s) => s.activeNote)
  const view = useStore((s) => s.view)
  const selectedPath = useStore((s) => s.selectedPath)
  const selectNote = useStore((s) => s.selectNote)
  const createAndOpen = useStore((s) => s.createAndOpen)
  const toggleNoteList = useStore((s) => s.toggleNoteList)
  const refreshNotes = useStore((s) => s.refreshNotes)
  const [menu, setMenu] = useState<{ x: number; y: number; note: NoteMeta } | null>(null)
  const emptyTrash = async (): Promise<void> => {
    await window.zen.emptyTrash()
    await useStore.getState().refreshNotes()
  }

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return []
    const n = menu.note
    const onOpen = async (): Promise<void> => {
      await selectNote(n.path)
    }
    const onDuplicate = async (): Promise<void> => {
      const meta = await window.zen.duplicateNote(n.path)
      await refreshNotes()
      await selectNote(meta.path)
    }
    const onReveal = async (): Promise<void> => {
      await window.zen.revealNote(n.path)
    }
    const onCopyWikilink = async (): Promise<void> => {
      await navigator.clipboard.writeText(`[[${n.title}]]`)
    }
    const onArchive = async (): Promise<void> => {
      await window.zen.archiveNote(n.path)
      await refreshNotes()
      if (selectedPath === n.path) await selectNote(null)
    }
    const onUnarchive = async (): Promise<void> => {
      const meta = await window.zen.unarchiveNote(n.path)
      await refreshNotes()
      if (selectedPath === n.path) await selectNote(meta.path)
    }
    const onTrash = async (): Promise<void> => {
      await window.zen.moveToTrash(n.path)
      await refreshNotes()
      if (selectedPath === n.path) await selectNote(null)
    }
    const onRestore = async (): Promise<void> => {
      const meta = await window.zen.restoreFromTrash(n.path)
      await refreshNotes()
      if (selectedPath === n.path) await selectNote(meta.path)
    }
    const onDeleteForever = async (): Promise<void> => {
      await window.zen.deleteNote(n.path)
      await refreshNotes()
      if (selectedPath === n.path) await selectNote(null)
    }
    const onNew = async (): Promise<void> => {
      await useStore
        .getState()
        .createAndOpen(n.folder === 'trash' ? 'inbox' : n.folder)
    }

    const items: ContextMenuItem[] = []
    items.push({ label: 'Open', icon: <ArrowUpRightIcon />, onSelect: onOpen })

    if (n.folder !== 'trash') {
      items.push({ label: 'New Note', icon: <PlusIcon />, onSelect: onNew, hint: '⌘N' })
      items.push({ label: 'Duplicate', onSelect: onDuplicate })
    }
    items.push({ label: 'Copy as Wiki Link', onSelect: onCopyWikilink })
    items.push({ label: 'Reveal in Finder', onSelect: onReveal })
    items.push({ kind: 'separator' })

    if (n.folder === 'inbox') {
      items.push({ label: 'Archive', icon: <ArchiveIcon />, onSelect: onArchive })
      items.push({
        label: 'Move to Trash',
        icon: <TrashIcon />,
        danger: true,
        onSelect: onTrash
      })
    } else if (n.folder === 'archive') {
      items.push({
        label: 'Move to Inbox',
        icon: <ArrowUpRightIcon />,
        onSelect: onUnarchive
      })
      items.push({
        label: 'Move to Trash',
        icon: <TrashIcon />,
        danger: true,
        onSelect: onTrash
      })
    } else {
      items.push({
        label: 'Restore',
        icon: <ArrowUpRightIcon />,
        onSelect: onRestore
      })
      items.push({
        label: 'Delete Permanently',
        icon: <TrashIcon />,
        danger: true,
        onSelect: onDeleteForever
      })
    }

    return items
  }, [menu, refreshNotes, selectedPath, selectNote])

  const filtered = useMemo<NoteMeta[]>(() => {
    if (view.kind === 'folder') {
      return notes.filter((n) => n.folder === view.folder)
    }
    // Tag view: use live-extracted tags for the currently-open note so
    // newly typed hashtags are reflected immediately.
    return notes.filter((n) => {
      if (n.folder === 'trash') return false
      if (activeNote && activeNote.path === n.path) {
        return extractTags(activeNote.body).includes(view.tag)
      }
      return n.tags.includes(view.tag)
    })
  }, [notes, view, activeNote])

  const heading =
    view.kind === 'folder'
      ? view.folder[0].toUpperCase() + view.folder.slice(1)
      : `#${view.tag}`

  const newTargetFolder = view.kind === 'folder' && view.folder !== 'trash' ? view.folder : 'inbox'

  return (
    <section className="glass-column flex w-[300px] shrink-0 flex-col">
      <header className="glass-header flex h-12 shrink-0 items-center justify-between px-4">
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
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-ink-800"
            title="Hide note list (⌘⇧\)"
            onClick={toggleNoteList}
          >
            <ColumnsIcon />
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
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, note: n })
              }}
            />
          ))
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  )
}

function NoteRow({
  note,
  active,
  onSelect,
  onContextMenu
}: {
  note: NoteMeta
  active: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={[
        'list-row mb-1 flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left',
        active ? 'bg-paper-200' : 'hover:bg-paper-200/60'
      ].join(' ')}
      style={
        active
          ? { boxShadow: 'inset 0 0 0 1px rgb(var(--z-accent) / 0.35)' }
          : undefined
      }
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
