import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { gitFingerprint, initializeGit } from './git-fixtures.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'
import { IDENTITY } from '../src/shared/identity.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { DocumentDraft } from '../src/shared/documents.ts'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-workspace-')), root = await realpath(profile)
const project = join(root, 'project one'), other = join(root, 'project two'), standalone = join(root, 'standalone.txt')
const git = await initializeGit(project); await initializeGit(other)
await mkdir(join(project, 'nested')); const second = join(project, 'nested', 'view.txt'), first = join(project, 'modified.ts')
const lines = Array.from({ length: 120 }, (_, i) => 'line ' + i).join('\n') + '\n'
await writeFile(second, lines); git(['add', '.']); git(['commit', '-m', 'View fixture'])
await writeFile(first, 'const answer = 2;\r\n'); await writeFile(standalone, 'standalone\n')
assert.equal(git(['show', 'HEAD:modified.ts']), 'const answer = 1;\r\n')
assert.match(git(['status', '--porcelain', '--untracked-files=all']), / M modified\.ts/)
const poisoned = join(project, 'modules'), marker = join(project, 'AUTO_EXECUTED')
await mkdir(join(poisoned, 'PSReadLine'), { recursive: true })
await writeFile(join(poisoned, 'PSReadLine', 'PSReadLine.psm1'), `Set-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value 'project module executed'\n`)
const initialProject = await gitFingerprint(project), initialOther = await gitFingerprint(other)
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
const diagnostics = resolve('.local/diagnostics/workspace-alpha47-' + (dev ? 'dev' : scale125 ? '125' : '100'))
await mkdir(diagnostics, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = dev ? 'development' : 'production'
let app: ElectronApplication | undefined, server: import('vite').ViteDevServer | undefined, page!: Page
const errors: string[] = [], evidence: Record<string, unknown> = {}
const metadata = join(root, IDENTITY.directory, 'workspace-session.v1.json')
const editor = () => fileEditor(page), state = () => page.locator('.file-editor'), panel = () => page.locator('.workspace-actions')
const idle = () => page.waitForFunction(() => !document.querySelector('.workspace-controls[aria-busy="true"], .file-explorer[aria-busy="true"]') && document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
const active = async () => (await state().getAttribute('data-document-id'))!
const tab = (id: string) => page.locator(`[data-document-tab="${id}"]`)
async function menu() { const button = page.locator('.workspace-controls > button'); if (await button.getAttribute('aria-expanded') !== 'true') await button.click() }
async function dialogs(file: string | null, restore = 0, changed = [2], dirty = [2]) {
  await app!.evaluate(({ dialog }, { file, restore, changed, dirty }) => {
    dialog.showOpenDialog = async () => ({ canceled: file === null, filePaths: file === null ? [] : [file] })
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string }
      return { response: options.title === 'Restaurar projeto' ? restore : options.title === 'Arquivo alterado' ? changed.shift() ?? 2 : options.title === 'Alterações não salvas' ? dirty.shift() ?? 2 : 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, { file, restore, changed, dirty })
}
async function launch() {
  const started = performance.now()
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1600, 1000); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  await page.waitForFunction(async () => (await window.geppio!.workspace.read()).ok)
  evidence.launchMs = Math.round(performance.now() - started)
}
async function openProject(path: string | null) {
  await dialogs(path); await menu(); await panel().getByRole('button', { name: /^(Abrir|Trocar) projeto$/ }).click(); await idle(); await settle(page)
}
async function openFile(path: string) { await dialogs(path); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click(); await idle() }
async function closeWindow() { const closed = app!.waitForEvent('close'); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()); await closed; app = undefined }
async function startTerminal(path: string, label: string) {
  await page.getByRole('button', { name: /^(Iniciar|Reiniciar) terminal$/ }).click()
  await page.waitForFunction(async () => { const result = await window.geppio!.terminal.read(null, 0); return result.ok && result.value.state.phase === 'running' })
  const running = await page.evaluate(() => window.geppio!.terminal.read(null, 0)); assert.ok(running.ok && running.value.state.id)
  assert.equal((await realpath(running.value.state.cwd)).toLowerCase(), (await realpath(path)).toLowerCase())
  const input = await page.evaluate(({ id, label }) => window.geppio!.terminal.input(id, `Write-Output ('${label}' + (Get-Location).ProviderPath + '_END')\r`), { id: running.value.state.id, label }); assert.ok(input.ok)
  await page.waitForFunction(async ({ id, label, path }) => { const result = await window.geppio!.terminal.read(id, 0); return result.ok && result.value.data.toLowerCase().includes((label + path + '_END').toLowerCase()) }, { id: running.value.state.id, label, path: await realpath(path) })
  return running.value.state.id
}
async function stopTerminal(id: string) { await page.getByRole('button', { name: 'Encerrar', exact: true }).click(); await page.waitForFunction(async id => { const result = await window.geppio!.terminal.read(id, 0); return result.ok && ['closed', 'exited'].includes(result.value.state.phase) }, id) }
const view = () => page.locator('.monaco-host').evaluate(node => { const e = (node as MonacoHost).monacoEditor!, m = e.getModel()!; return { value: m.getValue(), language: m.getLanguageId(), uri: m.uri.toString(), position: e.getPosition(), top: e.getScrollTop() } })
try {
  if (dev) {
    const { loadConfigFromFile } = await import('electron-vite'), { createServer } = await import('vite')
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'electron.vite.config.ts')
    server = await createServer({ ...config.config.renderer, root: resolve('src/renderer'), configFile: false }); await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  await launch(); assert.equal(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), '')
  const fresh = await page.evaluate(() => window.geppio!.workspace.read()); assert.ok(fresh.ok && !fresh.value.root && !fresh.value.recovery)
  await assert.rejects(readFile(metadata))
  await page.getByRole('button', { name: 'Plugins', exact: true }).click(); const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await enableDeveloperMode(manager); await dialogs(resolve('.local/plugin-packages/time-tracker'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click(); await manager.locator('[data-plugin="geppio.time-tracker"]').getByRole('switch').click()
  await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.time-tracker"]')?.getAttribute('data-status') === 'active')
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); const workers = pluginWorkers(page); assert.ok(workers.length)
  const layout = await raw(); await openProject(project)
  assert.equal(await raw(), layout); assert.equal(await page.locator('.project-context h1').innerText(), 'project one')
  const rootId = await page.getByRole('treeitem', { name: 'project one', exact: true }).getAttribute('data-explorer-node'); assert.ok(rootId)
  await page.waitForFunction(() => document.querySelector('[role="treeitem"][aria-label="modified.ts"] .explorer-git-badge')?.textContent === 'M')
  await openFile(first); const a = await active(); await editor().fill('const answer = 7;\n')
  await openFile(second); const b = await active(); await editor().fill('second dirty\n' + lines)
  const initialA = await readFile(first, 'utf8'), initialB = await readFile(second, 'utf8')
  await openProject(null); assert.equal(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), rootId)
  assert.equal(await active(), b); assert.equal(await editor().inputValue(), 'second dirty\n' + lines)
  const oldGit = await page.evaluate(root => window.geppio!.git.status(root), rootId); assert.ok(oldGit.ok && oldGit.status)
  await page.getByRole('button', { name: 'Mostrar Terminal', exact: true }).click()
  await app!.evaluate((_, path) => { process.env.PSMODULEPATH = path }, poisoned)
  const terminalA = await startTerminal(project, 'WS_A_'), terminalLayout = await raw()
  await assert.rejects(readFile(marker)); await openProject(other)
  assert.equal(await raw(), terminalLayout); assert.equal(await page.locator('.project-context h1').innerText(), 'project two')
  assert.equal(await page.getByRole('tab').count(), 2); assert.equal(await active(), b)
  assert.equal(await state().getAttribute('data-document-scope'), 'Arquivo avulso')
  const retained = await page.evaluate(id => window.geppio!.terminal.read(id, 0), terminalA); assert.ok(retained.ok && retained.value.state.phase === 'running' && retained.value.state.id === terminalA)
  assert.equal(retained.value.state.cwd, project)
  await page.waitForFunction(() => document.querySelector('.explorer-git-status')?.textContent?.includes('árvore limpa'))
  const staleGit = await page.evaluate(root => window.geppio!.git.status(root), rootId); assert.ok(!staleGit.ok && staleGit.code === 'stale')
  assert.equal(await page.locator('.explorer-git-badge').count(), 0)
  await tab(a).click(); await idle(); await editor().press('Control+s'); await idle()
  assert.equal(await readFile(first, 'utf8'), 'const answer = 7;\r\n'); assert.equal(await readFile(second, 'utf8'), initialB); assert.notEqual(await readFile(first, 'utf8'), initialA)
  await stopTerminal(terminalA); const terminalB = await startTerminal(other, 'WS_B_')
  await menu(); await panel().getByRole('button', { name: 'Fechar projeto', exact: true }).click(); await idle()
  assert.equal(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), ''); assert.equal(await page.getByRole('tab').count(), 2)
  const stillB = await page.evaluate(id => window.geppio!.terminal.read(id, 0), terminalB); assert.ok(stillB.ok && stillB.value.state.id === terminalB && stillB.value.state.cwd === other)
  await stopTerminal(terminalB); const home = await startTerminal(homedir(), 'WS_HOME_'); await stopTerminal(home)
  await assert.rejects(readFile(marker)); assert.deepEqual(await gitFingerprint(other), initialOther)
  const changedProject = await gitFingerprint(project)
  for (const [name, fingerprint] of Object.entries(initialProject)) if (name !== 'modified.ts') assert.equal(changedProject[name], fingerprint, 'Workspace/terminal never modify project bytes or Git metadata')
  assert.deepEqual(pluginWorkers(page), workers)
  evidence.authority = 'First launch, explicit/canceled open, two independent dirty files, project switch/close retention, stale Git revocation, current Git decorations, active-only save, project/new-project/home real PowerShell cwd, running PTY continuity, poisoned module nonexecution and unchanged project/Git files'
  console.log('Workspace: native authority, cwd and nonmutation passed')

  await openProject(project); await tab(b).click(); await idle(); await editor().press('Control+s'); await idle()
  await page.getByRole('combobox', { name: 'Linguagem do documento' }).selectOption({ label: 'Markdown' })
  await page.locator('.monaco-host').evaluate(node => { const e = (node as MonacoHost).monacoEditor!; e.setPosition({ lineNumber: 50, column: 3 }); e.revealLineInCenter(50) })
  const expected = await view()
  // Capture the actual old revision through the registered ID-only activation, without changing a model.
  const oldResult = await page.evaluate(id => window.geppio!.documents.activate(id), b); assert.ok(oldResult.ok && oldResult.document)
  const oldDraft: DocumentDraft = { id: b, revision: oldResult.document.revision, text: 'forbidden' }
  await closeWindow(); await launch(); assert.equal(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), '')
  const offered = await page.evaluate(() => window.geppio!.workspace.read()); assert.ok(offered.ok && offered.value.recovery?.tabs === 2)
  await dialogs(null, 1); await menu(); await panel().getByRole('button', { name: 'Restaurar projeto anterior', exact: true }).click(); await idle()
  assert.equal(await page.getByRole('tab').count(), 0)
  await dialogs(null, 0); await panel().getByRole('button', { name: 'Restaurar projeto anterior', exact: true }).click(); await idle(); await settle(page)
  await page.getByRole('tab').first().waitFor()
  assert.equal(await page.getByRole('tab').count(), 2); assert.notEqual(await active(), b)
  const recovered = await view(); assert.equal(recovered.value, expected.value); assert.equal(recovered.language, expected.language); assert.deepEqual(recovered.position, expected.position); assert.ok(Math.abs(recovered.top - expected.top) < 2, 'Clean primary selection and scroll restore')
  const oldRejected = await page.evaluate(draft => window.geppio!.documents.save(draft), oldDraft); assert.ok(!oldRejected.ok && oldRejected.code === 'stale')
  const rawMetadata = await readFile(metadata, 'utf8'); assert.equal(rawMetadata.includes('second dirty'), false); assert.equal(rawMetadata.includes(b), false)
  evidence.recovery = 'Explicit consent, metadata-only persistence, fresh grants, active file/clean language/primary selection/scroll, stale previous-session save rejection'
  console.log('Workspace: clean restoration passed')

  await closeWindow(); await writeFile(first, 'external changed\n'); await launch()
  await dialogs(null, 0, [2]); await menu(); await panel().getByRole('button', { name: 'Restaurar projeto anterior', exact: true }).click(); await idle()
  assert.equal(await page.getByRole('tab').count(), 0); assert.equal(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), '')
  await dialogs(null, 0, [0]); await panel().getByRole('button', { name: 'Restaurar projeto anterior', exact: true }).click(); await idle()
  assert.equal(await readFile(first, 'utf8'), 'external changed\n'); assert.equal(await page.getByRole('tab').count(), 2)
  await menu(); await dialogs(null); await panel().getByRole('button', { name: 'Abrir arquivo avulso', exact: true }).click(); await idle()
  assert.notEqual(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), '', 'Canceled standalone picker does not close the project')
  await dialogs(standalone); await panel().getByRole('button', { name: 'Abrir arquivo avulso', exact: true }).click(); await idle()
  assert.equal(await editor().inputValue(), 'standalone\n'); assert.equal(await state().getAttribute('data-document-scope'), 'Arquivo avulso'); assert.equal(await page.getByRole('tab').count(), 3)
  assert.equal(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), '')
  await closeWindow(); await rename(project, join(root, 'moved-project')); await launch()
  await dialogs(null); await menu(); await panel().getByRole('button', { name: 'Restaurar projeto anterior', exact: true }).click(); await idle()
  assert.equal(await page.locator('.workspace-controls').getAttribute('data-workspace-root'), ''); assert.ok(await panel().getByRole('status').count())
  await panel().getByRole('button', { name: 'Esquecer recuperação local', exact: true }).click(); await idle()
  const forgotten = await page.evaluate(() => window.geppio!.workspace.read()); assert.ok(forgotten.ok && !forgotten.value.recovery && !forgotten.value.remember)
  evidence.transitions = 'Changed-file recovery Cancel/Current decisions, missing project feedback, independent standalone picker with non-destructive Cancel, explicit forgetting without touching documents'

  // Empty project-bearing window close must checkpoint an empty tab registry.
  await openProject(other); await menu(); await panel().getByRole('checkbox').click(); await idle()
  await page.waitForFunction(async () => { const result = await window.geppio!.workspace.read(); return result.ok && result.value.remember && (document.querySelector('.workspace-actions input') as HTMLInputElement | null)?.checked })
  if (await page.locator('.workspace-controls > button').getAttribute('aria-expanded') === 'true') await page.locator('.workspace-controls > button').click()
  await openFile(join(other, 'modified.ts')); await page.getByRole('button', { name: 'Fechar arquivo', exact: true }).click(); await idle()
  await closeWindow(); await launch(); const empty = await page.evaluate(() => window.geppio!.workspace.read()); assert.ok(empty.ok && empty.value.recovery?.tabs === 0)
  await dialogs(null); await menu(); await panel().getByRole('button', { name: 'Restaurar projeto anterior', exact: true }).click(); await idle(); assert.equal(await page.getByRole('tab').count(), 0)
  for (const theme of ['light', 'dark']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const width of [1024, 1600]) {
      await app!.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 900), width); await settle(page)
      const geometry = await page.locator('.context-bar').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, dpr: devicePixelRatio }))
      assert.equal(geometry.width, geometry.scroll); assert.ok(Math.abs(geometry.dpr - (scale125 ? 1.25 : 1)) < .01)
    }
    await page.screenshot({ path: join(diagnostics, theme + '.png') })
  }
  const negatives = await app!.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<{ ok: boolean }>> })._invokeHandlers
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, senderFrame = sender.mainFrame, event = { sender, senderFrame }
    return Promise.all([
      handlers.get('workspace:restore')!(event, 'C:\\private'),
      handlers.get('workspace:configure')!(event, 'C:\\private'),
      handlers.get('workspace:remember')!(event, { active: null, tabs: [], source: 'private' }),
      handlers.get('workspace:read')!({ sender: {}, senderFrame }),
      handlers.get('workspace:read')!({ sender, senderFrame: { url: senderFrame.url } }),
      handlers.get('workspace:read')!({ sender, senderFrame: { url: 'https://example.invalid' } })
    ])
  })
  assert.ok(negatives.every(result => !result.ok)); assert.equal(await page.evaluate(() => 'process' in window || 'require' in window), false)
  await closeWindow(); await writeFile(metadata, 'x'.repeat(512 * 1024 + 1)); await launch(); await menu()
  assert.ok(await panel().getByRole('status').count()); await panel().getByRole('button', { name: 'Esquecer recuperação local', exact: true }).click(); await idle()
  const cleared = await page.evaluate(() => window.geppio!.workspace.read()); assert.ok(cleared.ok && !cleared.value.error && !cleared.value.recovery)
  assert.deepEqual(errors, []); evidence.environment = { platform: process.platform, dev, dpr: scale125 ? 1.25 : 1 }; evidence.emptyClose = 'Closing the last tab then immediately exiting does not resurrect it'
  evidence.security = 'Actual Main handlers reject paths/source/extra fields and wrong owner/frame/URL; no renderer Node; oversized metadata is explicitly reset without reading unbounded contents'
  await writeFile(join(diagnostics, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {})
  if (page) {
    const runtime = await page.evaluate(async () => { const workspace = await window.geppio!.workspace.read(); return { workspace, git: workspace.ok && workspace.value.root ? await window.geppio!.git.status(workspace.value.root.id) : null, rows: [...document.querySelectorAll('[role="treeitem"]')].map(node => ({ name: node.getAttribute('aria-label'), badge: node.querySelector('.explorer-git-badge')?.textContent })) } }).catch(() => null)
    const fixtureRead = (args: string[]) => { try { return git(args) } catch { return null } }
    await writeFile(join(diagnostics, 'failure.json'), JSON.stringify({ error: String(error), runtime, fixtureStatus: fixtureRead(['status', '--porcelain', '--untracked-files=all']), fixtureHead: fixtureRead(['show', 'HEAD:modified.ts']), disk: await readFile(first, 'utf8').catch(() => null), fingerprintUnchanged: JSON.stringify(await gitFingerprint(project).catch(() => null)) === JSON.stringify(initialProject) }, null, 2))
  }
  throw error
}
finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {})
  await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
