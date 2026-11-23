import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import type { GitBridge, GitHistoryCommit, GitHistoryPage, GitResult } from '../src/shared/git.ts'
import { GIT_HISTORY_LIMITS } from '../src/shared/git.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { ExplorerSession } from '../src/renderer/src/files-editor/explorer-session.ts'
import { GitSession } from '../src/renderer/src/git/session.ts'

const unexpected = (): never => { throw new Error('Unexpected native operation') }
const summary = (id: string) => ({ id, hash: 'c01dc0de', author: 'Autor <nome>', date: '2026-11-23', subject: 'Alterou <arquivo> & texto' })
const page = (ids: string[], snapshot = 'snapshot', cursor: string | null = null): GitHistoryPage =>
  ({ snapshot, cursor, commits: ids.map(summary), detached: false, unborn: !ids.length, limited: false })
const detail: GitHistoryCommit = { ...summary('first'), parents: ['pai-principal', 'outro-pai'], message: 'linha 1\n<script>exemplo</script>', files: [{ id: 'blob-pair', name: '<file>.md', status: 'A' }] }
const comparison = { name: '<file>.md', original: 'pai', modified: 'commit', basis: 'Primeiro pai' }
function deferred<T>() {
  let resolve!: (result: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture(t: TestContext, overrides: Partial<GitBridge> = {}) {
  const document = { id: 'tab', revision: 'revision', name: 'standalone.txt', bom: false, text: 'disco' }
  const editor = new EditorSession({ open: async () => ({ ok: true, document }), activate: async () => ({ ok: true, document }), save: unexpected,
    reload: unexpected, release: unexpected, close: unexpected, onCloseRequested: unexpected })
  await editor.open(); editor.edit('rascunho mantido')
  let selected = 'project'
  const explorer = new ExplorerSession({ select: async () => ({ ok: true, root: { id: selected, name: selected, kind: 'directory' } }),
    list: async () => ({ ok: true, root: null, children: [] }), release: async () => ({ ok: true, root: null }), open: unexpected,
    createFile: unexpected, createDirectory: unexpected, renameFile: unexpected }, editor)
  await explorer.select()
  const status = t.mock.fn<GitBridge['status']>(overrides.status ?? (async root => ({ ok: true, status: { root, name: 'repository', branch: 'main', detached: false, changes: [] } })))
  const history = t.mock.fn<GitBridge['history']>(overrides.history ?? (async () => ({ ok: true, history: page(['first'], 'snapshot', 'cursor-token') })))
  const historyPage = t.mock.fn<GitBridge['historyPage']>(overrides.historyPage ?? (async () => ({ ok: true, history: page(['second']) })))
  const historyCommit = t.mock.fn<GitBridge['historyCommit']>(overrides.historyCommit ?? (async () => ({ ok: true, commit: detail })))
  const historyCompare = t.mock.fn<GitBridge['historyCompare']>(overrides.historyCompare ?? (async () => ({ ok: true, comparison })))
  const stage = t.mock.fn<GitBridge['stage']>(overrides.stage ?? unexpected), unstage = t.mock.fn<GitBridge['unstage']>(overrides.unstage ?? unexpected)
  const git = new GitSession({ status, compare: unexpected, stage, unstage, history, historyPage, historyCommit, historyCompare }, explorer)
  git.connect(); await setImmediate()
  t.after(() => { git.dispose(); explorer.dispose() })
  return { git, editor, explorer, status, stage, unstage, history, historyPage, historyCommit, historyCompare, setRoot: async (root: string) => { selected = root; await explorer.select() } }
}

test('all presentations borrow one pinned history; reads send opaque IDs and retain Changes, editor and mutation authority', async t => {
  const f = await fixture(t), changes = f.git.snapshot().status
  assert.equal(f.history.mock.callCount(), 0)
  await f.git.setMode('history'); await f.git.setMode('history')
  assert.deepEqual(f.history.mock.calls[0]!.arguments, ['project']); assert.equal(f.history.mock.callCount(), 1)
  await f.git.moreHistory()
  assert.deepEqual(f.historyPage.mock.calls[0]!.arguments, ['project', 'snapshot', 'cursor-token'])
  assert.deepEqual(f.git.snapshot().history?.commits.map(item => item.id), ['first', 'second'])
  await f.git.selectCommit('c01dc0de'); assert.equal(f.historyCommit.mock.callCount(), 0)
  await f.git.selectCommit('first')
  assert.deepEqual(f.historyCommit.mock.calls[0]!.arguments, ['project', 'snapshot', 'first'])
  assert.equal(f.git.snapshot().commit?.message, detail.message)
  await f.git.compare(detail.files[0]!.name); assert.equal(f.historyCompare.mock.callCount(), 0)
  await f.git.compare('blob-pair')
  assert.deepEqual(f.historyCompare.mock.calls[0]!.arguments, ['project', 'snapshot', 'first', 'blob-pair'])
  assert.deepEqual(f.git.snapshot().comparison, comparison); f.git.close()
  await f.git.mutate('stage', 'real-change'); await f.git.mutate('unstage', 'blob-pair')
  await f.git.setMode('changes'); await f.git.mutate('stage', 'first'); await f.git.mutate('stage', 'blob-pair')
  assert.equal(f.stage.mock.callCount(), 0); assert.equal(f.unstage.mock.callCount(), 0)
  assert.equal(f.git.snapshot().status, changes); assert.equal(f.status.mock.callCount(), 1)
  assert.equal(f.editor.snapshot().text, 'rascunho mantido'); assert.ok(f.editor.dirty)
  await f.git.setMode('history'); assert.equal(f.git.snapshot().commit, detail); assert.equal(f.history.mock.callCount(), 1)
})

test('an index outcome remains unresolved across browsing, history refresh, unsupported blobs and return to Changes', async t => {
  const f = await fixture(t, { stage: async () => ({ ok: false, code: 'uncertain', error: 'Resultado do índice incerto.' }),
    historyCompare: async () => ({ ok: false, code: 'unsupported', error: 'O arquivo é binário.' }) })
  await f.git.mutate('stage', 'real-change')
  await f.git.setMode('history'); await f.git.refreshHistory(); await f.git.selectCommit('first'); await f.git.compare('blob-pair')
  assert.equal(f.git.snapshot().historyError, 'O arquivo é binário.'); assert.equal(f.git.snapshot().comparison, null)
  assert.equal(f.git.snapshot().commit, detail); assert.equal(f.git.snapshot().error, 'Resultado do índice incerto.')
  assert.ok(f.git.indexNeedsRefresh); assert.equal(f.git.snapshot().code, 'uncertain')
  await f.git.setMode('changes'); await f.git.mutate('stage', 'real-change')
  assert.equal(f.stage.mock.callCount(), 1); assert.equal(f.status.mock.callCount(), 1)
  await f.git.refresh(); assert.equal(f.git.indexNeedsRefresh, false); assert.equal(f.status.mock.callCount(), 2)
})

test('first history request survives a passive status query and deduplicates repeated entry', async t => {
  const passive = deferred<GitResult>(), f = await fixture(t, { status: () => passive.promise })
  await f.git.setMode('history'); await f.git.setMode('history')
  assert.equal(f.history.mock.callCount(), 0)
  passive.resolve({ ok: true }); await setImmediate()
  assert.equal(f.history.mock.callCount(), 1); assert.equal(f.git.snapshot().history?.snapshot, 'snapshot')
})

test('changed HEAD, mixed pages and corrupt data never masquerade as an empty or merged history', async t => {
  for (const mismatch of [true, false]) {
    const f = await fixture(t, { historyPage: async () => mismatch ? { ok: true, history: page(['other-head'], 'other-snapshot') } : { ok: false, code: 'stale', error: 'O HEAD mudou.' } })
    await f.git.setMode('history'); await f.git.selectCommit('first'); await f.git.moreHistory()
    assert.equal(f.git.snapshot().history, null); assert.equal(f.git.snapshot().commit, null)
    assert.ok(f.git.snapshot().historyError); assert.equal(f.history.mock.callCount(), 1)
    await f.git.refreshHistory(); assert.equal(f.history.mock.callCount(), 2)
  }
  const f = await fixture(t, { history: async () => ({ ok: false, code: 'unsupported', error: 'Objeto inválido.' }) })
  await f.git.setMode('history')
  assert.equal(f.git.snapshot().history, null); assert.equal(f.git.snapshot().historyError, 'Objeto inválido.')
})

test('late history pages, details or historical diffs cannot publish against a replaced project or an expired root', async t => {
  for (const operation of ['page', 'commit', 'compare'] as const) {
    const delayed = deferred<GitResult>()
    const f = await fixture(t, { [operation === 'page' ? 'historyPage' : operation === 'commit' ? 'historyCommit' : 'historyCompare']: () => delayed.promise })
    await f.git.setMode('history')
    if (operation === 'compare') await f.git.selectCommit('first')
    const reading = operation === 'page' ? f.git.moreHistory() : operation === 'commit' ? f.git.selectCommit('first') : f.git.compare('blob-pair')
    assert.equal(f.git.snapshot().interactive, operation === 'compare')
    await f.setRoot('another')
    delayed.resolve({ ok: true, history: page(['stale']), commit: detail, comparison }); await reading
    assert.equal(f.git.snapshot().history, null); assert.equal(f.git.snapshot().commit, null); assert.equal(f.git.snapshot().comparison, null)
    assert.equal(f.git.snapshot().root, 'another')
  }
  const f = await fixture(t)
  await f.git.setMode('history')
  await f.editor.openAuthorized(async () => ({ ok: false, code: 'stale', error: 'Raiz expirada.', invalidRoot: 'project' }))
  assert.equal(f.git.snapshot().history, null); await f.git.refreshHistory(); assert.equal(f.history.mock.callCount(), 1)
})

test('retained projections enforce page, commit count and total byte bounds with explicit errors', async t => {
  const excessive = await fixture(t, { history: async () => ({ ok: true, history: page(Array.from({ length: GIT_HISTORY_LIMITS.page + 1 }, (_, i) => String(i))) }) })
  await excessive.git.setMode('history'); assert.equal(excessive.git.snapshot().history, null); assert.match(excessive.git.snapshot().historyError!, /limite/)
  let count = 0
  const batch = (subject: string) => ({ ...page([], 'bounded', 'next-' + count), unborn: false, commits: Array.from({ length: GIT_HISTORY_LIMITS.page }, () => ({ ...summary('commit-' + count++), subject })) })
  for (const subject of ['short', 'ß'.repeat(5000)]) {
    const f = await fixture(t, { history: async () => ({ ok: true, history: batch(subject) }), historyPage: async () => ({ ok: true, history: batch(subject) }) })
    await f.git.setMode('history')
    for (let i = 0; i < 10 && f.git.snapshot().history?.cursor; i++) await f.git.moreHistory()
    const retained = f.git.snapshot().history!
    assert.ok(retained.limited); assert.equal(retained.cursor, null); assert.match(f.git.snapshot().historyError!, /limite/)
    assert.ok(retained.commits.length <= GIT_HISTORY_LIMITS.commits)
    assert.ok(Buffer.byteLength(JSON.stringify(retained)) <= GIT_HISTORY_LIMITS.retainedBytes)
  }
})

test('historical blob sides share the retained byte budget; a refusal keeps the selected commit and pages', async t => {
  let sequence = 0
  const batch = () => ({ ...page([], 'bounded', 'cursor-' + sequence), unborn: false, commits: Array.from({ length: 50 }, () => ({
    ...summary(sequence++ === 0 ? 'first' : 'row-' + sequence), subject: 's'.repeat(9000)
  })) })
  const f = await fixture(t, { history: async () => ({ ok: true, history: batch() }), historyPage: async () => ({ ok: true, history: batch() }),
    historyCompare: async () => ({ ok: true, comparison: { ...comparison, original: 'a'.repeat(230000), modified: 'b'.repeat(230000) } }) })
  await f.git.setMode('history')
  for (let n = 0; n < 3; n++) await f.git.moreHistory()
  await f.git.selectCommit('first'); const before = f.git.snapshot().history
  assert.equal(before?.commits.length, 200)
  await f.git.compare('blob-pair')
  assert.equal(f.git.snapshot().comparison, null); assert.match(f.git.snapshot().historyError!, /limite/)
  assert.equal(f.git.snapshot().history, before); assert.equal(f.git.snapshot().commit, detail)
})
