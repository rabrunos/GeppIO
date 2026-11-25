import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWorkspaceTools, WORKSPACE_TOOLS_LIMITS } from '../shared/workspace-tools.ts'
import type { WorkspaceToolsResult } from '../shared/workspace-tools.ts'
import { inspectExplorerPath } from './explorer.ts'
import type { WorkspaceOwner } from './workspace.ts'

type Stage = 'missing' | 'before-open' | 'opened' | 'read' | 'closed'
const expired = (): WorkspaceToolsResult => ({ ok: false, expired: true, error: 'A autorização do projeto expirou.' })
class LostRoot extends Error {}
function changed(): never { throw new Error('Arquivo alterado durante a leitura.') }
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`
function sameFile(a: BigIntStats, b: BigIntStats) {
  return a.isFile() && b.isFile() && a.nlink === 1n && b.nlink === 1n && identity(a) === identity(b) &&
    a.size === b.size && a.mode === b.mode && a.ctimeNs === b.ctimeNs && a.mtimeNs === b.mtimeNs
}
async function entry(path: string) {
  try { return await lstat(path, { bigint: true }) }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

/** Read just the two fixed children of the current workspace. No enumeration or new navigation grants. */
export async function readWorkspaceTools(workspace: WorkspaceOwner, current: () => boolean,
    observe?: (stage: Stage) => Promise<void>): Promise<WorkspaceToolsResult> {
  const { directories } = workspace, root = workspace.status().root, descriptor = directories.descriptor
  if (!current() || !root || !descriptor) return expired()
  const owner = workspace.guard(), directory = directories.guard()
  const active = () => current() && owner() && directory() && workspace.status().root?.id === root.id
  function guard() { if (!active()) throw new LostRoot() }
  async function rootPath() {
    guard()
    try { const path = await directories.folder(root!.id, active); guard(); return path }
    catch { throw new LostRoot() }
  }
  async function missing(path: string, checkParent: () => Promise<unknown>): Promise<WorkspaceToolsResult> {
    if (observe) await observe('missing')
    await checkParent(); guard()
    if (await entry(path)) return changed()
    await checkParent(); guard()
    return { ok: true, root: root!.id, status: 'missing', reports: [] }
  }
  try {
    const folder = join(await rootPath(), '.geppio'); guard()
    const parent = await entry(folder); guard()
    if (!parent) return await missing(folder, rootPath)
    if (!parent.isDirectory() || parent.isSymbolicLink()) return changed()
    const parentChain = identity(parent) + '/' + descriptor.chain
    async function verifyParent() {
      await rootPath(); guard()
      const actual = await inspectExplorerPath(folder, 'directory'); guard()
      if (actual.chain !== parentChain) return changed()
    }
    await verifyParent(); guard()
    const path = join(folder, 'tools.json'), before = await entry(path); guard()
    if (!before) return await missing(path, verifyParent)
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(WORKSPACE_TOOLS_LIMITS.bytes)) return changed()
    const expected = before, chain = identity(before) + '/' + parentChain
    async function verifyFile() {
      await verifyParent(); guard()
      const actual = await inspectExplorerPath(path, 'file'); guard()
      if (actual.chain !== chain) return changed()
      const final = await entry(path); guard()
      if (!final || !sameFile(expected, final)) return changed()
    }
    if (observe) await observe('before-open')
    await verifyFile(); guard()
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    const file = await open(path, flags)
    let reports
    try {
      guard()
      if (observe) await observe('opened')
      guard()
      if (!sameFile(before, await file.stat({ bigint: true }))) return changed()
      await verifyFile(); guard()
      const bytes = Buffer.alloc(Number(before.size))
      let offset = 0
      while (offset < bytes.length) {
        guard()
        const { bytesRead } = await file.read(bytes, offset, Math.min(16 * 1024, bytes.length - offset), offset)
        guard()
        if (!bytesRead) return changed()
        offset += bytesRead
        if (observe) await observe('read')
      }
      guard()
      if (!sameFile(before, await file.stat({ bigint: true }))) return changed()
      reports = parseWorkspaceTools(bytes).reports
    } finally { await file.close() }
    if (observe) await observe('closed')
    await verifyFile(); guard()
    return { ok: true, root: root.id, status: 'ready', reports }
  } catch (error) {
    if (error instanceof LostRoot || !active()) return expired()
    try { await rootPath() } catch { return expired() }
    return { ok: false, error: 'Não foi possível ler um relatório Tools válido. Confira o arquivo e atualize novamente.' }
  }
}
