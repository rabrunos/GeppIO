import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { WorkbenchSnapshot } from '../src/shared/workbench/model.ts'
import { parseManifest } from '../src/shared/plugins.ts'
import { electron } from './test-electron.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'

const scale125 = process.argv.includes('--scale125')
const temp = await mkdtemp(join(tmpdir(), 'geppio-smoke-templates-'))
const profile = join(temp, 'profile'), source = join(temp, 'provider')
const id = 'local.composition-templates', custom = 'Minha bancada de leitura'
const diagnostics = resolve('.local/diagnostics/plugin-templates' + (scale125 ? '-125' : ''))
let app: ElectronApplication | undefined, page!: Page, workers = 0
const errors: string[] = []
async function launch() {
  const env = { ...process.env, GEPPIO_TEST_USER_DATA: profile, NODE_ENV: 'production' }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete (env as NodeJS.ProcessEnv)[key]
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await app.firstWindow(); page.setDefaultTimeout(15000)
  page.on('worker', worker => { if (worker.url().includes('plugin-worker')) workers++ })
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1600, 980); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
}
async function close() {
  if (!app) return
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {})
  await app.close(); app = undefined
}
async function settings() {
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
}
const closeSettings = () => page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
const plugin = () => page.getByTestId('plugin-settings').locator('[data-plugin="' + id + '"]')
async function installed() {
  const list = await page.evaluate(() => window.geppio!.plugins.list())
  assert.ok(list.ok); return list.value.plugins.find(p => p.manifest.id === id)
}
async function edit() {
  await page.getByTestId('edit-layout').click(); await settle(page)
  const toggle = page.locator('.widget-catalog-toggle')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}
async function conclude() {
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
}
const library = () => page.getByRole('tab', { name: 'Composições', exact: true }).click()
const models = () => page.getByRole('button', { name: 'Modelos de plugins', exact: true }).click()
const template = () => page.locator('[data-composition-template-provider="' + id + '"][data-composition-template-id="study"]')
const preview = () => page.getByRole('dialog', { name: 'Prévia do modelo', exact: true })
const copy = () => page.locator('[data-composition-card]').filter({ has: page.locator('.composition-name', { hasText: custom }) })
const bytes = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
async function saved() {
  const raw = await bytes(); assert.ok(raw)
  return JSON.parse(raw) as { organization: WorkbenchSnapshot['organization']; layout: WorkbenchSnapshot }
}
try {
  await mkdir(profile); await mkdir(diagnostics, { recursive: true })
  await cp(resolve('.local/plugin-packages/composition-templates'), source, { recursive: true })
  const manifestPath = join(source, 'plugin.json'), manifest = parseManifest(await readFile(manifestPath, 'utf8'))
  // This disposable provider must never be evaluated just to browse or copy its metadata.
  await writeFile(join(source, manifest.entry), 'throw new Error("Disabled template provider executed");\n')
  await launch(); await settings()
  await enableDeveloperMode(page.getByTestId('plugin-settings'))
  await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, source)
  await page.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  await plugin().waitFor(); assert.equal(await plugin().getAttribute('data-status'), 'disabled')
  const first = await installed(); assert.ok(first && !first.enabled && first.source === 'external')
  await closeSettings()
  await edit(); await page.getByRole('tab', { name: 'Widgets', exact: true }).click()
  await page.locator('[data-catalog-type="host:file-editor"]').click(); await page.locator('[data-widget-place="main"]').click()
  await conclude()
  const original = await saved(), originalBytes = await bytes()
  await edit(); await library(); await models(); await template().click()
  await preview().waitFor()
  assert.match(await preview().innerText(), /local\.composition-templates/)
  assert.match(await preview().innerText(), /1\.0\.0/)
  assert.match(await preview().innerText(), /notas|anotações|workspace-essentials/i)
  assert.equal(await bytes(), originalBytes)
  await preview().getByRole('button', { name: 'Cancelar', exact: true }).press('Enter')
  assert.equal(await bytes(), originalBytes)
  await models(); await template().click()
  await preview().getByRole('textbox', { name: 'Nome da composição' }).fill(custom)
  // A failed publication must retain the old bytes and the preview for retry.
  await page.evaluate(key => {
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function(k, value) {
      if (k === key) { Storage.prototype.setItem = write; throw new DOMException('Fixture quota', 'QuotaExceededError') }
      write.call(this, k, value)
    }
  }, WORKBENCH_KEY)
  const addCopy = preview().getByRole('button', { name: 'Adicionar cópia', exact: true })
  await addCopy.click()
  await preview().getByRole('status').filter({ hasText: 'Não foi possível salvar.' }).waitFor()
  assert.equal(await bytes(), originalBytes)
  assert.equal(await preview().getByRole('textbox').inputValue(), custom)
  await addCopy.press('Enter')
  await preview().waitFor({ state: 'detached' }); await copy().waitFor()
  const imported = await saved(), record = imported.organization.compositions.find(c => c.name === custom)!
  assert.ok(record?.id.startsWith('composition:')); assert.deepEqual(record.portable, manifest.compositionTemplates![0]!.composition)
  for (const key of ['favorites', 'defaultComposition', 'bars', 'views'] as const) assert.deepEqual(imported.organization[key], original.organization[key])
  assert.deepEqual(imported.layout, original.layout)
  await copy().hover()
  assert.ok(await copy().getByRole('button', { name: 'Restaurar widgets de ' + custom }).isDisabled())
  await copy().getByRole('button', { name: 'Adicionar ' + custom + ' aos favoritos' }).click()
  await conclude()
  const personal = await saved()
  assert.ok(personal.organization.favorites.includes(record.id))
  await edit(); await library(); await page.getByRole('tab', { name: 'Composições Salvas' }).click()
  await copy().locator('button.layout-preset').press('Enter')
  await page.locator('[data-composition-card][data-editing-composition]').waitFor()
  await page.getByTestId('cancel-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const updated = structuredClone(manifest)
  updated.version = '1.1.0'; updated.compositionTemplates![0]!.composition.name = 'Modelo revisado'
  await writeFile(manifestPath, JSON.stringify(updated))
  await edit(); await library(); await models()
  assert.match(await template().innerText(), /Edição com anotações/)
  await page.getByRole('dialog', { name: 'Modelos de plugins' }).getByRole('button', { name: 'Fechar', exact: true }).first().click()
  await conclude(); await settings()
  // The package really changes in Main. Withhold its acknowledgement and the
  // first reconciliation read to exercise discovery against an uncertain inventory.
  await app!.evaluate(({ ipcMain }) => {
    type Handler = (...args: unknown[]) => Promise<{ ok: boolean }>
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const reload = handlers.get('plugins:reload')!, list = handlers.get('plugins:list')!
    handlers.set('plugins:reload', async (...args) => {
      handlers.set('plugins:reload', reload)
      const receipt = await reload(...args)
      if (!receipt.ok) return receipt
      handlers.set('plugins:list', async () => {
        handlers.set('plugins:list', list)
        return { ok: false, error: 'Leitura da lista interrompida.' }
      })
      throw new Error('Fixture dropped the accepted reload receipt')
    })
  })
  await plugin().getByRole('button', { name: 'Recarregar', exact: true }).click()
  const reconcile = page.getByRole('button', { name: 'Atualizar lista de plugins', exact: true })
  await reconcile.waitFor()
  await closeSettings(); await edit(); await library()
  assert.equal(await page.getByRole('button', { name: 'Modelos de plugins', exact: true }).count(), 0)
  await conclude(); await settings(); await reconcile.click()
  await reconcile.waitFor({ state: 'detached' })
  const second = await installed(); assert.ok(second && !second.enabled && second.revision === first.revision && second.generation !== first.generation)
  await closeSettings(); await edit(); await library(); await models(); await template().click()
  assert.match(await preview().innerText(), /1\.1\.0/); assert.match(await preview().getByRole('textbox').inputValue(), /Modelo revisado/)
  await preview().getByRole('button', { name: 'Cancelar', exact: true }).click(); await conclude()
  await settings(); await plugin().getByRole('button', { name: 'Remover', exact: true }).click()
  await plugin().waitFor({ state: 'detached' }); assert.equal(await installed(), undefined)
  await closeSettings(); assert.deepEqual((await saved()).organization.compositions, personal.organization.compositions)
  await close(); await launch()
  const restored = await saved()
  assert.deepEqual(restored.organization.compositions, personal.organization.compositions)
  assert.deepEqual(restored.organization.favorites, personal.organization.favorites)
  assert.equal(await installed(), undefined); assert.equal(workers, 0); assert.deepEqual(errors, [])
  console.log('PASS inert templates: disabled discovery, explicit independent copy, quota recovery, format, provider reload/removal, favorites and restart; DPR', scale125 ? 1.25 : 1)
} catch (error) {
  await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {})
  throw error
} finally {
  try { await close() } finally { await rm(temp, { recursive: true, force: true, maxRetries: 5 }) }
}
