import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { activate } from '../examples/plugins/workspace-essentials/src/entry.ts'
import { document, emptyModel, parseModel } from '../examples/plugins/workspace-essentials/src/model.ts'
import type { DataSnapshot, PluginContextV2, PluginInstanceV2, WidgetEvent, WidgetViewV2 } from '../sdk/plugin-v2.d.ts'
import { PluginRuntime } from '../src/renderer/src/plugin-runtime.ts'
import type { PluginWorker } from '../src/renderer/src/plugin-runtime.ts'
import { parseManifest } from '../src/shared/plugins.ts'

function storage() {
  const disk = {
    snapshot: { revision: 0, document: null } as DataSnapshot,
    writes: [] as number[],
    fault: 'none' as 'none' | 'before' | 'after',
    unreadable: false,
    afterRead: undefined as (() => void) | undefined
  }
  const data: PluginContextV2['data'] = {
    async read() {
      if (disk.unreadable) throw new Error('Read unavailable')
      const result = structuredClone(disk.snapshot)
      disk.afterRead?.()
      return result
    },
    async write(revision, value) {
      disk.writes.push(revision)
      if (disk.fault === 'before' || revision !== disk.snapshot.revision) throw new Error('Write refused')
      disk.snapshot = { revision: revision + 1, document: structuredClone(value) }
      if (disk.fault === 'after') throw new Error('Result unavailable after commit')
      return structuredClone(disk.snapshot)
    }
  }
  return { disk, data }
}

async function session(data: PluginContextV2['data']) {
  const views = new Map<string, WidgetViewV2>()
  const plugin = await activate({ pluginId: 'geppio.workspace-essentials', data, reportStatus() {},
    publishWidget(id, view) { views.set(id, view) } })
  const send = (widget: string, event: WidgetEvent) => plugin.onEvent!(widget, event)
  return { views, plugin, send, type: (value: string) => send('scratch', { kind: 'input', controlId: 'scratch', value }),
    retry: () => send('scratch', { kind: 'action', controlId: 'save' }), scratch: () => views.get('scratch')! }
}

for (const fault of ['before', 'after'] as const) test(`explicit retry settles a failure ${fault} commit once`, async () => {
  const { disk, data } = storage(), ui = await session(data)
  disk.fault = fault
  await ui.type('first')
  assert.match(ui.scratch().text, /Falha ao salvar/)
  assert.equal(disk.snapshot.revision, fault === 'after' ? 1 : 0)
  disk.fault = 'none'
  await ui.retry()
  await ui.retry()
  assert.equal(ui.scratch().text, 'Salvo.')
  assert.deepEqual(disk.snapshot, { revision: 1, document: document({ ...emptyModel(), scratch: 'first' }) })
  assert.deepEqual(disk.writes, fault === 'before' ? [0, 0] : [0])
})

test('two ambiguous commits keep distinct attempts and the latest delivered edit', async () => {
  const { disk, data } = storage(), ui = await session(data)
  disk.fault = 'after'
  await ui.type('first')
  await ui.type('second')
  assert.equal(disk.snapshot.revision, 2)
  assert.match(ui.scratch().text, /pendente/)
  assert.equal(ui.scratch().fields![0]!.value, 'second')
  disk.fault = 'none'
  await ui.retry()
  assert.deepEqual(disk.writes, [0, 1])
  assert.equal(ui.scratch().text, 'Salvo.')
  await ui.plugin.dispose()
  assert.equal((await session(data)).scratch().fields![0]!.value, 'second')
})

for (const race of [false, true]) test(`preserve a third document and the draft (race after read: ${race})`, async () => {
  const { disk, data } = storage(), ui = await session(data)
  await ui.type('base')
  const base = structuredClone(disk.snapshot)
  disk.fault = 'before'
  await ui.type('local')
  disk.fault = 'none'
  const external = { revision: 2, document: document({ ...emptyModel(), scratch: 'external' }) }
  if (race) disk.afterRead = () => { disk.snapshot = external }
  else disk.snapshot = external
  await ui.retry()
  disk.afterRead = undefined
  await ui.retry()
  assert.deepEqual(disk.snapshot, external)
  assert.deepEqual(disk.writes, race ? [0, 1, 1] : [0, 1])
  assert.match(ui.scratch().text, /conflito/i)
  assert.equal(ui.scratch().fields![0]!.value, 'local')
  disk.snapshot = { revision: 3, document: base.document }
  await ui.retry()
  assert.equal(disk.snapshot.revision, 4)
  assert.equal(parseModel(disk.snapshot.document!.value).scratch, 'local')
})

test('failed or incompatible rereads retain both draft and attempted snapshot', async () => {
  const { disk, data } = storage(), ui = await session(data)
  disk.fault = 'after'
  await ui.type('first')
  const attempted = structuredClone(disk.snapshot)
  disk.unreadable = true
  await ui.type('second')
  assert.match(ui.scratch().text, /pendente/)
  disk.unreadable = false
  disk.snapshot = { revision: 2, document: { schemaVersion: 1, value: { version: 2 } } }
  await ui.retry()
  assert.equal(ui.scratch().fields![0]!.value, 'second')
  assert.match(ui.scratch().text, /pendente/)
  assert.deepEqual(disk.writes, [0])
  disk.snapshot = { ...attempted, revision: 3 }
  disk.fault = 'none'
  await ui.retry()
  assert.deepEqual(disk.writes, [0, 3])
  assert.equal(parseModel(disk.snapshot.document!.value).scratch, 'second')
  assert.equal(disk.snapshot.revision, 4)
})

test('reconciliation retains generated IDs, selections, checklist and unsent item', async () => {
  const { disk, data } = storage(), ui = await session(data)
  const action = (widget: string, controlId: string) => ui.send(widget, { kind: 'action', controlId })
  const item = (value: string) => ui.send('checklist', { kind: 'input', controlId: 'item', value })
  await action('notes', 'new')
  await action('prompts', 'new')
  await item('selected item')
  disk.fault = 'after'
  await action('checklist', 'add')
  const committed = structuredClone(disk.snapshot)
  const model = parseModel(committed.document!.value)
  assert.equal(model.notes[0]!.id, model.selectedNote)
  assert.equal(model.prompts[0]!.id, model.selectedPrompt)
  assert.equal(model.checklist.length, 1)
  await item('still typing')
  disk.fault = 'none'
  await ui.retry()
  assert.equal(ui.views.get('checklist')!.fields![0]!.value, 'still typing')
  assert.deepEqual(disk.snapshot, committed)
  const selected = model.checklist[0]!.id
  await ui.send('checklist', { kind: 'toggle', controlId: 'items', itemId: selected, value: true })
  model.checklist[0]!.done = true
  assert.deepEqual(disk.snapshot, { revision: 4, document: document(model) })
})

test('the host queues a later field event during a write and permits management after recovery', async () => {
  const { disk, data } = storage()
  const manifest = parseManifest(readFileSync(new URL('../examples/plugins/workspace-essentials/plugin.json', import.meta.url), 'utf8'))
  let instance: PluginInstanceV2
  let entered!: () => void, resume!: () => void
  const writing = new Promise<void>(resolve => { entered = resolve })
  const release = new Promise<void>(resolve => { resume = resolve })
  const received: WidgetEvent[] = []
  const worker: PluginWorker = {
    onmessage: null, onerror: null, onmessageerror: null, terminate() {},
    async postMessage(message) {
      const request = message as { type: string; requestId: number; widgetId: string; event: WidgetEvent }
      const emit = (value: unknown) => worker.onmessage?.({ data: value } as MessageEvent)
      if (request.type === 'activate') {
        instance = await activate({ pluginId: manifest.id, reportStatus() {},
          publishWidget(widgetId, view) { emit({ type: 'widget', widgetId, view }) },
          data: { read: data.read, async write(revision, value) {
            const saved = await data.write(revision, value)
            if (saved.revision === 1) {
              entered()
              await release
              throw new Error('Committed result lost')
            }
            return saved
          } }
        })
      } else if (request.type === 'event') {
        received.push(request.event)
        await instance.onEvent!(request.widgetId, request.event)
      }
      emit({ type: 'done', requestId: request.requestId })
    }
  }
  // The seam replaces Worker transport and storage. Event serialization, view
  // validation and lifecycle preparation run through the host implementation.
  const runtime = new PluginRuntime(() => worker, () => {}, undefined, {
    async begin() { return { ok: true, value: 'fixture' } }, async end() { return { ok: true, value: null } },
    async read() { throw new Error('unused transport') }, async write() { throw new Error('unused transport') }
  })
  const input = (value: string) => runtime.widgetEvent(manifest.id, 'scratch', { kind: 'input', controlId: 'scratch', value })
  try {
    await runtime.sync([{ enabled: true, revision: 'fixture', manifest }])
    const first = input('first')
    await writing
    disk.unreadable = true
    const later = input('latest coalesced field value')
    assert.equal(received.length, 1)
    resume()
    assert.deepEqual(await Promise.all([first, later]), [true, true])
    assert.equal(await runtime.prepareChange([manifest.id]), false)
    disk.unreadable = false
    assert.equal(await runtime.widgetEvent(manifest.id, 'scratch', { kind: 'action', controlId: 'save' }), true)
    assert.equal(await runtime.prepareChange([manifest.id]), true)
    assert.deepEqual(disk.writes, [0, 1])
    assert.equal(parseModel(disk.snapshot.document!.value).scratch, 'latest coalesced field value')
  } finally { resume(); runtime.shutdown() }
})
