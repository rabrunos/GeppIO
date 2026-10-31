import test from 'node:test'
import assert from 'node:assert/strict'
import { validWindowControlRequest } from '../src/shared/window-controls.ts'
test('window chrome accepts only the exact host main-frame URL and no arguments', () => {
  for (const expected of ['geppio://app/index.html', 'http://127.0.0.1:5173/']) {
    assert.equal(validWindowControlRequest(expected, expected, true, []), true)
    for (const actual of ['', expected + '#child', 'file:///private', 'geppio://other/index.html']) assert.equal(validWindowControlRequest(actual, expected, true, []), false)
    assert.equal(validWindowControlRequest(expected, expected, false, []), false)
    for (const args of [['minimize'], [{}], [null], ['C:\\private']]) assert.equal(validWindowControlRequest(expected, expected, true, args), false)
  }
})
