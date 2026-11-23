import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { DocumentStore } from '../src/main/documents.ts'
import type { DocumentDestinationUI } from '../src/main/documents.ts'
import { DOCUMENT_LIMIT, validDocumentRequest } from '../src/shared/documents.ts'

const current = () => true
async function fixture(t: TestContext, replace?: (source: string, target: string) => Promise<void>) {
  const temp = await mkdtemp(join(tmpdir(), 'geppio-smoke-document-create-')), root = await realpath(temp)
  t.after(() => rm(temp, { recursive: true, force: true, maxRetries: 4 }))
  const path = join(root, 'document.txt'), ui: DocumentDestinationUI = {
    select: async () => path, confirmOverwrite: async () => true, reconcile: async () => false, permitted: () => true
  }
  const store = new DocumentStore(replace, ui)
  const draft = (text: string) => { const { id, revision } = store.snapshot!; return { id, revision, text } }
  return { root, path, ui, store, draft }
}

test('untitled grants have no filesystem authority, count toward count and byte caps, and cancel without adopting a destination', async t => {
  const { store, path, ui, draft } = await fixture(t)
  store.create()
  const initial = store.snapshot!, text = 'rascunho\r\n'
  assert.equal(initial.untitled, true); assert.equal(store.filePath(initial.id), null)
  assert.equal(store.fingerprint(initial.id), null)
  await assert.rejects(store.saveAs(draft('α'.repeat(DOCUMENT_LIMIT)), false, current), { kind: 'oversized' })
  ui.select = async () => null
  assert.equal(await store.saveDocument(draft(text), current), null)
  assert.equal(store.writeCount, 0)
  assert.deepEqual(store.snapshot, initial); await assert.rejects(lstat(path), { code: 'ENOENT' })
  ui.select = async () => path
  const persisted = await store.saveDocument(draft(text), current)
  assert.equal(store.writeCount, 1)
  assert.equal(persisted?.id, initial.id); assert.ok(!persisted?.untitled); assert.equal(await readFile(path, 'utf8'), text)
  for (let count = 1; count < 8; count++) store.create()
  assert.throws(() => store.create(), { kind: 'limit' }); assert.equal(store.snapshots.length, 8)
  assert.equal(validDocumentRequest('create', [path]), false)
  assert.equal(validDocumentRequest('saveAs', [draft(text), path]), false)
  assert.equal(validDocumentRequest('saveAll', [[draft(text), draft(text)]]), false)
})

test('Save As independently confirms the observed destination, preserves BOM/mixed EOL and refuses other open files or changed bytes', async t => {
  const { store, root, path, ui, draft } = await fixture(t)
  const first = join(root, 'first.js'), other = join(root, 'held.txt'), base = '\ufeffconst x = 1\r\n// fim\n'
  await writeFile(first, base); await writeFile(other, 'other'); await writeFile(path, 'existing')
  await store.select(other, null, async () => 'cancel', current); await store.select(first, null, async () => 'cancel', current)
  const original = store.snapshot!, modified = draft(original.text + 'fim\r')
  ui.select = async () => other
  await assert.rejects(store.saveAs(modified, false, current), { kind: 'conflict' }); assert.equal(await readFile(other, 'utf8'), 'other')
  const movedOther = join(root, 'moved.txt')
  await rename(other, movedOther); ui.select = async () => movedOther
  await assert.rejects(store.saveAs(modified, false, current), { kind: 'conflict' })
  assert.equal(await readFile(movedOther, 'utf8'), 'other')
  ui.select = async () => path; ui.confirmOverwrite = async () => false
  assert.equal(await store.saveAs(modified, false, current), null); assert.equal(await readFile(path, 'utf8'), 'existing')
  ui.confirmOverwrite = async () => { await writeFile(path, 'changed while considering'); return true }
  await assert.rejects(store.saveAs(modified, false, current), { kind: 'conflict' })
  assert.deepEqual(store.snapshot, original); assert.equal(await readFile(path, 'utf8'), 'changed while considering')
  ui.confirmOverwrite = async () => true
  const result = await store.saveAs(modified, false, current)
  assert.equal(result?.id, original.id); assert.equal(store.filePath(original.id), path)
  assert.equal(await readFile(path, 'utf8'), '\ufeff' + modified.text); assert.equal(await readFile(first, 'utf8'), base)
  await assert.rejects(store.save(modified, current), { kind: 'stale' })
})

test('a literal leading U+FEFF in an untitled draft stays one UTF-8 mark after subsequent saves', async t => {
  const { store, path, draft } = await fixture(t)
  store.create(); await store.saveDocument(draft('\ufeffum'), current)
  await store.save(draft('\ufeffdois'), current)
  assert.deepEqual(await readFile(path), Buffer.from('\ufeffdois'))
})

test('a replaced ancestor during overwrite confirmation cannot authorize a write', async t => {
  const { store, root, ui, draft } = await fixture(t), directory = join(root, 'folder'), target = join(directory, 'target.txt')
  await mkdir(directory); await writeFile(target, 'base'); store.create()
  ui.select = async () => target
  ui.confirmOverwrite = async () => { await rename(directory, directory + '.old'); await mkdir(directory); await writeFile(target, 'replacement'); return true }
  await assert.rejects(store.saveAs(draft('draft'), false, current), { kind: 'conflict' })
  assert.equal(await readFile(target, 'utf8'), 'replacement'); assert.equal(await readFile(join(directory + '.old', 'target.txt'), 'utf8'), 'base')
  assert.ok(store.snapshot?.untitled)
})

test('a lost acknowledgment of overwrite retains the old binding and requires explicit reconciliation', async t => {
  const { store, root, path, ui, draft } = await fixture(t, async (from, to) => { await rename(from, to); throw new Error('lost acknowledgment') })
  const first = join(root, 'first'), recovered = join(root, 'recovered.txt')
  await writeFile(first, 'source'); await writeFile(path, 'previous'); await store.select(first, null, async () => 'cancel', current)
  const edited = draft('unsaved')
  await assert.rejects(store.saveAs(edited, false, current), { kind: 'unconfirmed' })
  assert.equal(store.filePath(edited.id), first); assert.equal(await readFile(first, 'utf8'), 'source'); assert.equal(await readFile(path, 'utf8'), edited.text)
  await assert.rejects(store.save(edited, current), { kind: 'unconfirmed' })
  assert.equal(store.writeCount, 1)
  await assert.rejects(store.reload(edited, false, async () => true, current), { kind: 'unconfirmed' })
  assert.equal(await store.saveAs(edited, true, current), null); assert.equal(store.filePath(edited.id), first)
  ui.select = async () => recovered; ui.reconcile = async () => true
  await store.saveAs(edited, true, current); assert.equal(store.filePath(edited.id), recovered)
  assert.equal(await readFile(recovered, 'utf8'), 'unsaved')
})

test('Save All follows document order and reports the successful prefix, cancellation and untouched suffix', async t => {
  const { store, root, path, ui } = await fixture(t)
  const later = join(root, 'later'), clean = join(root, 'clean')
  await writeFile(clean, 'clean'); await writeFile(path, 'before'); await writeFile(later, 'unchanged')
  await store.select(clean, null, async () => 'cancel', current); await store.select(path, null, async () => 'cancel', current)
  store.create(); await store.select(later, null, async () => 'cancel', current)
  const drafts = store.snapshots.map(({ id, revision, text }, index) => ({ id, revision, text: index === 0 ? text : 'draft ' + index }))
  ui.select = async () => null
  const receipt = await store.saveAll([...drafts].reverse(), current)
  assert.ok(receipt.ok && receipt.canceled)
  assert.deepEqual(receipt.saves?.map(entry => entry.status), ['clean', 'saved', 'canceled', 'pending'])
  assert.equal(await readFile(path, 'utf8'), 'draft 1'); assert.equal(await readFile(later, 'utf8'), 'unchanged')
  assert.equal(store.snapshot?.id, drafts[3]!.id); assert.equal(receipt.documents?.[1]?.text, 'draft 1')
  ui.select = async () => join(root, 'new.txt')
  const next = store.snapshots.map(({ id, revision, text }, index) => ({ id, revision, text: index === 1 ? 'second pass' : index === 2 ? '\f' : text }))
  const failed = await store.saveAll(next, current)
  assert.deepEqual(failed.saves?.map(entry => entry.status), ['clean', 'saved', 'failed', 'pending'])
  assert.equal(await readFile(path, 'utf8'), 'second pass')
  assert.equal(await readFile(later, 'utf8'), 'unchanged')
})

test('closing in native order permits discarding an incompatible draft after saving an earlier document', async t => {
  const { store, path } = await fixture(t)
  await writeFile(path, 'base')
  await store.select(path, null, async () => 'cancel', current)
  store.create()
  const drafts = store.snapshots.map(({ id, revision, untitled }) => ({ id, revision, text: untitled ? '\f' : 'confirmado' }))
  const choices: string[] = []
  assert.ok(await store.resolveAll([...drafts].reverse(), async doc => {
    choices.push(doc.id)
    return doc.untitled ? 'discard' : 'save'
  }, current))
  assert.deepEqual(choices, drafts.map(draft => draft.id))
  assert.equal(store.writeCount, 1)
  assert.equal(await readFile(path, 'utf8'), 'confirmado')
})
