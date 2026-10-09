import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GRID, constraintsFor, GRID_KEY, RESPONSIVE_POLICY } from '../src/shared/grid/policy.ts'
import { fitGrid, pixelRect } from '../src/shared/grid/geometry.ts'
import { validLayout } from '../src/shared/grid/occupancy.ts'
import { projectGrid } from '../src/shared/grid/projection.ts'
import { assertSafe } from './helpers/projection-oracle.ts'
import { readGrid, writeGrid } from '../src/shared/grid/storage.ts'
import { parseGrid } from '../src/shared/grid/schema.ts'

test('owner wide/short regression: real redistribution, square cells and both-axis coverage', () => {
  for (const [width, height] of [[1200, 500], [1800, 700], [740, 860], [900, 650], [500, 1200]]) {
    const p = projectGrid(DEFAULT_GRID, width!, height!), m = p.metrics, old = fitGrid(width!, height!, DEFAULT_GRID)
    assert.ok(validLayout(p.snapshot.placements, p.snapshot, constraintsFor(p.snapshot)))
    assert.ok(width! - m.width < m.pitch + 1e-8 && height! - m.height < m.pitch + 1e-8)
    if (Math.min(old.width / width!, old.height / height!) < .8) assert.ok(m.width * m.height > old.width * old.height)
    assert.equal(p.warning, null); assert.ok(p.probes <= RESPONSIVE_POLICY.probes)
    assert.notDeepEqual(p.snapshot.placements, DEFAULT_GRID.placements)
    assert.deepEqual(p.snapshot.placements.map(q => q.preferred), DEFAULT_GRID.placements.map(q => q.preferred))
    assertSafe(DEFAULT_GRID, { width: width!, height: height!, snapshot: p.snapshot, metrics: m })
    const square = pixelRect({ x: 0, y: 0, w: 3, h: 3 }, m); assert.equal(square.width, square.height)
    if (width! > 1100) {
      assert.ok(p.snapshot.columns > 12)
      const right = p.snapshot.placements.find(q => q.id === 'library')!
      assert.equal(right.x + right.w, p.snapshot.columns)
      assert.ok(right.x > DEFAULT_GRID.placements.find(q => q.id === right.id)!.x)
    }
  }
})
test('A→B→A is source-derived, immutable, stable within topology and retains intentional gaps', () => {
  const source = structuredClone(DEFAULT_GRID), raw = JSON.stringify(source), a = projectGrid(source, 1200, 500)
  for (let i = 0; i < 12; i++) {
    projectGrid(source, 500, 1200); projectGrid(source, 900, 650)
    assert.deepEqual(projectGrid(source, 1200, 500), a); assert.equal(JSON.stringify(source), raw)
  }
  assert.deepEqual(projectGrid(source, 1201, 500).snapshot, a.snapshot)
  const p = projectGrid(source, 740, 860).snapshot
  assert.ok(p.rows > source.rows)
  assert.ok(p.placements.find(q => q.id === 'properties')!.y > 4)
  const chart = p.placements.find(q => q.id === 'chart')!; assert.equal(chart.y + chart.h, p.rows)
})
test('feasibility before coverage; bounded safe fallback at extreme aspect ratio', () => {
  for (const [w, h] of [[10000, 100], [100, 10000], [0, 0], [1, 1]]) {
    const p = projectGrid(DEFAULT_GRID, w!, h!)
    assert.ok(validLayout(p.snapshot.placements, p.snapshot, constraintsFor(p.snapshot)))
    assert.equal(p.snapshot.placements.length, 7); assert.ok(p.probes <= RESPONSIVE_POLICY.probes)
    assert.deepEqual(p.snapshot.placements.map(q => q.preferred), DEFAULT_GRID.placements.map(q => q.preferred))
    if (w! / h! > 10 || h! / w! > 10) assert.ok(p.warning)
  }
  assert.throws(() => projectGrid(DEFAULT_GRID, NaN, 10))
})
test('v2 responsive Save is explicit, projections preserve bytes, old snapshots still parse', () => {
  const raw = JSON.stringify(DEFAULT_GRID, null, 2), values = new Map([[GRID_KEY, raw]])
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const canonical = readGrid(store).snapshot, projected = projectGrid(canonical, 1200, 500).snapshot
  projectGrid(canonical, 500, 1200); assert.equal(store.getItem(GRID_KEY), raw)
  assert.deepEqual(parseGrid(raw), canonical)
  assert.equal(writeGrid(store, projected, raw).error, null)
  assert.deepEqual(readGrid(store).snapshot, projected)
  assert.deepEqual(projectGrid(projected, 1200, 500).snapshot, projected)
  assert.ok(writeGrid(store, canonical, raw).error)
})
test('square preferences survive temporary composition-first span changes within declared minima', () => {
  const source = { ...structuredClone(DEFAULT_GRID), placements: DEFAULT_GRID.placements.map((p, i) => ({ ...p, x: i % 3 * 3, y: Math.floor(i / 3) * 3, w: 3, h: 3, preferred: { w: 3, h: 3 } })), rows: 9 }
  for (const [w, h] of [[1800, 700], [740, 860], [1200, 500]]) {
    const p = projectGrid(source, w!, h!)
    assert.ok(validLayout(p.snapshot.placements, p.snapshot, constraintsFor(p.snapshot)))
    assert.ok(p.snapshot.placements.every(q => q.w === 3 && q.h >= 2 && q.h <= 3 && q.preferred.w === 3 && q.preferred.h === 3))
    assertSafe(source, { width: w!, height: h!, snapshot: p.snapshot, metrics: p.metrics })
  }
})
test('temporary preferred-size restoration never overwrites saved compression or accumulates shrink', () => {
  const source = structuredClone(DEFAULT_GRID); source.placements[1]!.w = 4
  const raw = JSON.stringify(source), a = projectGrid(source, 1200, 800).snapshot
  assert.equal(a.placements[1]!.preferred.w, 5)
  const b = projectGrid(source, 1800, 700).snapshot
  assert.equal(b.placements[1]!.w, 5); assert.equal(b.placements[1]!.preferred.w, 5)
  assert.deepEqual(projectGrid(source, 1200, 800).snapshot, a); assert.equal(JSON.stringify(source), raw)
})
