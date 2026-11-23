import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import type { DocumentBridge, DocumentResult, DocumentSnapshot } from '../src/shared/documents.ts'
import { unusedDocumentAuthoring } from './document-authoring-fixture.ts'

async function fixture(override: Partial<DocumentBridge> = {}) {
  const a = { id: 'a', revision: 'a1', text: 'alpha', name: 'a.txt', bom: false }
  const b = { ...a, id: 'b', revision: 'b1', name: 'b.txt', text: 'beta' }
  const files = [a, b]
  const ok = (document: DocumentSnapshot): DocumentResult => ({ ok: true, document })
  const unexpected = (): never => { throw Error('unexpected call') }
  const session = new EditorSession({ ...unusedDocumentAuthoring, open: unexpected, save: unexpected, reload: unexpected,
    release: unexpected, close: unexpected, onCloseRequested: unexpected, activate: async id => ok(files.find(f => f.id === id)!), ...override })
  for (const file of files) await session.openAuthorized(async () => ok(file))
  return { session, a, b }
}

test('two occurrences retain one draft, independent selection and one last native close', async () => {
  const closed: string[] = []
  const { session, a, b } = await fixture({ release: async draft => { closed.push(draft.id); return { ok: true, canceled: true, document: b } } })
  session.sendToOtherGroup(); assert.deepEqual(session.groups.sides.map(g => g.tabs), [[a.id, b.id], [b.id]])
  session.editExact('shared draft')
  session.rememberSelection({ start: 3, end: 6, top: 100, left: 0 })
  await session.focusGroup(0, b.id)
  session.rememberSelection({ start: 0, end: 1, top: 0, left: 20 })
  await session.focusGroup(1)
  assert.equal(session.selection.end, 6); assert.equal(session.snapshot().text, 'shared draft')
  assert.equal(session.drafts().length, 2)
  await session.closeOccurrence(1, b.id)
  assert.deepEqual(closed, []); assert.equal(session.groups.active, 0)
  assert.equal(session.selection.left, 20)
  await session.closeOccurrence(0, b.id)
  assert.deepEqual(closed, [b.id]); assert.equal(session.snapshot().text, 'shared draft')
})

test('moving a tab preserves native identity, failed focus preserves command context, and merge keeps all tabs', async () => {
  const { session, a, b } = await fixture({ activate: async () => ({ ok: false, code: 'stale', error: 'Seleção expirada.' }) })
  session.sendToOtherGroup(true)
  assert.deepEqual(session.groups.sides.map(g => g.tabs), [[a.id], [b.id]])
  assert.equal(await session.focusGroup(0, a.id), false)
  assert.equal(session.groups.active, 1); assert.equal(session.snapshot().document?.id, b.id)
  await session.mergeGroups()
  assert.deepEqual(session.groups.sides.map(g => g.tabs), [[a.id, b.id], []])
  assert.equal(session.snapshot().document?.revision, b.revision)
})

test('a lost focus receipt requires reconfirmation and a save receipt never redirects the active group', async () => {
  const calls: string[] = []
  const { session, a, b } = await fixture({
    activate: async id => { calls.push(id); if (id === 'a') throw Error('lost after native activation'); return { ok: true, document: b } },
    save: async draft => { calls.push('save ' + draft.id); return { ok: true, document: a, documents: [a, b] } }
  })
  session.sendToOtherGroup(true)
  assert.equal(await session.focusGroup(0, a.id), false)
  await session.save(); assert.deepEqual(calls, ['a'])
  assert.ok(await session.focusGroup(1, b.id))
  await session.save(); assert.deepEqual(calls, ['a', 'b', 'save b'])
  assert.equal(session.snapshot().document?.id, b.id)
  assert.deepEqual(session.groups.sides.map(g => g.tabs), [[a.id], [b.id]])
})

test('after a lost last release an unrelated native inventory retains the recoverable occurrence', async () => {
  const { session, a, b } = await fixture({ release: async () => { throw Error('reply lost after close') } })
  session.editExact('exact draft after close')
  await session.closeOccurrence(0, b.id)
  await session.openAuthorized(async () => ({ ok: true, document: a, documents: [a] }))
  assert.ok(session.documentState(b.id)?.detached)
  assert.ok(await session.focusGroup(0, b.id))
  assert.equal(session.snapshot().text, 'exact draft after close')
  await session.discardDetached(b.id)
  assert.ok(!session.documentState(b.id)); assert.equal(session.snapshot().document?.id, a.id)
})

test('a pending bulk close excludes pinned duplicates and refuses concurrent editing and organization', async () => {
  const released: string[] = []
  let decide!: () => void
  const answer = new Promise<void>(resolve => { decide = resolve })
  const { session, a, b } = await fixture({ release: async draft => {
    released.push(draft.id); await answer
    return { ok: true, canceled: true, document: b }
  } })
  session.togglePin(b.id); session.sendToOtherGroup()
  assert.equal(session.reorderTab(0, b.id, 0), true)
  const closing = session.closeTabs('all')
  assert.equal(session.snapshot().busy, true)
  assert.equal(session.reorderTab(0, a.id, 0), false)
  session.togglePin(a.id); assert.ok(!session.groups.pinned.has(a.id))
  assert.equal(await session.closeTabs('all'), false)
  assert.ok(!session.editExact('blocked', a.id)); decide()
  assert.equal(await closing, false)
  assert.deepEqual(released, [a.id]); assert.deepEqual(session.groups.sides.map(g => g.tabs), [[b.id, a.id], [b.id]])
})

test('a confirmed release counts once and stops the batch if activating the visual neighbor fails', async () => {
  const released: string[] = []
  const c = { id: 'c', revision: 'c1', text: 'third', name: 'c.txt', bom: false }
  const { session, a, b } = await fixture({
    release: async draft => { released.push(draft.id); return { ok: true, document: a, documents: [a, c] } },
    activate: async () => ({ ok: false, code: 'stale', error: 'Vizinho indisponível.' })
  })
  await session.openAuthorized(async () => ({ ok: true, document: c }))
  await session.openAuthorized(async () => ({ ok: true, document: b }))
  session.reorderTab(0, a.id, 2)
  assert.equal(await session.closeTabs('all'), false)
  assert.deepEqual(released, [b.id]); assert.deepEqual(session.groups.sides[0].tabs, [c.id, a.id])
  assert.match(session.snapshot().notice!, /1 de 3.*Vizinho indisponível/)
})
