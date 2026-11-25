import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { fileEditor } from './monaco-support.ts'
import { portugueseFixture } from './freeform-smoke.ts'
import { electron } from './test-electron.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-rename-open-'))
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
try {
  const folder = join(await realpath(profile), 'project')
  await mkdir(folder)
  const bytes = Buffer.from('\ufeffconst numero = 1\r\n// fim\n')
  const source = join(folder, 'teste.js'), clean = join(folder, 'limpo.js'), dirty = join(folder, 'final.txt')
  await writeFile(source, bytes); await writeFile(join(folder, 'ocupado.txt'), 'existing')
  const neighbours = ['teste.jsx', 'teste-1.js', 'final-1.txt']
  for (const name of neighbours) await writeFile(join(folder, name), '\ufeff' + name + '\r\nπ\n')
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
  env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/geppio/src/renderer'), configFile: false })
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
  const editor = fileEditor(page), host = page.locator('.monaco-host'), file = page.locator('.file-editor')
  await editor.waitFor(); assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
  const id = await file.getAttribute('data-document-id'); assert.ok(id)
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  const view = () => host.evaluate(node => {
    const editor = (node as MonacoHost).monacoEditor!
    return { text: editor.getValue(), cursor: editor.getPosition(), top: editor.getScrollTop(), left: editor.getScrollLeft(),
      language: editor.getModel()!.getLanguageId(), version: editor.getModel()!.getAlternativeVersionId() }
  })
  const dialog = page.getByRole('dialog', { name: 'Renomear arquivo' })
  async function submit(name: string) {
    await dialog.getByRole('textbox', { name: 'Novo nome' }).fill(name)
    await dialog.getByRole('button', { name: 'Renomear', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
  }
  await button('Renomear arquivo').click(); await dialog.getByRole('button', { name: 'Cancelar' }).click()
  assert.deepEqual(await readFile(source), bytes)
  await button('Renomear arquivo').click(); await submit('ocupado.txt')
  assert.deepEqual(await readFile(source), bytes); assert.equal(await readFile(join(folder, 'ocupado.txt'), 'utf8'), 'existing')
  const first = await view()
  await item('teste.js').press('F2'); await submit('limpo.js')
  await item('limpo.js').waitFor(); assert.deepEqual(await view(), first)
  await assert.rejects(stat(source), { code: 'ENOENT' }); assert.deepEqual(await readFile(clean), bytes)
  await editor.press('Control+Home'); await editor.press('End'); await page.keyboard.insertText('0')
  const edited = await view(); assert.equal(edited.text, 'const numero = 10\n// fim\n')
  await item('limpo.js').press('F2'); await submit('final.txt'); await item('final.txt').waitFor()
  assert.deepEqual(await view(), edited); assert.equal(await file.getAttribute('data-document-id'), id)
  assert.equal(await file.getAttribute('data-document-dirty'), 'true')
  assert.ok(await host.evaluate((node, original) => (node as MonacoHost).monacoEditor!.getModel() === original, model))
  assert.deepEqual(await readFile(dirty), bytes); await assert.rejects(stat(clean), { code: 'ENOENT' })
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), first.text)
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), edited.text)
  await editor.press('Control+s'); await page.locator('.file-editor[data-document-status="clean"]').waitFor()
  assert.deepEqual(await readFile(dirty), Buffer.from('\ufeffconst numero = 10\r\n// fim\n'))
  await assert.rejects(stat(clean), { code: 'ENOENT' }); await assert.rejects(stat(source), { code: 'ENOENT' })
  // Drop only the acknowledgment of this real IPC invocation after the helper completes.
  await button('Atualizar árvore').click(); await item('final.txt').click()
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    type Receipt = { outcome?: string; code?: string }
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<Receipt>> })._invokeHandlers
    const key = 'explorer:rename-file', actual = handlers.get(key)!
    handlers.set(key, async (...args) => {
      handlers.set(key, actual)
      const move = actual(...args)
      const { id, revision } = args[4] as { id: string; revision: string }
      const draft = { id, revision, text: 'must never be written' }
      const save = await handlers.get('document:save')!(args[0], draft)
      const close = await handlers.get('document:release')!(args[0], draft)
      BrowserWindow.getAllWindows()[0]!.close()
      const receipt = await move
      if (save.code !== 'busy' || close.code !== 'busy' || receipt.outcome !== 'confirmed') {
        return { outcome: 'refused', message: 'Concurrent transaction fixture failed' }
      }
      throw new Error('Disposable lost acknowledgment')
    })
  })
  await editor.press('Control+End'); await page.keyboard.insertText('// rascunho')
  const beforeLost = await view()
  await item('final.txt').press('F2'); await submit('conferir.txt')
  await item('conferir.txt').waitFor(); assert.deepEqual(await view(), beforeLost)
  assert.ok(await button('Salvar arquivo').isDisabled()); await editor.press('Control+s')
  assert.deepEqual(await readFile(join(folder, 'conferir.txt')), Buffer.from('\ufeffconst numero = 10\r\n// fim\n'))
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  await button('Recarregar do disco').click()
  await page.getByRole('tab', { name: 'conferir.txt', exact: true }).waitFor()
  assert.equal(await editor.inputValue(), edited.text); await assert.rejects(stat(dirty), { code: 'ENOENT' })
  assert.deepEqual(errors, []); await model.dispose()
  for (const name of neighbours) assert.deepEqual(await readFile(join(folder, name)), Buffer.from('\ufeff' + name + '\r\nπ\n'))
  console.log('PASS open-file rename, disk bytes, model, undo and explicit recovery at DPR', scale125 ? 1.25 : 1, dev ? 'development' : 'built')
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
