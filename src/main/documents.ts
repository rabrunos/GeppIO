import { randomUUID } from 'node:crypto'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { DOCUMENT_LIMIT, wellFormedText } from '../shared/documents.ts'
import type { DocumentDraft, DocumentError, DocumentResult, DocumentSnapshot } from '../shared/documents.ts'

const messages: Record<DocumentError, string> = {
  invalid: 'Solicitação de documento inválida.', stale: 'Autorização expirada. Reabra o arquivo explicitamente.', busy: 'Aguarde a operação de arquivo em andamento.',
  unsupported: 'Arquivo não suportado. Selecione texto UTF-8 válido, sem dados binários, links ou caminhos especiais.',
  oversized: 'O arquivo excede o limite de 1 MiB.', unavailable: 'Arquivo indisponível. O rascunho foi mantido.',
  conflict: 'O arquivo ou seu destino mudou no disco. Copie o rascunho antes de reabrir; nenhuma alteração externa foi sobrescrita.',
  write: 'Não foi possível confirmar a gravação. O rascunho foi mantido. Verifique o arquivo e as permissões antes de tentar novamente.'
}
export class DocumentFailure extends Error {
  readonly kind: DocumentError
  constructor(kind: DocumentError) { super(messages[kind]); this.kind = kind }
}
export function documentFailure(error: unknown): DocumentResult {
  const code = error instanceof DocumentFailure ? error.kind : 'unavailable'
  return { ok: false, code, error: messages[code] }
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
async function inspect(path: string): Promise<Evidence> {
  const chain = await inspectPath(path), before = await lstat(path, { bigint: true })
  if (before.size > BigInt(DOCUMENT_LIMIT)) throw new DocumentFailure('oversized')
  const file = await open(path, 'r')
  try {
    const initial = await file.stat({ bigint: true })
    if (!sameStat(before, initial)) throw new DocumentFailure('conflict')
    const buffer = Buffer.alloc(DOCUMENT_LIMIT + 1)
    let length = 0
    while (length < buffer.length) { const read = await file.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead }
    if (length > DOCUMENT_LIMIT) throw new DocumentFailure('oversized')
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
export type DocumentDecision = 'save' | 'discard' | 'cancel'
/** Exactly one window's native selection. Paths never cross the preload boundary. */
export class DocumentStore {
  private selection: Selection | null = null
  private generation = 0
  get snapshot(): DocumentSnapshot | null { return this.selection ? { ...this.selection.snapshot } : null }
  guard(): () => boolean { const generation = this.generation; return () => generation === this.generation }
  revoke(): void { this.generation++; this.selection = null }
  private current(draft: DocumentDraft | null): Selection | null {
    if (!this.selection && draft === null) return null
    if (!draft || !this.selection || draft.id !== this.selection.snapshot.id || draft.revision !== this.selection.snapshot.revision) throw new DocumentFailure('stale')
    return this.selection
  }
  async select(path: string, draft: DocumentDraft | null, decide: () => Promise<DocumentDecision>, current: () => boolean, authorize?: () => Promise<void>): Promise<DocumentResult> {
    this.current(draft)
    let candidate = await inspect(path)
    const previous = this.selection
    const sameTarget = previous && sameEvidence(candidate, previous.evidence), revision = previous?.snapshot.revision
    if (!current()) throw new DocumentFailure('stale')
    if (!await this.resolveDraft(draft, decide, current)) return { ok: true, document: this.snapshot, canceled: true }
    if (!current()) throw new DocumentFailure('stale')
    if (previous && sameTarget && previous.snapshot.revision !== revision) candidate = previous.evidence
    // A dialog may have been open for minutes. Revalidate the candidate before granting it.
    if (!sameEvidence(candidate, await inspect(path))) throw new DocumentFailure('conflict')
    await authorize?.()
    if (!current()) throw new DocumentFailure('stale')
    this.generation++
    this.selection = { evidence: candidate, snapshot: { id: randomUUID(), revision: randomUUID(), name: basename(path).slice(0, 255), text: candidate.text, bom: candidate.bom } }
    return { ok: true, document: this.snapshot }
  }
  async save(draft: DocumentDraft, current: () => boolean): Promise<DocumentSnapshot> {
    const selected = this.current(draft)!, original = selected.evidence, bytes = encode(draft.text, original.bom)
    const check = async () => {
      const disk = await inspect(original.path)
      if (!sameEvidence(original, disk)) throw new DocumentFailure('conflict')
      if (!current() || selected !== this.selection) throw new DocumentFailure('stale')
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
      await rename(temporary, original.path); committed = true
      const evidence = await inspect(original.path)
      if (!evidence.bytes.equals(bytes) || !current() || this.selection !== selected) throw new DocumentFailure('conflict')
      selected.evidence = evidence
      selected.snapshot = { ...selected.snapshot, revision: randomUUID(), text: draft.text }
      return { ...selected.snapshot }
    } catch (error) { throw error instanceof DocumentFailure ? error : new DocumentFailure('write') }
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
}
