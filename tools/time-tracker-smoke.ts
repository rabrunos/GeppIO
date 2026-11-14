import { enableDeveloperMode } from './plugin-dev-support.ts'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { IDENTITY } from '../src/shared/identity.ts'
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-time-'))
const diagnostics = '.local/diagnostics/time-tracker-alpha25'; await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], plugin = 'geppio.time-tracker'
const content = (name: string) => page.locator(`[data-plugin-widget="${plugin}:${name}"]`)
const frame = (name: string) => page.locator('.widget-frame').filter({ has: content(name) })
async function launch() {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 }); page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(1920, 1080); w.show(); w.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
}
async function edit() { await page.getByTestId('edit-layout').click(); await settle(page) }
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function saved() { await page.waitForFunction(() => document.querySelector('[data-plugin-widget="geppio.time-tracker:timer"] p')?.textContent?.split('\n\n')[0]?.endsWith('Salvo.')) }
async function move(name: string, region: string) {
  await frame(name).hover({ position: { x: 40, y: 12 } })
  const grip = frame(name).locator('.widget-grip'), box = await grip.boundingBox(); assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForFunction(name => getComputedStyle(document.querySelector(`[data-plugin-widget="geppio.time-tracker:${name}"]`)!.closest('.widget-frame')!.querySelector('.widget-grip')!).pointerEvents === 'auto', name)
  await grip.click(); await settle(page); await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
  assert.equal(await frame(name).getAttribute('data-owner-region'), region)
}
try {
  await launch(); await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  for (const name of ['workspace-essentials', 'time-tracker']) {
    const id = 'geppio.' + name
    await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/' + name))
    await enableDeveloperMode(manager)
    await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
    await manager.locator(`[data-plugin="${id}"]`).getByRole('switch').click()
    await page.waitForFunction(id => document.querySelector(`[data-plugin="${id}"]`)?.getAttribute('data-status') === 'active', id)
  }
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); assert.equal(await page.locator('.widget-frame').count(), 0)
  await edit()
  // Alpha.39 adds the official Explorer to Main/Sidebar, never Bottom.
  for (const [label, count] of [['Principal', 8], ['Lateral', 6], ['Inferior', 5]] as const) {
    await page.getByRole('button', { name: 'Todas as áreas', exact: true }).click()
    await page.getByRole('button', { name: `Filtrar por: ${label}`, exact: true }).click()
    assert.equal(await page.locator('[data-catalog-type]').count(), count)
    assert.equal(await page.locator('[data-catalog-type="host:file-explorer"]').count(), label === 'Inferior' ? 0 : 1)
  }
  await page.getByRole('button', { name: 'Todas as áreas', exact: true }).click()
  for (const name of ['timer', 'reports']) { await page.locator(`[data-catalog-type="plugin:${plugin}:${name}"]`).click(); await page.locator('[data-widget-place="main"]').click(); await settle(page) }
  await conclude(); await saved()
  const dataRoot = join(profile, IDENTITY.directory, 'plugin-data')
  let dataPath = ''
  // Empty installations do not write a document until the first explicit Start.
  await content('timer').getByRole('button', { name: 'Iniciar', exact: true }).click(); await content('timer').getByRole('button', { name: 'Pausar', exact: true }).waitFor(); await saved()
  if (!dataPath) for (const file of await readdir(dataRoot)) { const path = join(dataRoot, file); if (JSON.parse(await readFile(path, 'utf8')).pluginId === plugin) dataPath = path }
  assert.ok(dataPath)
  const read = async () => JSON.parse(await readFile(dataPath, 'utf8'))
  const started = (await read()).document.value.running
  assert.ok(started?.start > 0)
  const workers = page.workers()
  for (const region of ['sidebar', 'bottom', 'main']) {
    await edit(); for (const name of ['timer', 'reports']) if (await frame(name).getAttribute('data-owner-region') !== region) await move(name, region); await conclude(); await saved()
    if (region === 'sidebar') {
      await page.getByRole('button', { name: 'Ferramentas', exact: true }).click(); await settle(page)
      assert.deepEqual((await read()).document.value.running, started, 'Hiding the containing Sidebar preserves the session')
      await page.getByRole('button', { name: 'Ferramentas', exact: true }).click(); await settle(page)
      await page.getByRole('button', { name: 'Nova barra', exact: true }).click()
      const bar = page.getByRole('dialog', { name: 'Nova barra', exact: true })
      await bar.getByRole('textbox', { name: 'Nome', exact: true }).fill('Controle de continuidade')
      await bar.getByRole('button', { name: 'Criar barra', exact: true }).click(); await bar.waitFor({ state: 'detached' }); await settle(page)
      await page.locator('[data-sidebar-custom]').last().click(); await settle(page)
      assert.deepEqual((await read()).document.value.running, started, 'An inactive Sidebar bar does not pause the session')
      await page.locator('[data-bar-id="home"]').click(); await settle(page)
    }
    if (region === 'bottom') {
      await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter'); await settle(page)
      assert.deepEqual((await read()).document.value.running, started, 'Collapsing the containing Bottom preserves the session')
      await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter'); await settle(page)
    }
    assert.deepEqual((await read()).document.value.running, started)
  }
  assert.deepEqual(page.workers(), workers, 'Region moves retain both plugin Workers')
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click(); await settle(page)
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click(); await settle(page)
  await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter'); await settle(page)
  await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter'); await settle(page)
  await app!.close(); app = undefined; await launch(); await saved()
  assert.deepEqual((await read()).document.value.running, started, 'Restart keeps the original running start timestamp')
  assert.match(await content('timer').innerText(), /Em andamento/)
  const confirmed = await readFile(dataPath, 'utf8'), backup = dataPath + '.backup'
  await rename(dataPath, backup); await mkdir(dataPath)
  await content('timer').getByRole('button', { name: 'Pausar', exact: true }).click()
  await content('timer').getByText(/Falha ao salvar/).waitFor(); assert.equal(await readFile(backup, 'utf8'), confirmed)
  assert.equal(dirname(dataPath), dataRoot); await rm(dataPath, { recursive: true }); await rename(backup, dataPath)
  await content('timer').getByRole('button', { name: 'Tentar salvar novamente', exact: true }).click(); await saved()
  const paused = await read(); assert.equal(paused.document.value.running, null); assert.equal(paused.document.value.sessions.length, 1); assert.equal(paused.document.value.sessions[0].id, started.id)
  assert.match(await content('reports').innerText(), /1 sessões/)
  await app!.close(); app = undefined; const valid = await readFile(dataPath, 'utf8')
  await writeFile(dataPath, '{corrupt'); await launch(); await content('timer').getByText(/Falha ao ler histórico/).waitFor(); assert.equal(await readFile(dataPath, 'utf8'), '{corrupt')
  assert.equal(await content('timer').getByRole('button').count(), 0)
  await app!.close(); app = undefined; await writeFile(dataPath, valid); await launch(); await saved()
  assert.equal((await read()).document.value.sessions.length, 1); assert.match(await content('reports').innerText(), /Totais diários/)
  await page.screenshot({ path: diagnostics + '/timer-reports.png' }); assert.deepEqual(errors, [])
  console.log('PASS Time Tracker: install/explicit placement, catalog 8/6/5 including Explorer Main/Sidebar, all destinations, shared Workers, visibility, start/restart/pause, native failure/retry, single interval, totals/history and corrupt recovery')
} catch (error) { await page?.screenshot({ path: diagnostics + '/failure.png' }).catch(() => {}); throw error }
finally { await app?.close(); assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert.ok(profile.includes('geppio-smoke-time-')); await rm(profile, { recursive: true, force: true }) }
