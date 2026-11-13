import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { PluginStore, inspectPackage, packageDigest } from '../src/main/plugins.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { emptyModel, document as modelDocument } from '../examples/plugins/workspace-essentials/src/model.ts'

const root = await mkdtemp(join(tmpdir(), 'geppio-smoke-dev-')), source = join(root, 'built-essentials')
await cp(resolve('.local/plugin-packages/workspace-essentials'), source, { recursive: true })
const diagnostics = resolve('.local/diagnostics/plugin-dev'); await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.NODE_ENV = 'production'
const id = 'geppio.workspace-essentials', evidence: Record<string, string> = {}, errors: string[] = []
let app: ElectronApplication | undefined, page!: Page
const widget = (name: string) => page.locator(`[data-plugin-widget="${id}:${name}"]`)
async function launch(profile: string) {
  await mkdir(profile, { recursive: true })
  app = await electron.launch({ args: ['.'], timeout: 15000, env: { ...env, GEPPIO_TEST_USER_DATA: profile } })
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1920, 1080); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
}
async function close() { await app?.close(); app = undefined }
async function settings() {
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
}
async function closeSettings() { await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click(); await settle(page) }
async function inventory() { const result = await page.evaluate(() => window.geppio!.plugins.list()); assert.ok(result.ok); return result.value }
async function installed(): Promise<InstalledPlugin> { return (await inventory()).plugins.find(item => item.manifest.id === id)! }
async function picker(path = source, canceled = false) { await app!.evaluate(({ dialog }, options) => { dialog.showOpenDialog = async () => ({ canceled: options.canceled, filePaths: options.canceled ? [] : [options.path] }) }, { path, canceled }) }
async function click(name: string) {
  console.log('Developer smoke action:', name)
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="Modo desenvolvedor"]')?.disabled === false)
}
async function state(status: string) { await page.locator(`[data-plugin="${id}"][data-status="${status}"]`).waitFor() }
async function mode(enabled: boolean) { console.log('Developer smoke mode:', enabled); const control = page.getByRole('switch', { name: 'Modo desenvolvedor', exact: true }); if (await control.isChecked() !== enabled) await control.click(); await page.waitForFunction(enabled => document.querySelector<HTMLInputElement>('[aria-label="Modo desenvolvedor"]')?.checked === enabled && !document.querySelector<HTMLInputElement>('[aria-label="Modo desenvolvedor"]')?.disabled, enabled) }
async function place() {
  await page.getByTestId('edit-layout').click(); await settle(page)
  for (const name of ['notes', 'scratch', 'checklist', 'prompts']) {
    await page.locator(`[data-catalog-type="plugin:${id}:${name}"]`).click()
    await page.locator('.widget-browser-destination [data-widget-place="main"]').click(); await settle(page)
  }
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
}
const layout = () => page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
const scratch = () => widget('scratch').getByRole('textbox', { name: 'Texto do rascunho', exact: true })
async function savedText(text: string) { await page.waitForFunction(text => { const widget = document.querySelector('[data-plugin-widget="geppio.workspace-essentials:scratch"]'); return document.querySelector<HTMLTextAreaElement>('[aria-label="Texto do rascunho"]')?.value === text && widget?.querySelector('p[role="status"]')?.textContent === 'Salvo.' && !widget.textContent?.includes('Alterações pendentes') }, text) }
try {
  const profile = join(root, 'profile'); await launch(profile); await settings()
  assert.equal(await page.getByRole('switch', { name: 'Modo desenvolvedor' }).isChecked(), false)
  assert.equal(await page.getByRole('button', { name: 'Carregar pasta local', exact: true }).count(), 0)
  assert.ok(await page.getByRole('button', { name: 'Instalar arquivo assinado', exact: true }).isEnabled())
  await picker()
  assert.equal((await page.evaluate(() => window.geppio!.plugins.install())).ok, false, 'Main gate is independent of hidden UI')
  assert.equal((await page.evaluate(id => window.geppio!.plugins.reload(id), id)).ok, false)
  await mode(true); await picker(source, true); await click('Carregar pasta local'); assert.equal((await inventory()).plugins.length, 0)
  await picker(); await click('Carregar pasta local'); await state('disabled')
  const first = await installed(); assert.equal(first.source, 'external'); assert.equal(first.enabled, false)
  assert.equal(JSON.stringify(await inventory()).includes(source), false)
  assert.deepEqual(await readdir(join(profile, 'GeppIO/plugins/packages')), [])
  await click('Ativar'); await state('active'); await closeSettings(); assert.equal(await page.locator('.widget-frame').count(), 0)
  await place(); await scratch().fill('Confirmed before reload'); await savedText('Confirmed before reload')
  const beforeLayout = await layout(), dataPath = join(profile, 'GeppIO/plugin-data', first.revision + '.json'), data = await readFile(dataPath)
  const sourceEntry = join(source, first.manifest.entry), code = await readFile(sourceEntry, 'utf8')
  const token = await page.evaluate(async item => window.geppio!.pluginData.begin(item.manifest.id, item.revision, item.generation), first); assert.ok(token.ok)
  // Restore the UI runtime token after the direct broker check deliberately superseded it.
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await savedText('Confirmed before reload')
  await writeFile(sourceEntry, code + '\n// rebuilt generation two\n')
  await inventory(); assert.equal((await installed()).generation, first.generation)
  assert.equal(await page.evaluate(() => window.geppio!.plugins.setEnabled('geppio.workspace-essentials', true).then(result => result.ok)), false)
  await settings(); let workers = 0; page.on('worker', () => { workers++ })
  const existingWorkers = page.workers()
  await click('Recarregar'); await state('active'); assert.equal(workers, 1)
  assert.notDeepEqual(page.workers(), existingWorkers); const second = await installed()
  assert.equal(second.revision, first.revision); assert.notEqual(second.generation, first.generation)
  assert.equal(await layout(), beforeLayout); assert.deepEqual(await readFile(dataPath), data)
  assert.equal((await page.evaluate(token => window.geppio!.pluginData.read(token), token.value)).ok, false)
  await closeSettings(); await savedText('Confirmed before reload')
  // A not-yet-submitted checklist item must defer lifecycle mutation.
  await widget('checklist').getByRole('textbox', { name: 'Novo item', exact: true }).fill('Keep draft')
  await settings(); await click('Recarregar'); assert.equal((await installed()).generation, second.generation)
  await page.getByText(/Há edições pendentes ou falha ao salvar/).waitFor(); await closeSettings()
  assert.equal(await widget('checklist').getByRole('textbox', { name: 'Novo item', exact: true }).inputValue(), 'Keep draft')
  await widget('checklist').getByRole('textbox', { name: 'Novo item', exact: true }).fill('')
  // Rebuild validation failure keeps the same live Worker, generation, data and layout.
  await writeFile(join(source, 'plugin.json'), '{invalid')
  await settings(); const previousWorkers = page.workers(); await click('Recarregar')
  assert.deepEqual(page.workers(), previousWorkers); assert.equal((await installed()).generation, second.generation)
  await cp(resolve('.local/plugin-packages/workspace-essentials/plugin.json'), join(source, 'plugin.json'))
  await closeSettings()
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  // Delay only the state switch in this disposable Main process. No product fault switch exists.
  await app!.evaluate(() => {
    const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises'), original = fs.rename
    const state = globalThis as { devCommitArrived?: boolean; releaseDevCommit?: () => void }
    fs.rename = async (from, to) => {
      if (String(to).endsWith('state.json')) { state.devCommitArrived = true; await new Promise<void>(resolve => { state.releaseDevCommit = resolve }) }
      return original(from, to)
    }
    ;(globalThis as { restoreDevRename?: () => void }).restoreDevRename = () => { fs.rename = original }
  })
  const popover = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await popover.getByRole('switch', { name: 'Modo desenvolvedor', exact: true }).click()
  await app!.evaluate(async () => { const until = Date.now() + 5000; while (!(globalThis as { devCommitArrived?: boolean }).devCommitArrived) { if (Date.now() > until) throw new Error('State commit did not arrive'); await new Promise(resolve => setTimeout(resolve, 10)) } })
  await popover.getByRole('button', { name: 'Fechar', exact: true }).click()
  assert.equal(await scratch().evaluate(node => (node as HTMLTextAreaElement).readOnly), true)
  await scratch().focus(); await page.keyboard.type('must not enter'); assert.equal(await scratch().inputValue(), 'Confirmed before reload')
  await app!.evaluate(() => { (globalThis as { restoreDevRename?: () => void }).restoreDevRename!(); (globalThis as { releaseDevCommit?: () => void }).releaseDevCommit!() })
  await settings(); await state('disabled'); assert.equal((await installed()).desiredEnabled, true); assert.equal(page.workers().length, 0)
  await mode(true); await state('active'); assert.equal((await installed()).generation, second.generation)
  // Same-value requests must not revoke a live runtime channel.
  assert.ok((await page.evaluate(() => window.geppio!.plugins.setDeveloperMode(true))).ok)
  await closeSettings(); await scratch().fill('Confirmed after resume'); await savedText('Confirmed after resume')
  await settings(); await click('Desativar'); await state('disabled')
  await writeFile(sourceEntry, code + '\n// disabled rebuild\n'); await click('Recarregar'); await state('disabled')
  assert.equal((await installed()).desiredEnabled, false); await click('Ativar'); await state('active')
  // Accepted executable failure differs from rejected validation; fixing it remains possible.
  await writeFile(sourceEntry, code + '\nthrow new Error("Controlled accepted activation failure")\n')
  await click('Recarregar'); await state('error'); const failed = await installed(); assert.equal(failed.enabled, true)
  await click('Tentar novamente'); await state('error')
  await writeFile(sourceEntry, code); await click('Recarregar'); await state('active')
  assert.notEqual((await installed()).generation, failed.generation)
  await closeSettings(); await savedText('Confirmed after resume'); assert.equal(await layout(), beforeLayout)
  evidence.freshReload = 'passed: Settings, native cancel, Main off gate, fresh disabled, four placements, one Worker replacement, exact UUID/data/layout, stale channel, draft defer, delayed Main commit + dismissed popover/background edit lock, validation rejection, mode toggle, disabled reload, activation failure/retry/fix'
  await close(); await launch(profile); await savedText('Confirmed after resume'); assert.equal(await layout(), beforeLayout)
  await close(); await writeFile(sourceEntry, code + '\n// unaccepted restart bytes\n'); await launch(profile); await settings(); await state('disabled')
  assert.match((await installed()).unavailable!, /Recarregar/); assert.equal(page.workers().length, 0)
  await click('Recarregar'); await state('active'); await closeSettings(); await savedText('Confirmed after resume')
  await close(); await rename(source, source + '-missing'); await launch(profile); await settings(); await state('disabled')
  assert.match((await installed()).unavailable!, /Fonte ausente/); await rename(source + '-missing', source)
  await click('Recarregar'); await state('active')
  await picker(resolve('.local/plugin-packages/counter')); await click('Carregar pasta local')
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 720)); await settle(page)
  const overflowingActions = await page.locator('.host-development-settings .plugin-list > li').evaluateAll(nodes => nodes.flatMap(node => {
    const card = node.getBoundingClientRect()
    return [...node.querySelectorAll('.plugin-actions button')].filter(button => { const box = button.getBoundingClientRect(); return box.left < card.left || box.right > card.right + 1 }).map(button => button.textContent)
  }))
  assert.deepEqual(overflowingActions, [], 'Narrow Settings actions wrap within their own card')
  await page.locator('[data-plugin="local.counter"]').getByRole('button', { name: 'Remover', exact: true }).click()
  await page.locator('[data-plugin="local.counter"]').waitFor({ state: 'detached' })
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1080)); await settle(page)
  const digest = packageDigest(await inspectPackage(source)); await click('Remover'); assert.equal((await inventory()).plugins.length, 0)
  assert.equal(packageDigest(await inspectPackage(source)), digest); await close()
  evidence.restartRemoval = 'passed: exact layout/data restart, changed/missing source unavailable without fallback, explicit recovery, narrow Settings with two plugin action rows contained, source bytes retained on unregister'
  for (const enabled of [false, true]) {
    const legacyProfile = join(root, 'legacy-' + enabled), legacySource = join(root, 'legacy-source-' + enabled)
    await cp(resolve('.local/plugin-packages/workspace-essentials'), legacySource, { recursive: true })
    const store = new PluginStore(join(legacyProfile, 'GeppIO/plugins')), legacy = (await store.install(legacySource)).plugins[0]!
    await store.setEnabled(id, true); const channel = await store.beginData(1, id, legacy.revision)
    const model = emptyModel(); model.scratch = 'Legacy confirmed'
    await store.dataOperation(1, channel, 'write', 0, modelDocument(model))
    const legacyData = await readFile(join(legacyProfile, 'GeppIO/plugin-data', legacy.revision + '.json'))
    await launch(legacyProfile); await place(); await savedText('Legacy confirmed')
    const legacyLayout = await layout()
    await page.locator('.widget-frame').evaluateAll(nodes => nodes.forEach(node => node.setAttribute('data-link-mounted', 'retained')))
    await settings(); if (!enabled) { await click('Desativar'); await state('disabled') }
    await mode(true)
    await picker(legacySource, true); await click('Vincular pasta original'); assert.equal((await installed()).source, 'legacy')
    await writeFile(join(legacySource, 'extra.js'), '// mismatch'); await picker(legacySource); await click('Vincular pasta original')
    assert.equal((await installed()).source, 'legacy'); await rm(join(legacySource, 'extra.js'))
    await picker(legacySource); const workersBeforeLink = page.workers(); await click('Vincular pasta original')
    const linked = await installed(); assert.equal(linked.revision, legacy.revision); assert.equal(linked.enabled, enabled); assert.equal(linked.source, 'external')
    assert.deepEqual(page.workers(), workersBeforeLink)
    assert.equal(await layout(), legacyLayout); assert.equal(await page.locator('.widget-frame[data-link-mounted="retained"]').count(), 4)
    assert.deepEqual(await readFile(join(legacyProfile, 'GeppIO/plugin-data', legacy.revision + '.json')), legacyData)
    assert.ok(await readFile(join(legacyProfile, 'GeppIO/plugins/packages', id, 'entry.js')))
    await close(); await launch(legacyProfile); assert.deepEqual(await installed(), linked); assert.equal(await layout(), legacyLayout)
    if (enabled) await savedText('Legacy confirmed')
    assert.deepEqual(await readFile(join(legacyProfile, 'GeppIO/plugin-data', legacy.revision + '.json')), legacyData)
    await close()
  }
  evidence.legacy = 'passed: real alpha.34-format managed copies; enabled/disabled, cancel/mismatch, byte-identical link, exact UUID/data/layout, four retained mounted frames, unchanged Worker, recovery copy and restart'
  assert.deepEqual(errors, [])
  await writeFile(join(diagnostics, 'result.json'), JSON.stringify({ status: 'passed', evidence, ownerManual: 'not_run' }, null, 2))
  console.log(JSON.stringify({ status: 'passed', evidence }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => undefined)
  await writeFile(join(diagnostics, 'failure.txt'), String(error)); throw error
} finally {
  await close()
  assert.equal(dirname(root), resolve(tmpdir())); assert.ok(basename(root).startsWith('geppio-smoke-dev-'))
  await rm(root, { recursive: true, force: true })
}
