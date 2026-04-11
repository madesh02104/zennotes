import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function TitleBar(): JSX.Element {
  const vault = useStore((s) => s.vault)
  const activeNote = useStore((s) => s.activeNote)
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    window.zen.platform().then((p) => setIsMac(p === 'darwin'))
  }, [])

  return (
    <div
      className="drag-region glass-titlebar flex h-11 shrink-0 items-center px-4 text-xs text-ink-500"
      style={{ paddingLeft: isMac ? 80 : 12 }}
    >
      <div className="flex-1 text-center tracking-wide">
        {activeNote ? activeNote.title : vault ? vault.name : 'ZenNotes'}
      </div>
      {!isMac && (
        <div className="flex items-center gap-1">
          <WinButton onClick={() => window.zen.windowMinimize()} label="–" />
          <WinButton onClick={() => window.zen.windowToggleMaximize()} label="▢" />
          <WinButton
            onClick={() => window.zen.windowClose()}
            label="✕"
            className="hover:bg-red-500/90 hover:text-white"
          />
        </div>
      )}
    </div>
  )
}

function WinButton({
  onClick,
  label,
  className
}: {
  onClick: () => void
  label: string
  className?: string
}): JSX.Element {
  return (
    <button
      className={`no-drag flex h-8 w-10 items-center justify-center rounded-md text-ink-600 hover:bg-paper-200 ${className ?? ''}`}
      onClick={onClick}
      aria-label={label}
    >
      {label}
    </button>
  )
}
