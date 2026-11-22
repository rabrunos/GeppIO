import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { gitFingerprint, initializeGit } from './git-fixtures.ts'
import { fileEditor } from './monaco-support.ts'
import { electron } from './test-electron.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-search-')), base = await realpath(profile)
const project = join(base, 'search-project'), other = join(base, 'other-project'), standalone = join(base, 'independent.txt')
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
const target = join(project, 'nested', 'matches.txt'), gate = join(project, 'wait-for-cancel')
const original = '\ufeffintro\r\n🌱 Café.[x]\rfim\n', query = 'café.[x]'
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
interface SmokeProbe { starts: number; entered: boolean; iterated: boolean; closed: boolean; release(): void }
type MainProbe = typeof globalThis & { searchSmoke: SmokeProbe }
try {
  await initializeGit(project)
  await mkdir(other); await mkdir(gate); await mkdir(join(project, 'nested')); await mkdir(join(project, 'node_modules'))
  await writeFile(target, original); await writeFile(join(project, '.visible.md'), query)
  await writeFile(join(project, 'node_modules', 'excluded.txt'), query); await writeFile(join(other, 'another.txt'), query)
  await writeFile(standalone, 'before save')
  const before = await gitFingerprint(project)
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false })
    await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(), errors: string[] = []
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1360, 920); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
  const select = (file: string) => app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, file)
  const experience = (name: string) => page.locator('.experience-switch').getByRole('button', { name, exact: true }).click()
  const editor = fileEditor(page), host = page.locator('.monaco-host')
  const layout = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await experience('GeppIO Code'); await select(standalone)
  await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  await page.getByRole('tab', { name: /independent\.txt/ }).waitFor()
  await editor.fill('saved while searching')
  await select(project); await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta' }).click()
  await page.getByRole('treeitem', { name: /search-project/ }).waitFor()
  const rootId = await page.locator('.workspace-controls').getAttribute('data-workspace-root'); assert.ok(rootId)

  // Hold one genuine scan at its fixture directory to exercise Save and Cancel
  // without depending on disk speed. Restore the original method on entry.
  await app.evaluate(({ ipcMain }, gate) => {
    const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises')
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    const start = handlers.get('search:start')!, openDirectory = fs.opendir
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const probe: SmokeProbe = { starts: 0, entered: false, iterated: false, closed: false, release }
    ;(globalThis as MainProbe).searchSmoke = probe
    handlers.set('search:start', (...args) => { probe.starts++; return start(...args) })
    fs.opendir = async (...args) => {
      const dir = await openDirectory(...args)
      if (String(args[0]) === gate) {
        fs.opendir = openDirectory
        const iterate = dir[Symbol.asyncIterator].bind(dir), close = dir.close.bind(dir)
        dir[Symbol.asyncIterator] = () => { probe.iterated = true; return iterate() }
        dir.close = async () => { await close(); probe.closed = true }
        probe.entered = true; await hold
      }
      return dir
    }
  }, gate)
  const starts = () => app!.evaluate(() => (globalThis as MainProbe).searchSmoke.starts)
  const activity = page.getByRole('button', { name: 'Busca no projeto', exact: true })
  await activity.click()
  const panel = page.getByRole('region', { name: 'Busca no projeto', exact: true })
  const field = panel.getByRole('textbox', { name: 'Texto a buscar' })
  await field.fill(query); assert.equal(await starts(), 0)
  await field.press('Enter')
  const deadline = Date.now() + 15000
  while (!await app.evaluate(() => (globalThis as MainProbe).searchSmoke.entered)) {
    assert.ok(Date.now() < deadline, 'Search did not reach the controlled directory read')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await page.getByRole('button', { name: 'Salvar arquivo', exact: true }).click()
  await page.locator('.file-editor[data-document-status="clean"]').waitFor()
  assert.equal(await readFile(standalone, 'utf8'), 'saved while searching')
  await experience('Bancada de Trabalho'); await experience('GeppIO Code')
  assert.equal(await field.inputValue(), query); assert.equal(await starts(), 1)
  await panel.getByRole('button', { name: 'Cancelar busca' }).press('Enter')
  await panel.getByRole('status').filter({ hasText: 'Busca cancelada' }).waitFor()
  await app.evaluate(async () => {
    const probe = (globalThis as MainProbe).searchSmoke
    probe.release()
    const end = Date.now() + 3000
    while (!probe.closed && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10))
    if (!probe.closed || probe.iterated) throw new Error('Canceled search must close its pending handle before reading another entry')
  })
  const matchCase = panel.getByRole('checkbox', { name: 'Diferenciar maiúsculas e minúsculas' })
  await matchCase.check(); assert.equal(await starts(), 1)
  await field.press('Enter')
  await panel.getByRole('status').filter({ hasText: 'Ocorrências: 1.' }).waitFor()
  await panel.getByRole('button', { name: /Abrir \.visible\.md/ }).waitFor()
  assert.equal(await panel.getByRole('button', { name: /Abrir nested/ }).count(), 0)
  await matchCase.uncheck(); assert.equal(await starts(), 2)
  await panel.getByRole('button', { name: 'Buscar', exact: true }).click()
  const result = panel.getByRole('button', { name: 'Abrir nested/matches.txt, linha 2, coluna 4', exact: true })
  await result.waitFor()
  assert.equal(await result.locator('mark').textContent(), 'Café.[x]')
  await panel.getByRole('button', { name: /Abrir \.visible\.md/ }).waitFor()
  assert.equal(await panel.getByRole('button', { name: /excluded\.txt/ }).count(), 0)
  await editor.fill('keep independent undo'); await result.press('Enter')
  const active = page.locator('[data-document-tab][aria-selected="true"]')
  await active.filter({ hasText: 'matches.txt' }).waitFor()
  await page.waitForFunction(() => {
    const editor = document.querySelector<MonacoHost>('.monaco-host')?.monacoEditor, range = editor?.getSelection()
    return !!range && editor!.getModel()!.getValueInRange(range) === 'Café.[x]'
  })
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  await editor.fill('local draft'); await result.click()
  await panel.getByRole('alert').filter({ hasText: 'O conteúdo da aba foi preservado' }).waitFor()
  assert.equal(await editor.inputValue(), 'local draft')
  assert.equal(await host.evaluate((node, original) => (node as MonacoHost).monacoEditor!.getModel() === original, model), true)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'intro\n🌱 Café.[x]\nfim\n')
  await model.dispose(); assert.deepEqual(await gitFingerprint(project), before)
  await writeFile(target, 'changed on disk')
  await result.click()
  await panel.getByRole('alert').filter({ hasText: 'Resultado de busca desatualizado' }).waitFor()
  assert.equal(await editor.inputValue(), 'intro\n🌱 Café.[x]\nfim\n')
  const foreign = await app.evaluate(async ({ BrowserWindow, ipcMain }, { root, token }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<{ ok: boolean }>> })._invokeHandlers
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, frame = sender.mainFrame
    return Promise.all([handlers.get('search:start')!({ sender: {}, senderFrame: frame }, root, 'x', false),
      handlers.get('search:start')!({ sender, senderFrame: { url: frame.url } }, root, 'x', false),
      handlers.get('search:open')!({ sender, senderFrame: frame }, token, token)])
  }, { root: rootId, token: randomUUID() })
  assert.ok(foreign.every(response => !response.ok))
  await page.getByRole('button', { name: 'Explorador', exact: true }).click()
  await select(other); await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta' }).click()
  await page.getByRole('treeitem', { name: /other-project/ }).waitFor()
  await activity.click(); assert.equal(await result.count(), 0)
  await page.locator('[data-document-tab]').filter({ hasText: 'independent.txt' }).click()
  assert.equal(await editor.inputValue(), 'keep independent undo')
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'saved while searching')
  await settle(page); assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), layout)
  assert.deepEqual(errors, [])
  console.log('PASS project search: explicit scanning, cancel during native I/O, concurrent Save, literal matches, exclusions, checked Monaco selection, stale results, old grants, draft/undo and root replacement')
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => { (globalThis as Partial<MainProbe>).searchSmoke?.release(); BrowserWindow.getAllWindows().forEach(win => win.destroy()) }).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
