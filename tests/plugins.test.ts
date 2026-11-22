import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginStore, inspectPackage } from '../src/main/plugins.ts'
import { parseManifest, parseWidgetView, PLUGIN_LIMITS } from '../src/shared/plugins.ts'

const manifest = { schemaVersion: 1, apiVersion: 1, id: 'test.plugin', name: 'Teste local', version: '1.0.0', entry: 'entry.js', widgets: [] }
async function fixture(apiVersion = 1) {
  const root = await mkdtemp(join(tmpdir(), 'geppio-plugin-test-'))
  const source = join(root, 'source'); await mkdir(source)
  await writeFile(join(source, 'plugin.json'), JSON.stringify({ ...manifest, apiVersion })); await writeFile(join(source, 'entry.js'), 'export function activate() { return { dispose() {} } }')
  return { root, source, installed: join(root, 'managed'), clean: () => rm(root, { recursive: true, force: true }) }
}
test('versioned manifests reject paths, IDs, schemas, duplicate widgets and unknown capabilities', () => {
  assert.equal(parseManifest(JSON.stringify(manifest)).widgets.length, 0)
  for (const override of [{ id: '../escape' }, { id: 'CON' }, { id: 'con.foo' }, { id: 'constructor' }, { entry: '../entry.js' }, { entry: 'C:/entry.js' }, { entry: 'nested\\entry.js' }, { entry: 'nested//entry.js' }, { entry: 'nul.js' }, { entry: 'entry.' }, { version: '01.0.0' }, { version: '1.0.0-01' }, { apiVersion: 3 }, { schemaVersion: 2 }, { permissions: ['filesystem'] }, { widgets: [{ id: 'same', title: 'A', surface: 'declarative' }, { id: 'same', title: 'B', surface: 'declarative' }] }, { widgets: [{ id: 'a', title: 'A', surface: 'html' }] }]) assert.throws(() => parseManifest(JSON.stringify({ ...manifest, ...override })))
  assert.throws(() => parseManifest(' '.repeat(PLUGIN_LIMITS.manifestBytes + 1)))
  assert.throws(() => parseWidgetView({ text: 'x', html: '<script>' }))
  assert.throws(() => parseWidgetView({ text: 'x', action: { id: '../x', label: 'X' } }))
  assert.deepEqual(parseWidgetView({ text: '<b>literal text</b>' }), { text: '<b>literal text</b>' })
})
test('install stays disabled; enable, discovery, immutable assets and restart persist; duplicate IDs fail', async () => {
  const f = await fixture()
  try {
    const store = new PluginStore(f.installed)
    const inventory = await store.install(f.source), installed = inventory.plugins[0]!
    const url = `geppio://app/plugins/${manifest.id}/${installed.revision}/entry.js`
    assert.equal(installed.enabled, false); assert.equal(store.asset(url), null)
    await assert.rejects(store.install(f.source), /ID/)
    await store.setEnabled(manifest.id, true)
    assert.match(new TextDecoder().decode(store.asset(url)!), /activate/)
    await writeFile(join(f.source, 'entry.js'), 'changed source')
    assert.match(new TextDecoder().decode(store.asset(url)!), /activate/)
    for (const invalid of [url.replace('geppio:', 'semnome:'), url.replace('geppio:', 'file:'), url.replace('app/', 'other/'), url + '?x', url + '#x', url.replace('entry.js', '../entry.js'), url.replace('entry.js', '%2e%2e%2fentry.js'), url.replace('entry.js', 'plugin.json'), url.replace(installed.revision, 'wrong'), url.replace('entry.js', '%5centry.js')]) assert.equal(store.asset(invalid), null)
    const restarted = new PluginStore(f.installed)
    assert.equal((await restarted.list()).plugins[0]!.enabled, true)
    assert.ok(restarted.asset(url))
    await restarted.setEnabled(manifest.id, false); assert.equal(restarted.asset(url), null)
    await restarted.remove(manifest.id); assert.equal((await new PluginStore(f.installed).list()).plugins.length, 0)
    await restarted.install(f.source)
    assert.notEqual((await restarted.list()).plugins[0]!.revision, installed.revision)
  } finally { await f.clean() }
})
test('inspection rejects missing module, invalid JSON, unsupported files, oversized packages and directory links', async () => {
  const f = await fixture()
  try {
    await rm(join(f.source, 'entry.js')); await assert.rejects(inspectPackage(f.source), /entrada/)
    await writeFile(join(f.source, 'entry.js'), 'module')
    await writeFile(join(f.source, 'plugin.json'), '{'); await assert.rejects(inspectPackage(f.source))
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify(manifest))
    await writeFile(join(f.source, 'executable.exe'), 'x'); await assert.rejects(inspectPackage(f.source), /Tipo/); await rm(join(f.source, 'executable.exe'))
    await writeFile(join(f.source, 'entry.js'), 'x'.repeat(PLUGIN_LIMITS.fileBytes + 1)); await assert.rejects(inspectPackage(f.source), /tamanho/)
    await writeFile(join(f.source, 'entry.js'), 'module')
    const outside = join(f.root, 'outside'); await mkdir(outside)
    await symlink(outside, join(f.source, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(inspectPackage(f.source), /link/)
  } finally { await f.clean() }
})
test('corrupt persisted state is preserved and blocks mutations', async () => {
  const f = await fixture()
  try {
    await mkdir(f.installed); await writeFile(join(f.installed, 'state.json'), '{broken owner state')
    const store = new PluginStore(f.installed)
    await assert.rejects(store.list(), /preservados/); await assert.rejects(store.install(f.source), /preservados/)
    assert.equal(await readFile(join(f.installed, 'state.json'), 'utf8'), '{broken owner state')
  } finally { await f.clean() }
})
test('inspection bounds total package bytes and file count before installation', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 5; i++) await writeFile(join(f.source, `large-${i}.js`), 'x'.repeat(PLUGIN_LIMITS.fileBytes))
    await assert.rejects(inspectPackage(f.source), /2 MiB/)
    for (let i = 0; i < 5; i++) await rm(join(f.source, `large-${i}.js`))
    for (let i = 0; i < PLUGIN_LIMITS.files; i++) await writeFile(join(f.source, `file-${i}.js`), 'x')
    await assert.rejects(inspectPackage(f.source), /arquivos/)
  } finally { await f.clean() }
})
test('broken installed package is reported beside healthy packages and can be removed', async () => {
  const f = await fixture()
  try {
    const store = new PluginStore(f.installed); await store.install(f.source)
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify({ ...manifest, id: 'other.plugin' })); await store.install(f.source)
    await writeFile(join(f.installed, 'packages', manifest.id, 'plugin.json'), '{}')
    const inventory = await store.list()
    assert.equal(inventory.plugins.length, 1); assert.equal(inventory.errors.length, 1)
    await assert.rejects(store.setEnabled(manifest.id, true))
    await store.remove(manifest.id); assert.deepEqual((await store.list()).errors, [])
    await assert.rejects(store.remove('../escape'))
  } finally { await f.clean() }
})
test('concurrent duplicate installs serialize and failed state write rolls back copied package', async () => {
  const f = await fixture()
  try {
    const store = new PluginStore(f.installed)
    const outcomes = await Promise.allSettled([store.install(f.source), store.install(f.source)])
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
    await store.remove(manifest.id)
    await rm(join(f.installed, 'state.json'))
    await mkdir(join(f.installed, 'state.json'))
    await assert.rejects(store.install(f.source))
    assert.deepEqual((await store.list()).plugins, [])
  } finally { await f.clean() }
})
test('failed preference mutations preserve enable state and restore a removal; replaced managed roots are rejected', async () => {
  const f = await fixture()
  try {
    const store = new PluginStore(f.installed); await store.install(f.source)
    const statePath = join(f.installed, 'state.json'), original = await readFile(statePath, 'utf8')
    await rm(statePath); await mkdir(statePath)
    await assert.rejects(store.setEnabled(manifest.id, true))
    assert.equal((await store.list()).plugins[0]!.enabled, false)
    await assert.rejects(store.remove(manifest.id))
    assert.equal((await store.list()).plugins.length, 1)
    await rm(statePath, { recursive: true }); await writeFile(statePath, original)
    await store.remove(manifest.id)
    const packageRoot = join(f.installed, 'packages'), outside = join(f.root, 'untouched')
    await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'preserve')
    await rm(packageRoot, { recursive: true }); await symlink(outside, packageRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(store.install(f.source), /Diretório/)
    await assert.rejects(store.remove(manifest.id), /Diretório/)
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'preserve')
  } finally { await f.clean() }
})

async function managementFixture() {
  const f = await fixture(2)
  const faults: {
    beforeRename?(from: string, to: string): void | Promise<void>
    afterRename?(from: string, to: string): void | Promise<void>
    beforeRemove?(path: string): void
  } = {}
  const store = new PluginStore(f.installed, undefined, {
    async rename(from, to) { await faults.beforeRename?.(from, to); await rename(from, to); await faults.afterRename?.(from, to) },
    async remove(path, options) { faults.beforeRemove?.(path); await rm(path, options) }
  })
  try {
    const id = manifest.id
    await store.install(f.source)
    const [registration] = (await store.setEnabled(id, true)).plugins
    assert.ok(registration)
    // Management and the data consumer have independent owner identities.
    const token = await store.beginData(7, id, registration.revision)
    const saved = await store.dataOperation(7, token, 'write', 0, { schemaVersion: 1, value: 'retain' })
    const statePath = join(f.installed, 'state.json'), pkg = join(f.installed, 'packages', id)
    const dataPath = join(f.root, 'plugin-data', registration.revision + '.json')
    return { ...f, id, store, faults, token, saved, registration, statePath, pkg, dataPath,
      prefs: await readFile(statePath), data: await readFile(dataPath), entry: await readFile(join(pkg, 'entry.js')),
      asset: `geppio://app/plugins/${id}/${registration.revision}/entry.js` }
  } catch (error) { await f.clean(); throw error }
}

test('owner expiry in the preference queue prevents both enable and removal from reaching publication', async () => {
  const f = await managementFixture()
  let release!: () => void
  const proceed = new Promise<void>(resolve => { release = resolve })
  try {
    let entered!: () => void, renames = 0
    const atPublication = new Promise<void>(resolve => { entered = resolve })
    f.faults.beforeRename = async () => { renames++; entered(); await proceed }
    const earlier = f.store.setEnabled(f.id, false)
    await atPublication
    const owner = f.store.ownerGuard(12)
    const pending = Promise.allSettled([f.store.setEnabled(f.id, true, owner), f.store.remove(f.id, owner)])
    f.store.revokeOwner(12); release(); await earlier
    assert.deepEqual((await pending).map(result => result.status), ['rejected', 'rejected'])
    assert.equal(renames, 1)
    assert.deepEqual(await readFile(f.dataPath), f.data)
    assert.deepEqual((await new PluginStore(f.installed).list()).plugins, [{ ...f.registration, enabled: false }])
  } finally { release(); await f.clean() }
})

for (const failure of ['expiry', 'preference refusal', 'lost move result'] as const) test(`removal restores the original managed package after ${failure} before publication`, async () => {
  const f = await managementFixture()
  try {
    let tombstone: string | undefined, publicationAttempts = 0
    const owner = f.store.ownerGuard(12)
    f.faults.afterRename = (from, to) => {
      if (from !== f.pkg) return
      tombstone = to
      if (failure === 'expiry') f.store.revokeOwner(12)
      if (failure === 'lost move result') throw new Error('Move completed but reply unavailable')
    }
    f.faults.beforeRename = (_from, to) => { if (to === f.statePath) { publicationAttempts++; throw new Error('Preference rename refused') } }
    await assert.rejects(f.store.remove(f.id, owner))
    assert.ok(tombstone)
    assert.equal(publicationAttempts, failure === 'preference refusal' ? 1 : 0)
    await assert.rejects(readdir(tombstone), { code: 'ENOENT' })
    assert.deepEqual(await readFile(join(f.pkg, 'entry.js')), f.entry)
    assert.deepEqual(await readFile(f.statePath), f.prefs)
    assert.deepEqual(await readFile(f.dataPath), f.data)
    assert.deepEqual(await f.store.dataOperation(7, f.token, 'read'), f.saved)
    assert.deepEqual((await new PluginStore(f.installed).list()).plugins, [f.registration])
  } finally { await f.clean() }
})

for (const operation of ['disable', 'remove'] as const) test(`committed ${operation} survives owner expiry and a lost rename result`, async () => {
  const f = await managementFixture()
  try {
    let committed = 0
    const owner = f.store.ownerGuard(12)
    f.faults.afterRename = (_from, to) => {
      if (to === f.statePath) { committed++; f.store.revokeOwner(12); throw new Error('Result unavailable after real rename') }
    }
    // Delivery to the old caller is irrelevant to the state visible to a fresh owner.
    await Promise.allSettled([operation === 'disable' ? f.store.setEnabled(f.id, false, owner) : f.store.remove(f.id, owner)])
    assert.equal(committed, 1)
    assert.equal(f.store.asset(f.asset), null)
    await assert.rejects(f.store.dataOperation(7, f.token, 'read'))
    const expected = operation === 'disable' ? [{ ...f.registration, enabled: false }] : []
    assert.deepEqual((await f.store.list()).plugins, expected)
    assert.deepEqual((await new PluginStore(f.installed).list()).plugins, expected)
    assert.deepEqual(await readFile(f.dataPath), f.data)
    if (operation === 'remove') assert.deepEqual(await readdir(join(f.installed, 'packages')), [])
  } finally { await f.clean() }
})

for (const failure of ['unknown publication', 'rollback', 'cleanup'] as const) test(`uncertain removal after ${failure} retains recovery bytes and reports a path-free error`, async () => {
  const f = await managementFixture()
  try {
    let tombstone = ''
    f.faults.afterRename = (from, to) => { if (from === f.pkg) tombstone = to }
    f.faults.beforeRename = async (from, to) => {
      if (to === f.statePath && failure === 'unknown publication') {
        // A third-party state cannot prove which value our native call published.
        await writeFile(f.statePath, JSON.stringify({ ...JSON.parse(f.prefs.toString()), developerMode: true }))
        throw new Error('Uncertain: ' + f.statePath)
      }
      if (failure === 'rollback' && (to === f.statePath || from === tombstone)) throw new Error('Refused: ' + to)
    }
    f.faults.beforeRemove = path => { if (failure === 'cleanup' && path === tombstone) throw new Error('Refused: ' + path) }
    await assert.rejects(f.store.remove(f.id), (error: Error) => {
      assert.ok(!error.message.includes(f.root))
      assert.match(error.message, /recuper|incert|confirm|limpeza/i)
      return true
    })
    assert.ok(tombstone)
    assert.deepEqual(await readFile(join(tombstone, 'entry.js')), f.entry)
    assert.deepEqual(await readFile(f.dataPath), f.data)
    assert.equal(f.store.asset(f.asset), null)
    await assert.rejects(f.store.dataOperation(7, f.token, 'read'))
    const actual = JSON.parse(await readFile(f.statePath, 'utf8'))
    if (failure === 'cleanup') {
      assert.equal(actual.plugins[f.id], undefined)
      assert.deepEqual((await new PluginStore(f.installed).list()).plugins, [])
    } else {
      assert.equal(actual.plugins[f.id].revision, f.registration.revision)
      if (failure === 'unknown publication') assert.equal(actual.developerMode, true)
      else assert.deepEqual(await readFile(f.statePath), f.prefs)
    }
  } finally { await f.clean() }
})

test('a divergent preferences file immediately revokes other installations whose authority may also have changed', async () => {
  const f = await managementFixture()
  try {
    const otherId = 'test.secondary'
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify({ ...manifest, id: otherId, apiVersion: 2 }))
    await f.store.install(f.source)
    const other = (await f.store.setEnabled(otherId, true)).plugins.find(item => item.manifest.id === otherId)!
    const asset = `geppio://app/plugins/${otherId}/${other.revision}/entry.js`
    const token = await f.store.beginData(8, otherId, other.revision)
    assert.ok(f.store.asset(asset))
    assert.equal((await f.store.dataOperation(8, token, 'read')).revision, 0)
    f.faults.beforeRename = async (_from, to) => {
      if (to !== f.statePath) return
      const third = JSON.parse(await readFile(f.statePath, 'utf8'))
      third.plugins[otherId].enabled = false
      await writeFile(f.statePath, JSON.stringify(third))
      throw new Error('Unconfirmed preference replacement')
    }
    await assert.rejects(f.store.setEnabled(f.id, false))
    assert.equal(f.store.asset(asset), null)
    await assert.rejects(f.store.dataOperation(8, token, 'read'))
    const fresh = await f.store.list()
    assert.equal(fresh.plugins.find(item => item.manifest.id === otherId)?.enabled, false)
    assert.deepEqual(fresh.plugins.find(item => item.manifest.id === f.id), f.registration)
    assert.deepEqual((await new PluginStore(f.installed).list()).plugins, fresh.plugins)
  } finally { await f.clean() }
})
