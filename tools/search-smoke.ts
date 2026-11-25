import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import type { SearchResult } from '../src/geppio/src/shared/search.ts'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
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
interface SmokeProbe {
  starts: number; reads: number; cancels: number; startReply: string; readReply: string; cancelReply: string
  gitVisited: boolean; heldOwner: string
  entered: boolean; iterated: boolean; closed: boolean; release(): void
}
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
    server = await createServer({ ...config.config.renderer, root: resolve('src/geppio/src/renderer'), configFile: false })
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

  // Both background Git status and Search enumerate this directory. Track
  // their real async work so only the Search handle pauses before iteration.
  await app.evaluate(({ ipcMain }, gate) => {
    const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises')
    const { AsyncLocalStorage } = process.getBuiltinModule('async_hooks') as typeof import('node:async_hooks')
    const reader = new AsyncLocalStorage<'search' | 'git'>()
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    const openDirectory = fs.opendir
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const probe: SmokeProbe = { starts: 0, reads: 0, cancels: 0, startReply: 'none', readReply: 'none', cancelReply: 'none',
      entered: false, iterated: false, closed: false, gitVisited: false, heldOwner: 'none', release }
    ;(globalThis as MainProbe).searchSmoke = probe
    for (const operation of ['start', 'read', 'cancel'] as const) {
      const channel = 'search:' + operation, original = handlers.get(channel)!
      handlers.set(channel, async (...args) => {
        probe[`${operation}s`]++
        const result = await (operation === 'start' ? reader.run('search', () => original(...args)) : original(...args)) as SearchResult
        probe[`${operation}Reply`] = result.ok ? result.value.status : result.expired ? 'expired' : 'refused'
        return result
      })
    }
    const gitStatus = handlers.get('git:status')!
    handlers.set('git:status', (...args) => reader.run('git', () => gitStatus(...args)))
    fs.opendir = async (...args) => {
      const dir = await openDirectory(...args)
      if (String(args[0]) === gate) {
        const owner = reader.getStore()
        if (owner === 'git') probe.gitVisited = true
        if (owner !== 'search') return dir
        probe.heldOwner = owner
        fs.opendir = openDirectory
        const iterate = dir[Symbol.asyncIterator].bind(dir), close = dir.close.bind(dir)
        dir[Symbol.asyncIterator] = () => { probe.iterated = true; return iterate() }
        dir.close = async () => { await close(); probe.closed = true }
        probe.entered = true; await hold
      }
      return dir
    }
  }, gate)
  await select(project); await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta' }).click()
  await page.getByRole('treeitem', { name: /search-project/ }).waitFor()
  const rootId = await page.locator('.workspace-controls').getAttribute('data-workspace-root'); assert.ok(rootId)
  // Exercise the formerly failing ordering on every runner.
  await app.evaluate(async () => {
    const end = Date.now() + 10000
    while (!(globalThis as MainProbe).searchSmoke.gitVisited) {
      if (Date.now() >= end) throw new Error('Background Git did not enumerate the fixture')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  })
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
  // Capture only event destinations and fixed status labels in this disposable renderer.
  const inputTrace = await page.evaluateHandle(() => {
    const events: string[] = []
    function record(event: Event) {
      if (events.length >= 24 || event instanceof KeyboardEvent && event.key !== 'Enter') return
      const node = event.target as Element
      const target = node.closest('.search-actions button')?.textContent === 'Cancelar busca' ? 'cancel'
        : node.closest('.experience-switch') ? 'experience' : node.closest('.monaco-host') ? 'editor' : 'other'
      events.push(event.type + ':' + target)
    }
    for (const name of ['focusin', 'keydown', 'click']) document.addEventListener(name, record, true)
    return { events, stop() { for (const name of ['focusin', 'keydown', 'click']) document.removeEventListener(name, record, true) } }
  })
  await experience('Bancada de Trabalho'); await experience('GeppIO Code')
  assert.equal(await field.inputValue(), query); assert.equal(await starts(), 1)
  const cancel = panel.getByRole('button', { name: 'Cancelar busca' })
  try {
    await cancel.press('Enter')
    await panel.getByRole('status').filter({ hasText: 'Busca cancelada' }).waitFor()
    const events = await inputTrace.evaluate(trace => trace.events)
    assert.ok(events.includes('keydown:cancel') && events.includes('click:cancel'), 'Enter activated the Cancel button')
  } finally {
    const native = await app.evaluate(() => {
      const { starts, reads, cancels, startReply, readReply, cancelReply, entered, iterated, heldOwner } = (globalThis as MainProbe).searchSmoke
      return { starts, reads, cancels, startReply, readReply, cancelReply, entered, iterated, heldOwner }
    })
    const ui = await page.evaluate(trace => {
      trace.stop()
      const panel = document.querySelector('.project-search')
      const status = panel?.querySelector('[role=status]')?.textContent ?? ''
      const phase = ['Iniciando busca', 'Buscando', 'Busca concluída', 'Busca parcial', 'Busca cancelada', 'Cancelando busca', 'Falha na busca'].find(label => status.startsWith(label))
      return { events: trace.events, phase: phase ?? 'unknown', panel: !!panel, alert: !!panel?.querySelector('[role=alert]'),
        enabled: [...(panel?.querySelectorAll<HTMLButtonElement>('button') ?? [])].some(button => button.textContent === 'Cancelar busca' && !button.disabled) }
    }, inputTrace)
    console.log('Search cancellation evidence', JSON.stringify({ native, ui }))
    await inputTrace.dispose()
  }
  await app.evaluate(async () => {
    const probe = (globalThis as MainProbe).searchSmoke
    if (!probe.gitVisited || probe.heldOwner !== 'search' || probe.cancels !== 1 || probe.cancelReply !== 'canceled')
      throw new Error('Keyboard Cancel must reach the single Search job while its directory read is held')
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
