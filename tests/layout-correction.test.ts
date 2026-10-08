import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasGap, canPlaceWithGap, decodeLayout, normalizeSpacing, reflow, RESIZE_DIRECTIONS, resizeDirectional, snapMove, snapResize, tooClose } from '../src/shared/layout.ts'
import type { LayoutConstraint, Placement, PlanningContext } from '../src/shared/layout.ts'
import { DEFAULT_LAYOUT, MAIN_CONSTRAINTS, MINIMUMS } from '../src/shared/layout-defaults.ts'
import { readLayout } from '../src/shared/storage.ts'

const c: LayoutConstraint = { min: { width: .1, height: .1 }, max: { width: 1, height: 1 }, resizeX: true, resizeY: true }
const constraints = (ps: Placement[]) => Object.fromEntries(ps.map(p => [p.id, structuredClone(c)]))
const context = (gesture: PlanningContext['gesture'], width = 1000, height = 1000): PlanningContext => ({ gesture, canvas: { width, height } })
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
function spaced(ps: Placement[], ctx: PlanningContext) {
  assert.ok(ps.every(p => canPlaceWithGap(p, ps, canvasGap(ctx.canvas))))
}

test('10 CSS px is measured separately against live canvas axes, including minimum canvas and scaled CSS dimensions', () => {
  for (const [width, height] of [[960, 620], [1200, 800], [1920, 1080], [1152, 752]]) {
    const gap = canvasGap({ width: width!, height: height! })
    close(gap.width * width!, 10); close(gap.height * height!, 10)
    const a = { x: 0, y: 0, width: .2, height: .2 }
    assert.equal(tooClose(a, { ...a, x: .2 }, gap), true)
    assert.equal(tooClose(a, { ...a, x: .2 + gap.width * .99 }, gap), true)
    assert.equal(tooClose(a, { ...a, x: .2 + gap.width }, gap), false)
    assert.equal(tooClose(a, { ...a, y: .2 + gap.height }, gap), false)
    assert.equal(canPlaceWithGap({ ...a, id: 'a' }, [], gap), true, 'No extra canvas-edge margin')
  }
  assert.throws(() => canvasGap({ width: 0, height: 620 })); assert.throws(() => canvasGap({ width: Infinity, height: 620 }))
})

test('diagonal-only adjacency permits corner contact; one-axis projected overlap requires a gap', () => {
  const a = { x: 0, y: 0, width: .2, height: .2 }, gap = canvasGap({ width: 1000, height: 1000 })
  assert.equal(tooClose(a, { ...a, x: .2, y: .2 }, gap), false)
  assert.equal(tooClose(a, { ...a, x: .205, y: .205 }, gap), false)
  assert.equal(tooClose(a, { ...a, x: .205, y: .199 }, gap), true)
  assert.equal(tooClose(a, { ...a, x: .199, y: .205 }, gap), true)
})

for (const direction of ['s', 'n', 'e', 'w'] as const) test(`${direction} growth compresses the directly adjacent neighbour before a feasible lateral escape`, () => {
  const vertical = direction === 's' || direction === 'n', forward = direction === 's' || direction === 'e'
  const ps: Placement[] = vertical ? [
    { id: 'active', x: .1, y: forward ? .1 : .6, width: .3, height: .2 },
    { id: 'neighbour', x: .1, y: forward ? .35 : .1, width: .3, height: .4 }
  ] : [
    { id: 'active', x: forward ? .1 : .6, y: .1, width: .2, height: .3 },
    { id: 'neighbour', x: forward ? .35 : .1, y: .1, width: .4, height: .3 }
  ]
  const cs = constraints(ps), ctx = context(direction)
  const requested = resizeDirectional(ps[0]!, vertical ? 0 : forward ? .1 : -.15, vertical ? forward ? .1 : -.15 : 0, direction, cs.active!)
  const result = reflow(ps, 'active', requested, cs, ctx)
  assert.equal(result.status, 'placed'); spaced(result.placements, ctx)
  const n = result.placements[1]!, prior = ps[1]!, axis = vertical ? 'y' : 'x', size = vertical ? 'height' : 'width'
  close(n[vertical ? 'x' : 'y'], prior[vertical ? 'x' : 'y']); close(n[vertical ? 'width' : 'height'], prior[vertical ? 'width' : 'height'])
  assert.ok(n[size] < prior[size], 'Technically working resize alone is insufficient: neighbour must compress on the same axis')
  if (forward) close(n[axis] + n[size], prior[axis] + prior[size]); else close(n[axis], prior[axis])
  assert.deepEqual(reflow(ps, 'active', requested, cs, ctx), result)
  assert.deepEqual(reflow([...ps].reverse(), 'active', requested, cs, ctx).placements.reverse(), result.placements)
  const reversal = reflow(ps, 'active', ps[0]!, cs, ctx); assert.deepEqual(reversal.placements, ps)
})

test('corner growth compresses the two adjacent axes without moving the other column/row', () => {
  const ps = [
    { id: 'a', x: .1, y: .1, width: .2, height: .2 },
    { id: 'right', x: .35, y: .1, width: .4, height: .2 },
    { id: 'below', x: .1, y: .35, width: .2, height: .4 }
  ]
  const ctx = context('se'), cs = constraints(ps)
  const result = reflow(ps, 'a', resizeDirectional(ps[0]!, .1, .1, 'se', cs.a!), cs, ctx)
  assert.equal(result.status, 'placed'); spaced(result.placements, ctx)
  close(result.placements[1]!.y, .1); close(result.placements[1]!.x + result.placements[1]!.width, .75)
  close(result.placements[2]!.x, .1); close(result.placements[2]!.y + result.placements[2]!.height, .75)
  assert.ok(result.placements[1]!.width < .4 && result.placements[2]!.height < .4)
})

test('move policy pushes a local forward chain without shrinking or swapping rows', () => {
  const ps = [0, .23, .46].map((x, i) => ({ id: String(i), x, y: .1, width: .2, height: .3 }))
  const ctx = context('move'), cs = constraints(ps)
  const result = reflow(ps, '0', { ...ps[0]!, x: .12 }, cs, ctx)
  assert.equal(result.status, 'placed'); spaced(result.placements, ctx); assert.deepEqual(result.resized, [])
  close(result.placements[1]!.x, .33); close(result.placements[2]!.x, .54)
  result.placements.forEach(p => close(p.y, .1))
})

test('insufficient resize slack compresses to the minimum and pushes on the same axis before lateral escape', () => {
  const ps = [
    { id: 'a', x: .1, y: .1, width: .3, height: .2 },
    { id: 'b', x: .1, y: .35, width: .3, height: .25 },
    { id: 'far', x: .7, y: .7, width: .2, height: .2 }
  ]
  const ctx = context('s'), cs = constraints(ps)
  const result = reflow(ps, 'a', { ...ps[0]!, height: .45 }, cs, ctx)
  assert.equal(result.status, 'placed'); spaced(result.placements, ctx)
  close(result.placements[1]!.height, .1); close(result.placements[1]!.y, .56)
  close(result.placements[1]!.x, .1); close(result.placements[1]!.width, .3)
  assert.deepEqual(result.placements[2], ps[2])
})

test('distant clearance targets cannot override move alignment; resize still matches distant sizes', () => {
  const gap = canvasGap({ width: 1205, height: 642.5 }), tolerance = { width: 7 / 1205, height: 7 / 642.5 }
  const neighbours = [
    { x: .46, y: 0, width: .2, height: .2 },
    { x: .25, y: .75, width: .2, height: .2 }
  ]
  const moved = snapMove({ x: .459, y: .3, width: .2, height: .2 }, neighbours, tolerance, gap)
  close(moved.rect.x, .46)
  const sized = snapResize({ x: .3, y: .3, width: .204, height: .2 }, 'e', c, neighbours, tolerance, gap)
  close(sized.rect.width, .2); assert.equal(sized.guides[0]!.kind, 'size')
})

test('locked resize axis uses local displacement/rejection; insufficient space never teleports to a remote hole', () => {
  const ps = [ { id: 'a', x: .1, y: .35, width: .3, height: .25 }, { id: 'below', x: .1, y: .64, width: .3, height: .25 } ]
  const cs = constraints(ps); cs.below!.resizeY = false
  const ctx = context('s'), request = { ...ps[0]!, height: .4 }
  const result = reflow(ps, 'a', request, cs, ctx)
  if (result.status === 'placed') {
    spaced(result.placements, ctx); close(result.placements[1]!.height, .25)
    assert.ok(result.placements[1]!.y >= .64, 'No lower-to-upper swap into the distant empty area')
  } else assert.deepEqual(result.placements, ps)
})

test('touching legacy v1 loads verbatim and spacing changes stay in a separate reversible preview', () => {
  const ps = [ { id: 'a', x: 0, y: 0, width: .4, height: .4 }, { id: 'b', x: .4, y: 0, width: .4, height: .4 } ]
  const raw = JSON.stringify({ schemaVersion: 1, theme: 'dark', placements: ps }), writes: string[] = []
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { writes.push(value) } }
  const fallback = decodeLayout(raw, ['a', 'b'])
  assert.deepEqual(readLayout(storage, 'fixture', fallback, {}).snapshot.placements, ps)
  const preview = normalizeSpacing(ps, constraints(ps), context('normalize'))
  assert.equal(preview.status, 'placed'); spaced(preview.placements, context('normalize'))
  assert.deepEqual(ps, fallback.placements); assert.deepEqual(writes, []); assert.equal(storage.getItem(), raw)
  const fixed = constraints(ps); Object.values(fixed).forEach(c => { c.resizeX = false; c.resizeY = false; c.min = { width: .4, height: .4 } })
  const full = [{ ...ps[0]!, height: 1 }, { ...ps[1]!, x: .4, width: .6, height: 1 }]
  fixed.b!.min.width = .6; fixed.a!.min.height = 1; fixed.b!.min.height = 1
  const impossible = normalizeSpacing(full, fixed, context('normalize'))
  assert.equal(impossible.status, 'blocked'); assert.deepEqual(impossible.placements, full)
  assert.deepEqual(writes, [])
})

test('seven existing fixtures and boundary gestures produce gap-valid output or an untouched fallback at differing canvases', () => {
  for (const [width, height] of [[960, 620], [1600, 900]]) for (const p of DEFAULT_LAYOUT.placements) for (const direction of RESIZE_DIRECTIONS) {
    const ctx = context(direction, width!, height!)
    const request = resizeDirectional(p, .047123, -.037123, direction, MAIN_CONSTRAINTS[p.id]!)
    const result = reflow(DEFAULT_LAYOUT.placements, p.id, request, MAIN_CONSTRAINTS, ctx)
    assert.ok(result.attempts <= 3072)
    if (result.status === 'placed') spaced(result.placements, ctx)
    else assert.deepEqual(result.placements, DEFAULT_LAYOUT.placements)
  }
  assert.deepEqual(decodeLayout(JSON.stringify(DEFAULT_LAYOUT), DEFAULT_LAYOUT.placements.map(p => p.id), MINIMUMS), DEFAULT_LAYOUT)
})

for (const direction of RESIZE_DIRECTIONS) test(`resize snap ${direction} matches dimensions from a distant widget while retaining opposite anchors`, () => {
  const raw = { x: .3, y: .3, width: .284, height: .254 }
  const neighbours = [{ x: .7, y: .7, width: .28, height: .25 }]
  const result = snapResize(raw, direction, c, neighbours, { width: .007, height: .007 }, canvasGap({ width: 1000, height: 1000 }))
  if (/[ew]/.test(direction)) close(result.rect.width, .28); else close(result.rect.width, .284)
  if (/[ns]/.test(direction)) close(result.rect.height, .25); else close(result.rect.height, .254)
  if (direction.includes('w')) close(result.rect.x + result.rect.width, raw.x + raw.width); else close(result.rect.x, raw.x)
  if (direction.includes('n')) close(result.rect.y + result.rect.height, raw.y + raw.height); else close(result.rect.y, raw.y)
  assert.ok(result.guides.some(g => g.kind === 'size'))
})

test('resize guides cover edge/centre alignment, clearance, max/min rejection and continuous unsnapped input', () => {
  const gap = canvasGap({ width: 1000, height: 1000 }), tolerance = { width: .007, height: .007 }
  const edge = snapResize({ x: .1, y: .1, width: .299, height: .2 }, 'e', c, [{ x: .4, y: .7, width: .2, height: .2 }], tolerance, gap)
  close(edge.rect.x + edge.rect.width, .4)
  const centre = snapResize({ x: .1, y: .1, width: .598, height: .2 }, 'e', c, [{ x: .3, y: .7, width: .2, height: .2 }], tolerance, gap)
  close(centre.rect.x + centre.rect.width / 2, .4)
  const clearance = snapResize({ x: .1, y: .1, width: .288, height: .2 }, 'e', c, [{ x: .4, y: .1, width: .2, height: .2 }], tolerance, gap)
  close(clearance.rect.x + clearance.rect.width, .39); assert.equal(clearance.guides[0]!.kind, 'clearance')
  const raw = { x: .1, y: .1, width: .271234, height: .212345 }
  assert.deepEqual(snapResize(raw, 'se', c, [], { width: 0, height: 0 }, gap).rect, raw)
  const maximum = { ...c, max: { width: .27, height: .3 } }
  close(snapResize({ ...raw, width: .268 }, 'e', maximum, [{ x: .7, y: .7, width: .28, height: .2 }], tolerance, gap).rect.width, .268)
  assert.throws(() => snapResize(raw, 'n', { ...c, resizeY: false }, [], tolerance, gap))
})
