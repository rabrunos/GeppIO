import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_HORIZONTAL, HORIZONTAL, HORIZONTAL_KEY, HORIZONTAL_BOUNDS, horizontalCandidate, horizontalConstraints,
  horizontalExtent, horizontalMetrics, parseHorizontal, readHorizontal, serializeHorizontal, validHorizontalLayout, writeHorizontal } from '../src/shared/grid/horizontal.ts'
import { horizontalReflow } from '../src/shared/grid/horizontal-reflow.ts'
import { parseGrid } from '../src/shared/grid/schema.ts'
import { DEFAULT_GRID, GRID_KEY } from '../src/shared/grid/policy.ts'
import { DIRECTIONS } from '../src/shared/grid/types.ts'

test('ten height-derived square rows, one perimeter, content-only extent, finite pathological measurements', () => {
  const m = horizontalMetrics(1700, 940)
  assert.equal(m.cell, 82); assert.equal(m.pitch, 92); assert.equal(m.height, 910)
  assert.deepEqual(horizontalMetrics(900, 940), { ...m, width: 870 })
  const chart = DEFAULT_HORIZONTAL.placements.find(p => p.id === 'chart')!
  assert.equal(chart.y * m.pitch + chart.h * m.pitch - m.gutter + 15, 940 - 15)
  assert.equal(horizontalExtent(DEFAULT_HORIZONTAL.placements, m), m.width)
  const far = DEFAULT_HORIZONTAL.placements.map(p => p.id === 'chart' ? { ...p, x: 100 } : p)
  assert.equal(horizontalExtent(far, m), 103 * m.pitch - m.gutter)
  assert.equal(horizontalExtent(DEFAULT_HORIZONTAL.placements, m), m.width)
  for (const h of [0, 1, 29, 31, 119, 120, 720, 1080, 1e100, Infinity, NaN]) {
    const extreme = horizontalMetrics(1000, h)
    assert.ok(Object.values(extreme).every(v => Number.isFinite(v) && v >= 0))
    assert.ok(horizontalExtent(far, extreme, 1e100) <= HORIZONTAL.maxPixels)
  }
})
test('horizontal codec is independent of unchanged v2 and rejects hostile/unsupported/oversized input', () => {
  const encoded = serializeHorizontal(DEFAULT_HORIZONTAL)
  assert.deepEqual(parseHorizontal(encoded), DEFAULT_HORIZONTAL)
  assert.throws(() => parseGrid(encoded)); assert.throws(() => parseHorizontal(JSON.stringify(DEFAULT_GRID)))
  const raw = JSON.parse(encoded) as Record<string, unknown>
  for (const patch of [{ schemaVersion: 2 }, { engine: 'other' }, { rows: 11 }, { placements: [] }]) assert.throws(() => parseHorizontal(JSON.stringify({ ...raw, ...patch })))
  for (const patch of [{ x: 4096 }, { x: -1 }, { x: .5 }, { x: 1e99 }, { w: 25 }, { y: 9 }, { id: 'unknown' }, { preferred: { w: 5000, h: 2 } }]) {
    const ps = structuredClone(DEFAULT_HORIZONTAL.placements); Object.assign(ps[0]!, patch)
    assert.throws(() => parseHorizontal(JSON.stringify({ ...raw, placements: ps })))
  }
  const duplicate = structuredClone(DEFAULT_HORIZONTAL.placements); duplicate[1]!.id = duplicate[0]!.id
  assert.throws(() => parseHorizontal(JSON.stringify({ ...raw, placements: duplicate })))
  const overlapping = structuredClone(DEFAULT_HORIZONTAL.placements); overlapping[1]!.x = 0
  assert.throws(() => parseHorizontal(JSON.stringify({ ...raw, placements: overlapping })))
  assert.throws(() => parseHorizontal(' '.repeat(65537)))
  assert.throws(() => parseHorizontal(JSON.stringify({ ...raw, extra: '界'.repeat(24000) })))
})
test('read-only initialization, corruption recovery, quota and concurrent-write safety preserve both old keys', () => {
  const old = new Map([['geppio:layout:v1', '{owner legacy bytes'], [GRID_KEY, JSON.stringify(DEFAULT_GRID)]])
  const data = new Map(old), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  const read = readHorizontal(storage); assert.equal(read.recovery, false); assert.deepEqual(data, old)
  const saved = writeHorizontal(storage, read.snapshot, read.raw); assert.equal(saved.error, null)
  assert.deepEqual(new Map([...data].filter(([k]) => k !== HORIZONTAL_KEY)), old)
  const concurrent = serializeHorizontal({ ...DEFAULT_HORIZONTAL, placements: DEFAULT_HORIZONTAL.placements.map(p => p.id === 'chart' ? { ...p, x: 30 } : p) })
  data.set(HORIZONTAL_KEY, concurrent)
  assert.ok(writeHorizontal(storage, read.snapshot, saved.raw).error); assert.equal(data.get(HORIZONTAL_KEY), concurrent)
  for (const raw of ['{broken', '{"schemaVersion":999}', ' '.repeat(65537)]) {
    data.set(HORIZONTAL_KEY, raw); assert.equal(readHorizontal(storage).recovery, true); assert.equal(data.get(HORIZONTAL_KEY), raw)
  }
  assert.equal(readHorizontal({ getItem() { throw new Error('read') }, setItem() {} }).recovery, true)
  assert.ok(writeHorizontal({ getItem: () => saved.raw, setItem() { throw new Error('quota') } }, read.snapshot, saved.raw).error)
})
test('beyond column 24, same solver collision/compression, reversal and all eight resizes remain bounded', () => {
  const ps = structuredClone(DEFAULT_HORIZONTAL.placements)
  ps.forEach(p => { p.x += 80 })
  const cs = horizontalConstraints(), original = structuredClone(ps)
  for (const p of ps) for (const kind of ['move', ...DIRECTIONS] as const) for (const d of [-2, -1, 1, 2]) {
    const rect = horizontalCandidate(p, d, d, kind), result = horizontalReflow(ps, p.id, rect, kind)
    assert.ok(result.states <= 16384); assert.ok(validHorizontalLayout(result.placements, HORIZONTAL_BOUNDS, cs))
    assert.deepEqual(horizontalReflow(ps, p.id, rect, kind), result)
    assert.deepEqual(horizontalReflow(ps, p.id, p, kind).placements, original)
  }
  const moved = horizontalReflow(ps, 'summary', { ...ps[0]!, x: 81 }, 'move')
  assert.equal(moved.status, 'valid'); assert.equal(moved.placements[1]!.x, 84)
  const stack = structuredClone(DEFAULT_HORIZONTAL.placements)
  stack[0] = { ...stack[0]!, x: 100, y: 0, w: 3, h: 4, preferred: { w: 3, h: 4 } }
  stack[3] = { ...stack[3]!, x: 100, y: 4, h: 6, preferred: { w: 3, h: 6 } }
  const compressed = horizontalReflow(stack, 'summary', { ...stack[0]!, h: 5 }, 's')
  assert.equal(compressed.status, 'valid'); assert.equal(compressed.placements[3]!.y, 5); assert.equal(compressed.placements[3]!.h, 5)
  assert.deepEqual(ps, original)
  assert.equal(horizontalReflow(ps, 'summary', { ...ps[0]!, x: 1e100 }, 'move').reason, 'invalid')
})
