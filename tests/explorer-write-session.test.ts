import { unusedDocumentAuthoring } from './document-authoring-fixture.ts'
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import type { ExplorerBridge, ExplorerNode, ExplorerMutationResult } from '../src/shared/explorer.ts'
import type { DocumentSnapshot } from '../src/shared/documents.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { ExplorerSession } from '../src/renderer/src/files-editor/explorer-session.ts'
import { SearchSession } from '../src/renderer/src/search/session.ts'
import { QuickOpenSession } from '../src/renderer/src/quick-open/session.ts'

const root: ExplorerNode = { id: 'root', name: 'Projeto', kind: 'directory' }
const folder: ExplorerNode = { id: 'folder', name: 'pasta', kind: 'directory' }
const old: ExplorerNode = { id: 'original', name: 'antigo.txt', kind: 'file' }
const document: DocumentSnapshot = { id: 'first tab', revision: 'previous', bom: false, text: 'disco', name: old.name, location: { root: root.id, names: [old.name] } }
const unexpected = () => { throw new Error('unexpected operation') }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

async function fixture(t: TestContext, overrides: Partial<ExplorerBridge> = {}) {
  const files = new Map<string, ExplorerNode[]>([[root.id, [folder, old]], [folder.id, []]])
  const editor: EditorSession = new EditorSession({ ...unusedDocumentAuthoring, open: unexpected, reload: unexpected, activate: unexpected, release: unexpected, close: unexpected, onCloseRequested: unexpected,
    save: async draft => ({ ok: true, document: { ...editor.documentState(draft.id)!.document, text: draft.text, revision: 'saved' } }) })
  const createFile = t.mock.fn<ExplorerBridge['createFile']>(overrides.createFile ?? (async (_r, dir, name) => {
    const node: ExplorerNode = { id: 'fresh', name, kind: 'file' }; files.get(dir)!.push(node)
    return { outcome: 'confirmed', message: 'Arquivo criado.', createdNode: node.id }
  }))
  const createDirectory = t.mock.fn<ExplorerBridge['createDirectory']>(overrides.createDirectory ?? (async (_r, dir, name) => {
    files.get(dir)!.push({ id: 'new-dir', name, kind: 'directory' }); return { outcome: 'confirmed', message: 'Pasta criada.' }
  }))
  const renameFile = t.mock.fn<ExplorerBridge['renameFile']>(overrides.renameFile ?? (async (_r, id, name, binding) => {
    const entries = files.get(root.id)!; entries[entries.findIndex(node => node.id === id)] = { id: 'renamed', name, kind: 'file' }
    return { outcome: 'confirmed', message: 'Arquivo renomeado.', ...(binding ? { renamed: { ...document, name, revision: 'renamed' } } : {}) }
  }))
  const list = t.mock.fn<ExplorerBridge['list']>(overrides.list ?? (async (_r, id) => ({ ok: true, root, children: structuredClone(files.get(id) ?? []) })))
  const open = t.mock.fn<ExplorerBridge['open']>(overrides.open ?? (async (_r, id) => {
    const node = [...files.values()].flat().find(node => node.id === id)!
    return { ok: true, document: { id: 'tab:' + id, revision: 'new', bom: false, text: '', name: node.name } }
  }))
  const explorer = new ExplorerSession({ select: async () => ({ ok: true, root }), release: unexpected, list, open, createFile, createDirectory, renameFile }, editor)
  await explorer.select()
  t.after(() => explorer.dispose())
  return { files, explorer, editor, createFile, createDirectory, renameFile, list, open }
}

test('exact target and literal basename create one file, activate its receipt, and allow editing/saving while an unrelated draft remains', async t => {
  const p = await fixture(t), name = "novo [β] $ ' .txt"
  await p.editor.openAuthorized(async () => ({ ok: true, document })); p.editor.edit('rascunho')
  await p.explorer.mutate('create-file', root.id, folder, root.id, name)
  assert.deepEqual(p.createFile.mock.calls[0]!.arguments, [root.id, folder.id, name])
  assert.deepEqual(p.open.mock.calls[0]!.arguments, [root.id, 'fresh', { id: document.id, revision: document.revision, text: 'rascunho' }])
  assert.equal(p.editor.snapshot().document?.name, name); assert.equal(p.editor.snapshot().text, '')
  assert.equal(p.editor.edit('texto novo'), true); await p.editor.save()
  assert.equal(p.editor.snapshot().document?.text, 'texto novo'); assert.equal(p.editor.documentState(document.id)?.text, 'rascunho')
  assert.equal(p.explorer.snapshot().mutationVersion, 1); assert.equal(p.explorer.snapshot().diskVersion, 1)
  assert.ok(p.explorer.snapshot().expanded.has(folder.id)); assert.equal(p.explorer.focus, 'fresh')
  await p.explorer.mutate('create-directory', root.id, root, null, 'subpasta')
  assert.deepEqual(p.createDirectory.mock.calls[0]!.arguments, [root.id, root.id, 'subpasta'])
  assert.equal(p.open.mock.callCount(), 1)
  await p.explorer.mutate('rename-file', root.id, old, root.id, 'outro.txt')
  assert.deepEqual(p.renameFile.mock.calls[0]!.arguments, [root.id, old.id, 'outro.txt', { id: document.id, revision: document.revision,
    dirty: true, language: 'Texto simples', selection: { start: 0, end: 0, top: 0, left: 0 } }])
  assert.equal(p.editor.documentState(document.id)?.text, 'rascunho')
  assert.equal(p.editor.documentState(document.id)?.document.name, 'outro.txt')
  assert.equal(p.editor.snapshot().document?.name, name)
})

test('closed rename validates case, parent, node kind and raw names; collisions preserve the current tree', async t => {
  const p = await fixture(t)
  for (const invalid of ['ANTIGO.txt', 'x ', 'x.', '.giT', 'NUL', '../outro']) await p.explorer.mutate('rename-file', root.id, old, root.id, invalid)
  await p.explorer.mutate('rename-file', root.id, folder, root.id, 'pasta2')
  await p.explorer.mutate('rename-file', 'lost', old, root.id, 'outro')
  await p.explorer.mutate('rename-file', root.id, old, folder.id, 'outro')
  assert.equal(p.renameFile.mock.callCount(), 0)
  await p.explorer.mutate('rename-file', root.id, old, root.id, 'novo.txt')
  assert.deepEqual(p.renameFile.mock.calls[0]!.arguments, [root.id, old.id, 'novo.txt'])
  assert.equal(p.explorer.snapshot().children.get(root.id)!.at(-1)?.name, 'novo.txt'); assert.equal(p.open.mock.callCount(), 0)
  const refused = await fixture(t, { renameFile: async () => ({ outcome: 'refused', message: 'Destino já existe.' }) })
  const before = refused.explorer.snapshot()
  await refused.explorer.mutate('rename-file', root.id, old, root.id, 'novo.txt')
  assert.equal(refused.explorer.snapshot().mutationNotice, 'Destino já existe.')
  assert.equal(refused.explorer.snapshot().mutationVersion, 0); assert.deepEqual(refused.explorer.snapshot().children, before.children)
})

test('confirmed creation remains confirmed after a slot refusal, a failed refresh or a destination replaced before listing', async t => {
  for (const failure of ['limit', 'refresh', 'replacement']) {
    let count = 0
    const p = await fixture(t, failure === 'limit' ? { open: async () => ({ ok: false, code: 'limit', error: 'Limite de oito arquivos.' }) } :
      { list: async () => ++count === 1 ? { ok: true, root, children: [] } : failure === 'refresh' ? { ok: false, code: 'unavailable', error: 'Leitura recusada.' }
        : { ok: true, root, children: [{ id: 'replaced', name: 'novo', kind: 'file' }] } })
    await p.editor.openAuthorized(async () => ({ ok: true, document })); p.editor.edit('rascunho')
    await p.explorer.mutate('create-file', root.id, root, null, 'novo')
    assert.equal(p.createFile.mock.callCount(), 1); assert.equal(p.open.mock.callCount(), failure === 'limit' ? 1 : 0)
    assert.ok(p.files.get(root.id)!.some(f => f.name === 'novo')); assert.equal(p.editor.snapshot().text, 'rascunho')
    assert.match(p.explorer.snapshot().mutationNotice!, /^Arquivo criado\./)
    assert.match(p.explorer.snapshot().mutationNotice!, failure === 'refresh' ? /atualizar a árvore/ : failure === 'limit' ? /Limite de oito/ : /não foi aberto/)
  }
})

test('an ambiguous write revokes displayed filename and text search results and reconciles once without adopting the observed name', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const receipt = deferred<ExplorerMutationResult>()
  const p = await fixture(t, { createFile: () => receipt.promise })
  const quick = new QuickOpenSession({ start: async () => ({ ok: true, value: { job: 'names', status: 'complete', total: 1, visited: 1, skipped: 0, truncated: false, items: [{ id: 'n', file: old.name }] } }),
    read: unexpected, cancel: async () => ({ ok: true }), open: unexpected }, p.explorer)
  const search = new SearchSession({ preview: unexpected, applyFile: unexpected, start: async () => ({ ok: true, value: { job: 'text', status: 'complete', visited: 1, files: 1, skipped: 0, bytes: 3, found: 1, next: 1, more: false,
    items: [{ id: 't', file: old.name, line: 1, column: 1, snippet: 'abc', length: 3, highlightStart: 0, highlightEnd: 3 }] } }), read: unexpected, cancel: unexpected, open: unexpected }, p.explorer, () => false)
  quick.connect(); search.connect(); t.after(() => { quick.dispose(); search.dispose() })
  quick.show(); quick.setQuery('antigo'); t.mock.timers.tick(150); await setImmediate()
  search.setQuery('abc'); await search.start()
  assert.equal(quick.snapshot().page?.items.length, 1); assert.equal(search.snapshot().matches.length, 1)
  const write = p.explorer.mutate('create-file', root.id, root, null, 'novo')
  await p.explorer.mutate('create-file', root.id, root, null, 'novo'); assert.equal(p.createFile.mock.callCount(), 1)
  receipt.resolve({ outcome: 'unconfirmed', message: 'Resultado não confirmado.' }); await write
  assert.equal(p.explorer.snapshot().mutationNotice, 'Resultado não confirmado.'); assert.equal(p.open.mock.callCount(), 0)
  assert.equal(quick.snapshot().page, null); assert.equal(quick.snapshot().visible, false)
  assert.equal(search.snapshot().matches.length, 0); assert.equal(search.snapshot().query, 'abc')
  assert.equal(await quick.open('n'), false); await search.open('t')
  assert.equal(p.list.mock.callCount(), 2)
})

test('a lost write reply is unconfirmed; a revoked renderer generation cannot open or reconcile an old receipt', async t => {
  const p = await fixture(t, { createFile: async () => { throw new Error('disconnected') } })
  await p.explorer.mutate('create-file', root.id, root, null, 'novo')
  assert.match(p.explorer.snapshot().mutationNotice!, /não foi confirmado/); assert.equal(p.createFile.mock.callCount(), 1); assert.equal(p.open.mock.callCount(), 0)
  const receipt = deferred<ExplorerMutationResult>(), stale = await fixture(t, { createFile: () => receipt.promise })
  const before = stale.list.mock.callCount(), write = stale.explorer.mutate('create-file', root.id, root, null, 'novo')
  stale.explorer.dispose()
  receipt.resolve({ outcome: 'confirmed', message: 'Arquivo criado.', createdNode: 'fresh' }); await write
  assert.equal(stale.list.mock.callCount(), before); assert.equal(stale.open.mock.callCount(), 0)
  assert.match(stale.explorer.snapshot().mutationNotice!, /^Arquivo criado\. A árvore não foi atualizada/)
})
