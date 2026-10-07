import test from 'node:test'
import assert from 'node:assert/strict'
import { validRect, overlaps, canPlace, moveRect, resizeRect, snapMove, decodeLayout, MAX_LAYOUT_BYTES } from '../src/shared/layout.ts'
import { DEFAULT_LAYOUT, MINIMUMS, WIDGETS } from '../src/renderer/src/fixtures.ts'
const rect = { x: .1, y: .2, width: .25, height: .3 }
const ids = DEFAULT_LAYOUT.placements.map(p => p.id)
test('ten fixtures exist; initial seven-main composition fits without overlaps', () => {
  assert.equal(WIDGETS.length, 10); assert.equal(ids.length, 7)
  for (const p of DEFAULT_LAYOUT.placements) assert.equal(canPlace(p, DEFAULT_LAYOUT.placements), true)
})
test('coordinates are continuous, not snapped to a fixed grid', () => assert.equal(moveRect(rect, .012538, 0).x, .112538))
test('movement clamps to region bounds', () => { assert.equal(moveRect(rect, -20, 0).x, 0); assert.equal(moveRect(rect, 20, 0).x, .75) })
test('touching edges are allowed; overlap is not', () => {
  assert.equal(overlaps({ x: 0, y: 0, width: .5, height: .5 }, { x: .5, y: 0, width: .5, height: .5 }), false)
  assert.equal(overlaps(rect, { ...rect, x: .2 }), true)
})
test('invalid numbers and impossible rectangles rejected', () => {
  for (const x of [NaN, Infinity, -Infinity, -.1, 1]) assert.equal(validRect({ ...rect, x }), false)
  assert.equal(validRect({ ...rect, width: 0 }), false)
  assert.throws(() => moveRect(rect, NaN, 0)); assert.throws(() => resizeRect(rect, Infinity, 0, { width: .1, height: .1 }))
})
test('resize respects minimum and outer boundary', () => {
  assert.equal(resizeRect(rect, -20, -20, { width: .17, height: .18 }).width, .17)
  assert.equal(resizeRect(rect, 20, 20, { width: .17, height: .18 }).height, .8)
})
test('smart guides target neighbour edges without introducing columns', () => {
  const result = snapMove({ x: .299, y: .2, width: .1, height: .2 }, [{ x: .3, y: .6, width: .2, height: .2 }], { width: .005, height: .005 })
  assert.ok(Math.abs(result.rect.x - .3) < 1e-9); assert.ok(result.guides.some(g => g.axis === 'x'))
})
test('valid snapshot round trips and rejects a later schema', () => {
  assert.deepEqual(decodeLayout(JSON.stringify(DEFAULT_LAYOUT), ids, MINIMUMS), DEFAULT_LAYOUT)
  assert.throws(() => decodeLayout(JSON.stringify({ ...DEFAULT_LAYOUT, schemaVersion: 2 }), ids))
})
test('duplicates, unknown widgets, missing widgets and malformed payloads fail', () => {
  for (const mutate of [
    (d: typeof DEFAULT_LAYOUT) => { d.placements[0]!.id = d.placements[1]!.id },
    (d: typeof DEFAULT_LAYOUT) => { d.placements[0]!.id = 'unknown' },
    (d: typeof DEFAULT_LAYOUT) => { d.placements.pop() },
    (d: typeof DEFAULT_LAYOUT) => { d.placements[0]!.width = -1 },
    (d: typeof DEFAULT_LAYOUT) => { d.placements[0]!.x = .4 }
  ]) { const d = structuredClone(DEFAULT_LAYOUT); mutate(d); assert.throws(() => decodeLayout(JSON.stringify(d), ids, MINIMUMS)) }
  for (const text of ['null', '[]', '{', JSON.stringify({ ...DEFAULT_LAYOUT, theme: 'javascript:' })]) assert.throws(() => decodeLayout(text, ids))
})
test('untrusted layout size bounded before parsing', () => assert.throws(() => decodeLayout(' '.repeat(MAX_LAYOUT_BYTES + 1), ids)))
test('unknown fields cannot smuggle executable metadata into layout state', () => {
  const value = { ...structuredClone(DEFAULT_LAYOUT), script: '<script>bad()</script>' }
  const decoded = decodeLayout(JSON.stringify(value), ids)
  assert.equal('script' in decoded, false)
})
