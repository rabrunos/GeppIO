import assert from 'node:assert/strict'
import test from 'node:test'
import { moveWithArrow } from '../src/geppio/src/renderer/src/shared-views/movement.ts'

test('keyboard movement preserves fractional origins, shares pointer bounds and ignores unrelated keys', () => {
  const origin = { x: 45.5, y: 80.25 }, area = { width: 500, height: 400 }, size = { width: 200, height: 150 }
  const move = (key: string, shift = false) => moveWithArrow(key, shift, origin, area, size)
  assert.deepEqual(move('ArrowLeft'), { x: 44.5, y: 80.25 })
  assert.deepEqual(move('ArrowRight', true), { x: 55.5, y: 80.25 })
  assert.deepEqual(move('ArrowUp', true), { x: 45.5, y: 70.25 })
  assert.deepEqual(move('ArrowDown'), { x: 45.5, y: 81.25 })
  assert.equal(move('Enter'), null)
  assert.deepEqual(moveWithArrow('ArrowLeft', true, { x: 13, y: 12 }, area, size), { x: 12, y: 12 })
  assert.deepEqual(moveWithArrow('ArrowDown', true, origin, { width: 80, height: 90 }, size), { x: 12, y: 12 })
})
