import path from 'node:path'
import chokidar, { FSWatcher } from 'chokidar'
import type { NoteFolder, VaultChangeEvent, VaultChangeKind } from '@shared/ipc'

const FOLDERS: NoteFolder[] = ['inbox', 'archive', 'trash']

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

function folderOf(root: string, abs: string): NoteFolder | null {
  const rel = toPosix(path.relative(root, abs))
  const top = rel.split('/')[0]
  if (FOLDERS.includes(top as NoteFolder)) return top as NoteFolder
  return null
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null
  private root: string | null = null

  start(root: string, onEvent: (ev: VaultChangeEvent) => void): void {
    this.stop()
    this.root = root
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      persistent: true,
      ignored: (p: string) => {
        const base = path.basename(p)
        return base.startsWith('.') || base === 'node_modules'
      },
      awaitWriteFinish: {
        stabilityThreshold: 120,
        pollInterval: 40
      }
    })

    const handler = (kind: VaultChangeKind) => (absPath: string) => {
      if (!absPath.toLowerCase().endsWith('.md')) return
      if (!this.root) return
      const folder = folderOf(this.root, absPath)
      if (!folder) return
      onEvent({
        kind,
        path: toPosix(path.relative(this.root, absPath)),
        folder
      })
    }

    this.watcher
      .on('add', handler('add'))
      .on('change', handler('change'))
      .on('unlink', handler('unlink'))
  }

  stop(): void {
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
      this.root = null
    }
  }
}
