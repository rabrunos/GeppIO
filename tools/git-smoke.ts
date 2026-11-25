import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron } from './test-electron.ts'
import type { ElectronApplication, Page } from 'playwright'
import type { GitResult } from '../src/geppio/src/shared/git.ts'
import { parseGitStatus } from '../src/geppio/src/main/git.ts'
import type { GitStatus } from '../src/geppio/src/shared/git.ts'
import type { GitDiffHost, MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { gitFingerprint, ignoredGitTrees, initializeGit } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-git-')), canonical = await realpath(profile), scope = join(canonical, 'repository')
const dev = process.argv.includes('--dev'), scale125 = process.argv.includes('--scale125')
const diagnostics = resolve('.local/diagnostics/git-alpha45-' + (dev ? 'dev' : scale125 ? '125' : '100'))
await mkdir(diagnostics, { recursive: true })
const git = await initializeGit(scope)
await mkdir(join(scope, 'nested')); await writeFile(join(scope, 'nested', 'tracked.ts'), 'before\n')
git(['add', 'nested/tracked.ts']); git(['commit', '-m', 'Nested fixture'])
await writeFile(join(scope, 'nested', 'tracked.ts'), 'after\n'); await writeFile(join(scope, 'nested', 'new.ts'), 'new\n')
await writeFile(join(scope, 'added.txt'), 'added\n'); git(['add', 'added.txt'])
await writeFile(join(scope, '.env.example'), 'example\n')
await writeFile(join(scope, 'modified.ts'), 'const answer = 2;\r\n')
await writeFile(join(scope, 'both.txt'), 'staged\n'); git(['add', 'both.txt']); await writeFile(join(scope, 'both.txt'), 'saved\r\n')
await rm(join(scope, 'deleted.txt')); git(['mv', 'rename old.txt', 'rename new.txt'])
await writeFile(join(scope, 'untracked.txt'), 'new\n'); await writeFile(join(scope, 'binary.dat'), Buffer.from([0, 255, 1])); await writeFile(join(scope, 'large.txt'), 'x'.repeat(256 * 1024 + 1))
git(['config', 'core.fsmonitor', 'cmd.exe /c echo executed > EXECUTED']); git(['config', 'diff.evil.textconv', 'cmd.exe /c echo executed > EXECUTED'])
await writeFile(join(scope, '.gitattributes'), '*.ts diff=evil\n')
await ignoredGitTrees(scope, join(canonical, 'outside-dependencies'))
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
    server = await createServer({ ...config.config.renderer, root: resolve('src/geppio/src/renderer'), configFile: false }); await server.listen(); env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
  }
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  app.process().stderr?.on('data', data => { void writeFile(join(diagnostics, 'electron-stderr.log'), data, { flag: 'a' }) })
  page = await app.firstWindow(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1600, 1000); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  await app.evaluate(({ ipcMain }) => {
    // Observe the actual registered response without querying again and expiring
    // the renderer's change IDs. No production hook or additional IPC surface.
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<GitResult>> })._invokeHandlers
    const original = handlers.get('git:status')!
    handlers.set('git:status', async (event, ...args) => {
      const result = await original(event, ...args)
      if (result.ok && result.status) (globalThis as { gitSmokeSnapshot?: GitStatus }).gitSmokeSnapshot = structuredClone(result.status)
      return result
    })
  })
  // Observe native Worker errors in this disposable fixture without changing the
  // runtime's fail-closed handler or accepting a failed plugin activation.
  await page.evaluate(() => {
    const events: { message: string; filename: string; line: number; column: number }[] = [], Original = window.Worker
    ;(window as unknown as { gitSmokeWorkerErrors: unknown[] }).gitSmokeWorkerErrors = events
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('error', event => { if (events.length < 8) events.push({ message: event.message.slice(0, 512), filename: event.filename.slice(0, 512), line: event.lineno, column: event.colno }) })
      }
    }
  })
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true }); await enableDeveloperMode(manager)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/time-tracker'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  await manager.locator('[data-plugin="geppio.time-tracker"]').getByRole('switch').click()
  await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.time-tracker"]')?.getAttribute('data-status') === 'active')
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  const mode = async (name: 'GeppIO Code' | 'Bancada de Trabalho') => { await page.locator('.experience-switch').getByRole('button', { name, exact: true }).click(); await settle(page) }
  const picker = async (path: string) => app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  const rail = page.getByRole('navigation', { name: 'Atividades do Editor' })
  await mode('GeppIO Code')
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
  const treeItem = (name: string) => page.getByRole('treeitem', { name, exact: true })
  const badge = (name: string) => treeItem(name).locator('.explorer-git-badge')
  await page.waitForFunction(() => document.querySelector('.explorer-git-status')?.textContent?.includes('arquivo(s) com alterações'))
  const native = await app.evaluate(() => (globalThis as { gitSmokeSnapshot?: GitStatus }).gitSmokeSnapshot)
  assert.ok(native && native.root === root)
  const layers = (changes: GitStatus['changes']) => changes.map(({ name, previous, index, working }) => ({ name, previous, index, working }))
  assert.deepEqual(layers(native.changes), layers(parseGitStatus(Buffer.from(git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'])))), 'Ignored linked dependencies never hide a tracked/index/working/untracked change')
  for (const [name, value] of [['modified.ts', 'M'], ['both.txt', 'M·M'], ['added.txt', 'A'], ['untracked.txt', 'U'], ['rename new.txt', 'R'], ['nested', '2']]) assert.equal(await badge(name!).innerText(), value)
  assert.match(await badge('both.txt').getAttribute('aria-label') ?? '', /Índice: Modificado; árvore de trabalho: Modificado/)
  assert.equal(await treeItem('.git').count(), 0); assert.equal(await treeItem('.env.example').count(), 1); assert.equal(await treeItem('deleted.txt').count(), 0)
  await treeItem('nested').click(); await treeItem('tracked.ts').waitFor()
  assert.equal(await badge('tracked.ts').innerText(), 'M'); assert.equal(await badge('new.ts').innerText(), 'U')
  await treeItem('nested').focus(); await page.keyboard.press('ArrowLeft'); assert.equal(await treeItem('tracked.ts').count(), 0)
  await page.screenshot({ path: join(diagnostics, 'explorer-decorations.png') })
  await picker(join(scope, 'both.txt')); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  const editor = fileEditor(page); await editor.waitFor()
  await editor.fill('inactive unsaved Git comparison draft\n')
  const inactive = await page.locator('.monaco-host').evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  const inactiveVersion = await page.evaluate(model => model.getAlternativeVersionId(), inactive)
  const inactiveIntact = async () => {
    assert.equal(await page.evaluate(model => model.isDisposed(), inactive), false)
    assert.equal(await page.evaluate(model => model.getValue(), inactive), 'inactive unsaved Git comparison draft\n')
    assert.equal(await page.evaluate(model => model.getAlternativeVersionId(), inactive), inactiveVersion)
    assert.equal(await readFile(join(scope, 'both.txt'), 'utf8'), 'saved\r\n')
  }
  await picker(join(scope, 'modified.ts')); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
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
    await models.dispose(); assert.deepEqual(await snapshot(), draft); await inactiveIntact()
    return values
  }
  assert.deepEqual(await diff('both.txt'), { original: 'before\n', modified: 'saved\r\n', readOnly: true, originalReadOnly: true })
  assert.equal((await diff('deleted.txt')).modified, '')
  assert.equal((await diff('rename new.txt')).original, 'before\n')
  const gitPanel = page.locator('.git-changes')
  await gitPanel.getByRole('button', { name: 'Histórico', exact: true }).press('Enter')
  await gitPanel.locator('.git-history-commit', { hasText: 'Nested fixture' }).click()
  await gitPanel.locator('.git-commit-detail .git-history-file[title="nested/tracked.ts"]').press('Enter')
  const historical = page.getByRole('dialog', { name: 'Comparação Git · nested/tracked.ts', exact: true })
  const historicalHost = historical.locator('.git-diff[data-git-diff-models="2"]')
  await historicalHost.waitFor()
  assert.deepEqual(await historicalHost.evaluate(node => {
    const diff = (node as GitDiffHost).monacoDiffEditor!
    return [diff.getOriginalEditor().getValue(), diff.getModifiedEditor().getValue(), diff.getModifiedEditor().getRawOptions().readOnly]
  }), ['', 'before\n', true])
  await page.keyboard.press('Control+s')
  await page.keyboard.press('Escape')
  await historical.waitFor({ state: 'detached' })
  assert.equal(await readFile(join(scope, 'nested', 'tracked.ts'), 'utf8'), 'after\n')
  assert.deepEqual(await snapshot(), draft)
  await inactiveIntact()
  await gitPanel.getByRole('button', { name: 'Alterações', exact: true }).click()
  for (const name of ['untracked.txt', 'binary.dat', 'large.txt']) {
    await page.locator('.git-file').filter({ hasText: name }).first().click(); await page.locator('.git-changes [role="alert"]').waitFor(); assert.equal(await page.locator('.git-diff').count(), 0)
  }
  await page.getByRole('button', { name: 'Atualizar Git', exact: true }).click(); await page.locator('.git-branch').waitFor()
  assert.equal(await page.locator('.git-file').filter({ hasText: 'both.txt' }).count(), 2)
  assert.deepEqual(await snapshot(), draft); await editor.press('Control+z'); assert.notEqual((await snapshot()).text, draft.text); await editor.press('Control+y'); assert.equal((await snapshot()).text, draft.text)
  assert.equal(await readFile(join(scope, 'modified.ts'), 'utf8'), 'const answer = 2;\r\n')
  assert.deepEqual(await gitFingerprint(scope), before, 'Inherited read-only inspection still never mutates repository data')
  const action = async (label: 'Preparar' | 'Despreparar', name: string) => {
    await page.getByRole('button', { name: label + ' ' + name, exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.git-changes [role="status"]') && !!document.querySelector('.git-branch'))
    assert.equal(await page.locator('.git-changes [role="alert"]').count(), 0)
    assert.deepEqual(await snapshot(), draft, 'Index writes never save or replace the active unsaved Monaco model')
      await inactiveIntact()
    await assert.rejects(readFile(join(scope, 'EXECUTED')), 'Application operation must not execute repository-controlled programs, before any native verifier command')
  }
  for (const name of ['modified.ts', 'deleted.txt', 'untracked.txt']) {
    await action('Preparar', name)
    assert.ok(git(['diff', '--cached', '--name-only', '--', name]).trim())
    if (name === 'modified.ts') assert.equal(git(['show', ':modified.ts']), 'const answer = 2;\r\n', 'Stage contains saved bytes, never the dirty Monaco draft')
    assert.equal(git(['show', ':both.txt']), 'staged\n', 'Unrelated staged blob remains exact')
    await action('Despreparar', name)
    assert.equal(git(['diff', '--cached', '--name-only', '--', name]), '')
  }
  assert.ok(await page.getByRole('button', { name: 'Preparar large.txt', exact: true }).isDisabled())
  assert.ok(await page.getByRole('button', { name: 'Despreparar rename new.txt', exact: true }).isDisabled())
  await editor.press('Control+z'); assert.notEqual((await snapshot()).text, draft.text); await editor.press('Control+y'); assert.equal((await snapshot()).text, draft.text)
  git(['fsck', '--full'])
  const negatives = await app.evaluate(async ({ ipcMain, BrowserWindow }, root) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<GitResult>> })._invokeHandlers
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, senderFrame = sender.mainFrame, handler = handlers.get('git:status')!
    const arities = { status: 1, stage: 2, unstage: 2, history: 1, historyPage: 3, historyCommit: 3, historyCompare: 4 }
    return Promise.all(Object.entries(arities).flatMap(([operation, arity]) => {
      const call = handlers.get('git:' + operation)!, args = [root, ...Array<string>(arity - 1).fill('00000000-0000-4000-8000-000000000000')]
      return [call({ sender, senderFrame }, ...args, 'extra'), call({ sender: {}, senderFrame }, ...args), call({ sender, senderFrame: { url: senderFrame.url } }, ...args), call({ sender, senderFrame: { url: 'https://example.invalid/' } }, ...args), handler({ sender, senderFrame }, '../escape')]
    }))
  }, root)
  assert.ok(negatives.every(r => !r.ok && r.code === 'invalid'))
  const forged = await page.evaluate(({ root, id }) => window.geppio!.git.compare(root, id), { root, id: randomUUID() }); assert.ok(!forged.ok && forged.code === 'stale')
  await mode('Bancada de Trabalho'); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:git-changes"]').click(); await page.locator('[data-widget-place="sidebar"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const confirmed = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY); assert.notEqual(confirmed, layout)
  for (const name of ['GeppIO Code', 'Bancada de Trabalho', 'GeppIO Code'] as const) { await mode(name); assert.equal(await page.locator('.git-changes').count(), 1); assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), confirmed) }
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
  await mode('Bancada de Trabalho'); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:git-changes"]').click(); await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  assert.equal(await page.locator('.git-changes').count(), 1)
  assert.equal(await page.locator('.git-changes').evaluate(node => node.closest('.widget-frame')?.getAttribute('data-owner-region')), 'main')
  await mode('GeppIO Code')
  const protectedFiles = (value: Record<string, string>) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== '.git/index' && !name.startsWith('.git/objects/')))
  assert.deepEqual(protectedFiles(await gitFingerprint(scope)), protectedFiles(before), 'Only index and required Git objects may change; disk/config/refs remain exact')
  // Successful index action and save must update Explorer without opening Git activity.
  await action('Preparar', 'modified.ts')
  await rail.getByRole('button', { name: 'Explorador', exact: true }).click()
  assert.equal(await badge('modified.ts').innerText(), 'M')
  assert.match(await badge('modified.ts').getAttribute('aria-label') ?? '', /árvore de trabalho: sem alteração/)
  await editor.press('Control+s')
  await page.waitForFunction(() => document.querySelector('[role="treeitem"][aria-label="modified.ts"] .explorer-git-badge')?.textContent === 'M·M')
  assert.equal(await readFile(join(scope, 'modified.ts'), 'utf8'), draft.text.replaceAll('\n', '\r\n'), 'Save retains the source CRLF convention behind the LF Monaco projection')
  await writeFile(join(scope, 'added.txt'), 'external disk change\n')
  await page.getByRole('button', { name: 'Atualizar árvore', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[role="treeitem"][aria-label="added.txt"] .explorer-git-badge')?.textContent === 'A·M')
  await page.getByRole('button', { name: 'Fechar pasta', exact: true }).click()
  const stale = await page.evaluate(root => window.geppio!.git.status(root), root); assert.ok(!stale.ok && stale.code === 'stale')
  const staleWrite = await page.evaluate(({ root, id }) => window.geppio!.git.stage(root, id), { root, id: randomUUID() }); assert.ok(!staleWrite.ok && staleWrite.code === 'stale')
  await rail.getByRole('button', { name: 'Alterações Git', exact: true }).click(); assert.equal(await page.locator('.git-branch').count(), 0)
  assert.match(await page.locator('.git-changes').innerText(), /Abra uma pasta/)
  await rail.getByRole('button', { name: 'Explorador', exact: true }).click()
  const neutral = join(canonical, 'neutral'); await mkdir(neutral); await writeFile(join(neutral, '.env.example'), 'retained')
  await picker(neutral); await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.explorer-git-status')?.textContent?.includes('não contém .git'))
  assert.equal(await page.locator('.explorer-git-badge').count(), 0); assert.equal(await treeItem('.env.example').count(), 1)
  await writeFile(join(neutral, '.git'), 'gitdir: unsupported-linked-root')
  await page.getByRole('button', { name: 'Atualizar árvore', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.explorer-git-status')?.textContent?.includes('não suportado'))
  assert.equal(await treeItem('.git').count(), 0)
  const clean = join(canonical, 'clean'); await initializeGit(clean); await picker(clean)
  await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.explorer-git-status')?.textContent?.includes('árvore limpa'))
  assert.equal(await page.locator('.explorer-git-badge').count(), 0)
  assert.deepEqual(errors, [])
  evidence.result = 'passed: real index Stage/Unstage clicks, saved-disk content versus dirty draft, unrelated staged blob, index/object fsck, disk/refs/config fingerprints, inherited read-only status/diff, malicious config nonexecution, Monaco identity/undo/selection/scroll, disposed models, caller negatives, stale grants, shared Sidebar/Main/activity and layout bytes'
  evidence.coexistence = 'passed: nonempty installed plugin Worker identities retained; same live PowerShell UUID accepts a command after Git inspection and mode changes'
  evidence.explorer = 'passed: M/U/A/R and mixed M·M/A·M, unique descendant counts, hidden .git/retained dotfile, no deleted filesystem row, keyboard collapse, stage/save/tree refresh, root release/replacement, nonrepo/unsupported/clean diagnostics'
  evidence.environment = { platform: process.platform, development: dev, dpr: await page.evaluate(() => devicePixelRatio) }
  await writeFile(join(diagnostics, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  await writeFile(join(diagnostics, 'worker-errors.json'), JSON.stringify(await page?.evaluate(() => (window as unknown as { gitSmokeWorkerErrors?: unknown[] }).gitSmokeWorkerErrors ?? []).catch(() => []), null, 2) ?? '[]')
  console.error(errors)
  console.error(await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ url: win.webContents.getURL(), loading: win.webContents.isLoading(), destroyed: win.webContents.isDestroyed() }))).catch(() => []))
  await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}); await server?.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
