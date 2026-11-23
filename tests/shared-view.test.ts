import assert from 'node:assert/strict'
import test from 'node:test'
import { GIT_TYPE } from '../src/shared/git-widget.ts'
import { closeFloatingPresentation, floatingBounds, GIT_SHARED_VIEW, openFloatingPresentation, raiseFloatingPresentation, resolveSharedView, SEARCH_SHARED_VIEW, SHARED_VIEWS, TOOLS_SHARED_VIEW } from '../src/renderer/src/shared-views/definition.ts'
import { selectSuite } from '../tools/isolation/plan.ts'

test('Git is a host View with separate widget identity and two supported presentations', () => {
  assert.equal(GIT_SHARED_VIEW.widgetTypeId, GIT_TYPE)
  assert.notEqual(GIT_SHARED_VIEW.id, GIT_TYPE)
  assert.deepEqual(GIT_SHARED_VIEW.presentations, ['widget', 'floating-window'])
  for (const kind of GIT_SHARED_VIEW.presentations) assert.equal(resolveSharedView('git-changes', kind), GIT_SHARED_VIEW)
  for (const id of [GIT_TYPE, 'constructor', 'wrong-view', null]) assert.equal(resolveSharedView(id, 'floating-window'), null)
  for (const kind of ['native-window', 'sidebar', 'Floating-window', {}]) assert.equal(resolveSharedView('git-changes', kind), null)
})

test('Search shares its Code activity and floating window without creating a widget definition', () => {
  assert.deepEqual(SHARED_VIEWS.map(view => view.id), ['git-changes', 'project-search', 'workspace-tools'])
  assert.deepEqual(SEARCH_SHARED_VIEW.presentations, ['code-activity', 'floating-window'])
  for (const kind of SEARCH_SHARED_VIEW.presentations) assert.equal(resolveSharedView('project-search', kind), SEARCH_SHARED_VIEW)
  for (const kind of ['widget', 'native-window', 'constructor', null]) assert.equal(resolveSharedView('project-search', kind), null)
})

test('the report View is a single third internal window and retains both preceding instances', () => {
  const id = TOOLS_SHARED_VIEW.id
  assert.deepEqual(TOOLS_SHARED_VIEW.presentations, ['floating-window'])
  for (const kind of ['widget', 'native-window', 'code-activity']) assert.equal(resolveSharedView(id, kind), null)
  const three = SHARED_VIEWS.reduce<ReturnType<typeof openFloatingPresentation>>((stack, view) => openFloatingPresentation(stack, view.id, 'floating-window'), [])
  assert.deepEqual(three.map(view => view.viewId), ['git-changes', 'project-search', 'workspace-tools'])
  const raised = raiseFloatingPresentation(three, 'git-changes')
  const again = openFloatingPresentation(raised, id, 'floating-window')
  assert.equal(again.length, 3); assert.equal(again[0], three[1]); assert.equal(again[1], three[0]); assert.equal(again[2], three[2])
  assert.deepEqual(closeFloatingPresentation(again, id), [three[1], three[0]])
})

test('two windows coexist; repeat open raises the existing instance, and close retains the other one', () => {
  const git = GIT_SHARED_VIEW.id, search = SEARCH_SHARED_VIEW.id
  const empty = [] as const
  assert.equal(openFloatingPresentation(empty, git, 'widget'), empty)
  assert.equal(openFloatingPresentation(empty, 'other-view', 'floating-window'), empty)
  assert.equal(raiseFloatingPresentation(empty, search), empty)
  const first = openFloatingPresentation(empty, git, 'floating-window')
  assert.deepEqual(first, [{ viewId: git, kind: 'floating-window' }])
  assert.equal(openFloatingPresentation(first, git, 'floating-window'), first)
  const both = openFloatingPresentation(first, search, 'floating-window')
  assert.deepEqual(both.map(view => view.viewId), [git, search])
  const raised = openFloatingPresentation(both, git, 'floating-window')
  assert.equal(raised[0], both[1])
  assert.equal(raised[1], first[0])
  assert.equal(openFloatingPresentation(raised, 'other-view', 'floating-window'), raised)
  const remaining = closeFloatingPresentation(raised, search)
  assert.deepEqual(remaining, first)
  assert.equal(remaining[0], first[0])
  const reopened = openFloatingPresentation(remaining, search, 'floating-window')
  assert.equal(reopened[0], first[0])
  assert.notEqual(reopened[1], both[1], 'Opening after Close mounts a fresh presentation')
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
