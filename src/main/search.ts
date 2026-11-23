import { randomUUID } from 'node:crypto'
import { relative, sep } from 'node:path'
import { setImmediate as yieldToMain } from 'node:timers/promises'
import { SEARCH_LIMITS, searchText, validSearchQuery } from '../shared/search.ts'
import type { SearchMatch, SearchOpenResult, SearchPage } from '../shared/search.ts'
import { DocumentFailure, inspectSearchDocument } from './documents.ts'
import type { DocumentStore } from './documents.ts'
import { DirectoryStore, inspectExplorerPath } from './explorer.ts'
import { boundedScanLimits, ProjectTraversal } from './project-traversal.ts'
import type { ProjectJob } from './project-traversal.ts'
export { ProjectScanExpired as SearchExpired } from './project-traversal.ts'

type Limits = { [K in keyof typeof SEARCH_LIMITS]: number }
type Inspected = Awaited<ReturnType<typeof inspectSearchDocument>>
type Target = { path: string; chain: string; witness: Inspected['witness'] }
type Hit = { match: SearchMatch; target: Target; bytes: number }
interface Job extends ProjectJob {
  query: string; matchCase: boolean; files: number; bytes: number
  resultBytes: number; hits: Hit[]
}
const stale = () => new DocumentFailure('stale')

export class SearchStore extends ProjectTraversal<Job, Limits> {
  private readonly inspect: typeof inspectSearchDocument
  constructor(directories: DirectoryStore, options: { limits?: Partial<Limits>; now?: () => number; inspect?: typeof inspectSearchDocument } = {}) {
    super(directories, boundedScanLimits(SEARCH_LIMITS, options.limits), options.now)
    this.inspect = options.inspect ?? inspectSearchDocument
  }
  start(root: string, query: string, matchCase: boolean, current: () => boolean): SearchPage {
    const scope = this.scope(root, current)
    if (!validSearchQuery(query) || typeof matchCase !== 'boolean') throw new DocumentFailure('invalid')
    const job: Job = { ...scope, query, matchCase, files: 0, bytes: 0, hits: [], resultBytes: 2 }
    this.launch(job)
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
  protected async scanFile(job: Job, path: string, chain: string) {
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
