import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { PluginStore } from '../src/main/plugins.ts'
import { snapshotTree, BACKUP_DIRECTORY } from '../src/main/profile-migration.ts'
import { IDENTITY } from '../src/shared/identity.ts'
import { DEFAULT_LAYOUT } from '../src/renderer/src/fixtures.ts'

const temporary = await mkdtemp(join(tmpdir(), 'geppio-smoke-identity-'))
const environment: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS; delete environment.ELECTRON_RENDERER_URL; delete environment.GEPPIO_TEST_USER_DATA; delete environment.SEMNOME_TEST_USER_DATA
let application: ElectronApplication | undefined
let devServer: import('vite').ViteDevServer | undefined
// Generated JS is an inert disposable fixture, compiled from TypeScript with the existing toolchain.
const seed = join(temporary, 'seed.cjs')
await writeFile(seed, ts.transpileModule(`
import { app, BrowserWindow, protocol, session } from 'electron'
app.setName('semnome')
app.setPath('userData', process.argv[2]!)
app.setPath('sessionData', process.argv[2]!)
protocol.registerSchemesAsPrivileged(['semnome', 'geppio'].map(scheme => ({ scheme, privileges: { standard: true, secure: true } })))
app.whenReady().then(async () => {
  const url = process.argv[3]!
  session.defaultSession.protocol.handle(new URL(url).protocol.slice(0, -1), request => new Response(request.url === url ? '<!doctype html><title>Fixture</title>' : null, { status: request.url === url ? 200 : 403, headers: { 'Content-Type': 'text/html' } }))
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  await window.loadURL(url)
})
`, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText)

async function seedProfile(profile: string, url: string, legacy: string, current: string | null = null) {
  await mkdir(profile, { recursive: true })
  application = await electron.launch({ args: [seed, profile, url], env: environment, timeout: 30000 })
  const page = await application.firstWindow(); await page.waitForURL(url)
  await page.evaluate(({ legacy, current }) => {
    localStorage.setItem('semnome:layout:v1', legacy)
    if (current !== null) localStorage.setItem('geppio:layout:v1', current)
  }, { legacy, current })
  await application.evaluate(({ session }) => session.defaultSession.flushStorageData())
  await application.close(); application = undefined
}
async function launch(root: string): Promise<Page> {
  application = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...environment, GEPPIO_TEST_USER_DATA: root,
    ...(devServer ? { ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173/', NODE_ENV: 'development' } : { NODE_ENV: 'production' }) }, timeout: 30000 })
  const url = devServer ? 'http://127.0.0.1:5173/' : 'geppio://app/index.html'
  // Migration owns hidden windows first; wait for the actual application window.
  const deadline = Date.now() + 30000
  let page: Page | undefined
  while (!page && Date.now() < deadline) {
    page = application.windows().find(p => !p.isClosed() && p.url() === url)
    if (!page) await new Promise(done => setTimeout(done, 50))
  }
  assert.ok(page); await page.getByTestId('edit-layout').waitFor()
  return page
}
async function close() { await application!.close(); application = undefined }
try {
  if (process.argv.includes('--dev')) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    devServer = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false }); await devServer.listen()
  }
  const oldURL = devServer ? 'http://127.0.0.1:5173/fixture.html' : 'semnome://app/fixture.html'
  const newURL = devServer ? oldURL : 'geppio://app/fixture.html'
  const legacyLayout = JSON.stringify({ ...DEFAULT_LAYOUT, theme: 'light', placements: DEFAULT_LAYOUT.placements.map(p => p.id === 'summary' ? { ...p, x: .005 } : p) })
  const root = join(temporary, 'migration'); await mkdir(root)
  const old = join(root, 'semnome'), next = join(root, 'geppio')
  await seedProfile(old, oldURL, legacyLayout)
  const store = new PluginStore(join(old, 'plugins'))
  await store.install(resolve('.local/plugin-packages/counter')); await store.install(resolve('.local/plugin-packages/pulse')); await store.setEnabled('local.counter', true)
  const oldBytes = snapshotTree(old), oldInventory = await store.list()
  let page = await launch(root)
  assert.equal(await page.title(), 'GeppIO')
  const native = await application!.evaluate(({ app }) => ({ name: app.getName(), data: app.getPath('userData'), session: app.getPath('sessionData') }))
  assert.deepEqual(native, { name: 'GeppIO', data: next, session: next })
  assert.equal(await page.evaluate(() => window.geppio!.name), 'GeppIO')
  assert.equal(await page.evaluate(() => 'semnome' in window), false)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), legacyLayout)
  assert.equal(await page.locator('.workbench').getAttribute('data-theme'), 'light')
  assert.equal(await page.locator('[data-widget="summary"]').evaluate(element => (element as HTMLElement).style.left), '0.5%')
  const inventory = await page.evaluate(() => window.geppio!.plugins.list())
  assert.ok(inventory.ok); assert.deepEqual(inventory.value, oldInventory)
  await page.locator('[data-plugin-widget="local.counter:counter"]').waitFor()
  assert.equal(await page.evaluate(async () => { try { await fetch('semnome://app/index.html'); return false } catch { return true } }), true)
  assert.equal(await page.evaluate(async () => { try { await fetch('geppio://app/identity-recovery.html'); return false } catch { return true } }), true)
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
  const changed = await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey)
  await close(); assert.deepEqual(snapshotTree(old), oldBytes)
  page = await launch(root)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), changed)
  assert.deepEqual(await new PluginStore(join(next, 'plugins')).list(), oldInventory)
  await close(); assert.deepEqual(snapshotTree(old), oldBytes)
  assert.deepEqual(snapshotTree(join(next, BACKUP_DIRECTORY, 'Local Storage')), snapshotTree(join(old, 'Local Storage')))

  // An existing GeppIO profile wins, even with a useful old profile alongside it.
  const existing = join(temporary, 'existing'); await mkdir(existing)
  await seedProfile(join(existing, 'semnome'), oldURL, legacyLayout)
  const currentLayout = JSON.stringify(DEFAULT_LAYOUT)
  await seedProfile(join(existing, 'geppio'), newURL, legacyLayout, currentLayout)
  page = await launch(existing)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), currentLayout)
  await close()

  // Corrupt destination bytes survive the application restart and are reported in the UI.
  const corrupt = join(temporary, 'corrupt'); await mkdir(corrupt)
  await seedProfile(join(corrupt, 'semnome'), oldURL, legacyLayout)
  await seedProfile(join(corrupt, 'geppio'), newURL, legacyLayout, '{corrupt layout')
  await mkdir(join(corrupt, 'geppio', 'plugins'), { recursive: true })
  await writeFile(join(corrupt, 'geppio', 'plugins', 'state.json'), '{corrupt plugins')
  page = await launch(corrupt)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), '{corrupt layout')
  await page.getByText('Não foi possível restaurar o layout. O rascunho anterior não foi apagado.', { exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.geppio!.plugins.list())).ok, false)
  await close()
  assert.equal(await readFile(join(corrupt, 'geppio', 'plugins', 'state.json'), 'utf8'), '{corrupt plugins')
  console.log(JSON.stringify({ result: 'passed', mode: devServer ? 'development' : 'production', checks: ['Chromium legacy origin transfer', 'layout/theme', 'installed/enabled plugin continuity', 'original and backup bytes', 'restart/idempotence', 'existing destination wins', 'corrupt layout/plugin preservation', 'legacy URL and recovery page rejected', 'new title/bridge/profile'] }))
} finally {
  if (application) await application.close()
  if (devServer) await devServer.close()
  await rm(temporary, { recursive: true, force: true })
}
