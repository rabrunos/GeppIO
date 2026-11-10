import test from 'node:test'
import assert from 'node:assert/strict'
import { alignedMove, resolveAlignment } from '../src/shared/freeform/alignment.ts'
import { validLayout } from '../src/shared/freeform/geometry.ts'
import type { Constraints, Placement, Surface } from '../src/shared/freeform/types.ts'
const box = (id: string, x: number, y: number, width = 100, height = 100): Placement => ({ id, x, y, width, height, region: 'main', preferred: { width, height } })
const surface: Surface = { region: 'main', width: 800, height: 600, expanded: false }
const cs: Constraints = Object.fromEntries(['moving', 'a', 'b'].map(id => [id, { min: { width: 100, height: 100 }, default: { width: 100, height: 100 }, max: { width: 800, height: 600 }, resizeX: true, resizeY: true, regions: ['main'], overflow: 'auto', responsive: 'region' }]))
test('edge/center candidates, CSS-pixel entry/exit hysteresis and stable ties', () => {
  const moving = box('moving', 304, 0), peer = box('a', 300, 200)
  const entered = resolveAlignment(moving, [peer]); assert.equal(entered.rect.x, 300)
  assert.equal(resolveAlignment({ ...moving, x: 310 }, [peer], entered.locks).rect.x, 300)
  assert.equal(resolveAlignment({ ...moving, x: 315 }, [peer], entered.locks).rect.x, 315)
  assert.equal(resolveAlignment(box('moving', 354, 0), [box('a', 300, 200, 200)]).rect.x, 350)
  const a = box('a', 300, 200), b = box('b', 308, 400)
  assert.equal(resolveAlignment(moving, [b, a]).locks.x, resolveAlignment(moving, [a, b]).locks.x)
  assert.equal(resolveAlignment(moving, []).chosen.length, 0)
})
test('snap retains dimensions, bounded clearance and the stable source without a second solver', () => {
  const source = [box('moving', 0, 0), box('a', 300, 200)], before = structuredClone(source)
  const aligned = alignedMove(source, 'moving', box('moving', 304, 0), surface, cs)
  assert.equal(aligned.result.placements[0]!.x, 300); assert.equal(aligned.guides.length, 1)
  assert.ok(validLayout(aligned.result.placements, surface, cs)); assert.deepEqual(source, before)
  assert.equal(aligned.result.placements[0]!.width, 100)
  assert.equal(alignedMove(source, 'moving', box('moving', 304, 0, 99), surface, cs).result.status, 'blocked')
})
test('invalid collision snap falls back to ordinary drag; narrow bounds and operation budgets stay valid', () => {
  const source = [box('moving', 0, 0), box('a', 300, 0)]
  const result = alignedMove(source, 'moving', box('moving', 194, 0), surface, cs)
  assert.equal(result.result.status, 'valid'); assert.equal(result.guides.some(guide => guide.axis === 'x'), false)
  assert.equal(result.result.placements.find(p => p.id === 'moving')!.x, 194)
  assert.ok(validLayout(result.result.placements, surface, cs))
  assert.ok(result.result.probes <= 8192 && result.result.states <= 2048)
  const narrow = { ...surface, width: 400 }
  const accepted = alignedMove([box('moving', 0, 0), box('a', 300, 200)], 'moving', box('moving', 304, 0), narrow, cs)
  assert.equal(accepted.result.status, 'valid'); assert.ok(validLayout(accepted.result.placements, narrow, cs))
})
test('a held collision on one axis cannot suppress a valid independent alignment', () => {
  const source = [box('moving', 522, 0, 510, 360), box('a', 0, 0, 510, 360), box('b', 522, 370, 510, 360)]
  const at = { ...surface, width: 1647, height: 894 }
  const result = alignedMove(source, 'moving', box('moving', 4, 370, 510, 360), at, cs, { x: 'b:x:1:0', y: 'a:y:0:1' })
  assert.equal(result.result.status, 'valid'); assert.equal(result.result.placements[0]!.x, 0)
  assert.equal(result.result.placements[0]!.y, 370); assert.deepEqual(result.guides.map(guide => guide.axis), ['x'])
  assert.ok(validLayout(result.result.placements, at, cs)); assert.ok(result.result.probes <= 8192 && result.result.states <= 2048)
})
