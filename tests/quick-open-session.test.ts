import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import type { DocumentBridge, DocumentResult, DocumentSnapshot } from '../src/shared/documents.ts'
import type { QuickOpenBridge, QuickOpenPage, QuickOpenResult } from '../src/shared/quick-open.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { ExplorerSession } from '../src/renderer/src/files-editor/explorer-session.ts'
import { QuickOpenSession } from '../src/renderer/src/quick-open/session.ts'
import { GitSession } from '../src/renderer/src/git/session.ts'
import type { GitResult } from '../src/shared/git.ts'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const existing: DocumentSnapshot = { id: 'document', name: 'nota.txt', revision: 'r1', text: 'salva', bom: false }
const another = { ...existing, id: 'second-document', name: 'outro.txt' }
function page(job: string, file = 'nota.txt', status: QuickOpenPage['status'] = 'complete'): QuickOpenResult {
  return { ok: true, value: { job, items: [{ id: job + '-id', file }], status, visited: 4, skipped: 1, total: 2, truncated: false } }
}
async function fixture(t: TestContext, bridge: Partial<QuickOpenBridge> = {}, navigation: Partial<DocumentBridge> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const unexpected = () => { throw new Error('unexpected native operation') }
  const editor = new EditorSession({ open: unexpected, save: unexpected, close: unexpected, activate: unexpected, release: unexpected, onCloseRequested: unexpected, ...navigation })
  let root = 'root A'
  const explorer = new ExplorerSession({
    select: async () => ({ ok: true, root: { id: root, kind: 'directory', name: 'Pasta' } }),
    list: async () => ({ ok: true, root: null, children: [] }), open: unexpected, release: unexpected
  }, editor)
  const start = t.mock.fn(bridge.start ?? (async (_root: string, query: string) => page('job', query)))
  const read = t.mock.fn(bridge.read ?? (async (job: string, query: string) => page(job, query)))
  const cancel = t.mock.fn(bridge.cancel ?? (async () => ({ ok: true as const })))
  const open = t.mock.fn(bridge.open ?? (async () => ({ ok: true as const, document: existing })))
  const session = new QuickOpenSession({ start, read, cancel, open }, explorer)
  session.connect()
  await explorer.select()
  assert.equal(session.show(), true)
  t.after(() => session.dispose())
  return { session, editor, explorer, start, read, cancel, open, async changeRoot() { root += '!'; await explorer.select() },
    async tick(ms: number) { t.mock.timers.tick(ms); await setImmediate() } }
}

test('a debounced nonempty query starts one inventory; edits coalesce even when start or filtering is pending', async t => {
  const first = deferred<QuickOpenResult>(), second = deferred<QuickOpenResult>()
  const p = await fixture(t, { start: () => first.promise, read: (job, query) => query === 'b' ? second.promise : Promise.resolve(page(job, query, 'partial')) })
  await p.tick(500); assert.equal(p.start.mock.callCount(), 0)
  p.session.setQuery('z'); await p.tick(100); p.session.setQuery('a'); await p.tick(149)
  assert.equal(p.start.mock.callCount(), 0)
  await p.tick(1); assert.deepEqual(p.start.mock.calls[0]!.arguments, ['root A', 'a'])
  p.session.setQuery('b'); await p.tick(500); assert.equal(p.start.mock.callCount(), 1)
  first.resolve(page('job', 'a')); await setImmediate()
  assert.equal(p.session.snapshot().page, null)
  await p.tick(1); assert.deepEqual(p.read.mock.calls[0]!.arguments, ['job', 'b'])
  p.session.setQuery('c'); await p.tick(500); assert.equal(p.read.mock.callCount(), 1)
  second.resolve(page('job', 'b')); await setImmediate()
  assert.equal(p.session.snapshot().page, null)
  await p.tick(1)
  assert.equal(p.session.snapshot().page?.items[0]?.file, 'c')
  assert.equal(p.session.snapshot().page?.status, 'partial')
  p.session.setQuery(''); await p.tick(600)
  assert.equal(p.session.snapshot().page, null)
  assert.equal(p.read.mock.callCount(), 2)
  p.session.setQuery('d'); await p.tick(150); assert.equal(p.start.mock.callCount(), 1)
})

test('closing and changing roots revoke late or completed inventories, including Strict replay', async t => {
  const first = deferred<QuickOpenResult>(), read = deferred<QuickOpenResult>()
  const p = await fixture(t, { start: (_root, query) => query === 'first' ? first.promise : Promise.resolve(page(query, query, query === 'running' ? 'running' : 'complete')), read: () => read.promise })
  p.session.setQuery('first'); await p.tick(150)
  p.session.dismiss(); p.session.show(); p.session.setQuery('running'); await p.tick(150)
  await p.tick(100); assert.equal(p.read.mock.callCount(), 1)
  first.resolve(page('obsolete')); await setImmediate()
  assert.deepEqual(p.cancel.mock.calls.map(call => call.arguments), [['obsolete']])
  assert.equal(p.session.snapshot().page?.job, 'running')
  await p.changeRoot()
  read.resolve(page('running', 'stale.txt')); await setImmediate()
  assert.equal(p.session.snapshot().visible, false); assert.equal(p.session.snapshot().page, null)
  assert.deepEqual(p.cancel.mock.calls.map(call => call.arguments), [['obsolete'], ['running']])
  p.session.show(); p.session.setQuery('complete'); await p.tick(150)
  p.session.dispose(); p.session.connect(); p.session.connect()
  assert.deepEqual(p.cancel.mock.calls.map(call => call.arguments), [['obsolete'], ['running'], ['complete']])
  assert.equal(p.session.snapshot().root, 'root A!'); assert.equal(p.session.snapshot().query, '')
})

test('opening the same document keeps its existing draft and cursor; refusal at the tab limit keeps the dialog and input', async t => {
  const p = await fixture(t, { open: async (job) => job === 'limit' ? { ok: false, code: 'limit', error: 'Limite de oito abas.' } : { ok: true, document: existing },
    start: async (_root, query) => page(query) })
  await p.editor.openAuthorized(async () => ({ ok: true, document: existing }))
  p.editor.edit('rascunho'); p.editor.rememberSelection({ start: 2, end: 5, top: 10, left: 0 })
  p.session.setQuery('doc'); await p.tick(150)
  assert.equal(await p.session.open('unknown'), false); assert.equal(p.open.mock.callCount(), 0)
  assert.equal(await p.session.open('doc-id'), true)
  assert.equal(p.editor.snapshot().text, 'rascunho'); assert.equal(p.editor.selection.end, 5); assert.equal(p.editor.snapshot().tabs.length, 1)
  assert.equal(p.session.snapshot().visible, false)
  p.session.show(); p.session.setQuery('limit'); await p.tick(150)
  assert.equal(await p.session.open('limit-id'), false)
  assert.equal(p.session.snapshot().visible, true); assert.equal(p.session.snapshot().query, 'limit')
  assert.equal(p.session.snapshot().error, 'Limite de oito abas.'); assert.equal(p.editor.snapshot().text, 'rascunho')
})

test('a submitted selection stays exclusive until the confirmed native activation is visible in the editor', async t => {
  const late = deferred<DocumentResult>(), p = await fixture(t, { open: () => late.promise })
  await p.editor.openAuthorized(async () => ({ ok: true, document: existing })); p.editor.edit('rascunho')
  p.session.setQuery('outro'); await p.tick(150)
  const opening = p.session.open('job-id')
  p.session.dismiss()
  p.session.setQuery('changed')
  assert.equal(p.session.snapshot().query, 'outro'); assert.equal(p.session.snapshot().visible, true)
  assert.equal(await p.session.open('job-id'), false); assert.equal(p.cancel.mock.callCount(), 0)
  assert.equal(p.session.show(), false)
  late.resolve({ ok: true, document: another, documents: [existing, another] })
  assert.equal(await opening, true)
  assert.equal(p.editor.snapshot().document?.id, another.id); assert.equal(p.editor.documentState(existing.id)?.text, 'rascunho')
  assert.deepEqual(p.editor.snapshot().tabs.map(tab => tab.document.id), [existing.id, another.id])
  assert.equal(p.session.show(), true); assert.equal(p.session.snapshot().query, '')
})

test('a first document committed while its presentation is detached remains active across Core reconnection', async t => {
  const late = deferred<DocumentResult>(), p = await fixture(t, { open: () => late.promise })
  p.session.setQuery('one'); await p.tick(150)
  const opening = p.session.open('job-id')
  p.session.detach(); p.session.dispose(); p.session.connect()
  assert.equal(p.session.snapshot().visible, false); assert.equal(p.session.show(), false)
  assert.equal(p.cancel.mock.callCount(), 0)
  late.resolve({ ok: true, document: existing, documents: [existing] })
  assert.equal(await opening, false, 'a detached dialog must not move focus')
  assert.equal(p.editor.snapshot().document?.id, existing.id)
  assert.equal(p.editor.snapshot().tabs.length, 1); assert.equal(p.cancel.mock.callCount(), 1)
  assert.equal(p.session.show(), true); assert.equal(p.session.snapshot().query, '')
})

test('a committed open reporting physical root loss restores the previous native tab inside the same editor operation', async t => {
  const late = deferred<DocumentResult>(), restored = deferred<DocumentResult>()
  let active: string | null = null
  const activate = t.mock.fn(async (id: string) => { active = id; return restored.promise })
  const p = await fixture(t, { open: async () => { active = another.id; return late.promise } }, { activate })
  await p.editor.openAuthorized(async () => ({ ok: true, document: existing })); p.editor.edit('rascunho')
  p.session.setQuery('one'); await p.tick(150)
  const opening = p.session.open('job-id')
  late.resolve({ ok: true, document: another, documents: [existing, another], invalidRoot: 'root A' })
  await setImmediate(); assert.equal(p.editor.snapshot().busy, true)
  assert.equal(await p.editor.activate(existing.id), false); assert.equal(p.editor.edit('corrida'), false)
  restored.resolve({ ok: true, document: existing })
  assert.equal(await opening, false)
  assert.equal(active, p.editor.snapshot().document?.id); assert.equal(p.editor.snapshot().text, 'rascunho')
  assert.equal(p.editor.snapshot().tabs.length, 2); assert.equal(activate.mock.callCount(), 1)
  assert.equal(p.session.show(), false)
})

test('a revoked first open releases only its newly confirmed clean grant while navigation is locked', async t => {
  const late = deferred<DocumentResult>(), released = deferred<DocumentResult>()
  let active: string | null = null
  const release = t.mock.fn<DocumentBridge['release']>(async draft => {
    assert.deepEqual(draft, { id: existing.id, revision: existing.revision, text: existing.text }); active = null; return released.promise
  })
  const p = await fixture(t, { open: async () => { active = existing.id; return late.promise } }, { release })
  p.session.setQuery('one'); await p.tick(150)
  const opening = p.session.open('job-id')
  late.resolve({ ok: true, document: existing, documents: [existing], invalidRoot: 'root A' })
  await setImmediate(); assert.equal(p.editor.snapshot().busy, true); assert.equal(p.session.show(), false)
  released.resolve({ ok: true, document: null, documents: [] }); assert.equal(await opening, false)
  assert.equal(active, null); assert.equal(p.editor.snapshot().document, null)
  assert.equal(p.editor.snapshot().tabs.length, 0); assert.equal(release.mock.callCount(), 1)
})

test('expiration drops displayed IDs; a separate editor root invalidation closes and blocks the old root', async t => {
  const p = await fixture(t, { open: async () => ({ ok: false, code: 'stale', error: 'Resultado expirado.', expired: true }) })
  p.session.setQuery('one'); await p.tick(150)
  assert.equal(await p.session.open('job-id'), false)
  assert.equal(p.session.snapshot().error, 'Resultado expirado.'); assert.equal(p.session.snapshot().page, null)
  assert.equal(await p.session.open('job-id'), false); assert.equal(p.open.mock.callCount(), 1)
  await p.editor.openAuthorized(async () => ({ ok: false, error: 'Pasta expirada.', code: 'stale', invalidRoot: 'root A' }))
  assert.equal(p.session.show(), false); assert.equal(p.session.snapshot().visible, false)
  await p.changeRoot(); assert.equal(p.session.show(), true)
  p.session.dismiss(); p.session.locked = true; assert.equal(p.session.show(), false)
})

test('a refused open reporting root loss preserves the draft without a compensating navigation request', async t => {
  const p = await fixture(t, { open: async () => ({ ok: false, code: 'stale', error: 'Pasta expirada.', invalidRoot: 'root A' }) })
  await p.editor.openAuthorized(async () => ({ ok: true, document: existing })); p.editor.edit('rascunho')
  p.session.setQuery('one'); await p.tick(150)
  assert.equal(await p.session.open('job-id'), false)
  assert.equal(p.editor.snapshot().document?.id, existing.id); assert.equal(p.editor.snapshot().text, 'rascunho')
  assert.equal(p.editor.snapshot().tabs.length, 1); assert.equal(p.session.show(), false)
})

test('passive Git status allows Quick Open while an explicit comparison or index action owns the interaction', async t => {
  const p = await fixture(t), status = deferred<GitResult>(), compare = deferred<GitResult>(), stage = deferred<GitResult>()
  const git = new GitSession({ status: () => status.promise, compare: () => compare.promise, stage: () => stage.promise, unstage: () => stage.promise }, p.explorer)
  git.connect(); t.after(() => git.dispose())
  assert.equal(git.snapshot().busy, true); assert.equal(git.snapshot().interactive, false)
  p.session.dismiss(); assert.equal(p.session.show(), true)
  status.resolve({ ok: true }); await setImmediate()
  const comparison = git.compare('change')
  assert.equal(git.snapshot().interactive, true); assert.equal(git.snapshot().comparison, null)
  compare.resolve({ ok: true, comparison: { name: 'nota.txt', original: 'a', modified: 'b', basis: 'HEAD' } }); await comparison
  assert.equal(git.snapshot().interactive, false); assert.equal(git.snapshot().comparison?.name, 'nota.txt')
  git.close(); const mutation = git.mutate('stage', 'change')
  assert.equal(git.snapshot().interactive, true); stage.resolve({ ok: true }); await mutation
  assert.equal(git.snapshot().interactive, false)
})
