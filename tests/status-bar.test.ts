import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { documentCursor, documentEOL, documentLanguage } from '../src/shared/document-status.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import type { DocumentBridge, DocumentSnapshot } from '../src/shared/documents.ts'

test('EOL and cursor reflect actual bytes and textarea selection coordinates', () => {
  for (const [text, expected] of [['', 'Sem EOL'], ['x\n', 'LF'], ['x\r\n', 'CRLF'], ['x\r', 'CR'], ['x\r\ny\nz\r', 'Misto']]) assert.equal(documentEOL(text!), expected)
  assert.deepEqual(documentCursor('a\r\nb\rc\n😀x', 9), { line: 4, column: 4 })
  assert.deepEqual(documentCursor('a\r\nb', 2), { line: 2, column: 1 })
  assert.equal(documentLanguage('TEST.TSX'), 'TypeScript'); assert.equal(documentLanguage('file.json'), 'JSON'); assert.equal(documentLanguage('unknown'), 'Texto simples')
})
test('session-only language and cursor do not edit buffer or disk draft; dirty/error/busy preserve one owner', async () => {
  const document: DocumentSnapshot = { id: randomUUID(), revision: randomUUID(), name: 'test.json', text: '{\r\n}\r\n', bom: true }
  let submitted = '', complete!: () => void
  const bridge: DocumentBridge = {
    open: async () => ({ ok: true, document }),
    save: async draft => { submitted = draft.text; await new Promise<void>(resolve => { complete = resolve }); return { ok: false, code: 'write', error: 'Disposable write failure' } },
    release: async () => ({ ok: true, document: null }), close: async () => ({ ok: true, document: null }), onCloseRequested: () => () => {}
  }
  const session = new EditorSession(bridge); await session.open()
  session.setLanguage('TypeScript'); session.rememberSelection({ start: 2, end: 2, top: 0, left: 0 })
  assert.equal(session.dirty, false); assert.equal(session.snapshot().text, document.text); assert.equal(session.snapshot().cursor, 2)
  session.edit('{\n"changed":true\n}\n'); assert.equal(session.dirty, true)
  const pending = session.save(); assert.equal(session.snapshot().busy, true); complete(); await pending
  assert.equal(submitted, session.snapshot().text); assert.equal(session.dirty, true); assert.equal(session.snapshot().code, 'write')
  assert.equal(session.snapshot().language, 'TypeScript'); assert.equal(session.snapshot().document!.bom, true)
})
