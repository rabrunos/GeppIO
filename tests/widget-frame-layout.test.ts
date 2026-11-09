import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectFrame } from '../src/renderer/src/freeform/frame-layout.ts'
import type { Measurement } from '../src/renderer/src/freeform/useSurfaces.ts'
import type { Placement } from '../src/shared/freeform/types.ts'

test('content widgets and anchored compact widgets share the same measured Main origin through fractional Sidebar frames', () => {
  for (const left of [331, 300.125, 210.25, 100.75, 48]) {
    const ownerWidth = 2000 - left - 22, ownerTop = 105
    const m: Measurement = { left: left + 11 + 41, top: ownerTop + 41, width: ownerWidth - 82, height: 500,
      ownerLeft: left + 11, ownerTop, ownerWidth, ownerHeight: 582, frameWidth: ownerWidth - 82, frameHeight: 500, scrollLeft: 12.25, scrollTop: 0 }
    const widget: Placement = { id: 'summary', region: 'main', x: 12.25, y: 0, width: 240, height: 220, preferred: { width: 240, height: 220 } }
    const normal = projectFrame(widget, m), docked = projectFrame({ ...widget, x: 0, y: 41, width: 31, height: 500 }, m, 'viewport')
    const floating = projectFrame({ ...widget, x: 0, y: 0, width: ownerWidth, height: 31 }, m, 'viewport')
    assert.equal(normal.left, m.left); assert.equal(normal.top, m.top)
    assert.equal(docked.left, m.ownerLeft); assert.equal(docked.top, m.top)
    assert.equal(floating.left, m.ownerLeft); assert.equal(floating.top, m.ownerTop)
    for (const result of [normal, docked, floating]) { assert.equal(result.outside, false); assert.equal(result.clipPath, 'inset(0px 0px 0px 0px round var(--card-radius))') }
  }
})

test('one shared clip/hit boundary rejects outside frames and preserves fractional clipping for every coordinate constraint', () => {
  const m: Measurement = { left: 20, top: 30, width: 300, height: 200, frameWidth: 300, frameHeight: 200, scrollLeft: 0, scrollTop: 0 }
  const p: Placement = { id: 'properties', region: 'main', x: -4.25, y: -7.5, width: 240, height: 220, preferred: { width: 240, height: 220 } }
  assert.deepEqual(projectFrame(p, m), projectFrame(p, m, 'viewport'))
  assert.equal(projectFrame(p, m).clipPath, 'inset(7.5px 0px 12.5px 4.25px round var(--card-radius))')
  assert.equal(projectFrame({ ...p, x: 300 }, m).outside, true)
})

test('a collapsed Sidebar clip preserves the existing frame reveal/leave lifecycle while rejecting input', () => {
  const m: Measurement = { left: 70, top: 105, width: 253, height: 774, clipWidth: 0, frameWidth: 283, frameHeight: 774, scrollLeft: 0, scrollTop: 0 }
  const p: Placement = { id: 'notes', region: 'sidebar', x: 0, y: 0, width: 253, height: 300, preferred: { width: 253, height: 300 } }
  const result = projectFrame(p, m)
  assert.equal(result.available, true); assert.equal(result.outside, true)
  assert.match(result.clipPath, /253px/)
})
