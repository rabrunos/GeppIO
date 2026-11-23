import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { PluginStore } from '../src/main/plugins.ts'
import type { GitDiffHost } from '../src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { initializeGit } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { electron } from './test-electron.ts'
import { closeWorkspaceWindow } from './workspace-close.ts'
import { exerciseWorkspaceFiles } from './workspace-tools-documents.ts'
import { checkConfirmedPlugin, exercisePluginRecovery, placeScratch } from './workspace-tools-plugin.ts'

const scaled = process.argv.includes('--scale125')
const temp = await realpath(await mkdtemp(join(tmpdir(), 'geppio-smoke-workspace-tools-')))
const profile = join(temp, 'profile'), project = join(temp, 'first-project'), other = join(temp, 'second-project')
const essentials = join(temp, 'essentials'), provider = join(temp, 'provider')
const draft = 'rascunho preservado\n', saved = 'const answer = 2;\r\n'
const literal = '<b>Resumo</b> https://example.invalid/relatorio'
const diagnostics = resolve('.local/diagnostics/workspace-tools-' + (scaled ? '125' : '100'))
const reportFile = (folder: string) => join(folder, '.geppio', 'tools.json')
function report(title: string) {
  return JSON.stringify({ schemaVersion: 1, reports: [
    { id: 'quality', title, blocks: [{ kind: 'text', text: literal }, { kind: 'list', items: ['Build concluído'] },
      { kind: 'table', columns: ['Verificação', 'Resultado'], rows: [['Testes', '12/12']] }] },
    { id: 'notes', title: 'Notas do projeto', blocks: [{ kind: 'text', text: 'Outro relatório.' }] }
  ] })
}

interface Probe { count: number; hold: boolean; release?: () => void }
type Probed = typeof globalThis & { toolsProbe: Probe }
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = []
const toolsView = () => page.locator('[data-floating-view="workspace-tools"]')
const heading = (name: string) => toolsView().getByRole('heading', { name, exact: true })
const close = (frame: Locator) => frame.getByRole('button', { name: 'Fechar', exact: true })
const projectButton = () => page.getByRole('button', { name: 'Projeto local', exact: true })
const toolsLabel = 'Abrir relatórios do projeto'
async function launch() {
  const env = { ...process.env, GEPPIO_TEST_USER_DATA: profile, NODE_ENV: 'production' }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete (env as NodeJS.ProcessEnv)[key]
  app = await electron.launch({ args: ['.', ...(scaled ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await app.firstWindow(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setContentSize(1600, 980); window.show(); window.focus()
    const probe: Probe = { count: 0, hold: false }
    ;(globalThis as Probed).toolsProbe = probe
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers
    const read = handlers.get('workspace:readTools')!
    handlers.set('workspace:readTools', async (...args) => {
      probe.count++
      const result = await read(...args)
      if (probe.hold) {
        probe.hold = false
        await new Promise<void>(resolve => { probe.release = resolve })
      }
      return result
    })
  })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scaled ? 1.25 : 1)
}
async function stop() {
  if (!app) return
  if (!page.isClosed()) {
    await app.evaluate(({ dialog }) => {
      (globalThis as Partial<Probed>).toolsProbe?.release?.()
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    await closeWorkspaceWindow(app, page, true)
  }
  app = undefined
}
const reads = () => app!.evaluate(() => (globalThis as Probed).toolsProbe.count)
const experience = async (label: string) => {
  await page.locator('.experience-switch').getByRole('button', { name: label, exact: true }).click()
  await settle(page)
}
async function projectAction(label: string, folder?: string) {
  if (folder) await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, folder)
  const button = projectButton()
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
  await page.getByRole('button', { name: label, exact: true }).click()
  if (await button.getAttribute('aria-expanded') === 'true') await button.press('Escape')
}
async function openFromWorkbench(label: string) {
  await page.getByRole('button', { name: 'Mais opções do projeto', exact: true }).press('Enter')
  await page.getByRole('menuitem', { name: label, exact: true }).press('Enter')
}
async function tripleWindowHistory() {
  const reports = toolsView(), git = page.locator('[data-floating-view="git-changes"]'), search = page.locator('[data-floating-view="project-search"]')
  await experience('Bancada de Trabalho')
  await openFromWorkbench('Abrir Git em janela'); await git.waitFor()
  await openFromWorkbench('Abrir busca em janela'); await search.waitFor()
  await openFromWorkbench(toolsLabel); await reports.waitFor()
  assert.equal(await page.locator('[data-floating-view]').count(), 3)
  await page.screenshot({ path: join(diagnostics, 'three-views.png') })
  assert.equal(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  assert.ok(await close(reports).evaluate(el => el === document.activeElement))
  const move = reports.getByRole('button', { name: 'Mover janela', exact: true })
  const before = await reports.boundingBox(); assert.ok(before)
  await move.press('Enter'); await page.keyboard.press('Shift+ArrowLeft'); await settle(page)
  const moved = await reports.boundingBox(); assert.ok(moved && Math.abs(moved.x - before.x + 10) < 0.1)
  await page.keyboard.press('Escape'); await settle(page)
  assert.deepEqual(await reports.boundingBox(), before)
  for (const frame of [reports, search, git]) {
    assert.ok(await close(frame).evaluate(el => {
      const r = el.getBoundingClientRect(), area = el.closest('.internal-view-layer')!.getBoundingClientRect()
      return r.width > 0 && r.left >= area.left && r.right <= area.right && r.top >= area.top && r.bottom <= area.bottom
    }))
  }
  await close(reports).press('Enter'); await close(search).press('Enter')
  const stage = git.getByRole('button', { name: 'Preparar modified.ts', exact: true })
  await stage.waitFor()
  const eligible = await stage.isEnabled()
  await git.getByRole('button', { name: 'Histórico', exact: true }).press('Enter')
  if (!scaled) {
    const more = git.getByRole('button', { name: 'Carregar mais commits', exact: true })
    await more.waitFor(); assert.equal(await git.locator('.git-history-commit').count(), 50)
    await more.press('Enter')
  }
  await git.locator('.git-history-commit', { hasText: 'Disposable fixture' }).press('Enter')
  const file = git.locator('.git-history-file[title="modified.ts"]')
  await file.press('Enter')
  const diff = page.locator('.git-diff[data-git-diff-models="2"]')
  await diff.waitFor()
  assert.deepEqual(await diff.evaluate(el => {
    const editor = (el as GitDiffHost).monacoDiffEditor!
    return [editor.getOriginalEditor().getValue(), editor.getModifiedEditor().getValue(), editor.getModifiedEditor().getRawOptions().readOnly]
  }), ['', 'const answer = 1;\r\n', true])
  await page.keyboard.press('Escape'); await diff.waitFor({ state: 'detached' })
  assert.ok(await file.evaluate(el => el === document.activeElement))
  await git.getByRole('button', { name: 'Alterações', exact: true }).press('Enter')
  await stage.waitFor()
  assert.equal(await stage.isEnabled(), eligible)
  await close(git).press('Enter')
  await experience('GeppIO Code')
  await page.getByRole('button', { name: toolsLabel, exact: true }).press('Enter')
  await heading('Qualidade original').waitFor()
  assert.equal(await reads(), 1)
}
async function exerciseReports() {
  const view = toolsView(), refresh = view.getByRole('button', { name: 'Atualizar', exact: true })
  await writeFile(reportFile(project), report('Qualidade atualizada'))
  assert.ok(await heading('Qualidade original').isVisible())
  await refresh.press('Enter'); await heading('Qualidade atualizada').waitFor()
  await writeFile(reportFile(project), '{"schemaVersion":')
  await refresh.press('Enter'); await view.getByText(/Desatualizado/i).first().waitFor()
  assert.ok(await heading('Qualidade atualizada').isVisible())
  assert.match(await view.innerText(), /Última leitura/i)
  await unlink(reportFile(project)); await refresh.press('Enter')
  await heading('Qualidade atualizada').waitFor({ state: 'detached' })
  assert.equal(await view.getByRole('table').count(), 0)
  await writeFile(reportFile(project), report('Somente na primeira pasta'))
  await refresh.press('Enter'); await heading('Somente na primeira pasta').waitFor()
  assert.equal(await reads(), 5)
  const oldRoot = await page.locator('.workspace-controls').getAttribute('data-workspace-root')
  assert.ok(oldRoot)
  await app!.evaluate(() => { (globalThis as Probed).toolsProbe.hold = true })
  await refresh.press('Enter')
  const deadline = Date.now() + 10000
  while (!await app!.evaluate(() => !!(globalThis as Probed).toolsProbe.release)) {
    assert.ok(Date.now() < deadline, 'The explicit refresh reached the disposable Main read')
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  await projectAction('Trocar projeto', other); await heading('Segunda pasta').waitFor()
  await app!.evaluate(() => { (globalThis as Probed).toolsProbe.release!() }); await settle(page)
  assert.ok(await heading('Segunda pasta').isVisible()); assert.equal(await heading('Somente na primeira pasta').count(), 0)
  const expired = await page.evaluate(id => window.geppio!.workspace.readTools(id), oldRoot)
  assert.ok(!expired.ok && expired.expired)
  await projectAction('Fechar projeto'); await heading('Segunda pasta').waitFor({ state: 'detached' })
  assert.equal(await view.getByRole('table').count(), 0)
  await projectAction('Abrir projeto', project); await heading('Somente na primeira pasta').waitFor()
  const current = await page.locator('.workspace-controls').getAttribute('data-workspace-root'); assert.ok(current)
  const denied = await app!.evaluate(async ({ BrowserWindow, ipcMain }, root) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<{ ok: boolean }>> })._invokeHandlers
    const read = handlers.get('workspace:readTools')!, sender = BrowserWindow.getAllWindows()[0]!.webContents
    const senderFrame = sender.mainFrame, event = { sender, senderFrame }
    return Promise.all([read({ sender: {}, senderFrame }, root), read({ sender, senderFrame: { url: senderFrame.url } }, root),
      read({ sender, senderFrame: { url: 'https://example.invalid' } }, root), read(event, '.geppio/tools.json'), read(event, root, 'extra')])
  }, current)
  assert.ok(denied.every(result => !result.ok && !Object.hasOwn(result, 'reports')))
  await close(view).press('Enter'); await view.waitFor({ state: 'detached' })
}
try {
  await mkdir(diagnostics, { recursive: true })
  const git = await initializeGit(project)
  if (!scaled) for (let n = 1; n <= 50; n++) git(['commit', '--allow-empty', '-m', 'History row ' + n])
  await mkdir(join(project, '.geppio')); await mkdir(join(other, '.geppio'), { recursive: true })
  await writeFile(reportFile(project), report('Qualidade original')); await writeFile(reportFile(other), report('Segunda pasta'))
  await writeFile(join(project, 'modified.ts'), saved)
  const store = new PluginStore(join(profile, 'GeppIO/plugins'))
  await cp(resolve('.local/plugin-packages/workspace-essentials'), essentials, { recursive: true })
  await cp(resolve('.local/plugin-packages/composition-templates'), provider, { recursive: true })
  await store.setDeveloperMode(true); await store.loadExternal(provider); await store.loadExternal(essentials)
  await store.setEnabled('geppio.workspace-essentials', true)
  await launch()
  if (!scaled) await placeScratch(page)
  await experience('GeppIO Code')
  assert.equal(await reads(), 0)
  await projectAction('Abrir projeto', project)
  await page.getByRole('treeitem', { name: 'modified.ts', exact: true }).press('Enter')
  await fileEditor(page).fill(draft)
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  const terminal = page.locator('[data-terminal-phase="running"]'); await terminal.waitFor()
  const terminalId = await terminal.getAttribute('data-terminal-id'), workers = pluginWorkers(page)
  assert.ok(terminalId); assert.equal(workers.length, 1)
  await page.getByRole('button', { name: toolsLabel, exact: true }).press('Enter')
  await heading('Qualidade original').waitFor()
  const view = toolsView()
  await view.getByText(literal, { exact: true }).waitFor()
  assert.equal(await view.locator('a,b,script').count(), 0)
  assert.equal(await view.getByRole('cell', { name: '12/12' }).count(), 1)
  await view.getByRole('combobox', { name: 'Relatório', exact: true }).selectOption('notes')
  await heading('Notas do projeto').waitFor()
  await view.getByRole('combobox', { name: 'Relatório', exact: true }).selectOption('quality')
  await tripleWindowHistory()
  assert.equal(git(['diff', '--cached', '--name-only']), '')
  assert.equal(await fileEditor(page).inputValue(), draft)
  assert.equal(await readFile(join(project, 'modified.ts'), 'utf8'), saved)
  await exerciseReports()
  assert.equal(await terminal.getAttribute('data-terminal-id'), terminalId); assert.deepEqual(pluginWorkers(page), workers)
  if (!scaled) {
    const { exerciseCompositions, applyAfterRestart } = await import('./workspace-tools-compositions.ts')
    console.log('Workspace Tools: report refresh, directory switch and three shared windows verified')
    await exerciseWorkspaceFiles(app!, page, project)
    assert.equal(await fileEditor(page).inputValue(), draft)
    assert.equal(await terminal.getAttribute('data-terminal-id'), terminalId); assert.deepEqual(pluginWorkers(page), workers)
    await experience('Bancada de Trabalho')
    await exercisePluginRecovery(app!, page, essentials)
    console.log('Workspace Tools: file journey and plugin recovery verified')
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1120))
    await settle(page)
    let newPluginWorkers = 0
    const watchWorker = (worker: { url(): string }) => { if (worker.url().includes('plugin-worker')) newPluginWorkers++ }
    page.on('worker', watchWorker)
    try { await exerciseCompositions(app!, page, temp) } finally { page.off('worker', watchWorker) }
    assert.equal(newPluginWorkers, 0)
    console.log('Workspace Tools: composition library and disabled provider verified')
    await experience('GeppIO Code')
    // Resolve the disposable dirty buffer with the real document-close transaction.
    await app!.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
    await closeWorkspaceWindow(app!, page, true); app = undefined
    await launch()
    assert.equal(await reads(), 0)
    await experience('GeppIO Code')
    await app!.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await projectAction('Restaurar projeto anterior')
    await page.getByRole('button', { name: toolsLabel, exact: true }).press('Enter')
    await heading('Somente na primeira pasta').waitFor()
    assert.equal(await reads(), 1)
    await close(toolsView()).press('Enter')
    assert.equal(await readFile(join(project, 'modified.ts'), 'utf8'), saved)
    assert.equal(await readFile(join(project, 'leitura-final', 'resultado.txt'), 'utf8'), 'resultado confirmado após recarga\n')
    assert.equal(await fileEditor(page).inputValue(), saved.replaceAll('\r\n', '\n'))
    assert.equal(await page.locator('[data-terminal-phase="running"]').count(), 0)
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1120))
    await experience('Bancada de Trabalho'); await checkConfirmedPlugin(page); await applyAfterRestart(page)
  }
  assert.deepEqual(errors, [])
  console.log('PASS Workspace Tools, three shared views and project ownership at DPR ' + (scaled ? '1.25' : '1 with combined file, Git, PTY, plugin, composition and restart journey'))
} catch (error) {
  console.error('Workspace Tools journey failed', error)
  if (page && !page.isClosed()) await page.screenshot({ path: join(diagnostics, 'failure.png'), timeout: 5000 }).catch(() => {})
  throw error
} finally {
  try { await stop() } finally { await rm(temp, { recursive: true, force: true, maxRetries: 5 }) }
}
