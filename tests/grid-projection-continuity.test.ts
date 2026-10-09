import test from 'node:test'
import assert from 'node:assert/strict'
import { projectGrid } from '../src/shared/grid/projection.ts'
import { COMPOSITIONS } from './fixtures/grid-compositions.ts'
import { assertContinuous, assertNoSpike, assertSafe, spatialViolations } from './helpers/projection-oracle.ts'
import type { GridSnapshot } from '../src/shared/grid/types.ts'
import { constraintsFor } from '../src/shared/grid/policy.ts'
import { resizeRect } from '../src/shared/grid/geometry.ts'
import { reflow } from '../src/shared/grid/reflow.ts'

function sample(source: GridSnapshot, width: number, height: number) {
  const p = projectGrid(source, width, height)
  return { width, height, snapshot: p.snapshot, metrics: p.metrics }
}
test('sanitized large left Library cannot migrate right on window expansion', () => {
  for (let width = 850; width <= 1200; width++) {
    const p = sample(COMPOSITIONS.left, width, 650), library = p.snapshot.placements.find(q => q.id === 'library')!
    assert.ok((library.x + library.w / 2) / p.snapshot.columns < .5, `Library moved right at ${width}x650`)
    assertSafe(COMPOSITIONS.left, p)
  }
})
test('one-pixel Bottom/Sidebar changes cannot change density abruptly', () => {
  for (const source of Object.values(COMPOSITIONS)) for (const axis of ['width', 'height']) {
    let previous = sample(source, axis === 'width' ? 650 : 1100, axis === 'height' ? 400 : 650)
    let before: ReturnType<typeof sample> | undefined
    for (let n = (axis === 'width' ? 651 : 401); n <= (axis === 'width' ? 1700 : 1000); n++) {
      const next = sample(source, axis === 'width' ? n : 1100, axis === 'height' ? n : 650)
      assertContinuous(previous, next); assertSafe(source, next)
      if (before) assertNoSpike(before, previous, next)
      before = previous
      previous = next
    }
  }
})

test('sanitized compositions are immutable, cold/warm deterministic and preserve recent actual edits', () => {
  for (const source of Object.values(COMPOSITIONS)) {
    const raw = JSON.stringify(source), expected = new Map<string, ReturnType<typeof sample>>()
    for (const [w, h] of [[913, 650], [1100, 767], [1200, 800], [700, 1100], [1600, 500]]) expected.set(`${w},${h}`, sample(source, w!, h!))
    for (const key of [...expected.keys()].reverse()) {
      const [w, h] = key.split(',').map(Number), actual = sample(source, w!, h!)
      assert.deepEqual(actual, expected.get(key)); assertSafe(source, actual)
      // Explicit Edit/Save uses the visible bounds as a new stable source at these dimensions.
      assert.deepEqual(sample(actual.snapshot, w!, h!).snapshot, actual.snapshot)
    }
    assert.equal(JSON.stringify(source), raw)
  }
  const recent = sample(COMPOSITIONS.edited, 913, 650), original = sample(COMPOSITIONS.left, 913, 650)
  assert.notDeepEqual(recent.snapshot.placements.find(p => p.id === 'library'), original.snapshot.placements.find(p => p.id === 'library'))
})

test('independent oracle rejects permutation, missing widgets, invalid minima and density/area pulses', () => {
  const source = COMPOSITIONS.left, a = sample(source, 913, 650), bad = structuredClone(a)
  bad.snapshot.placements = bad.snapshot.placements.map(p => ({ ...p, x: bad.snapshot.columns - p.x - p.w }))
  assert.ok(spatialViolations(source, bad.snapshot).some(error => error.includes('reversed')))
  assert.throws(() => assertSafe(source, bad))
  const missing = structuredClone(a); missing.snapshot.placements.pop(); assert.throws(() => assertSafe(source, missing))
  const below = structuredClone(a); below.snapshot.placements[0]!.w = 2; assert.throws(() => assertSafe(source, below))
  const pulse = structuredClone(a); pulse.width++; pulse.metrics.pitch *= 1.2
  assert.throws(() => assertContinuous(a, pulse)); assert.throws(() => assertNoSpike(a, pulse, a))
})

test('explicit edit plane preserves direct results at exact measurements; viewport changes still adapt', () => {
  for (const source of Object.values(COMPOSITIONS)) {
    const initial = projectGrid(source, 1562, 576), a = initial.snapshot
    const viewport = { width: 1562, height: 576, pitch: initial.metrics.pitch }
    for (const p of a.placements) for (const direction of ['e', 's'] as const) for (const delta of [-1, 1]) {
      const cs = constraintsFor(a), result = reflow(a.placements, p.id, resizeRect(p, delta, delta, direction, a, cs[p.id]!), a, cs, direction)
      if (result.status !== 'valid') continue
      const edited = { ...a, placements: result.placements }, raw = JSON.stringify(edited)
      assert.deepEqual(projectGrid(edited, viewport.width, viewport.height, viewport).snapshot, edited)
      const changed = projectGrid(edited, viewport.width - 1, viewport.height, viewport)
      assertSafe(edited, { width: viewport.width - 1, height: viewport.height, ...changed })
      assertContinuous({ width: viewport.width, height: viewport.height, ...projectGrid(edited, viewport.width, viewport.height, viewport) },
        { width: viewport.width - 1, height: viewport.height, ...changed })
      assert.deepEqual(projectGrid(edited, viewport.width, viewport.height, { ...viewport }).snapshot, edited)
      assert.equal(JSON.stringify(edited), raw)
    }
  }
})

test('recent constrained direct edit remains continuous through one-pixel reference crossings and full sweeps', () => {
  const initial = projectGrid(COMPOSITIONS.left, 1562, 576), base = initial.snapshot, p = base.placements[0]!, cs = constraintsFor(base)
  const direct = reflow(base.placements, p.id, resizeRect(p, 0, 1, 's', base, cs[p.id]!), base, cs, 's')
  assert.equal(direct.status, 'valid')
  const source = { ...base, placements: direct.placements }, reference = { width: 1562, height: 576, pitch: initial.metrics.pitch }
  for (const axis of ['width', 'height']) {
    let previous: ReturnType<typeof sample> | undefined, before: ReturnType<typeof sample> | undefined
    for (let n = axis === 'width' ? 650 : 400; n <= (axis === 'width' ? 1700 : 1000); n++) {
      const width = axis === 'width' ? n : reference.width, height = axis === 'height' ? n : reference.height
      const next = { width, height, ...projectGrid(source, width, height, reference) }
      assertSafe(source, next)
      if (previous) assertContinuous(previous, next)
      if (before && previous) assertNoSpike(before, previous, next)
      before = previous; previous = next
    }
  }
})
