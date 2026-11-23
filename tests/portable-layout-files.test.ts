import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { exportLayoutFile, importLayoutFile } from '../src/main/portable-layout-files.ts'
import { selectSuite } from '../tools/isolation/plan.ts'

const recipe = { kind: 'geppio-layout', version: 1, name: 'Base', mode: 'format', scopes: ['main'],
  reference: { main: { width: 800, height: 500 } }, chrome: {}, format: [{ key: 's1', region: 'main', x: 0, y: 0, width: 300, height: 200 }],
  views: [], placements: [], groups: [] }
const json = JSON.stringify(recipe)
const current = () => true
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'geppio-layout-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return join(root, 'example.geppio-layout.json')
}

test('exclusive creation admits one writer and imports only the selected bounded UTF-8 recipe', async t => {
  const path = await fixture(t)
  const results = await Promise.all([exportLayoutFile(path, json, current), exportLayoutFile(path, json, current)])
  assert.equal(results.filter(r => r.ok && !r.canceled).length, 1)
  assert.equal(results.filter(r => !r.ok && !r.unconfirmed && r.error.includes('já existe')).length, 1)
  assert.deepEqual(await importLayoutFile(path, current), { ok: true, recipe })
  const before = await readFile(path)
  assert.equal((await exportLayoutFile(path, json.replace('Base', 'Other'), current)).ok, false)
  assert.deepEqual(await readFile(path), before)
  assert.equal((await importLayoutFile(path, () => false)).ok, false)
})

test('invalid selection, value, owner and file bytes fail without adopting a recipe', async t => {
  const path = await fixture(t)
  for (const [name, text, allowed] of [[path, '123', true], [path, json, false], [path + '.exe', json, true]] as const) {
    assert.equal((await exportLayoutFile(name, text, () => allowed)).ok, false)
    await assert.rejects(readFile(name), { code: 'ENOENT' })
  }
  for (const bytes of [Buffer.from([0xff, 0xfe]), Buffer.alloc(65537, 32), Buffer.from('{"kind":"other"}')]) {
    await writeFile(path, bytes)
    assert.equal((await importLayoutFile(path, current)).ok, false)
    assert.deepEqual(await readFile(path), bytes)
  }
})

test('revocation or a failed write after exclusive creation retains evidence of uncertain output', async t => {
  const path = await fixture(t)
  for (const failure of ['expired', 'partial', 'replaced'] as const) {
    let active = true
    const result = await exportLayoutFile(path, json, () => active, async selected => {
      const file = await open(selected, 'wx')
      if (failure === 'expired') active = false
      return { stat: file.stat.bind(file), close: file.close.bind(file), sync: file.sync.bind(file),
        async writeFile() {
          await file.writeFile('partial')
          if (failure === 'partial') throw new Error('injected after output')
          await rename(path, path + '.first')
          await writeFile(path, 'external', { flag: 'wx' })
        } }
    })
    assert.ok(!result.ok && result.unconfirmed)
    assert.equal(await readFile(path, 'utf8'), failure === 'expired' ? '' : failure === 'partial' ? 'partial' : 'external')
    await rm(path)
  }
})

test('portable-layout has production desktop coverage at both supported scales', () => {
  for (const variant of [undefined, '--scale125']) assert.equal(selectSuite('portable-layout', variant).step.file, 'tools/portable-layout-smoke.ts')
  assert.throws(() => selectSuite('portable-layout', '--dev'))
})

test('final confirmation checks exact file bytes after close', async t => {
  const path = await fixture(t)
  const result = await exportLayoutFile(path, json, current, async selected => {
    const file = await open(selected, 'wx')
    return { stat: file.stat.bind(file), sync: file.sync.bind(file), writeFile: file.writeFile.bind(file),
      async close() {
        await file.close()
        const content = await readFile(path)
        await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]))
      } }
  })
  assert.ok(!result.ok && result.unconfirmed)
  assert.equal((await readFile(path))[0], 0xef)
})
