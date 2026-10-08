import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT } from '../src/shared/layout-defaults.ts'
import { IDENTITY } from '../src/shared/identity.ts'
import { DEFAULT_GRID, GRID_KEY } from '../src/shared/grid/policy.ts'
import { importGrid, migrateV1, parseGrid } from '../src/shared/grid/schema.ts'
import { readGrid, writeGrid } from '../src/shared/grid/storage.ts'

function storage(entries: [string, string][] = []) {
  const values = new Map(entries)
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
test('read-only migration, new schema Save, restart and v1 rollback bytes', () => {
  const raw = JSON.stringify({ ...DEFAULT_LAYOUT, theme: 'light', ignored: 'preserve original whitespace / metadata' }, null, 2)
  const s = storage([[IDENTITY.layoutStorageKey, raw]]), restored = readGrid(s)
  assert.equal(restored.recovery, false); assert.equal(restored.writable, false); assert.equal(restored.snapshot.theme, 'light')
  assert.equal(s.values.size, 1); assert.equal(s.getItem(IDENTITY.layoutStorageKey), raw)
  assert.deepEqual(restored.snapshot, migrateV1(raw)); assert.deepEqual(importGrid(raw), restored.snapshot)
  const saved = writeGrid(s, restored.snapshot, null); assert.equal(saved.error, null)
  assert.deepEqual(readGrid(s).snapshot, restored.snapshot); assert.equal(s.getItem(IDENTITY.layoutStorageKey), raw)
  assert.equal(readGrid(s).writable, true)
})
test('corruption/version/schema violations are recoverable; reads never replace bytes', () => {
  for (const raw of ['{broken', JSON.stringify({ ...DEFAULT_GRID, schemaVersion: 3 }), JSON.stringify({ ...DEFAULT_GRID, rows: 0 }),
    JSON.stringify({ ...DEFAULT_GRID, theme: ['dark'] }), JSON.stringify({ ...DEFAULT_GRID, theme: { toString: 'dark' } }),
    JSON.stringify({ ...DEFAULT_GRID, placements: DEFAULT_GRID.placements.slice(1) }), JSON.stringify({ ...DEFAULT_GRID, placements: DEFAULT_GRID.placements.map(p => ({ ...p, x: .5 })) }),
    JSON.stringify({ ...DEFAULT_GRID, placements: DEFAULT_GRID.placements.map(p => ({ ...p, preferred: { w: Infinity, h: 2 } })) })]) {
    assert.throws(() => parseGrid(raw))
    const s = storage([[GRID_KEY, raw], [IDENTITY.layoutStorageKey, JSON.stringify(DEFAULT_LAYOUT)]])
    assert.equal(readGrid(s).recovery, true); assert.equal(s.getItem(GRID_KEY), raw); assert.equal(s.values.size, 2)
  }
  assert.throws(() => importGrid(' '.repeat(65537)))
  assert.throws(() => parseGrid(JSON.stringify({ ...DEFAULT_GRID, placements: DEFAULT_GRID.placements.map(p => ({ ...p, preferred: { w: 3, h: 2 } })) })))
})
test('valid legacy composition that cannot fit rounded grid blocks recoverably rather than shrink/reset', () => {
  const ids = DEFAULT_LAYOUT.placements.map(p => p.id)
  const raw = JSON.stringify({ schemaVersion: 1, theme: 'dark', placements: ids.map((id, i) => i < 5
    ? { id, x: i * .2, y: 0, width: .2, height: .6 } : { id, x: (i - 5) * .5, y: .6, width: .5, height: .4 }) })
  assert.throws(() => migrateV1(raw))
  const s = storage([[IDENTITY.layoutStorageKey, raw]]); assert.equal(readGrid(s).recovery, true)
  assert.equal(s.getItem(IDENTITY.layoutStorageKey), raw); assert.equal(s.getItem(GRID_KEY), null)
})
test('Save validates preferred sizes, reports quota failure and rejects concurrent overwrite', () => {
  const s = storage(), first = writeGrid(s, DEFAULT_GRID, null); assert.equal(first.error, null)
  const old = s.getItem(GRID_KEY)
  assert.ok(writeGrid(s, DEFAULT_GRID, null).error); assert.equal(s.getItem(GRID_KEY), old)
  assert.ok(writeGrid({ getItem: () => null, setItem() { throw new Error('Quota') } }, DEFAULT_GRID, null).error)
  assert.throws(() => parseGrid(JSON.stringify({ ...DEFAULT_GRID, placements: DEFAULT_GRID.placements.map(p => ({ ...p, preferred: { w: 1, h: 1 } })) })))
})
