import { useMemo } from 'react'
import { useStore } from '../store'
import type { NoteFolder } from '@shared/ipc'
import {
  ArchiveIcon,
  ChatIcon,
  FeedbackIcon,
  InboxIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TagIcon,
  TrashIcon
} from './icons'

export function Sidebar(): JSX.Element {
  const vault = useStore((s) => s.vault)
  const notes = useStore((s) => s.notes)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const createAndOpen = useStore((s) => s.createAndOpen)

  const counts = useMemo(() => {
    const c: Record<NoteFolder, number> = { inbox: 0, archive: 0, trash: 0 }
    for (const n of notes) c[n.folder] += 1
    return c
  }, [notes])

  // Tag extraction is handled in main; trash notes are excluded from the index.
  const tags = useMemo(() => {
    const counter = new Map<string, number>()
    for (const n of notes) {
      if (n.folder === 'trash') continue
      for (const t of n.tags) counter.set(t, (counter.get(t) ?? 0) + 1)
    }
    return [...counter.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [notes])

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-paper-300/70 bg-paper-50/70 px-3 pb-3 pt-3">
      <div className="flex items-center justify-between px-2 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-[11px] font-semibold text-white shadow-sm">
            {vault?.name.slice(0, 1).toUpperCase() ?? 'Z'}
          </div>
          <div className="truncate text-sm font-medium text-ink-800">
            {vault?.name ?? 'ZenNotes'}
          </div>
        </div>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-ink-800"
          onClick={() => void createAndOpen('inbox')}
          title="New note"
        >
          <PlusIcon />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5">
        <Row
          icon={<SearchIcon />}
          label="Search"
          onClick={() => setSearchOpen(true)}
          trailing={<kbd className="rounded bg-paper-200 px-1 py-0.5 text-[10px] text-ink-500">⌘K</kbd>}
        />
        <Row
          icon={<InboxIcon />}
          label="Inbox"
          count={counts.inbox}
          active={view.kind === 'folder' && view.folder === 'inbox'}
          onClick={() => setView({ kind: 'folder', folder: 'inbox' })}
        />
        <Row
          icon={<ArchiveIcon />}
          label="Archive"
          count={counts.archive}
          active={view.kind === 'folder' && view.folder === 'archive'}
          onClick={() => setView({ kind: 'folder', folder: 'archive' })}
        />
        <Row icon={<ChatIcon />} label="Chat" onClick={() => undefined} disabled />
      </nav>

      <div className="mt-5 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
        Tags <span className="text-ink-400">+</span>
      </div>

      <div className="flex max-h-[180px] flex-col gap-0.5 overflow-y-auto">
        {tags.length === 0 && (
          <div className="px-2 py-1 text-xs text-ink-400">No tags yet</div>
        )}
        {tags.map(([tag, count]) => (
          <Row
            key={tag}
            icon={<TagIcon />}
            label={tag}
            count={count}
            active={view.kind === 'tag' && view.tag === tag}
            onClick={() => setView({ kind: 'tag', tag })}
          />
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <Row icon={<SettingsIcon />} label="Settings" disabled onClick={() => undefined} />
        <Row icon={<FeedbackIcon />} label="Share feedback" disabled onClick={() => undefined} />
        <Row
          icon={<TrashIcon />}
          label="Trash"
          count={counts.trash}
          active={view.kind === 'folder' && view.folder === 'trash'}
          onClick={() => setView({ kind: 'folder', folder: 'trash' })}
        />
      </div>
    </aside>
  )
}

interface RowProps {
  icon: JSX.Element
  label: string
  count?: number
  trailing?: JSX.Element
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function Row({
  icon,
  label,
  count,
  trailing,
  active,
  disabled,
  onClick
}: RowProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'list-row group flex h-8 items-center gap-2 rounded-md px-2 text-sm',
        active
          ? 'bg-paper-200 text-ink-900'
          : 'text-ink-700 hover:bg-paper-200/70 hover:text-ink-900',
        disabled ? 'cursor-default opacity-60 hover:bg-transparent hover:text-ink-700' : ''
      ].join(' ')}
    >
      <span className={active ? 'text-accent' : 'text-ink-500 group-hover:text-ink-700'}>
        {icon}
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-xs text-ink-400">{count}</span>
      )}
      {trailing}
    </button>
  )
}
