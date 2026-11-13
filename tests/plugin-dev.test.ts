import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { PluginStore, inspectPackage, packageDigest } from '../src/main/plugins.ts'
import { publicIdentity, signPluginPackage } from '../tools/plugin-package.ts'
import { initialWorkbench, widgetRegistry } from '../src/shared/workbench/model.ts'
import { addWidget } from '../src/shared/workbench/commands.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { initialWorkbench as demoWorkbench, widgetRegistry as demoRegistry } from './fixtures/workbench.ts'

const id = 'geppio.workspace-essentials', doc = { schemaVersion: 1 as const, value: { confirmed: 'retain exactly' } }
async function fixture(apiVersion = 2) {
  const root = await mkdtemp(join(tmpdir(), 'geppio-smoke-dev-unit-')), source = join(root, 'original'), managed = join(root, 'plugins')
  await mkdir(source)
  const manifest = { schemaVersion: 1, apiVersion, id, name: 'Fixture', version: '1.0.0', entry: 'entry.js', widgets: [{ id: 'notes', title: 'Notes', surface: 'declarative' }] }
  await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest)); await writeFile(join(source, 'entry.js'), 'export function activate() {}')
  const store = new PluginStore(managed)
  return { root, source, managed, manifest, store, clean: () => rm(root, { recursive: true, force: true }) }
}
const asset = (generation: string) => `geppio://app/plugins/${id}/${generation}/entry.js`
test('mode defaults off and Main gates source operations; fresh source is disabled and has no persistent code copy', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.store.list()).developerMode, false)
    await assert.rejects(f.store.loadExternal(f.source), /Modo desenvolvedor/)
    await assert.rejects(f.store.reload(id), /Modo desenvolvedor/)
    await assert.rejects(f.store.linkExternal(id, f.source), /Modo desenvolvedor/)
    await f.store.setDeveloperMode(true)
    const installed = (await f.store.loadExternal(f.source)).plugins[0]!
    assert.equal(installed.enabled, false); assert.equal(installed.source, 'external'); assert.notEqual(installed.generation, installed.revision)
    assert.equal(JSON.stringify(installed).includes(f.source), false)
    assert.deepEqual(await readdir(join(f.managed, 'packages')), [])
    assert.deepEqual(await readdir(join(f.managed, 'signed')), [])
    assert.equal(f.store.asset(asset(installed.generation!)), null)
    await assert.rejects(f.store.loadExternal(f.source), /conflitante/)
    await f.store.setEnabled(id, true); assert.ok(f.store.asset(asset(installed.generation!)))
  } finally { await f.clean() }
})
test('explicit reload alone accepts changed bytes, rotates code not data, revokes stale/queued channels and preserves rejected snapshot', async () => {
  const f = await fixture()
  try {
    await f.store.setDeveloperMode(true)
    const first = (await f.store.loadExternal(f.source)).plugins[0]!
    await f.store.setEnabled(id, true)
    const token = await f.store.beginData(1, id, first.revision, first.generation)
    await f.store.setDeveloperMode(true)
    assert.equal((await f.store.dataOperation(1, token, 'read')).revision, 0, 'Idempotent mode calls retain activation tokens')
    const saved = await f.store.dataOperation(1, token, 'write', 0, doc)
    const dataPath = join(f.root, 'plugin-data', first.revision + '.json'), bytes = await readFile(dataPath)
    await assert.rejects(f.store.beginData(1, id, randomUUID(), first.generation)); await assert.rejects(f.store.dataOperation(2, token, 'read'))
    const before = f.store.asset(asset(first.generation!))!
    await writeFile(join(f.source, 'entry.js'), 'export function activate() { /* rebuilt */ }')
    assert.equal((await f.store.list()).plugins[0]!.generation, first.generation)
    assert.deepEqual(f.store.asset(asset(first.generation!)), before)
    await assert.rejects(f.store.setEnabled(id, true), /Recarregar/)
    const operation = f.store.reload(id), stale = f.store.dataOperation(1, token, 'write', saved.revision, doc)
    const results = await Promise.allSettled([operation, stale]); assert.equal(results[1]!.status, 'rejected')
    assert.equal(results[0]!.status, 'fulfilled')
    const second = (await f.store.list()).plugins[0]!
    assert.equal(second.revision, first.revision); assert.notEqual(second.generation, first.generation); assert.equal(second.enabled, true)
    assert.equal(f.store.asset(asset(first.generation!)), null); assert.notDeepEqual(f.store.asset(asset(second.generation!)), before)
    await assert.rejects(f.store.beginData(1, id, first.revision, first.generation))
    const resumed = await f.store.beginData(1, id, first.revision, second.generation)
    assert.deepEqual(await f.store.dataOperation(1, resumed, 'read'), saved); assert.deepEqual(await readFile(dataPath), bytes)
    const state = await readFile(join(f.managed, 'state.json'))
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify({ ...f.manifest, id: 'wrong.plugin' }))
    await assert.rejects(f.store.reload(id), /manter o ID/)
    assert.deepEqual(await readFile(join(f.managed, 'state.json')), state)
    assert.ok(f.store.asset(asset(second.generation!))); assert.deepEqual(await f.store.dataOperation(1, resumed, 'read'), saved)
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify(f.manifest))
    await assert.rejects(f.store.reload(id, () => false), /expirada/)
    assert.deepEqual(await readFile(join(f.managed, 'state.json')), state); assert.ok(f.store.asset(asset(second.generation!)))
    await rm(join(f.source, 'entry.js')); await assert.rejects(f.store.reload(id)); assert.ok(f.store.asset(asset(second.generation!)))
  } finally { await f.clean() }
})
test('pause/resume and restart validate the accepted digest without fallback; disabled reload stays disabled; unregister preserves source', async () => {
  const f = await fixture()
  try {
    await f.store.setDeveloperMode(true); const first = (await f.store.loadExternal(f.source)).plugins[0]!
    await f.store.setEnabled(id, true); const token = await f.store.beginData(7, id, first.revision, first.generation)
    await f.store.dataOperation(7, token, 'write', 0, doc)
    const paused = (await f.store.setDeveloperMode(false)).plugins[0]!
    assert.equal(paused.enabled, false); assert.equal(paused.desiredEnabled, true); assert.equal(f.store.asset(asset(first.generation!)), null)
    await assert.rejects(f.store.dataOperation(7, token, 'read')); await assert.rejects(f.store.setEnabled(id, true))
    const restartPaused = new PluginStore(f.managed); assert.equal((await restartPaused.list()).developerMode, false)
    assert.equal((await restartPaused.setDeveloperMode(true)).plugins[0]!.enabled, true)
    await writeFile(join(f.source, 'entry.js'), 'export function activate() { /* unaccepted */ }')
    const restart = new PluginStore(f.managed), unavailable = (await restart.list()).plugins[0]!
    assert.equal(unavailable.enabled, false); assert.equal(unavailable.desiredEnabled, true); assert.match(unavailable.unavailable!, /Recarregar/)
    assert.equal(restart.asset(asset(first.generation!)), null); await assert.rejects(restart.beginData(7, id, first.revision, first.generation))
    await restart.setDeveloperMode(false); assert.equal((await restart.setDeveloperMode(true)).plugins[0]!.enabled, false)
    await restart.reload(id); await restart.setEnabled(id, false)
    const disabled = (await restart.reload(id)).plugins[0]!; assert.equal(disabled.enabled, false); assert.equal(disabled.desiredEnabled, false)
    await rename(f.source, f.source + '-missing')
    assert.match((await new PluginStore(f.managed).list()).plugins[0]!.unavailable!, /Fonte ausente/)
    await rename(f.source + '-missing', f.source)
    const digest = packageDigest(await inspectPackage(f.source))
    await restart.remove(id); assert.equal((await restart.list()).plugins.length, 0)
    assert.equal(packageDigest(await inspectPackage(f.source)), digest)
    const replacement = (await restart.loadExternal(f.source)).plugins[0]!; assert.notEqual(replacement.revision, first.revision)
  } finally { await f.clean() }
})
for (const enabled of [false, true]) test(`alpha.34 legacy exact linking preserves identity/data/recovery and enabled=${enabled}`, async () => {
  const f = await fixture()
  try {
    const original = (await f.store.install(f.source)).plugins[0]!
    await f.store.setEnabled(id, true); const token = await f.store.beginData(1, id, original.revision)
    const saved = await f.store.dataOperation(1, token, 'write', 0, doc)
    await f.store.setEnabled(id, enabled)
    const previous = await readFile(join(f.managed, 'state.json')), entry = join(f.source, 'entry.js'), code = await readFile(entry)
    await f.store.setDeveloperMode(true)
    await writeFile(entry, 'mismatch'); await assert.rejects(f.store.linkExternal(id, f.source), /mesmo ID/)
    await writeFile(entry, code)
    assert.equal(JSON.parse(previous.toString()).plugins[id].external, undefined)
    await assert.rejects(f.store.linkExternal(id, f.source, () => false), /expirada/)
    const linked = (await f.store.linkExternal(id, f.source)).plugins[0]!
    assert.equal(linked.source, 'external'); assert.equal(linked.revision, original.revision); assert.equal(linked.generation, original.revision); assert.equal(linked.enabled, enabled)
    assert.equal(packageDigest(await inspectPackage(join(f.managed, 'packages', id))), packageDigest(await inspectPackage(f.source)))
    if (enabled) assert.deepEqual(await f.store.dataOperation(1, token, 'read'), saved)
    const restarted = new PluginStore(f.managed); assert.deepEqual((await restarted.list()).plugins[0], linked)
    await restarted.setEnabled(id, true); const resumed = await restarted.beginData(1, id, linked.revision, linked.generation)
    assert.deepEqual(await restarted.dataOperation(1, resumed, 'read'), saved)
    const { privateKey } = generateKeyPairSync('ed25519'), roots = [{ ...publicIdentity(privateKey), pluginId: id, publisher: 'test', revoked: false }] as const
    const signed = join(f.root, 'signed.gpp'); await writeFile(signed, signPluginPackage(await inspectPackage(f.source), privateKey))
    await assert.rejects(new PluginStore(f.managed, roots).installSigned(signed, async () => true, () => true), /conflitante/)
    await restarted.remove(id); assert.deepEqual((await new PluginStore(f.managed).list()).plugins, [])
    assert.ok(await readFile(entry)); assert.ok(await readFile(join(f.managed, 'packages', id, 'entry.js')))
  } finally { await f.clean() }
})
test('API 1 external folders retain legacy authority, with no API 2 channel', async () => {
  const f = await fixture(1)
  try {
    await f.store.setDeveloperMode(true); const installed = (await f.store.loadExternal(f.source)).plugins[0]!
    await f.store.setEnabled(id, true); assert.ok(f.store.asset(asset(installed.generation!)))
    await assert.rejects(f.store.beginData(1, id, installed.revision, installed.generation))
    assert.equal((await f.store.reload(id)).plugins[0]!.revision, installed.revision)
  } finally { await f.clean() }
})
test('unsafe or oversized rebuilt candidates leave committed state and the active accepted asset intact', async () => {
  const f = await fixture()
  try {
    await f.store.setDeveloperMode(true); const installed = (await f.store.loadExternal(f.source)).plugins[0]!
    await f.store.setEnabled(id, true)
    const previous = await readFile(join(f.managed, 'state.json')), code = f.store.asset(asset(installed.generation!))
    for (const entry of ['../entry.js', 'C:/entry.js', 'entry.js?path=secret', 'missing.js']) {
      await writeFile(join(f.source, 'plugin.json'), JSON.stringify({ ...f.manifest, entry }))
      await assert.rejects(f.store.reload(id))
      assert.deepEqual(await readFile(join(f.managed, 'state.json')), previous); assert.deepEqual(f.store.asset(asset(installed.generation!)), code)
    }
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify(f.manifest)); await writeFile(join(f.source, 'entry.js'), Buffer.alloc(512 * 1024 + 1))
    await assert.rejects(f.store.reload(id), /tamanho/)
    assert.deepEqual(await readFile(join(f.managed, 'state.json')), previous); assert.deepEqual(f.store.asset(asset(installed.generation!)), code)
  } finally { await f.clean() }
})
for (const phase of ['before', 'after', 'failure']) test(`external state boundary ${phase} restarts with an entire accepted source`, async () => {
  const f = await fixture()
  try {
    await f.store.setDeveloperMode(true); const before = (await f.store.loadExternal(f.source)).plugins[0]!
    await f.store.setEnabled(id, true)
    await writeFile(join(f.source, 'entry.js'), 'export function activate() { /* next */ }')
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/fixtures/plugin-dev-interrupt.ts', f.managed, id, phase], { encoding: 'utf8' })
    assert.equal(result.status, phase === 'before' ? 73 : phase === 'after' ? 74 : 75, result.stderr)
    const restarted = new PluginStore(f.managed), actual = (await restarted.list()).plugins[0]!
    assert.equal(actual.revision, before.revision)
    assert.equal(actual.generation === before.generation, phase !== 'after')
    assert.equal(actual.enabled, phase === 'after'); assert.equal(Boolean(restarted.asset(asset(actual.generation!))), phase === 'after')
    // The precommit crash preserves committed bytes; the changed source must be explicitly accepted after restart.
    assert.deepEqual(await readdir(join(f.managed, 'packages')), [])
  } finally { await f.clean() }
})
test('missing widget declarations preserve exact workbench associations through save/restart and restoration, with demo archive', async () => {
  const f = await fixture()
  try {
    await f.store.setDeveloperMode(true); const installed = (await f.store.loadExternal(f.source)).plugins[0]!
    const registry = widgetRegistry([installed])
    const old = addWidget(demoWorkbench(), demoRegistry([installed]), `plugin:${id}:notes`, { region: 'main', width: 2000, height: 1000, expanded: true }, { x: 1700, y: 0 })!
    const snapshot = parseWorkbench(serializeWorkbench(old, demoRegistry([installed])), registry)
    assert.ok(snapshot.retiredDemos)
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify({ ...f.manifest, widgets: [] }))
    const missing = (await f.store.reload(id)).plugins[0]!, missingRegistry = widgetRegistry([missing])
    assert.equal(missingRegistry.get(`plugin:${id}:notes`)!.missing, true)
    assert.equal(addWidget(initialWorkbench(), missingRegistry, `plugin:${id}:notes`, { region: 'main', width: 2000, height: 1000, expanded: false }), null)
    const saved = serializeWorkbench(snapshot, missingRegistry), restarted = parseWorkbench(saved, widgetRegistry((await new PluginStore(f.managed).list()).plugins))
    assert.deepEqual(restarted, snapshot)
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify(f.manifest))
    const restored = (await f.store.reload(id)).plugins[0]!
    assert.deepEqual(parseWorkbench(saved, widgetRegistry([restored])), snapshot)
    // An independently copied original is equivalent regardless of enumeration/mtime.
    await cp(f.source, join(f.root, 'equivalent'), { recursive: true })
    assert.equal(packageDigest(await inspectPackage(resolve(f.root, 'equivalent'))), packageDigest(await inspectPackage(f.source)))
  } finally { await f.clean() }
})
