import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { Editor } from './components/Editor'
import { TitleBar } from './components/TitleBar'
import { SearchPalette } from './components/SearchPalette'
import { EmptyVault } from './components/EmptyVault'

function App(): JSX.Element {
  const vault = useStore((s) => s.vault)
  const init = useStore((s) => s.init)
  const searchOpen = useStore((s) => s.searchOpen)
  const setSearchOpen = useStore((s) => s.setSearchOpen)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(!useStore.getState().searchOpen)
      }
      if (e.key === 'Escape' && useStore.getState().searchOpen) {
        setSearchOpen(false)
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
        <Sidebar />
        <NoteList />
        <Editor />
      </div>
      {searchOpen && <SearchPalette />}
    </div>
  )
}

export default App
