import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { PluginStore } from '../src/geppio/src/main/plugins.ts'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import type { QuickOpenResult } from '../src/geppio/src/shared/quick-open.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { initializeGit, gitFingerprint } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { electron } from './test-electron.ts'

interface InventoryProbe {
  starts: number; job: string; id: string; opening: boolean
  releaseStatus(): void; releaseOpen(): void
}
type Probe = typeof globalThis & { inventoryProbe: InventoryProbe }
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-quick-open-'))
const scaled = process.argv.includes('--scale125')
let app: ElectronApplication | undefined
try {
  const base = await realpath(profile), project = join(base, 'first'), replacement = join(base, 'second')
  await initializeGit(project); await mkdir(replacement)
  const original = 'const answer = 2;\r\n', draft = 'const dirty = 64;\n'
  await writeFile(join(project, 'modified.ts'), original)
  await mkdir(join(project, 'nested')); await writeFile(join(project, 'nested', 'Árvore.md'), 'disposable tree\n')
  await writeFile(join(project, 'suffix-árvore.txt'), 'fixture')
  await mkdir(join(project, 'árvore')); await writeFile(join(project, 'árvore', 'path.txt'), 'fixture')
  await mkdir(join(project, 'vendor')); await writeFile(join(project, 'vendor', 'árvore.txt'), 'excluded')
  const before = await gitFingerprint(project)
  const plugins = new PluginStore(join(profile, 'GeppIO/plugins'))
  await plugins.install(resolve('.local/plugin-packages/counter')); await plugins.setEnabled('local.counter', true)
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[name]
  app = await electron.launch({ args: ['.', ...(scaled ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(), errors: string[] = []
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setContentSize(1440, 940); win.show(); win.focus()
    let releaseStatus!: () => void, releaseOpen!: () => void
    const statusGate = new Promise<void>(resolve => { releaseStatus = resolve })
    const openGate = new Promise<void>(resolve => { releaseOpen = resolve })
    const probe: InventoryProbe = (globalThis as Probe).inventoryProbe = { starts: 0, job: '', id: '', opening: false, releaseStatus, releaseOpen }
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    const status = handlers.get('git:status')!
    handlers.set('git:status', async (...args) => { const reply = await status(...args); await statusGate; return reply })
    const open = handlers.get('quick-open:open')!
    handlers.set('quick-open:open', async (...args) => {
      const reply = await open(...args); probe.opening = true; await openGate; return reply
    })
    for (const action of ['start', 'read']) {
      const channel = 'quick-open:' + action, invoke = handlers.get(channel)!
      handlers.set(channel, async (...args) => {
        if (action === 'start') probe.starts++
        const result = await invoke(...args) as QuickOpenResult
        if (result.ok && result.value.items.length) { probe.job = result.value.job; probe.id = result.value.items[0]!.id }
        return result
      })
    }
  })
  const probe = () => app!.evaluate(() => {
    const { starts, job, id } = (globalThis as Probe).inventoryProbe
    return { starts, job, id }
  })
  const pick = async (path: string, action: string) => {
    await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
    await page.getByRole('button', { name: 'Projeto local', exact: true }).click()
    await page.getByRole('button', { name: action, exact: true }).click()
  }
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scaled ? 1.25 : 1)
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="plugin:local.counter:counter"]').click()
  await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const workers = pluginWorkers(page); assert.equal(workers.length, 1)
  await page.locator('.experience-switch').getByRole('button', { name: 'GeppIO Code', exact: true }).click()
  await pick(project, 'Abrir projeto')
  await page.getByRole('treeitem', { name: 'modified.ts', exact: true }).press('Enter')
  const editor = fileEditor(page), host = page.locator('.monaco-host')
  await editor.fill(draft)
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  const grant = await page.locator('.file-editor').getAttribute('data-document-id'); assert.ok(grant)
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  const terminal = page.locator('[data-terminal-phase="running"]'); await terminal.waitFor()
  const terminalId = await terminal.getAttribute('data-terminal-id'); assert.ok(terminalId)
  const launch = page.getByRole('button', { name: 'Abrir arquivo do projeto...', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Abrir arquivo do projeto', exact: true })
  const field = dialog.getByRole('textbox', { name: 'Nome ou caminho relativo' })
  await terminal.locator('.xterm-helper-textarea').press('Control+p')
  assert.equal(await dialog.count(), 0)

  const side = page.locator('.editor-explorer-panel')
  await page.getByRole('button', { name: 'Alterações Git', exact: true }).click()
  await side.getByRole('button', { name: 'Abrir Git em janela' }).press('Enter')
  const git = page.locator('[data-floating-view="git-changes"]'); await git.waitFor()
  await page.getByRole('button', { name: 'Busca no projeto', exact: true }).click()
  const content = side.getByRole('textbox', { name: 'Texto a buscar' })
  await content.fill('answer'); await content.press('Enter')
  await side.getByRole('button', { name: 'Abrir busca em janela' }).press('Enter')
  const search = page.locator('[data-floating-view="project-search"]')
  const match = search.getByRole('button', { name: /Abrir modified\.ts, linha 1/ }); await match.waitFor()
  const layout = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  const baseline = await layout(); assert.ok(baseline)
  await git.getByRole('status').filter({ hasText: 'Consultando Git' }).waitFor()
  await launch.press('Enter'); await field.waitFor()
  await app.evaluate(() => (globalThis as Probe).inventoryProbe.releaseStatus())
  assert.ok(await field.evaluate(el => el === document.activeElement)); assert.equal((await probe()).starts, 0)
  await field.fill('ÁRVORE')
  await dialog.getByRole('status').filter({ hasText: '3 arquivos' }).waitFor()
  assert.deepEqual(await dialog.getByRole('list').getByRole('button').allTextContents(),
    ['nested/Árvore.md', 'suffix-árvore.txt', 'árvore/path.txt'])
  await field.fill('modified')
  await dialog.getByRole('button', { name: 'modified.ts', exact: true }).waitFor()
  const first = await probe(); assert.equal(first.starts, 1)
  await field.press('ArrowDown')
  const selected = dialog.getByRole('button', { name: 'modified.ts', exact: true })
  assert.ok(await selected.evaluate(el => el === document.activeElement))
  await selected.press('Enter')
  await app.evaluate(async () => {
    const deadline = Date.now() + 10000
    while (!(globalThis as Probe).inventoryProbe.opening) {
      if (Date.now() >= deadline) throw new Error('No native Quick Open selection reached the response gate')
      await new Promise(resolve => setTimeout(resolve, 15))
    }
  })
  await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible())
  await app.evaluate(() => (globalThis as Probe).inventoryProbe.releaseOpen())
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => (document.querySelector('.monaco-host') as MonacoHost)?.monacoEditor?.hasTextFocus())
  assert.equal(await editor.inputValue(), draft)
  assert.equal(await page.locator('.file-editor').getAttribute('data-document-id'), grant)
  assert.ok(await host.evaluate((el, original) => (el as MonacoHost).monacoEditor!.getModel() === original, model))
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), original.replaceAll('\r\n', '\n'))
  await model.dispose()

  await launch.press('Control+p'); await field.fill('Árvore.md')
  await dialog.getByRole('button', { name: 'nested/Árvore.md', exact: true }).waitFor()
  const dismissed = await probe(); await field.press('Escape'); await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, 'Abrir arquivo do projeto...', { timeout: 3000 })
    .catch(async error => { console.log('Quick Open dismissal focus', await page.evaluate(() => ({
      tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role'),
      belongsToEditor: !!document.activeElement?.closest('.monaco-editor'),
      modal: !!document.querySelector('dialog:modal')
    }))); throw error })
  const expired = ({ job, id }: { job: string; id: string }) => page.evaluate(async ({ job, id }) => {
    const api = window.geppio!.quickOpen
    return [await api.read(job, 'x'), await api.open(job, id)].map(result => !result.ok && result.expired === true)
  }, { job, id })
  assert.deepEqual(await expired(dismissed), [true, true])
  await launch.press('Control+p'); await field.fill('Árvore.md')
  await dialog.getByRole('button', { name: 'nested/Árvore.md', exact: true }).press('Enter')
  await page.getByRole('tab', { name: /Árvore\.md/ }).waitFor()
  assert.equal(await editor.inputValue(), 'disposable tree\n')
  assert.equal(await content.inputValue(), 'answer'); assert.ok(await match.isVisible()); assert.ok(await git.isVisible())
  assert.equal(await layout(), baseline)
  const root = await page.locator('.workspace-controls').getAttribute('data-workspace-root'); assert.ok(root)
  const old = await page.evaluate(root => window.geppio!.quickOpen.start(root, 'modified'), root); assert.ok(old.ok)
  await pick(replacement, 'Trocar projeto')
  await page.waitForFunction(previous => { const id = document.querySelector('.workspace-controls')?.getAttribute('data-workspace-root'); return id && id !== previous }, root)
  const stale = await page.evaluate(job => window.geppio!.quickOpen.read(job, 'modified'), old.value.job)
  assert.ok(!stale.ok && stale.expired); await match.waitFor({ state: 'detached' })
  assert.equal(await terminal.getAttribute('data-terminal-id'), terminalId); assert.deepEqual(pluginWorkers(page), workers)
  assert.deepEqual(await gitFingerprint(project), before); assert.deepEqual(errors, [])
  console.log('PASS Quick Open: one inventory, ranking, keyboard focus, revoked IDs, shared windows, Monaco undo, PTY and Worker at DPR', scaled ? 1.25 : 1)
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => {
    const probe = (globalThis as Partial<Probe>).inventoryProbe
    probe?.releaseStatus(); probe?.releaseOpen()
    BrowserWindow.getAllWindows().forEach(win => win.destroy())
  }).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
