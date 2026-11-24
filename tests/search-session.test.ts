import { unusedDocumentAuthoring } from './document-authoring-fixture.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { DocumentBridge, DocumentSnapshot } from '../src/shared/documents.ts'
import type { ApplyResult, ReplacementFile } from '../src/shared/search-replacement.ts'
import type { SearchBridge, SearchMatch, SearchOpenResult, SearchPage, SearchResult } from '../src/shared/search.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { ExplorerSession } from '../src/renderer/src/files-editor/explorer-session.ts'
import { SearchSession } from '../src/renderer/src/search/session.ts'

const hit: SearchMatch = { id: 'result', file: 'src/texto.txt', line: 2, column: 3, length: 4,
  snippet: '😀café', highlightStart: 2, highlightEnd: 6 }
const document: DocumentSnapshot = { id: 'document', name: 'texto.txt', revision: 'revision', bom: true, text: 'uma\r\n😀café\routra' }
function page(job: string, status: SearchPage['status'], items: SearchMatch[] = [], extra: Partial<SearchPage> = {}): SearchResult {
  return { ok: true, value: { job, status, visited: 1, files: 1, skipped: 0, bytes: 24, found: items.length,
    next: items.length, more: false, items, ...extra } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { resolve, promise }
}
async function fixture(t: TestContext, bridge: Partial<SearchBridge> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const unexpected = () => { throw new Error('unexpected native operation') }
  const documentBridge: DocumentBridge = { ...unusedDocumentAuthoring, open: unexpected, reload: unexpected, save: unexpected, release: unexpected, close: unexpected,
    onCloseRequested: unexpected, activate: async () => ({ ok: true, document }) }
  const editor = new EditorSession(documentBridge)
  let rootId = 'first root'
  const explorer = new ExplorerSession({
    createFile: unexpected, renameFile: unexpected, createDirectory: unexpected,
    select: async () => ({ ok: true, root: { kind: 'directory', name: 'projeto', id: rootId } }),
    list: async () => ({ ok: true, root: null, children: [] }), open: unexpected, release: unexpected
  }, editor)
  const start = t.mock.fn(bridge.start ?? (async () => page('job', 'complete', [hit])))
  const read = t.mock.fn(bridge.read ?? unexpected)
  const cancel = t.mock.fn(bridge.cancel ?? (async (job: string) => page(job, 'canceled')))
  const open = t.mock.fn(bridge.open ?? (async () => ({ ok: true, document, matchesSnapshot: true } as const)))
  const reveal = t.mock.fn((_id: string, _match: SearchMatch) => true)
  const search = new SearchSession({ start, read, cancel, open, preview: bridge.preview ?? unexpected, applyFile: bridge.applyFile ?? unexpected }, explorer, reveal)
  search.connect()
  await explorer.select()
  t.after(() => search.dispose())
  return { search, editor, start, read, open, cancel, reveal,
    async switchRoot() { rootId = 'second root'; await explorer.select() },
    async tick(ms: number) { t.mock.timers.tick(ms); await setImmediate() }
  }
}

for (const interrupt of ['edit', 'cancel'] as const) test('a batch preserves its confirmed prefix on ' + interrupt + ' during an earlier write', async t => {
  const entered = deferred<void>(), finish = deferred<ApplyResult>(), calls: string[] = []
  const files: ReplacementFile[] = [
    { id: 'first', file: 'first.txt', matches: 1, open: null },
    { id: 'second', file: 'texto.txt', matches: 1, open: { id: document.id, revision: document.revision } },
    { id: 'third', file: 'remaining.txt', matches: 1, open: null }
  ]
  const p = await fixture(t, {
    preview: async () => ({ ok: true, preview: { id: 'plan', partial: true, files } }),
    applyFile: async (_job, _preview, id) => { calls.push(id); entered.resolve(); return finish.promise }
  })
  await p.editor.openAuthorized(async () => ({ ok: true, document }))
  p.search.setQuery('café'); await p.search.start(); p.search.selectAll(true); await p.search.prepare()
  const applying = p.search.apply(); await entered.promise
  if (interrupt === 'edit') assert.ok(p.editor.editExact('novo rascunho', document.id))
  else p.search.cancelReplacement()
  finish.resolve({ ok: true, document: null, notice: 'Sessão lembrada indisponível.' })
  await applying
  assert.deepEqual(calls, ['first'])
  const outcomes = p.search.snapshot().outcomes
  assert.match(outcomes.get('first')!, /Confirmado.*lembrada/)
  assert.match(outcomes.get('second')!, interrupt === 'edit' ? /Recusado/ : /Não executado/)
  assert.equal(outcomes.get('third'), 'Não executado')
  if (interrupt === 'edit') assert.equal(p.editor.documentState(document.id)?.text, 'novo rascunho')
})

test('an uncertain replacement keeps the original model for explicit reconciliation', async t => {
  const p = await fixture(t)
  await p.editor.openAuthorized(async () => ({ ok: true, document }))
  const binding = { id: document.id, revision: document.revision }
  const result = await p.editor.applyReplacement(binding, async () => {
    assert.equal(p.editor.editExact('concurrent change', document.id), false)
    throw new Error('lost receipt')
  })
  assert.ok(!result.ok && result.uncertain)
  assert.equal(p.editor.documentState(document.id)?.text, document.text)
  assert.equal(p.editor.replacementMarks()[0]?.clean, false)
  assert.equal(await p.editor.save(), false)
  assert.ok(p.editor.drafts()[0]?.discardOnly)
})

test('only an explicit search scans; changing controls or unmounting a panel retains the submitted job and its pages', async t => {
  const next = { ...hit, id: 'second', line: 3 }
  const p = await fixture(t, {
    start: async () => page('job', 'running', [hit]),
    read: async () => page('job', 'partial', [next], { found: 2, next: 2, reason: 'Limite de entradas.', skipped: 1 })
  })
  p.search.setQuery('café')
  p.search.setMatchCase(true)
  await p.tick(100)
  assert.equal(p.start.mock.callCount(), 0)
  const unmount = p.search.subscribe(() => {})
  await p.search.start()
  assert.deepEqual(p.start.mock.calls[0]!.arguments, ['first root', 'café', true])
  unmount()
  p.search.setQuery('outro')
  p.search.setMatchCase(false)
  await p.tick(100)
  assert.deepEqual(p.read.mock.calls[0]!.arguments, ['job', 1])
  const state = p.search.snapshot()
  assert.equal(state.submitted, 'café')
  assert.equal(state.query, 'outro')
  assert.equal(state.status, 'partial')
  assert.equal(state.page?.skipped, 1)
  assert.deepEqual(state.matches, [hit, next])
  await p.tick(600)
  assert.equal(p.read.mock.callCount(), 1)
  assert.equal(p.start.mock.callCount(), 1)
})

test('new explicit search and root replacement discard delayed jobs and reads', async t => {
  const old = deferred<SearchResult>(), delayed = deferred<SearchResult>()
  const p = await fixture(t, {
    start: async (_root, query) => query === 'old' ? old.promise : page('new job', 'running', [hit]),
    read: () => delayed.promise
  })
  p.search.setQuery('old')
  const first = p.search.start()
  p.search.setQuery('new')
  await p.search.start()
  old.resolve(page('old job', 'running'))
  await first
  assert.deepEqual(p.search.snapshot().matches, [hit])
  assert.deepEqual(p.cancel.mock.calls[0]!.arguments, ['old job'])
  await p.tick(100)
  await p.switchRoot()
  delayed.resolve(page('new job', 'complete', [hit]))
  await setImmediate()
  assert.deepEqual(p.search.snapshot().matches, [])
  assert.equal(p.search.snapshot().status, 'idle')
  assert.equal(p.search.snapshot().query, 'new')
  assert.deepEqual(p.cancel.mock.calls[1]!.arguments, ['new job'])
  await p.search.open(hit.id)
  assert.equal(p.open.mock.callCount(), 0)
  assert.equal(p.start.mock.callCount(), 2)
})

test('cancel during the first request reaches the eventual job and supersedes an outstanding read', async t => {
  const delayed = deferred<SearchResult>(), latePage = deferred<SearchResult>()
  const p = await fixture(t, {
    start: async (_root, query) => query === 'first' ? delayed.promise : page('second', 'running', [hit]),
    read: () => latePage.promise,
    cancel: async job => page(job, 'canceled', [hit])
  })
  p.search.setQuery('first')
  const first = p.search.start()
  await p.search.cancel()
  assert.equal(p.search.snapshot().status, 'canceling')
  delayed.resolve(page('first', 'running'))
  await first
  assert.equal(p.search.snapshot().status, 'canceled')
  p.search.setQuery('second')
  await p.search.start()
  await p.tick(100)
  await p.search.cancel()
  latePage.resolve(page('second', 'complete', [{ ...hit, id: 'late' }]))
  await setImmediate()
  assert.equal(p.search.snapshot().status, 'canceled')
  assert.deepEqual(p.search.snapshot().matches, [hit])
  assert.deepEqual(p.cancel.mock.calls.map(call => call.arguments), [['first'], ['second']])
})

test('switching presentations while cancel awaits its reply keeps stale reads and old-root results out of the new panel', async t => {
  const progress = deferred<SearchResult>(), canceled = deferred<SearchResult>()
  const p = await fixture(t, {
    start: async () => page('job', 'running', [hit]),
    read: () => progress.promise,
    cancel: () => canceled.promise
  })
  const unmount = p.search.subscribe(() => {})
  p.search.setQuery('café')
  await p.search.start()
  await p.tick(100)
  assert.equal(p.read.mock.callCount(), 1)
  unmount()
  const cancel = p.search.cancel()
  const updates: string[] = []
  const unsubscribe = p.search.subscribe(() => updates.push(p.search.snapshot().status))
  assert.equal(p.search.snapshot().status, 'canceling')
  assert.equal(p.search.canCancel, false)
  progress.resolve(page('job', 'complete', [{ ...hit, id: 'late' }]))
  await p.tick(100)
  assert.deepEqual(updates, [])
  assert.deepEqual(p.search.snapshot().matches, [hit])
  await p.switchRoot()
  canceled.resolve(page('job', 'canceled', [hit]))
  await cancel
  await p.tick(200)
  assert.equal(p.search.snapshot().root, 'second root')
  assert.equal(p.search.snapshot().query, 'café')
  assert.equal(p.search.snapshot().status, 'idle')
  assert.deepEqual(p.search.snapshot().matches, [])
  assert.equal(p.start.mock.callCount(), 1)
  unsubscribe()
})

test('opening uses only opaque IDs and reveals UTF-16 coordinates only for the same confirmed editor snapshot', async t => {
  let matchesSnapshot = true
  const p = await fixture(t, { open: async () => ({ ok: true, document, matchesSnapshot }) })
  p.search.setQuery('café')
  await p.search.start()
  await p.search.open(hit.id)
  assert.deepEqual(p.open.mock.calls[0]!.arguments, ['job', hit.id])
  assert.deepEqual(p.reveal.mock.calls[0]!.arguments, [document.id, hit])
  assert.equal(p.editor.snapshot().text, document.text)
  assert.equal(p.editor.editExact('um rascunho'), true)
  p.editor.rememberSelection({ start: 2, end: 4, top: 30, left: 4 })
  await p.search.open(hit.id)
  assert.equal(p.editor.snapshot().tabs.length, 1)
  assert.equal(p.editor.snapshot().text, 'um rascunho')
  assert.deepEqual(p.editor.selection, { start: 2, end: 4, top: 30, left: 4 })
  assert.match(p.search.snapshot().feedback!, /disco/)
  assert.equal(p.editor.editExact(document.text), true)
  matchesSnapshot = false
  await p.search.open(hit.id)
  assert.equal(p.reveal.mock.callCount(), 1)
  assert.equal(p.editor.snapshot().text, document.text)
  assert.match(p.search.snapshot().feedback!, /disco/)
})

test('cancel keeps results already shown across pages and finishes reading its retained tail', async t => {
  const second = { ...hit, id: 'second' }, last = { ...hit, id: 'last' }
  const p = await fixture(t, {
    start: async () => page('job', 'running', [hit], { found: 2, more: true }),
    read: async (job, offset) => offset === 1 ? page(job, 'running', [second], { next: 2, found: 2 })
      : page(job, 'canceled', [last], { next: 3, found: 3 }),
    cancel: async job => page(job, 'canceled', [hit], { found: 3, more: true })
  })
  p.search.setQuery('uma')
  await p.search.start()
  await p.tick(1)
  assert.deepEqual(p.search.snapshot().matches, [hit, second])
  await p.search.cancel()
  assert.deepEqual(p.search.snapshot().matches, [hit, second])
  await p.tick(1)
  assert.deepEqual(p.read.mock.calls.map(call => call.arguments), [['job', 1], ['job', 2]])
  assert.deepEqual(p.search.snapshot().matches, [hit, second, last])
  assert.equal(p.search.snapshot().status, 'canceled')
})

test('a failed progress request retains partial results and the user can still cancel native work', async t => {
  const p = await fixture(t, {
    start: async () => page('job', 'running', [hit]),
    read: async () => { throw new Error('connection lost') },
    cancel: async job => page(job, 'canceled', [hit])
  })
  p.search.setQuery('uma')
  await p.search.start()
  await p.tick(100)
  assert.equal(p.search.snapshot().status, 'failed')
  assert.deepEqual(p.search.snapshot().matches, [hit])
  assert.equal(p.search.canCancel, true)
  await p.search.cancel()
  assert.equal(p.search.snapshot().status, 'canceled')
  assert.deepEqual(p.search.snapshot().matches, [hit])
})

test('a refusal to open preserves the existing grant and draft, and a late authorized grant does not take focus', async t => {
  const delayed = deferred<SearchOpenResult>()
  let late = false
  const p = await fixture(t, { open: async () => late ? delayed.promise : { ok: false, code: 'limit', error: 'Limite de oito documentos.' } })
  await p.editor.openAuthorized(async () => ({ ok: true, document }))
  p.editor.editExact('rascunho')
  p.search.setQuery('texto')
  await p.search.start()
  await p.search.open(hit.id)
  assert.match(p.search.snapshot().feedback!, /oito documentos/)
  assert.equal(p.editor.snapshot().text, 'rascunho')
  late = true
  const opening = p.search.open(hit.id)
  p.search.setQuery('nova')
  await p.search.start()
  delayed.resolve({ ok: true, document: { ...document, id: 'outra aba' }, matchesSnapshot: true })
  await opening
  assert.equal(p.search.snapshot().feedback, null)
  assert.equal(p.editor.snapshot().document?.id, document.id)
  assert.equal(p.editor.snapshot().text, 'rascunho')
  assert.equal(p.reveal.mock.callCount(), 0)
})

test('root invalidation in a result-open reply retains the independent grant without revealing the expired range', async t => {
  const p = await fixture(t, { open: async () => ({ ok: true, document, matchesSnapshot: true, invalidRoot: 'first root' }) })
  p.search.setQuery('café')
  await p.search.start()
  await p.search.open(hit.id)
  assert.equal(p.editor.snapshot().document?.id, document.id)
  assert.equal(p.reveal.mock.callCount(), 0)
  assert.equal(p.search.snapshot().root, null)
  assert.deepEqual(p.search.snapshot().matches, [])
  assert.match(p.search.snapshot().feedback!, /pasta novamente/)
})

test('a root invalidated by another document operation stays unavailable until Explorer supplies a fresh token', async t => {
  const p = await fixture(t)
  p.search.setQuery('café')
  await p.search.start()
  await p.editor.openAuthorized(async () => ({ ok: true, document, invalidRoot: 'first root' }))
  assert.equal(p.search.snapshot().root, null)
  assert.deepEqual(p.search.snapshot().matches, [])
  await p.editor.activate(document.id)
  assert.equal(p.editor.snapshot().invalidRoot, null)
  await p.search.start()
  assert.equal(p.start.mock.callCount(), 1)
  await p.switchRoot()
  assert.equal(p.search.snapshot().root, 'second root')
  assert.equal(p.start.mock.callCount(), 1)
  await p.search.start()
  assert.equal(p.start.mock.callCount(), 2)
})

for (const operation of ['read', 'open'] as const) {
  test(`confirmed job expiry during ${operation} clears stale matches and preserves independent grants and drafts`, async t => {
    const failure = { ok: false, code: 'stale', error: 'Busca expirada.', expired: true } as const
    const p = await fixture(t, { start: async () => page('old job', 'running', [hit]),
      read: async () => failure, open: async () => failure })
    await p.editor.openAuthorized(async () => ({ ok: true, document }))
    p.editor.editExact('rascunho ainda aberto')
    p.search.setQuery('café')
    await p.search.start()
    if (operation === 'open') await p.search.open(hit.id)
    else await p.tick(100)
    assert.deepEqual(p.search.snapshot().matches, [])
    assert.equal(p.search.snapshot().page, null)
    assert.match(p.search.snapshot().feedback!, /expirada/)
    assert.equal(p.search.snapshot().query, 'café')
    assert.equal(p.editor.snapshot().document?.id, document.id)
    assert.equal(p.editor.snapshot().text, 'rascunho ainda aberto')
    assert.equal(p.reveal.mock.callCount(), 0)
    await p.tick(500)
    assert.equal(p.read.mock.callCount(), operation === 'open' ? 0 : 1)
  })
}
