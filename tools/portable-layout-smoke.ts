import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { PluginStore } from '../src/geppio/src/main/plugins.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import type { WorkbenchSnapshot } from '../src/geppio/src/shared/workbench/model.ts'
import { parsePortableText } from '../src/geppio/src/shared/workbench/portable.ts'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'
import { electron } from './test-electron.ts'

const scale125 = process.argv.includes('--scale125'), native = process.argv.includes('--native-dialogs')
if (native && process.env.GEPPIO_TEST_VISIBLE !== '1') throw new Error('Native picker walkthrough requires explicit visible testing')
const source = await mkdtemp(join(tmpdir(), 'geppio-smoke-layout-source-'))
const destination = await mkdtemp(join(tmpdir(), 'geppio-smoke-layout-destination-'))
const exported = join(await realpath(source), 'roundtrip.geppio-layout.json'), documentPath = join(destination, 'fixture.txt')
const signalDir = resolve('.local/diagnostics/portable-picker'), signal = join(signalDir, 'pending.json')
const essentials = 'geppio.workspace-essentials', sourceName = 'Áreas de estudo', copyName = 'Minha composição'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = []
async function launch(profile: string) {
  const env = { ...process.env, GEPPIO_TEST_USER_DATA: profile, NODE_ENV: 'production' }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete (env as NodeJS.ProcessEnv)[key]
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await app.firstWindow(); page.setDefaultTimeout(native ? 120000 : 15000)
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(1900, 1120); w.show(); w.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
}
async function close() {
  if (!app) return
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {})
  await app.close(); app = undefined
}
async function pick(operation: 'import' | 'export' | 'fixture', path: string) {
  if (native && operation !== 'fixture') {
    await mkdir(signalDir, { recursive: true })
    const pid = await app!.evaluate(() => process.pid)
    await writeFile(signal, JSON.stringify({ pid, operation, path }))
    return
  }
  await app!.evaluate(({ dialog }, { operation, path }) => {
    if (operation === 'export') {
      const original = dialog.showSaveDialog
      dialog.showSaveDialog = async () => { dialog.showSaveDialog = original; return { canceled: false, filePath: path } }
    } else {
      const original = dialog.showOpenDialog
      dialog.showOpenDialog = async () => { dialog.showOpenDialog = original; return { canceled: false, filePaths: [path] } }
    }
  }, { operation, path })
}
async function edit() {
  await page.getByTestId('edit-layout').click(); await settle(page)
  const toggle = page.locator('.widget-catalog-toggle')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}
async function conclude() {
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
}
async function add(type: string, region: 'main' | 'bottom') {
  await page.getByRole('tab', { name: 'Widgets', exact: true }).click()
  await page.locator(`[data-catalog-type="${type}"]`).click()
  await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
}
const group = () => page.locator('.widget-frame[data-group-host]')
const frame = (widget: string) => page.locator('.widget-frame').filter({ has: page.locator(`[data-plugin-widget="${essentials}:${widget}"]`) })
const library = () => page.getByRole('tab', { name: 'Composições', exact: true }).click()
const saved = () => page.getByRole('tab', { name: 'Composições Salvas', exact: true }).click()
const card = (name: string) => page.locator('[data-composition-card]').filter({ has: page.locator('.composition-name', { hasText: name }) })
async function raw() {
  const bytes = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  assert.ok(bytes)
  return JSON.parse(bytes) as { organization: WorkbenchSnapshot['organization']; layout: WorkbenchSnapshot }
}
async function inventory() {
  const list = await page.evaluate(() => window.geppio!.plugins.list())
  assert.ok(list.ok); return list.value.plugins
}
async function installEssentials() {
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await enableDeveloperMode(manager)
  await pick('fixture', resolve('.local/plugin-packages/workspace-essentials'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  const plugin = manager.locator(`[data-plugin="${essentials}"]`)
  await plugin.getByRole('switch').click()
  await manager.locator(`[data-plugin="${essentials}"][data-status=active]`).waitFor()
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
}
try {
  const store = new PluginStore(join(source, 'GeppIO/plugins'))
  await store.install(resolve('.local/plugin-packages/workspace-essentials')); await store.setEnabled(essentials, true)
  await launch(source)
  const boundary = await app!.evaluate(async ({ BrowserWindow, ipcMain, dialog }) => {
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, senderFrame = sender.mainFrame
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<{ ok: boolean; recipe?: unknown }>> })._invokeHandlers
    const read = handlers.get('portable-layout:import')!, write = handlers.get('portable-layout:export')!
    const open = dialog.showOpenDialog, save = dialog.showSaveDialog
    let opens = 0, saves = 0
    dialog.showOpenDialog = async () => { opens++; return { canceled: true, filePaths: [] } }
    dialog.showSaveDialog = async () => { saves++; return { canceled: true, filePath: '' } }
    try {
      const event = { sender, senderFrame }
      const refused = [await read({ sender: {}, senderFrame }), await read({ sender, senderFrame: { url: senderFrame.url } }),
        await read({ sender, senderFrame: { url: 'https://example.invalid' } }), await read(event, 'unrequested-path'),
        await write(event, 'unrequested-path'), await write(event, '{}', 'unexpected')]
      const canceled = await read(event)
      return { refused: refused.every(r => !r.ok), canceled: canceled.ok && canceled.recipe === null, opens, saves }
    } finally { dialog.showOpenDialog = open; dialog.showSaveDialog = save }
  })
  assert.deepEqual(boundary, { refused: true, canceled: true, opens: 1, saves: 0 })
  const provider = (await inventory()).find(p => p.manifest.id === essentials)!
  await edit()
  for (const widget of ['notes', 'checklist']) await add('plugin:' + essentials + ':' + widget, 'main')
  await add('host:terminal', 'bottom')
  await conclude()
  const note = frame('notes')
  await note.getByRole('button', { name: 'Nova anotação' }).click()
  await note.getByRole('textbox', { name: 'Texto da anotação' }).fill('private-source-note')
  await note.getByRole('textbox', { name: 'Texto da anotação' }).blur()
  await note.locator('[role=status]').filter({ hasText: 'Salvo.' }).waitFor()
  await edit()
  await page.locator('.widget-catalog-toggle').click(); await settle(page)
  await frame('checklist').locator('.group-source-handle').click()
  await frame('notes').locator('[data-group-target][data-group-allowed=true]').click()
  await group().getByRole('tab', { name: 'Checklist', exact: true }).waitFor()
  await conclude(); await edit(); await library()
  await page.getByRole('button', { name: 'Salvar atual', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Salvar nova composição' })
  await form.getByRole('textbox', { name: 'Nome' }).fill(sourceName)
  await form.getByRole('checkbox', { name: 'Barra inferior' }).check()
  await form.getByRole('button', { name: 'Salvar composição', exact: true }).click()
  await form.waitFor({ state: 'detached' }); await saved()
  const sourceState = await raw()
  await card(sourceName).hover(); await card(sourceName).getByRole('button', { name: 'Opções de ' + sourceName }).click()
  await pick('export', exported)
  await page.getByRole('menuitem', { name: /Exportar composição/ }).click()
  await page.waitForFunction(() => document.body.textContent?.includes('Composição exportada'), undefined, { timeout: native ? 120000 : 15000 })
  const bytes = await readFile(exported, 'utf8'), recipe = parsePortableText(bytes)
  assert.equal(recipe.name, sourceName)
  assert.equal(recipe.groups.length, 1)
  assert.ok(recipe.placements.some(p => p.region === 'bottom'))
  for (const secret of ['private-source-note', exported, source, provider.revision, ...sourceState.organization.views.flatMap(v => [v.id, v.modelId])])
    assert.ok(!bytes.includes(secret), 'Export leaked a source identity or private content')
  await close()

  const other = new PluginStore(join(destination, 'GeppIO/plugins'))
  await other.install(resolve('.local/plugin-packages/counter')); await other.setEnabled('local.counter', true)
  await writeFile(documentPath, 'confirmed destination')
  await launch(destination)
  const experience = (name: string) => page.locator('.experience-switch').getByRole('button', { name, exact: true }).click()
  await experience('GeppIO Code')
  await pick('fixture', await realpath(documentPath)); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  await page.getByRole('tab', { name: /fixture\.txt/ }).waitFor()
  const editor = fileEditor(page)
  await editor.fill('private-destination-draft')
  const model = await page.locator('.monaco-host').evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel())
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  await page.locator('[data-terminal-phase=running]').waitFor()
  const ptyId = await page.locator('[data-terminal-phase=running]').getAttribute('data-terminal-id')
  const workers = pluginWorkers(page); assert.equal(workers.length, 1)
  await experience('Bancada de Trabalho'); await edit(); await add('host:terminal', 'bottom'); await conclude()
  const before = await raw()
  await edit(); await library()
  await pick('import', exported); await page.getByRole('button', { name: /Importar composição…/ }).click()
  const preview = page.getByRole('dialog', { name: 'Importar composição', exact: true })
  await preview.waitFor(); assert.deepEqual(await raw(), before)
  await preview.getByRole('textbox', { name: 'Nome da composição' }).fill(copyName)
  await preview.getByRole('button', { name: 'Importar como nova composição' }).click()
  await preview.waitFor({ state: 'detached' }); await saved()
  const imported = await raw(), record = imported.organization.compositions.find(item => item.name === copyName)!
  assert.ok(record && !sourceState.organization.compositions.some(item => item.id === record.id))
  assert.deepEqual(imported.layout, before.layout)
  assert.deepEqual(imported.organization.favorites, before.organization.favorites)
  assert.equal(imported.organization.defaultComposition, before.organization.defaultComposition)
  assert.deepEqual(imported.organization.bars, before.organization.bars)
  assert.deepEqual(imported.organization.views, before.organization.views)
  await conclude(); await experience('GeppIO Code')
  assert.equal(await editor.inputValue(), 'private-destination-draft')
  assert.equal(await page.locator('.monaco-host').evaluate((node, m) => (node as MonacoHost).monacoEditor!.getModel() === m, model), true)
  assert.equal(await page.locator('[data-terminal-phase=running]').getAttribute('data-terminal-id'), ptyId)
  assert.deepEqual(pluginWorkers(page), workers)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'confirmed destination'); await model.dispose()
  await close(); await launch(destination)
  assert.deepEqual((await raw()).organization.compositions, imported.organization.compositions)
  await edit(); await library(); await saved()
  const copy = card(copyName)
  const restore = copy.getByRole('button', { name: 'Restaurar widgets de ' + copyName })
  assert.equal(await restore.isDisabled(), true)
  assert.ok(await restore.getAttribute('title'))
  await copy.hover(); await copy.locator('.composition-restore-button').filter({ hasText: 'Formato' }).click()
  await settle(page)
  assert.equal(await copy.getAttribute('data-editing-composition'), '')
  await page.getByTestId('cancel-layout').click(); await page.getByTestId('edit-layout').waitFor()
  await installEssentials()
  assert.notEqual((await inventory()).find(p => p.manifest.id === essentials)!.revision, provider.revision)
  await edit(); await library(); await saved()
  assert.equal(await restore.isDisabled(), true)
  await page.getByTestId('cancel-layout').click(); await page.getByTestId('edit-layout').waitFor()
  await edit(); await add('plugin:' + essentials + ':notes', 'main'); await add('plugin:' + essentials + ':checklist', 'main')
  await conclude()
  await edit(); await library(); await saved(); await copy.hover()
  await copy.getByRole('button', { name: 'Restaurar widgets de ' + copyName }).click()
  await group().getByRole('tab', { name: 'Checklist', exact: true }).waitFor()
  await conclude()
  assert.equal((await raw()).organization.groups?.entries.length, 1)
  assert.deepEqual(errors, [])
  console.log('PASS portable layouts: two profiles, grouped public references, preview, independent import, session preservation, restart and explicit application; DPR', scale125 ? 1.25 : 1)
} finally {
  try { await close() } finally {
    if (native) await rm(signal, { force: true })
    for (const profile of [source, destination]) await rm(profile, { recursive: true, force: true, maxRetries: 5 })
  }
}
