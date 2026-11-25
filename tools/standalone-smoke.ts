import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, basename } from 'node:path'
import { electron, isolationConfigFromEnvironment } from './test-electron.ts'
import { exportDefinition } from './generate-standalone.ts'

const temporary = await realpath(tmpdir())
const temp = await mkdtemp(join(temporary, 'geppio-smoke-exports-'))
const author = join(temp, 'author'), installed = join(temp, 'installed'), roaming = join(temp, 'profiles')
const env = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string'))
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const localIsolation = Boolean(env.GEPPIO_ISOLATION_CONFIG)

async function removeFixture(path: string) {
  const actual = await realpath(path)
  assert.equal(actual, path)
  assert.ok(path === temp ? dirname(path) === temporary && basename(path).startsWith('geppio-smoke-exports-') : dirname(path) === temp)
  await rm(actual, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
}

/** Packaged Electron ignores the development launcher's -r. The disposable
 * local copy runs the same attestation module before its untouched Main;
 * hosted CI uses the exact distribution without this fixture bootstrap. */
async function attestLocalCopy(exe: string) {
  if (!localIsolation) return
  const app = join(dirname(exe), 'resources', 'app')
  const file = join(app, 'package.json'), pkg = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(pkg.main, 'main.cjs')
  const { preload } = isolationConfigFromEnvironment()
  const bootstrap = 'require(' + JSON.stringify(preload) + ')\n'
    + 'require("electron").app.setPath("appData", ' + JSON.stringify(roaming) + ')\nrequire("./main.cjs")\n'
  await writeFile(join(app, 'attested-main.cjs'), bootstrap, { flag: 'wx' })
  await writeFile(file, JSON.stringify({ ...pkg, main: 'attested-main.cjs' }))
}

try {
  await cp('examples/standalone', author, { recursive: true })
  await mkdir(installed)
  await mkdir(roaming)
  const sentinel = 'private-export-test-sentinel'
  await writeFile(join(author, 'private.txt'), sentinel)
  const definition = JSON.parse(await readFile(join(author, 'desk.json'), 'utf8'))
  const board = JSON.parse(await readFile(join(author, 'board.json'), 'utf8'))
  const products = []
  for (const [id, surface] of [['journal-a', false], ['journal-b', true]] as const) {
    const file = join(author, id + '.json')
    const tiles = surface ? [...definition.tiles, ...board.tiles] : definition.tiles
    await writeFile(file, JSON.stringify({ ...definition, productId: id, tiles }))
    const exe = await exportDefinition(file, join(installed, id))
    const appDir = join(dirname(exe), 'resources', 'app')
    assert.deepEqual((await readdir(appDir)).sort(), ['app.js', 'composition.json', 'index.html', 'main.cjs', 'package.json', 'resources.json', 'style.css'])
    const bundle = await readFile(join(appDir, 'app.js'), 'utf8')
    assert.doesNotMatch(bundle, /monaco-editor|node-pty|GeppIOTest|window\.geppio\b/)
    if (!surface) assert.doesNotMatch(bundle, /geppio-connect/)
    const resources = await readFile(join(appDir, 'resources.json'), 'utf8')
    assert.equal(resources.includes(sentinel), false)
    assert.equal(bundle.includes(author), false)
    assert.deepEqual(JSON.parse(resources).map((r: { id: string }) => r.id), surface ? ['sample.board', 'sample.stamp'] : [])
    await assert.rejects(exportDefinition(file, join(installed, id)), { code: 'EEXIST' })
    await attestLocalCopy(exe)
    products.push(exe)
  }
  // The complete authoring project disappears before any product starts.
  await removeFixture(author)
  for (const [index, previous] of [[0, false], [1, false], [0, true], [1, true]] as const) {
    const exe = products[index]!, directory = dirname(exe), id = basename(directory)
    // Locally the bootstrap confines default appData to this disposable root.
    // Also verify --portable with the exact packaged path on hosted Windows.
    const portable = index === 1 || !localIsolation
    const expectedData = join(portable ? join(directory, 'data') : roaming, 'geppio-export-' + id)
    const app = await electron.launch({ executablePath: exe, cwd: temp, args: portable ? ['--portable'] : [], env, timeout: 30000 })
    try {
      const page = await app.firstWindow({ timeout: 30000 })
      page.setDefaultTimeout(15000)
      page.on('pageerror', error => console.error('Standalone:', error.message))
      const input = page.getByRole('textbox', { name: 'Anotações' })
      await input.waitFor()
      assert.equal(await input.inputValue(), previous ? id + ' · conteúdo 😀' : '')
      const counter = page.getByRole('button', { name: 'Contar · ' + (previous ? '1' : '0') })
      await counter.waitFor()
      assert.equal(await page.evaluate(() => typeof window.geppio), 'undefined')
      assert.equal(page.url(), 'gpp-app://' + id + '/index.html')
      const state = await app.evaluate(({ app }) => [app.isPackaged, app.getName(), app.getPath('userData'), app.getAppPath()])
      assert.deepEqual(state, [true, 'geppio-export-' + id, expectedData, join(directory, 'resources', 'app')])
      await input.fill(id + ' · conteúdo 😀')
      await counter.click()
      if (index === 0) {
        assert.equal(await page.locator('main').getAttribute('data-active'), 'journal,sessions')
        assert.equal(await page.locator('iframe').count(), 0)
      } else {
        const host = page.locator('[data-tile="board"]')
        const contributor = page.locator('[data-tile="stamp"]')
        const primary = contributor.frameLocator('iframe[title="sample.stamp"]')
        await primary.getByRole('button', { name: 'Consultar quadro' }).click()
        await primary.getByText('denied', { exact: true }).waitFor()
        assert.equal(await page.locator('main').getAttribute('data-active'), 'journal,sessions,board,stamp')
        const slot = contributor.getByRole('checkbox', { name: 'Permitir slot sample.board / footer v1' })
        assert.equal(await slot.isChecked(), false, 'Grants never travel with the export or survive a fresh execution')
        await slot.check()
        const view = host.frameLocator('iframe[title="sample.stamp"]')
        await view.getByRole('button').click()
        await view.getByText('denied', { exact: true }).waitFor()
        await contributor.getByRole('checkbox', { name: 'Permitir service sample.board / title v1' }).check()
        await view.getByRole('button').click()
        await view.getByText('sample.stamp · 0', { exact: true }).waitFor()
        await contributor.getByRole('checkbox', { name: 'Permitir event sample.board / pulse v1' }).check()
        await host.frameLocator('iframe[title="sample.board"]').getByRole('button', { name: 'Anunciar' }).click()
        await view.getByText('Atualizado', { exact: true }).waitFor()
        await slot.uncheck()
        await host.locator('iframe[title="sample.stamp"]').waitFor({ state: 'detached' })
      }
    } finally { await app.close() }
  }
  console.log('Windows A/B/A/B passed authoring-tree removal, per-product data, counter/Unicode note retention, selected capabilities, live grants and slot revocation. Distribution:', localIsolation ? 'private-desktop attested copy' : 'unmodified executable and resources')
} finally { await removeFixture(temp) }
