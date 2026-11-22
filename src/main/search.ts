import { randomUUID } from 'node:crypto'
import { opendir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { setImmediate as yieldToMain } from 'node:timers/promises'
import { SEARCH_EXCLUDED_DIRECTORIES, SEARCH_LIMITS, searchText, validSearchQuery } from '../shared/search.ts'
import type { SearchMatch, SearchOpenResult, SearchPage } from '../shared/search.ts'
import { DocumentFailure, inspectSearchDocument } from './documents.ts'
import type { DocumentReadControl, DocumentStore } from './documents.ts'
import { DirectoryStore, inspectExplorerPath, safeExplorerName } from './explorer.ts'

type Limits = { [K in keyof typeof SEARCH_LIMITS]: number }
type Inspected = Awaited<ReturnType<typeof inspectSearchDocument>>
type Target = { path: string; chain: string; witness: Inspected['witness'] }
type Hit = { match: SearchMatch; target: Target; bytes: number }
type Folder = { path: string; chain: string; depth: number }
interface Job {
  id: string; root: string; current(): boolean; deadline: number; status: SearchPage['status']; reason?: string
  query: string; matchCase: boolean; visited: number; files: number; skipped: number; bytes: number
  resultBytes: number; hits: Hit[]
}
const excluded = new Set<string>(SEARCH_EXCLUDED_DIRECTORIES)
const skippedReason = 'Parte do conteúdo foi ignorada por limite, indisponibilidade ou formato não suportado.'
const stale = () => new DocumentFailure('stale')
export class SearchExpired extends DocumentFailure { constructor() { super('stale') } }
/** Internal stop always leaves a bounded, explicitly incomplete result. */
class ScanStopped extends Error {}

export class SearchStore {
  private readonly directories: DirectoryStore
  private readonly limits: Limits
  private readonly now: () => number
  private readonly inspect: typeof inspectSearchDocument
  private job?: Job
  private scanning = false

  constructor(directories: DirectoryStore, options: { limits?: Partial<Limits>; now?: () => number; inspect?: typeof inspectSearchDocument } = {}) {
    this.directories = directories; this.limits = { ...SEARCH_LIMITS, ...options.limits }
    for (const key of Object.keys(SEARCH_LIMITS) as (keyof Limits)[]) {
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1 || this.limits[key] > SEARCH_LIMITS[key]) throw new RangeError('Invalid search limit')
    }
    this.now = options.now ?? (() => performance.now()); this.inspect = options.inspect ?? inspectSearchDocument
  }
  revoke() { this.job = undefined }
  private owned(id: string, current: () => boolean): Job {
    const job = this.job
    if (!job || job.id !== id || !current() || !job.current()) throw new SearchExpired()
    return job
  }
  private async validateRoot(job: Job, current: () => boolean) {
    this.owned(job.id, current)
    try { await this.directories.folder(job.root, () => this.job === job && current() && job.current()) }
    catch { if (this.job === job && current()) this.revoke(); throw new SearchExpired() }
    this.owned(job.id, current)
  }
  private deadline(job: Job) {
    if (job.status === 'running' && this.now() >= job.deadline) {
      job.status = 'partial'; job.reason = 'A busca atingiu o limite de tempo.'
    }
  }
  private running(job: Job) {
    this.deadline(job)
    if (this.job !== job || !job.current() || job.status !== 'running') throw new ScanStopped()
  }
  private stop(job: Job, reason: string): never {
    job.status = 'partial'; job.reason = reason
    throw new ScanStopped()
  }
  start(root: string, query: string, matchCase: boolean, current: () => boolean): SearchPage {
    if (!current() || this.directories.snapshot?.id !== root) throw stale()
    if (this.directories.descriptor!.path.split(sep).some(component => component.toLowerCase() === '.git')) throw new DocumentFailure('unsupported')
    if (!validSearchQuery(query) || typeof matchCase !== 'boolean') throw new DocumentFailure('invalid')
    const scope = this.directories.guard()
    const job: Job = { id: randomUUID(), root, current: () => scope() && current(), query, matchCase, status: 'running',
      visited: 0, files: 0, skipped: 0, bytes: 0, hits: [], resultBytes: 2, deadline: this.now() + this.limits.deadlineMs }
    this.job = job
    if (!this.scanning) void this.drain()
    return this.page(job, 0)
  }
  async read(id: string, offset: number, current: () => boolean): Promise<SearchPage> {
    const job = this.owned(id, current)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > job.hits.length) throw new DocumentFailure('invalid')
    await this.validateRoot(job, current)
    this.deadline(job)
    return this.page(job, offset)
  }
  async cancel(id: string, current: () => boolean): Promise<SearchPage> {
    const job = this.owned(id, current)
    this.deadline(job)
    if (job.status === 'running') { job.status = 'canceled'; job.reason = 'Busca cancelada. Os resultados já encontrados continuam disponíveis.' }
    return this.read(id, 0, current)
  }
  private page(job: Job, offset: number): SearchPage {
    const page: SearchPage = { job: job.id, status: job.status, visited: job.visited, files: job.files, skipped: job.skipped, bytes: job.bytes,
      found: job.hits.length, items: [], next: job.hits.length, more: false, ...(job.reason ? { reason: job.reason } : {}) }
    let bytes = Buffer.byteLength(JSON.stringify({ ok: true, value: page }))
    for (const hit of job.hits.slice(offset, offset + this.limits.chunkMatches)) {
      const addition = hit.bytes + Number(page.items.length > 0)
      if (bytes + addition > this.limits.chunkBytes) break
      bytes += addition; page.items.push(hit.match)
    }
    page.next = offset + page.items.length; page.more = page.next < job.hits.length
    return page
  }
  private async drain() {
    this.scanning = true
    try {
      while (this.job?.status === 'running') {
        const job = this.job
        try {
          const path = await this.directories.folder(job.root, job.current)
          this.running(job)
          await this.walk(job, { path, chain: this.directories.descriptor!.chain, depth: 0 })
          this.running(job)
          job.status = job.skipped ? 'partial' : 'complete'
          if (job.skipped) job.reason = skippedReason
        } catch (error) {
          if (this.job !== job) continue
          if (!job.current()) { this.revoke(); continue }
          if (!(error instanceof ScanStopped)) { job.status = 'failed'; job.reason = 'Não foi possível validar a pasta selecionada.' }
        }
      }
    } finally { this.scanning = false }
  }
  private async walk(job: Job, folder: Folder) {
    this.running(job)
    if (folder.depth >= this.limits.depth) { job.skipped++; return }
    const validate = async () => {
      this.running(job)
      if ((await inspectExplorerPath(folder.path, 'directory')).chain !== folder.chain) throw stale()
      this.running(job)
    }
    await validate()
    const children = []
    let entryLimit = false
    const directory = await opendir(folder.path, { bufferSize: 16 })
    try { this.running(job) }
    catch (error) { await directory.close(); throw error }
    for await (const child of directory) {
      this.running(job)
      const name = child.name.toLowerCase()
      if (name === '.git' || child.isDirectory() && excluded.has(name)) continue
      if (children.length >= this.limits.children) { job.skipped++; break }
      if (job.visited >= this.limits.entries) { entryLimit = true; break }
      job.visited++
      children.push(child)
    }
    await validate()
    for (const child of children) {
      this.running(job)
      if (!safeExplorerName(child.name) || !child.isDirectory() && !child.isFile()) { job.skipped++; continue }
      const path = join(folder.path, child.name)
      try {
        const kind = child.isDirectory() ? 'directory' : 'file'
        const target = await inspectExplorerPath(path, kind)
        this.running(job)
        if (!target.chain.endsWith('/' + folder.chain)) throw stale()
        if (kind === 'directory') await this.walk(job, { ...target, depth: folder.depth + 1 })
        else await this.scanFile(job, target.path, target.chain)
      } catch (error) {
        if (error instanceof ScanStopped) throw error
        this.running(job); job.skipped++
      }
    }
    await validate()
    if (entryLimit) this.stop(job, 'A busca atingiu o limite de entradas do projeto.')
  }
  private readControl(path: string, chain: string, check: (size: number) => void, consume: (bytes: number) => void): DocumentReadControl {
    return { check, consume, authorize: async stat => {
      const observed = await inspectExplorerPath(path, 'file')
      if (observed.chain !== chain || !chain.startsWith(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}/`)) throw stale()
      check(0)
    } }
  }
  private async scanFile(job: Job, path: string, chain: string) {
    const control = this.readControl(path, chain, size => {
      this.running(job)
      if (size > this.limits.fileBytes) throw new DocumentFailure('oversized')
      if (size > this.limits.sourceBytes - job.bytes) this.stop(job, 'A busca atingiu o orçamento de leitura de arquivos.')
    }, bytes => { job.bytes += bytes; this.running(job) })
    const { text, witness } = await this.inspect(path, control)
    this.running(job)
    if ((await inspectExplorerPath(path, 'file')).chain !== chain) throw stale()
    this.running(job)
    const file = relative(this.directories.descriptor!.path, path).split(sep).join('/')
    const target = { path, chain, witness }
    job.files++
    for (const position of searchText(text, job.query, job.matchCase)) {
      this.running(job)
      const match = { ...position, id: randomUUID(), file }
      const bytes = Buffer.byteLength(JSON.stringify(match)), addition = bytes + Number(job.hits.length > 0)
      if (job.hits.length >= this.limits.matches || job.resultBytes + addition > this.limits.resultBytes) this.stop(job, 'A busca atingiu o limite de resultados.')
      job.resultBytes += addition; job.hits.push({ match, bytes, target })
      if (job.hits.length === this.limits.matches || job.resultBytes === this.limits.resultBytes) this.stop(job, 'A busca atingiu o limite de resultados.')
      if (job.hits.length % 64 === 0) await yieldToMain()
    }
  }
  async open(id: string, match: string, documents: DocumentStore, current: () => boolean): Promise<SearchOpenResult> {
    const job = this.owned(id, current)
    await this.validateRoot(job, current)
    const hit = job.hits.find(entry => entry.match.id === match)
    if (!hit) throw stale()
    const valid = () => this.job === job && job.current() && current()
    const check = () => { if (!valid()) throw stale() }
    const { path, chain, witness } = hit.target
    const matches = (actual: Inspected['witness']) => actual.identity === witness.identity && actual.fingerprint === witness.fingerprint
    try {
      const control = this.readControl(path, chain, check, () => {})
      const result = await documents.select(path, null, async () => 'cancel', valid, async candidate => {
        if (!matches(candidate())) throw stale()
        // The candidate can predate a wait in the document transaction.
        const actual = await this.inspect(path, control)
        if (!matches(actual.witness) || (await inspectExplorerPath(path, 'file')).chain !== chain) throw stale()
      }, control)
      check()
      if (!result.ok || !result.document) return result
      return { ...result, matchesSnapshot: documents.fingerprint(result.document.id) === witness.fingerprint }
    } catch (error) {
      // Recheck the project after I/O: only root/job loss invalidates the other hits.
      await this.validateRoot(job, current)
      if (error instanceof DocumentFailure && error.kind === 'limit') throw error
      throw stale()
    }
  }
}
