import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import type { GitResult } from '../src/shared/git.ts'
import type { GitDiffHost, MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import { gitFingerprint, initializeGit } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-git-')), canonical = await realpath(profile), scope = join(canonical, 'repository')
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
const diagnostics = resolve('.local/diagnostics/git-alpha43-' + (dev ? 'dev' : scale125 ? '125' : '100'))
await mkdir(diagnostics, { recursive: true })
const git = await initializeGit(scope)
await writeFile(join(scope, 'modified.ts'), 'const answer = 2;\r\n')
await writeFile(join(scope, 'both.txt'), 'staged\n'); git(['add', 'both.txt']); await writeFile(join(scope, 'both.txt'), 'saved\r\n')
await rm(join(scope, 'deleted.txt')); git(['mv', 'rename old.txt', 'rename new.txt'])
await writeFile(join(scope, 'untracked.txt'), 'new\n'); await writeFile(join(scope, 'binary.dat'), Buffer.from([0, 255, 1])); await writeFile(join(scope, 'large.txt'), 'x'.repeat(256 * 1024 + 1))
git(['config', 'core.fsmonitor', 'cmd.exe /c echo executed > EXECUTED']); git(['config', 'diff.evil.textconv', 'cmd.exe /c echo executed > EXECUTED'])
await writeFile(join(scope, '.gitattributes'), '*.ts diff=evil\n')
const before = await gitFingerprint(scope)
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined
let page!: Page
const errors: string[] = [], evidence: Record<string, unknown> = {}
try {
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false }); await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  app.process().stderr?.on('data', data => { void writeFile(join(diagnostics, 'electron-stderr.log'), data, { flag: 'a' }) })
  page = await app.firstWindow(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1600, 1000); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true }); await enableDeveloperMode(manager)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/time-tracker'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  await manager.locator('[data-plugin="geppio.time-tracker"]').getByRole('switch').click()
  await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.time-tracker"]')?.getAttribute('data-status') === 'active')
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  const mode = async (name: 'Editor' | 'Widgets') => { await page.locator('.file-mode-switch').getByRole('button', { name, exact: true }).click(); await settle(page) }
  const picker = async (path: string) => app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  const rail = page.getByRole('navigation', { name: 'Atividades do Editor' })
  await mode('Editor')
  await page.getByRole('button', { name: 'Mostrar Terminal', exact: true }).click()
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  await page.waitForFunction(async () => { const r = await window.geppio!.terminal.read(null, 0); return r.ok && r.value.state.phase === 'running' })
  const initialTerminal = await page.evaluate(() => window.geppio!.terminal.read(null, 0)); assert.ok(initialTerminal.ok && initialTerminal.value.state.id)
  const terminalId = initialTerminal.value.state.id
  await rail.getByRole('button', { name: 'Alterações Git', exact: true }).click()
  assert.match(await page.locator('.git-changes').innerText(), /Abra uma pasta/)
  await rail.getByRole('button', { name: 'Explorador', exact: true }).click(); await picker(scope)
  await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-explorer-node]'))
  const root = await page.getByRole('treeitem', { name: 'repository', exact: true }).getAttribute('data-explorer-node'); assert.ok(root)
  await picker(join(scope, 'modified.ts')); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  const editor = fileEditor(page); await editor.waitFor()
  await editor.fill('unsaved\n' + Array.from({ length: 80 }, (_, i) => 'line ' + i).join('\n'))
  await page.locator('.monaco-host').evaluate(node => { const e = (node as MonacoHost).monacoEditor!; e.setPosition({ lineNumber: 40, column: 4 }); e.revealLineInCenter(40); e.getModel()!.pushStackElement() })
  await editor.press('x')
  const snapshot = () => page.locator('.monaco-host').evaluate(node => { const e = (node as MonacoHost).monacoEditor!, m = e.getModel()!; return { text: m.getValue(), version: m.getAlternativeVersionId(), uri: m.uri.toString(), selections: e.getSelections(), top: e.getScrollTop(), left: e.getScrollLeft() } })
  const draft = await snapshot(), identity = await page.locator('.monaco-host').evaluateHandle(node => (node as MonacoHost).monacoEditor!)
  const layout = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), workers = pluginWorkers(page)
  assert.ok(workers.length > 0, 'A real installed unrelated plugin Worker must be active')
  await rail.getByRole('button', { name: 'Alterações Git', exact: true }).click()
  await page.locator('.git-branch').waitFor(); assert.equal(await page.locator('.git-branch').innerText(), 'main')
  assert.match(await page.locator('.git-changes').innerText(), /Preparadas.*Não preparadas.*Não rastreados/s)
  const diff = async (name: string) => {
    await page.locator('.git-file').filter({ hasText: name }).first().click(); await page.locator('.git-diff[data-git-diff-models="2"]').waitFor()
    const host = page.locator('.git-diff')
    const width = await page.getByRole('dialog').evaluate(node => ({ actual: node.getBoundingClientRect().width, expected: Math.min(1100, innerWidth * .92) }))
    assert.ok(Math.abs(width.actual - width.expected) < 2, 'Git comparison uses the available wide dialog, not the generic 420px profile dialog')
    const models = await host.evaluateHandle(node => (node as GitDiffHost).monacoDiffEditor!.getModel()!)
    const values = await host.evaluate(node => { const e = (node as GitDiffHost).monacoDiffEditor!; return { original: e.getOriginalEditor().getValue(), modified: e.getModifiedEditor().getValue(), readOnly: e.getModifiedEditor().getRawOptions().readOnly, originalReadOnly: e.getOriginalEditor().getRawOptions().readOnly } })
    assert.ok(values.readOnly && values.originalReadOnly)
    await page.keyboard.press('Control+s')
    await page.screenshot({ path: join(diagnostics, 'comparison-' + name.replaceAll(' ', '-') + '.png') })
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click()
    assert.ok(await page.evaluate(models => models.original.isDisposed() && models.modified.isDisposed(), models))
    await models.dispose(); assert.deepEqual(await snapshot(), draft)
    return values
  }
  assert.deepEqual(await diff('both.txt'), { original: 'before\n', modified: 'saved\r\n', readOnly: true, originalReadOnly: true })
  assert.equal((await diff('deleted.txt')).modified, '')
  assert.equal((await diff('rename new.txt')).original, 'before\n')
  for (const name of ['untracked.txt', 'binary.dat', 'large.txt']) {
    await page.locator('.git-file').filter({ hasText: name }).first().click(); await page.locator('.git-changes [role="alert"]').waitFor(); assert.equal(await page.locator('.git-diff').count(), 0)
  }
  await page.getByRole('button', { name: 'Atualizar Git', exact: true }).click(); await page.locator('.git-branch').waitFor()
  assert.equal(await page.locator('.git-file').filter({ hasText: 'both.txt' }).count(), 2)
  assert.deepEqual(await snapshot(), draft); await editor.press('Control+z'); assert.notEqual((await snapshot()).text, draft.text); await editor.press('Control+y'); assert.equal((await snapshot()).text, draft.text)
  assert.equal(await readFile(join(scope, 'modified.ts'), 'utf8'), 'const answer = 2;\r\n')
  const negatives = await app.evaluate(async ({ ipcMain, BrowserWindow }, root) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<GitResult>> })._invokeHandlers
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, senderFrame = sender.mainFrame, handler = handlers.get('git:status')!
    return Promise.all([handler({ sender, senderFrame }, root, 'extra'), handler({ sender: {}, senderFrame }, root), handler({ sender, senderFrame: { url: senderFrame.url } }, root), handler({ sender, senderFrame: { url: 'https://example.invalid/' } }, root), handler({ sender, senderFrame }, '../escape')])
  }, root)
  assert.ok(negatives.every(r => !r.ok && r.code === 'invalid'))
  const forged = await page.evaluate(({ root, id }) => window.geppio!.git.compare(root, id), { root, id: randomUUID() }); assert.ok(!forged.ok && forged.code === 'stale')
  await mode('Widgets'); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:git-changes"]').click(); await page.locator('[data-widget-place="sidebar"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const confirmed = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY); assert.notEqual(confirmed, layout)
  for (const name of ['Editor', 'Widgets', 'Editor'] as const) { await mode(name); assert.equal(await page.locator('.git-changes').count(), 1); assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), confirmed) }
  assert.ok(await page.locator('.monaco-host').evaluate((node, identity) => (node as MonacoHost).monacoEditor === identity, identity))
  assert.deepEqual(pluginWorkers(page), workers)
  const retainedTerminal = await page.evaluate(id => window.geppio!.terminal.read(id, 0), terminalId)
  assert.ok(retainedTerminal.ok && retainedTerminal.value.state.id === terminalId && retainedTerminal.value.state.phase === 'running')
  const terminalInput = await page.evaluate(id => window.geppio!.terminal.input(id, "Write-Output ('GIT_' + 'SESSION_OK')\r"), terminalId); assert.ok(terminalInput.ok)
  await page.waitForFunction(async id => { const r = await window.geppio!.terminal.read(id, 0); return r.ok && r.value.data.includes('GIT_SESSION_OK') }, terminalId)
  for (const theme of ['light', 'dark']) {
    await page.locator('.sidebar-rail-footer').getByRole('button', { name: 'Alternar tema', exact: true }).click(); await settle(page)
    const geometry = await page.locator('.editor-explorer-panel').evaluate(node => { const body = node.querySelector('.git-changes')!, a = node.getBoundingClientRect(), b = body.getBoundingClientRect(); return { width: node.clientWidth, height: node.clientHeight, bodyWidth: b.width, bodyHeight: b.height, inside: b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom } })
    assert.ok(geometry.inside && Math.abs(geometry.width - geometry.bodyWidth) < 1 && Math.abs(geometry.height - geometry.bodyHeight) < 1, JSON.stringify(geometry))
    await page.screenshot({ path: join(diagnostics, theme + '.png') })
  }
  await mode('Widgets'); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:git-changes"]').click(); await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  assert.equal(await page.locator('.git-changes').count(), 1)
  assert.equal(await page.locator('.git-changes').evaluate(node => node.closest('.widget-frame')?.getAttribute('data-owner-region')), 'main')
  await mode('Editor')
  assert.deepEqual(await gitFingerprint(scope), before)
  await rail.getByRole('button', { name: 'Explorador', exact: true }).click(); await page.getByRole('button', { name: 'Fechar pasta', exact: true }).click()
  const stale = await page.evaluate(root => window.geppio!.git.status(root), root); assert.ok(!stale.ok && stale.code === 'stale')
  await rail.getByRole('button', { name: 'Alterações Git', exact: true }).click(); assert.equal(await page.locator('.git-branch').count(), 0)
  assert.match(await page.locator('.git-changes').innerText(), /Abra uma pasta/)
  assert.deepEqual(errors, [])
  evidence.result = 'passed: real Git status/diff, malicious config nonexecution, repository hashes/mtime, dirty Monaco identity/undo/selection/scroll, disposed models, caller negatives, grant release, shared Sidebar/activity and layout bytes'
  evidence.coexistence = 'passed: nonempty installed plugin Worker identities retained; same live PowerShell UUID accepts a command after Git inspection and mode changes'
  evidence.environment = { platform: process.platform, development: dev, dpr: await page.evaluate(() => devicePixelRatio) }
  await writeFile(join(diagnostics, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  console.error(errors)
  console.error(await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ url: win.webContents.getURL(), loading: win.webContents.isLoading(), destroyed: win.webContents.isDestroyed() }))).catch(() => []))
  await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}); await server?.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
