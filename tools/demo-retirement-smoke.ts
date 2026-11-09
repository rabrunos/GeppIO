import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initialWorkbench as demoWorkbench, widgetRegistry as demoRegistry } from '../tests/fixtures/workbench.ts'
import { WORKBENCH_KEY, widgetRegistry } from '../src/shared/workbench/model.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { captureCurrentComposition } from '../src/shared/workbench/compositions.ts'
import { addWidget } from '../src/shared/workbench/commands.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-demo-retirement-'))
const directory = '.local/diagnostics/demo-retirement-alpha20'
await mkdir(directory, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = []
async function launch() {
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(1920, 1080); w.show(); w.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  assert.equal(await page.evaluate(() => window.geppio!.demoFixtures), false)
}
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
async function noDemos() { assert.equal(await page.locator('.widget-frame[data-widget-id]:not([data-widget-id^="plugin:"])').count(), 0); assert.equal(await page.locator('[data-catalog-type^="host:"]').count(), 0) }
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page); await noDemos() }
try {
  await launch(); await noDemos()
  assert.equal(await raw(), null)
  assert.equal(await page.locator('[data-empty-region]').count(), 3)
  await page.getByTestId('edit-layout').click(); await settle(page); await noDemos()
  await page.getByTestId('cancel-layout').click(); assert.equal(await raw(), null)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/counter'))
  await manager.getByRole('button', { name: 'Instalar pasta local', exact: true }).click()
  const record = manager.locator('[data-plugin="local.counter"]')
  await record.getByRole('switch').click()
  await page.waitForFunction(() => document.querySelector('[data-plugin="local.counter"]')?.getAttribute('data-status') === 'active')
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="plugin:local.counter:counter"]').click()
  await page.locator('.widget-browser-destination [data-widget-place="main"]').click(); await conclude()
  await page.getByRole('button', { name: 'Incrementar', exact: true }).click()
  await page.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor()
  const inventory = await page.evaluate(() => window.geppio!.plugins.list()); assert.ok(inventory.ok)
  const registry = widgetRegistry(inventory.value.plugins), fixtures = demoRegistry(inventory.value.plugins)
  const old = demoWorkbench(); old.placements = old.placements.filter(p => p.id !== 'queue')
  old.organization.bars.push({ id: 'bar:mine', name: 'Minha barra', userNamed: true, icon: 'notes', archived: true, members: ['host:notes'], positions: { 'host:notes': 42 } })
  const upgraded = addWidget(old, fixtures, 'plugin:local.counter:counter', { ...old.reference.main, region: 'main', expanded: false }, { x: 790, y: 0 })!
  const composition = captureCurrentComposition(upgraded, 'Alpha19 salva', ['main', 'bottom'], true)
  upgraded.organization.compositions.push(composition); upgraded.organization.favorites.push(composition.id)
  const original = serializeWorkbench(upgraded, fixtures)
  await page.evaluate(({ key, original }) => localStorage.setItem(key, original), { key: WORKBENCH_KEY, original })
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page); await noDemos()
  assert.equal(await raw(), original); assert.equal(await page.getByTestId('edit-layout').isDisabled(), false)
  assert.ok(await page.getByRole('button', { name: 'Incrementar', exact: true }).isVisible())
  await app!.close(); app = undefined; await launch(); await noDemos(); assert.equal(await raw(), original)
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.getByRole('tab', { name: 'Composições', exact: true }).click()
  const saved = page.locator('.composition-tile').filter({ hasText: 'Alpha19 salva' })
  await saved.hover(); await settle(page)
  await saved.getByRole('button', { name: 'Restaurar widgets de Alpha19 salva', exact: true }).click(); await settle(page); await noDemos(); await conclude()
  const restored = parseWorkbench((await raw())!, registry)
  assert.equal(restored.retiredDemos!.views.length, 7)
  assert.equal(restored.organization.bars[1]!.name, 'Minha barra'); assert.equal(restored.organization.compositions.length, 1)
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
  await page.getByRole('button', { name: 'Prévia da composição inicial', exact: true }).click(); await noDemos()
  await conclude()
  const reset = parseWorkbench((await raw())!, registry)
  assert.equal(reset.placements.length, 0); assert.equal(reset.organization.compositions.length, 1)
  assert.equal(reset.organization.bars[1]!.name, 'Minha barra'); assert.equal(reset.retiredDemos!.views.length, 7)
  const remaining = await page.evaluate(() => window.geppio!.plugins.list()); assert.ok(remaining.ok); assert.equal(remaining.value.plugins.length, 1)
  await app!.close(); app = undefined; await launch(); await noDemos(); assert.equal(await page.locator('[data-empty-region]').count(), 3)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: `${directory}/reset.png` })
  await writeFile(`${directory}/result.json`, JSON.stringify({ fresh: 'passed', upgrade: 'passed', restart: 'passed', composition: 'passed', reset: 'passed', plugins: 'passed' }, null, 2))
  console.log('PASS demo retirement: fresh profile, alpha.19 + installed plugin, original bytes, restart, saved composition, reset, custom bars and plugin retention')
} catch (error) {
  if (app) { await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {}); await writeFile(`${directory}/failure.txt`, String(error) + '\n' + errors.join('\n')) }
  throw error
} finally { await app?.close(); await rm(profile, { recursive: true, force: true }) }
