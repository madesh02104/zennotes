import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { useStore } from '../store'

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          fontFamily: 'inherit',
          primaryColor: '#faf7f0',
          primaryTextColor: '#2a2620',
          primaryBorderColor: '#d9d0bd',
          lineColor: '#8a8073',
          secondaryColor: '#fdfbf7',
          tertiaryColor: '#f5f0e6'
        }
      })
      return m.default
    })
  }
  return mermaidPromise
}

export function Preview({ markdown }: { markdown: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const notes = useStore((s) => s.notes)
  const selectNote = useStore((s) => s.selectNote)
  const setView = useStore((s) => s.setView)

  const html = useMemo(() => renderMarkdown(markdown), [markdown])

  // Index of titles (lowercase, no extension) → relative path for wikilink resolution.
  const titleIndex = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of notes) {
      if (n.folder === 'trash') continue
      map.set(n.title.toLowerCase(), n.path)
    }
    return map
  }, [notes])

  // After render: mark broken wikilinks, wire clicks, render mermaid.
  useEffect(() => {
    const root = ref.current
    if (!root) return

    // Resolve wikilinks against the current vault.
    root.querySelectorAll<HTMLAnchorElement>('a.wikilink').forEach((a) => {
      const target = a.getAttribute('data-wikilink') || ''
      const resolved = titleIndex.get(target.toLowerCase())
      if (resolved) {
        a.classList.remove('broken')
        a.dataset.resolvedPath = resolved
      } else {
        a.classList.add('broken')
        delete a.dataset.resolvedPath
      }
    })

    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.classList.contains('wikilink')) {
        e.preventDefault()
        const path = anchor.dataset.resolvedPath
        if (path) void selectNote(path)
        return
      }
      if (anchor.classList.contains('hashtag')) {
        e.preventDefault()
        const tag = anchor.getAttribute('data-tag')
        if (tag) setView({ kind: 'tag', tag })
        return
      }
      // External links: let Electron's window-open handler send them to the OS browser.
      const href = anchor.getAttribute('href') || ''
      if (/^https?:/i.test(href)) {
        e.preventDefault()
        window.open(href, '_blank')
      }
    }
    root.addEventListener('click', onClick)

    // Mermaid: render any pending `.mermaid` blocks.
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid'))
    if (blocks.length > 0) {
      void loadMermaid().then(async (mermaid) => {
        for (let i = 0; i < blocks.length; i++) {
          const el = blocks[i]
          const source = el.textContent || ''
          try {
            const { svg } = await mermaid.render(`zen-mermaid-${Date.now()}-${i}`, source)
            el.innerHTML = svg
          } catch (err) {
            el.innerHTML = `<pre class="text-sm text-red-600">Mermaid error: ${
              (err as Error).message
            }</pre>`
          }
        }
      })
    }

    return () => {
      root.removeEventListener('click', onClick)
    }
  }, [html, titleIndex, selectNote, setView])

  return (
    <article
      ref={ref}
      className="prose-zen py-8"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
