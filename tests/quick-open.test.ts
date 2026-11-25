import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs, { link, mkdir, mkdtemp, opendir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { DocumentFailure, DocumentStore } from '../src/geppio/src/main/documents.ts'
import { DirectoryStore, inspectExplorerPath } from '../src/geppio/src/main/explorer.ts'
import { QuickOpenExpired, QuickOpenStore } from '../src/geppio/src/main/quick-open.ts'
import { SearchStore } from '../src/geppio/src/main/search.ts'
import { QUICK_OPEN_LIMITS } from '../src/geppio/src/shared/quick-open.ts'
import type { QuickOpenPage } from '../src/geppio/src/shared/quick-open.ts'
import { SEARCH_EXCLUDED_DIRECTORIES } from '../src/geppio/src/shared/search.ts'

const current = () => true
const denied = (kind: string) => (error: unknown) => error instanceof DocumentFailure && error.kind === kind
async function fixture(run: (dir: string, folders: DirectoryStore, root: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), 'geppio-quick-open-'))
  try {
    const dir = join(await realpath(base), 'project'); await mkdir(dir)
    const folders = new DirectoryStore(); await folders.select(dir, current)
    await run(dir, folders, folders.snapshot!.id)
  } finally { await rm(base, { recursive: true, force: true, maxRetries: 4 }) }
}
async function finish(store: QuickOpenStore, page: QuickOpenPage, query: string) {
  const end = performance.now() + 10000
  while (page.status === 'running' && performance.now() < end) { await nextTurn(); page = await store.read(page.job, query, current) }
  assert.notEqual(page.status, 'running')
  return page
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }

test('inventory opens no file handles, filters changing queries without rescanning and reports only public fields', async t => fixture(async (dir, folders, root) => {
  await mkdir(join(dir, 'src')); await writeFile(join(dir, 'src', 'ação.txt'), 'private data')
  await writeFile(join(dir, 'binary.dat'), Buffer.from([0xff, 0, 1]))
  for (const excluded of ['.GiT', ...SEARCH_EXCLUDED_DIRECTORIES]) {
    await mkdir(join(dir, excluded)); await writeFile(join(dir, excluded, 'ignored'), 'example')
  }
  const outside = join(dir, '..', 'outside'); await mkdir(outside); await writeFile(join(outside, 'target'), 'text')
  await link(join(outside, 'target'), join(dir, 'linked.dat'))
  await symlink(outside, join(dir, 'junction'), process.platform === 'win32' ? 'junction' : 'dir')
  let directoriesOpened = 0
  const store = new QuickOpenStore(folders, { openDirectory: async path => { directoriesOpened++; return opendir(path) } })
  const open = t.mock.method(fs, 'open'), read = t.mock.method(fs, 'readFile')
  syncBuiltinESMExports()
  try {
    const result = await finish(store, store.start(root, 'AÇÃO', current), 'AÇÃO')
    assert.equal(result.status, 'partial'); assert.equal(result.skipped, 2); assert.equal(result.total, 2)
    assert.equal(result.items.length, 1); assert.equal(result.items[0]!.file, 'src/ação.txt')
    assert.deepEqual(Object.keys(result.items[0]!).sort(), ['file', 'id'])
    assert.ok(!JSON.stringify(result).includes(dir))
    const bin = await store.read(result.job, 'dat', current)
    assert.deepEqual(bin.items.map(item => item.file), ['binary.dat'])
    assert.equal((await store.read(result.job, 'ignored', current)).items.length, 0)
    assert.equal(directoriesOpened, 2)
    assert.equal(open.mock.callCount(), 0); assert.equal(read.mock.callCount(), 0)
    const docs = new DocumentStore()
    await assert.rejects(store.open(result.job, bin.items[0]!.id, docs, current), denied('unsupported'))
    const selected = await store.open(result.job, result.items[0]!.id, docs, current)
    assert.ok(selected.ok && selected.document?.text === 'private data')
    assert.ok(open.mock.callCount() > 0)
    assert.deepEqual(store.cancel(result.job, current), { ok: true })
    await assert.rejects(store.open(result.job, result.items[0]!.id, docs, current), QuickOpenExpired)
  } finally { open.mock.restore(); read.mock.restore(); syncBuiltinESMExports() }
}))

test('result cap is independent of inventory; retained budget includes every private identity chain and UTF-8 name', async () => fixture(async (dir, folders, root) => {
  assert.equal(QUICK_OPEN_LIMITS.metadataBytes, 1048576)
  for (let i = 0; i < 203; i++) await writeFile(join(dir, 'f-' + String(i).padStart(3, '0') + '-á'), 'x')
  const all = new QuickOpenStore(folders), result = await finish(all, all.start(root, 'á', current), 'á')
  assert.equal(result.status, 'complete'); assert.equal(result.total, 203)
  assert.equal(result.items.length, 200); assert.equal(result.truncated, true)
  const last = await all.read(result.job, '202', current)
  assert.equal(last.total, 203); assert.equal(last.items.length, 1); assert.equal(last.truncated, false)
  const file = last.items[0]!.file, evidence = await inspectExplorerPath(join(dir, file), 'file')
  const max = Buffer.byteLength(JSON.stringify([{ id: randomUUID(), file, chain: evidence.chain }])) + 32
  const bounded = new QuickOpenStore(folders, { limits: { metadataBytes: max } })
  const limited = await finish(bounded, bounded.start(root, 'á', current), 'á')
  assert.equal(limited.status, 'partial'); assert.equal(limited.total, 1)
  assert.ok(limited.visited >= 2)
  const shallow = new QuickOpenStore(folders, { limits: { entries: 2 } })
  const small = await finish(shallow, shallow.start(root, 'á', current), 'á')
  assert.equal(small.status, 'partial'); assert.equal(small.visited, 2); assert.equal(small.total, 2)
}))

test('closing during opendir closes the pending handle without iterating and drains only the newest replacement', async () => fixture(async (dir, folders, root) => {
  await writeFile(join(dir, 'found.txt'), 'saved text')
  const hold = deferred(), entered = deferred()
  let opened = 0, iterated = false, closed = false
  const store = new QuickOpenStore(folders, { openDirectory: async path => {
    const directory = await opendir(path)
    if (++opened !== 1) return directory
    const original = directory[Symbol.asyncIterator].bind(directory)
    directory[Symbol.asyncIterator] = () => { iterated = true; return original() }
    const close = directory.close.bind(directory)
    directory.close = async () => { await close(); closed = true }
    entered.resolve(); await hold.promise
    return directory
  } })
  const first = store.start(root, 'f', current); await entered.promise
  try {
    assert.deepEqual(store.cancel(first.job, current), { ok: true })
    const content = new SearchStore(folders), search = content.start(root, 'saved', true, current)
    let hits = await content.read(search.job, 0, current)
    const deadline = performance.now() + 10000
    while (hits.status === 'running' && performance.now() < deadline) { await nextTurn(); hits = await content.read(search.job, 0, current) }
    assert.equal(hits.found, 1)
    let latest = store.start(root, 'x', current)
    for (let i = 0; i < 25; i++) latest = store.start(root, 'f', current)
    await assert.rejects(store.read(first.job, 'f', current), QuickOpenExpired)
    assert.equal(opened, 1)
    hold.resolve()
    assert.equal((await finish(store, latest, 'found')).total, 1)
    assert.equal(opened, 2); assert.equal(closed, true); assert.equal(iterated, false)
    assert.deepEqual((await content.read(search.job, 0, current)).items, hits.items)
  } finally { hold.resolve() }
}))

test('opaque open revalidates disk ancestry and file identity, reuses open grants and preserves the eight-document limit', async () => fixture(async (dir, folders, root) => {
  const store = new QuickOpenStore(folders), docs = new DocumentStore(), file = join(dir, 'existing.txt')
  await writeFile(file, 'saved'); await docs.select(file, null, async () => 'cancel', current)
  const original = docs.snapshot!
  const first = await finish(store, store.start(root, 'existing', current), 'existing')
  const item = first.items[0]!.id
  await writeFile(file, 'same identity, edited independently')
  assert.deepEqual((await store.open(first.job, item, docs, current)).ok, true)
  assert.deepEqual(docs.snapshot, original)
  await rename(file, file + '.old'); await writeFile(file, 'saved')
  await assert.rejects(store.open(first.job, item, docs, current), denied('stale'))
  await rm(file)
  await assert.rejects(store.open(first.job, item, docs, current), denied('stale'))
  await link(file + '.old', file)
  await assert.rejects(store.open(first.job, item, docs, current), denied('stale'))
  assert.deepEqual(docs.snapshot, original)
  for (let i = 1; i <= 8; i++) {
    const name = join(dir, 'next-' + i); await writeFile(name, 'saved')
    if (i < 8) await docs.select(name, null, async () => 'cancel', current)
  }
  const last = docs.snapshot
  const next = await finish(store, store.start(root, 'next-8', current), 'next-8')
  await assert.rejects(store.open(next.job, next.items[0]!.id, docs, current), denied('limit'))
  assert.deepEqual(docs.snapshot, last); assert.equal(docs.snapshots.length, 8)
  await rename(dir, dir + '-old'); await mkdir(dir)
  await assert.rejects(store.open(next.job, next.items[0]!.id, docs, current), QuickOpenExpired)
  await rename(dir, dir + '-new'); await rename(dir + '-old', dir)
  await assert.rejects(store.read(next.job, 'next', current), QuickOpenExpired)
}))

test('a replacement predating the inventory cannot impersonate an existing grant; an app-confirmed atomic save can reopen', async () => fixture(async (dir, folders, root) => {
  const store = new QuickOpenStore(folders), docs = new DocumentStore(), file = join(dir, 'first.txt'), other = join(dir, 'other.txt')
  await writeFile(file, 'first'); await writeFile(other, 'other')
  await docs.select(file, null, async () => 'cancel', current)
  const original = docs.snapshot!
  const saved = await docs.save({ id: original.id, revision: original.revision, text: 'app edit' }, current)
  const confirmed = await finish(store, store.start(root, 'first', current), 'first')
  const opened = await store.open(confirmed.job, confirmed.items[0]!.id, docs, current)
  assert.ok(opened.ok); assert.deepEqual(opened.document, saved)
  await docs.select(other, null, async () => 'cancel', current)
  const active = docs.snapshot, before = docs.snapshots
  await rename(file, file + '.previous'); await writeFile(file, 'app edit')
  const latest = await finish(store, store.start(root, 'first', current), 'first')
  const replacement = latest.items.find(item => item.file === 'first.txt')!
  await assert.rejects(store.open(latest.job, replacement.id, docs, current), denied('stale'))
  assert.deepEqual(docs.snapshot, active); assert.deepEqual(docs.snapshots, before)
}))

test('an existing grant stays activatable by identity after its file becomes binary or grows beyond the document limit', async t => fixture(async (dir, folders, root) => {
  const quick = new QuickOpenStore(folders), docs = new DocumentStore(), path = join(dir, 'first.txt'), other = join(dir, 'other.txt')
  await writeFile(path, 'confirmed first'); await writeFile(other, 'other')
  await docs.select(path, null, async () => 'cancel', current)
  const confirmed = docs.snapshot!
  await docs.select(other, null, async () => 'cancel', current)
  const otherId = docs.snapshot!.id
  const page = await finish(quick, quick.start(root, 'first', current), 'first')
  for (const bytes of [Buffer.from([0xff, 0]), Buffer.alloc(1024 * 1024 + 1, 97)]) {
    await writeFile(path, bytes); docs.activate(otherId)
    const open = t.mock.method(fs, 'open'); syncBuiltinESMExports()
    try {
      const result = await quick.open(page.job, page.items[0]!.id, docs, current)
      assert.ok(result.ok); assert.deepEqual(result.document, confirmed); assert.equal(docs.snapshots.length, 2)
      assert.equal(open.mock.callCount(), 0)
    } finally { open.mock.restore(); syncBuiltinESMExports() }
  }
}))

test('root and caller revocation reject pending opens; nested .git and malformed queries never start a scan', async () => fixture(async (dir, folders, root) => {
  const file = join(dir, 'file.txt'); await writeFile(file, 'data')
  const store = new QuickOpenStore(folders), docs = new DocumentStore()
  for (const query of ['', 'x'.repeat(257), '\n']) assert.throws(() => store.start(root, query, current), denied('invalid'))
  assert.throws(() => store.start(randomUUID(), 'f', current), denied('stale'))
  const page = await finish(store, store.start(root, 'file', current), 'file')
  await assert.rejects(store.read(page.job, '', current), denied('invalid'))
  await assert.rejects(store.read(page.job, 'f', () => false), QuickOpenExpired)
  await assert.rejects(store.open(page.job, randomUUID(), docs, current), denied('stale'))
  const pending = deferred(), resume = deferred()
  const select = docs.select.bind(docs)
  docs.select = async (...args) => { pending.resolve(); await resume.promise; return select(...args) }
  const opening = store.open(page.job, page.items[0]!.id, docs, current)
  await pending.promise
  try {
    const nested = join(dir, '.GiT', 'nested'); await mkdir(nested, { recursive: true })
    await folders.select(nested, current)
    assert.throws(() => store.start(folders.snapshot!.id, 'file', current), denied('unsupported'))
    resume.resolve(); await assert.rejects(opening, QuickOpenExpired)
    assert.deepEqual(docs.snapshots, [])
    await folders.select(dir, current)
    const newer = await finish(store, store.start(folders.snapshot!.id, 'file', current), 'file')
    await assert.rejects(store.read(page.job, 'file', current), QuickOpenExpired)
    assert.equal((await store.read(newer.job, 'file', current)).total, 1)
  } finally { resume.resolve() }
}))
