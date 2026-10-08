import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareProfile, snapshotTree, recoveryProfile, BACKUP_DIRECTORY, validatedTestProfile } from '../src/main/profile-migration.ts'
import { migratedLayout } from '../src/shared/layout-migration.ts'
import { IDENTITY } from '../src/shared/identity.ts'
import { DEFAULT_LAYOUT, MINIMUMS } from '../src/renderer/src/fixtures.ts'
import { PluginStore } from '../src/main/plugins.ts'
import { recoveryURL, recoveryResponse, rendererAsset, DEVELOPMENT_CSP } from '../src/main/security.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'geppio-migration-test-'))
  return { root, old: join(root, 'semnome'), next: join(root, 'geppio'), clean: () => rmSync(root, { recursive: true, force: true }) }
}
test('identity is coherent; legacy protocol and recovery URLs have no normal asset authority', async () => {
  assert.equal(IDENTITY.name, 'GeppIO'); assert.equal(IDENTITY.protocol, 'geppio'); assert.equal(IDENTITY.directory, 'geppio')
  assert.equal(IDENTITY.layoutStorageKey, 'geppio:layout:v1')
  assert.equal(rendererAsset('/bundled', 'semnome://app/index.html'), null)
  assert.ok(DEVELOPMENT_CSP.includes('geppio://app')); assert.ok(!DEVELOPMENT_CSP.includes('semnome://'))
  const url = recoveryURL('semnome', null)
  for (const value of [url + '?x', url + '#x', 'semnome://other/identity-recovery.html', 'semnome://app/index.html', 'semnome://app/plugins/local.counter/entry.js', 'https://example.com']) assert.equal(recoveryResponse(value, 'GET', url).status, 403)
  assert.equal(recoveryResponse(url, 'POST', url).status, 403)
  const response = recoveryResponse(url, 'GET', url)
  assert.match(response.headers.get('Content-Security-Policy')!, /script-src 'none'/)
  assert.ok(!(await response.text()).includes('<script'))
  assert.equal(recoveryURL('geppio', 'http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/identity-recovery.html')
  assert.throws(() => recoveryURL('geppio', 'http://localhost:5173/')); assert.throws(() => recoveryURL('https', null))
})
test('copy preserves old bytes, installed IDs, revisions and both enabled preferences across restarts', async () => {
  const f = fixture()
  try {
    mkdirSync(f.old); const source = join(f.root, 'package'); mkdirSync(source)
    writeFileSync(join(source, 'entry.js'), 'export function activate() { return { dispose() {} } }')
    const oldStore = new PluginStore(join(f.old, 'plugins'))
    for (const id of ['local.counter', 'local.pulse']) {
      writeFileSync(join(source, 'plugin.json'), JSON.stringify({ schemaVersion: 1, apiVersion: 1, id, name: id, version: '1.0.0', entry: 'entry.js', widgets: [] }))
      await oldStore.install(source)
    }
    await oldStore.setEnabled('local.counter', true)
    mkdirSync(join(f.old, 'Local Storage')); writeFileSync(join(f.old, 'Local Storage', 'synthetic-leveldb'), Buffer.from([0, 255, 1, 20]))
    writeFileSync(join(f.old, 'not-migrated-private-cache'), 'not copied')
    const oldBytes = snapshotTree(f.old), oldInventory = await oldStore.list()
    assert.equal(prepareProfile(f.old, f.next), 'copied')
    assert.deepEqual(snapshotTree(f.old), oldBytes)
    assert.deepEqual(await new PluginStore(join(f.next, 'plugins')).list(), oldInventory)
    assert.deepEqual(readFileSync(join(f.next, BACKUP_DIRECTORY, 'Local Storage', 'synthetic-leveldb')), Buffer.from([0, 255, 1, 20]))
    assert.ok(!readdirSync(f.next).includes('not-migrated-private-cache'))
    await new PluginStore(join(f.next, 'plugins')).setEnabled('local.counter', false)
    const newBytes = snapshotTree(f.next)
    assert.equal(prepareProfile(f.old, f.next), 'existing'); assert.deepEqual(snapshotTree(f.next), newBytes)
    assert.equal((await oldStore.list()).plugins[0]!.enabled, true)
    const recovery = recoveryProfile(f.next)!
    writeFileSync(join(recovery, 'Local Storage', 'synthetic-leveldb'), 'derived changes')
    assert.equal(recoveryProfile(f.next), recovery)
    assert.deepEqual(readFileSync(join(f.next, BACKUP_DIRECTORY, 'Local Storage', 'synthetic-leveldb')), Buffer.from([0, 255, 1, 20]))
  } finally { f.clean() }
})
test('corrupt plugin state copies verbatim, blocks management and does not erase either profile', async () => {
  const f = fixture()
  try {
    mkdirSync(join(f.old, 'plugins'), { recursive: true }); writeFileSync(join(f.old, 'plugins', 'state.json'), '{bad state')
    prepareProfile(f.old, f.next)
    await assert.rejects(new PluginStore(join(f.next, 'plugins')).list(), /preservados/)
    for (const profile of [f.old, f.next]) assert.equal(readFileSync(join(profile, 'plugins', 'state.json'), 'utf8'), '{bad state')
  } finally { f.clean() }
})
test('existing destination, including corrupt data, is preserved; links/oversize sources fail before creating a target', () => {
  const f = fixture()
  try {
    mkdirSync(f.old); mkdirSync(f.next); writeFileSync(join(f.next, 'keep'), '{corrupt but preserved')
    const before = snapshotTree(f.next)
    assert.equal(prepareProfile(f.old, f.next), 'existing'); assert.deepEqual(snapshotTree(f.next), before)
    rmSync(f.next, { recursive: true })
    const outside = join(f.root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'keep'), 'untouched')
    symlinkSync(outside, join(f.old, 'plugins'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => prepareProfile(f.old, f.next), /regular/)
    assert.ok(!readdirSync(f.root).includes('geppio')); assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'untouched')
    rmSync(join(f.old, 'plugins')); mkdirSync(join(f.old, 'Local Storage'))
    writeFileSync(join(f.old, 'Local Storage', 'oversized'), Buffer.alloc(128 * 1024 * 1024 + 1))
    assert.throws(() => prepareProfile(f.old, f.next), /limit/)
    assert.ok(!readdirSync(f.root).some(name => name.startsWith('.geppio-migration-')))
  } finally { f.clean() }
})
test('new and missing legacy profiles are deterministic; nested links and same-directory migration fail', () => {
  const f = fixture()
  try {
    assert.equal(prepareProfile(f.old, f.next), 'fresh'); assert.equal(recoveryProfile(f.next), null)
    assert.throws(() => prepareProfile(f.next, f.next), /separate/)
    rmSync(f.next, { recursive: true }); mkdirSync(join(f.old, 'plugins'), { recursive: true })
    const outside = join(f.root, 'outside'); mkdirSync(outside)
    symlinkSync(outside, join(f.old, 'plugins', 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => prepareProfile(f.old, f.next), /links/)
    assert.ok(!readdirSync(f.root).includes('geppio'))
  } finally { f.clean() }
})
test('layout transfer validates bounds/schema and never replaces any new value or legacy bytes', () => {
  const old = JSON.stringify({ ...DEFAULT_LAYOUT, theme: 'light' })
  const next = migratedLayout(old, null, DEFAULT_LAYOUT, MINIMUMS)
  assert.deepEqual(JSON.parse(next!), { ...DEFAULT_LAYOUT, theme: 'light' })
  assert.equal(migratedLayout(old, next, DEFAULT_LAYOUT, MINIMUMS), null)
  for (const current of ['', '{corrupt', JSON.stringify(DEFAULT_LAYOUT)]) assert.equal(migratedLayout(old, current, DEFAULT_LAYOUT, MINIMUMS), null)
  assert.equal(migratedLayout(null, null, DEFAULT_LAYOUT, MINIMUMS), null)
  for (const invalid of ['{corrupt', ' '.repeat(64 * 1024 + 1), JSON.stringify({ ...DEFAULT_LAYOUT, schemaVersion: 2 }), JSON.stringify({ ...DEFAULT_LAYOUT, placements: [] }), JSON.stringify({ ...DEFAULT_LAYOUT, placements: DEFAULT_LAYOUT.placements.map(p => ({ ...p, x: 9 })) })]) assert.throws(() => migratedLayout(invalid, null, DEFAULT_LAYOUT, MINIMUMS))
})
test('smoke overrides reject owner/legacy roots, relative paths and linked ancestors', () => {
  const f = fixture()
  try {
    const valid = join(f.root, 'geppio-smoke-synthetic'), outside = join(f.root, 'owner')
    mkdirSync(valid); mkdirSync(outside)
    assert.equal(validatedTestProfile(valid, f.root), valid)
    for (const invalid of [f.root, outside, '.', join(f.root, 'semnome-smoke-old'), join(f.root, '..', 'geppio-smoke-escape')]) assert.throws(() => validatedTestProfile(invalid, f.root))
    mkdirSync(join(outside, 'nested'))
    const link = join(f.root, 'geppio-smoke-link')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => validatedTestProfile(link, f.root))
    assert.throws(() => validatedTestProfile(join(link, 'nested'), f.root), /Linked/)
  } finally { f.clean() }
})
