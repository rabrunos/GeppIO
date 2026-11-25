import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { rankQuickOpen, validQuickOpenRequest } from '../src/geppio/src/shared/quick-open.ts'

test('Quick Open ranks literal basenames and paths deterministically and strips private metadata', () => {
  const names = ['dir/[x]/demo', 'abc[x].md', 'z/[X].txt', 'A/[x].txt', 'a/[x].txt', 'x.txt']
  const entries = names.map(file => ({ file, id: randomUUID(), witness: 'private' }))
  const ranked = rankQuickOpen(entries, '[X]')
  assert.deepEqual(ranked.items.map(item => item.file), ['A/[x].txt', 'a/[x].txt', 'z/[X].txt', 'abc[x].md', 'dir/[x]/demo'])
  assert.deepEqual(ranked, rankQuickOpen([...entries].reverse(), '[x]'))
  assert.deepEqual(Object.keys(ranked.items[0]!).sort(), ['file', 'id'])
  const accented = [{ file: 'café', id: randomUUID() }, { file: 'cafe\u0301', id: randomUUID() }]
  assert.deepEqual(rankQuickOpen(accented, 'CAFÉ').items, accented.slice(0, 1))
  const greek = [{ file: 'ς.txt', id: randomUUID() }]
  assert.deepEqual(rankQuickOpen(greek, 'Σ').items, greek)
  assert.deepEqual(rankQuickOpen(accented, '.*').items, [])
})

test('only fixed Quick Open argument shapes and bounded single-line queries are accepted', () => {
  const id = randomUUID(), item = randomUUID()
  for (const op of ['start', 'read']) {
    assert.ok(validQuickOpenRequest(op, [id, '🌲'.repeat(128)]))
    for (const term of [null, '', 'x\n', '\ud800', '🌲'.repeat(128) + 'a']) assert.equal(validQuickOpenRequest(op, [id, term]), false)
    assert.equal(validQuickOpenRequest(op, [id, 'literal', item]), false)
  }
  assert.ok(validQuickOpenRequest('cancel', [id])); assert.ok(validQuickOpenRequest('open', [id, item]))
  for (const args of [[id, 'nested/file.ts'], [id, item, false], ['/project', item]]) assert.equal(validQuickOpenRequest('open', args), false)
  assert.equal(validQuickOpenRequest('cancel', [id, item]), false)
  assert.equal(validQuickOpenRequest('list', [id]), false)
})
