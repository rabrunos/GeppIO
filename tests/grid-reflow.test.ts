import test from 'node:test'
import assert from 'node:assert/strict'
import { reflow } from '../src/shared/grid/reflow.ts'
import { validLayout } from '../src/shared/grid/occupancy.ts'
import { moveRect, resizeRect } from '../src/shared/grid/geometry.ts'
import { constraintsFor, DEFAULT_GRID } from '../src/shared/grid/policy.ts'
import { DIRECTIONS } from '../src/shared/grid/types.ts'
import type { GridConstraints, GridPlacement } from '../src/shared/grid/types.ts'

const p = (id: string, x: number, y: number, w = 2, h = 2): GridPlacement => ({ id, x, y, w, h, preferred: { w, h } })
function constraints(ps: GridPlacement[], columns: number, rows: number): GridConstraints {
  return Object.fromEntries(ps.map(p => [p.id, { min: { w: 1, h: 1 }, max: { w: columns, h: rows }, resizeX: true, resizeY: true }]))
}
test('forward collision chains, integer bounds, no gravity, repeatability and immutable reversal', () => {
  const ps = [p('a', 0, 2), p('b', 2, 2), p('c', 4, 2), p('lower', 0, 5)], b = { columns: 10, rows: 8 }, cs = constraints(ps, 10, 8), old = structuredClone(ps)
  const candidate = { ...ps[0]!, x: 1 }
  const result = reflow(ps, 'a', candidate, b, cs, 'move')
  assert.equal(result.status, 'valid'); assert.ok(validLayout(result.placements, b, cs))
  assert.equal(result.placements[1]!.x, 3); assert.equal(result.placements[2]!.x, 5)
  assert.deepEqual(result.placements[3], ps[3]); assert.deepEqual(ps, old)
  assert.deepEqual(reflow(ps, 'a', candidate, b, cs, 'move'), result)
  assert.deepEqual(reflow(ps, 'a', ps[0]!, b, cs, 'move').placements, old)
})
test('boundary compression retains orthogonal axis, far edge and original preferred size', () => {
  const ps = [p('a', 0, 0, 3, 3), p('b', 0, 3, 3, 3)], b = { columns: 6, rows: 6 }, cs = constraints(ps, 6, 6)
  const result = reflow(ps, 'a', { ...ps[0]!, h: 4 }, b, cs, 's')
  assert.equal(result.status, 'valid')
  const next = result.placements[1]!
  assert.equal(next.y, 4); assert.equal(next.h, 2); assert.equal(next.y + next.h, 6)
  assert.equal(next.x, 0); assert.equal(next.w, 3); assert.deepEqual(next.preferred, { w: 3, h: 3 })
  assert.deepEqual(reflow(ps, 'a', ps[0]!, b, cs, 's').placements, ps)
})
test('after compression limit, direct slot restores preferred size without moving unaffected widgets', () => {
  const ps = [p('a', 0, 0, 3, 3), p('b', 0, 3, 3, 3)], b = { columns: 6, rows: 6 }, cs = constraints(ps, 6, 6)
  const result = reflow(ps, 'a', { ...ps[0]!, h: 6 }, b, cs, 's')
  assert.equal(result.status, 'valid'); assert.equal(result.placements[1]!.x, 3)
  assert.deepEqual(result.placements[1]!.preferred, { w: 3, h: 3 }); assert.equal(result.placements[1]!.h, 3)
  const compressed = reflow(ps, 'a', { ...ps[0]!, h: 4 }, b, cs, 's').placements
  assert.equal(compressed[1]!.h, 2)
  const later = reflow(compressed, 'a', { ...compressed[0]!, h: 6 }, b, cs, 's')
  assert.equal(later.status, 'valid'); assert.equal(later.placements[1]!.h, 3)
  assert.deepEqual(later.placements[1]!.preferred, { w: 3, h: 3 })
})
test('bounded multi-widget rearrangement searches a valid composition with fixed sizes', () => {
  // No direct 2x2 hole is available after a moves. Moving d left creates one for b.
  const ps = [p('a', 0, 0), p('b', 2, 0), p('c', 4, 0), p('d', 1, 2), p('e', 4, 2)], b = { columns: 6, rows: 4 }
  const cs = Object.fromEntries(ps.map(p => [p.id, { min: { w: 2, h: 2 }, max: { w: 2, h: 2 }, resizeX: false, resizeY: false }]))
  const result = reflow(ps, 'a', { ...ps[0]!, x: 1 }, b, cs, 'move')
  assert.equal(result.status, 'valid'); assert.ok(validLayout(result.placements, b, cs)); assert.ok(result.states <= 16384)
  assert.deepEqual(result.placements[1], { ...ps[1]!, y: 2 })
  assert.deepEqual(result.placements[3], { ...ps[3]!, x: 0 })
  assert.deepEqual(result.placements[2], ps[2]); assert.deepEqual(result.placements[4], ps[4])
})
test('impossible dense layout and invalid input block without loss or caller mutations', () => {
  const ps = [p('a', 0, 0), p('b', 2, 0), p('c', 0, 2), p('d', 2, 2)], b = { columns: 4, rows: 4 }
  const cs = Object.fromEntries(ps.map(p => [p.id, { min: { w: 2, h: 2 }, max: { w: 4, h: 4 }, resizeX: false, resizeY: false }]))
  const old = structuredClone(ps), result = reflow(ps, 'a', { ...ps[0]!, x: 1 }, b, cs, 'move')
  assert.equal(result.status, 'blocked'); assert.deepEqual(result.placements, old); assert.deepEqual(ps, old)
  assert.equal(reflow(ps, 'a', { ...ps[0]!, x: .5 }, b, cs, 'move').reason, 'invalid')
  assert.equal(reflow(ps, 'a', { ...ps[0]!, w: 3 }, b, cs, 'e').reason, 'invalid')
})
test('high occupancy moves/eight-direction sweep is deterministic, finite, bounded and lossless', () => {
  const ps = DEFAULT_GRID.placements, cs = constraintsFor(DEFAULT_GRID), old = structuredClone(ps)
  for (const widget of ps) for (const delta of [-2, -1, 1, 2]) {
    const candidates = [{ rect: moveRect(widget, delta, delta, DEFAULT_GRID), kind: 'move' as const },
      ...DIRECTIONS.map(kind => ({ rect: resizeRect(widget, delta, delta, kind, DEFAULT_GRID, cs[widget.id]!), kind }))]
    for (const { rect, kind } of candidates) {
      const result = reflow(ps, widget.id, rect, DEFAULT_GRID, cs, kind)
      assert.ok(result.states <= 16384)
      assert.ok(validLayout(result.placements, DEFAULT_GRID, cs))
      assert.deepEqual(result.placements.map(p => p.id), ps.map(p => p.id))
      if (result.status === 'blocked') assert.deepEqual(result.placements, ps)
      else assert.deepEqual({ x: result.placements.find(p => p.id === widget.id)!.x, y: result.placements.find(p => p.id === widget.id)!.y,
        w: result.placements.find(p => p.id === widget.id)!.w, h: result.placements.find(p => p.id === widget.id)!.h }, { x: rect.x, y: rect.y, w: rect.w, h: rect.h })
      assert.deepEqual(reflow(ps, widget.id, rect, DEFAULT_GRID, cs, kind), result)
    }
  }
  assert.deepEqual(ps, old)
})
