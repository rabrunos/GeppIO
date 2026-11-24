import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { link, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { DraftStorage, RecoveryQuota, decodeGeneration, encodeGeneration, recoveryFile } from '../src/main/draft-storage.ts'
import type { DraftGeneration } from '../src/main/draft-storage.ts'
import { DraftRecovery } from '../src/main/draft-recovery.ts'
import { DocumentStore } from '../src/main/documents.ts'
import { DOCUMENT_LIMIT } from '../src/shared/documents.ts'
import { validRecoveryRequest } from '../src/shared/draft-recovery.ts'
import { setImmediate } from 'node:timers/promises'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { unusedDocumentAuthoring } from './document-authoring-fixture.ts'

const valid = () => true
const row = (text = 'conteúdo') => ({ key: randomUUID(), version: randomUUID(), name: 'antigo.txt', bom: false, text })
const generation = (text: string): DraftGeneration => ({ enabled: true, records: [row(text)] })
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'geppio-smoke-recovery-test-')))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))
  return root
}
function create(docs: DocumentStore) {
  const result = docs.create(); assert.ok(result.ok && result.document)
  const { id, revision } = result.document
  return { id, revision, text: 'edição' }
}
test('recovery header is closed, byte-bounded, checksummed and preserves literal leading BOM and mixed EOL', () => {
  const data = generation('\ufeffum\r\ndois\rtrês\n'), encoded = encodeGeneration(data)
  assert.deepEqual(decodeGeneration(encoded), data)
  const future = Buffer.from(encoded); future[future.indexOf('"schemaVersion":1') + 16] = 50
  for (const bytes of [Buffer.alloc(2), encoded.subarray(0, -1), future, Buffer.concat([encoded, Buffer.from('!')])]) assert.throws(() => decodeGeneration(bytes))
  for (const name of ['../secret', 'C:\\profile', 'CON']) assert.throws(() => encodeGeneration({ enabled: true, records: [{ ...row(), name }] }))
  const full = Array.from({ length: 8 }, () => row('"'.repeat(DOCUMENT_LIMIT)))
  const max = encodeGeneration({ enabled: true, records: full })
  assert.ok(max.length < 8 * DOCUMENT_LIMIT + 16388)
  assert.throws(() => encodeGeneration({ enabled: true, records: [...full, row('')] }), RecoveryQuota)
  assert.throws(() => encodeGeneration({ enabled: true, records: [{ ...full[0]!, bom: true }] }), RecoveryQuota)
  const epoch = randomUUID(), draft = { id: randomUUID(), revision: randomUUID(), text: 'a' }
  assert.ok(validRecoveryRequest('snapshot', [epoch, 1, [draft]]))
  for (const args of [[epoch, 0, [draft]], [epoch, 1, [draft, draft]], [epoch, 2, [{ ...draft, path: '/forged' }]]]) assert.equal(validRecoveryRequest('snapshot', args), false)
})
test('confirmed generation remains readable after failed promotion, truncation or unsupported schema', async t => {
  const root = await fixture(t), previous = generation('confirmed'), next = generation('next')
  const store = new DraftStorage(root, async (from, to) => {
    await rename(from, to)
    if (corrupt) await writeFile(to, Buffer.from('broken'))
  })
  let corrupt = false
  await store.load(); await store.write(previous, valid)
  corrupt = true; await assert.rejects(store.write(next, valid))
  const restarted = new DraftStorage(root)
  assert.deepEqual(await restarted.load(), previous); assert.equal(restarted.interrupted, true)
  await assert.rejects(restarted.write(next, valid))
  await restarted.write({ enabled: false, records: [] }, valid, true)
  assert.deepEqual(await new DraftStorage(root).load(), { enabled: false, records: [] })
})
test('linked profile directories and hardlinked fixed files refuse reads and clear without altering their targets', async t => {
  const root = await fixture(t), other = await fixture(t), file = join(root, recoveryFile), outside = join(other, 'outside')
  const bytes = encodeGeneration(generation('private')); await writeFile(outside, bytes)
  await link(outside, file); const store = new DraftStorage(root)
  await assert.rejects(store.load()); await assert.rejects(store.write({ enabled: false, records: [] }, valid, true))
  assert.deepEqual(await readFile(outside), bytes)
  const shortcut = join(root, 'shortcut')
  await symlink(other, shortcut, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(new DraftStorage(shortcut).load())
})
test('recoverable rows consume quota across restarts, paths and live grants never persist', async t => {
  const root = await fixture(t), full = { enabled: true, records: Array.from({ length: 8 }, () => row()) }
  const initial = new DraftStorage(root); await initial.load(); await initial.write(full, valid)
  const docs = new DocumentStore(), owner = new DraftRecovery(root, docs), status = await owner.read(), draft = create(docs)
  const refused = await owner.snapshot(status.epoch, 1, [draft], valid)
  assert.match(refused.error!, /oito/); assert.deepEqual(await new DraftStorage(root).load(), full)
  const offered = await owner.restore(status.epoch, full.records[0]!.key, valid)
  assert.ok(offered.result.ok && offered.result.document?.untitled)
  assert.equal(offered.result.document.text, ''); assert.equal(offered.text, full.records[0]!.text)
  assert.equal(docs.filePath(offered.result.document.id), null)
  assert.equal((await owner.read()).choices.length, 8, 'lost restore receipt retains the offered text')
  for (let i = docs.snapshots.length; i < 8; i++) create(docs)
  const repeated = await owner.restore(status.epoch, full.records[0]!.key, valid)
  assert.ok(repeated.result.ok); assert.equal(repeated.result.document?.id, offered.result.document.id)
  assert.equal(docs.snapshots.length, 8)
  await owner.snapshot(status.epoch, 2, [{ id: offered.result.document.id, revision: offered.result.document.revision, text: '' }], valid)
  assert.deepEqual(await new DraftStorage(root).load(), full)
})
test('a later snapshot survives stale save cleanup, discarded generations cannot be resurrected', async t => {
  const root = await fixture(t), docs = new DocumentStore(), owner = new DraftRecovery(root, docs)
  const { epoch } = await owner.read(), first = create(docs)
  await owner.snapshot(epoch, 1, [first], valid)
  const covered = owner.capture()
  await owner.snapshot(epoch, 2, [{ ...first, text: 'mais recente' }], valid)
  await owner.retire([first.id], covered, valid)
  assert.equal((await new DraftStorage(root).load()).records[0]?.text, 'mais recente')
  const current = owner.capture()
  await docs.release(first, async () => 'discard', valid); await owner.retire([first.id], current, valid)
  assert.deepEqual((await new DraftStorage(root).load()).records, [])
  assert.throws(() => owner.snapshot(epoch, 1, [first], valid))
  assert.throws(() => owner.snapshot(epoch, 3, [first], valid))
})
test('queued stale copy while Save As changes revision cannot cancel cleanup of an earlier confirmed copy', async t => {
  const root = await fixture(t), path = join(root, 'chosen.txt')
  const docs = new DocumentStore(undefined, { select: async () => path, permitted: valid, confirmOverwrite: async () => false, reconcile: async () => false })
  const owner = new DraftRecovery(root, docs), { epoch } = await owner.read(), draft = create(docs)
  await owner.snapshot(epoch, 1, [draft], valid)
  const coverage = owner.capture()
  let permitted = true
  const stale = owner.snapshot(epoch, 2, [draft], () => permitted)
  permitted = false; await assert.rejects(stale)
  const saved = await docs.saveAs(draft, false, valid); assert.ok(saved)
  await owner.retire([draft.id], coverage, valid)
  assert.deepEqual((await new DraftStorage(root).load()).records, [])
  const later = { id: saved.id, revision: saved.revision, text: 'edição posterior' }
  await owner.snapshot(epoch, 3, [later], valid)
  await owner.retire([draft.id], coverage, valid)
  assert.equal((await new DraftStorage(root).load()).records[0]?.text, later.text)
  assert.equal(await readFile(path, 'utf8'), draft.text)
})

test('explicit reconciliation of abandoned staging preserves confirmed source and resumes snapshots', async t => {
  const root = await fixture(t), store = new DraftStorage(root), source = generation('confirmed')
  await store.load(); await store.write(source, valid)
  await writeFile(join(root, recoveryFile + '.tmp'), Buffer.from('partial header'))
  const docs = new DocumentStore(), owner = new DraftRecovery(root, docs), initial = await owner.read()
  assert.ok(initial.error); assert.equal(initial.choices[0]?.key, source.records[0]?.key)
  const reconciled = await owner.reconcile(initial.epoch, valid)
  assert.equal(reconciled.error, null); assert.deepEqual(reconciled.choices, initial.choices)
  await owner.snapshot(initial.epoch, 1, [create(docs)], valid)
  assert.deepEqual((await new DraftStorage(root).load()).records.map(item => item.text), ['confirmed', 'edição'])
})
test('verified promoted bytes survive an explicit reconciliation after a lost promotion receipt, without replay', async t => {
  const root = await fixture(t), first = generation('A'), later = generation('B')
  let calls = 0
  const store = new DraftStorage(root, async (from, to) => { await rename(from, to); if (++calls === 2) throw new Error('lost receipt') })
  await store.load(); await store.write(first, valid); await assert.rejects(store.write(later, valid))
  assert.deepEqual(await store.reconcile(first, valid, later), later)
  assert.equal(calls, 2); assert.deepEqual(await new DraftStorage(root).load(), later)
})
test('debounced snapshot confirmed inside a Save As picker is covered by the submitted text and revision', async t => {
  const root = await fixture(t)
  let choose!: (value: string) => void, show!: () => void
  const picked = new Promise<string>(done => { choose = done }), opened = new Promise<void>(done => { show = done })
  const docs = new DocumentStore(undefined, { select: async () => { show(); return picked }, permitted: valid, confirmOverwrite: async () => false, reconcile: async () => false })
  const owner = new DraftRecovery(root, docs), { epoch } = await owner.read(), draft = create(docs), coverage = owner.capture()
  const saving = docs.saveAs(draft, false, valid)
  await opened
  await owner.snapshot(epoch, 1, [draft], valid)
  choose(join(root, 'saved.txt')); assert.ok(await saving)
  await owner.retire([draft.id], coverage, valid, [draft])
  assert.deepEqual((await new DraftStorage(root).load()).records, [])
})
test('reconciling a lost initial snapshot or clear completes its bindings and epoch exactly once', async t => {
  const root = await fixture(t), docs = new DocumentStore(), draft = create(docs)
  let lose = true
  const storage = new DraftStorage(root, async (from, to) => { await rename(from, to); if (lose) throw new Error('lost') })
  const owner = new DraftRecovery(root, docs, storage), { epoch } = await owner.read()
  assert.ok((await owner.snapshot(epoch, 1, [draft], valid)).error)
  const recovered = await owner.reconcile(epoch, valid); assert.equal(recovered.error, null); assert.deepEqual(recovered.choices, [])
  lose = false; await owner.snapshot(epoch, 2, [draft], valid)
  assert.equal((await new DraftStorage(root).load()).records.length, 1)
  await owner.retire([draft.id], owner.capture(), valid, [draft]); assert.equal((await new DraftStorage(root).load()).records.length, 0)
  await owner.snapshot(epoch, 3, [draft], valid); lose = true
  assert.ok((await owner.configure(epoch, true, valid)).error)
  const cleared = await owner.reconcile(epoch, valid); assert.notEqual(cleared.epoch, epoch)
  assert.equal((await new DraftStorage(root).load()).records.length, 0)
  assert.throws(() => owner.snapshot(epoch, 4, [draft], valid))
})
test('confirmed discard or Save As before reconciliation retires the uncertain first snapshot', async t => {
  for (const operation of ['discard', 'save']) {
    const root = await fixture(t)
    const docs = new DocumentStore(undefined, { select: async () => join(root, 'new.txt'), permitted: valid, confirmOverwrite: async () => false, reconcile: async () => false })
    let lose = true
    const store = new DraftStorage(root, async (from, to) => { await rename(from, to); if (lose) throw new Error('lost') })
    const owner = new DraftRecovery(root, docs, store), draft = create(docs), { epoch } = await owner.read()
    assert.ok((await owner.snapshot(epoch, 1, [draft], valid)).error)
    const boundary = owner.capture()
    if (operation === 'save') assert.ok(await docs.saveAs(draft, false, valid))
    else assert.ok((await docs.release(draft, async () => 'discard', valid)).ok)
    await owner.retire([draft.id], boundary, valid, [draft])
    lose = false
    assert.deepEqual((await owner.reconcile(epoch, valid)).choices, [])
    assert.deepEqual((await new DraftStorage(root).load()).records, [])
  }
})
test('reconciling a newer uncertain snapshot keeps it after cleanup of a covered older version of the same key', async t => {
  const root = await fixture(t), docs = new DocumentStore(), draft = create(docs)
  let lose = false
  const store = new DraftStorage(root, async (from, to) => { await rename(from, to); if (lose) throw new Error('lost') })
  const owner = new DraftRecovery(root, docs, store), { epoch } = await owner.read()
  await owner.snapshot(epoch, 1, [draft], valid)
  const boundary = owner.capture()
  lose = true; assert.ok((await owner.snapshot(epoch, 2, [{ ...draft, text: 'B' }], valid)).error)
  await owner.retire([draft.id], boundary, valid, [draft])
  lose = false; assert.equal((await owner.reconcile(epoch, valid)).error, null)
  assert.deepEqual((await new DraftStorage(root).load()).records.map(row => row.text), ['B'])
})
test('rename updates a confirmed draft by identity and missing original restores as fresh untitled text', async t => {
  const root = await fixture(t), original = join(root, 'before.txt'), target = join(root, 'after.txt')
  await writeFile(original, 'on disk')
  const docs = new DocumentStore(), owner = new DraftRecovery(root, docs), { epoch } = await owner.read()
  const selected = await docs.select(original, null, async () => 'cancel', valid)
  assert.ok(selected.ok && selected.document)
  const draft = { id: selected.document.id, revision: selected.document.revision, text: 'only in recovery' }
  await owner.snapshot(epoch, 1, [draft], valid)
  const move = docs.prepareRename(draft.id, draft.revision, original, target, valid)
  await move.validate(); await rename(original, target); const updated = await move.confirm()
  assert.throws(() => owner.snapshot(epoch, 2, [draft], valid))
  await owner.snapshot(epoch, 3, [{ ...draft, revision: updated.revision }], valid)
  await rm(target)
  const fresh = new DocumentStore(), later = new DraftRecovery(root, fresh), state = await later.read()
  assert.deepEqual(state.choices.map(item => item.name), ['after.txt'])
  const choice = await later.restore(state.epoch, state.choices[0]!.key, valid)
  assert.ok(choice.result.ok && choice.result.document?.untitled); assert.notEqual(choice.result.document.id, draft.id)
  assert.equal(choice.text, 'only in recovery'); assert.equal(fresh.filePath(choice.result.document.id), null)
  await assert.rejects(fresh.save(draft, valid))
})
test('renderer snapshots after 500 ms of quiet or 2 s of continuous edits, retains pending state through an older reply', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1 })
  const doc = { id: randomUUID(), revision: randomUUID(), text: 'base', name: 'named', bom: false }
  const status = { epoch: randomUUID(), enabled: true, error: null, choices: [] }
  const unexpected = async () => { throw new Error('Unexpected fixture action') }
  const hits: string[] = []
  let release: (() => void) | undefined
  const editor = new EditorSession({ ...unusedDocumentAuthoring, open: async () => ({ ok: true, document: doc }), reload: unexpected, activate: unexpected,
    close: unexpected, save: unexpected, release: unexpected, onCloseRequested: () => () => {} }, {
    read: async () => status, restore: unexpected, configure: unexpected, clear: unexpected,
    snapshot: async (_epoch, sequence, drafts) => {
      hits.push(drafts[0]!.text)
      if (sequence === 1) await new Promise<void>(resolve => { release = resolve })
      return status
    }
  })
  const recovery = editor.recovery!, disconnect = recovery.connect(); t.after(disconnect)
  await setImmediate(); await editor.open(); editor.editExact('one')
  t.mock.timers.tick(499); await setImmediate(); assert.equal(hits.length, 0)
  t.mock.timers.tick(1); await setImmediate(); assert.deepEqual(hits, ['one'])
  editor.editExact('two'); release!(); await setImmediate(); assert.equal(recovery.view().phase, 'pending')
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(400); editor.editExact('continuous ' + i) }
  t.mock.timers.tick(399); await setImmediate(); assert.equal(hits.length, 1)
  t.mock.timers.tick(1); await setImmediate(); assert.deepEqual(hits, ['one', 'continuous 3'])
  assert.equal(recovery.view().phase, 'confirmed')
})
test('a stale native revision does not pause the other dirty tab while the renderer still shows the old revision', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1 })
  const native = new DocumentStore(), first = create(native), second = create(native)
  const unexpected = async () => { throw new Error('Unexpected fixture operation') }
  const status = { epoch: randomUUID(), enabled: true, error: null, choices: [] }
  const calls: string[][] = []
  const editor = new EditorSession({ ...unusedDocumentAuthoring, open: async () => native.result(), activate: unexpected, close: unexpected,
    save: unexpected, release: unexpected, reload: unexpected, onCloseRequested: () => () => {} }, {
    read: async () => status, configure: unexpected, restore: unexpected, clear: unexpected,
    snapshot: async (_epoch, _sequence, drafts) => { calls.push(drafts.map(item => item.id)); return calls.length === 1 ? { ...status, staleIds: [first.id] } : status }
  })
  const recovery = editor.recovery!, disconnect = recovery.connect(); t.after(disconnect)
  await setImmediate(); await editor.open(); assert.ok(editor.editExact('first', first.id)); assert.ok(editor.editExact('second', second.id))
  t.mock.timers.tick(500); await setImmediate(); assert.equal(recovery.view().phase, 'pending')
  t.mock.timers.tick(500); await setImmediate()
  assert.deepEqual(calls, [[first.id, second.id], [second.id]]); assert.equal(recovery.view().phase, 'confirmed')
})
