import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { DirectoryStore } from '../src/main/explorer.ts'
import { DocumentStore } from '../src/main/documents.ts'
import { moveExplorerFile, mutateExplorer } from '../src/main/explorer-write.ts'
import type { ExplorerMutation } from '../src/shared/explorer.ts'
import { EXPLORER_LIMITS } from '../src/shared/explorer.ts'

const current = () => true, unbound = () => false
async function fixture(t: TestContext) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'geppio-explorer-write-')))
  t.after(() => rm(temp, { recursive: true, force: true, maxRetries: 4 }))
  const path = join(temp, 'project'); await mkdir(path)
  const dirs = new DirectoryStore(); await dirs.select(path, current)
  const root = dirs.snapshot!.id
  async function children(parent = root) {
    const result = await dirs.list(root, parent, current); assert.ok(result.ok); return result.children!
  }
  function mutate(op: ExplorerMutation, id: string, name: string) { return mutateExplorer(dirs, op, root, id, name, current, unbound) }
  return { temp, path, dirs, root, children, mutate }
}

test('creates one empty witnessed file or folder and reacquires the exact created node through a listing', async t => {
  const { path, dirs, root, children, mutate } = await fixture(t)
  const folder = await mutate('create-directory', root, 'pasta com espaços')
  assert.equal(folder.outcome, 'confirmed')
  const parent = (await children())[0]!
  const name = "dado $ & ` [x] ' Ω.txt", location = join(path, parent.name, name)
  const file = await mutate('create-file', parent.id, name)
  assert.equal(file.outcome, 'confirmed'); assert.ok(file.createdNode)
  assert.deepEqual(await readFile(location), Buffer.alloc(0))
  assert.equal(await dirs.file(root, file.createdNode, current), location)
  assert.equal((await children(parent.id))[0]!.id, file.createdNode)
  await rename(location, location + '.old'); await writeFile(location, 'independent')
  await assert.rejects(dirs.file(root, file.createdNode, current))
  assert.notEqual((await children(parent.id))[0]!.id, file.createdNode)
  assert.equal((await mutate('create-file', parent.id, name)).outcome, 'refused')
  assert.equal((await mutate('create-directory', parent.id, name)).outcome, 'refused')
  assert.equal(await readFile(location, 'utf8'), 'independent')
  for (const result of [file, folder]) assert.ok(!JSON.stringify(result).includes(path))
})

test('explicit Windows helper renames only the selected ordinary file and treats project names, modules and profiles as inert data', { skip: process.platform !== 'win32' }, async t => {
  const { path, root, children, mutate } = await fixture(t)
  const source = "src (Ω) ` [&] $.txt", destination = "a ' [ê] $ `;&.txt"
  await writeFile(join(path, source), 'unchanged bytes')
  const marker = join(path, 'unexpected-profile-or-module')
  const sentinel = "[IO.File]::WriteAllText('" + marker.replaceAll("'", "''") + "', 'unexpected'); throw 'inactive test sentinel'"
  await writeFile(join(path, 'Microsoft.PowerShell_profile.ps1'), sentinel)
  const modules = join(path, 'Modules', 'Microsoft.PowerShell.Utility')
  await mkdir(modules, { recursive: true }); await writeFile(join(modules, 'Microsoft.PowerShell.Utility.psm1'), sentinel)
  const keys = ['PSModulePath', 'PATH', 'USERPROFILE'] as const
  const previous = keys.map(key => process.env[key])
  try {
    process.env.PSModulePath = join(path, 'Modules'); process.env.PATH = path; process.env.USERPROFILE = path
    const id = (await children()).find(n => n.name === source)!.id
    assert.equal((await mutate('rename-file', id, source.toUpperCase())).outcome, 'refused')
    const result = await mutate('rename-file', id, destination)
    assert.equal(result.outcome, 'confirmed', result.message)
    assert.equal(await readFile(join(path, destination), 'utf8'), 'unchanged bytes')
    await assert.rejects(lstat(join(path, source)), { code: 'ENOENT' })
    await assert.rejects(lstat(marker), { code: 'ENOENT' })
    assert.ok(!(await children(root)).some(node => node.id === id))
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i] }) }
})

test('destination that appears at helper submission wins without replacement or rollback', { skip: process.platform !== 'win32' }, async t => {
  const { path, dirs, root, children } = await fixture(t)
  const source = join(path, 'from'), dest = join(path, 'new')
  await writeFile(source, 'original')
  const id = (await children())[0]!.id
  const result = await mutateExplorer(dirs, 'rename-file', root, id, 'new', current, unbound, {
    move: (from, to, authorize, active) => moveExplorerFile(from, to, async () => {
      await authorize(); await writeFile(dest, 'other writer', { flag: 'wx' })
    }, active)
  })
  assert.equal(result.outcome, 'refused', result.message)
  assert.equal(await readFile(source, 'utf8'), 'original')
  assert.equal(await readFile(dest, 'utf8'), 'other writer')
})

test('the real helper receives no paths when authority expires before stdin; an elapsed deadline after stdin is uncertain', { skip: process.platform !== 'win32' }, async t => {
  const { path, dirs, root, children } = await fixture(t)
  const source = join(path, 'from'), dest = join(path, 'to')
  await writeFile(source, 'only original')
  const id = (await children())[0]!.id
  let owner = true, submitted = false
  const expired = await mutateExplorer(dirs, 'rename-file', root, id, 'to', () => owner, unbound, {
    move: (from, to, authorize, active, sent) => moveExplorerFile(from, to, async () => {
      await authorize(); owner = false
    }, active, () => { submitted = true; sent?.() })
  })
  assert.equal(expired.outcome, 'refused'); assert.equal(submitted, false)
  assert.equal(await readFile(source, 'utf8'), 'only original')
  await assert.rejects(lstat(dest), { code: 'ENOENT' })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const timedOut = await mutateExplorer(dirs, 'rename-file', root, id, 'to', current, unbound, {
    move: (from, to, authorize, active, sent) => moveExplorerFile(from, to, authorize, active, () => {
      submitted = true; sent?.(); queueMicrotask(() => t.mock.timers.tick(10000))
    })
  })
  assert.equal(submitted, true); assert.equal(timedOut.outcome, 'unconfirmed')
  const remaining = await Promise.all([source, dest].map(p => readFile(p, 'utf8').catch(err => {
    assert.equal(err.code, 'ENOENT'); return null
  })))
  assert.deepEqual(remaining.filter(value => value !== null), ['only original'])
})

test('simultaneous exclusive creates cannot replace the winning file', async t => {
  const { path, root, mutate } = await fixture(t)
  const results = await Promise.all([mutate('create-file', root, 'race'), mutate('create-file', root, 'race')])
  assert.deepEqual(results.map(value => value.outcome).sort(), ['confirmed', 'refused'])
  assert.equal(results.filter(value => value.createdNode).length, 1)
  assert.deepEqual(await readFile(join(path, 'race')), Buffer.alloc(0))
})

test('a blocked official executable refuses the rename and never starts a fallback process', { skip: process.platform !== 'win32' }, async t => {
  const { path, root, children, mutate } = await fixture(t)
  const from = join(path, 'old'), to = join(path, 'new')
  await writeFile(from, 'original')
  const id = (await children(root))[0]!.id
  const blocked = t.mock.method(childProcess, 'spawn', () => { throw Object.assign(new Error('execution denied'), { code: 'EACCES' }) })
  syncBuiltinESMExports()
  try {
    assert.equal((await mutate('rename-file', id, 'new')).outcome, 'refused')
    assert.equal(blocked.mock.callCount(), 1)
    assert.equal(await readFile(from, 'utf8'), 'original')
    await assert.rejects(lstat(to), { code: 'ENOENT' })
  } finally { blocked.mock.restore(); syncBuiltinESMExports() }
})

test('missing, relative or disagreeing Windows roots refuse the helper before any spawn', { skip: process.platform !== 'win32' }, async t => {
  const { path, root, children, mutate } = await fixture(t)
  const from = join(path, 'old'), to = join(path, 'new')
  await writeFile(from, 'original')
  const id = (await children(root))[0]!.id
  const keys = ['SystemRoot', 'WINDIR'] as const, original = keys.map(key => process.env[key])
  const observed = t.mock.method(childProcess, 'spawn', () => { throw new Error('unexpected spawn') })
  syncBuiltinESMExports()
  try {
    for (const pair of [[undefined, original[1]], [original[0], undefined], [original[0], path], ['relative', 'relative']]) {
      keys.forEach((key, i) => { if (pair[i] === undefined) delete process.env[key]; else process.env[key] = pair[i] })
      assert.equal((await mutate('rename-file', id, 'new')).outcome, 'refused')
    }
    assert.equal(observed.mock.callCount(), 0)
    assert.equal(await readFile(from, 'utf8'), 'original')
    await assert.rejects(lstat(to), { code: 'ENOENT' })
  } finally {
    keys.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i] })
    observed.mock.restore(); syncBuiltinESMExports()
  }
})

test('rejects revoked, bound, forged, linked, .git and malformed targets before mutation', async t => {
  const { temp, path, dirs, root, children, mutate } = await fixture(t)
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a:b', '.gIT', 'old~1.txt', 'con.txt', 'trailing.','p ', 'a\u0001']) {
    assert.equal((await mutate('create-file', root, name)).outcome, 'refused')
  }
  assert.equal((await mutate('create-file', randomUUID(), 'new')).outcome, 'refused')
  assert.equal((await mutateExplorer(dirs, 'create-file', randomUUID(), root, 'new', current, unbound)).outcome, 'refused')
  assert.equal((await mutateExplorer(dirs, 'create-file', root, root, 'new', () => false, unbound)).outcome, 'refused')
  const from = join(path, 'source'), other = join(temp, 'outside'); await writeFile(from, 'original'); await mkdir(other)
  let id = (await children()).find(node => node.name === 'source')!.id
  for (const guarded of [from, path, join(path, 'new')]) {
    assert.equal((await mutateExplorer(dirs, 'rename-file', root, id, 'new', current, p => p === guarded)).outcome, 'refused')
  }
  await link(from, join(other, 'link')); assert.equal((await mutate('rename-file', id, 'new')).outcome, 'refused')
  await symlink(other, join(path, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir')
  id = (await children()).find(node => node.name === 'redirect')!.id
  assert.equal((await mutate('create-file', id, 'new')).outcome, 'refused')
  await mkdir(join(path, 'sub')); const sub = (await children()).find(node => node.name === 'sub')!
  assert.equal((await mutate('rename-file', sub.id, 'new')).outcome, 'refused')
  await rename(join(path, 'sub'), join(path, 'old')); await mkdir(join(path, 'sub'))
  assert.equal((await mutate('create-file', sub.id, 'new')).outcome, 'refused')
  await mkdir(join(path, '.GiT', 'inside'), { recursive: true })
  for (const selected of [join(path, '.GiT'), join(path, '.GiT', 'inside')]) {
    await dirs.select(selected, current); const activeRoot = dirs.snapshot!.id
    assert.equal((await mutateExplorer(dirs, 'create-file', activeRoot, activeRoot, 'new', current, unbound)).outcome, 'refused')
    await assert.rejects(lstat(join(selected, 'new')), { code: 'ENOENT' })
  }
  await assert.rejects(lstat(join(path, 'new')), { code: 'ENOENT' })
  assert.equal(await readFile(from, 'utf8'), 'original')
})

test('honest uncertain outcomes retain created/replaced evidence; communication failure never triggers another rename', async t => {
  const { path, dirs, root, children } = await fixture(t)
  const file = join(path, 'created')
  const result = await mutateExplorer(dirs, 'create-file', root, root, 'created', current, unbound, { afterMutation: async () => {
    await rename(file, file + '.prior'); await writeFile(file, 'external', { flag: 'wx' })
  } })
  assert.equal(result.outcome, 'unconfirmed'); assert.equal(result.createdNode, undefined)
  assert.equal(await readFile(file, 'utf8'), 'external'); assert.equal((await readFile(file + '.prior')).length, 0)
  let owner = true
  const folder = await mutateExplorer(dirs, 'create-directory', root, root, 'folder', () => owner, unbound, { afterMutation: async () => { owner = false } })
  assert.equal(folder.outcome, 'unconfirmed'); assert.ok((await lstat(join(path, 'folder'))).isDirectory())
  const id = (await children()).find(n => n.name === 'created')!.id
  let calls = 0
  const denied = await mutateExplorer(dirs, 'rename-file', root, id, 'rename', current, unbound, { move: async () => { calls++; return 'denied' } })
  assert.equal(denied.outcome, 'refused')
  const lost = await mutateExplorer(dirs, 'rename-file', root, id, 'rename', current, unbound, {
    move: async (source, destination, authorize, _active, sent) => {
      calls++; await authorize(); sent?.(); await rename(source, destination); throw new Error('lost confirmation')
    }
  })
  assert.equal(lost.outcome, 'unconfirmed'); assert.equal(calls, 2); assert.equal(await readFile(join(path, 'rename'), 'utf8'), 'external')
})

test('an open move needs the exact grant and revision, refreshes the saved path, and expires old saves', { skip: process.platform !== 'win32' }, async t => {
  const { path, dirs, root, children } = await fixture(t), store = new DocumentStore()
  const source = join(path, 'Test.js'), destination = join(path, 'next.txt'), bytes = Buffer.from('\ufefflet x = 1\r\n')
  await writeFile(source, bytes)
  await store.select(join(path, 'TEST.js'), null, async () => 'cancel', current)
  const original = store.snapshot!, node = (await children())[0]!.id
  const move = (id: string, revision: string) => mutateExplorer(dirs, 'rename-file', root, node, 'next.txt', current, file => store.hasFileAt(file), { openFile: { store, binding: { id, revision } } })
  assert.equal((await move(randomUUID(), original.revision)).outcome, 'refused')
  assert.equal((await move(original.id, randomUUID())).outcome, 'refused')
  const result = await move(original.id, original.revision)
  assert.equal(result.outcome, 'confirmed'); assert.equal(result.renamed?.id, original.id)
  assert.notEqual(result.renamed?.revision, original.revision); assert.equal(store.filePath(original.id), destination)
  assert.deepEqual(await readFile(destination), bytes); await assert.rejects(lstat(source), { code: 'ENOENT' })
  const draft = { id: original.id, revision: original.revision, text: 'different\r\n' }
  await assert.rejects(store.save(draft, current), { kind: 'stale' })
  await store.save({ ...draft, revision: store.snapshot!.revision }, current)
  assert.deepEqual(await readFile(destination), Buffer.from('\ufeffdifferent\r\n')); await assert.rejects(lstat(source), { code: 'ENOENT' })
})

test('a lost helper reply blocks both names and every save until explicit same-file reconciliation', async t => {
  const { path, dirs, root, children } = await fixture(t), store = new DocumentStore()
  const source = join(path, 'before'), destination = join(path, 'after')
  await writeFile(source, 'base'); await store.select(source, null, async () => 'cancel', current)
  const snapshot = store.snapshot!, node = (await children())[0]!.id
  const draft = { id: snapshot.id, revision: snapshot.revision, text: 'unsaved' }
  let submissions = 0
  const lost = await mutateExplorer(dirs, 'rename-file', root, node, 'after', current, file => store.hasFileAt(file), {
    openFile: { store, binding: snapshot },
    move: async (from, to, authorize, _guard, sent) => {
      await authorize(); submissions++; sent?.(); await rename(from, to); return 'unknown'
    }
  })
  assert.equal(lost.outcome, 'unconfirmed'); assert.equal(submissions, 1)
  assert.ok(store.hasFileAt(source)); assert.ok(store.hasFileAt(destination)); assert.equal(store.filePath(snapshot.id), null)
  await writeFile(source, 'replacement', { flag: 'wx' })
  await assert.rejects(store.save(draft, current), { kind: 'unconfirmed' })
  await assert.rejects(store.resolveAll([draft], async () => 'save', current), { kind: 'unconfirmed' })
  await assert.rejects(store.select(destination, null, async () => 'cancel', current), { kind: 'unconfirmed' })
  let reconciled = await store.reload(draft, true, async () => false, current); assert.ok(reconciled.ok && reconciled.canceled)
  await assert.rejects(store.save(draft, current), { kind: 'unconfirmed' })
  reconciled = await store.reload(draft, true, async () => true, current)
  assert.ok(reconciled.ok && reconciled.document?.name === 'after')
  assert.equal(store.filePath(snapshot.id), destination); assert.equal(await readFile(source, 'utf8'), 'replacement')
  assert.equal(await readFile(destination, 'utf8'), 'base'); assert.equal(store.snapshots.length, 1)
})

test('renderer uncertainty after a refused move excludes saving on tab and window close', async t => {
  const { path } = await fixture(t), store = new DocumentStore(), file = join(path, 'original')
  await writeFile(file, 'on disk'); await store.select(file, null, async () => 'cancel', current)
  const { id, revision } = store.snapshot!, draft = { id, revision, text: 'draft', discardOnly: true as const }
  await assert.rejects(store.release(draft, async () => 'save', current), { kind: 'unconfirmed' })
  await assert.rejects(store.resolveAll([draft], async () => 'save', current), { kind: 'unconfirmed' })
  assert.equal(await store.resolveAll([draft], async () => 'cancel', current), false)
  assert.equal(store.snapshot?.id, id); assert.equal(await readFile(file, 'utf8'), 'on disk')
  const closed = await store.release(draft, async () => 'discard', current); assert.ok(closed.ok && !closed.document)
  assert.equal(await readFile(file, 'utf8'), 'on disk')
})

test('creation stays within visible Explorer quota and depth even when a fresh child could otherwise be created', async t => {
  const { path, dirs, root, children, mutate } = await fixture(t)
  await mkdir(join(path, 'full')); let parent = (await children())[0]!.id
  for (let i = 0; i < EXPLORER_LIMITS.entries; i += 32) {
    await Promise.all(Array.from({ length: Math.min(32, EXPLORER_LIMITS.entries - i) }, (_, j) => writeFile(join(path, 'full', 'n' + (i + j)), '')))
  }
  assert.equal((await mutate('create-file', parent, 'overflow')).outcome, 'refused')
  await assert.rejects(lstat(join(path, 'full', 'overflow')), { code: 'ENOENT' })
  let nested = path; parent = root
  for (let i = 0; i < EXPLORER_LIMITS.depth; i++) {
    nested = join(nested, 'd'); await mkdir(nested)
    const result = await dirs.list(root, parent, current); assert.ok(result.ok)
    parent = result.children!.find(n => n.name === 'd')!.id
  }
  assert.equal((await mutate('create-directory', parent, 'overflow')).outcome, 'refused')
  await assert.rejects(lstat(join(nested, 'overflow')), { code: 'ENOENT' })
})
