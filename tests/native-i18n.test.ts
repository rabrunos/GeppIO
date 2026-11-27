import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DICTIONARY, dictionary } from '../tools/native-i18n.ts'

test('native English dictionary matches the reference catalogues', () => {
  assert.equal(readFileSync(DICTIONARY, 'utf8'), dictionary(), 'run node --experimental-strip-types tools/native-i18n.ts')
})
