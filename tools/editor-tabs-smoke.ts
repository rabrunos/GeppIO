import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture } from './freeform-smoke.ts'
import { electron } from './test-electron.ts'
import { closeWorkspaceWindow } from './workspace-close.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-editor-tabs-'))
const dev = process.argv.includes('--dev'), scaled = process.argv.includes('--scale125')
let app: ElectronApplication | undefined, page!: Page, server: import('vite').ViteDevServer | undefined
const errors: string[] = []
const group = (side: 0 | 1) => page.locator('[data-editor-group="' + side + '"]')
const tab = (side: 0 | 1, name: string) => group(side).getByRole('tab').filter({ hasText: name })
const order = (side: 0 | 1) => group(side).locator('[role="tab"] > span:first-child').allTextContents()
const button = (name: string) => page.getByRole('button', { name, exact: true })
const idle = () => page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
async function action(label: string) {
  await button('Organizar abas').click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  await idle()
}
try {
  const folder = join(await realpath(profile), 'project')
  await mkdir(folder)
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) await writeFile(join(folder, name), name)
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
  env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false })
    await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  async function launch(restore: boolean) {
    app = await electron.launch({ args: ['.', ...(scaled ? ['--force-device-scale-factor=1.25'] : [])], env })
    page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message))
    await app.evaluate(({ BrowserWindow, dialog }, path) => {
      const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1600, 980); win.show(); win.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      dialog.showMessageBox = (async (...args: unknown[]) => ({ response: (args.at(-1) as { title: string }).title === 'Alterações não salvas' ? 2 : 0, checkboxChecked: false })) as typeof dialog.showMessageBox
    }, folder)
    await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
    await button('GeppIO Code').click()
    assert.equal(await page.evaluate(() => devicePixelRatio), scaled ? 1.25 : 1)
    await button('Projeto local').click()
    await page.getByRole('dialog', { name: 'Projeto local e recuperação' }).getByRole('button', { name: restore ? 'Restaurar projeto anterior' : 'Abrir projeto', exact: true }).click()
    await page.locator('.workspace-controls:not([data-workspace-root=""])').waitFor(); await idle()
  }
  const open = async (name: string) => { await page.getByRole('treeitem', { name, exact: true }).click(); await idle() }
  await launch(false)
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await open(name)
  await tab(0, 'c.txt').dragTo(tab(0, 'a.txt'))
  assert.deepEqual(await order(0), ['c.txt', 'a.txt', 'b.txt'])
  await tab(0, 'b.txt').click(); await action('Fixar aba'); await button('Dividir editor').click()
  await open('d.txt')
  assert.equal(await tab(1, 'd.txt').getAttribute('aria-keyshortcuts'), 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight')
  await tab(1, 'd.txt').press('Alt+Shift+ArrowLeft')
  assert.deepEqual(await order(1), ['d.txt', 'b.txt'])
  await tab(1, 'd.txt').press('Alt+Shift+ArrowRight')
  assert.deepEqual(await order(1), ['b.txt', 'd.txt'])
  await tab(1, 'd.txt').press('Alt+Shift+ArrowLeft')
  assert.deepEqual(await order(1), ['d.txt', 'b.txt'])
  assert.equal(await group(1).locator('[data-pinned="true"]').innerText(), await group(0).locator('[data-pinned="true"]').innerText())
  await tab(0, 'a.txt').click(); await idle()
  await group(0).locator('.monaco-host').evaluate(n => (n as MonacoHost).monacoEditor!.focus())
  await page.keyboard.press('Control+End'); await page.keyboard.insertText(' rascunho')
  await tab(0, 'b.txt').click(); await idle(); await action('Fechar outras abas')
  assert.deepEqual(await order(0), ['a.txt', 'b.txt']); assert.deepEqual(await order(1), ['d.txt', 'b.txt'])
  assert.match(await page.locator('.file-editor-feedback').innerText(), /interrompido.*1 de 2/s)
  await tab(0, 'a.txt').click(); await idle(); await button('Salvar arquivo').click(); await idle()
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'a.txt rascunho')
  await closeWorkspaceWindow(app!, page); app = undefined
  const a = join(folder, 'a.txt')
  await rename(a, a + '.away')
  await launch(true); await tab(0, 'b.txt').waitFor(); await tab(1, 'd.txt').waitFor()
  assert.deepEqual(await order(0), ['b.txt']); assert.deepEqual(await order(1), ['d.txt', 'b.txt'])
  await closeWorkspaceWindow(app!, page); app = undefined
  await rename(a + '.away', a)
  await launch(true); await tab(0, 'a.txt').waitFor()
  assert.deepEqual(await order(0), ['a.txt', 'b.txt']); assert.deepEqual(await order(1), ['d.txt', 'b.txt'])
  assert.equal(await page.locator('.file-editor-tab[data-pinned="true"]').count(), 2)
  await tab(1, 'd.txt').click(); await idle(); await action('Fechar grupo')
  assert.deepEqual(await order(1), ['b.txt'])
  await action('Fechar todas as abas'); assert.deepEqual(await order(0), ['b.txt']); assert.deepEqual(await order(1), ['b.txt'])
  await action('Desafixar aba'); assert.equal(await page.locator('[data-pinned="true"]').count(), 0)
  await action('Fechar todas as abas'); assert.equal(await page.getByRole('tab').count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS tab drag, keyboard reordering, pinned duplicates, partial close, and explicit restoration across two restarts', scaled ? 1.25 : 1, dev ? 'dev' : 'built')
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
