import test from 'node:test'
import assert from 'node:assert/strict'
import { readLayout, writeLayout } from '../src/shared/storage.ts'
import { DEFAULT_LAYOUT, MINIMUMS } from '../src/renderer/src/fixtures.ts'
test('reading a corrupt or incompatible draft never overwrites the old bytes', () => {
  for (const old of ['corrupt', JSON.stringify({ schemaVersion: 9 })]) {
    let writes = 0
    const storage = { getItem: () => old, setItem: () => { writes++ } }
    const result = readLayout(storage, 'test', DEFAULT_LAYOUT, MINIMUMS)
    assert.ok(result.error); assert.equal(writes, 0); assert.deepEqual(result.snapshot, DEFAULT_LAYOUT)
  }
})
test('storage errors are reported rather than silently labelled as saved', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  assert.ok(writeLayout(storage, 'test', DEFAULT_LAYOUT))
})
test('restored value is a separate copy and survives a write/read cycle', () => {
  let value: string | null = null
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next } }
  assert.equal(writeLayout(storage, 'test', DEFAULT_LAYOUT), null)
  const loaded = readLayout(storage, 'test', DEFAULT_LAYOUT, MINIMUMS)
  assert.equal(loaded.error, null); assert.deepEqual(loaded.snapshot, DEFAULT_LAYOUT)
  loaded.snapshot.placements[0]!.x = .7
  assert.equal(DEFAULT_LAYOUT.placements[0]!.x, 0)
})
