import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { settle } from './freeform-smoke.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-header-plugins-'))
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), GEPPIO_TEST_USER_DATA: profile, NODE_ENV: 'production' }
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL
await mkdir('.local/diagnostics', { recursive: true })
const app = await electron.launch({ args: ['.'], env }), errors: string[] = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setContentSize(1920, 1080); window.show(); window.focus() })
  await page.getByTestId('edit-layout').waitFor(); await page.evaluate(() => localStorage.setItem('geppio.locale', 'pt-BR')); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await page.bringToFront()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  const record = (id: string) => manager.locator(`[data-plugin="${id}"]`)
  async function open() { if (!await manager.isVisible()) await page.getByRole('button', { name: 'Plugins', exact: true }).click(); await manager.waitFor(); await settle(page) }
  async function install(folder: string) {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, folder)
    await manager.getByRole('button', { name: 'Instalar pasta local', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.plugin-panel-footer button:last-child')!.disabled)
  }
  async function status(id: string, value: string) { await page.waitForFunction(({ id, value }) => document.querySelector(`.plugins-menu [data-plugin="${id}"]`)?.getAttribute('data-status') === value, { id, value }) }
  const notifications = page.getByRole('dialog', { name: 'Notificações', exact: true })
  async function openNotifications() { await page.locator('.notification-trigger').click(); await notifications.waitFor() }
  await openNotifications(); assert.equal(await notifications.locator('.notification-entry').count(), 0)
  await notifications.getByRole('button', { name: 'Fechar', exact: true }).click()
  await open(); await install(resolve('.local/plugin-packages/counter')); await status('local.counter', 'disabled')
  await install(resolve('.local/plugin-packages/pulse')); await status('local.pulse', 'disabled')
  assert.equal(await manager.locator('[data-plugin]').count(), 2); assert.equal(page.workers().length, 0)
  await record('local.counter').getByRole('switch').click(); await status('local.counter', 'active')
  await record('local.pulse').getByRole('switch').click(); await status('local.pulse', 'active')
  const workers = page.workers(); assert.equal(workers.length, 2)
  await manager.getByRole('button', { name: /^Ativos/ }).click()
  await manager.getByRole('searchbox', { name: 'Buscar plugins', exact: true }).fill('Pulso')
  assert.equal(await record('local.counter').isVisible(), false); assert.equal(await record('local.pulse').isVisible(), true)
  await manager.getByRole('searchbox', { name: 'Buscar plugins', exact: true }).fill('')
  await manager.getByRole('combobox', { name: 'Ordenar plugins', exact: true }).selectOption('name')
  // Fifty records are an ephemeral CSS fixture, never installations or runtime
  // inventory. The native installation cap remains 32 and is tested separately.
  const stress = await manager.evaluate(panel => {
    const list = panel.querySelector('.plugin-list')!, card = list.firstElementChild!, clones: Element[] = []
    for (let i = 2; i < 50; i++) { const clone = card.cloneNode(true) as HTMLElement; clone.removeAttribute('data-plugin'); clone.inert = true; list.append(clone); clones.push(clone) }
    const viewport = panel.querySelector<HTMLElement>('.plugin-viewport')!, header = panel.querySelector('.workspace-popover-heading')!, footer = panel.querySelector('.plugin-panel-footer')!
    const before = { header: header.getBoundingClientRect().top, footer: footer.getBoundingClientRect().bottom }
    viewport.scrollTop = viewport.scrollHeight
    const result = { overflow: viewport.scrollHeight > viewport.clientHeight, horizontal: viewport.scrollWidth <= viewport.clientWidth, scrolled: viewport.scrollTop > 0, header: header.getBoundingClientRect().top === before.header, footer: footer.getBoundingClientRect().bottom === before.footer }
    clones.forEach(clone => clone.remove()); viewport.scrollTop = 0; return result
  })
  assert.deepEqual(stress, { overflow: true, horizontal: true, scrolled: true, header: true, footer: true })
  await manager.getByRole('button', { name: 'Gerenciar widgets', exact: true }).click(); await settle(page)
  assert.equal(await page.locator('[data-catalog-type="plugin:local.counter:counter"]').count(), 1)
  assert.equal(await page.locator('[data-catalog-type^="plugin:local.pulse:"]').count(), 0, 'A real zero-widget plugin is absent only from the catalog')
  await page.locator('[data-catalog-type="plugin:local.counter:counter"]').click()
  await page.locator('.widget-browser-destination [data-widget-place="main"]').click()
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  await page.getByRole('button', { name: 'Incrementar', exact: true }).click(); await page.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor()
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('.widget-browser-item').filter({ has: page.locator('[data-catalog-type="plugin:local.counter:counter"]') }).getByRole('button', { name: 'Remover Contador do plugin da área Principal', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click(); await settle(page)
  assert.equal(page.workers().length, 2); assert.ok(workers.every(worker => page.workers().includes(worker)))
  await page.locator('[data-catalog-type="plugin:local.counter:counter"]').click(); await page.locator('.widget-browser-destination [data-widget-place="main"]').click()
  await page.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor()
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await open()
  await manager.getByRole('button', { name: /^Todos/ }).click()
  await record('local.counter').getByRole('switch').click(); await status('local.counter', 'disabled'); assert.equal(page.workers().length, 1)
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await settle(page)
  const paused = page.locator('[data-widget="plugin:local.counter:counter:view:main"]')
  assert.ok(await paused.isVisible()); await paused.getByText('Plugin desativado ou aguardando publicação.', { exact: true }).waitFor()
  await page.screenshot({ path: '.local/diagnostics/corrections-alpha13/plugin-paused.png' })
  await open()
  await record('local.counter').getByRole('switch').click(); await status('local.counter', 'active'); await page.getByText('Cliques nesta ativação: 0', { exact: true }).waitFor()
  const fault = join(profile, 'fault-package'); await mkdir(fault)
  await writeFile(join(fault, 'plugin.json'), JSON.stringify({ schemaVersion: 1, apiVersion: 1, id: 'test.header-fault', name: 'Header fault', version: '1.0.0', entry: 'entry.js', widgets: [] }))
  await writeFile(join(fault, 'entry.js'), 'export function activate() { throw new Error("header fault") }')
  await install(fault); await status('test.header-fault', 'disabled'); await record('test.header-fault').getByRole('switch').click(); await status('test.header-fault', 'error')
  await record('test.header-fault').getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await status('test.header-fault', 'error')
  await record('test.header-fault').getByRole('button', { name: 'Detalhes de Header fault', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Detalhes do plugin', exact: true })
  await details.getByRole('button', { name: 'Remover', exact: true }).click(); await details.waitFor({ state: 'detached' }); await open()
  assert.equal(await record('test.header-fault').count(), 0)
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await openNotifications()
  assert.ok(await notifications.locator('.notification-entry[data-unread="true"]').count() >= 6, 'Native lifecycle events supply real local notifications')
  const count = await notifications.locator('.notification-entry').count()
  assert.equal(Number(await page.locator('.notification-trigger .notification-badge').textContent()), count)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 720)); await settle(page)
  await notifications.evaluate(async panel => { await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => undefined))) })
  const notificationBounds = await notifications.boundingBox(); assert.ok(notificationBounds && notificationBounds.x >= 10.9 && notificationBounds.y >= 10.9 && notificationBounds.x + notificationBounds.width <= 989.1 && notificationBounds.y + notificationBounds.height <= 709.1, JSON.stringify(notificationBounds))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1080)); await settle(page)
  await page.screenshot({ path: '.local/diagnostics/corrections-alpha13/notifications.png' })
  await notifications.locator('.notification-entry > button:first-child').first().click()
  assert.equal(await notifications.locator('.notification-entry[data-unread="false"]').count(), 1)
  await notifications.locator('[data-notification-filter="unread"]').click(); assert.equal(await notifications.locator('.notification-entry').count(), count - 1)
  await notifications.getByRole('button', { name: 'Marcar todas como lidas', exact: true }).click()
  assert.equal(await notifications.locator('.notification-entry').count(), 0); assert.equal(await page.locator('.notification-badge').count(), 0)
  await notifications.locator('[data-notification-filter="all"]').click(); assert.equal(await notifications.locator('.notification-entry').count(), count)
  await notifications.locator('.notification-dismiss').first().click(); assert.equal(await notifications.locator('.notification-entry').count(), count - 1)
  await notifications.getByRole('button', { name: 'Limpar', exact: true }).click(); assert.equal(await notifications.locator('.notification-entry').count(), 0)
  await notifications.getByRole('button', { name: 'Fechar', exact: true }).click(); await open()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 720)); await settle(page)
  const bounds = await manager.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1001 && bounds.y + bounds.height <= 721)
  await page.screenshot({ path: '.local/diagnostics/header-plugins-narrow.png' })
  await page.emulateMedia({ reducedMotion: 'reduce' }); await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await settle(page)
  assert.deepEqual(errors, [])
  console.log('PASS header Plugins: native Counter/Pulse inventory, filters/sort, zero-widget catalog, shared Worker/content on presence removal, deliberate disable/reset, retry/remove error, narrow window and ephemeral 50-card CSS fixture')
} catch (error) { const page = await app.firstWindow(); console.error('Renderer errors:', errors); console.error('Frames:', await page.locator('.widget-frame').evaluateAll(nodes => nodes.map(node => ({ data: { ...(node as HTMLElement).dataset }, hidden: (node as HTMLElement).hidden, style: node.getAttribute('style'), text: node.textContent?.slice(0, 100) })))); await page.screenshot({ path: '.local/diagnostics/header-plugins-failure.png' }); throw error }
finally { await app.close(); assert.ok(dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('geppio-smoke-header-plugins-')); await rm(profile, { recursive: true, force: true }) }
