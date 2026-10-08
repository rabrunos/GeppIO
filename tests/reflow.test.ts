import test from 'node:test'
import assert from 'node:assert/strict'
import { allowsResize, canPlace, moveRect, reflow, RESIZE_DIRECTIONS, resizeDirectional } from '../src/shared/layout.ts'
import type { LayoutConstraint, Placement } from '../src/shared/layout.ts'
import { DEFAULT_LAYOUT, MAIN_CONSTRAINTS } from '../src/shared/layout-defaults.ts'

const constraint: LayoutConstraint = { min: { width: .1, height: .1 }, max: { width: .8, height: .8 }, resizeX: true, resizeY: true }
const constraints = (ps: Placement[], overrides: Record<string, Partial<LayoutConstraint>> = {}) => Object.fromEntries(ps.map(p => [p.id, { ...constraint, ...overrides[p.id] }]))
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
function valid(ps: Placement[], cs: Record<string, LayoutConstraint>) {
  for (const p of ps) {
    assert.ok(canPlace(p, ps)); assert.ok(p.width >= cs[p.id]!.min.width && p.height >= cs[p.id]!.min.height)
    assert.ok(p.width <= cs[p.id]!.max.width && p.height <= cs[p.id]!.max.height)
  }
}

for (const direction of RESIZE_DIRECTIONS) test(`direction ${direction}: inward/outward, anchors, finite bounds, minima/maxima`, () => {
  const rect = { x: .3, y: .3, width: .3, height: .3 }
  for (const delta of [-100, -.037123, .029876, 100]) {
    const next = resizeDirectional(rect, delta, delta, direction, constraint)
    assert.ok(canPlace({ ...next, id: 'one' }, []))
    assert.ok(next.width >= .1 && next.height >= .1 && next.width <= .8 && next.height <= .8)
    if (direction.includes('w')) close(next.x + next.width, .6); else close(next.x, .3)
    if (direction.includes('n')) close(next.y + next.height, .6); else close(next.y, .3)
    if (!/[ew]/.test(direction)) close(next.width, .3)
    if (!/[ns]/.test(direction)) close(next.height, .3)
    if (direction.includes('e')) close(next.width, Math.min(.7, Math.max(.1, .3 + delta)))
    if (direction.includes('s')) close(next.height, Math.min(.7, Math.max(.1, .3 + delta)))
  }
  assert.deepEqual(rect, { x: .3, y: .3, width: .3, height: .3 })
})

test('maxima and disallowed axes are enforced; invalid inputs fail', () => {
  const rect = { x: .1, y: .1, width: .3, height: .3 }
  const horizontal = { ...constraint, resizeY: false, max: { width: .4, height: .4 } }
  assert.deepEqual(RESIZE_DIRECTIONS.filter(d => allowsResize(d, horizontal)), ['e', 'w'])
  close(resizeDirectional(rect, 10, 0, 'e', horizontal).width, .4)
  for (const d of ['n', 'ne', 'sw'] as const) assert.throws(() => resizeDirectional(rect, 0, .1, d, horizontal))
  for (const delta of [NaN, Infinity, -Infinity]) assert.throws(() => resizeDirectional(rect, delta, 0, 'e', constraint))
  assert.equal(allowsResize('e', { ...constraint, min: { width: .9, height: .1 } }), false)
})

test('free fractional movement and collision chain prefer forward displacement without shrinking', () => {
  const ps = [
    { id: 'a', x: 0, y: 0, width: .2, height: .8 },
    { id: 'b', x: .2, y: 0, width: .2, height: .8 },
    { id: 'c', x: .4, y: 0, width: .2, height: .8 }
  ]
  const before = structuredClone(ps), cs = constraints(ps)
  const result = reflow(ps, 'a', moveRect(ps[0]!, .137123, 0), cs)
  assert.equal(result.status, 'placed'); valid(result.placements, cs)
  assert.ok(result.moved.includes('b') && result.moved.includes('c')); assert.deepEqual(result.resized, [])
  close(result.placements[0]!.x, .137123); close(result.placements[1]!.x, .337123); close(result.placements[2]!.x, .537123)
  assert.deepEqual(ps, before)
  const free = reflow(ps, 'c', moveRect(ps[2]!, .123456, .01), cs)
  assert.equal(free.status, 'placed'); close(free.placements[2]!.x, .523456); valid(free.placements, cs)
})

test('cramped resize adapts only eligible impacted neighbours and preserves fixed-size examples', () => {
  const ps = [
    { id: 'a', x: 0, y: 0, width: .4, height: .8 },
    { id: 'b', x: .4, y: 0, width: .4, height: .8 },
    { id: 'locked', x: .8, y: 0, width: .2, height: .8 }
  ]
  const cs = constraints(ps, { b: { resizeY: false }, locked: { resizeX: false, resizeY: false } })
  const result = reflow(ps, 'a', { ...ps[0]!, width: .55 }, cs)
  assert.equal(result.status, 'placed'); valid(result.placements, cs)
  assert.ok(result.resized.includes('b')); assert.ok(!result.resized.includes('locked'))
  close(result.placements[1]!.height, .8); close(result.placements[2]!.width, .2)
  assert.deepEqual(ps[1], { id: 'b', x: .4, y: 0, width: .4, height: .8 })
})

test('west/north growth pushes chains toward the moving edge while keeping its opposite anchored', () => {
  for (const axis of ['x', 'y'] as const) {
    const ps = ['a', 'b', 'c'].map((id, i) => axis === 'x'
      ? { id, x: .8 - i * .2, y: 0, width: .2, height: .8 }
      : { id, x: 0, y: .8 - i * .2, width: .8, height: .2 })
    const cs = constraints(ps)
    const requested = resizeDirectional(ps[0]!, -.037123, -.037123, axis === 'x' ? 'w' : 'n', cs.a!)
    const result = reflow(ps, 'a', requested, cs)
    assert.equal(result.status, 'placed'); valid(result.placements, cs); assert.deepEqual(result.resized, ['a'])
    const size = axis === 'x' ? 'width' : 'height'
    close(result.placements[0]![axis] + result.placements[0]![size], 1)
    for (let i = 1; i < ps.length; i++) close(result.placements[i]![axis], ps[i]![axis] - .037123)
  }
})

test('dense cyclic alternatives terminate at bounded search with a valid untouched fallback', () => {
  const ps = Array.from({ length: 16 }, (_, i) => ({ id: `fixture-${String(i).padStart(2, '0')}`, x: (i % 4) * .25, y: Math.floor(i / 4) * .25, width: .25, height: .25 }))
  const cs = constraints(ps, Object.fromEntries(ps.map(p => [p.id, { min: { width: .25, height: .25 }, resizeX: false, resizeY: false }])))
  const result = reflow(ps, ps[0]!.id, { ...ps[0]!, x: .1 }, cs)
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'search-limit')
  assert.ok(result.attempts <= 4096); assert.deepEqual(result.placements, ps)
  assert.deepEqual(reflow(ps, ps[0]!.id, { ...ps[0]!, x: .1 }, cs), result)
})

test('impossible, bottom/right and non-finite candidates are non-destructive and stable', () => {
  const ps = [ { id: 'a', x: 0, y: 0, width: .5, height: .8 }, { id: 'b', x: .5, y: 0, width: .5, height: .8 } ]
  const cs = constraints(ps, { b: { resizeX: false, resizeY: false } })
  const requested = { ...ps[0]!, x: .1 }
  const result = reflow(ps, 'a', requested, cs)
  assert.equal(result.status, 'blocked'); assert.deepEqual(result.placements, ps)
  assert.deepEqual(reflow(ps, 'a', requested, cs), result); assert.ok(result.attempts <= 4096)
  for (const bad of [{ ...requested, x: NaN }, { ...requested, width: Infinity }, { ...requested, y: .8 }, { ...requested, x: .9 }]) {
    assert.equal(reflow(ps, 'a', bad, cs).status, 'blocked'); assert.deepEqual(reflow(ps, 'a', bad, cs).placements, ps)
  }
  assert.equal(reflow(ps, 'missing', requested, cs).reason, 'invalid-input')
  assert.equal(reflow([...ps, ps[0]!], 'a', requested, cs).reason, 'invalid-input')
  assert.equal(reflow(ps, 'a', requested, {}).reason, 'invalid-input')
})

test('stable ID tie-breakers, cycles and pointer reversal do not accumulate motion or shrink', () => {
  const ps = structuredClone(DEFAULT_LAYOUT.placements)
  const before = structuredClone(ps), base = ps[0]!
  for (const [dx, dy] of [[.3, .2], [-100, -100], [.74, .8], [.3, .2], [0, 0], [100, 100], [0, 0]]) {
    const candidate = moveRect(base, dx!, dy!)
    const first = reflow(ps, base.id, candidate, MAIN_CONSTRAINTS)
    const second = reflow([...ps].reverse(), base.id, candidate, MAIN_CONSTRAINTS)
    assert.equal(first.status, second.status); assert.ok(first.attempts <= 4096)
    assert.deepEqual([...first.placements].sort((a, b) => a.id.localeCompare(b.id)), [...second.placements].sort((a, b) => a.id.localeCompare(b.id)))
    valid(first.placements, MAIN_CONSTRAINTS)
    if (dx === 0 && dy === 0) assert.deepEqual(first.placements, ps)
  }
  assert.deepEqual(ps, before)
})

test('bounded sweep of moves and resize collisions preserves valid output and axis locks', () => {
  const ps = DEFAULT_LAYOUT.placements, cs = MAIN_CONSTRAINTS
  for (const p of ps) for (const direction of RESIZE_DIRECTIONS) for (const delta of [-1, -.031234, .04321, 1]) {
    const result = reflow(ps, p.id, resizeDirectional(p, delta, -delta, direction, cs[p.id]!), cs)
    valid(result.placements, cs); assert.ok(result.attempts <= 4096)
    if (result.status === 'blocked') assert.deepEqual(result.placements, ps)
  }
})
