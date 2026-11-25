import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs, { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { DocumentFailure, DocumentStore } from '../src/geppio/src/main/documents.ts'
import { DOCUMENT_LIMIT } from '@geppio/runtime/documents'
import type { DocumentDraft, DocumentSnapshot } from '@geppio/runtime/documents'

const live = () => true, discard = async () => true
const noDialog = async (): Promise<never> => { throw new Error('unexpected discard prompt') }
const fail = (kind: string) => (error: unknown) => error instanceof DocumentFailure && error.kind === kind
const draft = (doc: DocumentSnapshot, text = doc.text): DocumentDraft => ({ id: doc.id, revision: doc.revision, text })

async function fixture(t: TestContext, store = new DocumentStore()) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'geppio-reload-')))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 4 }))
  const folder = join(root, 'project'); await mkdir(folder)
  const path = join(folder, 'doc.txt')
  async function select(path: string, text: string) {
    await writeFile(path, text)
    await store.select(path, null, noDialog, live)
    return store.snapshot!
  }
  const first = await select(path, 'original')
  return { root, folder, path, store, first, select }
}

test('explicit read adopts exact external bytes and BOM, rotates evidence, preserves the active grant and never writes', async t => {
  const { root, path, store, first, select } = await fixture(t)
  const other = await select(join(root, 'other'), 'independent')
  store.activate(first.id)
  const text = 'á😀\r\nsame\nlast\rend', bytes = Buffer.from('\ufeff' + text)
  await writeFile(path, bytes)
  const before = await lstat(path, { bigint: true })
  const result = await store.reload(draft(first), false, noDialog, live)
  assert.ok(result.ok && result.document)
  const next = result.document
  assert.equal(result.documents, undefined); assert.equal(next.id, first.id); assert.notEqual(next.revision, first.revision)
  assert.deepEqual({ text: next.text, bom: next.bom }, { text, bom: true })
  assert.equal(store.snapshot?.id, first.id); assert.deepEqual(store.snapshots.find(doc => doc.id === other.id), other)
  assert.deepEqual(await readFile(path), bytes)
  const after = await lstat(path, { bigint: true })
  assert.deepEqual([after.ino, after.size, after.mtimeNs, after.ctimeNs], [before.ino, before.size, before.mtimeNs, before.ctimeNs])
  await assert.rejects(store.save(draft(first, 'stale'), live), fail('stale'))
  await store.reload(draft(next), false, noDialog, live)
  assert.equal(store.snapshot?.revision, next.revision)
  // Swapping an ordinary file with identical bytes is a new native witness.
  const replacement = join(root, 'new'); await writeFile(replacement, bytes); await rename(replacement, path)
  await store.reload(draft(next), false, noDialog, live)
  assert.equal(store.snapshot?.text, text); assert.notEqual(store.snapshot?.revision, next.revision)
  await assert.rejects(store.save(draft(next, 'stale'), live), fail('stale'))
  const saved = await store.save(draft(store.snapshot!, 'after reload'), live)
  assert.equal(saved.id, first.id); assert.deepEqual(await readFile(path), Buffer.from('\ufeffafter reload'))
})

test('dirty and explicitly unresolved reloads require a native discard; Cancel discloses no new revision', async t => {
  const { path, store, first } = await fixture(t)
  const pending = draft(first, 'my draft')
  let calls = 0
  for (const [d, unresolved] of [[pending, false], [draft(first), true]] as const) {
    const canceled = await store.reload(d, unresolved, async () => { calls++; return false }, live)
    assert.deepEqual(canceled, { ok: true, canceled: true, document: null })
    assert.deepEqual(store.snapshot, first)
  }
  const accepted = await store.reload(pending, false, async () => { calls++; return true }, live)
  assert.ok(accepted.ok && accepted.document); assert.equal(accepted.document.text, 'original'); assert.equal(calls, 3)
  assert.notEqual(accepted.document.revision, first.revision)
  await assert.rejects(store.save(pending, live), fail('stale')); assert.equal(await readFile(path, 'utf8'), 'original')
})

test('post-replacement Save uncertainty requires discard even when the supplied draft matches the last confirmed text', async t => {
  let replacements = 0
  const store = new DocumentStore(async (from, to) => { replacements++; await rename(from, to); await writeFile(to, 'external after replacement') })
  const { path, first } = await fixture(t, store)
  await assert.rejects(store.save(draft(first, 'attempted write'), live), fail('unconfirmed'))
  assert.deepEqual(store.snapshot, first)
  const prompt = t.mock.fn(async () => false)
  await store.reload(draft(first), false, prompt, live); await store.reload(draft(first), false, prompt, live)
  assert.equal(prompt.mock.callCount(), 2); assert.deepEqual(store.snapshot, first)
  await store.reload(draft(first), false, discard, live)
  const accepted = store.snapshot!
  assert.equal(accepted.text, 'external after replacement'); assert.notEqual(accepted.revision, first.revision)
  await store.reload(draft(accepted), false, noDialog, live)
  assert.equal(replacements, 1); assert.equal(await readFile(path, 'utf8'), 'external after replacement')
})

test('one reload-only predecessor reconciles successive lost Save/Reload receipts while disk changes', async t => {
  const { path, store, first } = await fixture(t)
  const before = draft(first, 'saved once')
  // Main commits; the original caller continues with its last known token.
  const saved = await store.save(before, live)
  const prompt = t.mock.fn(discard)
  const receipt = await store.reload(before, false, prompt, live)
  assert.ok(receipt.ok && receipt.document); assert.equal(receipt.document.revision, saved.revision)
  for (const text of ['second disk content', 'third disk content']) {
    await writeFile(path, text); await store.reload(before, false, prompt, live)
    const current = store.snapshot!; assert.equal(current.text, text)
    await store.reload(before, false, prompt, live); assert.equal(store.snapshot!.revision, current.revision)
    await assert.rejects(store.save(before, live), fail('stale'))
    await assert.rejects(store.release(before, noDialog, live), fail('stale'))
  }
  assert.equal(prompt.mock.callCount(), 5)
  const current = store.snapshot!
  await assert.rejects(store.reload({ ...before, revision: randomUUID() }, true, noDialog, live), fail('stale'))
  await assert.rejects(store.reload(draft(saved), true, noDialog, live), fail('stale'))
  const next = await store.save(draft(current, 'next committed edit'), live)
  await assert.rejects(store.reload(before, false, noDialog, live), fail('stale'))
  await store.reload(draft(current, next.text), false, prompt, live)
  assert.equal(store.snapshot!.revision, next.revision); assert.equal(await readFile(path, 'utf8'), 'next committed edit')
})

test('missing, invalid, oversized, hardlinked and redirected targets retain confirmed state', async t => {
  for (const kind of ['missing', 'binary', 'invalid', 'oversized', 'hardlink', 'junction']) {
    const { root, folder, path, store, first } = await fixture(t)
    const original = join(root, 'original')
    if (kind === 'missing') await rename(path, original)
    if (kind === 'binary') await writeFile(path, Buffer.from([97, 0, 98]))
    if (kind === 'invalid') await writeFile(path, Buffer.from([0xc3, 0x28]))
    if (kind === 'oversized') await writeFile(path, Buffer.alloc(DOCUMENT_LIMIT + 1))
    if (kind === 'hardlink') await link(path, original)
    if (kind === 'junction') {
      await rename(folder, original); await symlink(original, folder, process.platform === 'win32' ? 'junction' : 'dir')
    }
    if (kind === 'missing') await assert.rejects(store.reload(draft(first), false, noDialog, live), { code: 'ENOENT' })
    else await assert.rejects(store.reload(draft(first), false, noDialog, live), fail(kind === 'oversized' ? 'oversized' : 'unsupported'))
    assert.deepEqual(store.snapshot, first)
  }
})

test('closing a dirty tab accepts precisely its own confirmed Save and rejects an intervening reload', async t => {
  const { path, root, store, first, select } = await fixture(t)
  const sibling = await select(join(root, 'sibling'), 'unchanged')
  store.activate(first.id)
  const originalDraft = draft(first, 'edited')
  await assert.rejects(store.release(originalDraft, async () => {
    await writeFile(path, 'externally edited'); await store.reload(draft(first), false, noDialog, live)
    return 'discard'
  }, live), fail('stale'))
  assert.equal(store.snapshot?.id, first.id); assert.equal(store.snapshots.length, 2)
  const result = await store.release(draft(store.snapshot!, 'explicit save and close'), async () => 'save', live)
  assert.ok(result.ok && !result.canceled); assert.deepEqual(result.document, sibling)
  assert.deepEqual(store.snapshots, [sibling]); assert.equal(await readFile(path, 'utf8'), 'explicit save and close')
})

test('native Save uncertainty still prompts on close when draft was undone to its original text', async t => {
  const store = new DocumentStore(async (from, to) => { await rename(from, to); await writeFile(to, 'external') })
  const { path, first } = await fixture(t, store)
  await assert.rejects(store.save(draft(first, 'intended'), live), fail('unconfirmed'))
  const supplied = draft(first)
  const cancel = t.mock.fn(async () => 'cancel' as const)
  assert.equal(await store.resolveAll([supplied], cancel, live), false)
  const canceled = await store.release(supplied, cancel, live)
  assert.ok(canceled.ok && canceled.canceled); assert.deepEqual(store.snapshot, first); assert.equal(cancel.mock.callCount(), 2)
  const close = t.mock.fn(async () => 'discard' as const)
  const released = await store.release(supplied, close, live)
  assert.ok(released.ok && !released.canceled); assert.equal(close.mock.callCount(), 1)
  assert.equal(store.snapshot, null); assert.equal(await readFile(path, 'utf8'), 'external')
})

test('pins authorized parents and target across discard and refuses newly active/revised/expired documents', async t => {
  for (const mode of ['ancestor', 'leaf', 'switched', 'revision', 'owner', 'revoked']) {
    const { store, path, root, folder, first, select } = await fixture(t)
    const other = await select(join(root, 'other'), 'other')
    await assert.rejects(store.reload(draft(first), false, noDialog, live), fail('stale'))
    store.activate(first.id)
    let allowed = true
    const result = store.reload(draft(first, 'draft'), false, async () => {
      if (mode === 'ancestor') {
        const old = join(root, 'previous')
        await rename(folder, old); await mkdir(folder); await rename(join(old, 'doc.txt'), path)
      }
      if (mode === 'leaf') { const replacement = join(root, 'new'); await writeFile(replacement, 'original'); await rename(replacement, path) }
      if (mode === 'switched') store.activate(other.id)
      if (mode === 'revision') await store.save(draft(first, 'explicit intervening save'), live)
      if (mode === 'owner') allowed = false
      if (mode === 'revoked') store.revoke()
      return true
    }, () => allowed)
    await assert.rejects(result, fail(mode === 'ancestor' || mode === 'leaf' ? 'conflict' : 'stale'))
    if (mode === 'switched') assert.deepEqual(store.snapshot, other)
    else if (mode === 'revision') assert.equal(store.snapshot?.text, 'explicit intervening save')
    else if (mode === 'revoked') assert.equal(store.snapshot, null)
    else assert.deepEqual(store.snapshot, first)
  }
})

test('after an actual bounded read, revocation or a concurrent change stops adoption', async t => {
  for (const mode of ['owner', 'disk']) {
    const { path, store, first } = await fixture(t)
    await writeFile(path, 'b'.repeat(160 * 1024))
    const openFile = fs.open.bind(fs)
    let allowed = true, interfered = false
    const intercept = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await openFile(...args)
      if (args[0] !== path || args[1] !== 'r') return handle
      const read = handle.read.bind(handle)
      t.mock.method(handle, 'read', async (buffer: Buffer, offset: number, length: number, position: number) => {
        const result = await read(buffer, offset, length, position)
        if (!interfered) {
          assert.ok(result.bytesRead > 0 && result.bytesRead <= 64 * 1024); interfered = true
          if (mode === 'owner') allowed = false
          else await writeFile(path, 'changed externally')
        }
        return result
      })
      return handle
    })
    syncBuiltinESMExports()
    try {
      await assert.rejects(store.reload(draft(first), false, noDialog, () => allowed), fail(mode === 'owner' ? 'stale' : 'conflict'))
      assert.equal(interfered, true); assert.deepEqual(store.snapshot, first)
    } finally { intercept.mock.restore(); syncBuiltinESMExports() }
  }
})
