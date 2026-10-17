import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT } from '../src/shared/layout-defaults.ts'
import { DEFAULT_GRID, GRID_KEY } from '../src/shared/grid/policy.ts'
import { DEFAULT_HORIZONTAL, HORIZONTAL_KEY, serializeHorizontal } from '../src/shared/grid/horizontal.ts'
import { DEFAULT_FREEFORM, FREEFORM_KEY } from '../src/shared/freeform/policy.ts'
import { convertHistorical, importFreeform } from '../src/shared/freeform/migration.ts'
import { parseFreeform } from '../src/shared/freeform/schema.ts'
import { readFreeform, writeFreeform } from '../src/shared/freeform/storage.ts'

function memory() {
  const values = new Map<string, string>(), writes: string[] = []
  return { values, writes, getItem(key: string) { return values.get(key) ?? null }, setItem(key: string, value: string) { writes.push(key); values.set(key, value) } }
}
test('freeform codec preserves exact fractional pixels and canonical identities', () => {
  const snapshot = structuredClone(DEFAULT_FREEFORM)
  snapshot.placements[0] = { ...snapshot.placements[0]!, x: 13.125, y: 8.25, width: 210.375, height: 130.125 }
  assert.deepEqual(parseFreeform(JSON.stringify(snapshot)), snapshot)
  const injected = { ...snapshot, nodeIntegration: true, command: 'untrusted data', placements: snapshot.placements.map(p => ({ ...p, html: '<script>throw 1</script>', capabilities: ['process'] })) }
  assert.deepEqual(parseFreeform(JSON.stringify(injected)), snapshot, 'unknown fields cannot confer code/native/plugin authority')
})
test('negative schema, ownership, minima, overlap, preference, count, finite limits and document bounds', () => {
  const mutations: ((s: Record<string, unknown>) => void)[] = [
    s => { s.schemaVersion = 999 }, s => { s.engine = 'grid' }, s => { s.constraintVersion = 999 },
    s => { (s.placements as Record<string, unknown>[])[0]!.id = 'unknown' },
    s => { (s.placements as Record<string, unknown>[]).pop() },
    s => { (s.placements as Record<string, unknown>[])[0]!.region = 'header' },
    s => { (s.placements as Record<string, unknown>[])[1]!.region = 'bottom' },
    s => { (s.placements as Record<string, unknown>[])[0]!.width = 10 },
    s => { (s.placements as Record<string, unknown>[])[0]!.x = 100000 },
    s => { (s.placements as Record<string, unknown>[])[0]!.x = null },
    s => { (s.placements as Record<string, unknown>[])[0]!.x = -1 },
    s => { (s.placements as Record<string, unknown>[])[0]!.preferred = { width: 10, height: 10 } },
    s => { (s.placements as Record<string, unknown>[])[0]!.width = 4097 },
    s => { (s.placements as Record<string, unknown>[])[0]!.x = 100 },
    s => { s.reference = { main: { width: 0, height: 1 } } }
  ]
  for (const mutate of mutations) { const data = JSON.parse(JSON.stringify(DEFAULT_FREEFORM)) as Record<string, unknown>; mutate(data); assert.throws(() => parseFreeform(JSON.stringify(data))) }
  for (const raw of ['{broken', ' '.repeat(65537), '"' + 'á'.repeat(33000) + '"']) assert.throws(() => parseFreeform(raw))
})
test('all historical customizations stay separate, read-only, and require explicit choice/Save', () => {
  const storage = memory(), originals = [JSON.stringify(DEFAULT_LAYOUT), JSON.stringify(DEFAULT_GRID), serializeHorizontal(DEFAULT_HORIZONTAL)]
  for (const [i, key] of ['geppio:layout:v1', GRID_KEY, HORIZONTAL_KEY].entries()) storage.values.set(key, originals[i]!)
  const read = readFreeform(storage)
  assert.equal(read.recovery, true); assert.equal(read.choices.length, 3); assert.equal(storage.writes.length, 0)
  for (const choice of read.choices) {
    const writes: number = storage.writes.length
    const preview = convertHistorical(choice.raw, choice.kind)
    assert.deepEqual(importFreeform(choice.raw), preview, 'explicit historical file imports preserve the existing recovery path')
    assert.equal(preview.placements.length, 7); assert.equal(storage.writes.length, writes)
    assert.equal(writeFreeform(storage, preview, storage.getItem(FREEFORM_KEY)).error, null)
  }
  assert.deepEqual(['geppio:layout:v1', GRID_KEY, HORIZONTAL_KEY].map(k => storage.getItem(k)), originals)
  assert.ok(storage.writes.every(k => k === FREEFORM_KEY))
  assert.equal(readFreeform(storage).recovery, false)
  assert.deepEqual(importFreeform(JSON.stringify(DEFAULT_FREEFORM)), DEFAULT_FREEFORM)
  for (const text of ['{"schemaVersion":999}', '{"schemaVersion":1,"engine":"unknown"}', ' '.repeat(65537)]) assert.throws(() => importFreeform(text))
})
test('corruption/future data, concurrent updates, quota and unavailable storage preserve original bytes', () => {
  const storage = memory()
  for (const raw of ['{corrupt', '{"schemaVersion":999}', ' '.repeat(65537)]) {
    storage.values.set(FREEFORM_KEY, raw)
    assert.equal(readFreeform(storage).recovery, true); assert.equal(storage.getItem(FREEFORM_KEY), raw)
  }
  storage.values.delete(FREEFORM_KEY)
  const initial = readFreeform(storage)
  storage.values.set(FREEFORM_KEY, 'external change')
  assert.ok(writeFreeform(storage, initial.snapshot, initial.raw).error)
  assert.equal(storage.getItem(FREEFORM_KEY), 'external change')
  const quota = { getItem: storage.getItem.bind(storage), setItem() { throw new Error('Quota') } }
  assert.ok(writeFreeform(quota, DEFAULT_FREEFORM, 'external change').error)
  assert.equal(storage.getItem(FREEFORM_KEY), 'external change')
  assert.equal(readFreeform({ getItem() { throw new Error('Unavailable') }, setItem() {} }).recovery, true)
})
