import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { fileEditor } from './monaco-support.ts'
import { portugueseFixture } from './freeform-smoke.ts'
import { electron } from './test-electron.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-document-create-'))
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
try {
  const dir = join(await realpath(profile), 'documents')
  await mkdir(dir)
  const original = join(dir, 'original.txt'), copy = join(dir, 'cópia.ts'), second = join(dir, 'dois.txt'), third = join(dir, 'três.txt')
  await writeFile(copy, 'conteúdo anterior')
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
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1440, 940); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const editor = fileEditor(page), host = page.locator('.monaco-host'), state = page.locator('.file-editor')
  const idle = () => page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
  const click = async (name: string) => { await button(name).click(); await idle() }
  async function choose(paths: (string | null)[], decisions: number[] = []) {
    await app!.evaluate(({ dialog }, { paths, decisions }) => {
      dialog.showSaveDialog = async () => {
        if (!paths.length) throw new Error('Unexpected extra destination picker')
        const path = paths.shift()
        return { canceled: !path, filePath: path ?? '' }
      }
      dialog.showMessageBox = async (first, second?: Electron.MessageBoxOptions) => {
        const options = second ?? first as Electron.MessageBoxOptions
        if (!decisions.length || options.defaultId !== 0 || options.cancelId !== 0) throw new Error('Unexpected or unsafe overwrite confirmation')
        return { response: decisions.shift()!, checkboxChecked: false }
      }
    }, { paths, decisions })
  }
  await button('GeppIO Code').click(); await click('Novo documento')
  const firstId = await state.getAttribute('data-document-id'); assert.ok(firstId)
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  await editor.focus(); await page.keyboard.insertText('primeiro α')
  await choose([null]); await click('Salvar arquivo')
  assert.equal(await state.getAttribute('data-document-dirty'), 'true')
  await choose([original]); await editor.press('Control+s')
  await page.getByRole('tab', { name: 'original.txt', exact: true }).waitFor()
  assert.deepEqual(await readFile(original), Buffer.from('primeiro α'))
  await editor.press('Control+End'); await page.keyboard.insertText(' alterado')
  await choose([copy], [0]); await click('Salvar como')
  assert.equal(await readFile(copy, 'utf8'), 'conteúdo anterior'); assert.equal(await editor.inputValue(), 'primeiro α alterado')
  await choose([copy], [1]); await click('Salvar como')
  await page.getByRole('tab', { name: 'cópia.ts', exact: true }).waitFor()
  assert.equal(await state.getAttribute('data-document-id'), firstId)
  assert.ok(await host.evaluate((node, model) => (node as MonacoHost).monacoEditor!.getModel() === model, model))
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'primeiro α')
  assert.deepEqual(await readFile(copy), Buffer.from('primeiro α alterado')); assert.deepEqual(await readFile(original), Buffer.from('primeiro α'))
  await click('Novo documento'); await editor.focus(); await page.keyboard.insertText('segundo')
  const secondId = await state.getAttribute('data-document-id')
  await click('Novo documento'); await editor.focus(); await page.keyboard.insertText('terceiro')
  const thirdId = await state.getAttribute('data-document-id')
  await choose([null]); await click('Salvar todos')
  const feedback = page.locator('.file-editor-feedback')
  assert.match(await feedback.innerText(), /cópia\.ts — salvo.*Sem título 2 — cancelado.*Sem título 3 — pendente/s)
  assert.deepEqual(await readFile(copy), Buffer.from('primeiro α')); assert.equal(await state.getAttribute('data-document-id'), thirdId)
  await choose([second, third]); await click('Salvar todos')
  assert.equal(await readFile(second, 'utf8'), 'segundo'); assert.equal(await readFile(third, 'utf8'), 'terceiro')
  assert.match(await feedback.innerText(), /cópia\.ts — sem alterações.*dois\.txt — salvo.*três\.txt — salvo/s)
  await choose([second]); await click('Salvar como')
  assert.equal(await readFile(second, 'utf8'), 'segundo'); assert.equal(await state.getAttribute('data-document-id'), thirdId)
  await page.getByRole('tab', { name: 'dois.txt', exact: true }).click(); await idle()
  assert.equal(await state.getAttribute('data-document-id'), secondId)
  await click('Fechar arquivo')
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, second)
  await click('Abrir arquivo'); assert.equal(await editor.inputValue(), 'segundo')
  assert.notEqual(await state.getAttribute('data-document-id'), secondId); assert.deepEqual(errors, [])
  await model.dispose()
  console.log('PASS untitled document, native destination decisions, retained model and undo, partial Save All and reopening at DPR', scale125 ? 1.25 : 1, dev ? 'development' : 'built')
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
