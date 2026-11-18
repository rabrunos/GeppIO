import assert from 'node:assert/strict'
import { electron } from './test-electron.ts'
import type { ElectronApplication } from 'playwright'
import { mkdtemp, realpath, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { drag, portugueseFixture, settle } from './freeform-smoke.ts'
import { fileEditor } from './monaco-support.ts'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import type { DocumentDraft, DocumentResult } from '../src/shared/documents.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-multi-documents-')), root = await realpath(profile)
const scope = join(root, 'project'), alternate = join(root, 'alternate'), nested = join(scope, 'nested')
await mkdir(nested, { recursive: true }); await mkdir(alternate)
const first = join(scope, 'first.txt'), second = join(nested, 'second.json'), third = join(alternate, 'second.json')
const original = '\ufeff' + Array.from({ length: 90 }, (_, i) => `line ${i}` + (i % 3 === 0 ? '\r\n' : i % 3 === 1 ? '\n' : '\r')).join('')
await writeFile(first, original); await writeFile(second, '{"second":true}\n'); await writeFile(third, '{"third":true}\n')
const extras = Array.from({ length: 7 }, (_, i) => join(alternate, `extra-${i}.txt`))
await Promise.all(extras.map(path => writeFile(path, 'extra\n')))
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
const diagnostics = resolve('.local/diagnostics/multi-documents-alpha46-' + (dev ? 'dev' : scale125 ? '125' : '100'))
await mkdir(diagnostics, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
const evidence: Record<string, unknown> = {}, errors: string[] = []
try {
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false }); await server.listen()
    env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1600, 1000); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  const editor = fileEditor(page), host = page.locator('.monaco-host'), state = page.locator('.file-editor')
  const idle = () => page.waitForFunction(() => !document.querySelector('.file-explorer[aria-busy="true"]') && document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
  const mode = async (name: 'Editor' | 'Widgets') => { await page.locator('.file-mode-switch').getByRole('button', { name, exact: true }).click(); await settle(page) }
  const picker = async (file: string, responses = [2]) => app!.evaluate(({ dialog }, { file, responses }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    dialog.showMessageBox = (async () => ({ response: responses.shift() ?? 2, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, { file, responses })
  const open = async (file: string) => { await picker(file); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click(); await idle() }
  const folder = async (file: string) => { await picker(file); await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta', exact: true }).click(); await idle() }
  const tab = (id: string) => page.locator(`[data-document-tab="${id}"]`)
  const closeTab = async (id: string, choices = [2]) => { await picker(first, choices); await tab(id).locator('..').getByRole('button', { name: /^Fechar aba/ }).click(); await idle() }
  const id = async () => (await state.getAttribute('data-document-id'))!
  const view = () => host.evaluate(node => { const e = (node as MonacoHost).monacoEditor!, model = e.getModel()!; return { text: model.getValue(), version: model.getAlternativeVersionId(), uri: model.uri.toString(), language: model.getLanguageId(), selection: e.getSelections(), top: e.getScrollTop(), left: e.getScrollLeft() } })
  await mode('Editor'); await folder(scope)
  await page.getByRole('treeitem', { name: 'first.txt', exact: true }).click(); await idle()
  const a = await id(), firstModel = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  await editor.press('Control+Home'); await page.keyboard.insertText('prefix\n')
  await host.evaluate(node => { const e = (node as MonacoHost).monacoEditor!; e.getModel()!.pushStackElement(); e.setSelections([{ selectionStartLineNumber: 40, selectionStartColumn: 2, positionLineNumber: 41, positionColumn: 4 }]); e.revealLineInCenter(40) })
  await page.getByRole('combobox', { name: 'Linguagem do documento' }).selectOption({ label: 'TypeScript' })
  const firstView = await view()
  await open(process.platform === 'win32' ? join(nested.toUpperCase(), 'second.json') : second); const b = await id(); assert.notEqual(a, b)
  await page.waitForFunction(() => document.querySelector('[role="treeitem"][aria-label="second.json"]')?.getAttribute('aria-selected') === 'true')
  assert.equal(await tab(a).locator('.file-editor-dirty').count(), 1); assert.equal(await readFile(first, 'utf8'), original)
  const secondModel = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  await editor.fill('{"second":"draft"}\n'); await editor.press('Control+s'); await idle()
  assert.equal(await readFile(second, 'utf8'), '{"second":"draft"}\n'); assert.equal(await readFile(first, 'utf8'), original)
  await tab(a).click(); await idle(); assert.deepEqual(await view(), firstView)
  assert.equal(await host.evaluate((node, model) => (node as MonacoHost).monacoEditor!.getModel() === model, firstModel), true)
  await editor.press('Control+z'); assert.notEqual(await editor.inputValue(), firstView.text)
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), firstView.text)
  await open(first); assert.equal(await id(), a); assert.equal(await page.getByRole('tab').count(), 2)
  await tab(b).click(); await idle(); const secondView = await view()
  await closeTab(a); assert.equal(await id(), b); assert.equal(await tab(a).count(), 1); assert.deepEqual(await view(), secondView)
  assert.equal(await page.evaluate(model => model.isDisposed(), firstModel), false)
  await closeTab(a, [0]); assert.equal(await page.evaluate(model => model.isDisposed(), firstModel), true)
  assert.equal(await readFile(first, 'utf8'), '\ufeffprefix\r\n' + original.slice(1))
  assert.equal(await host.evaluate((node, model) => (node as MonacoHost).monacoEditor!.getModel() === model, secondModel), true)
  assert.deepEqual(await view(), secondView)
  evidence.independence = 'Independent native identities, active-only save, exact BOM/mixed EOL, stable models/undo/language/view, inactive close Cancel and Save'

  await editor.fill('{"second":"root switch draft"}\n'); await folder(alternate)
  assert.equal(await id(), b); assert.equal(await tab(b).locator('.file-editor-dirty').count(), 1)
  assert.equal(await page.getByRole('treeitem', { name: 'second.json', exact: true }).getAttribute('aria-selected'), 'false')
  await editor.press('Control+s'); await idle(); assert.equal(await readFile(second, 'utf8'), '{"second":"root switch draft"}\n')
  assert.equal(await readFile(third, 'utf8'), '{"third":true}\n')
  await page.getByRole('treeitem', { name: 'second.json', exact: true }).click(); await idle(); const c = await id(); assert.notEqual(c, b)
  assert.notEqual(await tab(b).getAttribute('title'), await tab(c).getAttribute('title'))
  await editor.fill('{"third":"dirty"}\n'); await tab(b).click(); await idle(); await editor.fill('{"second":"close draft"}\n')
  await tab(c).click(); await idle(); const cView = await view()
  const closeWindow = async (choices: number[]) => { await picker(first, choices); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()); await idle() }
  await closeWindow([2]); assert.equal(await page.getByRole('tab').count(), 2); assert.deepEqual(await view(), cView)
  await closeWindow([0, 2]); assert.equal(await page.getByRole('tab').count(), 2); assert.equal(await id(), c)
  assert.equal(await tab(b).locator('.file-editor-dirty').count(), 0); assert.equal(await tab(c).locator('.file-editor-dirty').count(), 1)
  assert.equal(await readFile(second, 'utf8'), '{"second":"close draft"}\n'); assert.equal(await readFile(third, 'utf8'), '{"third":true}\n')
  await writeFile(third, '{"external":true}\n'); await closeWindow([0])
  assert.equal(await state.getAttribute('data-document-status'), 'conflict'); assert.equal(await page.getByRole('tab').count(), 2)
  assert.equal(await editor.inputValue(), cView.text); assert.equal(await readFile(third, 'utf8'), '{"external":true}\n')
  evidence.close = 'Root switches retain independent grants; identical basenames differ; all-dirty close Cancel/partial Save/conflict retain remaining drafts and exact disk targets'

  const incomplete = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
    const win = BrowserWindow.getAllWindows()[0]!, sender = win.webContents, send = sender.send
    let ticket = ''
    sender.send = function(channel, ...args) { if (channel === 'document:close-requested') { ticket = args[0]; return }; send.call(this, channel, ...args) }
    try {
      win.close()
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<DocumentResult>> })._invokeHandlers
      return await handlers.get('document:close')!({ sender, senderFrame: sender.mainFrame }, ticket, [] as DocumentDraft[])
    } finally { sender.send = send }
  })
  assert.ok(!incomplete.ok && incomplete.code === 'stale'); assert.equal(await page.getByRole('tab').count(), 2)
  await open(extras[0]!); const historyId = await id()
  const bounded = await host.evaluate(node => {
    const e = (node as MonacoHost).monacoEditor!, model = e.getModel()!
    let accepted = model.getValue(), attempts = 0
    for (; attempts < 48 && !e.getRawOptions().readOnly; attempts++) {
      model.pushStackElement()
      e.executeEdits('bounded-history-fixture', [{ range: model.getFullModelRange(), text: String(attempts % 10).repeat(512 * 1024) + '\n' }])
      if (!e.getRawOptions().readOnly) accepted = model.getValue()
      model.pushStackElement()
    }
    return { attempts, readOnly: e.getRawOptions().readOnly, retained: model.getValue() === accepted, value: model.getValue() }
  })
  assert.ok(bounded.attempts > 1 && bounded.attempts < 48 && bounded.readOnly && bounded.retained)
  assert.match(await page.locator('.file-editor-feedback').innerText(), /histórico|recuperado/)
  await tab(b).click(); await idle(); await tab(historyId).click(); await idle()
  assert.equal(await host.evaluate(node => (node as MonacoHost).monacoEditor!.getRawOptions().readOnly), true)
  assert.match(await page.locator('.file-editor-feedback').innerText(), /histórico|recuperar/)
  await editor.press('Control+z'); assert.notEqual(await editor.inputValue(), bounded.value)
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), bounded.value)
  const cappedView = await view(); await closeTab(historyId); assert.deepEqual(await view(), cappedView)
  await closeTab(historyId, [1]); assert.equal(await readFile(extras[0]!, 'utf8'), 'extra\n')
  assert.equal(await page.evaluate(model => model.isDisposed(), secondModel), false)
  evidence.history = 'Retained edit budget blocks growth without discarding the last accepted draft; public keyboard undo/redo and close Cancel remain functional; confirmed close releases only that model'
  for (const file of extras.slice(0, 6)) await open(file)
  assert.equal(await page.getByRole('tab').count(), 8); await open(extras[6]!)
  assert.equal(await page.getByRole('tab').count(), 8); assert.match(await page.locator('.file-editor-feedback').innerText(), /limite/i)
  const last = await id(); await closeTab(last); await open(extras[6]!); assert.equal(await page.getByRole('tab').count(), 8)
  const activeTab = tab(await id()); await activeTab.focus(); await activeTab.press('Home'); await idle(); assert.equal(await id(), b)
  await tab(b).press('End'); await idle(); const end = await id(); assert.notEqual(end, b)
  await tab(end).press('Delete'); await idle(); assert.equal(await page.getByRole('tab').count(), 7)
  const closed = await page.evaluate(id => window.geppio!.documents.activate(id), end); assert.ok(!closed.ok && closed.code === 'stale')
  await tab(b).click(); await idle(); await editor.press('Control+z'); assert.notEqual(await editor.inputValue(), '{"second":"close draft"}\n')
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), '{"second":"close draft"}\n')
  evidence.limits = 'Eight-tab cap refuses the ninth without eviction; confirmed close frees capacity; keyboard Home/End/Delete and stale closed ID rejection; complete close-set validation'

  await mode('Widgets'); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:file-editor"]').click(); await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const layout = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), beforeModes = await view()
  for (const name of ['Editor', 'Widgets', 'Editor', 'Widgets'] as const) {
    await mode(name); assert.deepEqual(await view(), beforeModes); assert.equal(await page.getByRole('tab').count(), 7)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), layout)
    assert.equal(await host.evaluate((node, model) => (node as MonacoHost).monacoEditor!.getModel() === model, secondModel), true)
  }
  const frame = page.locator('.widget-frame').filter({ has: state }), frameId = await frame.getAttribute('data-widget'), frameBox = await frame.boundingBox()
  assert.ok(frameId && frameBox)
  await page.getByTestId('edit-layout').click(); await settle(page)
  await drag(page, frameId, 'se', 320 - frameBox.width, 240 - frameBox.height)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const minimum = await state.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return { height: rect.height, scrollHeight: node.scrollHeight, children: [...node.children].map(child => ({ class: child.className, rect: child.getBoundingClientRect().toJSON() })), contained: [...node.children].every(child => child.getBoundingClientRect().bottom <= rect.bottom + .1) }
  })
  await writeFile(join(diagnostics, 'minimum.json'), JSON.stringify(minimum, null, 2))
  assert.ok(minimum.contained, 'Tab chrome and editor remain inside the actual minimum widget content')
  await page.getByTestId('edit-layout').click(); await settle(page)
  const small = await frame.boundingBox(); assert.ok(small)
  await drag(page, frameId, 'se', frameBox.width - small.width, frameBox.height - small.height)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  for (const theme of ['light', 'dark']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const width of [1024, 1600]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 900), width); await settle(page)
      const geometry = await state.evaluate(node => { const rect = node.getBoundingClientRect(), tabs = node.querySelector('.file-editor-tabs')!, model = node.querySelector('.monaco-host')!; const box = model.getBoundingClientRect(); return { width: rect.width, height: rect.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, tabs: tabs.getBoundingClientRect().width, modelHeight: box.height, contained: box.bottom <= rect.bottom, dpr: devicePixelRatio } })
      assert.ok(geometry.width > 0 && geometry.modelHeight > 0 && geometry.contained); assert.equal(geometry.scrollWidth, geometry.clientWidth)
      assert.ok(Math.abs(geometry.dpr - (scale125 ? 1.25 : 1)) < .01)
      evidence[theme + width] = geometry
    }
    await page.screenshot({ path: join(diagnostics, theme + '.png') })
  }
  assert.deepEqual(errors, []); evidence.presentation = 'One shared editor and all tab identities/models across presentations; exact layout bytes and bounded internal tab scrolling in both themes'
  await writeFile(join(diagnostics, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2))
} finally {
  // Destroy only the disposable test window; intentionally retained conflict drafts have been asserted above.
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {})
  await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
