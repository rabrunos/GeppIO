import test from 'node:test'
import assert from 'node:assert/strict'
import { repositoryName, repositoryFromOrigin, labelActions } from '../tools/github-plan.ts'
test('repository selector rejects injected commands and ambiguous URLs', () => {
  assert.equal(repositoryName('owner/semnome'), 'owner/semnome')
  for (const value of ['', 'owner/semnome;rm', '--repo', 'https://github.com/o/r', 'a/b/c', 'a/..']) assert.throws(() => repositoryName(value))
})
test('both normal GitHub origin forms resolve without modifying Git', () => {
  assert.equal(repositoryFromOrigin('https://github.com/owner/semnome.git'), 'owner/semnome')
  assert.equal(repositoryFromOrigin('git@github.com:owner/semnome.git'), 'owner/semnome')
  assert.equal(repositoryFromOrigin('https://example.com/owner/semnome.git'), null)
})
test('label reconciliation is repeatable and never deletes unrelated labels', () => {
  const a = { name: 'type:task', color: '123456', description: 'Task' }, extra = { ...a, name: 'owner-label' }
  assert.deepEqual(labelActions([a], []), [{ action: 'create', label: a }])
  assert.deepEqual(labelActions([a], [a, extra]), [])
  assert.deepEqual(labelActions([a], [{ ...a, color: 'ffffff' }, extra]), [{ action: 'update', label: a }])
})
