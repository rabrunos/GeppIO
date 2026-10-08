import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'
import type { Page } from 'playwright'
import { IDENTITY } from '../src/shared/identity.ts'
const temporary = await mkdtemp(join(tmpdir(), 'geppio-smoke-'))
await mkdir('.local/diagnostics', { recursive: true })
const env: Record<string, string> = {
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  GEPPIO_TEST_USER_DATA: temporary,
  NODE_ENV: 'production'
}
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
let devServer: import('vite').ViteDevServer | undefined
const errors: string[] = []
const consoleErrors: string[] = []
async function launch(): Promise<Page> {
  application = await electron.launch({ args: ['.'], cwd: process.cwd(), env, timeout: 30000 })
  const page = await application.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && consoleErrors.length < 30) consoleErrors.push(message.text().slice(0, 1024)) })
  await page.getByTestId('edit-layout').waitFor()
  const listings = await page.evaluate(() => Promise.all([window.geppio!.plugins.list(), window.geppio!.plugins.list()]))
  assert.ok(listings.every(result => result.ok), 'Concurrent startup inventory reads must succeed')
  return page
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Abrir configurações', exact: true }).click()
  await page.getByTestId('plugin-settings').waitFor()
  await page.getByRole('button', { name: 'Instalar pasta local', exact: true }).waitFor({ state: 'visible' })
}
async function install(page: Page, path: string) {
  await application!.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selected] })) as typeof dialog.showOpenDialog
  }, path)
  await page.getByRole('button', { name: 'Instalar pasta local', exact: true }).click()
}
async function status(page: Page, id: string, state: string) {
  if (state === 'active') {
    await page.waitForFunction(pluginId => ['active', 'error'].includes(document.querySelector(`[data-plugin="${pluginId}"]`)?.getAttribute('data-status') ?? ''), id)
    assert.equal(await page.locator(`[data-plugin="${id}"]`).getAttribute('data-status'), 'active')
  }
  await page.locator(`[data-plugin="${id}"][data-status="${state}"]`).waitFor()
}
async function faultPackage(id: string, source: string, override: Record<string, unknown> = {}) {
  const destination = join(temporary, 'fixtures', id); await mkdir(destination, { recursive: true })
  await writeFile(join(destination, 'plugin.json'), JSON.stringify({ schemaVersion: 1, apiVersion: 1, id, name: id, version: '1.0.0', entry: 'entry.js', widgets: [], ...override }))
  await writeFile(join(destination, 'entry.js'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText)
  return destination
}
try {
  if (process.argv.includes('--dev')) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    devServer = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false })
    await devServer.listen()
    env.NODE_ENV = 'development'; env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  let page = await launch()
  if (await page.locator('[data-widget]').count() !== 7) throw new Error('Expected seven main fixtures')
  for (const region of ['sidebar', 'main', 'bottom']) if (await page.locator(`[data-region="${region}"]`).count() !== 1) throw new Error('Missing region: ' + region)
  const privileged = await page.evaluate(() => ({ require: 'require' in window, process: 'process' in window, bridge: Object.keys(window.geppio ?? {}) }))
  if (privileged.require || privileged.process || privileged.bridge.some(key => !['name', 'version', 'platform', 'plugins'].includes(key))) throw new Error('Unexpected privileged renderer surface')
  assert.deepEqual(await page.evaluate(() => Object.keys(window.geppio!.plugins).sort()), ['install', 'list', 'remove', 'setEnabled'])
  await page.getByTestId('edit-layout').click()
  const initial = await page.locator('[data-widget="chart"]').evaluate(element => { const style = (element as HTMLElement).style; return [style.left, style.top, style.width, style.height] })
  const grip = page.getByRole('button', { name: 'Mover Ritmo', exact: true }); await grip.focus(); await page.keyboard.press('ArrowRight')
  await page.getByTestId('cancel-layout').click()
  await page.waitForFunction(expected => {
    const element = document.querySelector<HTMLElement>('[data-widget="chart"]')
    if (!element) return false
    const style = element.style
    return JSON.stringify([style.left, style.top, style.width, style.height]) === JSON.stringify(expected)
  }, initial)
  await page.getByTestId('edit-layout').click(); await page.getByTestId('save-layout').click()
  const saved = await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey)
  if (!saved) throw new Error('No saved layout')
  await page.getByRole('button', { name: 'Abrir painel', exact: true }).click()
  await page.getByTestId('test-panel').waitFor()
  await page.getByRole('button', { name: 'Recolher painel', exact: true }).click()
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
  if (await page.locator('.workbench').getAttribute('data-theme') !== 'light') throw new Error('Theme change failed')
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  if (await page.locator('.workbench').getAttribute('data-theme') !== 'light') throw new Error('Theme did not persist')
  await page.screenshot({ path: '.local/diagnostics/desktop-smoke.png' })
  await settings(page)
  await install(page, resolve('.local/plugin-packages/counter')); await status(page, 'local.counter', 'disabled')
  assert.equal(await page.locator('[data-plugin-widget]').count(), 0)
  await install(page, resolve('.local/plugin-packages/pulse')); await status(page, 'local.pulse', 'disabled')
  await install(page, resolve('.local/plugin-packages/counter'))
  await page.getByText('Já existe um plugin com esse ID.', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-plugin]').count(), 2)
  const counter = () => page.locator('[data-plugin="local.counter"]')
  const pulse = () => page.locator('[data-plugin="local.pulse"]')
  await counter().getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, 'local.counter', 'active')
  await pulse().getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, 'local.pulse', 'active')
  await pulse().locator('p[role="status"]').filter({ hasText: /^Pulso \d+/ }).waitFor()
  assert.equal(await page.locator('[data-plugin-widget]').count(), 1)
  const workerBoundary = await page.workers()[0]!.evaluate(() => ({ require: typeof require, process: typeof process, document: typeof document, bridge: 'geppio' in globalThis }))
  assert.deepEqual(workerBoundary, { require: 'undefined', process: 'undefined', document: 'undefined', bridge: false })
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Incrementar', exact: true }).click()
  await page.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor()
  for (let cycle = 0; cycle < 3; cycle++) {
    await settings(page)
    await counter().getByRole('button', { name: 'Desativar', exact: true }).click(); await status(page, 'local.counter', 'disabled')
    assert.equal(await page.locator('[data-plugin-widget]').count(), 0)
    await counter().getByText('dispose concluído; Worker encerrado.', { exact: true }).first().waitFor()
    await counter().getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, 'local.counter', 'active')
    await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
    await page.getByText('Cliques nesta ativação: 0', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Incrementar', exact: true }).click(); await page.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor()
  }
  // New process, same disposable profile: packages and preferences, not core recompilation.
  await application!.close(); page = await launch(); await settings(page)
  await status(page, 'local.counter', 'active'); await status(page, 'local.pulse', 'active')
  await page.getByText('Cliques nesta ativação: 0', { exact: true }).waitFor()
  await counter().getByRole('button', { name: 'Desativar', exact: true }).click(); await status(page, 'local.counter', 'disabled')
  await application!.close(); page = await launch(); await settings(page)
  await status(page, 'local.counter', 'disabled'); await status(page, 'local.pulse', 'active')
  assert.equal(await page.locator('[data-plugin-widget]').count(), 0)
  const invalid = await faultPackage('test.invalid', 'export function activate() { return { dispose() {} } }', { entry: '../escape.js' })
  await install(page, invalid); await page.getByText('Manifesto inválido ou API incompatível.', { exact: true }).waitFor()
  const missing = await faultPackage('test.missing', 'export function activate() { return { dispose() {} } }')
  await rm(join(missing, 'entry.js')); await install(page, missing); await page.getByText('Módulo de entrada não encontrado.', { exact: true }).waitFor()
  const faults = [
    ['test.throw', 'export function activate() { throw new Error("activation fault") }'],
    ['test.import', 'import "./absent.js"; export function activate() { return { dispose() {} } }'],
    ['test.widget', 'export function activate(ctx) { ctx.publishWidget("undeclared", { text: "x" }); return { dispose() {} } }'],
    ['test.shape', 'export function activate() { return {} }'],
    ['test.background', 'export function activate() { setTimeout(() => { throw new Error("background fault") }, 20); return { dispose() {} } }'],
    ['test.rejection', 'export function activate() { setTimeout(() => { void Promise.reject(new Error("background rejection")) }, 20); return { dispose() {} } }'],
    ['test.hang', 'export function activate() { while (true) {} }']
  ] as const
  for (const [id, source] of faults) {
    await install(page, await faultPackage(id, source)); await status(page, id, 'disabled')
    await page.locator(`[data-plugin="${id}"]`).getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, id, 'error')
    await status(page, 'local.pulse', 'active')
    await page.locator(`[data-plugin="${id}"]`).getByRole('button', { name: 'Desativar', exact: true }).click(); await status(page, id, 'disabled')
    await page.locator(`[data-plugin="${id}"]`).getByRole('button', { name: 'Remover', exact: true }).click(); await page.locator(`[data-plugin="${id}"]`).waitFor({ state: 'detached' })
  }
  const actionFault = await faultPackage('test.action', 'export function activate(ctx) { ctx.publishWidget("action", { text: "Teste de falha", action: { id: "fail", label: "Falhar ação" } }); return { onAction() { throw new Error("action fault") }, dispose() {} } }', { widgets: [{ id: 'action', title: 'Ação de teste', surface: 'declarative' }] })
  await install(page, actionFault); await status(page, 'test.action', 'disabled')
  await page.locator('[data-plugin="test.action"]').getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, 'test.action', 'active')
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Falhar ação', exact: true }).click(); await settings(page); await status(page, 'test.action', 'error')
  assert.equal(await page.locator('[data-plugin-widget="test.action:action"]').count(), 0)
  await status(page, 'local.pulse', 'active')
  await page.locator('[data-plugin="test.action"]').getByRole('button', { name: 'Remover', exact: true }).click(); await page.locator('[data-plugin="test.action"]').waitFor({ state: 'detached' })
  const disposal = await faultPackage('test.dispose', 'export function activate() { return { dispose() { throw new Error("dispose fault") } } }')
  await install(page, disposal); await status(page, 'test.dispose', 'disabled')
  await page.locator('[data-plugin="test.dispose"]').getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, 'test.dispose', 'active')
  await page.locator('[data-plugin="test.dispose"]').getByRole('button', { name: 'Desativar', exact: true }).click(); await status(page, 'test.dispose', 'disabled')
  await page.getByText('Falha: dispose fault', { exact: true }).first().waitFor()
  await page.locator('[data-plugin="test.dispose"]').getByRole('button', { name: 'Remover', exact: true }).click(); await page.locator('[data-plugin="test.dispose"]').waitFor({ state: 'detached' })
  await pulse().getByRole('button', { name: 'Desativar', exact: true }).click(); await status(page, 'local.pulse', 'disabled')
  await pulse().getByText('Eventos desta sessão', { exact: true }).click()
  await pulse().getByText('Pulso descartado; timer liberado.', { exact: true }).waitFor()
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settings(page)
  await status(page, 'local.pulse', 'disabled'); await status(page, 'local.counter', 'disabled')
  assert.equal(page.workers().length, 0)
  await pulse().getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, 'local.pulse', 'active')
  await counter().getByRole('button', { name: 'Ativar', exact: true }).click(); await status(page, 'local.counter', 'active')
  await page.screenshot({ path: '.local/diagnostics/plugins-smoke.png' })
  await page.keyboard.press('Escape'); await page.getByTestId('plugin-settings').waitFor({ state: 'detached' })
  await page.screenshot({ path: '.local/diagnostics/plugin-widget-light.png' })
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
  await page.screenshot({ path: '.local/diagnostics/plugin-widget-dark.png' })
  await settings(page); await page.screenshot({ path: '.local/diagnostics/plugins-dark.png' })
  await counter().getByRole('button', { name: 'Remover', exact: true }).click(); await counter().waitFor({ state: 'detached' })
  await pulse().getByRole('button', { name: 'Remover', exact: true }).click(); await pulse().waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-plugin-widget]').count(), 0)
  await application!.close(); page = await launch(); await settings(page)
  await page.getByText('Nenhum plugin instalado.', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-plugin]').count(), 0)
  const badIPC = await page.evaluate(() => window.geppio!.plugins.setEnabled('../escape', true))
  assert.equal(badIPC.ok, false)
  await page.keyboard.press('Escape'); await page.getByTestId('plugin-settings').waitFor({ state: 'detached' })
  await page.getByTestId('edit-layout').click(); await settings(page); await page.keyboard.press('Escape')
  await page.getByTestId('plugin-settings').waitFor({ state: 'detached' }); await page.getByTestId('cancel-layout').click()
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(JSON.stringify({ result: 'passed', mode: devServer ? 'development renderer / built Main' : 'built production preview', platform: process.platform, checks: ['regions', 'fixtures', 'renderer and Worker boundary', 'concurrent inventory reads', 'cancel edit', 'save', 'panel', 'theme', 'reload', 'independent package installation', 'duplicate ID', 'widget actions', 'zero-widget pulse', 'repeated lifecycle', 'full process restart', 'enabled/disabled persistence', 'bad manifest and missing entry', 'activation/import/contribution/instance/action/disposal/background/rejection failures', 'infinite-loop timeout', 'removal persistence', 'invalid IPC ID', 'Settings Escape preserves layout edit'] }, null, 2))
  console.log('Process metrics after plugin removal (observed sample, not a plugin performance budget):')
  console.log(JSON.stringify(await application!.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ type: metric.type, cpu: metric.cpu, memory: metric.memory }))), null, 2))
} catch (error) {
  if (application) {
    const page = await application.firstWindow()
    await page.screenshot({ path: '.local/diagnostics/desktop-failure.png' })
    console.error('Plugin failure state:', await page.locator('[data-plugin]').allTextContents())
    await writeFile('.local/diagnostics/desktop-console-errors.json', JSON.stringify(consoleErrors, null, 2))
  }
  throw error
} finally { if (application) await application.close(); if (devServer) await devServer.close(); await rm(temporary, { recursive: true, force: true }) }
