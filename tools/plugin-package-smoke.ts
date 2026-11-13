import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { inspectPackage, PluginStore } from '../src/main/plugins.ts'
import { readPackageSnapshot, verifyPluginPackage } from '../src/main/plugin-package.ts'
import { publicIdentity, signPluginPackage } from './plugin-package.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { emptyModel, document as modelDocument } from '../examples/plugins/workspace-essentials/src/model.ts'
import type { PluginInventory } from '../src/shared/plugins.ts'

// Only this test builds an isolated host with injected temporary PUBLIC trust. The normal build
// has no test-key switch, reads no trust environment/profile and must reject the same package.
const { privateKey } = generateKeyPairSync('ed25519'), id = 'geppio.workspace-essentials'
const roots = [{ ...publicIdentity(privateKey), pluginId: id, publisher: 'Disposable test publisher', revoked: false }]
const [option, officialPath, ...extra] = process.argv.slice(2)
if (option !== undefined && (option !== '--official-package' || !officialPath || extra.length)) throw new Error('Usage: plugin-package-smoke.ts [--official-package <owner-signed.gpp>]')
const official = officialPath ? verifyPluginPackage(await readPackageSnapshot(resolve(officialPath))) : null
await mkdir('.local', { recursive: true })
const host = await mkdtemp(resolve('.local/plugin-package-host-')), packageFile = join(host, 'essentials.gpp')
const diagnostics = resolve('.local/diagnostics', official ? 'plugin-package-official' : 'plugin-package')
await mkdir(diagnostics, { recursive: true })
await writeFile(packageFile, signPluginPackage(await inspectPackage('.local/plugin-packages/workspace-essentials'), privateKey))
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const profiles: string[] = [], evidence: Record<string, string> = {}, errors: string[] = []
async function profile(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'geppio-smoke-package-')); profiles.push(path); return path }
async function launch(root: string, production = false) {
  app = await electron.launch({ args: [production || official ? '.' : join(host, 'main/index.cjs')], env: { ...env, GEPPIO_TEST_USER_DATA: root, GEPPIO_TEST_PLUGIN_TRUST: JSON.stringify(roots) } })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1920, 1080); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
}
async function close() { await app?.close(); app = undefined }
async function inventory(): Promise<PluginInventory> { return page.evaluate(async () => { const value = await window.geppio!.plugins.list(); if (!value.ok) throw new Error(value.error); return value.value }) }
async function picker(canceled = false, response = 1, reload = false) {
  await app!.evaluate(({ dialog }, options) => {
    dialog.showOpenDialog = async () => ({ canceled: options.canceled, filePaths: options.canceled ? [] : [options.path] })
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const win = args[0] as import('electron').BrowserWindow, value = args[1] as { detail: string; message: string }
      ;(globalThis as { packagePreview?: unknown }).packagePreview = { owner: win.id, detail: value.detail, message: value.message }
      if (options.reload) win.webContents.reload()
      return { response: options.response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, { path: packageFile, canceled, response, reload })
}
async function openSettings() {
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
}
async function installFile() {
  await page.getByRole('button', { name: 'Instalar arquivo assinado', exact: true }).click()
  await page.waitForFunction(() => { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Instalar arquivo assinado'); return button && !button.disabled })
}
async function toggle(enabled: boolean) {
  const result = await page.evaluate(({ id, enabled }) => window.geppio!.plugins.setEnabled(id, enabled), { id, enabled })
  assert.ok(result.ok)
  // Reload the actual renderer inventory/runtime after using the fixed bridge operation.
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
}
const widget = (name: string) => page.locator(`[data-plugin-widget="${id}:${name}"]`)
async function placeFour() {
  await page.getByTestId('edit-layout').click(); await settle(page)
  for (const name of ['notes', 'scratch', 'checklist', 'prompts']) {
    await page.locator(`[data-catalog-type="plugin:${id}:${name}"]`).click()
    await page.locator('.widget-browser-destination [data-widget-place="main"]').click(); await settle(page)
  }
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
}
async function content() {
  await widget('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).waitFor()
  assert.equal(await widget('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).inputValue(), 'Nota confirmada antes da adoção')
  assert.equal(await widget('scratch').getByRole('textbox', { name: 'Texto do rascunho', exact: true }).inputValue(), 'Rascunho confirmado')
  assert.equal(await widget('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true }).inputValue(), 'Prompt confirmado')
  assert.equal(await widget('checklist').getByRole('checkbox', { name: 'Item confirmado', exact: true }).isChecked(), true)
}
try {
  const productionProfile = await profile()
  await launch(productionProfile, true); await picker(); await openSettings(); await installFile()
  assert.equal((await inventory()).plugins.length, 0)
  assert.ok(await page.getByText('Publicador desconhecido, revogado ou fora do escopo autorizado.', { exact: true }).count())
  assert.equal(await app!.evaluate(() => (globalThis as { packagePreview?: unknown }).packagePreview), undefined)
  assert.equal((await readFile('out/main/index.cjs', 'utf8')).includes(roots[0]!.publicKey), false)
  evidence.productionRejectsTemporaryKey = 'passed: actual production build, including ignored trust environment input'
  await close()

  if (official) {
    assert.equal(official.manifest.id, id)
    await cp(resolve(officialPath!), packageFile)
    evidence.officialPublisher = `passed: normal production build, pinned owner key ${official.keyId}`
  } else {
    await build({ configFile: false, logLevel: 'error', plugins: [{ name: 'disposable-public-trust-only', load(path) { if (path.replaceAll('\\', '/').endsWith('/src/main/plugin-trust.ts')) return `export const PLUGIN_TRUST = Object.freeze(${JSON.stringify(roots)});` } }], build: { target: 'node24', ssr: true, outDir: join(host, 'main'), emptyOutDir: true, lib: { entry: resolve('src/main/index.ts'), formats: ['cjs'], fileName: () => 'index.cjs' }, rollupOptions: { external: ['electron', /^node:/] } } })
    await cp('out/preload', join(host, 'preload'), { recursive: true }); await cp('out/renderer', join(host, 'renderer'), { recursive: true })
  }

  const fresh = await profile(); await launch(fresh); await openSettings()
  for (const canceled of [true, false]) {
    await picker(canceled, 0); await installFile(); assert.equal((await inventory()).plugins.length, 0)
  }
  evidence.nativeCancelAndDeny = 'passed: native picker/confirmation responses controlled by Playwright'
  await picker(false, 1, true)
  await page.getByRole('button', { name: 'Instalar arquivo assinado', exact: true }).click()
  await page.getByTestId('edit-layout').waitFor(); await settle(page)
  assert.equal((await inventory()).plugins.length, 0)
  evidence.expiredWindowConfirmation = 'passed: actual navigation during confirmation'
  await openSettings(); await picker(); await installFile()
  assert.equal((await inventory()).plugins[0]!.enabled, false)
  await page.getByRole('button', { name: 'Ativar', exact: true }).click()
  await page.waitForFunction(id => document.querySelector(`[data-plugin="${id}"]`)?.getAttribute('data-status') === 'active', id)
  assert.equal(await page.locator('.widget-frame').count(), 0)
  const freshPreview = await app!.evaluate(() => (globalThis as { packagePreview?: { detail: string } }).packagePreview)
  assert.match(freshPreview!.detail, /Nova instalação/); assert.match(freshPreview!.detail, /Nenhum novo acesso/)
  assert.ok(freshPreview!.detail.includes(official?.publisher ?? roots[0]!.publisher))
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click(); await settle(page)
  await placeFour()
  await close(); await launch(fresh)
  assert.equal((await inventory()).plugins[0]!.enabled, true)
  await widget('scratch').getByRole('textbox', { name: 'Texto do rascunho', exact: true }).waitFor()
  assert.equal(await page.locator('[data-plugin-widget]').count(), 4)
  assert.ok(await widget('notes').getByRole('button', { name: 'Nova anotação', exact: true }).isEnabled())
  assert.ok(await widget('prompts').getByRole('button', { name: 'Novo prompt', exact: true }).isEnabled())
  assert.ok(await widget('checklist').getByRole('textbox', { name: 'Novo item', exact: true }).isEnabled())
  evidence.freshDisabledExplicitEnable = 'passed: Settings file action, no automatic placement, four explicit placements and restart'
  await close()

  for (const enabled of [true, false]) {
    const root = await profile()
    // Seed the actual alpha.34 managed-copy format before starting the new host.
    const original = (await new PluginStore(join(root, 'GeppIO', 'plugins')).install(resolve('.local/plugin-packages/workspace-essentials'))).plugins[0]!
    await launch(root)
    await toggle(true)
    const model = emptyModel(), note = 'item.' + randomUUID(), prompt = 'item.' + randomUUID()
    model.notes = [{ id: note, title: 'Nota retida', body: 'Nota confirmada antes da adoção' }]; model.selectedNote = note
    model.prompts = [{ id: prompt, title: 'Prompt retido', body: 'Prompt confirmado' }]; model.selectedPrompt = prompt
    model.scratch = 'Rascunho confirmado'; model.checklist = [{ id: 'item.' + randomUUID(), text: 'Item confirmado', done: true }]
    const written = await page.evaluate(async ({ id, installation, documentText }) => {
      const channel = await window.geppio!.pluginData.begin(id, installation); if (!channel.ok) throw new Error(channel.error)
      const read = await window.geppio!.pluginData.read(channel.value); if (!read.ok) throw new Error(read.error)
      const write = await window.geppio!.pluginData.write(channel.value, read.value.revision, JSON.parse(documentText))
      await window.geppio!.pluginData.end(channel.value); return write.ok
    }, { id, installation: original.revision, documentText: JSON.stringify(modelDocument(model)) }); assert.ok(written)
    await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    await placeFour()
    await content()
    if (!enabled) await toggle(false)
    const layout = await page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
    assert.ok(layout)
    const dataPath = join(root, 'GeppIO', 'plugin-data', original.revision + '.json'), confirmed = await readFile(dataPath)
    const statePath = join(root, 'GeppIO', 'plugins', 'state.json')
    const oldState = JSON.parse(await readFile(statePath, 'utf8')) as { plugins: Record<string, object> }
    assert.deepEqual(Object.keys(oldState.plugins[id]!).sort(), ['enabled', 'revision'], 'alpha.33-compatible preference')
    const workers = page.workers()
    await page.locator('.widget-frame').evaluateAll(nodes => nodes.forEach(node => node.setAttribute('data-adoption-mounted', 'retained')))
    await openSettings(); await picker(); await installFile()
    const adopted = (await inventory()).plugins[0]!
    assert.deepEqual(adopted, { ...original, enabled, source: 'signed' })
    assert.equal(await page.evaluate(() => localStorage.getItem('geppio:workbench:v1')), layout)
    assert.deepEqual(await readFile(dataPath), confirmed)
    assert.equal(await page.locator('.widget-frame[data-adoption-mounted="retained"]').count(), 4)
    assert.deepEqual(page.workers(), workers, 'Byte-identical adoption does not replace active Workers')
    const preview = await app!.evaluate(() => (globalThis as { packagePreview?: { owner: number; detail: string; message: string } }).packagePreview)
    assert.match(preview!.detail, /Adotar instalação existente/); assert.match(preview!.message, /Workspace Essentials.*1.0.0/)
    assert.equal(preview!.owner, await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id))
    await close(); await launch(root)
    assert.deepEqual((await inventory()).plugins[0], adopted)
    assert.equal(await page.evaluate(() => localStorage.getItem('geppio:workbench:v1')), layout)
    assert.deepEqual(await readFile(dataPath), confirmed)
    if (!enabled) await toggle(true)
    await content()
    const stale = await page.evaluate(async ({ id, revision }) => window.geppio!.pluginData.begin(id, revision), { id, revision: original.revision }); assert.ok(stale.ok)
    await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    assert.equal((await page.evaluate(token => window.geppio!.pluginData.read(token), stale.value)).ok, false)
    evidence[enabled ? 'enabledAdoption' : 'disabledAdoption'] = 'passed: real four widgets, exact data/layout/UUID/enablement, retained mounts/Workers, restart and stale-channel denial'
    await close()
  }
  assert.deepEqual(errors, [])
  await writeFile(join(diagnostics, 'result.json'), JSON.stringify({ status: 'passed', evidence, ownerManual: 'not_run', officialKey: official ? { status: 'passed', keyId: official.keyId } : 'not_exercised: injected temporary root; use --official-package for the owner-signed demonstration' }, null, 2))
  console.log(JSON.stringify({ status: 'passed', evidence }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => undefined)
  await writeFile(join(diagnostics, 'failure.txt'), error instanceof Error ? error.stack ?? error.message : String(error))
  throw error
} finally {
  await close()
  for (const root of profiles) await rm(root, { recursive: true, force: true })
  // host is a newly generated child of the verified workspace .local directory.
  assert.ok(host.startsWith(resolve('.local') + '\\') || host.startsWith(resolve('.local') + '/'))
  await rm(host, { recursive: true, force: true })
}
