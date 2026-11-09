import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, rm, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { IDENTITY } from '../src/shared/identity.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-essentials-'))
const diagnostics = '.local/diagnostics/workspace-essentials-alpha21'
await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], evidence: Record<string, string> = {}
const id = 'geppio.workspace-essentials'
const widget = (name: string) => page.locator(`[data-plugin-widget="${id}:${name}"]`)
const manager = () => page.getByRole('dialog', { name: 'Plugins', exact: true })
async function launch() {
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setContentSize(1920, 1080); window.show(); window.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
}
async function openManager() { await page.getByRole('button', { name: 'Plugins', exact: true }).click(); await manager().waitFor() }
async function closeManager() { await manager().getByRole('button', { name: 'Fechar', exact: true }).click(); await settle(page) }
async function status(plugin: string, value: string) { await page.waitForFunction(({ plugin, value }) => document.querySelector(`[data-plugin="${plugin}"]`)?.getAttribute('data-status') === value, { plugin, value }) }
async function install(folder: string, plugin: string) {
  await app!.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, resolve(folder))
  await manager().getByRole('button', { name: 'Instalar pasta local', exact: true }).click(); await status(plugin, 'disabled')
  await manager().locator(`[data-plugin="${plugin}"]`).getByRole('switch').click(); await status(plugin, 'active')
}
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function place(name: string) {
  await page.locator(`[data-catalog-type="plugin:${id}:${name}"]`).click()
  assert.equal(await page.locator('.widget-browser-destination [data-widget-place="sidebar"]').isEnabled(), false)
  await page.locator('.widget-browser-destination [data-widget-place="main"]').click(); await settle(page)
}
async function saved(name: string) { await widget(name).getByRole('status').filter({ hasText: /^Salvo\.$/ }).waitFor() }
async function fill(name: string, label: string, value: string) {
  await widget(name).getByRole('textbox', { name: label, exact: true }).fill(value)
  // Wait for the actual confirmed disk acknowledgement, never a fixed autosave delay.
  await page.waitForFunction(({ name, value }) => {
    const element = document.querySelector(`[data-plugin-widget="geppio.workspace-essentials:${name}"]`)
    return element && !element.textContent?.includes('Alterações pendentes') && element.querySelector('[role="status"]')?.textContent === 'Salvo.' && [...element.querySelectorAll('input,textarea')].some(input => (input as HTMLInputElement).value === value)
  }, { name, value })
}
const note = 'Nota literal <script>não executar</script> á\nsegunda linha'
const scratch = 'Rascunho confirmado á\ntexto selecionável'
const prompt = 'Explique <b>literal</b> e preserve o contexto.\nSem serviço remoto.'
async function compare() {
  await saved('notes'); await saved('scratch'); await saved('prompts'); await saved('checklist')
  assert.equal(await widget('notes').getByRole('textbox', { name: 'Título', exact: true }).inputValue(), 'Nota dois')
  assert.equal(await widget('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).inputValue(), 'Segunda nota')
  await widget('notes').getByRole('button', { name: 'Nota um', exact: true }).click(); await saved('notes')
  assert.equal(await widget('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).inputValue(), note)
  await widget('notes').getByRole('button', { name: 'Nota dois', exact: true }).click(); await saved('notes')
  assert.equal(await widget('scratch').getByRole('textbox').inputValue(), scratch)
  assert.equal(await widget('prompts').getByRole('textbox', { name: 'Título', exact: true }).inputValue(), 'Prompt piloto')
  assert.equal(await widget('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true }).inputValue(), prompt)
  assert.deepEqual(await widget('checklist').locator('.plugin-check-item').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, checked: node.querySelector('input')!.checked }))), [{ text: 'Primeiro item', checked: true }, { text: 'Segundo item', checked: false }])
  assert.equal(await page.locator('.host-plugin-content script,.host-plugin-content b').count(), 0)
}
try {
  await launch()
  assert.equal(await page.locator('.widget-frame').count(), 0); assert.equal(await page.evaluate(() => window.geppio!.demoFixtures), false)
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Configurações', exact: true })
  await settings.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
  await app!.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, resolve('.local/plugin-packages/workspace-essentials'))
  await settings.getByRole('button', { name: 'Instalar pasta local', exact: true }).click(); await status(id, 'disabled')
  await settings.locator(`[data-plugin="${id}"]`).getByRole('button', { name: 'Ativar', exact: true }).click(); await status(id, 'active')
  await settings.getByRole('button', { name: 'Fechar configurações', exact: true }).click(); await settle(page)
  evidence.settingsInstallEnable = 'passed'
  await openManager()
  await install('.local/plugin-packages/counter', 'local.counter'); await install('.local/plugin-packages/pulse', 'local.pulse'); await closeManager()
  const stale = await page.evaluate(async id => {
    const inventory = await window.geppio!.plugins.list(); if (!inventory.ok) throw new Error(inventory.error)
    const installed = inventory.value.plugins.find(plugin => plugin.manifest.id === id)!
    return window.geppio!.pluginData.begin(id, installed.revision)
  }, id)
  assert.ok(stale.ok)
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  assert.equal((await page.evaluate(token => window.geppio!.pluginData.read(token), stale.value)).ok, false, 'Navigation revokes the prior native channel')
  assert.deepEqual(await page.evaluate(() => ({ node: 'process' in window || 'require' in window, dataMethods: Object.keys(window.geppio!.pluginData).sort() })), { node: false, dataMethods: ['begin', 'end', 'read', 'write'] })
  for (const worker of page.workers()) assert.deepEqual(await worker.evaluate(() => ({ node: typeof process, bridge: 'geppio' in globalThis, dom: typeof document })), { node: 'undefined', bridge: false, dom: 'undefined' })
  evidence.reloadRevocation = 'passed'
  assert.equal(await page.locator('.widget-frame').count(), 0, 'Enable does not auto-place widgets')
  await page.getByTestId('edit-layout').click(); await settle(page)
  for (const name of ['notes', 'scratch', 'checklist', 'prompts']) await place(name)
  await page.locator('[data-catalog-type="plugin:local.counter:counter"]').click(); await page.locator('.widget-browser-destination [data-widget-place="main"]').click(); await conclude()
  await page.getByRole('button', { name: 'Incrementar', exact: true }).click(); await page.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor(); evidence.legacyV1 = 'passed'
  await widget('notes').getByRole('button', { name: 'Nova anotação', exact: true }).click(); await saved('notes')
  await fill('notes', 'Título', 'Nota um'); await fill('notes', 'Texto da anotação', note)
  await widget('notes').getByRole('button', { name: 'Nova anotação', exact: true }).click(); await saved('notes')
  await fill('notes', 'Título', 'Nota dois'); await fill('notes', 'Texto da anotação', 'Segunda nota')
  await fill('scratch', 'Texto do rascunho', scratch)
  for (const text of ['Primeiro item', 'Segundo item']) { await fill('checklist', 'Novo item', text); await widget('checklist').getByRole('button', { name: 'Adicionar item', exact: true }).click(); await saved('checklist') }
  await widget('checklist').getByRole('checkbox', { name: 'Primeiro item', exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:checklist"] .plugin-check-item input')?.checked === true && document.querySelector('[data-plugin-widget="geppio.workspace-essentials:checklist"] p')?.textContent === 'Salvo.')
  for (const checked of [false, true, false, true]) {
    await widget('checklist').getByRole('checkbox', { name: 'Primeiro item', exact: true }).click()
    await page.waitForFunction(checked => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:checklist"] .plugin-check-item input')?.checked === checked && document.querySelector('[data-plugin-widget="geppio.workspace-essentials:checklist"] p')?.textContent === 'Salvo.', checked)
  }
  evidence.actionBurst = 'passed'
  await widget('prompts').getByRole('button', { name: 'Novo prompt', exact: true }).click(); await saved('prompts')
  await fill('prompts', 'Título', 'Prompt piloto'); await fill('prompts', 'Texto do prompt', prompt)
  const priorField = await widget('prompts').getByRole('textbox', { name: 'Título', exact: true }).getAttribute('value')
  assert.equal(priorField, 'Prompt piloto')
  await widget('prompts').getByRole('button', { name: 'Novo prompt', exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:prompts"] input[aria-label="Título"]')?.value === 'Novo prompt')
  await fill('prompts', 'Título', 'Segundo prompt'); await fill('prompts', 'Texto do prompt', 'Outra instrução salva')
  await widget('prompts').getByRole('button', { name: 'Prompt piloto', exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:prompts"] input[aria-label="Título"]')?.value === 'Prompt piloto')
  await saved('prompts'); evidence.multiplePrompts = 'passed'
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard)
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (text: string) => { (window as Window & { smokeCopyAttempt?: string }).smokeCopyAttempt = text; return write(text) } })
  })
  async function copyOutcome() {
    const feedback = widget('prompts').getByRole('status').last()
    await page.waitForFunction(() => { const value = document.querySelector('[data-plugin-widget="geppio.workspace-essentials:prompts"] .plugin-surface-v2 > small')?.textContent; return value === 'Prompt copiado.' || value?.startsWith('Não foi possível copiar.') })
    return (await feedback.textContent()) === 'Prompt copiado.'
  }
  await widget('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true }).fill('Edição imediata antes de copiar')
  await widget('prompts').getByRole('button', { name: 'Copiar prompt', exact: true }).click()
  const immediate = await copyOutcome()
  assert.equal(await page.evaluate(() => (window as Window & { smokeCopyAttempt?: string }).smokeCopyAttempt), 'Edição imediata antes de copiar', 'Host copy uses current draft before Worker acknowledgement')
  if (immediate) assert.equal(await app!.evaluate(({ clipboard }) => clipboard.readText()), 'Edição imediata antes de copiar')
  evidence.immediateDraftCopy = 'passed: actual attempted text verified; permission policy unchanged'
  await fill('prompts', 'Texto do prompt', prompt)
  await widget('prompts').getByRole('button', { name: 'Copiar prompt', exact: true }).click()
  const copied = await copyOutcome()
  if (copied) { assert.equal((await app!.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'), prompt); evidence.clipboardButton = 'passed' }
  else {
    evidence.clipboardButton = 'blocked: existing browser permission policy; failure feedback passed'
    const field = widget('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true })
    await field.focus(); await field.press('Control+A'); await field.press('Control+C')
    assert.equal((await app!.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'), prompt); evidence.clipboardManual = 'passed: real selected text copied through keyboard'
  }
  // Exercise denied access at the host browser API, retaining the real global deny policy.
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError') } }) })
  await widget('prompts').getByRole('button', { name: 'Copiar prompt', exact: true }).click()
  await widget('prompts').getByText('Não foi possível copiar. Selecione o texto e copie manualmente.', { exact: true }).waitFor(); evidence.clipboardFailure = 'passed'
  await compare(); evidence.fourRealEdits = 'passed'
  await app!.close(); app = undefined; await launch(); await compare(); evidence.restart = 'passed'
  await page.getByText('Cliques nesta ativação: 0', { exact: true }).waitFor()
  await openManager(); await manager().locator(`[data-plugin="${id}"]`).getByRole('switch').click(); await status(id, 'disabled'); await closeManager()
  assert.equal(await page.locator(`[data-widget-id^="plugin:${id}:"]`).count(), 4)
  await openManager(); await manager().locator(`[data-plugin="${id}"]`).getByRole('switch').click(); await status(id, 'active'); await closeManager(); await compare(); evidence.disableReenable = 'passed'
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('.widget-browser-item').filter({ has: page.locator(`[data-catalog-type="plugin:${id}:notes"]`) }).getByRole('button', { name: 'Remover Anotações da área Principal', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click(); await settle(page); await place('notes'); await conclude(); await compare(); evidence.viewRemoval = 'passed'
  const dataRoot = join(profile, IDENTITY.directory, 'plugin-data'), files = await readdir(dataRoot)
  assert.equal(files.length, 1)
  const dataPath = join(dataRoot, files[0]!), backup = dataPath + '.backup', confirmed = await readFile(dataPath, 'utf8')
  // An unavailable destination in this disposable profile forces a real native storage failure.
  await rename(dataPath, backup); await mkdir(dataPath)
  const pending = 'Texto pendente que deve continuar disponível'
  await widget('scratch').getByRole('textbox').fill(pending)
  await widget('scratch').getByRole('status').filter({ hasText: /^Falha ao salvar\./ }).waitFor()
  assert.equal(await widget('scratch').getByRole('textbox').inputValue(), pending)
  assert.equal(await readFile(backup, 'utf8'), confirmed)
  assert.equal(dirname(dataPath), dataRoot); await rm(dataPath, { recursive: true }); await rename(backup, dataPath)
  await widget('scratch').getByRole('button', { name: 'Tentar salvar novamente', exact: true }).click(); await saved('scratch')
  assert.ok((await readFile(dataPath, 'utf8')).includes(pending)); evidence.failureDraftRetry = 'passed'
  await fill('scratch', 'Texto do rascunho', scratch)
  await app!.close(); app = undefined; await launch(); await compare()
  await page.screenshot({ path: diagnostics + '/four-widgets.png' })
  assert.deepEqual(errors, [])
  await writeFile(diagnostics + '/result.json', JSON.stringify(evidence, null, 2))
  console.log('PASS Workspace Essentials:', JSON.stringify(evidence))
} catch (error) {
  if (app) { await page.screenshot({ path: diagnostics + '/failure.png' }).catch(() => {}); await writeFile(diagnostics + '/failure.txt', String(error) + '\n' + errors.join('\n')) }
  await writeFile(diagnostics + '/result.json', JSON.stringify({ ...evidence, failure: String(error) }, null, 2)); throw error
} finally {
  await app?.close()
  assert.ok(dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('geppio-smoke-essentials-'))
  await rm(profile, { recursive: true, force: true })
}
