import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Locator } from 'playwright'
import { PluginStore } from '../src/geppio/src/main/plugins.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { gitFingerprint, initializeGit } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { electron } from './test-electron.ts'

interface Counters { starts: number; reads: number; inFlight: number; peak: number; statuses: number; comparisons: number }
type Probe = typeof globalThis & { sharedWindows: { counts: Counters; release(): void } }
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-shared-windows-'))
const scale125 = process.argv.includes('--scale125')
let app: ElectronApplication | undefined
const focusIs = (item: Locator) => item.evaluate(el => el === document.activeElement)
const bounds = async (item: Locator) => { const rect = await item.boundingBox(); assert.ok(rect); return rect }
try {
  const root = await realpath(profile), project = join(root, 'first-project'), replacement = join(root, 'second-project')
  await initializeGit(project); await initializeGit(replacement)
  const original = 'const answer = 2;\r\n', draft = 'const localDraft = 62;\n'
  await writeFile(join(project, 'modified.ts'), original)
  const before = await gitFingerprint(project)
  const store = new PluginStore(join(profile, 'GeppIO/plugins'))
  await store.install(resolve('.local/plugin-packages/counter')); await store.setEnabled('local.counter', true)
  const env = { ...process.env, GEPPIO_TEST_USER_DATA: profile, NODE_ENV: 'production' }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete (env as NodeJS.ProcessEnv)[key]
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000)
  const win = await app.browserWindow(page)
  const resize = (w: number, h: number) => win.evaluate((win, size) => { win.setContentSize(size[0]!, size[1]!); win.show(); win.focus() }, [w, h])
  await resize(1440, 920); await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers
    const counts: Counters = { starts: 0, reads: 0, inFlight: 0, peak: 0, statuses: 0, comparisons: 0 }
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const probe = globalThis as Probe
    probe.sharedWindows = { counts, release }
    for (const [operation, key] of [['search:start', 'starts'], ['git:status', 'statuses'], ['git:compare', 'comparisons']] as const) {
      const original = handlers.get(operation)!
      handlers.set(operation, (...args) => { counts[key]++; return original(...args) })
    }
    const read = handlers.get('search:read')!
    handlers.set('search:read', async (...args) => {
      counts.reads++; counts.inFlight++; counts.peak = Math.max(counts.peak, counts.inFlight)
      try { const result = await read(...args); await gate; return result } finally { counts.inFlight-- }
    })
  })
  const counts = () => app!.evaluate(() => (globalThis as Probe).sharedWindows.counts)
  const pickRoot = async (path: string, action: string) => {
    await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
    await page.getByRole('button', { name: 'Projeto local', exact: true }).click()
    await page.getByRole('button', { name: action, exact: true }).click()
  }
  const experience = async (name: string) => {
    await page.locator('.experience-switch').getByRole('button', { name, exact: true }).click()
    await settle(page)
  }
  const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="plugin:local.counter:counter"]').click()
  await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const layout = await raw(), workers = pluginWorkers(page)
  assert.ok(layout); assert.equal(workers.length, 1)

  const git = page.locator('[data-floating-view="git-changes"]'), search = page.locator('[data-floating-view="project-search"]')
  const activeWindow = async (id: 'git-changes' | 'project-search') => {
    await page.locator(`.internal-view-layer[data-floating-active="true"] [data-floating-view="${id}"]`).waitFor()
    await settle(page)
  }
  const close = (frame: Locator) => frame.getByRole('button', { name: 'Fechar', exact: true })
  const mover = (frame: Locator) => frame.getByRole('button', { name: 'Mover janela', exact: true })
  const gitRail = page.getByRole('button', { name: 'Alterações Git', exact: true })
  const searchRail = page.getByRole('button', { name: 'Busca no projeto', exact: true })
  const side = page.locator('.editor-explorer-panel')
  const sideSearch = side.locator('.project-search')
  const field = (scope: Locator) => scope.getByRole('textbox', { name: 'Texto a buscar' })
  const openSearch = sideSearch.getByRole('button', { name: 'Abrir busca em janela' })
  const menu = page.getByRole('button', { name: 'Mais opções do projeto', exact: true })
  const result = (scope: Locator) => scope.getByRole('button', { name: /Abrir modified\.ts, linha 1/ })
  const editor = fileEditor(page), host = page.locator('.monaco-host')
  await experience('GeppIO Code'); await pickRoot(project, 'Abrir projeto')
  await page.getByRole('treeitem', { name: 'modified.ts', exact: true }).press('Enter')
  await editor.fill(draft)
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  const grant = await page.locator('.file-editor').getAttribute('data-document-id'); assert.ok(grant)
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  const terminal = page.locator('[data-terminal-phase="running"]'); await terminal.waitFor()
  const terminalId = await terminal.getAttribute('data-terminal-id'); assert.ok(terminalId)
  await gitRail.click()
  const sideFile = side.locator('.git-file[title="modified.ts"]')
  await sideFile.waitFor()
  const statuses = (await counts()).statuses; assert.ok(statuses > 0)
  await side.getByRole('button', { name: 'Abrir Git em janela' }).press('Enter'); await git.waitFor()
  await searchRail.click(); await field(sideSearch).fill('answer'); await field(sideSearch).press('Enter')
  await openSearch.press('Enter'); await search.waitFor()
  assert.equal(await field(search).inputValue(), 'answer')
  const fieldIds = await Promise.all([field(sideSearch).getAttribute('id'), field(search).getAttribute('id')])
  assert.ok(fieldIds.every(Boolean)); assert.notEqual(fieldIds[0], fieldIds[1])
  for (const scope of [sideSearch, search]) assert.ok(await field(scope).evaluate(input => (input as HTMLInputElement).labels?.[0]?.textContent === 'Texto a buscar'))
  const firstSearch = await search.elementHandle()
  await openSearch.press('Enter'); await activeWindow('project-search')
  assert.equal(await search.count(), 1); assert.ok(await firstSearch!.evaluate(el => el === document.querySelector('[data-floating-view="project-search"]')))
  await firstSearch!.dispose()
  assert.ok(await focusIs(close(search)))
  const deadline = Date.now() + 10000
  while (!(await counts()).inFlight) { assert.ok(Date.now() < deadline, 'Expected an initial native Search read'); await new Promise(resolve => setTimeout(resolve, 20)) }

  const step = async (frame: Locator) => {
    const button = mover(frame), start = await bounds(frame)
    await button.press('Enter'); await settle(page); assert.equal(await button.getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowDown'); await settle(page)
    const moved = await bounds(frame)
    assert.ok(Math.abs(moved.x - start.x + 1) < .1 && Math.abs(moved.y - start.y - 10) < .1)
    await page.keyboard.press('Escape'); await settle(page)
    assert.equal(await button.getAttribute('aria-pressed'), 'false', JSON.stringify(await frame.evaluate(node => ({
      view: node.getAttribute('data-floating-view'), focusedButton: document.activeElement?.getAttribute('aria-label'),
      modal: !!document.querySelector('dialog:modal'), activeLayer: node.closest('.internal-view-layer')?.getAttribute('data-floating-active')
    }))))
    assert.deepEqual(await bounds(frame), start)
    await button.press('Space'); await settle(page); assert.equal(await button.getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Enter'); await settle(page)
    assert.equal(await button.getAttribute('aria-pressed'), 'false')
    const confirmed = await bounds(frame); assert.ok(Math.abs(confirmed.x - start.x + 10) < .1)
    await button.press('Enter'); await settle(page); assert.equal(await button.getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('Tab'); await settle(page)
    assert.equal(await button.getAttribute('aria-pressed'), 'false'); assert.ok(!await focusIs(button))
    const afterTab = await bounds(frame); await page.keyboard.press('ArrowRight'); await settle(page)
    assert.deepEqual(await bounds(frame), afterTab)
  }
  await step(git); await step(search)
  const gitBox = await bounds(git), searchBox = await bounds(search), grip = await bounds(search.locator('.internal-view-grip'))
  const x = grip.x + 20, y = grip.y + grip.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  try { await page.mouse.move(x + gitBox.x - searchBox.width / 2 - searchBox.x, y + gitBox.y + 64 - searchBox.y, { steps: 8 }) }
  finally { await page.mouse.up() }
  await activeWindow('project-search')
  const topAtOverlap = () => page.evaluate(() => {
    const [git, search] = ['git-changes', 'project-search'].map(id => document.querySelector<HTMLElement>(`[data-floating-view="${id}"]`)!.getBoundingClientRect())
    const left = Math.max(git!.left, search!.left), right = Math.min(git!.right, search!.right)
    const top = Math.max(git!.top, search!.top), bottom = Math.min(git!.bottom, search!.bottom)
    return right > left && bottom > top && document.elementFromPoint((left + right) / 2, (top + bottom) / 2)?.closest('[data-floating-view]')?.getAttribute('data-floating-view')
  })
  assert.equal(await topAtOverlap(), 'project-search')
  await git.locator('.internal-view-grip').click({ position: { x: 15, y: 8 } }); await activeWindow('git-changes')
  assert.equal(await topAtOverlap(), 'git-changes')
  await field(search).focus(); await activeWindow('project-search'); assert.equal(await topAtOverlap(), 'project-search')
  const stationary = await bounds(search)
  await field(search).press('End'); await field(search).press('ArrowLeft')
  assert.equal(await field(search).evaluate(el => (el as HTMLInputElement).selectionStart), 'answer'.length - 1)
  assert.deepEqual(await bounds(search), stationary)
  await close(git).click(); await git.waitFor({ state: 'detached' }); await activeWindow('project-search')
  assert.ok(await focusIs(field(search)))
  const pending = await counts()
  assert.deepEqual([pending.starts, pending.reads, pending.inFlight, pending.peak, pending.statuses], [1, 1, 1, 1, statuses])
  await app.evaluate(() => (globalThis as Probe).sharedWindows.release())
  await result(search).waitFor(); await result(sideSearch).waitFor()
  await search.getByRole('status').filter({ hasText: /Busca (concluída|parcial)/ }).waitFor()
  const settled = await counts()
  assert.equal(settled.starts, 1); assert.equal(settled.peak, 1)

  await experience('Bancada de Trabalho')
  await close(search).press('Enter'); await search.waitFor({ state: 'detached' }); await settle(page)
  assert.ok(await focusIs(menu), 'Closing after the Code opener unmounts restores the Workbench project menu')
  await menu.press('Enter'); await page.getByRole('menuitem', { name: 'Abrir busca em janela' }).press('Enter')
  await result(search).waitFor()
  const shell = page.locator('.workbench'), theme = await shell.getAttribute('data-theme')
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
  await page.locator(`.workbench[data-theme="${theme === 'light' ? 'dark' : 'light'}"]`).waitFor()
  assert.notEqual(await shell.getAttribute('data-theme'), theme); assert.ok(await close(search).isVisible())
  await menu.press('Enter'); await page.getByRole('menuitem', { name: 'Abrir Git em janela' }).press('Enter')
  await experience('GeppIO Code'); await gitRail.click(); await sideFile.waitFor()
  for (const trigger of [sideFile, git.locator('.git-file[title="modified.ts"]')]) {
    await trigger.press('Enter')
    const comparison = page.getByRole('dialog', { name: 'Comparação Git · modified.ts' })
    await comparison.locator('.git-diff[data-git-diff-models="2"]').waitFor()
    assert.ok(await comparison.evaluate(el => el.matches(':modal') && el.contains(document.activeElement)))
    await page.keyboard.press('Escape'); await comparison.waitFor({ state: 'detached' })
    await settle(page); assert.ok(await focusIs(trigger)); assert.equal(await page.locator('[data-floating-view]').count(), 2)
  }
  const afterWindows = await counts()
  assert.deepEqual([afterWindows.starts, afterWindows.reads, afterWindows.statuses, afterWindows.comparisons], [1, settled.reads, statuses, 2])
  await resize(1000, 720); await settle(page)
  for (const frame of [git, search]) {
    const canReach = await close(frame).evaluate(el => {
      const button = el.getBoundingClientRect(), area = el.closest('.internal-view-layer')!.getBoundingClientRect()
      return button.width > 0 && button.height > 0 && button.left >= area.left && button.right <= area.right && button.top >= area.top && button.bottom <= area.bottom
    })
    assert.ok(canReach); await mover(frame).focus(); await close(frame).click()
    await frame.waitFor({ state: 'detached' })
  }
  await resize(1440, 920); await searchRail.click(); await openSearch.press('Enter'); await result(search).waitFor()
  const oldRoot = await page.locator('.workspace-controls').getAttribute('data-workspace-root')
  await pickRoot(replacement, 'Trocar projeto')
  await page.waitForFunction(previous => { const next = document.querySelector('.workspace-controls')?.getAttribute('data-workspace-root'); return next && next !== previous }, oldRoot)
  await result(search).waitFor({ state: 'detached' })
  assert.equal((await counts()).starts, 1)
  assert.equal(await terminal.getAttribute('data-terminal-id'), terminalId); assert.deepEqual(pluginWorkers(page), workers)
  assert.equal(await page.locator('.file-editor').getAttribute('data-document-id'), grant)
  assert.ok(await host.evaluate((node, original) => (node as MonacoHost).monacoEditor!.getModel() === original, model))
  assert.equal(await editor.inputValue(), draft); await editor.press('Control+z')
  assert.equal(await editor.inputValue(), original.replaceAll('\r\n', '\n')); await model.dispose()
  assert.deepEqual(await gitFingerprint(project), before); assert.equal(await raw(), layout)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  assert.deepEqual(errors, [])
  console.log(`PASS shared Git/Search windows at DPR ${scale125 ? 1.25 : 1}: keyboard/pointer stacking, focus, modal comparison, one native search, persistent sessions and Monaco undo`)
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => { (globalThis as Partial<Probe>).sharedWindows?.release(); BrowserWindow.getAllWindows().forEach(win => win.destroy()) }).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
