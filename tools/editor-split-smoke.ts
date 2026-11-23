import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture } from './freeform-smoke.ts'
import { electron } from './test-electron.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-editor-split-'))
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
try {
  const folder = join(await realpath(profile), 'project')
  await mkdir(folder)
  const lines = Array.from({ length: 140 }, (_, i) => '// linha ' + i).join('\n'), bytes = Buffer.from(lines)
  const source = join(folder, 'teste.js'), renamed = join(folder, 'renomeado.js'), copy = join(folder, 'outro.ts')
  await writeFile(source, bytes); await writeFile(join(folder, 'ocupado.txt'), 'existing')
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
  env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false })
    await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow, dialog }, folder) => {
    const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1440, 940); win.show(); win.focus()
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, folder)
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const item = (name: string) => page.getByRole('treeitem', { name, exact: true })
  await button('GeppIO Code').click(); await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta' }).click()
  await item('teste.js').click()
  const area = page.locator('.file-editor-groups'), state = page.locator('.file-editor'), left = area.locator('[data-editor-group="0"]'), right = area.locator('[data-editor-group="1"]')
  const lh = left.locator('.monaco-host'), rh = right.locator('.monaco-host')
  await lh.waitFor(); assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
  const id = await state.getAttribute('data-document-id'), model = await lh.evaluateHandle(n => (n as MonacoHost).monacoEditor!.getModel()!)
  const idle = () => page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
  const command = async (name: string) => { await button(name).click(); await idle() }
  const verifyBoth = async (name: string) => {
    for (const side of [left, right]) {
      await side.getByRole('tab').filter({ hasText: name }).waitFor()
      const host = side.locator('.monaco-host')
      assert.ok(await host.evaluate((n, m) => (n as MonacoHost).monacoEditor!.getModel() === m, model))
      assert.equal(await host.getAttribute('data-monaco-models'), '1')
    }
  }
  await command('Dividir editor'); await verifyBoth('teste.js')
  const focus = async (side: typeof lh) => { await side.evaluate(n => (n as MonacoHost).monacoEditor!.focus()); await idle(); await side.locator('..').locator('[data-active-group="true"]').waitFor() }
  await focus(lh); await page.keyboard.press('Control+Home'); await page.keyboard.insertText('abc')
  assert.equal(await rh.evaluate(n => (n as MonacoHost).monacoEditor!.getValue()), 'abc' + lines)
  await focus(rh); await page.keyboard.press('Control+z')
  assert.equal(await lh.evaluate(n => (n as MonacoHost).monacoEditor!.getValue()), lines)
  await page.keyboard.press('Control+y'); await page.keyboard.press('Control+End')
  const rightView = () => rh.evaluate(n => { const e = (n as MonacoHost).monacoEditor!; return [e.getPosition()!.lineNumber, e.getScrollTop()] })
  await rh.evaluate(n => (n as MonacoHost).monacoEditor!.setScrollTop(1500, 1))
  const position = await rightView(); assert.equal(position[0], 140); assert.ok(position[1]! > 0)
  await focus(lh); await page.keyboard.press('Control+Home'); assert.deepEqual(await rightView(), position)
  await item('teste.js').press('F2')
  const renameDialog = page.getByRole('dialog', { name: 'Renomear arquivo' }); await renameDialog.getByRole('textbox', { name: 'Novo nome' }).fill('renomeado.js')
  await renameDialog.getByRole('button', { name: 'Renomear', exact: true }).click(); await renameDialog.waitFor({ state: 'detached' })
  await verifyBoth('renomeado.js'); assert.deepEqual(await readFile(renamed), bytes); await assert.rejects(stat(source), { code: 'ENOENT' })
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, copy)
  await command('Salvar como'); await verifyBoth('outro.ts')
  assert.equal(await state.getAttribute('data-document-id'), id); assert.deepEqual(await readFile(renamed), bytes); assert.equal(await readFile(copy, 'utf8'), 'abc' + lines)
  const separator = area.getByRole('separator'); await separator.press('ArrowRight'); const ratio = await separator.getAttribute('aria-valuenow')
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setMinimumSize(400, 580); win.setContentSize(620, 720) })
  await page.locator('.file-editor-groups[data-collapsed="true"]').waitFor()
  assert.equal(await area.locator('.monaco-host').count(), 1)
  await command('Mostrar outro grupo'); assert.ok(await rh.isVisible())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 940))
  await separator.waitFor(); assert.equal(await separator.getAttribute('aria-valuenow'), ratio); await verifyBoth('outro.ts')
  await command('Bancada de Trabalho'); await command('GeppIO Code'); await verifyBoth('outro.ts')
  await focus(rh); await item('ocupado.txt').click()
  await right.getByRole('tab', { name: 'ocupado.txt', exact: true }).waitFor()
  await focus(rh); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' B')
  await focus(lh); await page.keyboard.press('Control+Home'); await page.keyboard.insertText('L')
  const bTab = right.getByRole('tab').filter({ hasText: 'ocupado.txt' })
  await bTab.focus(); await idle(); await bTab.press('Control+s')
  await page.locator('.file-editor[data-document-status="clean"]').waitFor()
  assert.equal(await readFile(join(folder, 'ocupado.txt'), 'utf8'), 'existing B')
  assert.equal(await readFile(copy, 'utf8'), 'abc' + lines)
  await focus(lh); await page.keyboard.press('Control+z')
  await right.getByRole('button', { name: 'Fechar aba ocupado.txt' }).click(); await idle()
  await verifyBoth('outro.ts')
  await focus(rh); await page.keyboard.press('Control+Home'); await page.keyboard.insertText('novo ')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }) })
  await right.getByRole('button', { name: 'Fechar aba outro.ts' }).click(); await idle()
  await rh.waitFor({ state: 'detached' }); assert.equal(await lh.evaluate(n => (n as MonacoHost).monacoEditor!.getValue()), 'novo abc' + lines)
  await left.getByRole('button', { name: 'Fechar aba outro.ts' }).click(); await idle()
  assert.ok(await lh.isVisible()); assert.equal(await state.getAttribute('data-document-dirty'), 'true')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()); await idle()
  assert.ok(await lh.isVisible())
  await command('Mover para o outro grupo'); await lh.waitFor({ state: 'detached' }); await rh.waitFor()
  await command('Unir grupos'); await lh.waitFor(); await command('Dividir editor'); await verifyBoth('outro.ts')
  await command('Unir grupos'); await lh.waitFor()
  assert.ok(await lh.evaluate((n, m) => (n as MonacoHost).monacoEditor!.getModel() === m, model))
  assert.equal(await readFile(copy, 'utf8'), 'abc' + lines)
  assert.deepEqual(errors, []); await model.dispose()
  await command('Fechar pasta')
  await app.evaluate(({ dialog, ipcMain }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers
    const actual = handlers.get('document:release')!
    handlers.set('document:release', async (...args) => {
      handlers.set('document:release', actual); await actual(...args); throw Error('lost last release acknowledgment')
    })
  })
  await command('Fechar arquivo')
  const retained = await lh.evaluate(n => (n as MonacoHost).monacoEditor!.getValue())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await button('Descartar rascunho local').waitFor()
  assert.equal(await lh.evaluate(n => (n as MonacoHost).monacoEditor!.getValue()), retained)
  assert.equal(retained, 'novo abc' + lines)
  await page.evaluate(() => { window.confirm = () => true })
  await command('Descartar rascunho local'); await lh.waitFor({ state: 'detached' })
  const closed = page.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await closed
  console.log('PASS shared model, two independent reading positions, rename and Save As, group move/close, responsive divider and presentation switch', scale125 ? 1.25 : 1, dev ? 'development' : 'built')
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
