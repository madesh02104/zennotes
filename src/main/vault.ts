import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  FolderEntry,
  NoteContent,
  NoteFolder,
  NoteMeta,
  VaultInfo
} from '@shared/ipc'

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

/** Pull unique `[[wikilink]]` targets out of markdown text. Supports
 *  `[[target|label]]` by discarding the label. Ignores fenced/inline code. */
function extractWikilinks(body: string): string[] {
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
  const re = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    seen.add(m[1].trim())
  }
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
    wikilinks: extractWikilinks(body),
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

/**
 * Walk every directory under the three top-level folders and return a
 * flat list of folder entries. This is the source of truth for the
 * sidebar tree — empty folders that contain no notes are otherwise
 * invisible, because notes are the only things we track per-file.
 */
export async function listFolders(root: string): Promise<FolderEntry[]> {
  const out: FolderEntry[] = []
  for (const folder of FOLDERS) {
    const topAbs = path.join(root, folder)
    const walk = async (dirAbs: string, subpath: string): Promise<void> => {
      let entries: Dirent[]
      try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue
        if (e.name.startsWith('.')) continue
        const nextSub = subpath ? `${subpath}/${e.name}` : e.name
        out.push({ folder, subpath: nextSub })
        await walk(path.join(dirAbs, e.name), nextSub)
      }
    }
    await walk(topAbs, '')
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
  title?: string,
  subpath = ''
): Promise<NoteMeta> {
  const base = (title && title.trim()) || 'Untitled'
  const clean = subpath.replace(/^\/+|\/+$/g, '')
  const dir = clean
    ? resolveSafe(root, path.posix.join(folder, clean))
    : path.join(root, folder)
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

/* ---------- Folder operations ---------------------------------------- */

/**
 * Create a subfolder at `{topFolder}/{subpath}`. Missing parents are
 * created recursively (so the caller can pass `Work/Research/2026`
 * and it just works).
 */
export async function createFolder(
  root: string,
  topFolder: NoteFolder,
  subpath: string
): Promise<void> {
  const trimmed = subpath.replace(/^\/+|\/+$/g, '')
  if (!trimmed) throw new Error('Folder name is required')
  const abs = resolveSafe(root, path.posix.join(topFolder, trimmed))
  await fs.mkdir(abs, { recursive: true })
}

/**
 * Rename or move a subfolder. `newSubpath` is the full target path
 * relative to `{topFolder}` — e.g. rename `Work/Research` → `Projects/Research`
 * also moves it into `Projects`. Refuses to move into itself or a
 * descendant, and refuses to touch the top-level folder.
 */
export async function renameFolder(
  root: string,
  topFolder: NoteFolder,
  oldSubpath: string,
  newSubpath: string
): Promise<string> {
  const oldClean = oldSubpath.replace(/^\/+|\/+$/g, '')
  const newClean = newSubpath.replace(/^\/+|\/+$/g, '')
  if (!oldClean) throw new Error('Cannot rename the top-level folder')
  if (!newClean) throw new Error('Target folder name is required')

  const oldAbs = resolveSafe(root, path.posix.join(topFolder, oldClean))
  const newAbs = resolveSafe(root, path.posix.join(topFolder, newClean))
  if (newAbs === oldAbs) return newClean

  const sep = path.sep
  if ((newAbs + sep).startsWith(oldAbs + sep)) {
    throw new Error('Cannot move a folder into itself')
  }

  // Refuse to overwrite a different existing folder.
  try {
    await fs.access(newAbs)
    throw new Error(`A folder already exists at "${newClean}"`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  await fs.mkdir(path.dirname(newAbs), { recursive: true })
  await fs.rename(oldAbs, newAbs)
  return newClean
}

/**
 * Delete a subfolder and everything inside. Refuses to touch the
 * top-level `inbox`/`archive`/`trash` folders themselves.
 */
export async function deleteFolder(
  root: string,
  topFolder: NoteFolder,
  subpath: string
): Promise<void> {
  const clean = subpath.replace(/^\/+|\/+$/g, '')
  if (!clean) throw new Error('Cannot delete the top-level folder')
  const abs = resolveSafe(root, path.posix.join(topFolder, clean))
  await fs.rm(abs, { recursive: true, force: true })
}

/**
 * Duplicate a subfolder (recursively, with all its contents) next to
 * itself, appending " copy" (and " copy 2", " copy 3" on conflict) to
 * the leaf name.
 */
export async function duplicateFolder(
  root: string,
  topFolder: NoteFolder,
  subpath: string
): Promise<string> {
  const clean = subpath.replace(/^\/+|\/+$/g, '')
  if (!clean) throw new Error('Cannot duplicate the top-level folder')
  const oldAbs = resolveSafe(root, path.posix.join(topFolder, clean))
  const parentAbs = path.dirname(oldAbs)
  const baseName = path.basename(oldAbs)
  let copyName = `${baseName} copy`
  let n = 1
  while (true) {
    try {
      await fs.access(path.join(parentAbs, copyName))
      n += 1
      copyName = `${baseName} copy ${n}`
    } catch {
      break
    }
  }
  const newAbs = path.join(parentAbs, copyName)
  await fs.cp(oldAbs, newAbs, { recursive: true })
  return path
    .relative(path.join(root, topFolder), newAbs)
    .split(path.sep)
    .join('/')
}

/** Build the absolute on-disk path for a vault folder / subfolder. */
export function folderAbsolutePath(
  root: string,
  topFolder: NoteFolder,
  subpath: string
): string {
  const clean = subpath.replace(/^\/+|\/+$/g, '')
  return clean
    ? resolveSafe(root, path.posix.join(topFolder, clean))
    : path.join(root, topFolder)
}

/* ---------- Notes ---------------------------------------------------- */

/**
 * Move a note to a different folder / subfolder. Renames on disk
 * (preserving the filename, appending a numeric suffix if there's a
 * collision), then re-reads meta for the new location.
 */
export async function moveNote(
  root: string,
  oldRel: string,
  targetFolder: NoteFolder,
  targetSubpath: string
): Promise<NoteMeta> {
  const oldAbs = resolveSafe(root, oldRel)
  const filename = path.basename(oldAbs)
  const cleanSub = targetSubpath.replace(/^\/+|\/+$/g, '')
  const destDir = cleanSub
    ? resolveSafe(root, path.posix.join(targetFolder, cleanSub))
    : path.join(root, targetFolder)

  // No-op if the source already lives at the destination.
  if (path.dirname(oldAbs) === destDir) {
    const folder = folderOf(root, oldAbs)
    if (!folder) throw new Error(`Note not in a known folder: ${oldRel}`)
    return await readMeta(root, oldAbs, folder)
  }

  await fs.mkdir(destDir, { recursive: true })
  const ext = path.extname(filename)
  const baseTitle = path.basename(filename, ext)
  const finalTitle = await uniqueTitle(destDir, baseTitle)
  const destAbs = path.join(destDir, `${finalTitle}${ext}`)
  await fs.rename(oldAbs, destAbs)
  return await readMeta(root, destAbs, targetFolder)
}

export async function duplicateNote(root: string, rel: string): Promise<NoteMeta> {
  const abs = resolveSafe(root, rel)
  const folder = folderOf(root, abs)
  if (!folder) throw new Error(`Note not in a known folder: ${rel}`)
  const dir = path.dirname(abs)
  const ext = path.extname(abs)
  const baseTitle = path.basename(abs, ext)
  const copyTitle = await uniqueTitle(dir, `${baseTitle} copy`)
  const destAbs = path.join(dir, `${copyTitle}${ext}`)
  const body = await fs.readFile(abs, 'utf8')
  await fs.writeFile(destAbs, body, 'utf8')
  return await readMeta(root, destAbs, folder)
}

/**
 * Returns the absolute path for a note, for use with `shell.showItemInFolder`
 * (Finder reveal). Path resolution is validated the same way as other
 * vault operations.
 */
export function absolutePath(root: string, rel: string): string {
  return resolveSafe(root, rel)
}

const WELCOME_NOTE = `# Welcome to ZenNotes

ZenNotes is a **file-based** markdown notes app made for focus and deep work. Every note is a plain \`.md\` file in your vault — yours to keep, sync, and version however you like.

## What you get

- **GitHub-flavored markdown** — tables, task lists, footnotes, strikethrough
- **Wiki links** — jump between notes with [[double brackets]]
- **Tags** — write a hashtag like \`#project\` in any note and it appears in the sidebar
- **Math** — inline like $e^{i\\pi}+1=0$ or as blocks
- **Callouts** — Obsidian-style \`> [!note]\` blocks
- **Mermaid diagrams** — code-fenced \`\`\`mermaid blocks render inline
- **Full-text search** — press ⌘K from anywhere

## Try it

- [ ] Write your first note
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
