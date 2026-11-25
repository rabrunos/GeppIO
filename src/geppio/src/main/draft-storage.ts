import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, documentToken, wellFormedText } from '@geppio/runtime/documents'
import { validExplorerBasename } from '../shared/explorer.ts'
import { exactKeys } from '../shared/plugin-data.ts'
import { isRecord } from '../shared/plugins.ts'
import type { RecoveryChoice } from '../shared/draft-recovery.ts'
import { profileDirectory } from './workspace-recovery.ts'

export interface StoredDraft extends RecoveryChoice { version: string; text: string }
export interface DraftGeneration { enabled: boolean; records: StoredDraft[] }
export const recoveryFile = 'draft-recovery.v1'
const headerLimit = 16 * 1024, fileLimit = DOCUMENT_SESSION_LIMITS.bytes + headerLimit + 4
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const key = (s: BigIntStats) => [s.dev, s.ino, s.birthtimeNs, s.ctimeNs, s.mtimeNs, s.size, s.mode, s.nlink].join(':')
const invalid = () => new Error('Invalid or changed draft generation')
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
export class RecoveryQuota extends Error {}
export class RecoveryStale extends Error {}

/** The header describes slices of raw UTF-8. JSON escaping cannot amplify the source quota. */
export function encodeGeneration(generation: DraftGeneration): Buffer {
  let total = 0
  const parts: Buffer[] = []
  if (generation.records.length > DOCUMENT_SESSION_LIMITS.count) throw new RecoveryQuota()
  if (!generation.enabled && generation.records.length || new Set(generation.records.map(r => r.key)).size !== generation.records.length) throw invalid()
  const records = generation.records.map(({ key, version, name, bom, text }) => {
    if (!documentToken(key) || !documentToken(version) || !validExplorerBasename(name) || typeof bom !== 'boolean' || !wellFormedText(text)) throw invalid()
    const bytes = Buffer.from(text), cost = bytes.length + (bom ? 3 : 0)
    total += cost
    if (cost > DOCUMENT_LIMIT || total > DOCUMENT_SESSION_LIMITS.bytes) throw new RecoveryQuota()
    parts.push(bytes)
    return { key, version, name, bom, length: bytes.length, hash: digest(bytes) }
  })
  const header = Buffer.from(JSON.stringify({ schemaVersion: 1, enabled: generation.enabled, records }))
  if (header.length > headerLimit) throw invalid()
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length)
  return Buffer.concat([prefix, header, ...parts])
}
export function decodeGeneration(bytes: Buffer): DraftGeneration {
  const size = bytes.readUInt32BE()
  if (size > headerLimit || size + 4 > bytes.length || bytes.length > fileLimit) throw invalid()
  const header: unknown = JSON.parse(decoder.decode(bytes.subarray(4, size + 4)))
  if (!isRecord(header) || !exactKeys(header, ['schemaVersion', 'enabled', 'records']) || header.schemaVersion !== 1 ||
    typeof header.enabled !== 'boolean' || !Array.isArray(header.records) || header.records.length > DOCUMENT_SESSION_LIMITS.count) throw invalid()
  let offset = size + 4, total = 0
  const records = header.records.map((item: unknown) => {
    if (!isRecord(item) || !exactKeys(item, ['key', 'version', 'name', 'bom', 'length', 'hash']) || !documentToken(item.key) || !documentToken(item.version) || !validExplorerBasename(item.name) ||
      typeof item.bom !== 'boolean' || typeof item.length !== 'number' || !Number.isSafeInteger(item.length) || item.length < 0 ||
      item.length + (item.bom ? 3 : 0) > DOCUMENT_LIMIT || offset + item.length > bytes.length) throw invalid()
    const source = bytes.subarray(offset, offset + item.length); offset += item.length; total += item.length + (item.bom ? 3 : 0)
    if (digest(source) !== item.hash) throw invalid()
    return { key: item.key, version: item.version, name: item.name, bom: item.bom, text: decoder.decode(source) }
  })
  if (total > DOCUMENT_SESSION_LIMITS.bytes || offset !== bytes.length || !header.enabled && records.length || new Set(records.map(r => r.key)).size !== records.length) throw invalid()
  return { enabled: header.enabled, records }
}
async function inspectFile(path: string) {
  let stat: BigIntStats
  try { stat = await lstat(path, { bigint: true }) }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw invalid()
  return stat
}
/** Fixed primary, previous and staging slots, each with the same byte budget. */
export class DraftStorage {
  private root: string
  private witness: string | null | undefined
  private lineage: string | null = null
  interrupted = false
  private promote: typeof rename
  constructor(root: string, promote: typeof rename = rename) { this.root = root; this.promote = promote }
  private async location() {
    const { folder, chain } = await profileDirectory(this.root)
    const lineage = folder + '|' + chain
    if (this.lineage !== null && lineage !== this.lineage) throw invalid()
    this.lineage = lineage
    return join(folder, recoveryFile)
  }
  private async readSlot(suffix: '' | '.previous' | '.tmp') {
    const path = (await this.location()) + suffix, stat = await inspectFile(path)
    if (!stat) {
      if ((await this.location()) + suffix !== path || await inspectFile(path)) throw invalid()
      return null
    }
    if (stat.size > BigInt(fileLimit)) throw invalid()
    const file = await open(path, 'r')
    try {
      const witness = key(stat)
      if (key(await file.stat({ bigint: true })) !== witness) throw invalid()
      const bytes = Buffer.alloc(Number(stat.size))
      for (let count = 0; count < bytes.length;) {
        const part = await file.read(bytes, count, bytes.length - count, count)
        if (!part.bytesRead) throw invalid()
        count += part.bytesRead
      }
      const after = await inspectFile((await this.location()) + suffix)
      if (!after || key(after) !== witness || key(await file.stat({ bigint: true })) !== witness) throw invalid()
      return { data: decodeGeneration(bytes), bytes, witness }
    } finally { await file.close() }
  }
  async load(): Promise<DraftGeneration> {
    const path = await this.location()
    this.interrupted = !!await inspectFile(path + '.previous') || !!await inspectFile(path + '.tmp')
    let primary
    try { primary = await this.readSlot('') }
    catch (error) {
      const previous = await this.readSlot('.previous')
      if (!previous) throw error
      this.interrupted = true; return previous.data
    }
    this.witness = primary?.witness ?? null
    if (primary) return primary.data
    return (await this.readSlot('.previous'))?.data ?? { enabled: true, records: [] }
  }
  private async removeSlot(suffix: '.previous' | '.tmp', current: () => boolean) {
    const path = (await this.location()) + suffix, before = await inspectFile(path)
    if (!before) return
    const after = await inspectFile((await this.location()) + suffix)
    if (!current() || !after || key(after) !== key(before)) throw invalid()
    await unlink(path)
  }
  async reconcile(expected: DraftGeneration, current: () => boolean, attempted?: DraftGeneration) {
    const observed = await this.load(), bytes = encodeGeneration(expected)
    if (!current()) throw new RecoveryStale()
    const observedBytes = encodeGeneration(observed)
    if (!observedBytes.equals(bytes) && (!attempted || !observedBytes.equals(encodeGeneration(attempted)))) throw new RecoveryStale()
    const primary = await this.readSlot('').catch(() => null)
    if (!primary || !primary.bytes.equals(observedBytes)) {
      const previous = await this.readSlot('.previous')
      if (previous && !previous.bytes.equals(bytes) || !previous && expected.records.length) throw invalid()
      await this.write(expected, current, true)
      return expected
    }
    // A valid primary already contains the confirmed source. Only retire abandoned auxiliary files.
    await this.removeSlot('.tmp', current)
    if ((await this.readSlot(''))?.witness !== primary.witness || !current()) throw invalid()
    await this.removeSlot('.previous', current)
    this.witness = primary.witness; this.interrupted = false
    return observed
  }
  async write(generation: DraftGeneration, current: () => boolean, reset = false) {
    const bytes = encodeGeneration(generation), path = await this.location(), temporary = path + '.tmp'
    const before = await inspectFile(path), witness = before ? key(before) : null
    if (!reset && witness !== this.witness) throw invalid()
    if (!current()) throw new RecoveryStale()
    if (reset) await this.removeSlot('.tmp', current)
    else if (this.interrupted || await inspectFile(path + '.previous')) throw invalid()
    const file = await open(temporary, 'wx', 0o600)
    let staged: string
    try { await file.writeFile(bytes); await file.sync(); staged = key(await file.stat({ bigint: true })) }
    finally { await file.close() }
    const prepared = await this.readSlot('.tmp')
    if (prepared?.witness !== staged || !prepared.bytes.equals(bytes)) throw invalid()
    if (before && !reset) {
      const prior = await this.readSlot('')
      if (!prior || prior.witness !== witness) throw invalid()
      if (!current()) { await this.removeSlot('.tmp', () => true); throw new RecoveryStale() }
      const backup = await open((await this.location()) + '.previous', 'wx', 0o600)
      try { await backup.writeFile(prior.bytes); await backup.sync() } finally { await backup.close() }
      if (!(await this.readSlot('.previous'))?.bytes.equals(prior.bytes)) throw invalid()
    }
    const stage = await inspectFile((await this.location()) + '.tmp')
    if (!stage || key(stage) !== staged) throw invalid()
    const latest = await inspectFile(path)
    if ((latest ? key(latest) : null) !== witness) throw invalid()
    if (!current()) {
      await this.removeSlot('.tmp', () => true)
      if (!reset) await this.removeSlot('.previous', () => true)
      throw new RecoveryStale()
    }
    await this.promote(temporary, path)
    // Rename can change ctime. Verify the file identity, the decoded generation and the exact bytes.
    const confirmed = await inspectFile(await this.location())
    const primary = await this.readSlot('')
    if (!confirmed || stage.dev !== confirmed.dev || stage.ino !== confirmed.ino || stage.birthtimeNs !== confirmed.birthtimeNs ||
      !primary?.bytes.equals(bytes) || primary.witness !== key(confirmed)) throw invalid()
    this.witness = primary.witness
    await this.removeSlot('.previous', () => true)
    this.interrupted = false
  }
}
