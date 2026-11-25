import { createHash, randomUUID } from 'node:crypto'
import { GIT_HISTORY_LIMITS, GIT_LIMITS } from '../shared/git.ts'
import type { GitHistoryCommit, GitHistorySummary, GitResult } from '../shared/git.ts'
import { GitFailure, gitRelativeName } from './git.ts'

type Invoke = (args: string[], cap?: number, io?: { input: Buffer }) => Promise<Buffer>
export type HistoryOperation = 'history' | 'historyPage' | 'historyCommit' | 'historyCompare'
export interface HistoryHead { ref: string | null; oid: string | null; witness: string }
const { page: pageCount, commits: maxCommits, commitBytes, retainedBytes: retainedLimit } = GIT_HISTORY_LIMITS
const invalid = (): never => { throw new GitFailure('unsupported') }
const stale = (): never => { throw new GitFailure('stale') }
const excess = (): never => { throw new GitFailure('limit') }
const oidPattern = /^[a-f0-9]{40}$/
export const historyOid = (value: string) => oidPattern.test(value) && !/^0+$/.test(value)
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
function literal(bytes: Buffer): string {
  let value: string
  try { value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return invalid() }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127) return invalid()
  }
  return value
}
function lines(bytes: Buffer): string[] {
  const values = literal(bytes).split('\n')
  if (values.pop() !== '') return invalid()
  return values
}

/** A bounded, ordered size declaration must agree with every raw frame and object hash. */
async function* objects(invoke: Invoke, oids: string[], type: 'blob' | 'commit'): AsyncGenerator<Buffer> {
  if (!oids.length) return
  if (oids.length > pageCount || !oids.every(historyOid)) return invalid()
  const input = Buffer.from(oids.join('\n') + '\n')
  const headers = lines(await invoke(['cat-file', '--batch-check'], 8192, { input }))
  if (headers.length !== oids.length) return invalid()
  const sizes = headers.map((header, index) => {
    const fields = header.split(' ')
    if (fields.length !== 3 || fields[0] !== oids[index] || fields[1] !== type || !/^(0|[1-9]\d{0,14})$/.test(fields[2]!)) return invalid()
    const size = Number(fields[2])
    if (size > (type === 'blob' ? GIT_LIMITS.text : commitBytes)) throw new GitFailure('limit', type === 'blob' ? 'history-blob-size' : undefined)
    return size
  })
  for (let first = 0; first < sizes.length;) {
    let end = first, total = 0
    while (end < sizes.length) {
      const frameBytes = sizes[end]! + headers[end]!.length + 2
      if (total + frameBytes > GIT_LIMITS.output) break
      total += frameBytes; end++
    }
    if (end === first) return excess()
    const frames = await invoke(['cat-file', '--batch'], total, { input: Buffer.from(oids.slice(first, end).join('\n') + '\n') })
    if (frames.length !== total) return invalid()
    let offset = 0
    for (let i = first; i < end; i++) {
      const prefix = Buffer.from(headers[i]! + '\n'), size = sizes[i]!
      if (!frames.subarray(offset, offset + prefix.length).equals(prefix)) return invalid()
      offset += prefix.length
      const value = frames.subarray(offset, offset + size); offset += size
      if (frames[offset++] !== 10 || createHash('sha1').update(type + ' ' + size + '\0').update(value).digest('hex') !== oids[i]) return invalid()
      yield value
    }
    first = end
  }
}

async function object(invoke: Invoke, oid: string, type: 'blob' | 'commit'): Promise<Buffer> {
  for await (const bytes of objects(invoke, [oid], type)) return bytes
  return invalid()
}

function parseCommit(bytes: Buffer) {
  const raw = literal(bytes), split = raw.indexOf('\n\n')
  if (split < 0) return invalid()
  const header = raw.slice(0, split).split('\n'), message = raw.slice(split + 2)
  if (!header[0]?.startsWith('tree ') || !historyOid(header[0].slice(5))) return invalid()
  const parents: string[] = []
  let pos = 1
  while (header[pos]?.startsWith('parent ')) {
    const oid = header[pos++]!.slice(7)
    if (!historyOid(oid)) return invalid()
    parents.push(oid)
  }
  const author = /^author ([^<>\r\n]*) <[^<>\r\n]*> (-?\d{1,12}) ([+-])([01]\d|2[0-3])([0-5]\d)$/.exec(header[pos++] ?? '')
  if (!author || !/^committer [^<>\r\n]* <[^<>\r\n]*> -?\d{1,12} [+-](?:[01]\d|2[0-3])[0-5]\d$/.test(header[pos++] ?? '')) return invalid()
  // Signature/mergetag continuation payloads are data only. Never ask Git to
  // interpret a signature, mailmap, note, legacy encoding or custom format.
  for (; pos < header.length; pos++) {
    const row = header[pos]!
    if (!row.startsWith(' ') && (!/^[a-zA-Z][a-zA-Z0-9-]* /.test(row) || /^(tree|parent|author|committer) /.test(row))) return invalid()
  }
  const date = new Date(Number(author[2]) * 1000).toISOString()
  const subject = message.trimStart().split('\n', 1)[0]!.trimEnd()
  return { parents, author: author[1]!, date, subject, message }
}

interface Side { oid: string; mode: string }
interface Change { id: string; name: string; status: string; before: Side; after: Side }
function changedFiles(bytes: Buffer): Change[] {
  const changes: Change[] = [], names = new Set<string>()
  let offset = 0
  while (offset < bytes.length) {
    if (changes.length >= GIT_HISTORY_LIMITS.files) return excess()
    const zero = bytes.indexOf(0, offset), end = zero < 0 ? -1 : bytes.indexOf(0, zero + 1)
    if (zero < 0 || end < 0 || zero - offset > 110 || end - zero > 8193) return invalid()
    const header = /^:(000000|100644|100755|120000|160000) (000000|100644|100755|120000|160000) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADMT])$/.exec(literal(bytes.subarray(offset, zero)))
    const name = literal(bytes.subarray(zero + 1, end))
    if (!header || !gitRelativeName(name) || names.has(name)) return invalid()
    const [, from, to, left, right, status] = header
    if ((from === '000000') !== (status === 'A') || (to === '000000') !== (status === 'D') ||
        (from !== '000000') !== historyOid(left!) || (to !== '000000') !== historyOid(right!)) return invalid()
    names.add(name); changes.push({ id: randomUUID(), name, status: status!, before: { oid: left!, mode: from! }, after: { oid: right!, mode: to! } })
    offset = end + 1
  }
  return changes
}

interface Snapshot {
  id: string; root: string; witness: string; cursor: string | null; next: string | null
  commits: Map<string, string>; bytes: number; detail?: { commit: string; files: Change[] }
}
export class GitHistoryStore {
  private state: Snapshot | null = null
  revoke() { this.state = null }
  owns(root: string, id: string | undefined) { return !!this.state && this.state.id === id && this.state.root === root }
  checkHead(witness: string) { if (this.state && this.state.witness !== witness) { this.revoke(); stale() } }
  async read(operation: HistoryOperation, root: string, id: string | undefined, more: readonly string[], head: HistoryHead, invoke: Invoke) {
    const state = operation === 'history' ? { root, id: randomUUID(), witness: head.witness, commits: new Map<string, string>(), cursor: null, next: head.oid, bytes: 0 } satisfies Snapshot : this.state
    if (!state || operation !== 'history' && !this.owns(root, id)) return stale()
    this.checkHead(head.witness)
    if (operation === 'history' || operation === 'historyPage') {
      if (operation === 'historyPage' && (!state.cursor || more[0] !== state.cursor)) return stale()
      const remaining = Math.min(pageCount, maxCommits - state.commits.size)
      if (!remaining) return excess()
      const oids = state.next ? lines(await invoke(['log', '--first-parent', '--no-notes', '--no-decorate', '--no-use-mailmap', '--no-show-signature', '--color=never',
        '--format=%H', '--max-count=' + (remaining + 1), state.next, '--'], 4096)) : []
      if (oids.length > remaining + 1 || (state.next && oids[0] !== state.next) || !oids.every(historyOid) || new Set(oids).size !== oids.length) return invalid()
      const commits = new Map(state.commits), existing = new Set(commits.values()), listed = oids.slice(0, remaining)
      if (oids.some(oid => existing.has(oid))) return invalid()
      const summaries: GitHistorySummary[] = []
      let summaryBytes = 0
      for await (const bytes of objects(invoke, listed, 'commit')) {
        const i = summaries.length, oid = listed[i]!, value = parseCommit(bytes)
        if (value.parents[0] !== oids[i + 1]) return invalid()
        const token = randomUUID(); commits.set(token, oid)
        // Avoid retaining the backing text of an entire message via V8 sliced strings.
        const summary = { id: token, hash: oid.slice(0, 12), author: Buffer.from(value.author).toString(), date: value.date, subject: Buffer.from(value.subject).toString() }
        summaryBytes += jsonBytes(summary)
        if (summaryBytes > GIT_HISTORY_LIMITS.pageBytes) return excess()
        summaries.push(summary)
      }
      const next = oids[remaining] ?? null, limited = !!next && commits.size === maxCommits, cursor = next && !limited ? randomUUID() : null
      const history = { snapshot: state.id, commits: summaries, cursor, limited, detached: head.ref === null, unborn: head.oid === null }
      const pageBytes = jsonBytes(history), bytes = state.bytes + pageBytes + listed.length * 80
      if (pageBytes > GIT_HISTORY_LIMITS.pageBytes || bytes > retainedLimit) return excess()
      const updated: Snapshot = { id: state.id, root, witness: head.witness, cursor, next, commits, bytes, detail: this.state?.id === state.id ? this.state.detail : undefined }
      if (updated.detail && bytes + jsonBytes(updated.detail) > retainedLimit) return excess()
      return { result: { ok: true, history } satisfies GitResult, publish: () => { this.state = updated } }
    }
    const commit = more[0], oid = commit && state.commits.get(commit)
    if (!commit || !oid) return stale()
    if (operation === 'historyCommit') {
      const value = parseCommit(await object(invoke, oid, 'commit'))
      const parent = value.parents[0]
      if (parent) await object(invoke, parent, 'commit')
      const files = changedFiles(await invoke(['diff-tree', '-r', '--raw', '-z', '--no-commit-id', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv', '--color=never', ...(parent ? [parent, oid] : ['--root', oid]), '--']))
      const detail: GitHistoryCommit = { id: commit, hash: oid.slice(0, 12), author: value.author, date: value.date, subject: value.subject, message: value.message,
        parents: value.parents.map(p => p.slice(0, 12)), files: files.map(({ id, name, status }) => ({ id, name, status })) }
      const held = { commit, files }
      if (state.bytes + jsonBytes(held) + jsonBytes(detail) > retainedLimit) return excess()
      return { result: { ok: true, commit: detail } satisfies GitResult, publish: () => { this.state = { ...state, detail: held } } }
    }
    const file = this.state?.detail?.commit === commit && this.state.detail.files.find(f => f.id === more[1])
    if (!file) return stale()
    if ([file.before, file.after].some(side => !['000000', '100644', '100755'].includes(side.mode))) throw new GitFailure('unsupported', 'history-mode')
    const content = async (side: Side) => {
      if (side.mode === '000000') return ''
      const bytes = await object(invoke, side.oid, 'blob')
      try { return literal(bytes) } catch { throw new GitFailure('unsupported', 'history-binary') }
    }
    const original = await content(file.before), modified = await content(file.after)
    return { result: { ok: true, comparison: { name: file.name, original, modified, basis: 'Histórico Git · primeiro pai (vazio no commit inicial) → commit selecionado.' } } satisfies GitResult, publish: () => {} }
  }
}
