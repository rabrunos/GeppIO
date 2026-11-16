import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, readFile, rm, rename, chmod, link, mkdir, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentStore, DocumentFailure, documentFailure } from '../src/main/documents.ts'
import { DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, applyEditorText, editorText, validDocumentRequest } from '../src/shared/documents.ts'
import type { DocumentBridge, DocumentDraft, DocumentSnapshot } from '../src/shared/documents.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { widgetRegistry, initialWorkbench } from '../src/shared/workbench/model.ts'
import { FILE_EDITOR_TYPE } from '../src/shared/files-editor.ts'

async function fixture(run: (root: string, path: string, store: DocumentStore) => Promise<void>) {
  // Windows runners may spell os.tmpdir() with an 8.3 alias. Mock selection must use
  // a canonical fixture path; production link/canonical-path refusals stay intact.
  const temporary = await mkdtemp(join(tmpdir(), 'geppio-smoke-documents-')), root = await realpath(temporary), path = join(root, 'document.txt')
  if (temporary.toLowerCase() !== root.toLowerCase()) console.info('Document fixture normalized a noncanonical temporary root')
  try { await writeFile(path, '\ufeffolá 😀\r\nsecond\nlast'); await run(root, path, new DocumentStore()) } finally { await chmod(path, 0o600).catch(() => {}); await rm(root, { recursive: true, force: true }) }
}
const cancel = async () => 'cancel' as const, discard = async () => 'discard' as const
const draft = (store: DocumentStore, text = store.snapshot!.text): DocumentDraft => ({ id: store.snapshot!.id, revision: store.snapshot!.revision, text })
async function selected(store: DocumentStore, path: string) { const result = await store.select(path, null, cancel, store.guard()); assert.equal(result.ok, true); return store.snapshot! }
const failure = (kind: string) => (error: unknown) => error instanceof DocumentFailure && error.kind === kind

test('native document reads exact UTF-8/BOM/mixed EOL, saves and explicitly reopens without paths', () => fixture(async (_root, path, store) => {
  const value = await selected(store, path)
  assert.equal(value.text, 'olá 😀\r\nsecond\nlast'); assert.equal(value.bom, true)
  assert.deepEqual(Object.keys(value).sort(), ['bom', 'id', 'label', 'name', 'revision', 'text']); assert.ok(!value.label?.includes(_root))
  const next = await store.save(draft(store, 'á 😀\r\nnew\nend'), store.guard())
  assert.equal(next.id, value.id); assert.notEqual(next.revision, value.revision)
  assert.deepEqual(await readFile(path), Buffer.from('\ufeffá 😀\r\nnew\nend'))
  store.revoke(); await assert.rejects(store.save({ id: next.id, revision: next.revision, text: 'stale' }, store.guard()), failure('stale'))
  const reopen = await selected(store, path); assert.notEqual(reopen.id, value.id); assert.equal(reopen.text, next.text)
}))
test('same-size external edits and same-byte identity replacement refuse without losing bytes', () => fixture(async (root, path, store) => {
  await selected(store, path)
  const changed = Buffer.from('\ufeffolá 😀\r\nSECOND\nlast'); await writeFile(path, changed)
  await assert.rejects(store.save(draft(store, 'draft'), store.guard()), failure('conflict')); assert.deepEqual(await readFile(path), changed)
  store.revoke(); await selected(store, path)
  const replacement = join(root, 'replacement.txt'); await writeFile(replacement, changed); await rename(replacement, path)
  await assert.rejects(store.save(draft(store, 'draft'), store.guard()), failure('conflict')); assert.deepEqual(await readFile(path), changed)
}))
test('missing files, hardlinks, replaced directories and junction targets fail closed', () => fixture(async (root, path, store) => {
  await selected(store, path); await rm(path)
  await assert.rejects(store.save(draft(store, 'draft'), store.guard())); assert.ok(store.snapshot)
  await writeFile(path, 'ordinary'); store.revoke(); await selected(store, path); await link(path, join(root, 'alias.txt'))
  await assert.rejects(store.save(draft(store, 'draft'), store.guard()), failure('unsupported'))
  const a = join(root, 'a'), b = join(root, 'b'), junction = join(root, 'linked'); await mkdir(a); await mkdir(b)
  await writeFile(join(a, 'file.txt'), 'a'); await writeFile(join(b, 'file.txt'), 'b')
  await symlink(a, junction, process.platform === 'win32' ? 'junction' : 'dir')
  store.revoke(); await assert.rejects(selected(store, join(junction, 'file.txt')), failure('unsupported'))
  await selected(store, join(a, 'file.txt')); await rename(a, join(root, 'old')); await rename(b, a)
  await assert.rejects(store.save(draft(store, 'draft'), store.guard()), failure('conflict')); assert.equal(await readFile(join(a, 'file.txt'), 'utf8'), 'b')
}))
test('invalid UTF-8, binary, oversized file/draft and read-only writes preserve the selected document', () => fixture(async (root, path, store) => {
  const value = await selected(store, path)
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('a\0b'), Buffer.from([0xff, 0xfe, 0x61, 0]), Buffer.alloc(DOCUMENT_LIMIT + 1, 65)]) {
    const bad = join(root, 'bad.txt'); await writeFile(bad, bytes)
    await assert.rejects(store.select(bad, draft(store, 'dirty'), discard, store.guard()))
    assert.deepEqual(store.snapshot, value)
  }
  await assert.rejects(store.save(draft(store, 'é'.repeat(DOCUMENT_LIMIT)), store.guard()), failure('oversized'))
  await assert.rejects(store.save(draft(store, '\ud800'), store.guard()), failure('unsupported'))
  const bytes = await readFile(path); await chmod(path, 0o444)
  // Reopen confirms the read-only identity; saving must still fail without replacing it.
  store.revoke(); await selected(store, path)
  await assert.rejects(store.save(draft(store, 'dirty'), store.guard()), failure('write')); assert.deepEqual(await readFile(path), bytes)
}))
test('independent grants, duplicate activation, dirty close decisions, stale revisions and revocation', () => fixture(async (root, path, store) => {
  const original = await selected(store, path), other = join(root, 'other.ts'); await writeFile(other, 'const x = 1\n')
  const first = { id: original.id, revision: original.revision, text: 'dirty first' }
  let decisions = 0
  await store.select(other, first, async () => { decisions++; return 'save' }, store.guard())
  const second = store.snapshot!
  assert.equal(decisions, 0); assert.equal(store.snapshots.length, 2); assert.equal(await readFile(path, 'utf8'), '\ufeff' + original.text)
  await store.save(first, store.guard()); assert.equal(store.snapshot!.id, second.id); assert.equal(await readFile(other, 'utf8'), 'const x = 1\n')
  await store.select(path, draft(store), cancel, store.guard()); assert.equal(store.snapshot!.id, original.id); assert.equal(store.snapshot!.text, first.text); assert.equal(store.snapshots.length, 2)
  const canceled = await store.release(draft(store, 'kept draft'), cancel, store.guard()); assert.ok(canceled.ok && canceled.canceled); assert.equal(store.snapshots.length, 2)
  const old = draft(store); await store.save(draft(store, 'next'), store.guard()); await assert.rejects(store.save(old, store.guard()), failure('stale'))
  const guard = store.guard()
  await assert.rejects(store.release(draft(store, 'dirty'), async () => { store.revoke(); return 'discard' }, guard), failure('stale'))
  await selected(store, path)
  let count = 0
  await assert.rejects(store.save(draft(store, 'never committed'), () => ++count < 2), failure('stale'))
  assert.equal(await readFile(path, 'utf8'), '\ufeffnext')
  await store.select(other, draft(store, 'discarded'), discard, store.guard()); assert.equal(store.snapshot!.name, 'other.ts')
}))
test('all-draft close validates the complete set before writing; cancellation retains inactive grants', () => fixture(async (root, path, store) => {
  const first = await selected(store, path), other = join(root, 'other.txt'); await writeFile(other, 'second')
  await store.select(other, null, cancel, store.guard()); const second = store.snapshot!
  const drafts = [first, second].map(value => ({ id: value.id, revision: value.revision, text: 'dirty ' + value.name }))
  let decisions = 0
  const decide = async () => { decisions++; return 'save' as const }
  for (const invalid of [drafts.slice(0, 1), [drafts[0]!, drafts[0]!], [drafts[0]!, { ...drafts[1]!, revision: randomUUID() }]]) await assert.rejects(store.resolveAll(invalid, decide, store.guard()), failure('stale'))
  assert.equal(decisions, 0); assert.equal(await readFile(other, 'utf8'), 'second')
  const resolved = await store.resolveAll(drafts, async value => value.id === first.id ? 'save' : 'cancel', store.guard())
  assert.equal(resolved, false); assert.equal(store.snapshots.length, 2); assert.equal(store.snapshot!.id, second.id)
  assert.equal(await readFile(path, 'utf8'), '\ufeffdirty document.txt'); assert.equal(await readFile(other, 'utf8'), 'second')
  const updated = store.snapshots.map(value => ({ id: value.id, revision: value.revision, text: value.id === second.id ? drafts[1]!.text : value.text }))
  await writeFile(other, 'external')
  await assert.rejects(store.resolveAll(updated, async () => 'save', store.guard()), failure('conflict'))
  assert.equal(store.snapshots.length, 2); assert.equal(await readFile(other, 'utf8'), 'external')
}))
test('open-document limits are recoverable and never evict a grant or bypass duplicate identity', () => fixture(async (root, path, store) => {
  const first = await selected(store, path)
  for (let i = 1; i < DOCUMENT_SESSION_LIMITS.count; i++) { const file = join(root, `doc-${i}.txt`); await writeFile(file, 'text'); await store.select(file, null, cancel, store.guard()) }
  const extra = join(root, 'extra.txt'); await writeFile(extra, 'extra')
  await assert.rejects(store.select(extra, null, cancel, store.guard()), failure('limit'))
  assert.equal(store.snapshots.length, DOCUMENT_SESSION_LIMITS.count)
  await store.select(path, null, cancel, store.guard()); assert.equal(store.snapshot!.id, first.id)
  await store.release(draft(store), discard, store.guard()); await store.select(extra, null, cancel, store.guard())
  assert.equal(store.snapshots.length, DOCUMENT_SESSION_LIMITS.count); assert.equal(store.snapshot!.name, 'extra.txt')
}))
test('protocol accepts only exact bounded argument shapes, never paths/channels', () => {
  const value = { id: randomUUID(), revision: randomUUID(), text: '😀' }
  assert.ok(validDocumentRequest('open', [null])); assert.ok(validDocumentRequest('save', [value]))
  assert.ok(validDocumentRequest('close', [randomUUID(), value]))
  assert.ok(validDocumentRequest('activate', [value.id])); assert.ok(validDocumentRequest('close', [randomUUID(), [value]]))
  for (const args of [[], ['C:\\private.txt'], [value], [value.id, 'extra']]) assert.equal(validDocumentRequest('activate', args), false)
  for (const drafts of [[value, value], Array.from({ length: 9 }, () => ({ ...value, id: randomUUID() })), [{ ...value, path: 'C:\\private.txt' }]]) assert.equal(validDocumentRequest('close', [randomUUID(), drafts]), false)
  for (const args of [[], [value, 'extra'], [{ ...value, path: 'C:\\private.txt' }], [{ ...value, id: 'path' }], [{ ...value, text: '\ud800' }], [{ ...value, text: 'x'.repeat(DOCUMENT_LIMIT + 1) }], [null]]) assert.equal(validDocumentRequest('save', args), false)
  assert.equal(validDocumentRequest('read-path', ['C:\\private.txt']), false)
  const error = documentFailure(new Error('C:\\private\\secret.txt'))
  assert.ok(!JSON.stringify(error).includes('private'))
})
test('normalized editor text preserves unchanged mixed line endings and non-BMP text', () => {
  const raw = 'a\r\nb\nc\rd😀'; assert.equal(applyEditorText(raw, editorText(raw)), raw)
  assert.equal(applyEditorText(raw, 'a\nb!\nc\nd😀'), 'a\r\nb!\nc\rd😀')
  assert.equal(applyEditorText('a\r\nb', 'a\nb\nc'), 'a\r\nb\r\nc')
})
test('single renderer session keeps dirty draft on canceled/failed operations and locks during save', async () => {
  let disk: DocumentSnapshot = { id: randomUUID(), revision: randomUUID(), name: 'one.ts', text: 'old\r\n', bom: false }
  let canceled = false, denied = false, pending: (() => void) | undefined
  const bridge: DocumentBridge = {
    activate: async () => ({ ok: true, document: disk }),
    open: async () => ({ ok: true, document: disk, canceled }),
    save: async value => { await new Promise<void>(resolve => { pending = resolve }); if (denied) return { ok: false, code: 'write', error: 'denied' }; disk = { ...disk, revision: randomUUID(), text: value.text }; return { ok: true, document: disk } },
    release: async () => ({ ok: true, document: disk, canceled: true }), close: async () => ({ ok: true, document: disk, canceled: true }), onCloseRequested: () => () => {}
  }
  const session = new EditorSession(bridge); await session.open(); session.edit('new\n'); assert.equal(session.dirty, true)
  const id = session.snapshot().document!.id; canceled = true; await session.open(); assert.equal(session.snapshot().text, 'new\r\n'); assert.equal(session.snapshot().document!.id, id)
  const saving = session.save(); session.edit('must not replace'); pending!(); await saving; assert.equal(session.dirty, false)
  session.edit('retained'); denied = true; const failed = session.save(); pending!(); await failed; assert.equal(session.snapshot().text, 'retained'); assert.equal(session.dirty, true)
  await session.release(); await session.close(randomUUID()); assert.equal(session.snapshot().text, 'retained')
  session.locked = true; session.edit('locked'); assert.equal(session.snapshot().text, 'retained')
})
test('official essential editor is explicit, Main-only and independent of plugin SDK', () => {
  const type = widgetRegistry().get(FILE_EDITOR_TYPE)!
  assert.equal(type.owner, 'host'); assert.equal(type.presence, 'single-view'); assert.deepEqual(type.constraint.regions, ['main'])
  assert.equal(type.pluginId, undefined); assert.equal(type.widgetId, undefined)
  assert.equal(initialWorkbench().organization.views.some(view => view.typeId === FILE_EDITOR_TYPE), false)
})
