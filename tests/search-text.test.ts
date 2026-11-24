import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { SEARCH_LIMITS, searchText, validSearchQuery, validSearchRequest } from '../src/shared/search.ts'
import { wellFormedText } from '../src/shared/documents.ts'
import { includedByFilters, validSearchFilters } from '../src/shared/search-replacement.ts'

test('path and suffix filters are bounded literal comparisons and mutation messages accept only reviewed opaque identities', () => {
  const job = randomUUID(), id = randomUUID(), revision = randomUUID(), mark = { id, revision, clean: true }
  for (const path of ['/a', '/', '../x', 'a//b', 'a/./b', 'a\\b', '*.txt', 'C:/private', 'x'.repeat(513)])
    assert.equal(validSearchFilters({ path, extensions: 'txt' }), false, path)
  for (const extensions of ['.txt', 'txt,,md', 'x'.repeat(17), Array(13).fill('md').join(',')])
    assert.equal(validSearchFilters({ path: '', extensions }), false)
  const filters = { path: 'src/', extensions: 'TXT, md' }
  assert.ok(validSearchRequest('start', [job, 'a', false, filters]))
  assert.ok(includedByFilters('src/a.TxT', filters))
  assert.equal(includedByFilters('src2/a.txt', filters), false)
  assert.equal(includedByFilters('src/a.txt', { path: 'src/a', extensions: '' }), false)
  assert.ok(validSearchRequest('preview', [job, [id], '', [mark]]))
  for (const ids of [[], [id, id], ['src/a.txt'], Array(1001).fill(id)]) assert.equal(validSearchRequest('preview', [job, ids, 'x', []]), false)
  for (const replacement of ['x'.repeat(1025), '\u0000', '\ud800']) assert.equal(validSearchRequest('preview', [job, [id], replacement, []]), false)
  assert.ok(validSearchRequest('applyFile', [job, revision, id, [mark]]))
  for (const marks of [[mark, mark], [{ ...mark, path: 'src/a.txt' }], [{ ...mark, clean: 'yes' }]])
    assert.equal(validSearchRequest('applyFile', [job, revision, id, marks]), false)
})

test('literal Unicode search uses source UTF-16 columns across CR, LF and CRLF', () => {
  const text = '🌱 É.[x]\\$\r\ne.[x]\\$\rÉ.[x]\\$\né.[x]\\$'
  const found = [...searchText(text, 'é.[x]\\$', false)]
  assert.deepEqual(found.map(hit => [hit.line, hit.column, hit.length]), [[1, 4, 7], [3, 1, 7], [4, 1, 7]])
  assert.deepEqual(found.map(hit => hit.snippet.slice(hit.highlightStart, hit.highlightEnd)), ['É.[x]\\$', 'É.[x]\\$', 'é.[x]\\$'])
  assert.deepEqual([...searchText(text, 'É.[x]\\$', true)].map(hit => hit.line), [1, 3])
  assert.equal([...searchText('cafe\u0301 café', 'café', false)].length, 1)
  assert.deepEqual([...searchText('a K k K', 'k', false)].map(hit => hit.column), [3, 5, 7])
})

test('bounded snippets retain valid Unicode and the full source selection length', () => {
  for (const query of ['a', '🌱'.repeat(128)]) {
    const text = '🌿'.repeat(190) + query + '🪴'.repeat(190)
    const [hit] = searchText(text, query, true)
    assert.ok(hit && wellFormedText(hit.snippet) && hit.snippet.length <= SEARCH_LIMITS.snippet)
    assert.equal(hit.column, 381); assert.equal(hit.length, query.length)
    assert.ok(hit.highlightStart >= 0 && hit.highlightEnd <= hit.snippet.length)
    assert.equal(hit.snippet.slice(hit.highlightStart, hit.highlightEnd), query.slice(0, Math.min(SEARCH_LIMITS.snippet, query.length)))
  }
})

test('only exact, bounded fixed calls with opaque IDs enter the search bridge', () => {
  const root = randomUUID(), job = randomUUID(), match = randomUUID()
  for (const value of ['', 'x'.repeat(257), '\u2028', '\r', '\n', '\u0000', '\u007f', '\u0085', '\ud800', 4]) assert.equal(validSearchQuery(value), false)
  assert.ok(validSearchQuery(' '.repeat(256)))
  assert.ok(validSearchRequest('start', [root, '✨.*', false]))
  assert.ok(validSearchRequest('read', [job, 0])); assert.ok(validSearchRequest('read', [job, 1000]))
  assert.ok(validSearchRequest('cancel', [job])); assert.ok(validSearchRequest('open', [job, match]))
  for (const [method, args] of [['start', [root, '', true]], ['start', [root, 'x', 0]], ['start', [root, 'x', true, 'extra']],
    ['read', [job, 0.5]], ['read', [job, -1]], ['read', [job, 1001]], ['open', [job, 'file.txt']], ['open', [job]], ['cancel', [job, 0]], ['replace', [root]]] as const) {
    assert.equal(validSearchRequest(method, args), false)
  }
})
