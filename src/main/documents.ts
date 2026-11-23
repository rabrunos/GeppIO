import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, wellFormedText } from '../shared/documents.ts'
import type { DocumentDraft, DocumentError, DocumentResult, DocumentSnapshot } from '../shared/documents.ts'

const messages: Record<DocumentError, string> = {
  invalid: 'Solicitação de documento inválida.', stale: 'Autorização expirada. Verifique o arquivo antes de retomar a edição.', busy: 'Aguarde a operação de arquivo em andamento.',
  unsupported: 'Arquivo não suportado. Selecione texto UTF-8 válido, sem dados binários, links ou caminhos especiais.',
  oversized: 'O arquivo excede o limite de 1 MiB.', unavailable: 'Arquivo indisponível. O rascunho foi mantido.',
  limit: 'Limite de 8 arquivos abertos ou 8 MiB de conteúdo. Feche uma aba antes de abrir outro arquivo.',
  conflict: 'O arquivo ou seu destino mudou no disco. Copie o rascunho, feche a aba e reabra; nenhuma alteração externa foi sobrescrita.',
  write: 'A gravação foi recusada antes de substituir o arquivo. Verifique as permissões. O rascunho foi mantido.',
  unconfirmed: 'Não foi possível confirmar o conteúdo final no disco. Copie o rascunho e confira o arquivo antes de voltar a salvar.'
}
export class DocumentFailure extends Error {
  readonly kind: DocumentError
  readonly document?: string
  constructor(kind: DocumentError, document?: string) { super(messages[kind]); this.kind = kind; this.document = document }
}
export function documentFailure(error: unknown): DocumentResult {
  const code = error instanceof DocumentFailure ? error.kind : 'unavailable'
  return { ok: false, code, error: messages[code], ...(error instanceof DocumentFailure && error.document ? { failed: error.document } : {}) }
}
export function expiredDocumentResponse(result: DocumentResult): DocumentResult {
  // Keep only the outcome of a submitted save. Never return IDs or snapshots after revocation.
  return documentFailure(new DocumentFailure(!result.ok && result.code === 'unconfirmed' ? 'unconfirmed' : 'stale'))
}
type Evidence = { path: string; chain: string; stat: BigIntStats; bytes: Buffer; text: string; bom: boolean }
type Selection = { evidence: Evidence; snapshot: DocumentSnapshot }
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`
const sameStat = (a: BigIntStats, b: BigIntStats) => identity(a) === identity(b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.nlink === b.nlink
function encode(text: string, bom: boolean): Buffer {
  if (!wellFormedText(text) || [...text].some(character => { const code = character.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code) || code === 127 })) throw new DocumentFailure('unsupported')
  const bytes = Buffer.from((bom ? '\ufeff' : '') + text, 'utf8')
  if (bytes.length > DOCUMENT_LIMIT) throw new DocumentFailure('oversized')
  return bytes
}
async function inspectPath(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path || (process.platform === 'win32' && (!/^[a-z]:\\/i.test(path) || path.slice(2).includes(':') || path.split(/[\\/]/).some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))) throw new DocumentFailure('unsupported')
  const chain: string[] = []
  for (let current = path; ; current = dirname(current)) {
    const stat = await lstat(current, { bigint: true })
    if (stat.isSymbolicLink() || current === path && (!stat.isFile() || stat.nlink !== 1n) || current !== path && !stat.isDirectory()) throw new DocumentFailure('unsupported')
    if (current !== path) chain.push(identity(stat))
    if (current === parse(current).root) break
  }
  const actual = await realpath(path)
  if ((process.platform === 'win32' ? actual.toLowerCase() !== path.toLowerCase() : actual !== path)) throw new DocumentFailure('unsupported')
  return chain.join('/')
}
/** Optional Main-only bounds for scanning. Charge actual bytes before any later validation can fail. */
export interface DocumentReadControl {
  authorize(stat: BigIntStats): Promise<void>
  check(size: number): void
  consume(bytes: number): void
}
async function inspect(path: string, control?: DocumentReadControl): Promise<Evidence> {
  const chain = await inspectPath(path), before = await lstat(path, { bigint: true })
  if (before.size > BigInt(DOCUMENT_LIMIT)) throw new DocumentFailure('oversized')
  control?.check(Number(before.size))
  const file = await open(path, 'r')
  try {
    const initial = await file.stat({ bigint: true })
    if (!sameStat(before, initial)) throw new DocumentFailure('conflict')
    if (control) await control.authorize(initial)
    const buffer = Buffer.alloc(control ? Number(initial.size) : DOCUMENT_LIMIT + 1)
    let length = 0
    while (length < buffer.length) {
      control?.check(buffer.length - length)
      const requested = control ? Math.min(buffer.length - length, 64 * 1024) : buffer.length - length
      const { bytesRead } = await file.read(buffer, length, requested, length)
      control?.consume(bytesRead)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > DOCUMENT_LIMIT) throw new DocumentFailure('oversized')
    if (control && length !== buffer.length) throw new DocumentFailure('conflict')
    const bytes = buffer.subarray(0, length), bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes) } catch { throw new DocumentFailure('unsupported') }
    encode(text, bom)
    const after = await file.stat({ bigint: true })
    if (!sameStat(initial, after) || !sameStat(after, await lstat(path, { bigint: true })) || chain !== await inspectPath(path)) throw new DocumentFailure('conflict')
    return { path, chain, stat: after, bytes, text, bom }
  } finally { await file.close() }
}
const sameEvidence = (a: Evidence, b: Evidence) => a.path === b.path && a.chain === b.chain && sameStat(a.stat, b.stat) && a.bytes.equals(b.bytes)
const sameFile = (original: Evidence, chain: string, stat: BigIntStats) => original.chain === chain &&
  identity(original.stat) === identity(stat) && original.stat.birthtimeNs === stat.birthtimeNs && stat.isFile() && stat.nlink === 1n
function documentWitness(evidence: Evidence) {
  const stat = evidence.stat
  return { identity: [evidence.chain, identity(stat), stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs, stat.mode, stat.size].join('/'),
    fingerprint: createHash('sha256').update(evidence.bytes).digest('hex') }
}
/** Discard source and descriptor after the caller has searched this one file. */
export async function inspectSearchDocument(path: string, control: DocumentReadControl) {
  const evidence = await inspect(path, control)
  return { text: evidence.text, witness: documentWitness(evidence) }
}
export type DocumentDecision = 'save' | 'discard' | 'cancel'
/** One window's bounded native grants. Adding/activating a tab never replaces another grant. */
export class DocumentStore {
  private selections = new Map<string, Selection>()
  private active: string | null = null
  private generation = 0
  private readonly replace: (from: string, to: string) => Promise<void>
  constructor(replace: (from: string, to: string) => Promise<void> = (from, to) => rename(from, to)) { this.replace = replace }
  get snapshot(): DocumentSnapshot | null { const selected = this.active ? this.selections.get(this.active) : null; return selected ? { ...selected.snapshot } : null }
  get snapshots(): DocumentSnapshot[] { return [...this.selections.values()].map(value => ({ ...value.snapshot })) }
  result(canceled = false): DocumentResult { return { ok: true, document: this.snapshot, documents: this.snapshots, ...(canceled ? { canceled: true } : {}) } }
  /** Main-only display association. Never returned through IPC. */
  filePath(id: string): string | null { return this.selections.get(id)?.evidence.path ?? null }
  hasFileAt(path: string) { return [...this.selections.values()].some(entry => relative(entry.evidence.path, path) === '') }
  /** Main-only recovery witness; neither source nor old grants are persisted. */
  fingerprint(id: string): string | null { const selected = this.selections.get(id); return selected ? createHash('sha256').update(selected.evidence.bytes).digest('hex') : null }
  async validate(id: string, current: () => boolean): Promise<void> {
    const selected = this.selections.get(id)
    if (!selected || !sameEvidence(selected.evidence, await inspect(selected.evidence.path)) || !current() || this.selections.get(id) !== selected) throw new DocumentFailure('conflict', id)
  }
  guard(): () => boolean { const generation = this.generation; return () => generation === this.generation }
  revoke(): void { this.generation++; this.selections.clear(); this.active = null }
  private current(draft: DocumentDraft | null): Selection | null {
    if (!this.selections.size && draft === null) return null
    const selected = draft ? this.selections.get(draft.id) : undefined
    if (!draft || !selected || draft.revision !== selected.snapshot.revision) throw new DocumentFailure('stale', draft?.id)
    return selected
  }
  activate(id: string): DocumentResult {
    if (!this.selections.has(id)) throw new DocumentFailure('stale')
    this.active = id; return { ok: true, document: this.snapshot }
  }
  async select(path: string, draft: DocumentDraft | null, _decide: () => Promise<DocumentDecision>, current: () => boolean,
    authorize?: (witness: () => ReturnType<typeof documentWitness>) => Promise<void>, readControl?: DocumentReadControl,
    reuse: 'path' | 'file-identity' = 'path'): Promise<DocumentResult> {
    if (draft) this.current(draft)
    const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    const atPath = () => [...this.selections.values()].find(value => key(value.evidence.path) === key(path))
    const retained = reuse === 'file-identity' ? atPath() : undefined
    if (retained) {
      // Activating an existing grant returns its confirmed snapshot and keeps its
      // independent draft. Disk content can have changed since that confirmation.
      const original = retained.evidence
      if (!current()) throw new DocumentFailure('stale')
      const chain = await inspectPath(path), stat = await lstat(path, { bigint: true })
      if (!current() || !sameFile(original, chain, stat)) throw new DocumentFailure('stale')
      await readControl?.authorize(stat)
      await authorize?.(() => documentWitness(original))
      if (!current() || retained.evidence !== original || this.selections.get(retained.snapshot.id) !== retained) throw new DocumentFailure('stale')
      return this.activate(retained.snapshot.id)
    }
    const candidate = await inspect(path, readControl)
    if (!current()) throw new DocumentFailure('stale')
    // Native picker/Explorer selection authorizes just this candidate, never an
    // implicit Save/Discard of another document. Revalidate before granting it.
    if (!sameEvidence(candidate, await inspect(path, readControl))) throw new DocumentFailure('conflict')
    await authorize?.(() => documentWitness(candidate))
    if (!current()) throw new DocumentFailure('stale')
    const existing = atPath()
    if (existing && existing.evidence.path !== path && identity(existing.evidence.stat) !== identity(candidate.stat)) throw new DocumentFailure('conflict', existing.snapshot.id)
    if (existing) {
      if (reuse === 'file-identity' && !sameFile(existing.evidence, candidate.chain, candidate.stat)) throw new DocumentFailure('stale')
      return this.activate(existing.snapshot.id)
    }
    if (this.selections.size >= DOCUMENT_SESSION_LIMITS.count || [...this.selections.values()].reduce((sum, value) => sum + value.evidence.bytes.length, candidate.bytes.length) > DOCUMENT_SESSION_LIMITS.bytes) throw new DocumentFailure('limit')
    const snapshot = { id: randomUUID(), revision: randomUUID(), name: basename(path).slice(0, 255), label: [basename(dirname(path)), basename(path)].filter(Boolean).join('/').slice(0, 511), text: candidate.text, bom: candidate.bom }
    this.selections.set(snapshot.id, { evidence: candidate, snapshot }); this.active = snapshot.id
    return this.result()
  }
  async save(draft: DocumentDraft, current: () => boolean): Promise<DocumentSnapshot> {
    const selected = this.current(draft)!, original = selected.evidence, bytes = encode(draft.text, original.bom)
    const check = async () => {
      const disk = await inspect(original.path)
      if (!sameEvidence(original, disk)) throw new DocumentFailure('conflict')
      if (!current() || selected !== this.selections.get(draft.id)) throw new DocumentFailure('stale')
    }
    await check()
    if (bytes.equals(original.bytes)) return { ...selected.snapshot }
    // Never truncate the selected file. Only the complete, flushed sibling is renamed over it.
    // Mode bits are preserved; Windows custom ACLs/alternate streams are not copied (documented).
    if (!(original.stat.mode & 0o200n)) throw new DocumentFailure('write')
    const temporary = join(dirname(original.path), `.geppio-${randomUUID()}.tmp`)
    let created = false, committed = false
    try {
      const file = await open(temporary, 'wx', Number(original.stat.mode & 0o777n)); created = true
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      await check()
      if (!current() || this.selections.get(draft.id) !== selected) throw new DocumentFailure('stale')
      await this.replace(temporary, original.path); committed = true
      const evidence = await inspect(original.path)
      if (!evidence.bytes.equals(bytes) || !current() || this.selections.get(draft.id) !== selected) throw new DocumentFailure('conflict')
      selected.evidence = evidence
      selected.snapshot = { ...selected.snapshot, revision: randomUUID(), text: draft.text }
      return { ...selected.snapshot }
    } catch (error) {
      if (committed) throw new DocumentFailure('unconfirmed', draft.id)
      throw error instanceof DocumentFailure ? error : new DocumentFailure('write')
    }
    finally { if (created && !committed) await unlink(temporary).catch(() => { /* New temporary only; never delete a selected file or recovery backup. */ }) }
  }
  async resolveDraft(draft: DocumentDraft | null, decide: () => Promise<DocumentDecision>, current: () => boolean): Promise<boolean> {
    const selected = this.current(draft)
    if (!current()) throw new DocumentFailure('stale')
    if (!selected || selected.snapshot.text === draft!.text) return true
    const decision = await decide()
    if (!current()) throw new DocumentFailure('stale')
    if (decision === 'cancel') return false
    if (decision === 'save') await this.save(draft!, current)
    return true
  }
  async release(draft: DocumentDraft, decide: () => Promise<DocumentDecision>, current: () => boolean): Promise<DocumentResult> {
    const selected = this.current(draft)!, ids = [...this.selections.keys()], index = ids.indexOf(draft.id)
    if (!await this.resolveDraft(draft, decide, current)) return this.result(true)
    if (!current() || this.selections.get(draft.id) !== selected) throw new DocumentFailure('stale')
    this.selections.delete(draft.id)
    if (this.active === draft.id) this.active = (index > 0 ? ids[index - 1] : ids[1]) ?? null
    return this.result()
  }
  async resolveAll(drafts: readonly DocumentDraft[], decide: (document: DocumentSnapshot) => Promise<DocumentDecision>, current: () => boolean): Promise<boolean> {
    // Validate the complete set before any decision/write: inactive drafts cannot
    // be omitted, duplicated or rebound to another file/revision.
    if (drafts.length !== this.selections.size || new Set(drafts.map(value => value.id)).size !== drafts.length) throw new DocumentFailure('stale')
    let bytes = 0
    for (const draft of drafts) { const selected = this.current(draft)!; bytes += encode(draft.text, selected.snapshot.bom).length }
    if (bytes > DOCUMENT_SESSION_LIMITS.bytes || !current()) throw new DocumentFailure('stale')
    for (const draft of drafts) {
      try { if (!await this.resolveDraft(draft, () => decide(this.selections.get(draft.id)!.snapshot), current)) return false }
      catch (error) { throw new DocumentFailure(error instanceof DocumentFailure ? error.kind : 'unavailable', draft.id) }
    }
    return true
  }
}
