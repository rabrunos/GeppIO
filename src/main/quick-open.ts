import { randomUUID } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import type { DocumentResult } from '../shared/documents.ts'
import { QUICK_OPEN_LIMITS, rankQuickOpen, validQuickOpenQuery } from '../shared/quick-open.ts'
import type { QuickOpenItem, QuickOpenPage } from '../shared/quick-open.ts'
import { SEARCH_LIMITS } from '../shared/search.ts'
import { DocumentFailure, type DocumentStore } from './documents.ts'
import { DirectoryStore, inspectExplorerPath } from './explorer.ts'
import { boundedScanLimits, ProjectTraversal } from './project-traversal.ts'
import type { OpenDirectory, ProjectJob } from './project-traversal.ts'
export { ProjectScanExpired as QuickOpenExpired } from './project-traversal.ts'

const defaults = { depth: SEARCH_LIMITS.depth, entries: SEARCH_LIMITS.entries, children: SEARCH_LIMITS.children,
  deadlineMs: SEARCH_LIMITS.deadlineMs, metadataBytes: QUICK_OPEN_LIMITS.metadataBytes }
type Limits = { [K in keyof typeof defaults]: number }
interface Job extends ProjectJob {
  status: QuickOpenPage['status']
  targets: (QuickOpenItem & { chain: string })[]
  metadataBytes: number
}
const stale = () => new DocumentFailure('stale')

/** File inventory belongs only to this dialog's job. Paths are derived from walked names in Main. */
export class QuickOpenStore extends ProjectTraversal<Job, Limits> {
  constructor(directories: DirectoryStore, options: { limits?: Partial<Limits>; now?: () => number; openDirectory?: OpenDirectory } = {}) {
    super(directories, boundedScanLimits(defaults, options.limits), options.now, options.openDirectory)
  }
  override revoke() {
    if (this.job) this.job.targets.length = 0
    super.revoke()
  }
  start(root: string, query: string, current: () => boolean): QuickOpenPage {
    const scope = this.scope(root, current)
    if (!validQuickOpenQuery(query)) throw new DocumentFailure('invalid')
    const job: Job = { ...scope, targets: [], metadataBytes: 2 }
    this.launch(job)
    return this.page(job, query)
  }
  private page(job: Job, query: string): QuickOpenPage {
    return { job: job.id, status: job.status, visited: job.visited, skipped: job.skipped,
      total: job.targets.length, ...rankQuickOpen(job.targets, query) }
  }
  async read(id: string, query: string, current: () => boolean): Promise<QuickOpenPage> {
    const job = this.owned(id, current)
    if (!validQuickOpenQuery(query)) throw new DocumentFailure('invalid')
    await this.validateRoot(job, current)
    this.deadline(job)
    return this.page(job, query)
  }
  cancel(id: string, current: () => boolean) {
    this.owned(id, current)
    this.revoke()
    return { ok: true } as const
  }
  protected scanFile(job: Job, path: string, chain: string) {
    this.running(job)
    const file = relative(this.directories.descriptor!.path, path).split(sep).join('/')
    const target = { id: randomUUID(), file, chain }
    // Charge the whole retained entry, including its Main-only identity witness.
    const addition = Buffer.byteLength(JSON.stringify(target)) + Number(job.targets.length > 0)
    if (job.metadataBytes + addition > this.limits.metadataBytes) this.stop(job, 'Limite de metadados atingido.')
    job.metadataBytes += addition
    job.targets.push(target)
  }
  async open(id: string, item: string, documents: DocumentStore, current: () => boolean): Promise<DocumentResult> {
    const job = this.owned(id, current)
    await this.validateRoot(job, current)
    const target = job.targets.find(entry => entry.id === item)
    if (!target) throw stale()
    const path = join(this.directories.descriptor!.path, target.file)
    const valid = () => this.job === job && job.current() && current()
    const check = () => { if (!valid()) throw stale() }
    const authorize = async () => {
      check()
      if ((await inspectExplorerPath(path, 'file')).chain !== target.chain) throw stale()
      check()
    }
    try {
      await authorize()
      const control = this.readControl(path, target.chain, check, check)
      const result = await documents.select(path, null, async () => 'cancel', valid, authorize, control, 'file-identity')
      check()
      return result
    } catch (error) {
      await this.validateRoot(job, current)
      if (error instanceof DocumentFailure) throw error
      throw stale()
    }
  }
}
