import test from 'node:test'
import assert from 'node:assert/strict'
import { fitGrid, moveRect, pixelRect, resizeRect } from '../src/shared/grid/geometry.ts'
import { DIRECTIONS } from '../src/shared/grid/types.ts'
import { constraintsFor, DEFAULT_GRID } from '../src/shared/grid/policy.ts'
import { validLayout } from '../src/shared/grid/occupancy.ts'

test('square cells always center in both dimensions; tiny viewports reduce symmetric gutters', () => {
  for (const [width, height] of [[1200, 800], [400, 800], [1500, 250], [1, 1], [0, 0]]) {
    for (const scale of [1, 1.25, 1.5, 2]) {
      const m = fitGrid(width! / scale, height! / scale, DEFAULT_GRID)
      assert.ok(m.width <= width! / scale + 1e-9 && m.height <= height! / scale + 1e-9)
      assert.ok(m.cell >= 0 && m.gutter >= 0 && m.gutter <= 10)
      assert.equal(m.cell + m.gutter, m.pitch)
      for (const units of [1, 3]) {
        const r = pixelRect({ x: 1, y: 1, w: units, h: units }, m)
        assert.equal(r.width, r.height); assert.equal(r.left, r.top)
      }
      assert.ok(Math.abs(m.left * 2 + m.width - width! / scale) < 1e-9)
      assert.ok(Math.abs(m.top * 2 + m.height - height! / scale) < 1e-9)
    }
  }
  assert.equal(fitGrid(1200, 800, DEFAULT_GRID).gutter, 10)
  assert.throws(() => fitGrid(-1, 800, DEFAULT_GRID))
})
test('default grid has seven bounded widgets; eight anchored directions and integer movement', () => {
  assert.ok(validLayout(DEFAULT_GRID.placements, DEFAULT_GRID, constraintsFor(DEFAULT_GRID)))
  const p = { x: 3, y: 2, w: 4, h: 3 }, cs = constraintsFor(DEFAULT_GRID).summary!
  for (const d of DIRECTIONS) {
    const r = resizeRect(p, d.includes('w') ? -1 : 1, d.includes('n') ? -1 : 1, d, DEFAULT_GRID, cs)
    if (d.includes('w')) assert.equal(r.x + r.w, p.x + p.w); else assert.equal(r.x, p.x)
    if (d.includes('n')) assert.equal(r.y + r.h, p.y + p.h); else assert.equal(r.y, p.y)
    if (!/[ew]/.test(d)) assert.equal(r.w, p.w)
    if (!/[ns]/.test(d)) assert.equal(r.h, p.h)
  }
  assert.deepEqual(moveRect(p, .8, 2, DEFAULT_GRID), { ...p, x: 4, y: 4 })
  assert.throws(() => resizeRect(p, 1, 0, 'e', DEFAULT_GRID, { ...cs, resizeX: false }))
})
