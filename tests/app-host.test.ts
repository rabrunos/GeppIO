import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_EXPERIENCE, EXPERIENCES, experienceTransition, officialApp } from '../src/renderer/src/apps/registry.ts'
import { selectSuite } from '../tools/isolation/plan.ts'

test('Workbench is the default experience independently of the official App registry', () => {
  assert.equal(DEFAULT_EXPERIENCE, 'workbench')
  assert.equal(officialApp(DEFAULT_EXPERIENCE), undefined)
  assert.deepEqual(EXPERIENCES.map(({ id }) => id), ['workbench', 'geppio-code'])
  assert.deepEqual(officialApp('geppio-code'), {
    id: 'geppio-code', name: 'GeppIO Code', presentation: 'code', capabilities: ['documents', 'explorer', 'git', 'terminal', 'search']
  })
})

test('experience selection is closed to unknown identities and reads the live transition guard', () => {
  const current = 'workbench'
  for (const bad of ['editor', 'constructor', 'GEPPIO-CODE', { id: 'geppio-code' }, null]) {
    assert.equal(officialApp(bad), undefined)
    assert.deepEqual(experienceTransition(current, bad, () => assert.fail('unsupported ID reached the guard')), { status: 'unsupported' })
  }
  let busy = true
  const blocked = () => busy
  assert.deepEqual(experienceTransition(current, 'geppio-code', blocked), { status: 'blocked' })
  assert.deepEqual(experienceTransition(current, current, blocked), { status: 'blocked' })
  busy = false
  assert.deepEqual(experienceTransition(current, 'geppio-code', blocked), { status: 'changed', next: 'geppio-code' })
  assert.deepEqual(experienceTransition('geppio-code', current, blocked), { status: 'changed', next: current })
  assert.deepEqual(experienceTransition('geppio-code', 'geppio-code', blocked), { status: 'unchanged' })
})

test('App Host smoke is available at both production scales through the closed isolation catalog', () => {
  assert.deepEqual(selectSuite('app-host').step, { file: 'tools/app-host-smoke.ts', args: [] })
  assert.deepEqual(selectSuite('app-host', '--scale125').step, { file: 'tools/app-host-smoke.ts', args: ['--scale125'] })
  assert.throws(() => selectSuite('app-host', '--dev'), /UNSUPPORTED_VARIANT/)
})
