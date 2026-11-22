import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { DocumentFailure, DocumentStore, inspectSearchDocument } from '../src/main/documents.ts'
import { DirectoryStore } from '../src/main/explorer.ts'
import { SearchExpired, SearchStore } from '../src/main/search.ts'
import { SEARCH_EXCLUDED_DIRECTORIES, SEARCH_LIMITS } from '../src/shared/search.ts'
import type { SearchPage } from '../src/shared/search.ts'

const current = () => true
const denied = (kind: string) => (error: unknown) => error instanceof DocumentFailure && error.kind === kind
async function fixture(run: (dir: string, folders: DirectoryStore, root: string) => Promise<void>) {
  const temp = await mkdtemp(join(tmpdir(), 'geppio-smoke-search-'))
  try {
    const dir = join(await realpath(temp), 'project'); await mkdir(dir)
    const folders = new DirectoryStore()
    await folders.select(dir, current)
    await run(dir, folders, folders.snapshot!.id)
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 4 }) }
}
async function finish(search: SearchStore, page: SearchPage) {
  const end = performance.now() + 12000
  while (page.status === 'running' && performance.now() < end) {
    await nextTurn()
    page = await search.read(page.job, 0, current)
  }
  assert.notEqual(page.status, 'running')
  return page
}
function gate() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve }); return { open, promise } }

test('explicit Workspace roots at or below .git are refused before starting search', async () => fixture(async (dir, folders) => {
  const metadata = join(dir, '.GiT'), nested = join(metadata, 'nested')
  await mkdir(nested, { recursive: true })
  const search = new SearchStore(folders)
  for (const path of [metadata, nested]) {
    await folders.select(path, current)
    assert.throws(() => search.start(folders.snapshot!.id, 'text', false, current), denied('unsupported'))
  }
  const ordinary = join(dir, '.git-example')
  await mkdir(ordinary); await folders.select(ordinary, current)
  assert.equal((await finish(search, search.start(folders.snapshot!.id, 'text', false, current))).status, 'complete')
}))

test('selected-root scan excludes metadata and fixed directories, retains other dotfiles and never follows links', async () => fixture(async (dir, folders, root) => {
  for (const excluded of ['.GiT', ...SEARCH_EXCLUDED_DIRECTORIES]) {
    await mkdir(join(dir, excluded)); await writeFile(join(dir, excluded, 'marker'), 'match')
  }
  const outside = join(dir, '..', 'outside'); await mkdir(outside); const linkedFile = join(outside, 'marker')
  await writeFile(linkedFile, 'match'); await link(linkedFile, join(dir, 'hardlink.txt'))
  await symlink(outside, join(dir, 'junction'), process.platform === 'win32' ? 'junction' : 'dir')
  await mkdir(join(dir, 'src')); await writeFile(join(dir, 'src', '.example'), '\ufeffáb\r\n😀match\rmore\n')
  const search = new SearchStore(folders)
  const end = await finish(search, search.start(root, 'match', true, current))
  assert.equal(end.status, 'partial'); assert.equal(end.skipped, 2); assert.equal(end.files, 1)
  assert.equal(end.found, 1); assert.equal(end.items[0]!.file, 'src/.example')
  assert.deepEqual([end.items[0]!.line, end.items[0]!.column], [2, 3])
  assert.ok(!JSON.stringify(end).includes(dir)); assert.equal(await readFile(join(dir, '.GiT', 'marker'), 'utf8'), 'match')
  const opened = await search.open(end.job, end.items[0]!.id, new DocumentStore(), current)
  assert.ok(opened.ok && opened.matchesSnapshot && opened.document?.bom)
  await assert.rejects(search.open(randomUUID(), end.items[0]!.id, new DocumentStore(), current), denied('stale'))
  await assert.rejects(search.open(end.job, randomUUID(), new DocumentStore(), current), denied('stale'))
  await assert.rejects(search.read(end.job, 100, current), denied('invalid'))
  await assert.rejects(search.read(end.job, 0, () => false), denied('stale'))
  assert.throws(() => search.start(randomUUID(), 'x', false, current), denied('stale'))
}))

test('binary and invalid UTF-8 reads consume source allowance; oversized candidates consume no source bytes', async () => fixture(async (dir, folders, root) => {
  await writeFile(join(dir, 'invalid'), Buffer.from([0xff, 0x61, 0x62, 0x63]))
  await writeFile(join(dir, 'binary'), Buffer.from([97, 0, 98, 99]))
  await writeFile(join(dir, 'oversized'), Buffer.alloc(9))
  const search = new SearchStore(folders, { limits: { fileBytes: 8, sourceBytes: 8 } })
  const end = await finish(search, search.start(root, 'a', false, current))
  assert.equal(end.status, 'partial'); assert.equal(end.skipped, 3); assert.equal(end.bytes, 8); assert.equal(end.found, 0); assert.equal(end.files, 0)
  const limited = new SearchStore(folders, { limits: { fileBytes: 8, sourceBytes: 6 } })
  const truncated = await finish(limited, limited.start(root, 'a', false, current))
  assert.equal(truncated.status, 'partial'); assert.equal(truncated.bytes, 4); assert.match(truncated.reason!, /leitura/)
}))

test('directory, total entry and depth bounds report partial work without growing Explorer node grants', async () => fixture(async (dir, folders, root) => {
  for (let i = 0; i < 5; i++) await writeFile(join(dir, 'f' + i), 'hit')
  for (const limits of [{ children: 3 }, { entries: 3 }]) {
    const search = new SearchStore(folders, { limits })
    const end = await finish(search, search.start(root, 'hit', true, current))
    assert.equal(end.status, 'partial'); assert.equal(end.visited, 3); assert.equal(end.found, 3)
    await assert.rejects(folders.file(root, end.items[0]!.id, current))
  }
  await mkdir(join(dir, 'd')); await writeFile(join(dir, 'd', 'deep'), 'hit')
  const shallow = new SearchStore(folders, { limits: { depth: 1 } }), end = await finish(shallow, shallow.start(root, 'hit', true, current))
  assert.equal(end.status, 'partial'); assert.equal(end.found, 5); assert.equal(end.skipped, 1)
}))

test('retained and response byte budgets constrain serialized UTF-8 independently of match/page counts', async () => fixture(async (dir, folders, root) => {
  await writeFile(join(dir, '🌱.txt'), ('x' + '😀'.repeat(28) + '\n').repeat(250))
  const capped = new SearchStore(folders, { limits: { matches: 7, chunkMatches: 2 } })
  const first = await finish(capped, capped.start(root, 'x', true, current))
  assert.equal(first.status, 'partial'); assert.equal(first.found, 7); assert.equal(first.items.length, 2); assert.equal(first.next, 2); assert.ok(first.more)
  const search = new SearchStore(folders, { limits: { resultBytes: 4100, chunkBytes: 1000 } })
  let page = await finish(search, search.start(root, 'x', true, current))
  assert.equal(page.status, 'partial'); assert.ok(page.found > 1 && page.found < 250)
  const items = []
  for (;;) {
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: page })) <= 1000)
    assert.ok(page.items.length > 0); items.push(...page.items)
    if (!page.more) break
    page = await search.read(page.job, page.next, current)
  }
  assert.equal(items.length, page.found); assert.equal(new Set(items.map(v => v.id)).size, page.found)
  assert.ok(Buffer.byteLength(JSON.stringify(items)) <= 4100)
  assert.ok(SEARCH_LIMITS.matches === 1000 && SEARCH_LIMITS.chunkMatches === 100)
}))

test('cancellation during open-file I/O does not block document Save; only the newest queued job scans', async () => fixture(async (dir, folders, root) => {
  const path = join(dir, 'example'); await writeFile(path, 'first last')
  const independent = join(dir, '..', 'standalone')
  await writeFile(independent, 'initial')
  const docs = new DocumentStore(); await docs.select(independent, null, async () => 'cancel', current)
  const draft = docs.snapshot!, started = gate(), resume = gate()
  let scans = 0
  const search = new SearchStore(folders, { inspect: async (file, control) => {
    scans++
    return inspectSearchDocument(file, { ...control, authorize: async stat => {
      if (scans === 1) { started.open(); await resume.promise }
      await control.authorize(stat)
    } })
  } })
  const initial = search.start(root, 'first', true, current)
  await started.promise
  try {
    assert.equal((await search.cancel(initial.job, current)).status, 'canceled')
    await docs.save({ ...draft, text: 'last' }, current)
    assert.equal(await readFile(independent, 'utf8'), 'last')
    const replaced = search.start(root, 'unused', true, current), last = search.start(root, 'last', true, current)
    assert.equal(scans, 1); await assert.rejects(search.read(replaced.job, 0, current), denied('stale'))
    resume.open()
    const result = await finish(search, last)
    assert.equal(result.status, 'complete'); assert.equal(result.found, 1); assert.equal(scans, 2)
    await assert.rejects(search.read(initial.job, 0, current), denied('stale'))
  } finally { resume.open() }
}))

test('deadline and owner/root transition during I/O stop publication', async () => fixture(async (dir, folders, root) => {
  await writeFile(join(dir, 'tab'), 'hit')
  let now = 0
  const expired = new SearchStore(folders, { now: () => now, limits: { deadlineMs: 7 }, inspect: async (file, control) => {
    now = 7; return inspectSearchDocument(file, control)
  } })
  const end = await finish(expired, expired.start(root, 'hit', true, current))
  assert.equal(end.status, 'partial'); assert.equal(end.bytes, 0); assert.equal(end.found, 0); assert.match(end.reason!, /tempo/)
  const started = gate(), release = gate()
  const search = new SearchStore(folders, { inspect: async (file, control) => { started.open(); await release.promise; return inspectSearchDocument(file, control) } })
  const running = search.start(root, 'hit', true, current)
  await started.promise
  try { folders.release(root); await assert.rejects(search.read(running.job, 0, current), denied('stale')) }
  finally { release.open() }
  search.revoke(); await assert.rejects(search.cancel(running.job, current), denied('stale'))
}))

test('cancel preserves the completed prefix and its native open authority on the same root', async () => fixture(async (dir, folders, root) => {
  await writeFile(join(dir, 'a.txt'), 'hit'); await writeFile(join(dir, 'b.txt'), 'hit')
  const waiting = gate(), resume = gate()
  let reads = 0
  const search = new SearchStore(folders, { inspect: async (file, control) => {
    if (++reads === 2) { waiting.open(); await resume.promise }
    return inspectSearchDocument(file, control)
  } })
  const started = search.start(root, 'hit', false, current)
  await waiting.promise
  try {
    const canceled = await search.cancel(started.job, current)
    assert.equal(canceled.status, 'canceled'); assert.equal(canceled.found, 1)
    const opened = await search.open(canceled.job, canceled.items[0]!.id, new DocumentStore(), current)
    assert.ok(opened.ok && opened.matchesSnapshot)
    resume.open()
    const page = await search.read(canceled.job, 0, current)
    assert.equal(page.status, 'canceled'); assert.deepEqual(page.items, canceled.items)
  } finally { resume.open() }
}))

test('changed content during document authorization never activates a new grant', async () => fixture(async (dir, folders, root) => {
  const path = join(dir, 'candidate.txt'), docs = new DocumentStore()
  await writeFile(path, 'original hit')
  let changeDuringOpen = false
  const search = new SearchStore(folders, { inspect: async (file, control) => {
    if (changeDuringOpen) await writeFile(file, 'external modification')
    return inspectSearchDocument(file, control)
  } })
  const end = await finish(search, search.start(root, 'hit', false, current))
  changeDuringOpen = true
  await assert.rejects(search.open(end.job, end.items[0]!.id, docs, current), denied('stale'))
  assert.deepEqual(docs.snapshots, []); assert.equal(await readFile(path, 'utf8'), 'external modification')
}))

test('accepts a real one-MiB text file and skips its oversized sibling before consuming bytes', async () => fixture(async (dir, folders, root) => {
  const size = 1024 * 1024, search = new SearchStore(folders)
  await writeFile(join(dir, 'exact.txt'), 'a'.repeat(size - 3) + 'hit')
  await writeFile(join(dir, 'oversized.txt'), Buffer.alloc(size + 1, 97))
  const end = await finish(search, search.start(root, 'hit', true, current))
  assert.equal(end.status, 'partial'); assert.equal(end.skipped, 1); assert.equal(end.files, 1)
  assert.equal(end.bytes, size); assert.equal(end.found, 1); assert.equal(end.items[0]!.column, size - 2)
}))

test('open uses fresh disk and ancestor witnesses, retains older independent grants and refuses the ninth tab', async () => fixture(async (dir, folders, root) => {
  const path = join(dir, 'file'), docs = new DocumentStore()
  await writeFile(path, 'old snapshot'); await docs.select(path, null, async () => 'cancel', current)
  const old = docs.snapshot!
  await writeFile(path, 'new hit')
  const search = new SearchStore(folders)
  const find = async () => await finish(search, search.start(root, 'hit', true, current))
  let result = await find()
  const reuse = await search.open(result.job, result.items[0]!.id, docs, current)
  assert.ok(reuse.ok); assert.equal(reuse.matchesSnapshot, false); assert.deepEqual(reuse.document, old)
  await writeFile(path, 'changed after search')
  await assert.rejects(search.open(result.job, result.items[0]!.id, docs, current), (error: unknown) => denied('stale')(error) && !(error instanceof SearchExpired))
  assert.equal((await search.read(result.job, 0, current)).found, 1); assert.deepEqual(docs.snapshot, old)
  await writeFile(path, 'same hit'); result = await find()
  await rename(path, join(dir, 'previous')); await writeFile(path, 'same hit')
  await assert.rejects(search.open(result.job, result.items[0]!.id, docs, current), denied('stale'))
  result = await find(); await rm(path)
  await assert.rejects(search.open(result.job, result.items.find(i => i.file === 'file')!.id, docs, current), denied('stale'))
  for (let i = 1; i < 8; i++) {
    const extra = join(dir, 'extra-' + i); await writeFile(extra, 'open'); await docs.select(extra, null, async () => 'cancel', current)
  }
  const active = docs.snapshot; result = await find()
  await assert.rejects(search.open(result.job, result.items[0]!.id, docs, current), denied('limit'))
  assert.deepEqual(docs.snapshot, active); assert.equal(docs.snapshots.length, 8)
}))

for (const caller of ['read', 'open'] as const) test(caller + ' detects physical root loss and permanently expires only that job', async () => fixture(async (dir, folders, root) => {
  await writeFile(join(dir, 'candidate'), 'hit')
  const search = new SearchStore(folders), docs = new DocumentStore()
  const result = await finish(search, search.start(root, 'hit', true, current))
  await rename(dir, dir + '-old'); await mkdir(dir)
  const call = () => caller === 'read' ? search.read(result.job, 0, current) : search.open(result.job, result.items[0]!.id, docs, current)
  await assert.rejects(call(), SearchExpired)
  await rename(dir, dir + '-replacement')
  await rename(dir + '-old', dir)
  await assert.rejects(call(), SearchExpired)
  const newer = await finish(search, search.start(root, 'hit', true, current))
  await assert.rejects(call(), SearchExpired)
  assert.equal((await search.read(newer.job, 0, current)).found, 1)
  assert.equal(docs.snapshots.length, 0)
}))
