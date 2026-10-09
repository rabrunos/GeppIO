import assert from 'node:assert/strict'
import type { GridMetrics } from '../../src/shared/grid/geometry.ts'
import type { GridSnapshot } from '../../src/shared/grid/types.ts'

export interface ProjectionSample { width: number; height: number; snapshot: GridSnapshot; metrics: GridMetrics }
export function rectangles(sample: ProjectionSample) {
  const m = sample.metrics
  return sample.snapshot.placements.map(p => ({ id: p.id, x: m.left + p.x * m.pitch, y: m.top + p.y * m.pitch,
    width: p.w * m.pitch - m.gutter, height: p.h * m.pitch - m.gutter }))
}
/** Independent source-order oracle: no call to the projector or its fitting helpers. */
export function spatialViolations(source: GridSnapshot, target: GridSnapshot): string[] {
  const errors: string[] = [], byId = new Map(target.placements.map(p => [p.id, p]))
  for (const a of source.placements) {
    const q = byId.get(a.id)
    if (!q) { errors.push(`missing ${a.id}`); continue }
    if (a.x === 0 && q.x !== 0) errors.push(`${a.id}: left edge lost`)
    if (a.y === 0 && q.y !== 0) errors.push(`${a.id}: top edge lost`)
    if (a.x + a.w === source.columns && q.x + q.w !== target.columns) errors.push(`${a.id}: right edge lost`)
    if (a.y + a.h === source.rows && q.y + q.h !== target.rows) errors.push(`${a.id}: bottom edge lost`)
    for (const b of source.placements) {
      const r = byId.get(b.id); if (a.id === b.id || !r) continue
      if (a.x + a.w <= b.x && q.x + q.w > r.x) errors.push(`${a.id} left of ${b.id} reversed`)
      if (a.y + a.h <= b.y && q.y + q.h > r.y) errors.push(`${a.id} above ${b.id} reversed`)
      if (a.x + a.w < b.x && q.x + q.w === r.x) errors.push(`${a.id}/${b.id}: horizontal gap lost`)
      if (a.y + a.h < b.y && q.y + q.h === r.y) errors.push(`${a.id}/${b.id}: vertical gap lost`)
    }
  }
  return errors
}
export function assertSafe(source: GridSnapshot, sample: ProjectionSample) {
  const { snapshot: s, metrics: m, width, height } = sample
  assert.equal(s.placements.length, source.placements.length)
  assert.deepEqual(s.placements.map(p => p.id).sort(), source.placements.map(p => p.id).sort())
  assert.deepEqual(s.placements.map(p => p.preferred), source.placements.map(p => p.preferred))
  for (const p of s.placements) {
    assert.ok([p.x, p.y, p.w, p.h].every(Number.isInteger) && p.w >= 3 && p.h >= 2 && p.x >= 0 && p.y >= 0)
    assert.ok(p.x + p.w <= s.columns && p.y + p.h <= s.rows)
  }
  for (const [i, p] of rectangles(sample).entries()) {
    assert.ok([p.x, p.y, p.width, p.height].every(Number.isFinite))
    assert.ok(p.x >= -1e-8 && p.y >= -1e-8 && p.x + p.width <= width + 1e-8 && p.y + p.height <= height + 1e-8)
    for (const q of rectangles(sample).slice(i + 1)) assert.ok(Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x) <= 1e-8
      || Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y) <= 1e-8)
  }
  assert.ok(Math.abs(m.left * 2 + m.width - width) < 1e-8 && Math.abs(m.top * 2 + m.height - height) < 1e-8)
  assert.deepEqual(spatialViolations(source, s), [])
}
export function changes(a: ProjectionSample, b: ProjectionSample) {
  const before = rectangles(a), after = rectangles(b), pitch = Math.max(a.metrics.pitch, b.metrics.pitch)
  let edge = 0, area = 0, relativeArea = 0, normalizedEdge = 0
  for (const p of before) {
    const q = after.find(r => r.id === p.id)!
    const edgesA = [p.x, p.x + p.width, p.y, p.y + p.height], edgesB = [q.x, q.x + q.width, q.y, q.y + q.height]
    edge = Math.max(edge, ...edgesA.map((v, i) => Math.abs(v - edgesB[i]!)))
    normalizedEdge = Math.max(normalizedEdge, ...edgesA.map((v, i) => Math.abs(v / (i < 2 ? a.width : a.height) - edgesB[i]! / (i < 2 ? b.width : b.height))))
    const delta = Math.abs(q.width * q.height - p.width * p.height)
    area = Math.max(area, delta)
    relativeArea = Math.max(relativeArea, delta / Math.max(1, p.width * p.height))
  }
  return { edge, area, relativeArea, normalizedEdge, pitchChange: Math.abs(b.metrics.pitch / a.metrics.pitch - 1), pitch }
}
/** A single coherent edge quantization may move an edge by half a pitch; reserve 3/4 plus viewport motion.
 * Area permits at most one cell on each dimension, not an arbitrary percentage. Density itself must be continuous. */
export function assertContinuous(a: ProjectionSample, b: ProjectionSample) {
  const c = changes(a, b), delta = Math.max(Math.abs(a.width - b.width), Math.abs(a.height - b.height))
  assert.ok(c.pitchChange <= .005 * delta + 1e-8, `density jump ${c.pitchChange}`)
  assert.ok(c.edge <= .75 * c.pitch + 2 * delta, `edge jump ${c.edge} at pitch ${c.pitch}`)
  assert.ok(c.normalizedEdge <= .08 + 2 * delta / Math.min(a.width, a.height), `normalized edge jump ${c.normalizedEdge}`)
  for (const p of rectangles(a)) {
    const q = rectangles(b).find(r => r.id === p.id)!
    const budget = c.pitch * (p.width + p.height) + c.pitch ** 2 + 4 * delta * (p.width + p.height)
    assert.ok(Math.abs(q.width * q.height - p.width * p.height) <= budget, `area jump ${p.id}`)
  }
}

/** A local peak may contain one integer-cell change; a multi-cell grow/shrink pulse is not quantization. */
export function assertNoSpike(a: ProjectionSample, b: ProjectionSample, c: ProjectionSample) {
  const pitch = Math.max(a.metrics.pitch, b.metrics.pitch, c.metrics.pitch)
  for (const p of rectangles(a)) {
    const q = rectangles(b).find(r => r.id === p.id)!, r = rectangles(c).find(r => r.id === p.id)!
    const areas = [p.width * p.height, q.width * q.height, r.width * r.height]
    const excursion = Math.max(0, areas[1]! - Math.max(areas[0]!, areas[2]!), Math.min(areas[0]!, areas[2]!) - areas[1]!)
    const oneCell = pitch * Math.max(p.width, p.height, r.width, r.height) + pitch ** 2
    assert.ok(excursion <= oneCell, `expand/contract spike ${p.id}: ${excursion} > ${oneCell}`)
  }
}
