import test from 'node:test'
import assert from 'node:assert/strict'
import { collides } from '../src/shared/freeform/geometry.ts'
import { CONSTRAINTS, DEFAULT_FREEFORM } from '../src/shared/freeform/policy.ts'
import { projectRegion } from '../src/shared/freeform/projection.ts'
import { transfer } from '../src/shared/freeform/transfer.ts'
import { candidate, same } from '../src/shared/freeform/geometry.ts'
import { constraintsFor } from '../src/shared/freeform/policy.ts'
import { reflow } from '../src/shared/freeform/reflow.ts'
import { DIRECTIONS } from '../src/shared/freeform/types.ts'

test('every feasible intermediate resize is identical at its own reference, including diagonal sub-gap contacts', () => {
  const source = DEFAULT_FREEFORM, surface = { ...source.reference.main, region: 'main' as const, expanded: false }, cs = constraintsFor(surface)
  const p = source.placements.find(p => p.id === 'properties')!
  for (const direction of DIRECTIONS) for (const delta of [1, 4.25, 9.125, 30.5, 80, 5000, 0]) {
    const wanted = candidate(p, /w/.test(direction) ? -delta : delta, /n/.test(direction) ? -delta : delta, direction, surface, cs[p.id]!)
    const result = reflow(source.placements, p.id, wanted, surface, cs, direction)
    if (result.status === 'blocked') continue
    const view = projectRegion({ ...source, placements: result.placements }, 'main', surface, false)
    assert.deepEqual(view.placements, result.placements, `${direction} ${delta}: projection cannot re-solve a valid direct preview`)
    assert.ok(same(view.placements.find(q => q.id === p.id)!, wanted))
  }
})

test('bounded projections are continuous, reversible, lossless and derived from one stable source', () => {
  const original = structuredClone(DEFAULT_FREEFORM)
  const first = projectRegion(original, 'main', { width: 960, height: 620 }, false)
  assert.deepEqual(first.placements, original.placements)
  for (const height of [480, 620, 740]) {
    let previous = projectRegion(original, 'main', { width: 760, height }, false)
    for (let width = 761; width <= 1400; width++) {
      const view = projectRegion(original, 'main', { width, height }, false)
      assert.ok(view.feasible)
      for (const [i, p] of view.placements.entries()) {
        assert.ok(p.width >= CONSTRAINTS[p.id]!.min.width && p.height >= CONSTRAINTS[p.id]!.min.height)
        assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.width <= width + 1e-6 && p.y + p.height <= height + 1e-6)
        assert.ok(view.placements.slice(i + 1).every(q => !collides(p, q)))
        const before = previous.placements[i]!
        for (const axis of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(before[axis] - p[axis]) < 3, `${p.id} ${axis}`)
        assert.deepEqual(p.preferred, original.placements[i]!.preferred)
      }
      previous = view
    }
  }
  assert.deepEqual(projectRegion(original, 'main', { width: 960, height: 620 }, false), first)
  assert.deepEqual(original, DEFAULT_FREEFORM)
})
test('infeasible minima retain source geometry in a finite recoverable scroll area', () => {
  const view = projectRegion(DEFAULT_FREEFORM, 'main', { width: 100, height: 100 }, false)
  assert.equal(view.feasible, false); assert.deepEqual(view.placements, DEFAULT_FREEFORM.placements)
  assert.equal(view.world.width, 960); assert.equal(view.world.height, 620)
})
test('expanded horizontal range follows occupied edges without right padding or width projection', () => {
  const source = structuredClone(DEFAULT_FREEFORM); source.placements[0]!.x = 12345.125
  for (const width of [760, 1100, 1600]) {
    const view = projectRegion(source, 'main', { width, height: 620 }, true)
    assert.equal(view.placements[0]!.x, 12345.125); assert.equal(view.placements[0]!.width, 230)
    assert.equal(view.world.width, 12575.125)
  }
  source.placements[0]!.x = 0
  assert.equal(projectRegion(source, 'main', { width: 800, height: 620 }, true).world.width, 960)
})
test('region cross axes follow available sizes and return without cumulative changes', () => {
  const side = transfer(DEFAULT_FREEFORM, 'properties', { region: 'sidebar', width: 260, height: 400, expanded: false })!
  for (const width of [250, 270, 260]) {
    const view = projectRegion(side, 'sidebar', { width, height: 400 }, true)
    assert.equal(view.placements[0]!.x, 0); assert.equal(view.placements[0]!.width, width)
  }
  assert.equal(projectRegion(side, 'sidebar', { width: 185, height: 400 }, false).feasible, false)
  const bottom = transfer(DEFAULT_FREEFORM, 'summary', { region: 'bottom', width: 960, height: 128, expanded: false })!
  assert.equal(projectRegion(bottom, 'bottom', { width: 960, height: 115 }, false).placements[0]!.height, 115)
  assert.equal(projectRegion(bottom, 'bottom', { width: 960, height: 50 }, false).feasible, false)
})

test('Sidebar owns vertical extent; Main expansion cannot expand Bottom or Sidebar sideways', () => {
  const source = structuredClone(DEFAULT_FREEFORM)
  const side = source.placements[0]!
  Object.assign(side, { region: 'sidebar', x: 0, y: 900.125, width: 230, height: 140 })
  source.reference.sidebar = { width: 230, height: 1040.125 }
  const before = structuredClone(source)
  for (const expanded of [false, true]) {
    const view = projectRegion(source, 'sidebar', { width: 240, height: 300 }, expanded)
    assert.equal(view.feasible, true); assert.equal(view.placements[0]!.y, 900.125)
    assert.equal(view.placements[0]!.height, 140); assert.equal(view.world.height, 1040.125); assert.equal(view.world.width, 240)
  }
  Object.assign(side, { region: 'bottom', x: 900.125, y: 0, width: 230, height: 128 })
  source.reference.bottom = { width: 1200, height: 128 }
  for (const expanded of [false, true]) {
    const view = projectRegion(source, 'bottom', { width: 200, height: 50 }, expanded)
    assert.equal(view.feasible, false); assert.deepEqual(view.world, { width: 200, height: 50 })
    assert.deepEqual(view.placements, [side])
  }
  assert.equal(before.placements[0]!.y, 900.125)
})
