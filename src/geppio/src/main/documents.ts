import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, wellFormedText } from '@geppio/runtime/documents'
import type { DocumentDraft, DocumentError, DocumentResult, DocumentSnapshot } from '@geppio/runtime/documents'
import type { SaveEntry } from '@geppio/runtime/documents'
import type { ReplacementMark, ReplacementDocument } from '../shared/search-replacement.ts'
import { inspectExplorerPath } from './explorer.ts'
import { validExplorerBasename } from '../shared/explorer.ts'

const messages: Record<DocumentError, string> = {
  invalid: 'Solicitação de documento inválida.', stale: 'Autorização expirada. Verifique o arquivo antes de retomar a edição.', busy: 'Aguarde a operação de arquivo em andamento.',
  unsupported: 'Arquivo não suportado. Selecione texto UTF-8 válido, sem dados binários, links ou caminhos especiais.',
  oversized: 'O arquivo excede o limite de 1 MiB.', unavailable: 'Arquivo indisponível. O rascunho foi mantido.',
  limit: 'Limite de 8 arquivos abertos ou 8 MiB de conteúdo. Feche uma aba antes de abrir outro arquivo.',
  conflict: 'O arquivo ou seu destino mudou no disco. O rascunho foi mantido. Você pode copiá-lo antes de usar Recarregar do disco.',
  write: 'A gravação foi recusada antes de substituir o arquivo. Verifique as permissões. O rascunho foi mantido.',
  unconfirmed: 'Não foi possível confirmar o conteúdo final no disco. O rascunho foi mantido. Copie o texto que deseja guardar antes de usar Recarregar do disco.'
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
type Selection = { evidence: Evidence | null; snapshot: DocumentSnapshot; reloadPredecessor?: string; unconfirmedSave?: boolean; pendingRename?: string; uncertainDestination?: string }
/** A new destination need not have a leaf yet. Compare canonical parent spellings, including Windows short names. */
export function outsideApplicationProfile(profile: string, path: string): boolean {
  try {
    const inside = relative(realpathSync.native(profile), join(realpathSync.native(dirname(path)), basename(path)))
    return isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)
  } catch { return false }
}
export interface DocumentDestinationUI {
  select(name: string): Promise<string | null>
  confirmOverwrite(path: string): Promise<boolean>
  reconcile(): Promise<boolean>
  permitted(path: string): boolean
}
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`
const sameStat = (a: BigIntStats, b: BigIntStats) => identity(a) === identity(b) && a.birthtimeNs === b.birthtimeNs && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.nlink === b.nlink
function encode(text: string, bom: boolean): Buffer {
  if (!wellFormedText(text) || [...text].some(character => { const code = character.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code) || code === 127 })) throw new DocumentFailure('unsupported')
  const bytes = Buffer.from((bom ? '\ufeff' : '') + text, 'utf8')
  if (bytes.length > DOCUMENT_LIMIT) throw new DocumentFailure('oversized')
  return bytes
}
async function inspectPath(path: string, guard?: () => void): Promise<string> {
  guard?.()
  if (!isAbsolute(path) || resolve(path) !== path || (process.platform === 'win32' && (!/^[a-z]:\\/i.test(path) || path.slice(2).includes(':') || path.split(/[\\/]/).some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))) throw new DocumentFailure('unsupported')
  const chain: string[] = []
  for (let current = path; ; current = dirname(current)) {
    const stat = await lstat(current, { bigint: true })
    guard?.()
    if (stat.isSymbolicLink() || current === path && (!stat.isFile() || stat.nlink !== 1n) || current !== path && !stat.isDirectory()) throw new DocumentFailure('unsupported')
    if (current !== path) chain.push(`${identity(stat)}:${stat.birthtimeNs}`)
    if (current === parse(current).root) break
  }
  const actual = await realpath(path)
  guard?.()
  if ((process.platform === 'win32' ? actual.toLowerCase() !== path.toLowerCase() : actual !== path)) throw new DocumentFailure('unsupported')
  return chain.join('/')
}
/** Optional Main-only bounds for scanning. Charge actual bytes before any later validation can fail. */
export interface DocumentReadControl {
  authorize(stat: BigIntStats): Promise<void>
  check(size: number): void
  consume(bytes: number): void
}
async function inspect(path: string, control?: DocumentReadControl & { guard?(): void; ancestors?: string }): Promise<Evidence> {
  const chain = await inspectPath(path, control?.guard)
  control?.guard?.()
  if (control?.ancestors !== undefined && control.ancestors !== chain) throw new DocumentFailure('conflict')
  const before = await lstat(path, { bigint: true })
  if (before.size > BigInt(DOCUMENT_LIMIT)) throw new DocumentFailure('oversized')
  control?.check(Number(before.size))
  const file = await open(path, 'r')
  try {
    control?.guard?.()
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
    control?.guard?.()
    if (!sameStat(initial, after) || !sameStat(after, await lstat(path, { bigint: true })) || chain !== await inspectPath(path, control?.guard)) throw new DocumentFailure('conflict')
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
  return { text: evidence.text, bom: evidence.bom, witness: documentWitness(evidence) }
}
export type DocumentDecision = 'save' | 'discard' | 'cancel'
/** One window's bounded native grants. Adding/activating a tab never replaces another grant. */
export class DocumentStore {
  private selections = new Map<string, Selection>()
  private active: string | null = null
  private generation = 0
  private nextUntitled = 1
  private writeGeneration = 0
  get writeCount() { return this.writeGeneration }
  private readonly replace: (from: string, to: string) => Promise<void>
  private readonly destinations?: DocumentDestinationUI
  constructor(replace: (from: string, to: string) => Promise<void> = (from, to) => rename(from, to), destinations?: DocumentDestinationUI) { this.replace = replace; this.destinations = destinations }
  get snapshot(): DocumentSnapshot | null { const selected = this.active ? this.selections.get(this.active) : null; return selected ? { ...selected.snapshot } : null }
  get snapshots(): DocumentSnapshot[] { return [...this.selections.values()].map(value => ({ ...value.snapshot })) }
  result(canceled = false): DocumentResult { return { ok: true, document: this.snapshot, documents: this.snapshots, ...(canceled ? { canceled: true } : {}) } }
  /** Main-only display association. Never returned through IPC. */
  filePath(id: string): string | null { const selection = this.selections.get(id); return selection && !selection.pendingRename ? selection.evidence?.path ?? null : null }
  hasFileAt(path: string) { return [...this.selections.values()].some(entry => [entry.evidence?.path, entry.pendingRename, entry.uncertainDestination].some(held => held && relative(held, path) === '')) }
  searchBinding(path: string, witness: ReturnType<typeof documentWitness>, marks: ReplacementMark[]): ReplacementDocument | null {
    if (this.destinations && !this.destinations.permitted(path)) throw new DocumentFailure('unsupported')
    // A lost release receipt can leave an unbound draft in the editor. Its file
    // cannot be ruled out as a candidate until the user resolves that grant.
    if (marks.some(mark => !mark.clean && !this.selections.has(mark.id))) throw new DocumentFailure('unconfirmed')
    for (const entry of this.selections.values()) {
      const held = [entry.evidence?.path, entry.pendingRename, entry.uncertainDestination].some(other => other && relative(other, path) === '')
      if (!held) continue
      const mark = marks.find(candidate => candidate.id === entry.snapshot.id)
      if (!entry.evidence || !mark?.clean || mark.revision !== entry.snapshot.revision || entry.pendingRename || entry.uncertainDestination || entry.unconfirmedSave)
        throw new DocumentFailure('conflict', entry.snapshot.id)
      const original = documentWitness(entry.evidence)
      if (original.identity !== witness.identity || original.fingerprint !== witness.fingerprint) throw new DocumentFailure('stale', entry.snapshot.id)
      return { id: entry.snapshot.id, revision: entry.snapshot.revision }
    }
    return null
  }
  async replaceSearchFile(path: string, witness: ReturnType<typeof documentWitness>, binding: ReplacementDocument | null, marks: ReplacementMark[],
    control: DocumentReadControl, current: () => boolean, transform: (text: string) => string): Promise<DocumentSnapshot | null> {
    const observed = this.searchBinding(path, witness, marks)
    if (observed?.id !== binding?.id || observed?.revision !== binding?.revision) throw new DocumentFailure('stale')
    const selected = binding && this.selections.get(binding.id)
    const valid = () => current() && (selected ? this.selections.get(selected.snapshot.id) === selected : !this.hasFileAt(path))
    const original = await inspect(path, control), actual = documentWitness(original)
    if (actual.identity !== witness.identity || actual.fingerprint !== witness.fingerprint || !valid()) throw new DocumentFailure('stale')
    const text = transform(original.text), bytes = encode(text, original.bom)
    try {
      const evidence = await this.replaceBytes(original, bytes, valid)
      if (!valid()) throw new DocumentFailure(evidence === original ? 'stale' : 'unconfirmed')
      if (evidence === original) return selected ? { ...selected.snapshot } : null
      this.writeGeneration++
      if (!selected) return null
      const snapshot = { ...selected.snapshot, revision: randomUUID(), text }
      this.selections.set(snapshot.id, { evidence, snapshot, reloadPredecessor: selected.snapshot.revision })
      return { ...snapshot }
    } catch (error) {
      if (error instanceof DocumentFailure && error.kind === 'unconfirmed') {
        this.writeGeneration++
        if (selected && this.selections.get(selected.snapshot.id) === selected) selected.unconfirmedSave = true
      }
      throw error
    }
  }
  create(recovered?: { name: string; bom: boolean }): DocumentResult {
    if (this.selections.size >= DOCUMENT_SESSION_LIMITS.count) throw new DocumentFailure('limit')
    const snapshot: DocumentSnapshot = { id: randomUUID(), revision: randomUUID(), name: recovered?.name ?? 'Sem título ' + this.nextUntitled++, text: '', bom: recovered?.bom ?? false, untitled: true }
    this.selections.set(snapshot.id, { snapshot, evidence: null }); this.active = snapshot.id
    return this.result()
  }
  prepareRename(id: string, revision: string, source: string, destination: string, current: () => boolean) {
    const selected = this.selections.get(id)
    if (!selected?.evidence || selected.snapshot.revision !== revision || selected.unconfirmedSave || selected.pendingRename || selected.uncertainDestination ||
        relative(selected.evidence.path, source) !== '' || dirname(source) !== dirname(destination) || this.hasFileAt(destination)) throw new DocumentFailure('stale')
    const original = selected.evidence
    const valid = () => current() && this.selections.get(id) === selected
    return {
      valid,
      validate: async () => {
        if (!valid() || !sameEvidence({ ...original, path: source }, await inspect(source)) || !valid()) throw new DocumentFailure('conflict')
      },
      uncertain: () => { if (this.selections.get(id) === selected) selected.pendingRename = destination },
      confirm: async () => {
        const evidence = await inspect(destination)
        if (!valid() || !sameFile(original, evidence.chain, evidence.stat) || !original.bytes.equals(evidence.bytes)) throw new DocumentFailure('unconfirmed')
        const snapshot = { ...selected.snapshot, revision: randomUUID(), name: basename(destination),
          label: [basename(dirname(destination)), basename(destination)].filter(Boolean).join('/').slice(0, 511) }
        this.selections.set(id, { evidence, snapshot, reloadPredecessor: revision })
        return { ...snapshot }
      }
    }
  }
  /** Main-only recovery witness; neither source nor old grants are persisted. */
  fingerprint(id: string): string | null { const evidence = this.selections.get(id)?.evidence; return evidence ? createHash('sha256').update(evidence.bytes).digest('hex') : null }
  async validate(id: string, current: () => boolean): Promise<void> {
    const selected = this.selections.get(id)
    if (!selected?.evidence || !sameEvidence(selected.evidence, await inspect(selected.evidence.path)) || !current() || this.selections.get(id) !== selected) throw new DocumentFailure('conflict', id)
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
    if ([...this.selections.values()].some(entry => entry.uncertainDestination && relative(entry.uncertainDestination, path) === '' || entry.pendingRename &&
        (relative(entry.pendingRename, path) === '' || entry.evidence && relative(entry.evidence.path, path) === ''))) throw new DocumentFailure('unconfirmed')
    const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    const atPath = () => [...this.selections.values()].find((value): value is Selection & { evidence: Evidence } => !!value.evidence && key(value.evidence.path) === key(path))
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
    if (this.selections.size >= DOCUMENT_SESSION_LIMITS.count || [...this.selections.values()].reduce((sum, value) => sum + (value.evidence?.bytes.length ?? 0), candidate.bytes.length) > DOCUMENT_SESSION_LIMITS.bytes) throw new DocumentFailure('limit')
    const snapshot = { id: randomUUID(), revision: randomUUID(), name: basename(path).slice(0, 255), label: [basename(dirname(path)), basename(path)].filter(Boolean).join('/').slice(0, 511), text: candidate.text, bom: candidate.bom }
    this.selections.set(snapshot.id, { evidence: candidate, snapshot }); this.active = snapshot.id
    return this.result()
  }
  async reload(draft: DocumentDraft, confirmUnresolved: boolean, confirmDiscard: () => Promise<boolean>, current: () => boolean): Promise<DocumentResult> {
    const selected = this.selections.get(draft.id)
    if (selected?.uncertainDestination) throw new DocumentFailure('unconfirmed', draft.id)
    if (!selected?.evidence || (draft.revision !== selected.snapshot.revision && draft.revision !== selected.reloadPredecessor)) throw new DocumentFailure('stale', draft.id)
    const guard = () => {
      if (!current() || this.active !== draft.id || this.selections.get(draft.id) !== selected) throw new DocumentFailure('stale', draft.id)
    }
    guard()
    const { evidence: original, snapshot } = selected
    const predecessor = draft.revision !== snapshot.revision
    const discard = draft.text !== snapshot.text || !!selected.unconfirmedSave || !!selected.pendingRename || confirmUnresolved
    // A replacement leaf can already exist when reload begins. Pin that
    // particular target and all previously authorized parents across the dialog.
    let path = original.path
    if (selected.pendingRename) {
      // Reconciliation may only follow the original ordinary file to one of the two witnessed names.
      const matches: string[] = []
      for (const candidate of [original.path, selected.pendingRename]) {
        try {
          const ancestors = await inspectPath(candidate, guard)
          const stat = await lstat(candidate, { bigint: true })
          if (sameFile(original, ancestors, stat)) matches.push(candidate)
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        guard()
      }
      if (matches.length !== 1) throw new DocumentFailure('conflict', draft.id)
      path = matches[0]!
    }
    const chain = await inspectPath(path, guard)
    guard()
    if (chain !== original.chain) throw new DocumentFailure('conflict', draft.id)
    const initial = await lstat(path, { bigint: true })
    guard()
    if (!initial.isFile() || initial.nlink !== 1n) throw new DocumentFailure('unsupported', draft.id)
    if (selected.pendingRename && !sameFile(original, chain, initial)) throw new DocumentFailure('conflict', draft.id)
    if (predecessor || discard) {
      const approved = await confirmDiscard()
      guard()
      if (!approved) return { ok: true, canceled: true, document: null }
    }
    const control = { guard, ancestors: chain, check: guard, consume: guard, authorize: async (stat: BigIntStats) => {
      guard()
      if (!sameStat(stat, initial)) throw new DocumentFailure('conflict', draft.id)
    } }
    const candidate = await inspect(path, control)
    guard()
    const verified = await inspect(path, control)
    guard()
    if (!sameEvidence(candidate, verified)) throw new DocumentFailure('conflict', draft.id)
    const changed = !sameEvidence(original, verified) || discard && !predecessor
    const next = changed ? { ...snapshot, revision: randomUUID(), bom: verified.bom, text: verified.text,
      ...(path !== original.path ? { name: basename(path), label: [basename(dirname(path)), basename(path)].filter(Boolean).join('/').slice(0, 511) } : {}) } : snapshot
    // One opaque token per grant survives lost replies. Retrying from that
    // token keeps it through further reloads. All Save/Close checks remain exact.
    this.selections.set(draft.id, { evidence: verified, snapshot: next, ...(predecessor || changed ? { reloadPredecessor: draft.revision } : {}) })
    return { ok: true, document: { ...next } }
  }
  private async replaceBytes(original: Evidence, bytes: Buffer, current: () => boolean): Promise<Evidence> {
    const check = async () => {
      const disk = await inspect(original.path)
      if (!sameEvidence(original, disk)) throw new DocumentFailure('conflict')
      if (!current()) throw new DocumentFailure('stale')
    }
    await check()
    if (bytes.equals(original.bytes)) return original
    // Never truncate the selected file. Only the complete, flushed sibling is renamed over it.
    // Mode bits are preserved; Windows custom ACLs/alternate streams are not copied (documented).
    if (!(original.stat.mode & 0o200n)) throw new DocumentFailure('write')
    const temporary = join(dirname(original.path), `.geppio-${randomUUID()}.tmp`)
    let staged: BigIntStats | undefined, committed = false
    try {
      const file = await open(temporary, 'wx', Number(original.stat.mode & 0o777n))
      try { staged = await file.stat({ bigint: true }); await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      await check()
      const ready = await inspect(temporary)
      if (ready.chain !== original.chain || identity(ready.stat) !== identity(staged) ||
          ready.stat.birthtimeNs !== staged.birthtimeNs || !ready.bytes.equals(bytes) || !current()) throw new DocumentFailure('conflict')
      await check()
      if (!current()) throw new DocumentFailure('stale')
      try { await this.replace(temporary, original.path); committed = true }
      catch (error) {
        const unchanged = await inspect(original.path).then(disk => sameEvidence(original, disk), () => false)
        if (!unchanged) throw new DocumentFailure('unconfirmed')
        throw error
      }
      const evidence = await inspect(original.path)
      if (!sameFile(ready, evidence.chain, evidence.stat) || !evidence.bytes.equals(bytes) || !current()) throw new DocumentFailure('unconfirmed')
      return evidence
    } catch (error) {
      if (committed) throw new DocumentFailure('unconfirmed')
      throw error instanceof DocumentFailure ? error : new DocumentFailure('write')
    }
    finally {
      if (staged && !committed) {
        const remaining = await lstat(temporary, { bigint: true }).catch(() => null)
        if (remaining && identity(staged) === identity(remaining) && staged.birthtimeNs === remaining.birthtimeNs &&
            await inspectPath(temporary).catch(() => null) === original.chain) await unlink(temporary).catch(() => {})
      }
    }
  }
  async save(draft: DocumentDraft, current: () => boolean): Promise<DocumentSnapshot> {
    const selected = this.current(draft)!, original = selected.evidence
    if (selected.pendingRename || selected.uncertainDestination) throw new DocumentFailure('unconfirmed', draft.id)
    if (!original) throw new DocumentFailure('invalid', draft.id)
    const valid = () => current() && this.selections.get(draft.id) === selected
    try {
      const evidence = await this.replaceBytes(original, encode(draft.text, selected.snapshot.bom), valid)
      if (!valid()) throw new DocumentFailure(evidence === original ? 'stale' : 'unconfirmed')
      if (evidence === original) return { ...selected.snapshot }
      const snapshot = { ...selected.snapshot, revision: randomUUID(), text: draft.text }
      this.selections.set(draft.id, { evidence, snapshot, reloadPredecessor: draft.revision })
      this.writeGeneration++
      return { ...snapshot }
    } catch (error) {
      if (error instanceof DocumentFailure && error.kind === 'unconfirmed') {
        this.writeGeneration++
        if (this.selections.get(draft.id) === selected) selected.unconfirmedSave = true
        throw new DocumentFailure('unconfirmed', draft.id)
      }
      throw error
    }
  }
  async saveAs(draft: DocumentDraft, reconcile: boolean, current: () => boolean): Promise<DocumentSnapshot | null> {
    const selected = this.selections.get(draft.id), ui = this.destinations
    if (!selected || !ui || selected.snapshot.revision !== draft.revision && !(reconcile && selected.reloadPredecessor === draft.revision)) throw new DocumentFailure('stale', draft.id)
    if (selected.pendingRename || draft.discardOnly) throw new DocumentFailure('unconfirmed', draft.id)
    const bytes = encode(draft.text, selected.snapshot.bom)
    const valid = () => current() && this.selections.get(draft.id) === selected
    const guard = () => { if (!valid()) throw new DocumentFailure('stale', draft.id) }
    guard()
    if (selected.uncertainDestination || reconcile) {
      if (!reconcile) throw new DocumentFailure('unconfirmed', draft.id)
      const confirmed = await ui.reconcile(); guard(); if (!confirmed) return null
    }
    const path = await ui.select(selected.snapshot.name)
    guard()
    if (!path) return null
    const parent = dirname(path)
    if (!isAbsolute(path) || resolve(path) !== path || path.length > 8192 || !validExplorerBasename(basename(path)) ||
        !ui.permitted(path) || path.split(/[\\/]/).some(part => part.toLowerCase() === '.git')) throw new DocumentFailure('unsupported')
    const reserved = [...this.selections.values()].some(entry => [entry !== selected ? entry.evidence?.path : undefined, entry.pendingRename,
      entry !== selected || !reconcile ? entry.uncertainDestination : undefined].some(held => held && relative(held, path) === ''))
    if (reserved) throw new DocumentFailure('conflict', draft.id)
    const directory = await inspectExplorerPath(parent, 'directory'); guard()
    const checkParent = async () => {
      guard()
      if ((await inspectExplorerPath(parent, 'directory')).chain !== directory.chain) throw new DocumentFailure('conflict')
      guard()
    }
    let existing: Evidence | undefined
    try { existing = await inspect(path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    guard()
    if (selected.evidence && relative(selected.evidence.path, path) === '' &&
        (!existing || !sameEvidence({ ...selected.evidence, path }, existing))) throw new DocumentFailure('conflict', draft.id)
    if (existing) {
      const destinationStat = existing.stat
      if ([...this.selections.values()].some(entry => entry !== selected && entry.evidence &&
          identity(entry.evidence.stat) === identity(destinationStat) && entry.evidence.stat.birthtimeNs === destinationStat.birthtimeNs)) throw new DocumentFailure('conflict', draft.id)
    }
    let possible = false
    try {
      let evidence: Evidence
      if (existing) {
        if (existing.chain !== directory.chain) throw new DocumentFailure('conflict')
        const approved = await ui.confirmOverwrite(path); guard()
        if (!approved) return null
        await checkParent()
        evidence = await this.replaceBytes(existing, bytes, valid)
        possible = evidence !== existing
      } else {
        await checkParent()
        const file = await open(path, 'wx', 0o600).catch(error => {
          if (!['EEXIST', 'EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EROFS', 'EINVAL', 'ENAMETOOLONG'].includes((error as NodeJS.ErrnoException).code ?? '')) possible = true
          throw error
        })
        possible = true
        let created: BigIntStats
        try {
          created = await file.stat({ bigint: true }); await checkParent()
          const leaf = await lstat(path, { bigint: true })
          if (!created.isFile() || !sameStat(created, leaf) || created.nlink !== 1n || !valid()) throw new DocumentFailure('unconfirmed')
          await file.writeFile(bytes); await file.sync()
        } finally { await file.close() }
        evidence = await inspect(path)
        if (identity(created) !== identity(evidence.stat) || created.birthtimeNs !== evidence.stat.birthtimeNs) throw new DocumentFailure('unconfirmed')
      }
      if (!valid() || evidence.chain !== directory.chain || !evidence.bytes.equals(bytes)) throw new DocumentFailure(possible ? 'unconfirmed' : 'conflict')
      const name = basename(path), snapshot: DocumentSnapshot = { id: draft.id, revision: randomUUID(), name, label: [basename(parent), name].filter(Boolean).join('/').slice(0, 511), text: draft.text, bom: selected.snapshot.bom }
      this.selections.set(draft.id, { snapshot, evidence, reloadPredecessor: draft.revision })
      this.writeGeneration++
      return { ...snapshot }
    } catch (error) {
      if (possible || error instanceof DocumentFailure && error.kind === 'unconfirmed') {
        this.writeGeneration++
        if (this.selections.get(draft.id) === selected) selected.uncertainDestination = path
        throw new DocumentFailure('unconfirmed', draft.id)
      }
      throw error instanceof DocumentFailure ? error : new DocumentFailure((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'conflict' : 'write', draft.id)
    }
  }
  async saveDocument(draft: DocumentDraft, current: () => boolean): Promise<DocumentSnapshot | null> {
    return this.current(draft)!.snapshot.untitled ? this.saveAs(draft, false, current) : this.save(draft, current)
  }
  private async resolveSelection(draft: DocumentDraft | null, decide: () => Promise<DocumentDecision>, current: () => boolean): Promise<Selection | null | false> {
    const selected = this.current(draft)
    if (!current()) throw new DocumentFailure('stale')
    if (!selected || selected.snapshot.text === draft!.text && !selected.unconfirmedSave && !selected.pendingRename && !selected.uncertainDestination && !draft!.discardOnly) return selected
    const decision = await decide()
    if (!current() || this.selections.get(draft!.id) !== selected) throw new DocumentFailure('stale')
    if (decision === 'cancel') return false
    if (decision === 'discard') return selected
    if (draft!.discardOnly) throw new DocumentFailure('unconfirmed', draft!.id)
    const saved = await this.saveDocument(draft!, current)
    if (!saved) return false
    const confirmed = this.selections.get(saved.id)
    if (!current() || !confirmed || confirmed.snapshot.revision !== saved.revision) throw new DocumentFailure('stale')
    return confirmed
  }
  async resolveDraft(draft: DocumentDraft | null, decide: () => Promise<DocumentDecision>, current: () => boolean): Promise<boolean> {
    return await this.resolveSelection(draft, decide, current) !== false
  }
  async release(draft: DocumentDraft, decide: () => Promise<DocumentDecision>, current: () => boolean): Promise<DocumentResult> {
    const ids = [...this.selections.keys()], index = ids.indexOf(draft.id)
    const selected = await this.resolveSelection(draft, decide, current)
    if (selected === false) return this.result(true)
    if (!current() || this.selections.get(draft.id) !== selected) throw new DocumentFailure('stale')
    this.selections.delete(draft.id)
    if (this.active === draft.id) this.active = (index > 0 ? ids[index - 1] : ids[1]) ?? null
    return this.result()
  }
  private validateDrafts(drafts: readonly DocumentDraft[], current: () => boolean) {
    // Validate the complete set before any decision/write: inactive drafts cannot
    // be omitted, duplicated or rebound to another file/revision.
    if (drafts.length !== this.selections.size || new Set(drafts.map(value => value.id)).size !== drafts.length) throw new DocumentFailure('stale')
    let bytes = 0
    for (const draft of drafts) {
      const selected = this.current(draft)!
      bytes += Buffer.byteLength(draft.text, 'utf8') + (selected.snapshot.bom ? 3 : 0)
    }
    if (bytes > DOCUMENT_SESSION_LIMITS.bytes || !current()) throw new DocumentFailure('stale')
  }
  async saveAll(drafts: readonly DocumentDraft[], current: () => boolean): Promise<DocumentResult> {
    this.validateDrafts(drafts, current)
    const saves: SaveEntry[] = [...this.selections.keys()].map(id => ({ id, status: 'pending' }))
    for (const entry of saves) {
      const draft = drafts.find(value => value.id === entry.id)!, selected = this.current(draft)!
      try {
        if (draft.discardOnly || selected.pendingRename || selected.uncertainDestination || selected.unconfirmedSave) throw new DocumentFailure('unconfirmed', entry.id)
        if (!selected.snapshot.untitled && draft.text === selected.snapshot.text) { entry.status = 'clean'; continue }
        if (!await this.saveDocument(draft, current)) {
          entry.status = 'canceled'
          return { ...this.result(true), saves }
        }
        entry.status = 'saved'
      } catch (error) {
        entry.status = error instanceof DocumentFailure && error.kind === 'unconfirmed' ? 'unconfirmed' : 'failed'
        return { ...documentFailure(new DocumentFailure(error instanceof DocumentFailure ? error.kind : 'unavailable', draft.id)), documents: this.snapshots, saves }
      }
    }
    return { ...this.result(), saves }
  }
  async resolveAll(drafts: readonly DocumentDraft[], decide: (document: DocumentSnapshot) => Promise<DocumentDecision>, current: () => boolean,
    afterSave?: (id: string) => Promise<void>): Promise<boolean> {
    this.validateDrafts(drafts, current)
    for (const id of this.selections.keys()) {
      const draft = drafts.find(value => value.id === id)!
      try {
        const before = this.writeCount
        if (!await this.resolveDraft(draft, () => decide(this.selections.get(draft.id)!.snapshot), current)) return false
        if (before !== this.writeCount) await afterSave?.(id)
      }
      catch (error) { throw new DocumentFailure(error instanceof DocumentFailure ? error.kind : 'unavailable', draft.id) }
    }
    return true
  }
}
