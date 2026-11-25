import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { fileEditor } from './monaco-support.ts'
import { portugueseFixture } from './freeform-smoke.ts'
import { electron } from './test-electron.ts'
import { decodeGeneration, recoveryFile } from '../src/geppio/src/main/draft-storage.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-draft-recovery-'))
const dev = process.argv.includes('--dev'), scale = process.argv.includes('--scale125') ? 1.25 : 1
const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
async function launch(choices = 0) {
  app = await electron.launch({ args: ['.', ...(scale === 1 ? [] : ['--force-device-scale-factor=1.25'])], env })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1440, 940); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale)
  if (choices) await page.getByRole('button', { name: 'Ver rascunhos no Code (' + choices + ')', exact: true }).click()
  else if (!await page.locator('.file-editor').isVisible()) await page.getByRole('button', { name: 'GeppIO Code', exact: true }).click()
  await page.locator('[data-draft-state]').waitFor()
  return page
}
async function terminate() {
  const child = app!.process()
  const mainPid = await app!.evaluate(() => process.pid)
  const stopped = app!.waitForEvent('close')
  const exited = once(child, 'exit')
  // On Windows the Playwright launcher may be a shell. Terminate only this attested Electron Main.
  assert.ok(process.kill(mainPid, 'SIGKILL')); await exited
  for (const stream of child.stdio) stream?.destroy()
  await stopped
  app = undefined
}
try {
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/geppio/src/renderer'), configFile: false })
    await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  const project = await realpath(profile), original = join(project, 'nome.txt'), output = join(project, 'recuperado.txt')
  const originalText = '\ufeffprimeira\r\nsegunda'
  await writeFile(original, originalText)
  let page = await launch(), editor = fileEditor(page)
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const confirmed = () => page.locator('[data-draft-state="confirmed"]').waitFor()
  const local = join(await app!.evaluate(({ app }) => app.getPath('userData')), recoveryFile)
  await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, original)
  await button('Abrir arquivo').click(); await editor.waitFor()
  const oldGrant = await page.evaluate(async () => {
    const id = document.querySelector<HTMLElement>('.file-editor')!.dataset.documentId!
    const result = await window.geppio!.documents.activate(id)
    if (!result.ok || !result.document) throw new Error('Expected a live file')
    return { id, revision: result.document.revision, text: 'stale' }
  })
  await editor.press('Control+End'); await page.keyboard.insertText(' α'); await confirmed()
  await button('Novo documento').click(); await page.getByRole('tab', { name: 'Sem título 1', exact: true }).waitFor()
  await editor.focus(); await page.keyboard.insertText('outro rascunho β'); await confirmed()
  assert.deepEqual(decodeGeneration(await readFile(local)).records.map(r => r.text), ['primeira\r\nsegunda α', 'outro rascunho β'])
  await terminate()
  await writeFile(original, 'versão externa')
  page = await launch(2); editor = fileEditor(page)
  assert.equal(await editor.count(), 0)
  assert.equal((await page.evaluate(draft => window.geppio!.documents.save(draft), oldGrant)).ok, false)
  const controls = () => page.locator('[data-draft-state]').click()
  await controls(); await button('Deixar para depois').click(); await controls()
  await button('Recuperar nome.txt').click()
  await page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-dirty') === 'true')
  assert.equal(await editor.inputValue(), 'primeira\nsegunda α')
  assert.equal(await page.locator('.file-editor').getAttribute('data-document-scope'), 'Sem destino')
  assert.notEqual(await page.locator('.file-editor').getAttribute('data-document-id'), oldGrant.id)
  await button('Recuperar nome.txt').waitFor({ state: 'detached' })
  await page.keyboard.press('Escape')
  await app!.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, output)
  await button('Salvar como').click(); await page.getByRole('tab', { name: 'recuperado.txt', exact: true }).waitFor()
  assert.equal(await readFile(output, 'utf8'), originalText + ' α')
  assert.equal(await readFile(original, 'utf8'), 'versão externa')
  assert.deepEqual(decodeGeneration(await readFile(local)).records.map(r => r.text), ['outro rascunho β'])
  await terminate(); page = await launch(1); editor = fileEditor(page)
  await controls(); await button('Recuperar Sem título 1').click()
  await button('Recuperar Sem título 1').waitFor({ state: 'detached' })
  assert.equal(await editor.inputValue(), 'outro rascunho β')
  await app!.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  await button('Desativar recuperação').click(); await button('Ativar recuperação').waitFor()
  assert.deepEqual(decodeGeneration(await readFile(local)), { enabled: false, records: [] })
  assert.equal(await editor.inputValue(), 'outro rascunho β')
  console.log('PASS confirmed named and untitled plaintext across abrupt process exits, fresh grants, deferred choices, exact Save As and disabled recovery at DPR', scale, dev ? 'development' : 'built')
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
