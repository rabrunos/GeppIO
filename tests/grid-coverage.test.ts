import test from 'node:test'
import assert from 'node:assert/strict'
import { projectGrid } from '../src/shared/grid/projection.ts'
import { fitGrid, resizeRect } from '../src/shared/grid/geometry.ts'
import { constraintsFor } from '../src/shared/grid/policy.ts'
import { reflow } from '../src/shared/grid/reflow.ts'
import { COMPOSITIONS } from './fixtures/grid-compositions.ts'
import { assertContinuous, assertNoSpike, assertSafe } from './helpers/projection-oracle.ts'

test('independent minimum rows reconsider width: feasible 22x11 avoids the 1480x740 side band', () => {
  const source = COMPOSITIONS.left, width = 1480, height = 740
  // Explicit witness, independent of projectionAxis and projectGrid; preferred metadata is unchanged.
  const witness = { ...structuredClone(source), columns: 22, rows: 11, placements: source.placements.map((p, i) => {
    const r = [[0, 0, 6, 2], [13, 0, 3, 3], [0, 2, 5, 9], [19, 3, 3, 2], [13, 5, 3, 2], [19, 7, 3, 2], [13, 9, 3, 2]][i]!
    return { ...p, x: r[0]!, y: r[1]!, w: r[2]!, h: r[3]! }
  }) }
  const metrics = fitGrid(width, height, witness)
  assertSafe(source, { width, height, snapshot: witness, metrics })
  assert.ok(width - metrics.width < .01 && height - metrics.height <= 5.01)
  for (const w of [1478, 1479, 1480, 1481, 1482]) {
    const p = projectGrid(source, w, height)
    assertSafe(source, { width: w, height, ...p })
    assert.equal(p.snapshot.rows, 11); assert.equal(p.snapshot.columns, 22)
    assert.ok(w - p.metrics.width < .01, 'feasible near-full width must replace the avoidable band')
    assert.ok(height - p.metrics.height < 7)
  }
})

test('a recent deliberate edit cannot retain avoidable cap margins after moving to a taller viewport', () => {
  const initial = projectGrid(COMPOSITIONS.left, 1562, 576), base = initial.snapshot, cs = constraintsFor(base), p = base.placements[0]!
  const direct = reflow(base.placements, p.id, resizeRect(p, 0, 1, 's', base, cs[p.id]!), base, cs, 's')
  assert.equal(direct.status, 'valid')
  const source = { ...base, placements: direct.placements }, reference = { width: 1562, height: 576, pitch: initial.metrics.pitch }
  assert.deepEqual(projectGrid(source, reference.width, reference.height, reference).snapshot, source)
  const projected = projectGrid(source, 1480, 740, reference)
  assertSafe(source, { width: 1480, height: 740, ...projected })
  assert.equal(projected.snapshot.columns, 24)
  assert.ok(1480 - projected.metrics.width < .01, 'edit scale must not keep dead bands when 24 columns can fill width')
})

test('minimum columns reconsider height; large residual bands require the opposite 24-cell cap', () => {
  for (const source of Object.values(COMPOSITIONS)) for (const [width, height] of [[1480, 740], [1100, 650], [1700, 850], [740, 1480], [10000, 100], [100, 10000]]) {
    const p = projectGrid(source, width!, height!), m = p.metrics
    assertSafe(source, { width: width!, height: height!, ...p })
    if (p.snapshot.columns < 24) assert.ok(width! - m.width < m.pitch + .01, 'avoidable horizontal band')
    if (p.snapshot.rows < 24) assert.ok(height! - m.height < m.pitch + .01, 'avoidable vertical band')
    if (width! - m.width >= m.pitch || height! - m.height >= m.pitch) assert.ok(p.warning)
  }
})

test('coverage recovery keeps existing one-pixel budgets through every saved/edit topology band', () => {
  for (const fixture of Object.values(COMPOSITIONS)) for (const edit of [false, true]) {
    const initial = projectGrid(fixture, 1100, 650), source = edit ? initial.snapshot : fixture
    const reference = edit ? { width: 1100, height: 650, pitch: initial.metrics.pitch } : null
    for (const horizontal of [true, false]) {
      let previous, before
      for (let n = horizontal ? 800 : 400; n <= (horizontal ? 2200 : 1100); n++) {
        const width = horizontal ? n : 1480, height = horizontal ? 740 : n
        const next = { width, height, ...projectGrid(source, width, height, reference) }
        assertSafe(source, next)
        if (previous) assertContinuous(previous, next)
        if (before && previous) assertNoSpike(before, previous, next)
        before = previous; previous = next
      }
    }
  }
})
