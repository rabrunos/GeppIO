import test from 'node:test'
import assert from 'node:assert/strict'
import { REGION_POLICY, regionBounds, regionSize } from '../src/renderer/src/workbench/region-policy.ts'

test('trial region caps use live CSS extents, absolute caps and existing Main reserve', () => {
  assert.equal(REGION_POLICY.sidebar.initial, 215); assert.equal(REGION_POLICY.bottom.initial, 43)
  for (const [width, height] of [[1000, 610], [1280, 630], [1480, 870], [2000, 1400]]) {
    assert.deepEqual(regionBounds('sidebar', width!), { min: 160, max: Math.min(300, width! * .2, width! - 165) })
    assert.deepEqual(regionBounds('bottom', height!), { min: 43, max: Math.min(180, height! * .25, height! - 165) })
  }
  assert.deepEqual(regionBounds('sidebar', 600), { min: 120, max: 120 })
  assert.deepEqual(regionBounds('bottom', 200), { min: 35, max: 35 })
  assert.deepEqual(regionBounds('sidebar', 170), { min: 5, max: 5 })
})

test('tiny, fractional and invalid measurements never invert bounds or produce nonfinite sizes', () => {
  for (const kind of ['sidebar', 'bottom'] as const) for (const extent of [0, 1, 164, 165, 165.25, 700.125, -1, NaN, Infinity, -Infinity]) {
    const bounds = regionBounds(kind, extent)
    assert.ok(Number.isFinite(bounds.min) && Number.isFinite(bounds.max) && bounds.min >= 0 && bounds.min <= bounds.max)
    for (const request of [-100, 0, 43, 215, 10000, NaN, Infinity]) {
      const effective = regionSize(request, bounds)
      assert.ok(Number.isFinite(effective) && effective >= bounds.min && effective <= bounds.max)
    }
  }
})

test('clamping is presentation-only and repeated viewport A to B to A retains session requests', () => {
  const requested = Object.freeze({ sidebar: 290, bottom: 170 })
  for (let i = 0; i < 20; i++) {
    assert.equal(regionSize(requested.sidebar, regionBounds('sidebar', 1800)), 290)
    assert.equal(regionSize(requested.bottom, regionBounds('bottom', 1000)), 170)
    assert.equal(regionSize(requested.sidebar, regionBounds('sidebar', 600)), 120)
    assert.equal(regionSize(requested.bottom, regionBounds('bottom', 200)), 35)
    assert.equal(regionSize(requested.sidebar, regionBounds('sidebar', 1800)), 290)
    assert.equal(regionSize(requested.bottom, regionBounds('bottom', 1000)), 170)
  }
  assert.deepEqual(requested, { sidebar: 290, bottom: 170 })
})
