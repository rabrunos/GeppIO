import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginStore, inspectPackage } from '../src/main/plugins.ts'
import { parseManifest, parseWidgetView, PLUGIN_LIMITS } from '../src/shared/plugins.ts'

const manifest = { schemaVersion: 1, apiVersion: 1, id: 'test.plugin', name: 'Teste local', version: '1.0.0', entry: 'entry.js', widgets: [] }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'semnome-plugin-test-'))
  const source = join(root, 'source'); await mkdir(source)
  await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest)); await writeFile(join(source, 'entry.js'), 'export function activate() { return { dispose() {} } }')
  return { root, source, installed: join(root, 'managed'), clean: () => rm(root, { recursive: true, force: true }) }
}
test('versioned manifests reject paths, IDs, schemas, duplicate widgets and unknown capabilities', () => {
  assert.equal(parseManifest(JSON.stringify(manifest)).widgets.length, 0)
  for (const override of [{ id: '../escape' }, { id: 'CON' }, { id: 'con.foo' }, { id: 'constructor' }, { entry: '../entry.js' }, { entry: 'C:/entry.js' }, { entry: 'nested\\entry.js' }, { entry: 'nested//entry.js' }, { entry: 'nul.js' }, { entry: 'entry.' }, { version: '01.0.0' }, { version: '1.0.0-01' }, { apiVersion: 2 }, { schemaVersion: 2 }, { permissions: ['filesystem'] }, { widgets: [{ id: 'same', title: 'A', surface: 'declarative' }, { id: 'same', title: 'B', surface: 'declarative' }] }, { widgets: [{ id: 'a', title: 'A', surface: 'html' }] }]) assert.throws(() => parseManifest(JSON.stringify({ ...manifest, ...override })))
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
    const url = `semnome://app/plugins/${manifest.id}/${installed.revision}/entry.js`
    assert.equal(installed.enabled, false); assert.equal(store.asset(url), null)
    await assert.rejects(store.install(f.source), /ID/)
    await store.setEnabled(manifest.id, true)
    assert.match(new TextDecoder().decode(store.asset(url)!), /activate/)
    await writeFile(join(f.source, 'entry.js'), 'changed source')
    assert.match(new TextDecoder().decode(store.asset(url)!), /activate/)
    for (const invalid of [url.replace('semnome:', 'file:'), url.replace('app/', 'other/'), url + '?x', url + '#x', url.replace('entry.js', '../entry.js'), url.replace('entry.js', '%2e%2e%2fentry.js'), url.replace('entry.js', 'plugin.json'), url.replace(installed.revision, 'wrong'), url.replace('entry.js', '%5centry.js')]) assert.equal(store.asset(invalid), null)
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
