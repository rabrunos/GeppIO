import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildFixtures, FIXTURE_DIR } from '../tools/native-fixtures.ts'

test('native differential fixtures regenerate byte-identically from the TypeScript reference', () => {
  const fixtures = buildFixtures()
  const committed = readdirSync(FIXTURE_DIR).filter(name => name.endsWith('.json')).sort()
  assert.deepEqual(committed, Object.keys(fixtures).sort(), 'Every fixture file is generated and every generated file is committed')
  for (const [name, text] of Object.entries(fixtures)) {
    assert.ok(readFileSync(join(FIXTURE_DIR, name), 'utf8') === text,
      `${name} drifted from the reference; regenerate with node --experimental-strip-types tools/native-fixtures.ts`)
  }
})
