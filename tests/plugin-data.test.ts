import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginStore } from '../src/main/plugins.ts'
import { PluginDataStore } from '../src/main/plugin-data.ts'
import { DATA_LIMITS, parseDataDocument } from '../src/shared/plugin-data.ts'
import { parseWidgetViewV2, parseWidgetEvent } from '../src/shared/plugin-surface.ts'
import { parseWidgetView } from '../src/shared/plugins.ts'
import { parseModel, emptyModel } from '../examples/plugins/workspace-essentials/src/model.ts'

const doc = (text: string) => ({ schemaVersion: 1 as const, value: { text } })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'geppio-data-test-')), source = join(root, 'source'); await mkdir(source)
  const manifest = { schemaVersion: 1, apiVersion: 2, id: 'test.data', name: 'Data', version: '1.0.0', entry: 'entry.js', widgets: [] }
  await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest)); await writeFile(join(source, 'entry.js'), 'export function activate() { return { dispose() {} } }')
  const store = new PluginStore(join(root, 'plugins')); await store.install(source)
  const installed = (await store.setEnabled(manifest.id, true)).plugins[0]!, token = await store.beginData(1, manifest.id, installed.revision)
  return { root, source, manifest, store, installed, token, dataPath: join(root, 'plugin-data', installed.revision + '.json'), clean: () => rm(root, { recursive: true, force: true }) }
}
test('data namespace binds installation, owner and activation; retention does not transfer on reinstall', async () => {
  const f = await fixture()
  try {
    const first = await f.store.dataOperation(1, f.token, 'write', 0, doc('confirmed'))
    assert.equal(first.revision, 1)
    await assert.rejects(f.store.dataOperation(2, f.token, 'read'), /inválida/)
    await assert.rejects(f.store.dataOperation(1, f.token, 'write', 1, { ...doc('foreign'), namespace: 'other' }), /inválido/)
    await assert.rejects(f.store.beginData(1, 'other.plugin', f.installed.revision))
    await f.store.setEnabled(f.manifest.id, false)
    await assert.rejects(f.store.dataOperation(1, f.token, 'read'), /expirada/)
    await f.store.setEnabled(f.manifest.id, true)
    const next = await f.store.beginData(1, f.manifest.id, f.installed.revision)
    assert.deepEqual((await f.store.dataOperation(1, next, 'read')).document, first.document)
    f.store.revokeOwner(1); await assert.rejects(f.store.dataOperation(1, next, 'read'))
    const pending = f.store.beginData(1, f.manifest.id, f.installed.revision); f.store.revokeOwner(1); await assert.rejects(pending, /expirado/)
    await f.store.remove(f.manifest.id); assert.ok((await readFile(f.dataPath, 'utf8')).includes('confirmed'))
    const replacement = (await f.store.install(f.source)).plugins[0]!; assert.notEqual(replacement.revision, f.installed.revision)
    await f.store.setEnabled(f.manifest.id, true)
    await assert.rejects(f.store.beginData(1, f.manifest.id, f.installed.revision))
    const fresh = await f.store.beginData(1, f.manifest.id, replacement.revision)
    assert.deepEqual(await f.store.dataOperation(1, fresh, 'read'), { revision: 0, document: null })
    const restarted = new PluginStore(join(f.root, 'plugins')); await restarted.list()
    const token = await restarted.beginData(1, f.manifest.id, replacement.revision)
    assert.equal((await restarted.dataOperation(1, token, 'read')).document, null)
  } finally { await f.clean() }
})
test('competing writes use CAS, copy before queue, reject stale queued requests and recover after rejection', async () => {
  const f = await fixture()
  try {
    const input = doc('snapshot'), one = f.store.dataOperation(1, f.token, 'write', 0, input); input.value.text = 'mutated'
    const outcomes = await Promise.allSettled([one, f.store.dataOperation(1, f.token, 'write', 0, doc('race'))])
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1)
    const confirmed = await f.store.dataOperation(1, f.token, 'read'); assert.deepEqual(confirmed.document, doc('snapshot'))
    const waiting = f.store.dataOperation(1, f.token, 'write', 1, doc('stale')); f.store.endData(1, f.token)
    await assert.rejects(waiting, /expirada/)
    const token = await f.store.beginData(1, f.manifest.id, f.installed.revision)
    assert.deepEqual(await f.store.dataOperation(1, token, 'read'), confirmed)
    const restarted = new PluginStore(join(f.root, 'plugins')); await restarted.list()
    const restored = await restarted.beginData(1, f.manifest.id, f.installed.revision)
    assert.deepEqual(await restarted.dataOperation(1, restored, 'read'), confirmed)
  } finally { await f.clean() }
})
test('malformed, unsupported, oversized and linked disk data remain untouched and cannot be overwritten', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.root, 'plugin-data'), { recursive: true })
    for (const raw of ['{broken', JSON.stringify({ schemaVersion: 99 }), 'x'.repeat(DATA_LIMITS.bytes + 1025)]) {
      await writeFile(f.dataPath, raw)
      await assert.rejects(f.store.dataOperation(1, f.token, 'read'), /preservados/)
      await assert.rejects(f.store.dataOperation(1, f.token, 'write', 0, doc('replacement')), /preservados/)
      assert.equal(await readFile(f.dataPath, 'utf8'), raw)
    }
    await rm(f.dataPath); await rm(join(f.root, 'plugin-data'), { recursive: true })
    const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'original')
    await symlink(outside, join(f.root, 'plugin-data'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(f.store.dataOperation(1, f.token, 'write', 0, doc('bad')), /Diretório/)
    assert.deepEqual(await readdir(outside), ['keep'])
  } finally { await f.clean() }
})
test('atomic replacement failure and revoked lease preserve the last confirmed bytes', async () => {
  const f = await fixture()
  try {
    await f.store.dataOperation(1, f.token, 'write', 0, doc('confirmed'))
    const original = await readFile(f.dataPath, 'utf8')
    const data = new PluginDataStore(join(f.root, 'plugin-data'), async () => { throw new Error('simulated disk failure') })
    await assert.rejects(data.write(f.manifest.id, f.installed.revision, 1, doc('pending'), () => {}), /disk failure/)
    const normal = new PluginDataStore(join(f.root, 'plugin-data'))
    await assert.rejects(normal.write(f.manifest.id, f.installed.revision, 1, doc('stale'), () => { throw new Error('revoked') }), /revoked/)
    assert.equal(await readFile(f.dataPath, 'utf8'), original)
    assert.deepEqual(await readdir(join(f.root, 'plugin-data')), [f.installed.revision + '.json'])
  } finally { await f.clean() }
})
test('documents and v2 surfaces reject unbounded, malformed or foreign events; v1 remains exact', () => {
  const cycle: unknown[] = []; cycle.push(cycle)
  for (const value of [cycle, new Array(2), Infinity, { a: undefined }, 'ç'.repeat(DATA_LIMITS.bytes), Array(5000).fill(0)]) assert.throws(() => parseDataDocument({ schemaVersion: 1, value }))
  assert.throws(() => parseDataDocument({ schemaVersion: 2, value: '' }))
  let deep: unknown = 1; for (let i = 0; i < 15; i++) deep = [deep]
  assert.throws(() => parseDataDocument({ schemaVersion: 1, value: deep }))
  const view = parseWidgetViewV2({ text: '<script>literal</script>', fields: [{ id: 'body', label: 'Text', value: '' }], lists: [{ id: 'items', label: 'List', items: [{ id: 'a', text: 'literal', checked: false }] }] })
  assert.deepEqual(parseWidgetEvent({ kind: 'input', controlId: 'body', value: '<b>literal</b>' }, view), { kind: 'input', controlId: 'body', value: '<b>literal</b>' })
  for (const event of [{ kind: 'input', controlId: 'foreign', value: 'bad' }, { kind: 'input', controlId: 'body', value: 'x', namespace: 'other' }, { kind: 'input', controlId: 'body', value: 'x'.repeat(32769) }, { kind: 'toggle', controlId: 'items', itemId: 'foreign', value: true }, { kind: 'select', controlId: 'items', itemId: 'a' }]) assert.throws(() => parseWidgetEvent(event, view))
  assert.throws(() => parseWidgetViewV2({ text: 'x', html: '<div/>' }))
  assert.throws(() => parseWidgetViewV2({ text: 'x', fields: [{ id: 'x', label: 'A', value: '' }, { id: 'x', label: 'B', value: '' }] }))
  assert.throws(() => parseWidgetView({ text: 'x', fields: [] }))
  assert.deepEqual(parseModel(emptyModel()), emptyModel()); assert.throws(() => parseModel({ ...emptyModel(), version: 2 }))
})
test('data operations are bounded and legacy installations do not receive channels', async () => {
  const f = await fixture()
  try {
    const requests = Array.from({ length: 40 }, () => f.store.dataOperation(1, f.token, 'read'))
    const results = await Promise.allSettled(requests); assert.ok(results.some(result => result.status === 'rejected'))
    await f.store.remove(f.manifest.id)
    await writeFile(join(f.source, 'plugin.json'), JSON.stringify({ ...f.manifest, apiVersion: 1 }))
    await f.store.install(f.source); const legacy = (await f.store.setEnabled(f.manifest.id, true)).plugins[0]!
    await assert.rejects(f.store.beginData(1, f.manifest.id, legacy.revision), /v2/)
  } finally { await f.clean() }
})
