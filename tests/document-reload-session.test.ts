import { unusedDocumentAuthoring } from './document-authoring-fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import type { DocumentBridge, DocumentResult, DocumentSnapshot } from '@geppio/runtime/documents'
import { EditorSession } from '../src/geppio/src/renderer/src/files-editor/session.ts'
import { ExplorerSession } from '../src/geppio/src/renderer/src/files-editor/explorer-session.ts'
import { GitSession } from '../src/geppio/src/renderer/src/git/session.ts'
import { SearchSession } from '../src/geppio/src/renderer/src/search/session.ts'
import { QuickOpenSession } from '../src/geppio/src/renderer/src/quick-open/session.ts'
import { applyModelEndings, modelEndings } from '../src/geppio/src/renderer/src/files-editor/model-eols.ts'
import { editorText } from '@geppio/runtime/documents'

const file: DocumentSnapshot = { id: 'a', revision: 'base', text: 'one\r\ntwo\nthree', bom: false, name: 'a.txt', location: { root: 'project', names: ['a.txt'] } }
const other: DocumentSnapshot = { id: 'b', revision: 'sibling-base', text: 'other', bom: false, name: 'b.txt' }
const unexpected = (): never => { throw new Error('unexpected operation') }
const result = (document: DocumentSnapshot): DocumentResult => ({ ok: true, document })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture(bridge: Partial<DocumentBridge>) {
  const editor = new EditorSession({ ...unusedDocumentAuthoring, open: unexpected, activate: unexpected, close: unexpected, release: unexpected, save: unexpected, onCloseRequested: unexpected, reload: unexpected, ...bridge })
  await editor.openAuthorized(async () => result(other))
  await editor.openAuthorized(async () => result(file))
  return editor
}

test('explicit reload adopts just the named receipt; changed exact text resets only this history and clamps the selection', async t => {
  const disk = { ...file, revision: 'new', text: 'x\r\ny', bom: true }
  const reload = t.mock.fn<DocumentBridge['reload']>(async () => ({ ...result(disk), documents: [{ ...other, text: 'unrelated' }] }))
  const editor = await fixture({ reload })
  editor.editExact('distinct unsaved', other.id)
  const sibling = editor.documentState(other.id)
  editor.setLanguage('Markdown')
  editor.rememberSelection({ start: 8, end: 1, top: 180, left: 75 })
  assert.equal(await editor.reload(), true)
  assert.deepEqual(reload.mock.calls[0]!.arguments, [{ id: file.id, revision: file.revision, text: file.text }, false])
  const active = editor.documentState(file.id)!
  assert.equal(active.document, disk); assert.equal(active.text, disk.text); assert.equal(active.bytes, 7)
  assert.deepEqual(active.selection, { start: 3, end: 1, top: 180, left: 75 }); assert.equal(active.cursor, 1)
  assert.equal(active.language, 'Markdown'); assert.equal(active.historyVersion, 1); assert.equal(editor.dirty, false)
  assert.equal(editor.documentState(other.id), sibling)
  assert.equal(await editor.reload(), true); assert.equal(editor.documentState(file.id)?.historyVersion, 1)
})

test('opaque and lost batch receipts retain affected drafts and identify possibly rebound untitled destinations', async () => {
  for (const kind of ['saveAll', 'close'] as const) for (const lost of [false, true]) {
    const uncertain = async (): Promise<DocumentResult> => {
      if (lost) throw new Error('lost receipt')
      return { ok: false, code: 'unconfirmed', error: 'Resultado não confirmado.' }
    }
    const editor = await fixture({ [kind]: uncertain })
    const untitled = { ...other, id: 'untitled', untitled: true as const, text: '' }
    await editor.openAuthorized(async () => result(untitled))
    await editor.openAuthorized(async () => result(file))
    editor.editExact('rascunho sem destino', untitled.id)
    editor.editExact('rascunho nomeado', file.id)
    if (kind === 'close') await editor.close('ticket')
    else await editor.saveAll()
    assert.equal(editor.documentState(untitled.id)?.destinationUncertain, true)
    assert.equal(editor.documentState(untitled.id)?.text, 'rascunho sem destino')
    assert.equal(editor.documentState(file.id)?.unresolved, true)
    assert.ok(!editor.documentState(file.id)?.destinationUncertain)
    assert.equal(editor.documentState(other.id)?.unresolved, false)
  }
})

test('cancel and native refusals ignore attached snapshots; exact changeless draft (including mixed EOLs) preserves history', async () => {
  const disk = { ...file, revision: 'fresh', text: 'edited\r\nline\nend' }
  const replies: DocumentResult[] = [{ ok: true, canceled: true, document: disk, documents: [disk] },
    { ok: false, error: 'Recarga recusada.', code: 'unsupported', confirmed: disk, documents: [disk] }, result(disk)]
  const editor = await fixture({ reload: async () => replies.shift()! })
  editor.editExact(disk.text); editor.rememberSelection({ start: 1, end: 8, top: 1, left: 2 })
  const original = editor.documentState(file.id)!
  for (let retry = 0; retry < 2; retry++) {
    assert.equal(await editor.reload(), false)
    const tab = editor.documentState(file.id)!
    assert.equal(tab.document, file); assert.equal(tab.text, original.text); assert.equal(tab.historyVersion, 0)
    assert.deepEqual(tab.selection, original.selection); assert.ok(editor.documentState(other.id))
  }
  assert.ok(await editor.reload()); assert.equal(editor.documentState(file.id)?.historyVersion, 0)
  assert.equal(editor.snapshot().text, disk.text); assert.equal(editor.dirty, false)
})

test('changing only line endings preserves visible history and saves the exact reloaded bytes after undo and redo', async t => {
  const base = 'one\r\ntwo\nthree', current = 'one\r\ntwo\nTHREE'
  const disk = { ...file, revision: 'eols-only', text: 'one\ntwo\rTHREE' }
  const save = t.mock.fn<DocumentBridge['save']>(async () => result(disk))
  const editor = await fixture({ reload: async () => result(disk), save })
  editor.editExact(current)
  assert.ok(await editor.reload()); assert.equal(editor.documentState(file.id)?.historyVersion, 0)
  assert.equal(editor.snapshot().text, disk.text)
  assert.ok(editor.editExact(applyModelEndings(editorText(base), modelEndings(base))))
  assert.equal(editor.snapshot().text, base)
  assert.ok(editor.editExact(applyModelEndings(editorText(current), modelEndings(disk.text))))
  assert.equal(editor.snapshot().text, disk.text); await editor.save()
  assert.deepEqual(save.mock.calls[0]!.arguments, [{ id: file.id, revision: disk.revision, text: disk.text }])
})

test('unconfirmed Save and a lost reload reply require explicit consent despite later errors, activation and text equal to base', async t => {
  const disk = { ...file, revision: 'advanced-in-main', text: 'disk after uncertainty' }
  const reload = t.mock.fn<DocumentBridge['reload']>(async () => {
    if (reload.mock.callCount() === 0) throw new Error('reply lost after adoption')
    return result(disk)
  })
  const save = t.mock.fn<DocumentBridge['save']>(async (): Promise<DocumentResult> => save.mock.callCount() === 0
    ? { ok: false, code: 'unconfirmed', error: 'Gravação sem confirmação.' } : { ok: false, code: 'stale', error: 'Revisão expirada.' })
  const editor = await fixture({ reload, save, activate: async id => ({ ...result(id === file.id ? disk : other), documents: [disk, other] }) })
  editor.editExact('changed'); await editor.save(); editor.editExact(file.text)
  assert.equal(editor.dirty, false); assert.ok(editor.documentState(file.id)?.unresolved)
  await editor.save()
  assert.equal(editor.snapshot().code, 'stale')
  assert.equal(await editor.reload(), false)
  await editor.activate(other.id); await editor.activate(file.id)
  assert.equal(editor.snapshot().document?.revision, file.revision); assert.equal(editor.snapshot().text, file.text)
  assert.equal(editor.documentState(file.id)?.historyVersion, 0)
  assert.ok(await editor.reload())
  assert.deepEqual(reload.mock.calls.map(call => call.arguments), [
    [{ id: file.id, revision: file.revision, text: file.text }, true], [{ id: file.id, revision: file.revision, text: file.text }, true]
  ])
  assert.equal(editor.snapshot().document?.revision, disk.revision); assert.equal(editor.snapshot().text, disk.text)
  assert.equal(editor.documentState(file.id)?.unresolved, false); assert.equal(save.mock.callCount(), 2)
})

test('one pending reload blocks save/release and same-model edits; another model keeps typing and close receives the final revisions', async t => {
  const pending = deferred<DocumentResult>(), disk = { ...file, revision: 'new', text: 'replacement' }
  const close = t.mock.fn<DocumentBridge['close']>(async () => ({ ok: true, document: file, canceled: true }))
  const editor = await fixture({ reload: async () => pending.promise, close })
  const reloading = editor.reload()
  assert.equal(await editor.reload(), false)
  assert.equal(editor.edit('interleaved edit'), false)
  assert.equal(editor.editExact('unrelated typing', other.id), true)
  await editor.save(); await editor.release(); assert.equal(await editor.activate(other.id), false)
  const closing = editor.close('ticket')
  assert.equal(close.mock.callCount(), 0)
  pending.resolve(result(disk)); assert.ok(await reloading); await closing
  assert.deepEqual(close.mock.calls[0]!.arguments, ['ticket', [
    { id: other.id, revision: other.revision, text: 'unrelated typing' }, { id: file.id, revision: disk.revision, text: disk.text }
  ]])
  assert.equal(editor.snapshot().busy, false)
})

test('a late receipt from the wrong grant or a lock acquired while reading cannot replace either model', async () => {
  for (const locked of [true, false]) {
    const pending = deferred<DocumentResult>(), editor = await fixture({ reload: async () => pending.promise })
    editor.edit('retain this'); const reloading = editor.reload()
    editor.locked = locked
    pending.resolve(result(locked ? { ...file, revision: 'late', text: 'late' } : other))
    assert.equal(await reloading, false); assert.equal(editor.snapshot().text, 'retain this')
    assert.equal(editor.snapshot().document, file); assert.equal(editor.documentState(file.id)?.historyVersion, 0)
    assert.equal(editor.documentState(other.id)?.text, other.text); assert.ok(editor.documentState(file.id)?.unresolved)
  }
})

test('project reload expires only current witnesses without starting tree, Git, name or content scans; refresh restores them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const editor = await fixture({ reload: async draft => result(draft.id === other.id ? other : { ...file, revision: 'reloaded' }), activate: async id => result(id === file.id ? file : other) })
  const root = { id: 'project', name: 'project', kind: 'directory' } as const
  const list = t.mock.fn(async () => ({ ok: true as const, root, children: [{ id: 'node', name: file.name, kind: 'file' as const }] }))
  const explorer = new ExplorerSession({ select: async () => ({ ok: true, root }), list, open: unexpected, release: unexpected,
    createFile: unexpected, createDirectory: unexpected, renameFile: unexpected }, editor)
  await explorer.select(); explorer.connect(); await setImmediate()
  const status = t.mock.fn(async () => ({ ok: true as const, status: { root: root.id, name: root.name, branch: 'main', detached: false, changes: [] } }))
  const git = new GitSession({ status, compare: unexpected, stage: async () => ({ ok: false, code: 'uncertain', error: 'Índice não confirmado.' }), unstage: unexpected,
    history: unexpected, historyPage: unexpected, historyCommit: unexpected, historyCompare: unexpected }, explorer)
  const quick = new QuickOpenSession({ start: async () => ({ ok: true, value: { job: 'names', status: 'complete', visited: 1, skipped: 0, total: 1, items: [{ id: 'name', file: file.name }], truncated: false } }),
    read: unexpected, cancel: async () => ({ ok: true }), open: unexpected }, explorer)
  const search = new SearchSession({ preview: unexpected, applyFile: unexpected, start: async () => ({ ok: true, value: { job: 'text', status: 'complete', visited: 1, files: 1, skipped: 0, bytes: 4,
    found: 1, next: 1, more: false, items: [{ id: 'match', file: file.name, line: 1, column: 1, snippet: 'one', length: 3, highlightStart: 0, highlightEnd: 3 }] } }),
    read: unexpected, open: unexpected, cancel: unexpected }, explorer, () => false)
  git.connect(); quick.connect(); search.connect()
  t.after(() => { git.dispose(); search.dispose(); quick.dispose(); explorer.dispose() })
  assert.ok(quick.show()); quick.setQuery('a'); t.mock.timers.tick(150); await setImmediate()
  search.setQuery('one'); await search.start()
  const lists = list.mock.callCount(), statuses = status.mock.callCount()
  await editor.activate(other.id); assert.ok(await editor.reload())
  assert.ok(quick.snapshot().page); assert.equal(search.snapshot().matches.length, 1); assert.ok(git.snapshot().status)
  await editor.activate(file.id); await setImmediate()
  assert.ok(await editor.reload()); t.mock.timers.tick(1000); await setImmediate()
  assert.equal(quick.snapshot().page, null); assert.deepEqual(search.snapshot().matches, []); assert.equal(git.snapshot().status, null)
  assert.equal(explorer.snapshot().active, null); assert.equal(explorer.openFileNodes().size, 0)
  assert.equal(list.mock.callCount(), lists); assert.equal(status.mock.callCount(), statuses)
  await explorer.refresh(); await setImmediate()
  assert.ok(explorer.openFileNodes().has('node')); assert.ok(git.snapshot().status)
  await git.mutate('stage', 'change')
  const atUncertainty = status.mock.callCount()
  assert.ok(await editor.reload())
  assert.equal(git.snapshot().code, 'uncertain'); assert.equal(git.snapshot().error, 'Índice não confirmado.')
  assert.equal(status.mock.callCount(), atUncertainty)
  await git.refresh(); assert.ok(git.snapshot().status)
})

test('a new search cannot reveal native offsets in an unadopted draft after a clean reload reply goes missing', async t => {
  const requested = t.mock.fn<DocumentBridge['reload']>(async () => { throw new Error('lost receipt') })
  const disk = { ...file, revision: 'new', text: 'two\nnew' }
  const editor = await fixture({ reload: requested, activate: async () => result(file) })
  const root = { id: 'project', name: 'project', kind: 'directory' } as const
  const explorer = new ExplorerSession({ select: async () => ({ ok: true, root }), list: async () => ({ ok: true, root, children: [] }),
    open: unexpected, release: unexpected, createFile: unexpected, createDirectory: unexpected, renameFile: unexpected }, editor)
  await explorer.select()
  const reveal = t.mock.fn(() => true)
  const search = new SearchSession({ preview: unexpected, applyFile: unexpected, start: async () => ({ ok: true, value: { job: 'new-job', status: 'complete', visited: 1, files: 1, skipped: 0, bytes: 7,
    found: 1, next: 1, more: false, items: [{ id: 'result', file: file.name, line: 1, column: 1, snippet: 'two', length: 3, highlightStart: 0, highlightEnd: 3 }] } }),
    read: unexpected, open: async () => ({ ...result(disk), matchesSnapshot: true }), cancel: unexpected }, explorer, reveal)
  search.connect(); t.after(() => { search.dispose(); explorer.dispose() })
  assert.equal(await editor.reload(), false); assert.equal(requested.mock.calls[0]!.arguments[1], false)
  search.setQuery('two'); await search.start(); await search.open('result')
  assert.equal(reveal.mock.callCount(), 0); assert.equal(editor.snapshot().document?.revision, file.revision)
  assert.equal(editor.snapshot().text, file.text); assert.ok(editor.documentState(file.id)?.unresolved)
  assert.equal(await editor.reload(), false); assert.equal(requested.mock.calls[1]!.arguments[1], true)
})
