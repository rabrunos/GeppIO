import { unusedDocumentAuthoring } from './document-authoring-fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { applyDocumentChanges, DocumentHistoryBudget } from '../src/shared/document-edits.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { DOCUMENT_LIMIT } from '../src/shared/documents.ts'
import type { DocumentBridge } from '../src/shared/documents.ts'

test('history limits reject growth without evicting other tabs and release only an explicitly closed owner', () => {
  const budget = new DocumentHistoryBudget(100, 2)
  assert.ok(budget.retain('first', 40)); assert.ok(budget.retain('second', 50))
  assert.equal(budget.retain('first', 11), false); assert.equal(budget.retain('first', Infinity), false); assert.equal(budget.retain('first', -1), false)
  assert.ok(budget.retain('first', 10)); assert.equal(budget.retain('first', 0), false)
  budget.release('second'); assert.ok(budget.retain('third', 50)); assert.equal(budget.retain('first', 0), false)
  budget.release('first'); assert.ok(budget.retain('first', 20)); assert.throws(() => new DocumentHistoryBudget(0, 1))
})

test('simultaneous model ranges preserve untouched mixed EOL tokens and surrogate pairs', () => {
  const source = 'a\r\nb\nc\rd😀'
  assert.equal(applyDocumentChanges(source, [{ rangeOffset: 0, rangeLength: 1, text: 'A' }, { rangeOffset: 4, rangeLength: 1, text: 'C' }]), 'A\r\nb\nC\rd😀')
  assert.equal(applyDocumentChanges(source, [{ rangeOffset: 1, rangeLength: 0, text: '\nnew' }]), 'a\r\nnew\r\nb\nc\rd😀')
  assert.equal(applyDocumentChanges('', [{ rangeOffset: 0, rangeLength: 0, text: 'replacement\n' }], '\r\n'), 'replacement\r\n')
  assert.throws(() => applyDocumentChanges(source, [{ rangeOffset: -1, rangeLength: 0, text: '' }]))
  assert.throws(() => applyDocumentChanges(source, [{ rangeOffset: 1, rangeLength: 3, text: '' }, { rangeOffset: 2, rangeLength: 1, text: '' }]))
})
test('exact editor proposals retain the byte cap, BOM, Unicode and busy/failed-save protections', async () => {
  const document = { id: randomUUID(), revision: randomUUID(), name: 'fixture.json', bom: true, text: 'a\r\nb\nc\r' }
  const bridge: DocumentBridge = { ...unusedDocumentAuthoring, reload: async () => { throw new Error('Unexpected reload') }, activate: async () => ({ ok: true, document }), open: async () => ({ ok: true, document }), save: async () => ({ ok: false, code: 'write', error: 'fixture refusal' }), release: async () => ({ ok: true, document: null }), close: async () => ({ ok: true, document: null }), onCloseRequested: () => () => {} }
  const session = new EditorSession(bridge); await session.open()
  assert.equal(session.editExact('A\r\nb\nc\r'), true); assert.equal(session.dirty, true)
  assert.equal(session.editExact('\ud800'), false); assert.equal(session.snapshot().text, 'A\r\nb\nc\r')
  assert.equal(session.editExact('x'.repeat(DOCUMENT_LIMIT - 3)), true)
  assert.equal(session.editExact('x'.repeat(DOCUMENT_LIMIT - 2)), false)
  await session.save(); assert.equal(session.snapshot().code, 'write'); assert.equal(session.dirty, true)
  session.setLanguage('TypeScript'); assert.equal(session.snapshot().document, document)
  assert.equal(session.editExact('a\nb\nc\n'), true); assert.equal(session.snapshot().text, document.text); assert.equal(session.dirty, false)
  await session.release(); assert.equal(session.snapshot().document, null)
})

test('an unconfirmed save or missing reply invalidates disk views without changing the draft or retrying', async () => {
  const document = { id: randomUUID(), revision: randomUUID(), name: 'draft.txt', bom: false, text: 'base' }
  let writes = 0
  const original = async () => ({ ok: true as const, document })
  const session = new EditorSession({ ...unusedDocumentAuthoring,
    open: original, activate: original, close: original, release: original, reload: original, onCloseRequested: () => () => {},
    async save() {
      if (++writes === 1) return { ok: false, code: 'unconfirmed', error: 'Resultado não confirmado.' }
      throw new Error('Lost IPC response')
    }
  })
  await session.open()
  session.editExact('my draft')
  for (const [index, code] of ['unconfirmed', 'unavailable'].entries()) {
    const diskVersion = session.snapshot().diskVersion
    await session.save()
    assert.equal(writes, index + 1)
    assert.equal(session.snapshot().code, code)
    assert.equal(session.snapshot().document, document)
    assert.equal(session.snapshot().text, 'my draft')
    assert.equal(session.dirty, true)
    assert.equal(session.snapshot().diskVersion, diskVersion + 1)
  }
})
