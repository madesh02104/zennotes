import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { NoteContent, NoteFolder, NoteMeta, VaultInfo } from '@shared/ipc'

const CONFIG_FILE = 'zennotes.config.json'
const FOLDERS: NoteFolder[] = ['inbox', 'archive', 'trash']

interface PersistedConfig {
  vaultRoot: string | null
}

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

export async function loadConfig(): Promise<PersistedConfig> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    return JSON.parse(raw) as PersistedConfig
  } catch {
    return { vaultRoot: null }
  }
}

export async function saveConfig(cfg: PersistedConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

/**
 * Ensure the expected vault folder layout exists and seed a welcome note
 * the very first time a vault is opened.
 */
export async function ensureVaultLayout(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  for (const f of FOLDERS) {
    await fs.mkdir(path.join(root, f), { recursive: true })
  }
  const welcomePath = path.join(root, 'inbox', 'Welcome.md')
  try {
    await fs.access(welcomePath)
  } catch {
    await fs.writeFile(welcomePath, WELCOME_NOTE, 'utf8')
  }
}

export function vaultInfo(root: string): VaultInfo {
  return { root, name: path.basename(root) }
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

function folderOf(root: string, absPath: string): NoteFolder | null {
  const rel = toPosix(path.relative(root, absPath))
  const top = rel.split('/')[0]
  if (FOLDERS.includes(top as NoteFolder)) return top as NoteFolder
  return null
}

/** Pull unique `#tags` out of markdown text, ignoring fenced/inline code. */
function extractTags(body: string): string[] {
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
  const matches = stripped.match(/(?:^|\s)#([a-zA-Z][\w\-/]*)/g) || []
  const seen = new Set<string>()
  for (const m of matches) seen.add(m.trim().slice(1))
  return [...seen]
}

/** Build a short plaintext preview from markdown. */
function buildExcerpt(body: string): string {
  const withoutFront = body.replace(/^---\n[\s\S]*?\n---\n/, '')
  const text = withoutFront
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 220)
}

async function readMeta(
  root: string,
  abs: string,
  folder: NoteFolder
): Promise<NoteMeta> {
  const stat = await fs.stat(abs)
  let body = ''
  try {
    body = await fs.readFile(abs, 'utf8')
  } catch {
    /* ignore — treat as empty */
  }
  return {
    path: toPosix(path.relative(root, abs)),
    title: path.basename(abs, path.extname(abs)),
    folder,
    createdAt: stat.birthtimeMs || stat.ctimeMs,
    updatedAt: stat.mtimeMs,
    size: stat.size,
    tags: extractTags(body),
    excerpt: buildExcerpt(body)
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

export async function listNotes(root: string): Promise<NoteMeta[]> {
  const files = await walk(root)
  const metas: NoteMeta[] = []
  for (const file of files) {
    const folder = folderOf(root, file)
    if (!folder) continue
    metas.push(await readMeta(root, file, folder))
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt)
  return metas
}

function resolveSafe(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  if (!abs.startsWith(path.resolve(root))) {
    throw new Error(`Path escapes vault: ${rel}`)
  }
  return abs
}

export async function readNote(root: string, rel: string): Promise<NoteContent> {
  const abs = resolveSafe(root, rel)
  const folder = folderOf(root, abs)
  if (!folder) throw new Error(`Note not in a known folder: ${rel}`)
  const body = await fs.readFile(abs, 'utf8')
  const meta = await readMeta(root, abs, folder)
  return { ...meta, body }
}

export async function writeNote(root: string, rel: string, body: string): Promise<NoteMeta> {
  const abs = resolveSafe(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, 'utf8')
  const folder = folderOf(root, abs)
  if (!folder) throw new Error(`Note not in a known folder: ${rel}`)
  return await readMeta(root, abs, folder)
}

async function uniqueTitle(dir: string, baseTitle: string): Promise<string> {
  let candidate = baseTitle
  let n = 1
  while (true) {
    try {
      await fs.access(path.join(dir, `${candidate}.md`))
      n += 1
      candidate = `${baseTitle} ${n}`
    } catch {
      return candidate
    }
  }
}

export async function createNote(
  root: string,
  folder: NoteFolder,
  title?: string
): Promise<NoteMeta> {
  const base = (title && title.trim()) || 'Untitled'
  const dir = path.join(root, folder)
  await fs.mkdir(dir, { recursive: true })
  const finalTitle = await uniqueTitle(dir, base)
  const abs = path.join(dir, `${finalTitle}.md`)
  const body = `# ${finalTitle}\n\n`
  await fs.writeFile(abs, body, 'utf8')
  return await readMeta(root, abs, folder)
}

export async function renameNote(
  root: string,
  rel: string,
  nextTitle: string
): Promise<NoteMeta> {
  const abs = resolveSafe(root, rel)
  const folder = folderOf(root, abs)
  if (!folder) throw new Error(`Note not in a known folder: ${rel}`)
  const dir = path.dirname(abs)
  const trimmed = nextTitle.trim() || 'Untitled'
  const target = path.join(dir, `${trimmed}.md`)
  if (target !== abs) {
    try {
      await fs.access(target)
      throw new Error(`A note named "${trimmed}" already exists in ${folder}`)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    await fs.rename(abs, target)
  }
  return await readMeta(root, target, folder)
}

async function moveBetweenFolders(
  root: string,
  rel: string,
  target: NoteFolder
): Promise<NoteMeta> {
  const abs = resolveSafe(root, rel)
  const filename = path.basename(abs)
  const destDir = path.join(root, target)
  await fs.mkdir(destDir, { recursive: true })
  const baseTitle = path.basename(filename, path.extname(filename))
  const finalTitle = await uniqueTitle(destDir, baseTitle)
  const destAbs = path.join(destDir, `${finalTitle}.md`)
  await fs.rename(abs, destAbs)
  return await readMeta(root, destAbs, target)
}

export function moveToTrash(root: string, rel: string): Promise<NoteMeta> {
  return moveBetweenFolders(root, rel, 'trash')
}

export function restoreFromTrash(root: string, rel: string): Promise<NoteMeta> {
  return moveBetweenFolders(root, rel, 'inbox')
}

export function archiveNote(root: string, rel: string): Promise<NoteMeta> {
  return moveBetweenFolders(root, rel, 'archive')
}

export function unarchiveNote(root: string, rel: string): Promise<NoteMeta> {
  return moveBetweenFolders(root, rel, 'inbox')
}

export async function emptyTrash(root: string): Promise<void> {
  const trashDir = path.join(root, 'trash')
  try {
    const entries = await fs.readdir(trashDir)
    await Promise.all(
      entries.map((e) => fs.rm(path.join(trashDir, e), { recursive: true, force: true }))
    )
  } catch {
    /* no trash dir yet */
  }
}

export async function deleteNote(root: string, rel: string): Promise<void> {
  const abs = resolveSafe(root, rel)
  await fs.rm(abs, { force: true })
}

const WELCOME_NOTE = `# Welcome to ZenNotes

ZenNotes is a **file-based** markdown notes app made for focus and deep work. Every note is a plain \`.md\` file in your vault — yours to keep, sync, and version however you like.

## What you get

- **GitHub-flavored markdown** — tables, task lists, footnotes, strikethrough
- **Wiki links** — jump between notes with [[double brackets]]
- **Tags** — drop #ideas or #today anywhere and they'll appear in the sidebar
- **Math** — inline like $e^{i\\pi}+1=0$ or as blocks
- **Callouts** — Obsidian-style \`> [!note]\` blocks
- **Mermaid diagrams** — code-fenced \`\`\`mermaid blocks render inline
- **Full-text search** — press ⌘K from anywhere

## Try it

- [ ] Write your first note
- [ ] Add a tag like #welcome
- [ ] Link to [[another note]]

> [!tip]
> Press the + button in the sidebar to create a new note. Your changes save automatically.

\`\`\`js
// Syntax-highlighted code blocks just work
function hello(name) {
  return \`Hello, \${name}!\`
}
\`\`\`

Enjoy the quiet.
`
