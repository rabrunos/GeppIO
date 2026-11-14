import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DirectoryStore, ExplorerFailure, explorerFailure, safeExplorerName } from '../src/main/explorer.ts'
import { DocumentStore, documentFailure } from '../src/main/documents.ts'
import { EXPLORER_LIMITS, validExplorerRequest } from '../src/shared/explorer.ts'
import type { ExplorerNode, ExplorerResult } from '../src/shared/explorer.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import { ExplorerSession } from '../src/renderer/src/files-editor/explorer-session.ts'

const current = () => true
function result(value: ExplorerResult) { assert.ok(value.ok); return value }
function root(value: ExplorerResult) { const node = result(value).root; assert.ok(node); return node }
const denied = (kind: string) => (error: unknown) => error instanceof ExplorerFailure && error.kind === kind
async function fixture(run: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), 'geppio-smoke-explorer-unit-'))
  try { await run(await realpath(path)) } finally { await rm(path, { recursive: true, force: true, maxRetries: 5 }) }
}
test('fixed Explorer request shape refuses paths, forged IDs, extra fields and oversized drafts', () => {
  const id = randomUUID()
  assert.ok(validExplorerRequest('select', [])); assert.ok(validExplorerRequest('list', [id, id])); assert.ok(validExplorerRequest('release', [id]))
  assert.ok(validExplorerRequest('open', [id, id, { id, revision: id, text: 'draft' }]))
  for (const args of [[id], [id, '../file'], [id, 'C:\\private'], [id, id, 'extra'], [id, {}]]) assert.equal(validExplorerRequest('list', args), false)
  assert.equal(validExplorerRequest('select', [null]), false)
  assert.equal(validExplorerRequest('open', [id, id, { id, revision: id, text: 'x', path: 'private' }]), false)
  assert.equal(validExplorerRequest('open', [id, id, { id, revision: id, text: 'x'.repeat(1024 * 1024 + 1) }]), false)
  for (const name of ['..', 'a/b', 'a\\b', 'a:stream', 'NUL.txt', 'COM1', 'LPT¹', 'trailing.', 'trailing ', 'FILE~1', '\ud800', 'a\n']) assert.equal(safeExplorerName(name), false, name)
  assert.ok(safeExplorerName('café 😀.ts'))
  assert.doesNotMatch(JSON.stringify(explorerFailure(new Error('C:\\private\\secret'))), /private|secret/)
})
test('lazy directories, empty listing, folders-first deterministic order, stable IDs, path-free metadata', async () => fixture(async path => {
  await mkdir(join(path, 'z-folder')); await mkdir(join(path, 'a-folder'))
  await writeFile(join(path, 'b.txt'), 'b'); await writeFile(join(path, 'A.ts'), 'a')
  const store = new DirectoryStore(), selected = root(await store.select(path, current))
  const children = result(await store.list(selected.id, selected.id, current)).children!
  assert.deepEqual(children.map(n => n.name), ['a-folder', 'z-folder', 'A.ts', 'b.txt'])
  assert.deepEqual(result(await store.list(selected.id, selected.id, current)).children, children)
  assert.deepEqual(result(await store.list(selected.id, children[0]!.id, current)).children, [])
  assert.equal(await store.file(selected.id, children[2]!.id, current), join(path, 'A.ts'))
  assert.doesNotMatch(JSON.stringify({ selected, children }), /[\\/]/)
  await assert.rejects(store.file(randomUUID(), children[2]!.id, current), denied('stale'))
  await assert.rejects(store.file(selected.id, randomUUID(), current), denied('stale'))
  await assert.rejects(store.file(selected.id, children[0]!.id, current), denied('unsupported'))
}))
test('revocation, replacement, missing targets and changed ancestry fail closed', async () => fixture(async path => {
  const scope = join(path, 'scope'); await mkdir(scope); await mkdir(join(scope, 'nested')); await writeFile(join(scope, 'nested', 'one.ts'), 'one')
  const store = new DirectoryStore(), selected = root(await store.select(scope, current))
  const child = result(await store.list(selected.id, selected.id, current)).children![0]!
  const file = result(await store.list(selected.id, child.id, current)).children![0]!
  await rename(join(scope, 'nested'), join(scope, 'old')); await mkdir(join(scope, 'nested')); await writeFile(join(scope, 'nested', 'one.ts'), 'replaced')
  await assert.rejects(store.file(selected.id, file.id, current), denied('stale'))
  await store.list(selected.id, selected.id, current)
  await assert.rejects(store.list(selected.id, child.id, current), denied('stale'))
  const guard = store.guard(); store.release(selected.id); assert.equal(guard(), false)
  await assert.rejects(store.list(selected.id, selected.id, current), denied('stale'))
  const newer = root(await store.select(scope, current)); await store.select(path, current)
  await assert.rejects(store.list(newer.id, newer.id, current), denied('stale'))
  const valid = root(await store.select(scope, current)); await rm(scope, { recursive: true })
  await assert.rejects(store.list(valid.id, valid.id, current))
  await assert.rejects(store.select(path, () => false), denied('stale'))
}))
test('junction/symlink scopes and linked children never grant traversal; hardlinks are blocked', async () => fixture(async path => {
  const scope = join(path, 'scope'), outside = join(path, 'outside'); await mkdir(scope); await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(outside, join(scope, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir')
  await link(join(outside, 'secret.txt'), join(scope, 'linked.txt'))
  const store = new DirectoryStore()
  await assert.rejects(store.select(join(scope, 'redirect'), current), denied('unsupported'))
  const selected = root(await store.select(scope, current)), children = result(await store.list(selected.id, selected.id, current)).children!
  assert.ok(children.every(node => node.kind === 'blocked'))
  for (const node of children) await assert.rejects(store.file(selected.id, node.id, current), denied('unsupported'))
  await mkdir(join(scope, 'folder')); await store.list(selected.id, selected.id, current)
  const dir = result(await store.list(selected.id, selected.id, current)).children!.find(n => n.name === 'folder')!
  await rename(join(scope, 'folder'), join(scope, 'before')); await symlink(outside, join(scope, 'folder'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(store.list(selected.id, dir.id, current), denied('unsupported'))
}))
test('large directories refuse the whole result; depth and global metadata budgets include blocked entries', async () => fixture(async path => {
  const scope = join(path, 'scope'); await mkdir(scope)
  await Promise.all(Array.from({ length: EXPLORER_LIMITS.entries + 1 }, (_, i) => writeFile(join(scope, `f${i}.txt`), '')))
  const store = new DirectoryStore(), selected = root(await store.select(scope, current))
  await assert.rejects(store.list(selected.id, selected.id, current), denied('limit'))
  const deep = join(path, 'deep'); await mkdir(deep); let target = deep
  for (let i = 0; i < EXPLORER_LIMITS.depth; i++) { target = join(target, 'd'); await mkdir(target) }
  const depthRoot = root(await store.select(deep, current)); let node = depthRoot
  for (let i = 0; i < EXPLORER_LIMITS.depth; i++) node = result(await store.list(depthRoot.id, node.id, current)).children![0]!
  await assert.rejects(store.list(depthRoot.id, node.id, current), denied('limit'))
  const budget = join(path, 'budget'); await mkdir(budget)
  for (let i = 0; i < 8; i++) { const dir = join(budget, `d${i}`), source = join(path, `source${i}`); await writeFile(source, ''); await mkdir(dir); for (let n = 0; n < 512; n++) await link(source, join(dir, `b${n}`)) }
  const budgetRoot = root(await store.select(budget, current)), dirs = result(await store.list(budgetRoot.id, budgetRoot.id, current)).children!
  for (const dir of dirs.slice(0, 7)) assert.equal(result(await store.list(budgetRoot.id, dir.id, current)).children!.length, 512)
  await assert.rejects(store.list(budgetRoot.id, dirs[7]!.id, current), denied('limit'))
  await rm(join(budget, 'd0'), { recursive: true }); await store.list(budgetRoot.id, budgetRoot.id, current)
  assert.equal(result(await store.list(budgetRoot.id, dirs[7]!.id, current)).children!.length, 512)
}))
test('authorized document selection retains dirty buffer on Cancel, unsupported file and changed grant after decision', async () => fixture(async path => {
  const first = join(path, 'first.ts'), next = join(path, 'next.json'); await writeFile(first, '\ufeffone\r\n'); await writeFile(next, '{"v":1}\n')
  const dirs = new DirectoryStore(), documents = new DocumentStore(), selected = root(await dirs.select(path, current))
  const entries = result(await dirs.list(selected.id, selected.id, current)).children!, node = entries.find(n => n.name === 'next.json')!
  await documents.select(first, null, async () => 'discard', current)
  const draft = { id: documents.snapshot!.id, revision: documents.snapshot!.revision, text: 'dirty\r\n' }
  const open = (decision: 'save' | 'discard' | 'cancel') => documents.select(next, draft, async () => decision, current, async () => { await dirs.file(selected.id, node.id, current) })
  const canceled = await open('cancel'); assert.ok(canceled.ok && canceled.canceled); assert.equal(documents.snapshot!.id, draft.id)
  await writeFile(next, Buffer.from([0, 1, 255])); await assert.rejects(open('discard')); assert.equal(documents.snapshot!.id, draft.id)
  await writeFile(next, '{"v":1}\n'); const guard = dirs.guard()
  await assert.rejects(documents.select(next, draft, async () => { dirs.revoke(); return 'discard' }, guard, async () => { await dirs.file(selected.id, node.id, guard) }))
  assert.equal(documents.snapshot!.id, draft.id); assert.equal(await readFile(first, 'utf8'), '\ufeffone\r\n')
  await documents.save(draft, current); assert.equal(await readFile(first, 'utf8'), '\ufeffdirty\r\n')
  const failure = documentFailure(new Error(first)); assert.doesNotMatch(JSON.stringify(failure), /first\.ts/)
}))
test('shared Explorer state commits active file only after confirmed EditorSession opening', async () => fixture(async path => {
  await writeFile(join(path, 'one.txt'), 'one'); await writeFile(join(path, 'two.txt'), 'two')
  const dirs = new DirectoryStore(), docs = new DocumentStore(); let decision: 'save' | 'discard' | 'cancel' = 'cancel'
  const editor = new EditorSession({ open: async () => ({ ok: true, document: null }), save: async draft => ({ ok: true, document: await docs.save(draft, current) }), release: async () => ({ ok: true, document: null }), close: async () => ({ ok: true, document: null }), onCloseRequested: () => () => {} })
  const explorer = new ExplorerSession({ select: () => dirs.select(path, current), list: (r, n) => dirs.list(r, n, current), release: async r => dirs.release(r), open: async (r, n, draft) => {
    try { return await docs.select(await dirs.file(r, n, current), draft, async () => decision, current, async () => { await dirs.file(r, n, current) }) } catch (error) { return documentFailure(error) }
  } }, editor)
  await explorer.select(); const selected = explorer.snapshot().root!, [one, two] = explorer.snapshot().children.get(selected.id) as ExplorerNode[]
  await explorer.open(one!); editor.edit('draft'); await explorer.open(two!)
  assert.equal(explorer.snapshot().active, one!.id); assert.equal(editor.snapshot().text, 'draft')
  decision = 'save'; await explorer.open(two!); assert.equal(explorer.snapshot().active, two!.id); assert.equal(await readFile(join(path, 'one.txt'), 'utf8'), 'draft')
  await assert.rejects(dirs.file(selected.id, one!.id, current), denied('stale')); await explorer.refresh()
  const refreshed = explorer.snapshot().children.get(selected.id)!.find(n => n.name === 'one.txt')!; assert.notEqual(refreshed.id, one!.id)
  await explorer.release(); assert.equal(explorer.snapshot().root, null); assert.equal(editor.snapshot().text, 'two')
}))
