/**
 * Tiny helpers for passing note / folder drag payloads through the
 * browser's HTML5 drag-and-drop API. We use a custom MIME type so
 * we don't collide with text or file drops.
 */

export type DragPayload =
  | { kind: 'note'; path: string }
  | { kind: 'folder'; folder: 'inbox' | 'archive' | 'trash'; subpath: string }

export const ZEN_DND_MIME = 'application/x-zen-item'

export function setDragPayload(e: React.DragEvent, payload: DragPayload): void {
  e.dataTransfer.setData(ZEN_DND_MIME, JSON.stringify(payload))
  // Text fallback so cross-app drops don't look totally empty.
  e.dataTransfer.setData(
    'text/plain',
    payload.kind === 'note' ? payload.path : `${payload.folder}/${payload.subpath}`
  )
  e.dataTransfer.effectAllowed = 'move'
}

export function readDragPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(ZEN_DND_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DragPayload
  } catch {
    return null
  }
}

export function hasZenItem(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(ZEN_DND_MIME)
}
