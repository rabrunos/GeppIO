import { randomUUID } from 'node:crypto'
import { opendir } from 'node:fs/promises'
import type { Dir } from 'node:fs'
import { join, sep } from 'node:path'
import { SEARCH_EXCLUDED_DIRECTORIES } from '../shared/search.ts'
import { DocumentFailure } from './documents.ts'
import type { DocumentReadControl } from './documents.ts'
import { DirectoryStore, inspectExplorerPath, safeExplorerName } from './explorer.ts'

type WalkLimits = { children: number; depth: number; entries: number; deadlineMs: number }
type Folder = { path: string; chain: string; depth: number }
export type OpenDirectory = (path: string) => Promise<Pick<Dir, 'close' | typeof Symbol.asyncIterator>>
export interface ProjectJob {
  id: string; root: string; current(): boolean; deadline: number
  status: 'running' | 'complete' | 'partial' | 'failed' | 'canceled'; reason?: string
  visited: number; skipped: number
}
const excluded = new Set<string>(SEARCH_EXCLUDED_DIRECTORIES)
const skippedReason = 'Parte do conteúdo foi ignorada por limite, indisponibilidade ou formato não suportado.'
const stale = () => new DocumentFailure('stale')
export class ProjectScanExpired extends DocumentFailure { constructor() { super('stale') } }
class ScanStopped extends Error {}

export function boundedScanLimits<T extends Record<string, number>>(defaults: T, overrides?: Partial<{ [K in keyof T]: number }>) {
  const limits = { ...defaults, ...overrides } as { [K in keyof T]: number }
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > defaults[key]!) throw new RangeError('Invalid project scan limit')
  }
  return limits
}

/** One in-flight traversal per store. Replacing a job retains only the newest request. */
export abstract class ProjectTraversal<J extends ProjectJob, L extends WalkLimits> {
  protected readonly directories: DirectoryStore
  protected readonly limits: L
  protected readonly now: () => number
  private readonly openDirectory: OpenDirectory
  protected job?: J
  private scanning = false
  protected constructor(directories: DirectoryStore, limits: L, now = () => performance.now(),
    openDirectory: OpenDirectory = path => opendir(path, { bufferSize: 16 })) {
    this.directories = directories; this.limits = limits; this.now = now; this.openDirectory = openDirectory
  }
  protected scope(root: string, current: () => boolean) {
    if (!current() || this.directories.snapshot?.id !== root) throw stale()
    if (this.directories.descriptor!.path.split(sep).some(component => component.toLowerCase() === '.git')) throw new DocumentFailure('unsupported')
    const guard = this.directories.guard()
    return { id: randomUUID(), root, current: () => guard() && current(), status: 'running' as const, visited: 0, skipped: 0, deadline: this.now() + this.limits.deadlineMs }
  }
  protected launch(job: J) {
    this.revoke()
    this.job = job
    if (!this.scanning) void this.drain()
  }
  protected abstract scanFile(job: J, path: string, chain: string): void | Promise<void>
  revoke() { this.job = undefined }
  protected owned(id: string, current: () => boolean): J {
    const job = this.job
    if (!job || job.id !== id || !current() || !job.current()) throw new ProjectScanExpired()
    return job
  }
  protected async validateRoot(job: J, current: () => boolean) {
    this.owned(job.id, current)
    try { await this.directories.folder(job.root, () => this.job === job && current() && job.current()) }
    catch { if (this.job === job && current()) this.revoke(); throw new ProjectScanExpired() }
    this.owned(job.id, current)
  }
  protected deadline(job: J) {
    if (job.status === 'running' && this.now() >= job.deadline) {
      job.status = 'partial'; job.reason = 'A busca atingiu o limite de tempo.'
    }
  }
  protected running(job: J) {
    this.deadline(job)
    if (this.job !== job || !job.current() || job.status !== 'running') throw new ScanStopped()
  }
  protected stop(job: J, reason: string): never {
    job.status = 'partial'; job.reason = reason
    throw new ScanStopped()
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
  private async walk(job: J, folder: Folder) {
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
    const directory = await this.openDirectory(folder.path)
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
  protected readControl(path: string, chain: string, check: (size: number) => void, consume: (bytes: number) => void): DocumentReadControl {
    return { check, consume, authorize: async stat => {
      const observed = await inspectExplorerPath(path, 'file')
      if (observed.chain !== chain || !chain.startsWith(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}/`)) throw stale()
      check(0)
    } }
  }
}
