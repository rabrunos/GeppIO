import assert from 'node:assert/strict'
import { electron } from './test-electron.ts'
import type { ElectronApplication } from 'playwright'
import { mkdtemp, realpath, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileEditor } from './monaco-support.ts'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-monaco-')), root = await realpath(profile)
const scale125 = process.argv.includes('--scale125'), dev = process.argv.includes('--dev')
const diagnostics = resolve('.local/diagnostics/monaco-alpha42-' + (dev ? 'dev' : scale125 ? '125' : '100'))
await mkdir(diagnostics, { recursive: true })
const fixture = join(root, 'fixture.json'), typescript = join(root, 'fixture.ts')
const original = '\ufeff{\r\n  "one": 1,\n  "two": 2\r}\r\n'
await writeFile(fixture, original); await writeFile(typescript, 'const answer: number = 42;\n')
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
const errors: string[] = [], requests: string[] = [], evidence: Record<string, unknown> = {}
try {
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/geppio/src/renderer'), configFile: false }); await server.listen()
    env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow()
  // Catalog placement needs the same explicit usable viewport as the existing document smokes;
  // hosted Windows desktops may otherwise constrain the initial window to a smaller display.
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1920, 1080); win.show(); win.focus() })
  page.setDefaultTimeout(15000)
  page.on('pageerror', e => errors.push(e.message)); page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173/')) requests.push(request.url()) })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  const editor = fileEditor(page), host = page.locator('.monaco-host')
  const mode = async (name: 'GeppIO Code' | 'Bancada de Trabalho') => { await page.locator('.experience-switch').getByRole('button', { name, exact: true }).click(); await settle(page) }
  const idle = () => page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
  const picker = async (file: string, response = 2) => app!.evaluate(({ dialog }, { file, response }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = (async () => ({ response, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, { file, response })
  const open = async (file: string, response = 2) => { await picker(file, response); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click(); await idle(); await editor.waitFor() }
  const snapshot = () => host.evaluate(node => {
    const editor = (node as MonacoHost).monacoEditor!, model = editor.getModel()!
    return { value: model.getValue(), language: model.getLanguageId(), uri: model.uri.toString(), version: model.getAlternativeVersionId(), selections: editor.getSelections()?.map(s => [s.selectionStartLineNumber, s.selectionStartColumn, s.positionLineNumber, s.positionColumn]), top: editor.getScrollTop(), models: node.getAttribute('data-monaco-models') }
  })
  await mode('GeppIO Code'); await open(fixture)
  console.log('Monaco: opened JSON')
  assert.equal(await page.locator('textarea[data-file-editor]').count(), 0)
  assert.equal((await snapshot()).language, 'json'); assert.equal((await snapshot()).models, '1')
  assert.equal(await editor.inputValue(), original.slice(1).replace(/\r\n?/g, '\n'))
  await editor.press('Control+s'); await idle(); assert.equal(await readFile(fixture, 'utf8'), original)
  await page.waitForFunction(() => new Set([...document.querySelectorAll('.monaco-editor .view-line span')].map(n => n.className).filter(c => /mtk\d/.test(c))).size >= 3, undefined, { timeout: 15000 })
  await host.evaluate(node => {
    const e = (node as MonacoHost).monacoEditor!
    e.setSelections([{ selectionStartLineNumber: 2, selectionStartColumn: 10, positionLineNumber: 2, positionColumn: 11 }, { selectionStartLineNumber: 3, selectionStartColumn: 10, positionLineNumber: 3, positionColumn: 11 }]); e.focus()
  })
  await page.keyboard.insertText('9'); assert.equal((await snapshot()).selections?.length, 2)
  await editor.press('Control+s'); await idle()
  const modified = '\ufeff{\r\n  "one": 9,\n  "two": 9\r}\r\n'
  assert.equal(await readFile(fixture, 'utf8'), modified)
  await editor.press('Control+z'); await editor.press('Control+s'); await idle(); assert.equal(await readFile(fixture, 'utf8'), original)
  await editor.press('Control+y'); await editor.press('Control+s'); await idle(); assert.equal(await readFile(fixture, 'utf8'), modified)
  console.log('Monaco: simultaneous exact-byte edits passed')
  const layout = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await mode('Bancada de Trabalho'); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:file-editor"]').click(); await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const confirmedLayout = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  assert.notEqual(confirmedLayout, layout)
  await editor.fill('draft\n' + Array.from({ length: 120 }, (_, i) => 'line ' + i).join('\n'))
  await host.evaluate(node => { const e = (node as MonacoHost).monacoEditor!; e.getModel()!.pushStackElement(); e.setPosition({ lineNumber: 50, column: 4 }); e.revealLineInCenter(50) })
  await editor.press('x')
  const before = await snapshot(), handle = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!)
  console.log('Monaco: switching presentations')
  const workerSet = page.workers()
  for (let i = 0; i < 12; i++) {
    await mode(i % 2 ? 'Bancada de Trabalho' : 'GeppIO Code')
    assert.equal(await host.evaluate((node, e) => (node as MonacoHost).monacoEditor === e, handle), true)
    assert.deepEqual(await snapshot(), before)
    assert.equal(await readFile(fixture, 'utf8'), modified)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), confirmedLayout)
  }
  await editor.press('Control+z'); assert.notEqual(await editor.inputValue(), before.value)
  await mode('GeppIO Code'); await editor.press('Control+y'); assert.equal(await editor.inputValue(), before.value)
  assert.deepEqual(page.workers(), workerSet)
  await page.getByRole('combobox', { name: 'Linguagem do documento' }).selectOption({ label: 'TypeScript' })
  assert.equal((await snapshot()).language, 'typescript'); assert.equal((await snapshot()).uri, before.uri)
  await editor.press('Control+z'); await editor.press('Control+y'); assert.equal(await editor.inputValue(), before.value)
  assert.match(await page.locator('[data-status-document]').innerText(), /Não salvo/)
  // Built-in find/replace uses real Monaco actions and keyboard input.
  await editor.fill('alpha alpha\n'); await editor.press('Control+h')
  const find = page.locator('.find-widget .find-part textarea'); await find.fill('alpha')
  const replace = page.locator('.find-widget .replace-part textarea'); await replace.fill('beta')
  await page.locator('.find-widget').getByRole('button', { name: /^Replace All/ }).click(); assert.equal(await editor.inputValue(), 'beta beta\n'); await editor.press('Escape')
  await open(typescript, 2); assert.equal((await snapshot()).language, 'typescript'); assert.notEqual((await snapshot()).uri, before.uri)
  const secondURI = (await snapshot()).uri
  await open(typescript, 1); assert.equal((await snapshot()).uri, secondURI, 'An already-open file activates its existing model')
  assert.equal((await snapshot()).models, '2')
  for (const value of ['\ud800', 'x'.repeat(1024 * 1024 + 1)]) {
    const accepted = await editor.inputValue()
    await host.evaluate((node, value) => { const e = (node as MonacoHost).monacoEditor!; e.executeEdits('invalid-fixture', [{ range: e.getModel()!.getFullModelRange(), text: value }]) }, value)
    assert.equal(await editor.inputValue(), accepted)
    assert.match(await page.locator('.file-editor-feedback').innerText(), /recusada/)
  }
  await page.waitForFunction(() => document.querySelector('.monaco-editor .view-line')?.textContent?.includes('answer'))
  await page.waitForFunction(() => new Set([...document.querySelectorAll('.monaco-editor .view-line span')].map(n => n.className).filter(c => /mtk\d/.test(c))).size >= 3, undefined, { timeout: 15000 })
  for (const language of ['JSON', 'JavaScript', 'HTML', 'CSS', 'Markdown', 'Texto simples', 'TypeScript']) {
    await page.getByRole('combobox', { name: 'Linguagem do documento' }).selectOption({ label: language }); await settle(page)
  }
  assert.equal(await readFile(typescript, 'utf8'), 'const answer: number = 42;\n')
  for (const theme of ['light', 'dark']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const width of [1024, 1920]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 900), width); await settle(page)
      const geometry = await host.evaluate(node => { const e = (node as MonacoHost).monacoEditor!, box = node.getBoundingClientRect(); return { width: e.getLayoutInfo().width, height: e.getLayoutInfo().height, expectedWidth: node.clientWidth, expectedHeight: node.clientHeight, contained: box.width > 0 && box.height > 0 && node.scrollWidth <= node.clientWidth, theme: e.getDomNode()!.className, dpr: devicePixelRatio } })
      assert.equal(geometry.width, geometry.expectedWidth); assert.equal(geometry.height, geometry.expectedHeight); assert.equal(geometry.contained, true)
      assert.match(geometry.theme, theme === 'dark' ? /vs-dark/ : /\bvs\b/); assert.ok(Math.abs(geometry.dpr - (scale125 ? 1.25 : 1)) < .01)
    }
  }
  await editor.fill('unsaved conflict\n'); await writeFile(typescript, 'external\n'); await editor.press('Control+s'); await idle()
  assert.equal(await page.locator('.file-editor').getAttribute('data-document-status'), 'conflict'); assert.equal(await editor.inputValue(), 'unsaved conflict\n')
  await picker(typescript, 2); await page.getByRole('button', { name: 'Fechar arquivo', exact: true }).click(); await idle(); assert.equal(await editor.inputValue(), 'unsaved conflict\n')
  await picker(typescript, 1); await page.getByRole('button', { name: 'Fechar arquivo', exact: true }).click(); await idle()
  assert.equal((await snapshot()).uri, before.uri, 'Closing the active second tab returns to the first dirty model')
  assert.equal(await editor.inputValue(), 'beta beta\n')
  await page.getByRole('button', { name: 'Fechar arquivo', exact: true }).click(); await idle()
  assert.equal(await host.count(), 0)
  await open(fixture); assert.equal((await snapshot()).models, '1')
  const maximum = join(root, 'maximum.txt'), maxBytes = '\ufeff' + 'x'.repeat(1024 * 1024 - 3)
  await writeFile(maximum, maxBytes); await open(maximum)
  assert.equal((await snapshot()).models, '2'); assert.equal((await editor.inputValue()).length, 1024 * 1024 - 3)
  await host.evaluate(node => { const e = (node as MonacoHost).monacoEditor!, p = e.getModel()!.getPositionAt(e.getValue().length); e.executeEdits('over-limit', [{ range: { startLineNumber: p.lineNumber, endLineNumber: p.lineNumber, startColumn: p.column, endColumn: p.column }, text: '!' }]) })
  assert.equal((await editor.inputValue()).length, 1024 * 1024 - 3)
  await editor.press('Control+s'); await idle(); assert.equal(await readFile(maximum, 'utf8'), maxBytes)
  evidence.workers = page.workers().map(worker => worker.url())
  assert.ok((evidence.workers as string[]).some(url => /json.worker/.test(url)))
  assert.ok((evidence.workers as string[]).some(url => /ts.worker/.test(url)))
  assert.ok((evidence.workers as string[]).every(url => dev ? url.startsWith('http://127.0.0.1:5173/') : url.startsWith('geppio://app/assets/')))
  assert.deepEqual(requests, []); assert.deepEqual(errors, [])
  await page.screenshot({ path: join(diagnostics, 'monaco.png') })
  evidence.result = 'passed: actual Monaco, stock editing/find/replace/multicursor, model/editor/undo/view continuity, byte-exact BOM/mixed EOL, language/status, local workers/CSP, themes/resize and release/replacement'
  await writeFile(join(diagnostics, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log('PASS Monaco ' + (dev ? 'development' : scale125 ? 'production DPR 1.25' : 'production DPR 1'))
} catch (error) { console.error('Monaco errors:', errors); throw error }
finally {
  // Disposable test teardown must not wait forever on a deliberately canceled dirty-close dialog.
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {}); await server?.close()
  assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith('geppio-smoke-monaco-'))
  await rm(profile, { recursive: true, force: true })
}
