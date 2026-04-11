import { useEffect } from 'react'
import { useStore } from './store'
import { resolveAuto } from './lib/themes'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { Editor } from './components/Editor'
import { TitleBar } from './components/TitleBar'
import { SearchPalette } from './components/SearchPalette'
import { SettingsModal } from './components/SettingsModal'
import { EmptyVault } from './components/EmptyVault'

function App(): JSX.Element {
  const vault = useStore((s) => s.vault)
  const init = useStore((s) => s.init)
  const searchOpen = useStore((s) => s.searchOpen)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const noteListOpen = useStore((s) => s.noteListOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const themeId = useStore((s) => s.themeId)
  const themeFamily = useStore((s) => s.themeFamily)
  const themeMode = useStore((s) => s.themeMode)
  const editorFontSize = useStore((s) => s.editorFontSize)
  const editorLineHeight = useStore((s) => s.editorLineHeight)
  const interfaceFont = useStore((s) => s.interfaceFont)
  const textFont = useStore((s) => s.textFont)
  const monoFont = useStore((s) => s.monoFont)
  const transparentUi = useStore((s) => s.transparentUi)

  useEffect(() => {
    void init()
  }, [init])

  // Apply theme: set html[data-theme=...] based on mode/family/id.
  // When mode === 'auto', we mirror `prefers-color-scheme` and also
  // react to changes while the app is running.
  useEffect(() => {
    const html = document.documentElement
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      let id = themeId
      if (themeMode === 'auto') {
        id = resolveAuto(themeFamily, mql.matches)
      }
      html.dataset.theme = id
    }
    apply()
    if (themeMode === 'auto') {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
    return undefined
  }, [themeId, themeFamily, themeMode])

  // Apply editor font size + line height + all three font families as
  // CSS variables. Each family has its own fallback stack so leaving it
  // unset gracefully uses the platform default.
  useEffect(() => {
    const html = document.documentElement
    html.style.setProperty('--z-editor-font-size', `${editorFontSize}px`)
    html.style.setProperty('--z-editor-line-height', String(editorLineHeight))

    const setFont = (name: string, value: string | null, fallback: string): void => {
      if (value) html.style.setProperty(name, `"${value}", ${fallback}`)
      else html.style.removeProperty(name)
    }
    setFont(
      '--z-interface-font',
      interfaceFont,
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif'
    )
    setFont(
      '--z-text-font',
      textFont,
      '"SF Mono", "SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace'
    )
    setFont(
      '--z-mono-font',
      monoFont,
      '"SF Mono", "SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace'
    )
  }, [editorFontSize, editorLineHeight, interfaceFont, textFont, monoFont])

  // Simple transparency toggle. When off we force the glass panels to
  // full opacity so nothing bleeds through; when on we restore the
  // theme-default translucency by clearing the inline overrides.
  useEffect(() => {
    const html = document.documentElement
    if (transparentUi) {
      html.style.removeProperty('--z-glass-a1')
      html.style.removeProperty('--z-glass-a2')
      html.style.removeProperty('--z-glass-a3')
      html.style.removeProperty('--z-glass-a4')
    } else {
      html.style.setProperty('--z-glass-a1', '1')
      html.style.setProperty('--z-glass-a2', '1')
      html.style.setProperty('--z-glass-a3', '1')
      html.style.setProperty('--z-glass-a4', '1')
    }
  }, [transparentUi])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const state = useStore.getState()

      if (mod && key === 'k') {
        e.preventDefault()
        setSearchOpen(!state.searchOpen)
        return
      }
      if (e.key === 'Escape' && state.searchOpen) {
        setSearchOpen(false)
        return
      }
      // ⌘\ — toggle sidebar
      if (mod && !e.shiftKey && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault()
        state.toggleSidebar()
        return
      }
      // ⌘⇧\ — toggle the note list
      if (mod && e.shiftKey && (e.key === '\\' || e.code === 'Backslash' || e.key === '|')) {
        e.preventDefault()
        state.toggleNoteList()
        return
      }
      // ⌘. — toggle focus mode (hide both)
      if (mod && (e.key === '.' || e.code === 'Period')) {
        e.preventDefault()
        const anyOpen = state.sidebarOpen || state.noteListOpen
        state.setFocusMode(anyOpen)
        return
      }
      // ⌘, — open settings (macOS convention)
      if (mod && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault()
        state.setSettingsOpen(!state.settingsOpen)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSearchOpen])

  if (!vault) {
    return (
      <div className="h-screen w-screen bg-paper-100 text-ink-900">
        <TitleBar />
        <EmptyVault />
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-paper-100 text-ink-900">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        {noteListOpen && <NoteList />}
        <Editor />
      </div>
      {searchOpen && <SearchPalette />}
      {settingsOpen && <SettingsModal />}
    </div>
  )
}

export default App
