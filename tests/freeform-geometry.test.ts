import test from 'node:test'
import assert from 'node:assert/strict'
import { candidate, collides, validLayout } from '../src/shared/freeform/geometry.ts'
import { CONSTRAINTS, constraintsFor, DEFAULT_FREEFORM, POLICY } from '../src/shared/freeform/policy.ts'
import { reflow } from '../src/shared/freeform/reflow.ts'
import { transfer } from '../src/shared/freeform/transfer.ts'
import { DIRECTIONS } from '../src/shared/freeform/types.ts'
import type { Constraints, Placement, Surface } from '../src/shared/freeform/types.ts'

const main: Surface = { region: 'main', width: 1000, height: 700, expanded: false }
const p = (id: string, x: number, y: number, width = 200, height = 200): Placement => ({ id, region: 'main', x, y, width, height, preferred: { width, height } })
function constraints(ps: Placement[], fixed = false): Constraints {
  return Object.fromEntries(ps.map(p => [p.id, { ...CONSTRAINTS[p.id]!, min: { width: fixed ? p.width : 100, height: fixed ? p.height : 100 }, resizeX: !fixed, resizeY: !fixed }]))
}
test('CSS pixels remain continuous; eight anchored directions, minima/maxima and region axes', () => {
  const original = p('summary', 137.25, 83.125, 327.75, 246.5)
  const cs = constraints([original])
  assert.deepEqual(candidate(original, .125, .375, 'move', main, cs.summary!), { ...original, x: 137.375, y: 83.5 })
  for (const direction of DIRECTIONS) {
    const next = candidate(original, 13.25, -9.125, direction, main, cs.summary!)
    if (direction.includes('w')) assert.equal(next.x + next.width, original.x + original.width)
    else assert.equal(next.x, original.x)
    if (direction.includes('n')) assert.equal(next.y + next.height, original.y + original.height)
    else assert.equal(next.y, original.y)
    assert.equal(reflow([original], original.id, next, main, cs, direction).status, 'valid')
  }
  const sidebar: Surface = { region: 'sidebar', width: 185, height: 700, expanded: true }
  const side = { ...original, region: 'sidebar' as const, x: 0, width: 185 }
  assert.equal(candidate(side, 999, .25, 'move', sidebar, constraintsFor(sidebar).summary!).x, 0)
  assert.equal(candidate(side, 999, .25, 'e', sidebar, constraintsFor(sidebar).summary!).width, 185)
  const bottom: Surface = { region: 'bottom', width: 1000, height: 120, expanded: false }
  const low = { ...original, region: 'bottom' as const, y: 0, height: 120 }
  assert.equal(candidate(low, .25, 999, 'move', bottom, constraintsFor(bottom).summary!).y, 0)
  assert.equal(candidate(low, .25, 999, 's', bottom, constraintsFor(bottom).summary!).height, 120)
})
test('forward push chains, clearance, no gravity, deterministic snapshot reversal and immutability', () => {
  const ps = [p('summary', 0, 40), p('chart', 210, 40), p('notes', 420, 40), p('activity', 50, 400)], cs = constraints(ps), old = structuredClone(ps)
  const rect = { ...ps[0]!, x: 13.375 }, result = reflow(ps, 'summary', rect, main, cs, 'move')
  assert.equal(result.status, 'valid'); assert.ok(validLayout(result.placements, main, cs))
  assert.equal(result.placements[1]!.x, 223.375); assert.equal(result.placements[2]!.x, 433.375)
  assert.deepEqual(result.placements[3], ps[3]); assert.deepEqual(ps, old)
  assert.deepEqual(reflow(ps, 'summary', rect, main, cs, 'move'), result)
  assert.deepEqual(reflow(ps, 'summary', ps[0]!, main, cs, 'move').placements, old)
})
test('boundary compression holds the far edge and restores preference when space returns', () => {
  const ps = [p('summary', 0, 0, 200, 300), p('chart', 0, 310, 200, 300)], cs = constraints(ps)
  const surface = { ...main, height: 610 }
  const next = reflow(ps, 'summary', { ...ps[0]!, height: 390.25 }, surface, cs, 's')
  assert.equal(next.status, 'valid')
  const neighbor = next.placements[1]!
  assert.equal(neighbor.y, 400.25); assert.equal(neighbor.height, 209.75)
  assert.equal(neighbor.y + neighbor.height, 610); assert.equal(neighbor.width, 200)
  assert.deepEqual(neighbor.preferred, ps[1]!.preferred)
  const restored = reflow(next.placements, 'summary', { ...next.placements[0]!, height: 300 }, surface, cs, 's')
  assert.equal(restored.status, 'valid'); assert.equal(restored.placements[1]!.height, 300)
  assert.equal(restored.placements[1]!.y, 310)
  // Tall neighbor has nearby lateral space: recovery must not immediately undo the
  // active gesture's newly required same-axis compression by escaping sideways.
  const tall = [p('summary', 0, 0, 220, 200), p('chart', 0, 210, 220, 490)]
  const lateral = reflow(tall, 'summary', { ...tall[0]!, height: 237.375 }, main, constraints(tall), 's')
  assert.equal(lateral.status, 'valid'); assert.equal(lateral.placements[1]!.x, 0)
  assert.equal(lateral.placements[1]!.y, 247.375); assert.equal(lateral.placements[1]!.height, 452.625)
})
test('bounded rearrangement moves only required neighbors; impossible attempts preserve last valid data', () => {
  const ps = [p('summary', 0, 0), p('chart', 210, 0), p('notes', 420, 0), p('activity', 105, 210), p('library', 420, 210)]
  const cs = constraints(ps, true), surface = { ...main, width: 620, height: 410 }
  const result = reflow(ps, 'summary', { ...ps[0]!, x: 105 }, surface, cs, 'move')
  assert.equal(result.status, 'valid'); assert.ok(validLayout(result.placements, surface, cs))
  assert.deepEqual(result.placements[2], ps[2]); assert.deepEqual(result.placements[4], ps[4])
  assert.equal(result.placements[1]!.y, 210); assert.equal(result.placements[3]!.x, 0)
  const dense = [p('summary', 0, 0), p('chart', 210, 0), p('notes', 0, 210), p('activity', 210, 210)]
  const blocked = reflow(dense, 'summary', { ...dense[0]!, x: 13.125 }, { ...main, width: 410, height: 410 }, constraints(dense, true), 'move')
  assert.equal(blocked.status, 'blocked'); assert.deepEqual(blocked.placements, dense)
})
test('representative composition sweeps keep active intention, constraints, budgets and identities', () => {
  const source = DEFAULT_FREEFORM.placements, s = { ...main, ...DEFAULT_FREEFORM.reference.main }, cs = constraintsFor(s)
  for (const widget of source) for (const delta of [-31.125, .25, 21.375]) for (const kind of ['move' as const, ...DIRECTIONS]) {
    const requested = candidate(widget, delta, delta, kind, s, cs[widget.id]!)
    const result = reflow(source, widget.id, requested, s, cs, kind)
    assert.ok(result.states <= 2048); assert.ok(result.probes <= 8192); assert.ok(validLayout(result.placements, s, cs))
    if (result.status === 'valid') {
      const active = result.placements.find(p => p.id === widget.id)!
      for (const key of ['x', 'y', 'width', 'height'] as const) assert.equal(active[key], requested[key])
    } else assert.deepEqual(result.placements, source)
    assert.deepEqual(reflow(source, widget.id, requested, s, cs, kind), result)
  }
})

test('compressed narrow and wide widgets reach independently verified adjacent free space', () => {
  const surface = { ...main, width: 1000, height: 500 }, cs = constraintsFor(surface)
  for (const width of [164, 320]) {
    const upper = p('queue', 0, 0, 600, 200), lower = { ...p('summary', 0, 210, width, 112), preferred: { width, height: 220 } }
    const request = { ...upper, height: 400 }, witness = [request, { ...lower, x: 610 }]
    assert.ok(validLayout(witness, surface, cs), 'Feasibility checked without the search algorithm')
    const result = reflow([upper, lower], upper.id, request, surface, cs, 's')
    assert.equal(result.status, 'valid'); assert.ok(validLayout(result.placements, surface, cs))
    const relocated = result.placements[1]!
    assert.equal(relocated.x, 610); assert.equal(relocated.y, 210); assert.equal(relocated.height, 220)
    assert.deepEqual(relocated.preferred, lower.preferred)
  }
})

test('bounded pruning preserves previously successful dense rearrangements', () => {
  const s = { ...main, ...DEFAULT_FREEFORM.reference.main }, cs = constraintsFor(s)
  for (const [id, kind, delta] of [['queue', 'move', 300], ['notes', 'move', 50], ['notes', 'move', 100], ['chart', 'e', 300]] as const) {
    const active = DEFAULT_FREEFORM.placements.find(p => p.id === id)!
    const result = reflow(DEFAULT_FREEFORM.placements, id, candidate(active, delta, delta, kind, s, cs[id]!), s, cs, kind)
    assert.equal(result.status, 'valid', `${id} ${kind} ${delta}`); assert.ok(validLayout(result.placements, s, cs))
    assert.ok(result.probes <= 8192)
  }
})

test('an adjacent destination beyond the finite local radius cannot teleport a neighbor', () => {
  const surface = { ...main, width: 5000, height: 500 }, cs = constraintsFor(surface)
  const upper = p('queue', 0, 0, 2000, 200), lower = p('summary', 0, 210, 164, 112), request = { ...upper, height: 400 }
  assert.ok(validLayout([request, { ...lower, x: 2010 }], surface, cs), 'Globally feasible but intentionally outside local interaction scope')
  const result = reflow([upper, lower], upper.id, request, surface, cs, 's')
  assert.equal(result.status, 'blocked'); assert.deepEqual(result.placements, [upper, lower])
})
test('eligible transfers are atomic; Sidebar follows width, Bottom height, small Bottom rejects', () => {
  const old = structuredClone(DEFAULT_FREEFORM)
  const side = transfer(old, 'properties', { region: 'sidebar', width: 260, height: 300, expanded: true })!
  assert.ok(side); assert.equal(side.placements.find(p => p.id === 'properties')!.width, 260)
  assert.equal(transfer(old, 'queue', { region: 'sidebar', width: 260, height: 300, expanded: false }), null)
  assert.equal(transfer(old, 'summary', { region: 'bottom', width: 900, height: 13, expanded: false }), null)
  const bottom = transfer(old, 'summary', { region: 'bottom', width: 900, height: 120, expanded: false })!
  assert.equal(bottom.placements.find(p => p.id === 'summary')!.height, 120)
  const expanded = { ...main, expanded: true }
  const p0 = p('summary', 137, 83)
  assert.equal(candidate(p0, 100_000, 0, 'move', expanded, CONSTRAINTS.summary!).x + p0.width, POLICY.maxCoordinate)
  assert.equal(collides(p('summary', 0, 0), p('chart', 210, 0)), false)
  assert.deepEqual(DEFAULT_FREEFORM, old)
})
