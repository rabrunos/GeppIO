import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginRuntime } from '../src/renderer/src/plugin-runtime.ts'
import type { PluginWorker, RuntimePlugin } from '../src/renderer/src/plugin-runtime.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'

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
