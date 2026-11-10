import test from 'node:test'
import assert from 'node:assert/strict'
import { alignedGesture, alignedMove, resolveAlignment } from '../src/shared/freeform/alignment.ts'
import { validLayout } from '../src/shared/freeform/geometry.ts'
import type { Constraints, Placement, Surface } from '../src/shared/freeform/types.ts'
const box = (id: string, x: number, y: number, width = 100, height = 100): Placement => ({ id, x, y, width, height, region: 'main', preferred: { width, height } })
const surface: Surface = { region: 'main', width: 800, height: 600, expanded: false }
const cs: Constraints = Object.fromEntries(['moving', 'a', 'b'].map(id => [id, { min: { width: 100, height: 100 }, default: { width: 100, height: 100 }, max: { width: 800, height: 600 }, resizeX: true, resizeY: true, regions: ['main'], overflow: 'auto', responsive: 'region' }]))

test('400/410 separated-axis resize anchors the far edge and its subsequent upward move preserves the peer', () => {
  const source = [box('a', 200, 0, 200, 180), box('moving', 440, 250, 200, 180)], before = structuredClone(source)
  const result = alignedGesture(source, 'moving', box('moving', 414, 250, 226, 180), surface, cs, 'w')
  const moved = result.result.placements.find(p => p.id === 'moving')!
  assert.equal(moved.x, 410); assert.equal(moved.x + moved.width, 640)
  assert.equal(result.guides.find(g => g.axis === 'x')?.gap, 10); assert.equal(result.guides.find(g => g.axis === 'x')?.peerLine, 400)
  const upward = alignedMove(result.result.placements, 'moving', { ...moved, y: 0 }, surface, cs)
  assert.deepEqual(upward.result.placements.find(p => p.id === 'a'), source[0]); assert.equal(upward.result.placements.find(p => p.id === 'moving')!.x, 410)
  assert.deepEqual(source, before); assert.ok(validLayout(upward.result.placements, surface, cs))
})
test('resize supports corner spacing on both axes, centers and fixed opposite edges; invalid snaps retain the ordinary result', () => {
  const source = [box('a', 0, 0, 200, 200), box('moving', 250, 250, 200, 200)]
  const corner = alignedGesture(source, 'moving', box('moving', 214, 214, 236, 236), surface, cs, 'nw')
  const p = corner.result.placements.find(p => p.id === 'moving')!
  assert.deepEqual([p.x, p.y, p.x + p.width, p.y + p.height], [210, 210, 450, 450]); assert.deepEqual(corner.guides.map(g => g.gap), [10, 10])
  const center = alignedGesture([box('a', 300, 300, 200), box('moving', 0, 0, 200)], 'moving', box('moving', 0, 0, 396), surface, cs, 'e')
  assert.equal(center.result.placements.find(p => p.id === 'moving')!.width, 400)
  const invalid = alignedGesture(source, 'moving', box('moving', 250, 250, 100), surface, cs, 'w')
  assert.equal(invalid.result.placements.find(p => p.id === 'moving')!.width, 100); assert.equal(invalid.guides.length, 0)
  const released = resolveAlignment({ ...p, x: 230 }, [source[0]!], corner.locks, 'nw'); assert.equal(released.locks.x, undefined)
  const bottomCs = Object.fromEntries(Object.entries(cs).map(([id,c]) => [id, { ...c, regions: ['bottom'], resizeY: false }])) as Constraints
  const bottom = alignedGesture(source.map(p => ({...p, region:'bottom',y:0,height:100})), 'moving', box('moving', 214, 0, 236, 100), {...surface,region:'bottom'}, bottomCs, 'w')
  assert.ok(bottom.guides.every(g => g.axis === 'x'))
})
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
test('facing-edge clearance is symmetric for east and south resize before cross-axis contact', () => {
  const peer = box('a', 300, 300)
  for (const axis of ['x', 'y'] as const) {
    const original = box('moving', 0, 0, 200, 200), requested = { ...original, [axis === 'x' ? 'width' : 'height']: 294 }
    const result = alignedGesture([original, peer], 'moving', requested, surface, cs, axis === 'x' ? 'e' : 's')
    const active = result.result.placements.find(p => p.id === 'moving')!, guide = result.guides.find(g => g.axis === axis)!
    assert.equal(peer[axis] - active[axis] - active[axis === 'x' ? 'width' : 'height'], 10)
    assert.equal(active[axis], 0); assert.equal(guide.gap, 10); assert.equal(guide.kind, 'spacing')
    assert.deepEqual(result.result.placements.find(p => p.id === 'a'), peer); assert.ok(validLayout(result.result.placements, surface, cs))
  }
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
  assert.equal(result.result.status, 'valid'); assert.equal(result.guides.find(guide => guide.axis === 'x')?.gap, 10)
  assert.equal(result.result.placements.find(p => p.id === 'moving')!.x, 190)
  assert.ok(validLayout(result.result.placements, surface, cs))
  assert.ok(result.result.probes <= 8192 && result.result.states <= 2048)
  const narrow = { ...surface, width: 400 }
  const accepted = alignedMove([box('moving', 0, 0), box('a', 300, 200)], 'moving', box('moving', 304, 0), narrow, cs)
  assert.equal(accepted.result.status, 'valid'); assert.ok(validLayout(accepted.result.placements, narrow, cs))
})
test('a held collision on one axis cannot suppress a valid independent alignment', () => {
  const source = [box('moving', 522, 0, 510, 360), box('a', 0, 0, 510, 360), box('b', 540, 370, 510, 360)]
  const at = { ...surface, width: 1647, height: 894 }
  const result = alignedMove(source, 'moving', box('moving', 4, 370, 510, 360), at, cs, { x: 'b:x:1:0', y: 'a:y:0:1' })
  assert.equal(result.result.status, 'valid'); assert.equal(result.result.placements[0]!.x, 0)
  assert.equal(result.result.placements[0]!.y, 370); assert.deepEqual(result.guides.map(guide => guide.axis), ['x', 'y'])
  assert.ok(validLayout(result.result.placements, at, cs)); assert.ok(result.result.probes <= 8192 && result.result.states <= 2048)
})
