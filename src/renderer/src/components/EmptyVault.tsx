import { useStore } from '../store'

export function EmptyVault(): JSX.Element {
  const openVaultPicker = useStore((s) => s.openVaultPicker)
  return (
    <div className="flex h-[calc(100vh-2.75rem)] items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-xl font-semibold text-white shadow-panel">
          Z
        </div>
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink-900">Welcome to ZenNotes</h1>
          <p className="mt-2 text-sm text-ink-600">
            Choose a folder on your computer to use as your vault. ZenNotes will store your notes
            there as plain markdown files — yours to keep, back up, and sync any way you like.
          </p>
        </div>
        <button
          onClick={() => void openVaultPicker()}
          className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 shadow-panel hover:bg-ink-800"
        >
          Choose vault folder
        </button>
      </div>
    </div>
  )
}
