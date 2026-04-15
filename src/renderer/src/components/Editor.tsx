/**
 * Top-level editor surface. Renders the pane-layout tree recursively:
 * every leaf becomes an `EditorPane`; every split becomes a flex
 * container with resize handles between its children.
 *
 * Global concerns (vim command registration, the bottom StatusBar,
 * app-level keyboard shortcuts) live here. Per-pane concerns (CM view,
 * tabs, toolbar, drag-drop zones) live in `EditorPane.tsx`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { Vim, getCM } from '@replit/codemirror-vim'
import { isTagsViewActive, isTasksViewActive, useStore } from '../store'
import { buildCommands, type Command } from '../lib/commands'
import { rankItems } from '../lib/fuzzy-score'
import type { PaneLayout, PaneSplit } from '../lib/pane-layout'
import {
  parseCreateNotePath,
  resolveWikilinkTarget,
  suggestCreateNotePath
} from '../lib/wikilinks'
import { classifyLocalAssetHref, resolveAssetVaultRelativePath } from '../lib/local-assets'
import { promptApp } from './PromptHost'
import { StatusBar } from './StatusBar'
import { EditorPane } from './EditorPane'
import { focusPaneInDirection } from '../lib/pane-nav'

let vimCommandsRegistered = false

function unwrapMdUrl(url: string): string {
  // Markdown wraps URLs with spaces in angle brackets: `[x](<a b.pdf>)`.
  const trimmed = url.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed.slice(1, -1)
  return trimmed
}

function extractLinkAtCursor(doc: string, pos: number): string | null {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1
  const lineEnd = doc.indexOf('\n', pos)
  const line = doc.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
  const col = pos - lineStart
  const wikiRe = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g
  let m: RegExpExecArray | null
  while ((m = wikiRe.exec(line)) !== null) {
    if (col >= m.index && col < m.index + m[0].length) return m[1]
  }
  // Angle-bracketed URLs can contain `)` so match them specifically first.
  const mdAngleRe = /\[([^\]]*)\]\(<([^>]+)>\)/g
  while ((m = mdAngleRe.exec(line)) !== null) {
    if (col >= m.index && col < m.index + m[0].length) return m[2]
  }
  const mdRe = /\[([^\]]*)\]\(([^)]+)\)/g
  while ((m = mdRe.exec(line)) !== null) {
    if (col >= m.index && col < m.index + m[0].length) return unwrapMdUrl(m[2])
  }
  const urlRe = /https?:\/\/[^\s)>\]]+/g
  while ((m = urlRe.exec(line)) !== null) {
    if (col >= m.index && col < m.index + m[0].length) return m[0]
  }
  return null
}

function registerVimCommands(): void {
  if (vimCommandsRegistered) return
  vimCommandsRegistered = true

  // HMR can leave old custom mappings alive in CodeMirror-Vim's global
  // map table. Explicitly remove the temporary `x` close-note binding
  // so normal-mode `x` keeps its default delete-char behavior.
  try {
    Vim.unmap('x', 'normal')
  } catch {
    /* ignore */
  }

  Vim.defineEx('write', 'w', () => {
    void useStore.getState().persistActive()
  })
  Vim.defineEx('format', 'format', () => {
    void useStore.getState().formatActiveNote()
  })
  Vim.defineEx('quit', 'q', () => {
    const state = useStore.getState()
    if (isTasksViewActive(state)) {
      state.closeTasksView()
      return
    }
    if (isTagsViewActive(state)) {
      state.closeTagView()
      return
    }
    void state.closeActiveNote()
  })
  Vim.defineEx('wq', 'wq', () => {
    const state = useStore.getState()
    if (isTasksViewActive(state)) {
      state.closeTasksView()
      return
    }
    if (isTagsViewActive(state)) {
      state.closeTagView()
      return
    }
    void state.closeActiveNote()
  })

  // Vault-wide task view. Opens the full-surface Tasks panel that parses
  // `- [ ]` across every note and groups them by Today/Upcoming/Waiting/Done.
  // `:q` above knows to close the panel instead of closing a note.
  Vim.defineEx('tasks', 'tasks', () => {
    void useStore.getState().openTasksView()
  })

  // `:tag foo` starts (or updates) the Tags view with `foo` selected.
  // `:tag foo bar baz` replaces the selection set wholesale. `:tag`
  // alone opens the Tags tab with whatever's currently selected (if
  // nothing is, the view shows a hint to pick tags).
  Vim.defineEx(
    'tag',
    'tag',
    (_cm: unknown, params: { argString?: string } | undefined) => {
      const args = (params?.argString ?? '')
        .split(/\s+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
      const state = useStore.getState()
      if (args.length === 0) {
        void state.openTagView()
        return
      }
      state.setSelectedTags(args)
      void state.openTagView()
    }
  )

  // Vim-style window splits. `:split` clones the current tab into a
  // new pane below; `:vsplit` clones it into a new pane to the right.
  // Both commands accept their usual abbreviations (`:sp`, `:vs`).
  Vim.defineEx('split', 'sp', () => {
    const state = useStore.getState()
    const path = state.selectedPath
    if (!path) return
    void state.splitPaneWithTab({
      targetPaneId: state.activePaneId,
      edge: 'bottom',
      path
    })
  })
  Vim.defineEx('vsplit', 'vs', () => {
    const state = useStore.getState()
    const path = state.selectedPath
    if (!path) return
    void state.splitPaneWithTab({
      targetPaneId: state.activePaneId,
      edge: 'right',
      path
    })
  })

  Vim.defineAction('goToDefinition', (cm: ReturnType<typeof getCM>) => {
    const view = (cm as unknown as { cm6?: EditorView }).cm6
    if (!view) return
    const pos = view.state.selection.main.head
    const doc = view.state.doc.toString()
    const target = extractLinkAtCursor(doc, pos)
    if (!target) return

    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank')
      return
    }

    const state = useStore.getState()

    // PDF links: pin the asset in the reference pane for this note
    // instead of prompting to create a note.
    if (classifyLocalAssetHref(target) === 'pdf') {
      const activePath = state.selectedPath
      const vaultRoot = state.vault?.root
      if (activePath && vaultRoot) {
        const abs = resolveAssetVaultRelativePath(vaultRoot, activePath, target)
        if (abs) {
          state.pinAssetReferenceForNote(activePath, abs)
          return
        }
      }
    }

    const notes = state.notes
    const resolved = resolveWikilinkTarget(notes, target)
    if (resolved) {
      void state.selectNote(resolved.path).then(() => {
        state.setFocusedPanel('editor')
        requestAnimationFrame(() => useStore.getState().editorViewRef?.focus())
      })
      return
    }

    void promptApp({
      title: `Create note for "${target}"?`,
      description:
        'No matching note exists. Use /my/path/note.md for Inbox-relative paths, or inbox/my/path/note.md for an explicit top folder.',
      initialValue: suggestCreateNotePath(target),
      placeholder: '/my/path/note.md',
      okLabel: 'Create',
      validate: (value) => {
        try {
          parseCreateNotePath(value)
          return null
        } catch (err) {
          return (err as Error).message
        }
      }
    }).then(async (value) => {
      if (!value) return
      try {
        const parsed = parseCreateNotePath(value)
        const existing = state.notes.find(
          (note) => note.folder !== 'trash' && note.path.toLowerCase() === parsed.relPath.toLowerCase()
        )
        if (existing) {
          await state.selectNote(existing.path)
          state.setFocusedPanel('editor')
          requestAnimationFrame(() => useStore.getState().editorViewRef?.focus())
          return
        }
        await state.createAndOpen(parsed.folder, parsed.subpath, { title: parsed.title })
        state.setFocusedPanel('editor')
        requestAnimationFrame(() => useStore.getState().editorViewRef?.focus())
      } catch (err) {
        window.alert((err as Error).message)
      }
    })
  })

  Vim.mapCommand('gd', 'action', 'goToDefinition', {}, { context: 'normal' })

  // Vim-style pane navigation: <C-w> followed by h/j/k/l focuses the
  // neighbor pane in that direction. Works only when CodeMirror is in
  // normal mode; App.tsx handles the same chord for focus outside CM.
  Vim.defineAction('focusPaneLeft', () => {
    focusPaneInDirection('h')
  })
  Vim.defineAction('focusPaneDown', () => {
    focusPaneInDirection('j')
  })
  Vim.defineAction('focusPaneUp', () => {
    focusPaneInDirection('k')
  })
  Vim.defineAction('focusPaneRight', () => {
    focusPaneInDirection('l')
  })
  Vim.mapCommand('<C-w>h', 'action', 'focusPaneLeft', {}, { context: 'normal' })
  Vim.mapCommand('<C-w>j', 'action', 'focusPaneDown', {}, { context: 'normal' })
  Vim.mapCommand('<C-w>k', 'action', 'focusPaneUp', {}, { context: 'normal' })
  Vim.mapCommand('<C-w>l', 'action', 'focusPaneRight', {}, { context: 'normal' })
  Vim.mapCommand('<C-w><C-h>', 'action', 'focusPaneLeft', {}, { context: 'normal' })
  Vim.mapCommand('<C-w><C-j>', 'action', 'focusPaneDown', {}, { context: 'normal' })
  Vim.mapCommand('<C-w><C-k>', 'action', 'focusPaneUp', {}, { context: 'normal' })
  Vim.mapCommand('<C-w><C-l>', 'action', 'focusPaneRight', {}, { context: 'normal' })

  registerVimNoteCommands()
  registerCommandPaletteEx()
}

/**
 * Vim-muscle-memory ex commands for buffer (tab) / file operations. These
 * sit above the auto-registered palette commands so their short names
 * (`:e`, `:bn`, `:bd`) are reserved and not overwritten.
 *
 * - `:e[dit] <path>`     open a note by vault-relative path, create if missing
 * - `:new <path>`        create a new note at an explicit path
 * - `:bn[ext]`           next tab in the active pane
 * - `:bp[rev]`           previous tab in the active pane
 * - `:bd[elete]`, `:bc`  close the active tab (alias for `:q` on notes)
 * - `:only`              close every other tab in the active pane
 * - `:qa[ll]`            close every tab, everywhere
 * - `:h[elp]`            open the command palette for discovery
 */
function registerVimNoteCommands(): void {
  const getActiveLeaf = (): { id: string; tabs: string[]; activeTab: string | null } | null => {
    const s = useStore.getState()
    const leaves = allLeavesFlat(s.paneLayout)
    return leaves.find((l) => l.id === s.activePaneId) ?? null
  }

  const openOrCreateByPath = async (raw: string): Promise<void> => {
    const value = raw.trim()
    if (!value) return
    let parsed: ReturnType<typeof parseCreateNotePath>
    try {
      parsed = parseCreateNotePath(value)
    } catch (err) {
      window.alert((err as Error).message)
      return
    }
    const state = useStore.getState()
    // If something already resolves to that target (wiki-style + case-
    // insensitive), open it instead of creating a duplicate.
    const existing = state.notes.find(
      (n) =>
        n.folder !== 'trash' &&
        n.path.toLowerCase() === parsed.relPath.toLowerCase()
    )
    if (existing) {
      await state.selectNote(existing.path)
      state.setFocusedPanel('editor')
      requestAnimationFrame(() => useStore.getState().editorViewRef?.focus())
      return
    }
    await state.createAndOpen(parsed.folder, parsed.subpath, {
      title: parsed.title
    })
    state.setFocusedPanel('editor')
    requestAnimationFrame(() => useStore.getState().editorViewRef?.focus())
  }

  Vim.defineEx(
    'edit',
    'e',
    (_cm: unknown, params: { argString?: string } | undefined) => {
      void openOrCreateByPath(params?.argString ?? '')
    }
  )

  // `:new` shadows vim's "horizontal split empty buffer" — for a notes
  // app, creating a new note at a path is what the user actually wants.
  Vim.defineEx(
    'new',
    'new',
    (_cm: unknown, params: { argString?: string } | undefined) => {
      const arg = (params?.argString ?? '').trim()
      if (!arg) {
        void useStore.getState().createAndOpen('inbox', '', { focusTitle: true })
        return
      }
      void openOrCreateByPath(arg)
    }
  )

  const shiftTab = (delta: 1 | -1): void => {
    const leaf = getActiveLeaf()
    if (!leaf || leaf.tabs.length < 2 || !leaf.activeTab) return
    const idx = leaf.tabs.indexOf(leaf.activeTab)
    if (idx < 0) return
    const nextIdx = (idx + delta + leaf.tabs.length) % leaf.tabs.length
    void useStore.getState().focusTabInPane(leaf.id, leaf.tabs[nextIdx])
  }

  Vim.defineEx('bnext', 'bn', () => shiftTab(1))
  Vim.defineEx('bprev', 'bp', () => shiftTab(-1))
  // Vim aliases: :bNext and :bfirst/:blast — rare, skipped.

  const closeActiveTabLikeQuit = (): void => {
    const state = useStore.getState()
    if (isTasksViewActive(state)) {
      state.closeTasksView()
      return
    }
    if (isTagsViewActive(state)) {
      state.closeTagView()
      return
    }
    void state.closeActiveNote()
  }
  Vim.defineEx('bdelete', 'bd', closeActiveTabLikeQuit)
  Vim.defineEx('bclose', 'bc', closeActiveTabLikeQuit)

  Vim.defineEx('only', 'only', () => {
    const leaf = getActiveLeaf()
    if (!leaf || !leaf.activeTab) return
    const state = useStore.getState()
    // Snapshot the list — closing tabs mutates leaf.tabs concurrently.
    const toClose = leaf.tabs.filter((p) => p !== leaf.activeTab)
    for (const p of toClose) void state.closeTabInPane(leaf.id, p)
  })

  const closeEveryTab = (): void => {
    const state = useStore.getState()
    for (const leaf of allLeavesFlat(state.paneLayout)) {
      const snapshot = [...leaf.tabs]
      for (const p of snapshot) void state.closeTabInPane(leaf.id, p)
    }
  }
  Vim.defineEx('qall', 'qa', closeEveryTab)
  Vim.defineEx('quitall', 'quitall', closeEveryTab)
  // :xa / :wa are just aliases for qall in this context (nothing to flush
  // that autosave doesn't already handle).
  Vim.defineEx('xall', 'xa', closeEveryTab)
  Vim.defineEx('wall', 'wa', closeEveryTab)

  Vim.defineEx('help', 'h', () => {
    useStore.getState().setCommandPaletteOpen(true)
  })
}

/** Flatten the pane tree to a list of leaves, independent of the store's
 *  `allLeaves` helper (which lives in `lib/pane-layout`). Duplicated
 *  locally to avoid a new import chain. */
function allLeavesFlat(
  node: PaneLayout
): Array<{ id: string; tabs: string[]; activeTab: string | null }> {
  if (node.kind === 'leaf') {
    return [{ id: node.id, tabs: node.tabs, activeTab: node.activeTab }]
  }
  const out: Array<{ id: string; tabs: string[]; activeTab: string | null }> = []
  for (const child of node.children) out.push(...allLeavesFlat(child))
  return out
}

// Names we register manually above. Keeping a block-list avoids double-
// registering when an auto-generated name would collide with a curated
// vim-style shortcut (`:w`, `:q`, `:tasks`, …).
const MANUAL_EX_NAMES = new Set([
  'write',
  'w',
  'quit',
  'q',
  'wq',
  'format',
  'tasks',
  'tag',
  'split',
  'sp',
  'vsplit',
  'vs',
  // Added by `registerVimNoteCommands`
  'edit',
  'e',
  'new',
  'bnext',
  'bn',
  'bprev',
  'bp',
  'bdelete',
  'bd',
  'bclose',
  'bc',
  'only',
  'qall',
  'qa',
  'quitall',
  'xall',
  'xa',
  'wall',
  'wa',
  'help',
  'h'
])

function commandIdToExName(id: string): string {
  // `note.new.quick` → `note-new-quick`. Dashes are accepted by CM-vim's
  // ex parser and make the names scannable when listed in `:cmd`.
  return id.replace(/\./g, '-')
}

/** Names of every ex command we register. Captured during init so the
 *  tab-completion handler can match against the full set without re-
 *  crawling buildCommands() on every keystroke. */
const registeredExNames: string[] = []

/**
 * Bridge every command from the palette registry into the `:` ex line so
 * the keyboard-first experience is comprehensive — any action the palette
 * exposes can be invoked directly by typing its kebab-cased id. Plus a
 * catch-all `:cmd <query>` that fuzzy-matches against title/keywords and
 * runs the top match (opens the full palette when the query is empty).
 */
function registerCommandPaletteEx(): void {
  const runCommand = (cmd: Command): void => {
    // Re-check `when` at invocation time so `:note-save` doesn't silently
    // fire when nothing is selected, for example.
    if (cmd.when && !cmd.when()) return
    void cmd.run()
  }

  const names = new Set<string>(MANUAL_EX_NAMES)
  for (const cmd of buildCommands()) {
    const name = commandIdToExName(cmd.id)
    if (names.has(name)) continue
    names.add(name)
    try {
      Vim.defineEx(name, name, () => runCommand(cmd))
    } catch {
      /* ignore duplicate registrations across HMR cycles */
    }
  }

  // `:cmd` — fuzzy fallback. With a query, runs the best match directly.
  // Without, opens the command palette so the user can browse.
  Vim.defineEx(
    'cmd',
    'cmd',
    (_cm: unknown, params: { argString?: string } | undefined) => {
      const query = (params?.argString ?? '').trim()
      if (!query) {
        useStore.getState().setCommandPaletteOpen(true)
        return
      }
      const commands = buildCommands()
      const ranked = rankItems(commands, query, [
        { get: (c) => c.title, weight: 1 },
        { get: (c) => c.keywords ?? '', weight: 0.6 },
        { get: (c) => c.category, weight: 0.4 }
      ])
      const first = ranked.find((c) => !c.when || c.when())
      if (first) runCommand(first)
    }
  )
  names.add('cmd')

  // `:commands` — alias that always opens the palette (no implicit run).
  Vim.defineEx('commands', 'commands', () => {
    useStore.getState().setCommandPaletteOpen(true)
  })
  names.add('commands')

  registeredExNames.splice(0, registeredExNames.length, ...names)
  registeredExNames.sort()
  installExTabCompletion()
}

let exTabListenerInstalled = false

/**
 * Per-session tab-completion state. Keyed on the current ex-prompt input
 * element — a fresh cycle starts every time the user mutates the value
 * by typing (non-Tab keys reset), or whenever a different input element
 * takes over (new pane, re-opened prompt).
 */
interface ExTabCycle {
  input: HTMLInputElement
  basePrefix: string
  matches: string[]
  cycleIdx: number
}

let exCycle: ExTabCycle | null = null

function computeExMatches(prefix: string): string[] {
  if (!prefix) return registeredExNames.slice()
  return registeredExNames.filter((n) => n.startsWith(prefix))
}

/**
 * Global capture-phase Tab interceptor for the CodeMirror-Vim ex prompt.
 *
 * Keystrokes on the prompt input bubble up like any DOM event, but CM-Vim
 * also registers its own keydown listener on the same input. When two
 * listeners share a target, they fire in registration order — meaning
 * CM-Vim's fires first and can call `stopImmediatePropagation` to hide
 * Shift+Tab from us. Installing at `window` with `capture: true` hoists
 * us to the document-wide capture phase, which runs BEFORE any target-
 * level listener. We then opt into the events whose target matches the
 * ex-prompt input (checked via a CSS selector) and leave everything else
 * alone.
 *
 * Tab advances through commands matching the current prefix; Shift+Tab
 * walks back; any other key resets the cycle. First-Tab lands on the
 * first match, first-Shift-Tab on the last — matches vim's wildmenu.
 */
function installExTabCompletion(): void {
  if (exTabListenerInstalled) return
  exTabListenerInstalled = true
  if (typeof window === 'undefined') return

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab') {
        // Reset cycle state when the user types anything else — but only
        // if the event target IS the ex prompt input. Keys elsewhere in
        // the app shouldn't clobber our state (modifier keys fire even
        // when the input is focused too, so we ignore those explicitly
        // instead of resetting on them).
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
          return
        }
        const target = e.target as HTMLElement | null
        if (target && target instanceof HTMLInputElement) {
          if (target.closest('.cm-vim-panel')) {
            if (exCycle && exCycle.input === target) exCycle.basePrefix = ''
          }
        }
        return
      }

      const target = e.target as HTMLElement | null
      if (!target || !(target instanceof HTMLInputElement)) return
      if (!target.closest('.cm-vim-panel')) return

      // This is our prompt — take over Tab handling entirely.
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      const step = e.shiftKey ? -1 : 1
      const fresh = !exCycle || exCycle.input !== target || exCycle.basePrefix === ''

      if (fresh) {
        exCycle = {
          input: target,
          basePrefix: target.value,
          matches: computeExMatches(target.value),
          cycleIdx: step === 1 ? 0 : -1 // sentinel; normalized below
        }
      } else if (exCycle) {
        exCycle.cycleIdx += step
      }

      const cycle = exCycle
      if (!cycle || cycle.matches.length === 0) return
      const n = cycle.matches.length
      const idx = ((cycle.cycleIdx % n) + n) % n
      cycle.cycleIdx = idx
      const match = cycle.matches[idx]
      // Mutate and notify CM-vim so its internal state stays in sync.
      target.value = match
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.setSelectionRange(match.length, match.length)
    },
    true
  )
}

export function Editor(): JSX.Element {
  const paneLayout = useStore((s) => s.paneLayout)
  const activeNote = useStore((s) => s.activeNote)

  useEffect(() => {
    registerVimCommands()
  }, [])

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
        <PaneTreeView node={paneLayout} />
      </div>
      {activeNote && <StatusBar note={activeNote} />}
    </section>
  )
}

function PaneTreeView({ node }: { node: PaneLayout }): JSX.Element {
  if (node.kind === 'leaf') {
    return <EditorPane pane={node} />
  }
  return <PaneSplitView split={node} />
}

function PaneSplitView({ split }: { split: PaneSplit }): JSX.Element {
  const resizeSplit = useStore((s) => s.resizeSplit)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isRow = split.direction === 'row'

  const dragState = useRef<{
    index: number
    startClient: number
    startSizes: number[]
    totalPx: number
  } | null>(null)

  const onHandleMouseDown = useCallback(
    (handleIndex: number) => (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return
      e.preventDefault()
      const rect = containerRef.current.getBoundingClientRect()
      const totalPx = isRow ? rect.width : rect.height
      dragState.current = {
        index: handleIndex,
        startClient: isRow ? e.clientX : e.clientY,
        startSizes: split.sizes.slice(),
        totalPx
      }
      const onMove = (ev: MouseEvent): void => {
        const st = dragState.current
        if (!st) return
        const delta = (isRow ? ev.clientX : ev.clientY) - st.startClient
        const deltaRatio = st.totalPx > 0 ? delta / st.totalPx : 0
        const next = st.startSizes.slice()
        const min = 0.08
        const a = next[st.index]
        const b = next[st.index + 1]
        const sum = a + b
        let newA = a + deltaRatio
        let newB = b - deltaRatio
        if (newA < min) {
          newA = min
          newB = sum - min
        }
        if (newB < min) {
          newB = min
          newA = sum - min
        }
        next[st.index] = newA
        next[st.index + 1] = newB
        resizeSplit(split.id, next)
      }
      const onUp = (): void => {
        dragState.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      document.body.style.cursor = isRow ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [isRow, resizeSplit, split.id, split.sizes]
  )

  const nodes = useMemo(() => {
    const out: JSX.Element[] = []
    split.children.forEach((child, i) => {
      const basis = split.sizes[i] ?? 1 / split.children.length
      out.push(
        <div
          key={child.id}
          className={['flex min-h-0 min-w-0', isRow ? '' : 'flex-col'].join(' ')}
          style={{ flex: `${basis} 1 0`, minWidth: 0, minHeight: 0 }}
        >
          <PaneTreeView node={child} />
        </div>
      )
      if (i < split.children.length - 1) {
        out.push(
          <ResizeDivider
            key={`handle-${child.id}`}
            orientation={isRow ? 'vertical' : 'horizontal'}
            onMouseDown={onHandleMouseDown(i)}
          />
        )
      }
    })
    return out
  }, [isRow, onHandleMouseDown, split.children, split.sizes])

  return (
    <div
      ref={containerRef}
      className={['flex min-h-0 min-w-0 flex-1', isRow ? 'flex-row' : 'flex-col'].join(' ')}
    >
      {nodes}
    </div>
  )
}

/**
 * Draggable divider between pane-split children. The element itself is
 * 1 logical pixel and positions its own wider hit zone via a pseudo
 * overlay so dragging feels forgiving without stealing real layout space.
 */
function ResizeDivider({
  orientation,
  onMouseDown
}: {
  orientation: 'vertical' | 'horizontal'
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
}): JSX.Element {
  const isVertical = orientation === 'vertical'
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      onMouseDown={onMouseDown}
      className={[
        'group relative z-10 shrink-0 select-none bg-paper-300/70 transition-colors hover:bg-accent/60 active:bg-accent',
        isVertical
          ? 'w-px cursor-col-resize'
          : 'h-px cursor-row-resize'
      ].join(' ')}
    >
      {/* Wider hit zone centered on the divider line. */}
      <div
        className={[
          'absolute',
          isVertical
            ? 'top-0 bottom-0 -left-1 w-[9px]'
            : 'left-0 right-0 -top-1 h-[9px]'
        ].join(' ')}
      />
    </div>
  )
}
