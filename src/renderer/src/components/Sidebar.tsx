import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { extractTags } from '../lib/tags'
import type { NoteFolder, NoteMeta } from '@shared/ipc'
import type { NoteSortOrder } from '../store'
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  ExpandAllIcon,
  FolderPlusIcon,
  InboxIcon,
  NotePlusIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SortIcon,
  TargetIcon,
  TrashIcon
} from './icons'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ResizeHandle } from './ResizeHandle'
import { VaultBadge } from './VaultBadge'
import { usePrompt } from './PromptModal'
import {
  hasZenItem,
  readDragPayload,
  setDragPayload,
  type DragPayload
} from '../lib/dnd'

export function Sidebar(): JSX.Element {
  const vault = useStore((s) => s.vault)
  const notes = useStore((s) => s.notes)
  const allFolders = useStore((s) => s.folders)
  const activeNote = useStore((s) => s.activeNote)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const createAndOpen = useStore((s) => s.createAndOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const renameTag = useStore((s) => s.renameTag)
  const deleteTag = useStore((s) => s.deleteTag)
  const createFolderAction = useStore((s) => s.createFolder)
  const renameFolderAction = useStore((s) => s.renameFolder)
  const deleteFolderAction = useStore((s) => s.deleteFolder)
  const duplicateFolderAction = useStore((s) => s.duplicateFolder)
  const revealFolderAction = useStore((s) => s.revealFolder)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const noteSortOrder = useStore((s) => s.noteSortOrder)
  const setNoteSortOrder = useStore((s) => s.setNoteSortOrder)
  const autoReveal = useStore((s) => s.autoReveal)
  const setAutoReveal = useStore((s) => s.setAutoReveal)
  const unifiedSidebar = useStore((s) => s.unifiedSidebar)
  const selectNote = useStore((s) => s.selectNote)
  const selectedPath = useStore((s) => s.selectedPath)
  const moveNoteAction = useStore((s) => s.moveNote)
  const renameActive = useStore((s) => s.renameActive)
  const { prompt, modal: promptModal } = usePrompt()

  /**
   * Handle a drag-drop onto a folder (top-level or subfolder). Both
   * notes and folders can be dropped — notes become members of the
   * target folder, folders get reparented.
   */
  const handleDropOnFolder = async (
    payload: DragPayload,
    targetFolder: NoteFolder,
    targetSubpath: string
  ): Promise<void> => {
    if (payload.kind === 'note') {
      // Skip if dropping back into the same container.
      const curParts = payload.path.split('/')
      const curSub = curParts.slice(1, -1).join('/')
      const curFolder = curParts[0] as NoteFolder
      if (curFolder === targetFolder && curSub === targetSubpath) return
      await moveNoteAction(payload.path, targetFolder, targetSubpath)
      return
    }
    // Folder drop — cross-top-folder moves aren't supported (folders
    // can't move between inbox/archive/trash). Same-top-folder moves
    // reparent the subfolder.
    if (payload.folder !== targetFolder) {
      window.alert('Folders can only be moved within the same top-level folder.')
      return
    }
    if (!payload.subpath) return // top-level folder can't be moved
    const leaf = payload.subpath.split('/').slice(-1)[0]
    const nextSubpath = targetSubpath ? `${targetSubpath}/${leaf}` : leaf
    if (nextSubpath === payload.subpath) return
    if ((nextSubpath + '/').startsWith(payload.subpath + '/')) {
      // Moving into self / descendant.
      return
    }
    try {
      await renameFolderAction(payload.folder, payload.subpath, nextSubpath)
    } catch (err) {
      window.alert((err as Error).message)
    }
  }

  const [tagMenu, setTagMenu] = useState<{
    x: number
    y: number
    tag: string
  } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{
    x: number
    y: number
    folder: NoteFolder
    subpath: string // "" for top-level
  } | null>(null)
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const [noteMenu, setNoteMenu] = useState<{
    x: number
    y: number
    note: NoteMeta
  } | null>(null)
  const refreshNotes = useStore((s) => s.refreshNotes)
  const collapsedList = useStore((s) => s.collapsedFolders)
  const toggleCollapseAction = useStore((s) => s.toggleCollapseFolder)
  const setCollapsedFoldersAction = useStore((s) => s.setCollapsedFolders)
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList])
  const toggleCollapse = toggleCollapseAction
  const setCollapsed = (next: Set<string>): void =>
    setCollapsedFoldersAction([...next])

  // Build a folder tree per top-level (inbox + archive). Uses the
  // folders index from main so empty subfolders still appear in the
  // tree alongside ones that have notes. Trash is rendered separately.
  const trees = useMemo(
    () => ({
      inbox: buildTree(
        notes.filter((n) => n.folder === 'inbox'),
        'inbox',
        allFolders.filter((f) => f.folder === 'inbox')
      ),
      archive: buildTree(
        notes.filter((n) => n.folder === 'archive'),
        'archive',
        allFolders.filter((f) => f.folder === 'archive')
      )
    }),
    [notes, allFolders]
  )

  const trashCount = useMemo(
    () => notes.filter((n) => n.folder === 'trash').length,
    [notes]
  )

  const treeSortComparator = useMemo(() => {
    switch (noteSortOrder) {
      case 'updated-asc':
        return (a: NoteMeta, b: NoteMeta) => a.updatedAt - b.updatedAt
      case 'created-desc':
        return (a: NoteMeta, b: NoteMeta) => b.createdAt - a.createdAt
      case 'created-asc':
        return (a: NoteMeta, b: NoteMeta) => a.createdAt - b.createdAt
      case 'name-asc':
        return (a: NoteMeta, b: NoteMeta) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      case 'name-desc':
        return (a: NoteMeta, b: NoteMeta) =>
          b.title.localeCompare(a.title, undefined, { sensitivity: 'base' })
      case 'updated-desc':
      default:
        return (a: NoteMeta, b: NoteMeta) => b.updatedAt - a.updatedAt
    }
  }, [noteSortOrder])

  /** All folder keys currently present in the tree, for expand/collapse-all. */
  const allFolderKeys = useMemo(() => {
    const keys: string[] = []
    const walk = (folder: NoteFolder, node: TreeNode): void => {
      // Include the top-level root key too.
      for (const child of node.children) {
        keys.push(`${folder}:${child.subpath}`)
        walk(folder, child)
      }
    }
    keys.push('inbox:')
    walk('inbox', trees.inbox)
    keys.push('archive:')
    walk('archive', trees.archive)
    return keys
  }, [trees])

  const collapseAll = (): void => setCollapsed(new Set(allFolderKeys))
  const expandAll = (): void => setCollapsed(new Set())

  /**
   * Auto-reveal: whenever the active note changes, expand every
   * ancestor folder so the note is visible in the sidebar tree.
   * Only runs when the `autoReveal` preference is on.
   */
  const activePath = activeNote?.path
  useEffect(() => {
    if (!autoReveal || !activePath) return
    const parts = activePath.split('/')
    const folder = parts[0] as NoteFolder
    // Collect every ancestor key we need to make sure is expanded.
    const ancestors: string[] = [`${folder}:`]
    let acc = ''
    for (let i = 1; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      ancestors.push(`${folder}:${acc}`)
    }
    const prev = new Set(useStore.getState().collapsedFolders)
    let changed = false
    for (const key of ancestors) {
      if (prev.has(key)) {
        prev.delete(key)
        changed = true
      }
    }
    if (changed) setCollapsedFoldersAction([...prev])
  }, [autoReveal, activePath, setCollapsedFoldersAction])

  // Aggregate hashtags across non-trash notes, with the active note
  // re-computed from its live body.
  const tags = useMemo(() => {
    const counter = new Map<string, number>()
    for (const n of notes) {
      if (n.folder === 'trash') continue
      const isActive = activeNote && activeNote.path === n.path
      const list = isActive ? extractTags(activeNote!.body) : n.tags
      for (const t of list) counter.set(t, (counter.get(t) ?? 0) + 1)
    }
    return [...counter.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [notes, activeNote])

  const folderMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!folderMenu) return []
    const { folder, subpath } = folderMenu
    const isTop = subpath === ''
    const label = isTop ? folder : subpath.split('/').slice(-1)[0]

    const items: ContextMenuItem[] = [
      {
        label: 'New note',
        onSelect: async () => {
          await createAndOpen(folder, subpath)
        }
      },
      {
        label: 'New folder',
        onSelect: async () => {
          const name = await prompt({
            title: `New folder inside "${label}"`,
            placeholder: 'Folder name',
            okLabel: 'Create',
            validate: (v) => {
              if (v.includes('/')) return 'Folder name cannot contain "/"'
              return null
            }
          })
          if (!name) return
          const clean = name.trim().replace(/^\/+|\/+$/g, '')
          if (!clean) return
          const nextSubpath = subpath ? `${subpath}/${clean}` : clean
          try {
            await createFolderAction(folder, nextSubpath)
          } catch (err) {
            window.alert((err as Error).message)
          }
        }
      }
    ]

    if (!isTop) {
      items.push({ kind: 'separator' })
      items.push({
        label: 'Duplicate',
        onSelect: async () => {
          try {
            await duplicateFolderAction(folder, subpath)
          } catch (err) {
            window.alert((err as Error).message)
          }
        }
      })
    }

    items.push({ kind: 'separator' })
    items.push({
      label: 'Reveal in Finder',
      onSelect: async () => {
        await revealFolderAction(folder, subpath)
      }
    })
    items.push({
      label: 'Copy path',
      onSelect: async () => {
        const root = vault?.root ?? ''
        const parts = [root, folder, ...subpath.split('/').filter(Boolean)]
        await navigator.clipboard.writeText(parts.join('/'))
      }
    })

    if (!isTop) {
      items.push({ kind: 'separator' })
      items.push({
        label: 'Rename…',
        onSelect: async () => {
          const leaf = subpath.split('/').slice(-1)[0]
          const next = await prompt({
            title: 'Rename folder',
            initialValue: leaf,
            okLabel: 'Rename',
            validate: (v) => {
              if (v.includes('/')) return 'Use only a leaf name'
              return null
            }
          })
          if (!next) return
          const clean = next.trim().replace(/^\/+|\/+$/g, '')
          if (!clean || clean === leaf) return
          const parent = subpath.split('/').slice(0, -1).join('/')
          const nextSubpath = parent ? `${parent}/${clean}` : clean
          try {
            await renameFolderAction(folder, subpath, nextSubpath)
          } catch (err) {
            window.alert((err as Error).message)
          }
        }
      })
      items.push({
        label: 'Delete folder…',
        danger: true,
        onSelect: async () => {
          const ok = window.confirm(
            `Delete "${subpath}" and everything inside it? This cannot be undone.`
          )
          if (!ok) return
          try {
            await deleteFolderAction(folder, subpath)
          } catch (err) {
            window.alert((err as Error).message)
          }
        }
      })
    }

    return items
  }, [
    folderMenu,
    vault,
    createAndOpen,
    createFolderAction,
    renameFolderAction,
    deleteFolderAction,
    duplicateFolderAction,
    revealFolderAction,
    prompt
  ])

  const noteMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!noteMenu) return []
    const n = noteMenu.note
    const items: ContextMenuItem[] = [
      {
        label: 'Open',
        onSelect: async () => {
          await selectNote(n.path)
        }
      }
    ]
    if (n.folder !== 'trash') {
      items.push({
        label: 'Rename…',
        onSelect: async () => {
          const next = await prompt({
            title: 'Rename note',
            initialValue: n.title,
            okLabel: 'Rename',
            validate: (v) => {
              if (/[\\/]/.test(v)) return 'Title cannot contain / or \\'
              return null
            }
          })
          if (!next || next === n.title) return
          // If this note is currently open, use the live renameActive
          // so the editor state follows along. Otherwise rename via IPC.
          if (selectedPath === n.path) {
            await renameActive(next)
          } else {
            await window.zen.renameNote(n.path, next)
            await refreshNotes()
          }
        }
      })
      items.push({
        label: 'Duplicate',
        onSelect: async () => {
          const meta = await window.zen.duplicateNote(n.path)
          await refreshNotes()
          await selectNote(meta.path)
        }
      })
    }
    items.push({
      label: 'Copy as Wiki Link',
      onSelect: async () => {
        await navigator.clipboard.writeText(`[[${n.title}]]`)
      }
    })
    items.push({
      label: 'Reveal in Finder',
      onSelect: async () => {
        await window.zen.revealNote(n.path)
      }
    })
    items.push({ kind: 'separator' })
    if (n.folder === 'inbox') {
      items.push({
        label: 'Archive',
        icon: <ArchiveIcon />,
        onSelect: async () => {
          await window.zen.archiveNote(n.path)
          await refreshNotes()
          if (selectedPath === n.path) await selectNote(null)
        }
      })
      items.push({
        label: 'Move to Trash',
        icon: <TrashIcon />,
        danger: true,
        onSelect: async () => {
          await window.zen.moveToTrash(n.path)
          await refreshNotes()
          if (selectedPath === n.path) await selectNote(null)
        }
      })
    } else if (n.folder === 'archive') {
      items.push({
        label: 'Move to Inbox',
        icon: <ArrowUpRightIcon />,
        onSelect: async () => {
          const meta = await window.zen.unarchiveNote(n.path)
          await refreshNotes()
          if (selectedPath === n.path) await selectNote(meta.path)
        }
      })
      items.push({
        label: 'Move to Trash',
        icon: <TrashIcon />,
        danger: true,
        onSelect: async () => {
          await window.zen.moveToTrash(n.path)
          await refreshNotes()
          if (selectedPath === n.path) await selectNote(null)
        }
      })
    } else {
      items.push({
        label: 'Restore',
        icon: <ArrowUpRightIcon />,
        onSelect: async () => {
          const meta = await window.zen.restoreFromTrash(n.path)
          await refreshNotes()
          if (selectedPath === n.path) await selectNote(meta.path)
        }
      })
      items.push({
        label: 'Delete Permanently',
        icon: <TrashIcon />,
        danger: true,
        onSelect: async () => {
          await window.zen.deleteNote(n.path)
          await refreshNotes()
          if (selectedPath === n.path) await selectNote(null)
        }
      })
    }
    return items
  }, [
    noteMenu,
    selectNote,
    selectedPath,
    refreshNotes,
    createAndOpen,
    prompt,
    renameActive
  ])

  const tagMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!tagMenu) return []
    const tag = tagMenu.tag
    return [
      {
        label: `Copy #${tag}`,
        onSelect: async () => {
          await navigator.clipboard.writeText(`#${tag}`)
        }
      },
      {
        label: 'Rename tag…',
        onSelect: async () => {
          const next = await prompt({
            title: `Rename #${tag}`,
            initialValue: tag,
            okLabel: 'Rename',
            validate: (v) => {
              const clean = v.replace(/^#/, '').trim()
              if (!/^[a-zA-Z][\w\-/]*$/.test(clean)) {
                return 'Tag must start with a letter and contain only letters, digits, -, _, or /'
              }
              return null
            }
          })
          if (!next) return
          const clean = next.replace(/^#/, '').trim()
          if (!clean || clean === tag) return
          await renameTag(tag, clean)
        }
      },
      { kind: 'separator' },
      {
        label: 'Delete tag from all notes',
        danger: true,
        onSelect: async () => {
          const ok = window.confirm(
            `Remove #${tag} from every note that contains it? The notes themselves are left intact.`
          )
          if (!ok) return
          await deleteTag(tag)
        }
      }
    ]
  }, [tagMenu, renameTag, deleteTag, prompt])

  // A folder only shows the strong "selected" accent highlight when
  // the view matches AND no specific note is selected. Once the user
  // opens a note, the note row owns the selection visual and the
  // parent folders drop back to a neutral state.
  const isFolderActive = (folder: NoteFolder, subpath: string): boolean =>
    !selectedPath &&
    view.kind === 'folder' &&
    view.folder === folder &&
    view.subpath === subpath

  const openFolderMenu = (
    e: React.MouseEvent,
    folder: NoteFolder,
    subpath: string
  ): void => {
    e.preventDefault()
    setFolderMenu({ x: e.clientX, y: e.clientY, folder, subpath })
  }

  return (
    <aside
      className="glass-sidebar relative flex shrink-0 flex-col pb-3 pt-3"
      style={{ width: sidebarWidth }}
    >
      {/* Vault header + top-right actions */}
      <div className="flex items-center justify-between px-3 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <VaultBadge name={vault?.name ?? 'ZenNotes'} size={28} />
          <div className="truncate text-sm font-medium text-ink-800">
            {vault?.name ?? 'ZenNotes'}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconBtn
            title="New note"
            onClick={() => void createAndOpen('inbox')}
          >
            <PlusIcon />
          </IconBtn>
          <IconBtn title="Hide sidebar (⌘1)" onClick={toggleSidebar}>
            <PanelLeftIcon />
          </IconBtn>
        </div>
      </div>

      {/* Search + toolbar on one row */}
      <div className="flex items-center gap-1 px-3">
        <button
          onClick={() => setSearchOpen(true)}
          className="group flex h-7 flex-1 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-ink-700 transition-colors hover:bg-paper-200/70 hover:text-ink-900"
          title="Search (⌘P)"
        >
          <SearchIcon />
          <span className="flex-1 truncate">Search</span>
          <kbd className="rounded bg-paper-200 px-1 py-0.5 text-[10px] text-ink-500">
            ⌘P
          </kbd>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
        <IconBtn
          title="New note"
          onClick={() => {
            const view = useStore.getState().view
            const target =
              view.kind === 'folder' && view.folder !== 'trash'
                ? { folder: view.folder, sub: view.subpath }
                : { folder: 'inbox' as NoteFolder, sub: '' }
            void createAndOpen(target.folder, target.sub)
          }}
        >
          <NotePlusIcon />
        </IconBtn>
        <IconBtn
          title="New folder"
          onClick={async () => {
            const view = useStore.getState().view
            const parentFolder: NoteFolder =
              view.kind === 'folder' && view.folder !== 'trash' ? view.folder : 'inbox'
            const parentSub =
              view.kind === 'folder' && view.folder !== 'trash' ? view.subpath : ''
            const name = await prompt({
              title: 'New folder',
              placeholder: 'Folder name',
              okLabel: 'Create',
              validate: (v) => {
                if (v.includes('/')) return 'Folder name cannot contain "/"'
                return null
              }
            })
            if (!name) return
            const clean = name.trim().replace(/^\/+|\/+$/g, '')
            if (!clean) return
            const next = parentSub ? `${parentSub}/${clean}` : clean
            try {
              await createFolderAction(parentFolder, next)
            } catch (err) {
              window.alert((err as Error).message)
            }
          }}
        >
          <FolderPlusIcon />
        </IconBtn>
        <IconBtn
          title={`Sort: ${sortOrderLabel(noteSortOrder)}`}
          onClick={(e) => setSortMenu({ x: e.clientX, y: e.clientY })}
        >
          <SortIcon />
        </IconBtn>
        <IconBtn
          title={autoReveal ? 'Auto-reveal: on' : 'Auto-reveal: off'}
          onClick={() => setAutoReveal(!autoReveal)}
          active={autoReveal}
        >
          <TargetIcon />
        </IconBtn>
        <IconBtn
          title="Collapse all"
          onClick={() => (collapsed.size >= allFolderKeys.length ? expandAll() : collapseAll())}
        >
          <ExpandAllIcon />
        </IconBtn>
        </div>
      </div>

      {/* Main scrollable tree area */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-3">
        <FolderTreeRoot
          label="Inbox"
          icon={<InboxIcon />}
          folder="inbox"
          tree={trees.inbox}
          isFolderActive={isFolderActive}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          setView={setView}
          onContextMenu={openFolderMenu}
          showNotes={unifiedSidebar}
          selectedPath={selectedPath}
          onSelectNote={(p) => void selectNote(p)}
          onNoteContextMenu={(e, n) => {
            e.preventDefault()
            setNoteMenu({ x: e.clientX, y: e.clientY, note: n })
          }}
          sortComparator={treeSortComparator}
          onDropOnFolder={handleDropOnFolder}
        />

        <FolderTreeRoot
          label="Archive"
          icon={<ArchiveIcon />}
          folder="archive"
          tree={trees.archive}
          isFolderActive={isFolderActive}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          setView={setView}
          onContextMenu={openFolderMenu}
          showNotes={unifiedSidebar}
          selectedPath={selectedPath}
          onSelectNote={(p) => void selectNote(p)}
          onNoteContextMenu={(e, n) => {
            e.preventDefault()
            setNoteMenu({ x: e.clientX, y: e.clientY, note: n })
          }}
          sortComparator={treeSortComparator}
          onDropOnFolder={handleDropOnFolder}
        />

        {/* Tag pills */}
        {tags.length > 0 && (
          <div className="mt-5">
            <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Tags
            </div>
            <div className="flex flex-wrap gap-1.5 px-1">
              {tags.map(([tag, count]) => {
                const active = view.kind === 'tag' && view.tag === tag
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      if (active) {
                        // Deselect: bounce back to the inbox root.
                        setView({ kind: 'folder', folder: 'inbox', subpath: '' })
                      } else {
                        setView({ kind: 'tag', tag })
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setTagMenu({ x: e.clientX, y: e.clientY, tag })
                    }}
                    className={[
                      'rounded-full px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'bg-accent text-white'
                        : 'bg-paper-200 text-ink-800 hover:bg-paper-300'
                    ].join(' ')}
                  >
                    #{tag}
                    <span
                      className={[
                        'ml-1 text-[10px]',
                        active ? 'text-white/80' : 'text-ink-500'
                      ].join(' ')}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer: Settings + Trash */}
      <div
        className="mt-2 flex flex-col gap-0.5 px-3 pt-2"
        style={{ borderTop: '1px solid var(--glass-stroke)' }}
      >
        <SidebarRow
          icon={<SettingsIcon />}
          label="Settings"
          onClick={() => setSettingsOpen(true)}
        />
        <SidebarRow
          icon={<TrashIcon />}
          label="Trash"
          count={trashCount}
          active={isFolderActive('trash', '')}
          onClick={() => setView({ kind: 'folder', folder: 'trash', subpath: '' })}
        />
      </div>

      {tagMenu && (
        <ContextMenu
          x={tagMenu.x}
          y={tagMenu.y}
          items={tagMenuItems}
          onClose={() => setTagMenu(null)}
        />
      )}
      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={folderMenuItems}
          onClose={() => setFolderMenu(null)}
        />
      )}
      {noteMenu && (
        <ContextMenu
          x={noteMenu.x}
          y={noteMenu.y}
          items={noteMenuItems}
          onClose={() => setNoteMenu(null)}
        />
      )}
      {promptModal}
      {sortMenu && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          items={(
            [
              ['updated-desc', 'Modified (newest first)'],
              ['updated-asc', 'Modified (oldest first)'],
              ['created-desc', 'Created (newest first)'],
              ['created-asc', 'Created (oldest first)'],
              ['name-asc', 'Name (A → Z)'],
              ['name-desc', 'Name (Z → A)']
            ] as const
          ).map(([id, label]) => ({
            label: `${noteSortOrder === id ? '✓  ' : '    '}${label}`,
            onSelect: () => setNoteSortOrder(id as NoteSortOrder)
          }))}
          onClose={() => setSortMenu(null)}
        />
      )}

      <ResizeHandle
        getWidth={() => sidebarWidth}
        onResize={(next) => {
          if (next === 0) return
          setSidebarWidth(next)
        }}
      />
    </aside>
  )
}

/* ---------- Folder tree data ---------- */

interface TreeNode {
  name: string
  subpath: string
  notes: NoteMeta[]
  children: TreeNode[]
}

function buildTree(
  notes: NoteMeta[],
  topFolder: NoteFolder,
  folders: { folder: NoteFolder; subpath: string }[]
): TreeNode {
  const root: TreeNode = {
    name: topFolder,
    subpath: '',
    notes: [],
    children: []
  }
  const byPath = new Map<string, TreeNode>()
  byPath.set('', root)

  const ensureFolder = (subpath: string): TreeNode => {
    const existing = byPath.get(subpath)
    if (existing) return existing
    const segments = subpath.split('/')
    let parent = root
    let acc = ''
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg
      let node = byPath.get(acc)
      if (!node) {
        node = { name: seg, subpath: acc, notes: [], children: [] }
        byPath.set(acc, node)
        parent.children.push(node)
      }
      parent = node
    }
    return parent
  }

  // First pass: create nodes for every folder on disk (this is what
  // keeps empty folders visible in the tree).
  for (const f of folders) {
    if (!f.subpath) continue
    ensureFolder(f.subpath)
  }

  // Second pass: place every note inside its parent folder node.
  for (const n of notes) {
    const parts = n.path.split('/')
    const segments = parts.slice(1, -1)
    if (segments.length === 0) {
      root.notes.push(n)
      continue
    }
    const parent = ensureFolder(segments.join('/'))
    parent.notes.push(n)
  }

  const sortNode = (node: TreeNode): void => {
    node.children.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
    node.notes.sort((a, b) => b.updatedAt - a.updatedAt)
    node.children.forEach(sortNode)
  }
  sortNode(root)
  return root
}

function countNotesInTree(node: TreeNode): number {
  return node.notes.length + node.children.reduce((s, c) => s + countNotesInTree(c), 0)
}

/* ---------- Tree rendering ---------- */

interface TreeRenderProps {
  folder: NoteFolder
  isFolderActive: (folder: NoteFolder, subpath: string) => boolean
  collapsed: Set<string>
  toggleCollapse: (key: string) => void
  setView: (v: { kind: 'folder'; folder: NoteFolder; subpath: string }) => void
  onContextMenu: (e: React.MouseEvent, folder: NoteFolder, subpath: string) => void
  showNotes: boolean
  selectedPath: string | null
  onSelectNote: (path: string) => void
  onNoteContextMenu: (e: React.MouseEvent, n: NoteMeta) => void
  sortComparator: (a: NoteMeta, b: NoteMeta) => number
  onDropOnFolder: (
    payload: DragPayload,
    targetFolder: NoteFolder,
    targetSubpath: string
  ) => void | Promise<void>
}

function FolderTreeRoot({
  label,
  icon,
  folder,
  tree,
  isFolderActive,
  collapsed,
  toggleCollapse,
  setView,
  onContextMenu,
  showNotes,
  selectedPath,
  onSelectNote,
  onNoteContextMenu,
  sortComparator,
  onDropOnFolder
}: {
  label: string
  icon: JSX.Element
  tree: TreeNode
} & TreeRenderProps): JSX.Element {
  const rootKey = `${folder}:`
  const isCollapsed = collapsed.has(rootKey)
  const total = countNotesInTree(tree)
  const hasChildren = tree.children.length > 0 || (showNotes && tree.notes.length > 0)
  const [dragHover, setDragHover] = useState(false)

  const sortedNotes = useMemo(
    () => (showNotes ? tree.notes.slice().sort(sortComparator) : []),
    [showNotes, tree.notes, sortComparator]
  )

  const handleSelect = (): void => {
    setView({ kind: 'folder', folder, subpath: '' })
    // Click toggles the expand state on every folder row.
    if (hasChildren) toggleCollapse(rootKey)
  }

  return (
    <div className="flex flex-col">
      <TreeRow
        icon={icon}
        label={label}
        count={total}
        active={isFolderActive(folder, '')}
        expandable={hasChildren}
        collapsed={isCollapsed}
        depth={0}
        onToggle={() => toggleCollapse(rootKey)}
        onSelect={handleSelect}
        onContextMenu={(e) => onContextMenu(e, folder, '')}
        dropTarget={dragHover}
        onDragOver={(e) => {
          if (!hasZenItem(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragHover(true)
        }}
        onDragLeave={() => setDragHover(false)}
        onDrop={(e) => {
          setDragHover(false)
          const payload = readDragPayload(e)
          if (!payload) return
          e.preventDefault()
          void onDropOnFolder(payload, folder, '')
        }}
      />
      {!isCollapsed && (
        <>
          {tree.children.map((child) => (
            <SubTree
              key={child.subpath}
              node={child}
              depth={1}
              folder={folder}
              isFolderActive={isFolderActive}
              collapsed={collapsed}
              toggleCollapse={toggleCollapse}
              setView={setView}
              onContextMenu={onContextMenu}
              showNotes={showNotes}
              selectedPath={selectedPath}
              onSelectNote={onSelectNote}
              onNoteContextMenu={onNoteContextMenu}
              sortComparator={sortComparator}
              onDropOnFolder={onDropOnFolder}
            />
          ))}
          {showNotes &&
            sortedNotes.map((n) => (
              <NoteLeaf
                key={n.path}
                note={n}
                depth={1}
                active={n.path === selectedPath}
                onSelect={() => onSelectNote(n.path)}
                onContextMenu={(e) => onNoteContextMenu(e, n)}
              />
            ))}
        </>
      )}
    </div>
  )
}

function SubTree({
  node,
  depth,
  folder,
  isFolderActive,
  collapsed,
  toggleCollapse,
  setView,
  onContextMenu,
  showNotes,
  selectedPath,
  onSelectNote,
  onNoteContextMenu,
  sortComparator,
  onDropOnFolder
}: { node: TreeNode; depth: number } & TreeRenderProps): JSX.Element {
  const key = `${folder}:${node.subpath}`
  const isCollapsed = collapsed.has(key)
  const hasChildren =
    node.children.length > 0 || (showNotes && node.notes.length > 0)
  const [dragHover, setDragHover] = useState(false)

  const sortedNotes = useMemo(
    () => (showNotes ? node.notes.slice().sort(sortComparator) : []),
    [showNotes, node.notes, sortComparator]
  )

  const handleSelect = (): void => {
    setView({ kind: 'folder', folder, subpath: node.subpath })
    if (hasChildren) toggleCollapse(key)
  }

  return (
    <div className="flex flex-col">
      <TreeRow
        icon={<FolderIcon open={!isCollapsed && hasChildren} />}
        label={node.name}
        count={countNotesInTree(node)}
        active={isFolderActive(folder, node.subpath)}
        expandable={hasChildren}
        collapsed={isCollapsed}
        depth={depth}
        onToggle={() => toggleCollapse(key)}
        onSelect={handleSelect}
        onContextMenu={(e) => onContextMenu(e, folder, node.subpath)}
        draggable
        onDragStart={(e) =>
          setDragPayload(e, { kind: 'folder', folder, subpath: node.subpath })
        }
        dropTarget={dragHover}
        onDragOver={(e) => {
          if (!hasZenItem(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragHover(true)
        }}
        onDragLeave={() => setDragHover(false)}
        onDrop={(e) => {
          setDragHover(false)
          const payload = readDragPayload(e)
          if (!payload) return
          e.preventDefault()
          void onDropOnFolder(payload, folder, node.subpath)
        }}
      />
      {!isCollapsed && (
        <>
          {node.children.map((child) => (
            <SubTree
              key={child.subpath}
              node={child}
              depth={depth + 1}
              folder={folder}
              isFolderActive={isFolderActive}
              collapsed={collapsed}
              toggleCollapse={toggleCollapse}
              setView={setView}
              onContextMenu={onContextMenu}
              showNotes={showNotes}
              selectedPath={selectedPath}
              onSelectNote={onSelectNote}
              onNoteContextMenu={onNoteContextMenu}
              sortComparator={sortComparator}
              onDropOnFolder={onDropOnFolder}
            />
          ))}
          {showNotes &&
            sortedNotes.map((n) => (
              <NoteLeaf
                key={n.path}
                note={n}
                depth={depth + 1}
                active={n.path === selectedPath}
                onSelect={() => onSelectNote(n.path)}
                onContextMenu={(e) => onNoteContextMenu(e, n)}
              />
            ))}
        </>
      )}
    </div>
  )
}

function NoteLeaf({
  note,
  depth,
  active,
  onSelect,
  onContextMenu
}: {
  note: NoteMeta
  depth: number
  active: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => setDragPayload(e, { kind: 'note', path: note.path })}
      className={[
        'group flex h-8 items-center gap-1.5 rounded-lg px-1 text-left text-sm transition-colors',
        active ? 'bg-accent text-white' : 'text-ink-700 hover:bg-paper-200/70'
      ].join(' ')}
      style={{ paddingLeft: 4 + depth * 14 + 20 }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={active ? 'text-white/80' : 'text-ink-400'}
      >
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z" />
        <path d="M14 3v6h6" />
      </svg>
      <span className="flex-1 truncate">{note.title}</span>
    </button>
  )
}

/* ---------- Row primitives ---------- */

function TreeRow({
  icon,
  label,
  count,
  active,
  expandable,
  collapsed,
  depth,
  onToggle,
  onSelect,
  onContextMenu,
  draggable = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dropTarget = false
}: {
  icon: JSX.Element
  label: string
  count?: number
  active: boolean
  expandable: boolean
  collapsed: boolean
  depth: number
  onToggle: () => void
  onSelect: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  dropTarget?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        'group flex h-8 items-center gap-1.5 rounded-lg px-1 text-left text-sm transition-colors',
        active
          ? 'bg-accent text-white'
          : dropTarget
            ? 'bg-accent/20 text-ink-900 ring-1 ring-accent/60'
            : 'text-ink-800 hover:bg-paper-200/70'
      ].join(' ')}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {expandable ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className={[
            'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
            active ? 'text-white/80 hover:bg-white/15' : 'text-ink-500 hover:bg-paper-300/60'
          ].join(' ')}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      <span className={active ? 'text-white' : 'text-ink-500 group-hover:text-ink-800'}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span
          className={[
            'shrink-0 pr-2 text-xs',
            active ? 'text-white/80' : 'text-ink-400'
          ].join(' ')}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function SidebarRow({
  icon,
  label,
  count,
  trailing,
  active,
  onClick
}: {
  icon: JSX.Element
  label: string
  count?: number
  trailing?: JSX.Element
  active?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={[
        'group flex h-8 items-center gap-2 rounded-lg px-2 text-sm transition-colors',
        active
          ? 'bg-accent text-white'
          : 'text-ink-800 hover:bg-paper-200/70'
      ].join(' ')}
    >
      <span className={active ? 'text-white' : 'text-ink-500 group-hover:text-ink-800'}>
        {icon}
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span
          className={[
            'text-xs',
            active ? 'text-white/80' : 'text-ink-400'
          ].join(' ')}
        >
          {count}
        </span>
      )}
      {trailing}
    </button>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  active
}: {
  children: JSX.Element
  onClick: (e: React.MouseEvent) => void
  title: string
  active?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-accent/15 text-accent'
          : 'text-ink-500 hover:bg-paper-200 hover:text-ink-800'
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function sortOrderLabel(order: NoteSortOrder): string {
  switch (order) {
    case 'updated-desc':
      return 'Modified (newest)'
    case 'updated-asc':
      return 'Modified (oldest)'
    case 'created-desc':
      return 'Created (newest)'
    case 'created-asc':
      return 'Created (oldest)'
    case 'name-asc':
      return 'Name (A → Z)'
    case 'name-desc':
      return 'Name (Z → A)'
  }
}

function FolderIcon({ open }: { open: boolean }): JSX.Element {
  // Simple folder glyph — filled when open, outlined when closed.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={open ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      fillOpacity={open ? 0.18 : 0}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}
