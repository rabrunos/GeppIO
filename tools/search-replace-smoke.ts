import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { portugueseFixture } from './freeform-smoke.ts'
import { fileEditor } from './monaco-support.ts'
import { electron } from './test-electron.ts'

const fixture = await mkdtemp(join(tmpdir(), 'geppio-smoke-search-replace-'))
const profile = join(fixture, 'profile'), project = join(await realpath(fixture), 'project')
const scaled = process.argv.includes('--scale125'), dev = process.argv.includes('--dev')
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
type RememberProbe = typeof globalThis & { replaceRemember: { entered: boolean; applyEntered: boolean; release(): void } }
try {
  await mkdir(profile); await mkdir(join(project, 'src'), { recursive: true })
  const target = (name: string) => join(project, 'src', name)
  const original = '\ufeffcafé\r\ncafé\rfim\n'
  await writeFile(target('a.txt'), original)
  for (const name of ['b.txt', 'c.txt', 'd.txt', 'ignore.md']) await writeFile(target(name), 'café')
  await writeFile(join(project, 'outside.txt'), 'café')
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
  env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false })
    await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  app = await electron.launch({ args: ['.', ...(scaled ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(), editor = fileEditor(page), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1440, 960); win.show(); win.focus()
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scaled ? 1.25 : 1)
  await page.getByRole('button', { name: 'GeppIO Code', exact: true }).click()
  await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta' }).click()
  await page.getByRole('treeitem', { name: 'src', exact: true }).click()
  await page.getByRole('treeitem', { name: 'a.txt', exact: true }).click()
  await page.getByRole('tab', { name: /a\.txt/ }).waitFor()
  await page.getByRole('treeitem', { name: 'c.txt', exact: true }).click()
  await page.getByRole('tab', { name: /c\.txt/ }).waitFor()
  await editor.press('Control+End'); await page.keyboard.insertText(' rascunho')
  await page.locator('.file-editor[data-document-status="dirty"]').waitFor()
  await page.getByRole('button', { name: 'Busca no projeto', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Busca no projeto', exact: true })
  const button = (name: string) => panel.getByRole('button', { name, exact: true })
  await panel.getByText('Filtrar arquivos', { exact: true }).click()
  await panel.getByLabel('Caminho relativo').fill('src/')
  await panel.getByLabel('Extensões', { exact: true }).fill('TXT')
  await panel.getByLabel('Texto a buscar').fill('café')
  await button('Buscar').click()
  await panel.getByRole('status').filter({ hasText: 'Ocorrências: 5' }).waitFor()
  await panel.getByText('Substituir ocorrências', { exact: true }).click()
  await panel.getByLabel('Substituir por').fill('$&🌱')
  await panel.getByLabel('Selecionar todas as ocorrências').check()
  await panel.getByLabel('Selecionar src/a.txt, linha 2, coluna 1', { exact: true }).uncheck()
  await button('Gerar prévia').click()
  const preview = panel.getByRole('region', { name: 'Prévia da substituição' })
  await preview.getByText(/src\/c\.txt.*Excluído/).waitFor()
  assert.equal(await readFile(target('a.txt'), 'utf8'), original)
  await button('Cancelar prévia').click()
  assert.equal(await readFile(target('b.txt'), 'utf8'), 'café')
  await button('Gerar prévia').click()
  await preview.getByText(/src\/a\.txt.*Aba aberta/).waitFor()
  // Change the second eligible file after the preview. The first must still be adopted.
  const eligible = await preview.getByRole('listitem').filter({ hasNotText: 'Excluído' }).allTextContents()
  const names = eligible.map(row => row.split(' · ')[0]!.slice(4))
  assert.deepEqual(names, ['a.txt', 'b.txt', 'd.txt'])
  // The user can confirm while the editor's debounced cursor metadata is being flushed.
  // Hold only this test profile's metadata write until the real apply handler enters.
  await app.evaluate(async ({ app, ipcMain }) => {
    const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises')
    const path = process.getBuiltinModule('path') as typeof import('node:path')
    const slot = path.join(await fs.realpath(app.getPath('userData')), '.workspace-session.v1.tmp')
    const open = fs.open, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    const apply = handlers.get('search:applyFile')!
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const probe = { entered: false, applyEntered: false, release }
    ;(globalThis as RememberProbe).replaceRemember = probe
    fs.open = async (...args) => {
      if (String(args[0]) === slot && args[1] === 'wx') {
        fs.open = open; probe.entered = true; await wait
      }
      return open(...args)
    }
    handlers.set('search:applyFile', (...args) => {
      handlers.set('search:applyFile', apply)
      probe.applyEntered = true
      try { return apply(...args) } finally { release() }
    })
  })
  await editor.press('Control+Home')
  await app.evaluate(async () => {
    const deadline = Date.now() + 15000
    while (!(globalThis as RememberProbe).replaceRemember.entered) {
      if (Date.now() >= deadline) throw new Error('The editor did not flush its changed cursor metadata')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  })
  await writeFile(target(names[1]!), 'edição externa')
  await button('Confirmar substituição').click()
  await preview.getByText(/Recusado/).waitFor()
  const receipts = await preview.getByRole('listitem').allTextContents()
  assert.ok(await app.evaluate(() => (globalThis as RememberProbe).replaceRemember.applyEntered))
  assert.match(receipts[0]!, /src\/a\.txt.*Confirmado/, JSON.stringify(receipts))
  assert.match(receipts[1]!, /src\/b\.txt.*Recusado/, JSON.stringify(receipts))
  assert.match(receipts[3]!, /src\/d\.txt.*Não executado/, JSON.stringify(receipts))
  assert.equal(await readFile(target(names[1]!), 'utf8'), 'edição externa')
  assert.equal(await readFile(target('d.txt'), 'utf8'), 'café')
  await page.getByRole('tab', { name: /a\.txt/ }).click()
  assert.equal(await readFile(target('a.txt'), 'utf8'), '\ufeff$&🌱\r\ncafé\rfim\n')
  assert.deepEqual((await editor.inputValue()).split(/\r\n|\r|\n/), ['$&🌱', 'café', 'fim', ''])
  await page.getByRole('tab', { name: /c\.txt/ }).click()
  assert.equal(await editor.inputValue(), 'café rascunho')
  for (const path of [target('c.txt'), target('ignore.md'), join(project, 'outside.txt')]) assert.equal(await readFile(path, 'utf8'), 'café')
  assert.deepEqual(errors, [])
  console.log('PASS filtered literal replacement, selected spans, dirty exclusion, cancellation, stale file, confirmed prefix and open Monaco adoption')
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => { (globalThis as Partial<RememberProbe>).replaceRemember?.release(); BrowserWindow.getAllWindows().forEach(win => win.destroy()) }).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await server?.close(); await rm(fixture, { recursive: true, force: true, maxRetries: 5 }) }
}
