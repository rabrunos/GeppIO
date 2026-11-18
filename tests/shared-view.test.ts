import assert from 'node:assert/strict'
import test from 'node:test'
import { GIT_TYPE } from '../src/shared/git-widget.ts'
import { floatingBounds, GIT_SHARED_VIEW, openFloatingPresentation, resolveSharedView } from '../src/renderer/src/shared-views/definition.ts'
import { selectSuite } from '../tools/isolation/plan.ts'

test('Git is a host View with separate widget identity and two supported presentations', () => {
  assert.equal(GIT_SHARED_VIEW.widgetTypeId, GIT_TYPE)
  assert.notEqual(GIT_SHARED_VIEW.id, GIT_TYPE)
  assert.deepEqual(GIT_SHARED_VIEW.presentations, ['widget', 'floating-window'])
  for (const kind of GIT_SHARED_VIEW.presentations) assert.equal(resolveSharedView('git-changes', kind), GIT_SHARED_VIEW)
  for (const id of [GIT_TYPE, 'constructor', 'wrong-view', null]) assert.equal(resolveSharedView(id, 'floating-window'), null)
  for (const kind of ['native-window', 'sidebar', 'Floating-window', {}]) assert.equal(resolveSharedView('git-changes', kind), null)
})

test('direct opening admits one floating instance and preserves the current instance on repeat or invalid requests', () => {
  const open = (current: ReturnType<typeof openFloatingPresentation>) => openFloatingPresentation(current, GIT_SHARED_VIEW.id, 'floating-window')
  assert.equal(openFloatingPresentation(null, GIT_SHARED_VIEW.id, 'widget'), null)
  assert.equal(openFloatingPresentation(null, 'other-view', 'floating-window'), null)
  const opened = open(null)
  assert.deepEqual(opened, { viewId: GIT_SHARED_VIEW.id, kind: 'floating-window' })
  assert.equal(open(opened), opened)
  assert.equal(openFloatingPresentation(opened, 'other-view', 'floating-window'), opened)
  assert.notEqual(open(null), opened, 'Reopening after clearing the slot mounts a fresh presentation')
})

test('floating geometry clamps both axes in CSS pixels and shrinks to the usable area', () => {
  const size = GIT_SHARED_VIEW.floatingSize
  assert.deepEqual(floatingBounds({ width: 1000, height: 720 }, size, null), { x: 508, y: 24, ...size })
  const start = { x: 460.25, y: 210.75 }
  assert.deepEqual(floatingBounds({ width: 1000, height: 720 }, size, start), { ...start, ...size })
  assert.deepEqual(floatingBounds({ width: 900.5, height: 590.25 }, size, { x: 4000, y: 3000 }), { x: 428.5, y: 188.25, ...size })
  assert.deepEqual(floatingBounds({ width: 340, height: 150 }, size, start), { x: 12, y: 12, width: 316, height: 126 })
  assert.deepEqual(floatingBounds({ width: 640, height: 480 }, size, { x: -200, y: -100 }), { x: 12, y: 12, ...size })
  assert.deepEqual(floatingBounds({ width: 0, height: 0 }, size, null), { x: 0, y: 0, width: 0, height: 0 })
})

test('isolated window journey is admitted only for the two built-app scales', () => {
  assert.deepEqual(selectSuite('git-window').step, { file: 'tools/git-window-smoke.ts', args: [] })
  assert.deepEqual(selectSuite('git-window', '--scale125').step, { file: 'tools/git-window-smoke.ts', args: ['--scale125'] })
  assert.throws(() => selectSuite('git-window', '--dev'), /UNSUPPORTED_VARIANT/)
})
