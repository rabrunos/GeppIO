import { createHash } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import type { BigIntStats } from 'node:fs'
import { DOCUMENT_SESSION_LIMITS } from '@geppio/runtime/documents'
import { exactKeys } from '../shared/plugin-data.ts'
import { isRecord } from '../shared/plugins.ts'
import { safeExplorerName } from './explorer.ts'
import { validTabArrangement, validWorkspaceLanguage, validWorkspaceSelection } from '../shared/workspace.ts'
import type { DocumentLanguage } from '../shared/document-status.ts'
import type { TabArrangement, WorkspaceSelection } from '../shared/workspace.ts'

export const WORKSPACE_RECOVERY_LIMIT = 512 * 1024
export interface RememberedFile { names: string[]; hash: string; dirty: boolean; language: DocumentLanguage | null; selection: WorkspaceSelection }
export interface WorkspaceRecord { schemaVersion: 1; remember: boolean; project: { path: string; chain: string } | null; files: RememberedFile[]; active: number; arrangement?: TabArrangement<number> }
export const emptyWorkspaceRecord = (remember = true): WorkspaceRecord => ({ schemaVersion: 1, remember, project: null, files: [], active: -1 })
export const workspaceMetadataError = 'Não foi possível confirmar a sessão local. Metadados incompatíveis ou alterados foram preservados. Use Esquecer recuperação para removê-los; arquivos e rascunhos abertos continuam independentes.'
export class WorkspaceRecoveryCanceled extends Error {}
export function parseWorkspaceRecord(value: unknown): WorkspaceRecord {
  const fields = ['schemaVersion', 'remember', 'project', 'files', 'active']
  if (!isRecord(value) || !exactKeys(value, 'arrangement' in value ? [...fields, 'arrangement'] : fields) || value.schemaVersion !== 1 || typeof value.remember !== 'boolean' || !Array.isArray(value.files) || value.files.length > DOCUMENT_SESSION_LIMITS.count || !Number.isSafeInteger(value.active) || Number(value.active) < -1 || Number(value.active) >= value.files.length) throw new Error(workspaceMetadataError)
  if ('arrangement' in value && (!value.project || !validTabArrangement(value.arrangement, value.files.map((_, index) => index)))) throw new Error(workspaceMetadataError)
  if (value.project !== null && (!isRecord(value.project) || !exactKeys(value.project, ['path', 'chain']) || typeof value.project.path !== 'string' || value.project.path.length > 8192 || [...value.project.path].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !isAbsolute(value.project.path) || resolve(value.project.path) !== value.project.path || typeof value.project.chain !== 'string' || !/^[\d:/-]{1,65536}$/.test(value.project.chain))) throw new Error(workspaceMetadataError)
  if ((!value.remember || value.project === null) && (value.files.length || value.active !== -1 || value.project !== null)) throw new Error(workspaceMetadataError)
  for (const file of value.files) if (!isRecord(file) || !exactKeys(file, ['names', 'hash', 'dirty', 'language', 'selection']) || !Array.isArray(file.names) || !file.names.length || file.names.length > 32 || !file.names.every(name => typeof name === 'string' && safeExplorerName(name) && name.toLowerCase() !== '.git') || typeof file.hash !== 'string' || !/^[a-f0-9]{64}$/.test(file.hash) || typeof file.dirty !== 'boolean' || !validWorkspaceLanguage(file.language) || !validWorkspaceSelection(file.selection)) throw new Error(workspaceMetadataError)
  if (new Set(value.files.map(file => { const name = file.names.join('/'); return process.platform === 'win32' ? name.toLowerCase() : name })).size !== value.files.length) throw new Error(workspaceMetadataError)
  return structuredClone(value) as unknown as WorkspaceRecord
}
const statKey = (stat: BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs, stat.size, stat.mode, stat.nlink].join(':')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Preserve lexical link checks even when Windows supplied an 8.3 profile path. */
export async function profileDirectory(root: string) {
  const chain: string[] = []
  for (let path = resolve(root); ; path = dirname(path)) {
    const stat = await lstat(path, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(workspaceMetadataError)
    chain.push(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`)
    if (path === parse(path).root) break
  }
  return { folder: await realpath(root), chain: chain.join('/') }
}

/** Fixed app-owned metadata only. No project writes and no source/draft storage. */
export class WorkspaceRecovery {
  private record = emptyWorkspaceRecord()
  private error: string | null = null
  private loaded: Promise<void> | null = null
  private witness: string | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private root: string
  private canonicalRoot: string | null = null
  constructor(root: string) { this.root = root }
  get directoryPath() { return this.canonicalRoot }
  get snapshot() { return { record: structuredClone(this.record), error: this.error } }
  private async directory() {
    await mkdir(this.root, { recursive: true })
    const directory = await profileDirectory(this.root)
    this.canonicalRoot = directory.folder
    return directory
  }
  private async raw(forget = false) {
    const directory = await this.directory(), path = join(directory.folder, 'workspace-session.v1.json')
    try {
      const before = await lstat(path, { bigint: true })
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw new Error(workspaceMetadataError)
      if (before.size > BigInt(WORKSPACE_RECOVERY_LIMIT)) {
        if (!forget) throw new Error(workspaceMetadataError)
        const after = await this.directory()
        if (after.chain !== directory.chain || after.folder !== directory.folder || statKey(before) !== statKey(await lstat(path, { bigint: true }))) throw new Error(workspaceMetadataError)
        return { directory, path, bytes: null, key: statKey(before) + ':oversized' }
      }
      const file = await open(path, 'r')
      try {
        if (statKey(before) !== statKey(await file.stat({ bigint: true }))) throw new Error(workspaceMetadataError)
        const buffer = Buffer.alloc(WORKSPACE_RECOVERY_LIMIT + 1); let count = 0
        while (count < buffer.length) { const part = await file.read(buffer, count, buffer.length - count, count); if (!part.bytesRead) break; count += part.bytesRead }
        if (count > WORKSPACE_RECOVERY_LIMIT || statKey(before) !== statKey(await file.stat({ bigint: true })) || statKey(before) !== statKey(await lstat(path, { bigint: true }))) throw new Error(workspaceMetadataError)
        const after = await this.directory()
        if (after.folder !== directory.folder || after.chain !== directory.chain) throw new Error(workspaceMetadataError)
        const bytes = buffer.subarray(0, count)
        return { directory, path, bytes, key: statKey(before) + ':' + digest(bytes) }
      } finally { await file.close() }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const after = await this.directory()
        if (after.chain !== directory.chain || after.folder !== directory.folder) throw new Error(workspaceMetadataError, { cause: error })
        return { directory, path, bytes: null, key: null }
      }
      throw error
    }
  }
  load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        const raw = await this.raw(); this.witness = raw.key
        this.record = raw.bytes ? parseWorkspaceRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes))) : emptyWorkspaceRecord()
      } catch { this.error = workspaceMetadataError; this.record = emptyWorkspaceRecord(false) }
    })()
  }
  save(record: WorkspaceRecord, current: () => boolean, forget = false): Promise<void> {
    const candidate = parseWorkspaceRecord(record)
    const operation = this.queue.catch(() => undefined).then(async () => {
      await this.load()
      if (this.error && !forget) throw new Error(workspaceMetadataError)
      const raw = await this.raw(forget)
      if (!current()) throw new WorkspaceRecoveryCanceled()
      if (!forget && raw.key !== this.witness) throw new Error(workspaceMetadataError)
      const bytes = Buffer.from(JSON.stringify(candidate))
      if (bytes.length > WORKSPACE_RECOVERY_LIMIT) throw new Error(workspaceMetadataError)
      // One fixed exclusive staging slot bounds abandoned crash metadata too.
      const temporary = join(raw.directory.folder, '.workspace-session.v1.tmp')
      let created = false
      try {
        if (forget) {
          try {
            const abandoned = await lstat(temporary, { bigint: true })
            if (!abandoned.isFile() || abandoned.isSymbolicLink() || abandoned.nlink !== 1n || !current()) throw new Error(workspaceMetadataError)
            await unlink(temporary)
          } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
        }
        const file = await open(temporary, 'wx', 0o600); created = true
        try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
        const latest = await this.raw(forget)
        if (!current()) throw new WorkspaceRecoveryCanceled()
        if (latest.key !== raw.key || latest.directory.chain !== raw.directory.chain || latest.directory.folder !== raw.directory.folder) throw new Error(workspaceMetadataError)
        await rename(temporary, raw.path); created = false
        const confirmed = await this.raw()
        if (!confirmed.bytes?.equals(bytes)) throw new Error(workspaceMetadataError)
        this.witness = confirmed.key; this.record = candidate; this.error = null
      } finally { if (created) await unlink(temporary).catch(() => undefined) }
    }).catch(error => { if (!(error instanceof WorkspaceRecoveryCanceled)) this.error = workspaceMetadataError; throw error })
    this.queue = operation
    return operation
  }
  async forget(current: () => boolean) { await this.save(emptyWorkspaceRecord(false), current, true) }
  label(): string | null { return this.record.project ? basename(this.record.project.path).slice(0, 255) || 'Projeto' : null }
}
