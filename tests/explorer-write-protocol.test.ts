import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { validExplorerBasename, validExplorerMutationRequest } from '../src/geppio/src/shared/explorer.ts'

test('Explorer writes accept only a literal Windows basename and two opaque IDs', () => {
  const root = randomUUID(), item = randomUUID()
  const view = { id: randomUUID(), revision: randomUUID(), dirty: true, language: 'JavaScript', selection: { start: 2, end: 5, top: 0, left: 0 } }
  assert.ok(validExplorerMutationRequest([root, item, 'outro', view], 'rename-file'))
  for (const wrong of [{ ...view, revision: item + 'x' }, { ...view, path: 'other' }, { ...view, dirty: 'false' }, { ...view, selection: null }]) {
    assert.equal(validExplorerMutationRequest([root, item, 'outro', wrong], 'rename-file'), false)
  }
  assert.equal(validExplorerMutationRequest([root, item, 'outro', view], 'create-file'), false)
  for (const name of ["café $ & 'semi;.txt", '.env', '😀.txt', '100% literal', 'a'.repeat(255)]) {
    assert.equal(validExplorerBasename(name), true)
    assert.equal(validExplorerMutationRequest([root, item, name]), true)
  }
  for (const name of ['', '.', '..', '.GiT', '../other', 'a\\b', 'C:x', 'x:stream', 'end.', 'end ',
    'con.TXT', 'NUL .log', 'conin$', 'CONOUT$.txt', 'COM¹.txt', 'lpt9', 'short~1', 'control\u0001',
    'broken\ud800', 'a'.repeat(256), {}, null]) {
    assert.equal(validExplorerBasename(name), false)
    assert.equal(validExplorerMutationRequest([root, item, name]), false)
  }
  for (const args of [[], [root, item], ['project', item, 'f'], [root, '.', 'f'], [root, item, 'f', 'text']]) {
    assert.equal(validExplorerMutationRequest(args), false)
  }
})
