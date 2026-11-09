import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginRuntime } from '../src/renderer/src/plugin-runtime.ts'
import type { PluginWorker, RuntimePlugin } from '../src/renderer/src/plugin-runtime.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import type { PluginDataBridge } from '../src/shared/plugin-data.ts'

const plugin: InstalledPlugin = { enabled: true, revision: 'test-revision', manifest: { schemaVersion: 1, apiVersion: 1, id: 'test.plugin', name: 'Test', version: '1.0.0', entry: 'entry.js', widgets: [{ id: 'counter', title: 'Counter', surface: 'declarative' }] } }
class FakeWorker implements PluginWorker {
  onmessage: PluginWorker['onmessage'] = null
  onerror: PluginWorker['onerror'] = null
  onmessageerror: PluginWorker['onmessageerror'] = null
  requests: { type: string; requestId: number }[] = []
  terminated = false
  private readonly answer: boolean
  constructor(answer = true) { this.answer = answer }
  message(value: unknown) { this.onmessage?.({ data: value } as MessageEvent<unknown>) }
  postMessage(value: unknown) {
    const request = value as { type: string; requestId: number }; this.requests.push(request)
    if (this.answer) queueMicrotask(() => this.message({ type: 'done', requestId: request.requestId }))
  }
  terminate() { this.terminated = true }
}
test('repeated sync and enable/disable leave one worker, clear widgets and preserve disposal evidence', async () => {
  const workers: FakeWorker[] = []; let views: RuntimePlugin[] = []
  const runtime = new PluginRuntime(() => { const worker = new FakeWorker(); workers.push(worker); return worker }, next => { views = next })
  try {
    await runtime.sync([plugin]); await runtime.sync([plugin]); assert.equal(workers.length, 1)
    workers[0]!.message({ type: 'widget', widgetId: 'counter', view: { text: '1', action: { id: 'count', label: 'Count' } } })
    await runtime.action(plugin.manifest.id, 'counter', 'count'); assert.equal(workers[0]!.requests.at(-1)?.type, 'action')
    await runtime.action(plugin.manifest.id, 'counter', 'unknown'); assert.equal(workers[0]!.requests.length, 2)
    await runtime.sync([{ ...plugin, enabled: false }]); assert.equal(views[0]!.status, 'disabled'); assert.deepEqual(views[0]!.widgets, {})
    assert.equal(workers[0]!.requests.at(-1)?.type, 'dispose'); assert.ok(workers[0]!.terminated)
    workers[0]!.message({ type: 'widget', widgetId: 'counter', view: { text: 'stale' } }); assert.deepEqual(views[0]!.widgets, {})
    await runtime.sync([plugin]); assert.equal(workers.length, 2); assert.ok(views[0]!.events.some(event => event.includes('dispose')))
    await runtime.sync([]); assert.deepEqual(views, []); assert.ok(workers[1]!.terminated)
  } finally { runtime.shutdown() }
})
test('zero-widget plugins activate; errors and invalid contributions affect only their own worker', async () => {
  const workers: FakeWorker[] = []; let views: RuntimePlugin[] = []
  const runtime = new PluginRuntime(() => { const worker = new FakeWorker(); workers.push(worker); return worker }, next => { views = next })
  try {
    const background = { ...plugin, manifest: { ...plugin.manifest, id: 'test.background', widgets: [] } }
    await runtime.sync([plugin, background])
    workers[1]!.message({ type: 'status', message: 'Background is running' }); assert.equal(views[1]!.status, 'active')
    workers[0]!.message({ type: 'widget', widgetId: 'undeclared', view: { text: 'bad' } })
    assert.equal(views[0]!.status, 'error'); assert.ok(workers[0]!.terminated); assert.equal(views[1]!.status, 'active')
    await runtime.sync([plugin, background]); assert.equal(workers.length, 2)
    await runtime.stop(plugin.manifest.id); await runtime.sync([plugin, background]); assert.equal(workers.length, 3)
    workers[2]!.message({ type: 'failed', message: 'Activation exception' }); assert.equal(views[0]!.status, 'error')
  } finally { runtime.shutdown() }
})
test('activation/disposal hangs have bounded timeouts; message floods terminate workers', async () => {
  let views: RuntimePlugin[] = []
  const hanging = new FakeWorker(false)
  const runtime = new PluginRuntime(() => hanging, next => { views = next }, 20)
  await runtime.sync([plugin]); assert.equal(views[0]!.status, 'error'); assert.ok(hanging.terminated); runtime.shutdown()
  const flood = new FakeWorker()
  const other = new PluginRuntime(() => flood, next => { views = next }, 20)
  try {
    await other.sync([plugin])
    for (let i = 0; i < 65; i++) flood.message({ type: 'status', message: 'x' })
    assert.equal(views[0]!.status, 'error'); assert.ok(flood.terminated)
  } finally { other.shutdown() }
  const teardown = new FakeWorker()
  const last = new PluginRuntime(() => teardown, next => { views = next }, 20)
  try {
    await last.sync([plugin]); teardown.postMessage = () => undefined
    await last.stop(plugin.manifest.id); assert.equal(views[0]!.status, 'disabled'); assert.ok(views[0]!.detail.includes('Tempo limite'))
    assert.ok(teardown.terminated)
  } finally { last.shutdown() }
})

test('v2 data messages bind the callback channel and revoke before disposal; legacy cannot request data', async () => {
  const workers: FakeWorker[] = [], calls: unknown[] = []; let views: RuntimePlugin[] = []
  let resolveRead: ((value: Awaited<ReturnType<PluginDataBridge['read']>>) => void) | undefined
  const data: PluginDataBridge = {
    async begin(id, revision) { calls.push(['begin', id, revision]); return { ok: true, value: 'host-token' } },
    read(token) { calls.push(['read', token]); return new Promise(resolve => { resolveRead = resolve }) },
    async write(token, revision, document) { calls.push(['write', token, revision]); return { ok: true, value: { revision: revision + 1, document } } },
    async end(token) { calls.push(['end', token]); return { ok: true, value: null } }
  }
  const runtime = new PluginRuntime(() => { const worker = new FakeWorker(); workers.push(worker); return worker }, values => { views = values }, 100, data)
  try {
    const v2 = { ...plugin, manifest: { ...plugin.manifest, apiVersion: 2 as const } }
    await runtime.sync([v2]); assert.deepEqual(calls[0], ['begin', plugin.manifest.id, plugin.revision])
    assert.ok(!JSON.stringify(workers[0]!.requests).includes('host-token'))
    workers[0]!.message({ type: 'data', id: 1, operation: 'read' }); assert.deepEqual(calls[1], ['read', 'host-token'])
    await runtime.stop(plugin.manifest.id); assert.deepEqual(calls[2], ['end', 'host-token'])
    const count = workers[0]!.requests.length
    resolveRead!({ ok: true, value: { revision: 0, document: null } }); await Promise.resolve(); await Promise.resolve()
    assert.equal(workers[0]!.requests.length, count, 'Late data cannot reach stopped Worker')
    await runtime.sync([v2]); workers[1]!.message({ type: 'data', id: 2, operation: 'read', namespace: 'foreign' })
    assert.equal(views[0]!.status, 'error'); assert.equal(calls.filter(value => Array.isArray(value) && value[0] === 'read').length, 1)
    await runtime.stop(plugin.manifest.id); await runtime.sync([plugin]); workers[2]!.message({ type: 'data', id: 3, operation: 'read' }); assert.equal(views[0]!.status, 'error')
  } finally { runtime.shutdown() }
})

test('v2 events validate current owning controls, serialize, reject invalid/stale events and bound floods', async () => {
  const worker = new FakeWorker(), data: PluginDataBridge = { async begin() { return { ok: true, value: 'token' } }, async end() { return { ok: true, value: null } }, async read() { return { ok: true, value: { revision: 0, document: null } } }, async write() { return { ok: false, error: 'disk failure' } } }
  const runtime = new PluginRuntime(() => worker, () => {}, 100, data)
  try {
    await runtime.sync([{ ...plugin, manifest: { ...plugin.manifest, apiVersion: 2 } }])
    worker.message({ type: 'widget', widgetId: 'counter', view: { text: 'Text', fields: [{ id: 'body', label: 'Body', value: '' }] } })
    assert.equal(await runtime.widgetEvent(plugin.manifest.id, 'foreign', { kind: 'input', controlId: 'body', value: 'x' }), false)
    assert.equal(await runtime.widgetEvent(plugin.manifest.id, 'counter', { kind: 'input', controlId: 'foreign', value: 'x' }), false)
    assert.deepEqual(await Promise.all(['a', 'b', 'c'].map(value => runtime.widgetEvent(plugin.manifest.id, 'counter', { kind: 'input', controlId: 'body', value }))), [true, true, true])
    assert.equal(worker.requests.filter(request => request.type === 'event').length, 3)
    const results = await Promise.all(Array.from({ length: 40 }, () => runtime.widgetEvent(plugin.manifest.id, 'counter', { kind: 'input', controlId: 'body', value: 'flood' })))
    assert.ok(results.some(result => !result))
    await runtime.stop(plugin.manifest.id)
    assert.equal(await runtime.widgetEvent(plugin.manifest.id, 'counter', { kind: 'input', controlId: 'body', value: 'late' }), false)
  } finally { runtime.shutdown() }
})

test('v2 lifecycle timeout retains the last surface and draft for recovery without a saved claim', async () => {
  const worker = new FakeWorker(); let views: RuntimePlugin[] = []
  const runtime = new PluginRuntime(() => worker, values => { views = values }, 20, { async begin() { return { ok: true, value: 'token' } }, async end() { return { ok: true, value: null } }, async read() { return { ok: true, value: { revision: 0, document: null } } }, async write() { return { ok: false, error: 'unavailable' } } })
  try {
    await runtime.sync([{ ...plugin, manifest: { ...plugin.manifest, apiVersion: 2 } }])
    worker.message({ type: 'widget', widgetId: 'counter', view: { text: 'Salvando…', fields: [{ id: 'draft', label: 'Draft', value: 'pending text' }] } })
    worker.postMessage = () => undefined
    assert.equal(await runtime.widgetEvent(plugin.manifest.id, 'counter', { kind: 'input', controlId: 'draft', value: 'pending text' }), false)
    assert.equal(views[0]!.status, 'error'); assert.ok(worker.terminated)
    assert.equal(views[0]!.widgets.counter?.fields?.[0]?.value, 'pending text')
    assert.match(views[0]!.widgets.counter!.text, /^Falha no plugin/)
    assert.equal(await runtime.widgetEvent(plugin.manifest.id, 'counter', { kind: 'input', controlId: 'draft', value: 'late' }), false)
  } finally { runtime.shutdown() }
})
