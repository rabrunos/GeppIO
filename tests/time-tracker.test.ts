import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTracker, startTimer, pauseTimer, parseTracker, dailyTotals, elapsed, trackerDocument } from '../examples/plugins/time-tracker/src/model.ts'
import { activate } from '../examples/plugins/time-tracker/src/entry.ts'
import type { DataSnapshot, PluginContextV2, WidgetViewV2 } from '../sdk/plugin-v2.d.ts'
const id = 'session.00000000-0000-4000-8000-000000000001'
test('timestamp timer survives absence, single start/pause is idempotent and clock rollback is nonnegative', () => {
  const running = startTimer(emptyTracker(), 1000, id)
  assert.equal(startTimer(running, 2000, id), running)
  assert.equal(elapsed(running.running!.start, 11000), 10000)
  const paused = pauseTimer(parseTracker(JSON.parse(JSON.stringify(running))), 500)
  assert.equal(paused.sessions[0]!.end, 1000); assert.equal(paused.sessions.length, 1)
  assert.equal(pauseTimer(paused, 3000), paused)
  assert.throws(() => parseTracker({ ...paused, sessions: [...paused.sessions, ...paused.sessions] }))
  for (const invalid of [NaN, -1, Infinity]) assert.throws(() => startTimer(emptyTracker(), invalid, id))
})
test('daily totals split intervals at local midnight, including a running interval', () => {
  const start = new Date(2026, 10, 8, 23, 59).getTime(), end = new Date(2026, 10, 9, 0, 1).getTime()
  const running = startTimer(emptyTracker(), start, id)
  for (const model of [running, pauseTimer(running, end)]) {
    const days = dailyTotals(model, end)
    assert.equal(days[0]!.ms, 60000); assert.equal(days[1]!.ms, 60000)
    assert.ok(days.every(day => day.ms >= 0))
  }
})
for (const lostAcknowledgement of [false, true]) test(`failed write/retry preserves confirmed history and creates exactly one interval (lost acknowledgement: ${lostAcknowledgement})`, async () => {
  let saved: DataSnapshot = { revision: 0, document: null }, fail = false
  const views = new Map<string, WidgetViewV2>()
  const context: PluginContextV2 = { pluginId: 'geppio.time-tracker', reportStatus() {}, publishWidget(id, view) { views.set(id, view) }, data: {
    async read() { return structuredClone(saved) },
    async write(revision, document) { assert.equal(revision, saved.revision); if (fail && !lostAcknowledgement) throw new Error('unavailable'); saved = { revision: revision + 1, document: structuredClone(document) }; if (fail) throw new Error('lost acknowledgement'); return structuredClone(saved) }
  } }
  const instance = await activate(context)
  try {
    await instance.onEvent!('timer', { kind: 'action', controlId: 'start' })
    const running = structuredClone(saved), started = parseTracker(saved.document!.value).running!
    fail = true; await instance.onEvent!('timer', { kind: 'action', controlId: 'pause' })
    assert.match(views.get('timer')!.text, /Falha ao salvar/)
    if (!lostAcknowledgement) assert.deepEqual(saved, running)
    fail = false; await instance.onEvent!('timer', { kind: 'action', controlId: 'retry' })
    const paused = parseTracker(saved.document!.value)
    assert.equal(paused.running, null); assert.equal(paused.sessions.length, 1); assert.equal(paused.sessions[0]!.id, started.id)
    assert.equal(saved.revision, 2)
    await instance.onEvent!('timer', { kind: 'action', controlId: 'retry' }); assert.equal(saved.revision, 2)
    assert.deepEqual(saved.document, trackerDocument(paused))
  } finally { instance.dispose() }
})
