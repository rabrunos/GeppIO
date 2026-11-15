import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { applyDocumentChanges } from '../src/shared/document-edits.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { DOCUMENT_LIMIT } from '../src/shared/documents.ts'
import type { DocumentBridge } from '../src/shared/documents.ts'

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
  const bridge: DocumentBridge = { open: async () => ({ ok: true, document }), save: async () => ({ ok: false, code: 'write', error: 'fixture refusal' }), release: async () => ({ ok: true, document: null }), close: async () => ({ ok: true, document: null }), onCloseRequested: () => () => {} }
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
