/**
 * `zen vault info` — print the resolved vault root + a small sanity
 * snapshot. Useful as a sanity check after install (`zen vault info`
 * should match what the GUI shows).
 */

import { listFolders, listNotes } from '../../mcp/vault-ops.js'
import { getBool, type ParsedArgs } from '../args.js'
import { emitJson, emitLine } from '../format.js'

export async function cmdVaultInfo(vault: string, args: ParsedArgs): Promise<void> {
  const [notes, subfolders] = await Promise.all([listNotes(vault), listFolders(vault)])
  const counts = {
    inbox: 0,
    quick: 0,
    archive: 0,
    trash: 0
  }
  for (const n of notes) counts[n.folder] += 1

  const summary = {
    vaultRoot: vault,
    counts,
    subfolderCount: subfolders.length
  }
  if (getBool(args, 'json')) {
    emitJson(summary)
    return
  }
  emitLine(`Vault: ${vault}`)
  emitLine(`  inbox:   ${counts.inbox}`)
  emitLine(`  quick:   ${counts.quick}`)
  emitLine(`  archive: ${counts.archive}`)
  emitLine(`  trash:   ${counts.trash}`)
  emitLine(`  subfolders: ${subfolders.length}`)
}
