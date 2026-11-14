import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { ExplorerResult } from '../src/shared/explorer.ts'
import type { DocumentResult } from '../src/shared/documents.ts'

const scale125 = process.argv.includes('--scale125')
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-explorer-')), canonical = await realpath(profile), scope = join(canonical, 'scope')
const diagnostics = resolve('.local/diagnostics/explorer-alpha39' + (scale125 ? '-125' : ''))
await mkdir(diagnostics, { recursive: true }); await mkdir(scope); await mkdir(join(scope, 'nested')); await mkdir(join(scope, 'empty'))
await writeFile(join(scope, 'first.ts'), '\ufeffconst café = 1;\r\n'); await writeFile(join(scope, 'second.json'), '{"n":2}\n')
await writeFile(join(scope, 'nested', 'inside.txt'), 'inside\n'); await writeFile(join(scope, 'binary.dat'), Buffer.from([0, 255, 1]))
await writeFile(join(scope, 'oversized.txt'), 'x'.repeat(1024 * 1024 + 1))
await mkdir(join(scope, 'z-large'))
await Promise.all(Array.from({ length: 513 }, (_, i) => writeFile(join(scope, 'z-large', `f${i}.txt`), '')))
let deep = join(scope, 'z-deep'); await mkdir(deep)
for (let i = 0; i < 16; i++) { deep = join(deep, 'd'); await mkdir(deep) }
await writeFile(join(deep, 'leaf.txt'), 'deep')
for (let i = 0; i < 60; i++) await writeFile(join(scope, `row-${String(i).padStart(2, '0')}-${'long'.repeat(12)}.txt`), 'text')
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], evidence: Record<string, string> = {}
const tree = () => page.getByRole('tree', { name: 'Arquivos da pasta' })
const item = (name: string) => tree().getByRole('treeitem', { name, exact: true })
const text = () => page.getByRole('textbox', { name: 'Conteúdo do arquivo', exact: true })
const mode = async (value: 'Editor' | 'Widgets') => { await page.locator('.file-mode-switch').getByRole('button', { name: value, exact: true }).click(); await settle(page) }
const idle = () => page.waitForFunction(() => !document.querySelector('.file-explorer[aria-busy="true"]') && document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
async function picker(path: string | null = scope, response = 2) {
  await app!.evaluate(({ dialog }, { path, response }) => {
    dialog.showOpenDialog = async () => ({ canceled: path === null, filePaths: path === null ? [] : [path] })
    dialog.showMessageBox = (async () => ({ response, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, { path, response })
}
async function place(type: string, region: string) {
  await page.locator(`[data-catalog-type="${type}"]`).click(); await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
}
async function refresh() { await page.getByRole('button', { name: 'Atualizar árvore', exact: true }).click(); await idle() }
try {
  app = await electron.launch({ args: [...(scale125 ? ['--force-device-scale-factor=1.25'] : []), '.'], env }); page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1600, 1000); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  await mode('Editor')
  const rail = page.getByRole('navigation', { name: 'Atividades do Editor' })
  assert.equal(await rail.getByRole('button', { name: 'Explorador', exact: true }).count(), 1)
  assert.equal(await rail.locator('[data-bar-id]').count(), 0)
  const openFolder = () => page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta', exact: true }).click()
  await picker(null); await openFolder(); await idle(); assert.equal(await tree().count(), 0)
  await picker(); await openFolder(); await idle()
  assert.equal(await item('scope').getAttribute('aria-expanded'), 'true')
  assert.equal(await item('nested').getAttribute('aria-expanded'), 'false'); assert.equal(await item('inside.txt').count(), 0)
  const names = await tree().getByRole('treeitem').evaluateAll(nodes => nodes.slice(1, 3).map(node => node.getAttribute('aria-label')))
  assert.deepEqual(names, ['empty', 'nested'])
  await item('empty').click(); await idle(); assert.equal(await page.getByText('Pasta vazia', { exact: true }).count(), 1)
  await item('empty').click(); await idle()
  await item('z-large').click(); await idle(); assert.match(await page.getByRole('alert').innerText(), /512 entradas/)
  await item('z-large').click(); await idle()
  if (process.platform === 'win32') {
    const denied = join(scope, 'z-denied'); await mkdir(denied); await refresh()
    execFileSync('icacls.exe', [denied, '/deny', '*S-1-1-0:(RD)'], { stdio: 'pipe' })
    try {
      await item('z-denied').click(); await idle(); assert.match(await page.getByRole('alert').innerText(), /permissões/)
    } finally { execFileSync('icacls.exe', [denied, '/remove:d', '*S-1-1-0'], { stdio: 'pipe' }) }
    await refresh(); assert.equal(await page.getByRole('alert').count(), 0)
    await item('z-denied').click(); await idle()
  }
  await item('z-deep').click(); await idle()
  for (let i = 0; i < 16; i++) { await tree().getByRole('treeitem', { name: 'd', exact: true }).nth(i).click(); await idle() }
  assert.equal(await item('leaf.txt').getAttribute('aria-level'), '19')
  await item('nested').click(); await idle(); assert.equal(await item('inside.txt').count(), 1)
  await item('nested').focus(); await page.keyboard.press('ArrowLeft'); assert.equal(await item('nested').getAttribute('aria-expanded'), 'false')
  await page.keyboard.press('ArrowRight'); await idle(); await page.keyboard.press('ArrowRight')
  assert.equal(await item('inside.txt').evaluate(node => document.activeElement === node), true)
  assert.equal(await item('inside.txt').getAttribute('tabindex'), '0'); assert.equal(await tree().locator('[tabindex="0"]').count(), 1)
  await page.keyboard.press('Enter'); await idle(); assert.equal(await text().inputValue(), 'inside\n')
  await item('first.ts').click(); await idle(); const id = await page.locator('.file-editor').getAttribute('data-document-id')
  await text().fill('const café = 42;\n'); await picker(scope, 2)
  await item('second.json').click(); await idle(); assert.equal(await text().inputValue(), 'const café = 42;\n')
  assert.equal(await item('first.ts').getAttribute('aria-selected'), 'true'); assert.equal(await item('second.json').getAttribute('aria-selected'), 'false')
  for (const name of ['binary.dat', 'oversized.txt']) { await item(name).click(); await idle(); assert.equal(await text().inputValue(), 'const café = 42;\n'); assert.equal(await page.locator('.file-editor').getAttribute('data-document-id'), id) }
  await picker(scope, 0); await item('second.json').click(); await idle(); assert.equal(await readFile(join(scope, 'first.ts'), 'utf8'), '\ufeffconst café = 42;\r\n')
  await text().fill('{"draft":true}\n'); await picker(scope, 1); await item('inside.txt').click(); await idle(); assert.equal(await text().inputValue(), 'inside\n')
  assert.equal(await readFile(join(scope, 'second.json'), 'utf8'), '{"n":2}\n')
  await refresh(); await item('first.ts').click(); await idle(); await text().fill('saved tree\n'); await text().press('Control+s'); await idle()
  assert.equal(await readFile(join(scope, 'first.ts'), 'utf8'), '\ufeffsaved tree\r\n')
  await text().fill('retained draft'); await writeFile(join(scope, 'first.ts'), '\ufeffEXTERNAL\r\n'); await text().press('Control+s'); await idle()
  assert.equal(await page.locator('.file-editor').getAttribute('data-document-status'), 'conflict'); assert.equal(await text().inputValue(), 'retained draft')
  await picker(scope, 1); await item('inside.txt').click(); await idle(); await text().fill('shared dirty draft')
  evidence.documents = 'passed: real preload/Main tree open, keyboard, Save/Discard/Cancel, binary/oversize retention, BOM/CRLF exact save and conflict'

  const beforeChrome = await raw()
  await rail.getByRole('button', { name: 'Explorador', exact: true }).click(); await settle(page)
  assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), 'hidden')
  await rail.getByRole('button', { name: 'Explorador', exact: true }).click(); await settle(page)
  assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), 'docked')
  const separator = page.getByRole('separator', { name: 'Largura da Sidebar', exact: true })
  await separator.focus(); await separator.press('End'); await text().focus(); await settle(page)
  const panelBox = await page.locator('.editor-explorer-panel').boundingBox(), explorerBox = await page.locator('.file-explorer').boundingBox()
  assert.ok(panelBox && explorerBox && Math.abs(panelBox.height - explorerBox.height) < 2 && explorerBox.height > 500)
  await separator.focus(); await separator.press('Home'); await text().focus(); await settle(page)
  assert.equal(await page.locator('.explorer-scroll').evaluate(node => node.scrollWidth <= node.clientWidth), true)
  assert.ok(await item('leaf.txt').locator('.explorer-name').evaluate(node => node.clientWidth >= 16), 'Deep indentation retains a usable name at minimum Sidebar width')
  assert.equal(await raw(), beforeChrome)
  await picker(null); await openFolder(); await idle(); assert.equal(await item('inside.txt').count(), 1)
  evidence.rail = 'passed: only Explorer, toggle collapse/reopen, original splitter min/max, full-height panel and unchanged persisted chrome'

  // Validate registered handlers, not just exposed TypeScript wrappers.
  const negatives = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<ExplorerResult | DocumentResult>> })._invokeHandlers
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, senderFrame = sender.mainFrame, event = { sender, senderFrame }
    return Promise.all([
      handlers.get('explorer:select')!(event, 'C:\\private'),
      handlers.get('explorer:list')!(event, 'bad', 'bad'),
      handlers.get('explorer:open')!(event, 'bad', 'bad', null),
      handlers.get('explorer:select')!({ sender: {}, senderFrame }),
      handlers.get('explorer:select')!({ sender, senderFrame: { url: senderFrame.url } }),
      handlers.get('explorer:select')!({ sender, senderFrame: { url: 'https://example.invalid' } })
    ])
  })
  assert.ok(negatives.every(value => !value.ok && value.code === 'invalid'))
  const forged = await page.evaluate(id => window.geppio!.explorer.list(id, id), randomUUID()); assert.ok(!forged.ok && forged.code === 'stale')
  evidence.native = 'passed: actual handlers refuse malformed shape, paths, forged reference, wrong window/main frame/origin'

  await mode('Widgets'); assert.equal(await page.locator('.sidebar-rail [data-bar-id="home"]').count(), 1)
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.getByRole('button', { name: 'Nova barra', exact: true }).click()
  const barDialog = page.getByRole('dialog', { name: 'Nova barra', exact: true })
  await barDialog.getByRole('textbox', { name: 'Nome', exact: true }).fill('Smoke Explorer')
  await barDialog.getByRole('button', { name: 'Criar barra', exact: true }).click(); await barDialog.waitFor({ state: 'detached' }); await settle(page)
  await place('host:file-explorer', 'sidebar'); await place('host:file-editor', 'main')
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const layout = await raw(), workers = page.workers()
  const activeBar = await page.locator('.workbench').getAttribute('data-active-bar')
  assert.equal(await page.getByRole('navigation', { name: 'Barras do usuário' }).getByRole('button', { name: 'Smoke Explorer', exact: true }).getAttribute('aria-current'), 'true')
  assert.equal(await text().inputValue(), 'shared dirty draft'); assert.equal(await item('nested').getAttribute('aria-expanded'), 'true')
  const scroll = page.locator('.explorer-scroll')
  await scroll.evaluate(node => { node.scrollTop = 180 }); await page.waitForFunction(() => (document.querySelector('.explorer-scroll')?.scrollTop ?? 0) > 100)
  const scrollTop = await scroll.evaluate(node => node.scrollTop)
  for (const value of ['Editor', 'Widgets', 'Editor', 'Widgets'] as const) {
    await mode(value); await idle(); assert.equal(await text().inputValue(), 'shared dirty draft'); assert.equal(await raw(), layout)
    assert.equal(await page.locator('.workbench').getAttribute('data-active-bar'), activeBar)
    assert.equal(await item('nested').getAttribute('aria-expanded'), 'true'); assert.equal(await tree().count(), 1)
    assert.equal(await scroll.evaluate(node => node.scrollTop), scrollTop); assert.deepEqual(page.workers(), workers)
  }
  // Explicitly move the same official Explorer from Sidebar to Main through the host catalog.
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:file-explorer"]').click()
  await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  assert.equal(await tree().count(), 1); assert.equal(await item('nested').getAttribute('aria-expanded'), 'true')
  evidence.modes = 'passed: explicit Sidebar/Main widget, one tree, same navigation/scroll/draft and exact layout bytes through repeated mode switches'

  await mode('Editor'); await page.locator('.explorer-scroll').evaluate(node => { node.scrollTop = 0 })
  // A changed authorized ancestor is refused by the native bridge and does not drop the current draft.
  await rename(join(scope, 'nested'), join(scope, 'renamed')); await mkdir(join(scope, 'nested')); await writeFile(join(scope, 'nested', 'inside.txt'), 'replacement')
  await item('inside.txt').click(); await idle(); assert.equal(await text().inputValue(), 'shared dirty draft')
  await refresh(); await item('nested').click(); await idle(); assert.equal(await item('inside.txt').count(), 1)
  const oldRoot = await item('scope').getAttribute('data-explorer-node'); assert.ok(oldRoot)
  await page.getByRole('button', { name: 'Fechar pasta', exact: true }).click(); await idle()
  assert.equal(await tree().count(), 0); assert.equal(await text().inputValue(), 'shared dirty draft')
  const released = await page.evaluate(id => window.geppio!.explorer.list(id, id), oldRoot); assert.ok(!released.ok && released.code === 'stale')
  await picker(); await openFolder(); await idle()
  const navigationRoot = await item('scope').getAttribute('data-explorer-node'); assert.ok(navigationRoot)
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const revoked = await page.evaluate(id => window.geppio!.explorer.list(id, id), navigationRoot); assert.ok(!revoked.ok && revoked.code === 'stale')
  evidence.revocation = 'passed: changed ancestor retains draft, refresh, root release retains document, real navigation revokes old reference'

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => localStorage.setItem('geppio:theme:v1', theme), theme); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    await mode('Editor'); await picker(); await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta', exact: true }).click(); await idle()
    await page.screenshot({ path: join(diagnostics, theme + '.png') })
    const size = await item('scope').boundingBox(); assert.ok(size && size.height === 24)
    assert.equal(await item('scope').evaluate(node => getComputedStyle(node).fontSize), '12px')
  }
  assert.equal(await page.evaluate(() => 'require' in window || 'process' in window), false)
  assert.deepEqual(errors, [])
  evidence.themes = `passed: compact 24px/12px tree, both themes, narrow/wide widths, simulated DPR ${scale125 ? '1.25' : '1'}`
  await writeFile(join(diagnostics, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2))
} catch (error) { await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {}); throw error }
finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {})
  await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
