import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Locator, Page } from 'playwright'
import type { GitResult } from '../src/shared/git.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { GitDiffHost } from '../src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { gitFingerprint, initializeGit } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'
import { electron } from './test-electron.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-git-window-'))
const scale125 = process.argv.includes('--scale125')
const diagnostics = resolve('.local/diagnostics/git-window' + (scale125 ? '-125' : ''))
let app: ElectronApplication | undefined, page: Page | undefined
const focused = (target: Locator) => target.evaluate(element => document.activeElement === element)

try {
  await mkdir(diagnostics, { recursive: true })
  const canonical = await realpath(profile)
  const project = join(canonical, 'first-root'), next = join(canonical, 'second-root'), unavailable = join(canonical, 'no-git')
  const git = await initializeGit(project)
  await initializeGit(next); await mkdir(unavailable)
  const saved = 'const answer = 2;\r\n', draft = 'const answer = 54;\n'
  await writeFile(join(project, 'modified.ts'), saved)
  await writeFile(join(next, 'second-only.txt'), 'second repository\n')
  const before = await gitFingerprint(project)
  const env = { ...process.env, GEPPIO_TEST_USER_DATA: profile, NODE_ENV: 'production' }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete (env as NodeJS.ProcessEnv)[key]
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const resize = (width: number, height: number) => app!.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setContentSize(w!, h!); win.show(); win.focus()
  }, [width, height])
  await resize(1440, 920)
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<GitResult>> })._invokeHandlers
    const status = handlers.get('git:status')!
    const probe = globalThis as typeof globalThis & { gitWindowStatusCalls: number }
    probe.gitWindowStatusCalls = 0
    handlers.set('git:status', (...args) => { probe.gitWindowStatusCalls++; return status(...args) })
  })
  const calls = () => app!.evaluate(() => (globalThis as typeof globalThis & { gitWindowStatusCalls: number }).gitWindowStatusCalls)
  const nativeWindows = () => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  page = await app.firstWindow()
  const win = page, errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)

  const float = page.getByRole('dialog', { name: 'Alterações Git', exact: true })
  const close = float.getByRole('button', { name: 'Fechar', exact: true }), grip = float.locator('.internal-view-grip')
  const menu = page.getByRole('button', { name: 'Mais opções do projeto', exact: true })
  const workbenchOpen = page.getByRole('menuitem', { name: 'Abrir Git em janela', exact: true })
  const activity = page.getByRole('button', { name: 'Alterações Git', exact: true })
  const sidebar = page.locator('.editor-explorer-panel .git-changes'), floatingGit = float.locator('.git-changes')
  const codeOpen = sidebar.getByRole('button', { name: 'Abrir Git em janela', exact: true })
  const raw = () => win.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  const change = (panel: Locator, name: string) => panel.locator('.git-file', { hasText: name })
  const bounds = async () => {
    const frame = await float.boundingBox(); assert.ok(frame)
    return frame
  }
  const move = async (dx: number, dy: number, cancel = false) => {
    const box = await grip.boundingBox(); assert.ok(box)
    const x = box.x + 60, y = box.y + box.height / 2
    await win.mouse.move(x, y); await win.mouse.down()
    try {
      await win.mouse.move(x + dx, y + dy, { steps: 8 })
      if (cancel) await win.keyboard.press('Escape')
    } finally { await win.mouse.up() }
    await settle(win)
  }
  const select = async (name: 'GeppIO Code' | 'Bancada de Trabalho') => {
    const button = win.getByRole('group', { name: 'Experiência de trabalho' }).getByRole('button', { name, exact: true })
    await button.click()
    await win.waitForFunction(name => document.querySelector('.workbench')?.getAttribute('data-experience') === name,
      name === 'GeppIO Code' ? 'geppio-code' : 'workbench')
    assert.ok(await focused(button))
  }
  const openProject = async (path: string, action: 'Abrir projeto' | 'Trocar projeto') => {
    await app!.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, path)
    await win.getByRole('button', { name: 'Projeto local', exact: true }).click()
    await win.getByRole('button', { name: action, exact: true }).click()
  }
  const unchangedLayout = await raw()
  await menu.press('Enter'); await workbenchOpen.press('Enter'); await float.waitFor()
  assert.equal(await float.getAttribute('aria-modal'), 'false')
  assert.ok(await focused(close))
  assert.match(await floatingGit.innerText(), /Abra uma pasta/)
  assert.equal(await page.locator('.widget-frame').count(), 0)
  await close.press('Enter'); await float.waitFor({ state: 'detached' })
  assert.ok(await focused(menu)); assert.equal(await raw(), unchangedLayout)

  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await enableDeveloperMode(manager)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/counter'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  await manager.locator('[data-plugin="local.counter"]').getByRole('switch').click()
  await manager.locator('[data-plugin="local.counter"][data-status="active"]').waitFor()
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  const workers = pluginWorkers(page)
  assert.equal(workers.length, 1)

  await select('GeppIO Code'); await openProject(project, 'Abrir projeto')
  await page.getByRole('treeitem', { name: 'modified.ts', exact: true }).press('Enter')
  const editor = fileEditor(page)
  await editor.fill(draft)
  await activity.click(); await change(sidebar, 'modified.ts').waitFor()
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  const terminal = page.locator('[data-terminal-phase="running"]')
  await terminal.waitFor()
  const terminalId = await terminal.getAttribute('data-terminal-id')
  assert.ok(terminalId)
  const statusCalls = await calls(), root = await sidebar.getAttribute('data-git-root')
  assert.ok(root)
  await codeOpen.press('Enter'); await float.waitFor()
  await change(floatingGit, 'modified.ts').waitFor()
  assert.ok(await focused(close))
  assert.equal(await floatingGit.getAttribute('data-git-root'), root)
  assert.equal(await nativeWindows(), 1)
  assert.equal(await page.locator('.widget-frame').count(), 0)
  await page.keyboard.press('Shift+Tab')
  assert.ok(await float.evaluate(element => !element.contains(document.activeElement)), 'Keyboard focus can leave the floating presentation')
  await page.locator('.direct-file-editor .view-lines').click({ position: { x: 40, y: 6 } })
  assert.ok(await editor.focused(), 'The area outside the floating window still accepts pointer input')
  await editor.press('End'); assert.ok(await editor.focused())
  assert.equal(await editor.inputValue(), draft)

  const initialBounds = await bounds()
  await move(-140, 78)
  const moved = await bounds()
  assert.ok(Math.abs(initialBounds.x - moved.x - 140) < 2 && Math.abs(moved.y - initialBounds.y - 78) < 2)
  await move(55, -32, true)
  assert.deepEqual(await bounds(), moved, 'Escape cancels an in-progress title drag before closing the window')
  const instance = await float.elementHandle()
  await codeOpen.press('Enter'); assert.ok(await focused(close))
  assert.equal(await float.count(), 1)
  assert.ok(await instance!.evaluate(node => node === document.querySelector('[data-floating-view="git-changes"]')))
  assert.deepEqual(await bounds(), moved)
  await page.keyboard.press('Escape'); await float.waitFor({ state: 'detached' })
  assert.ok(await focused(codeOpen)); assert.equal(await calls(), statusCalls)
  await codeOpen.press('Enter'); await float.waitFor()
  assert.deepEqual(await bounds(), initialBounds)
  assert.equal(await calls(), statusCalls, 'Presentation lifecycle does not acquire or refresh the Core session')

  await floatingGit.getByRole('button', { name: 'Atualizar Git', exact: true }).click()
  await editor.focus(); await change(floatingGit, 'modified.ts').waitFor()
  assert.ok(await editor.focused(), 'A status update does not take focus from the Editor')

  await change(floatingGit, 'modified.ts').click()
  const diff = page.getByRole('dialog', { name: 'Comparação Git · modified.ts', exact: true })
  const diffHost = diff.locator('.git-diff[data-git-diff-models="2"]')
  await diffHost.waitFor()
  assert.ok(await diff.evaluate(element => element.matches(':modal') && element.contains(document.activeElement)))
  assert.deepEqual(await diffHost.evaluate(node => {
    const compare = (node as GitDiffHost).monacoDiffEditor!
    return [compare.getOriginalEditor().getValue(), compare.getModifiedEditor().getValue(), compare.getModifiedEditor().getRawOptions().readOnly]
  }), ['const answer = 1;\r\n', saved, true])
  await page.keyboard.press('Control+s')
  await page.keyboard.press('Escape'); await diff.waitFor({ state: 'detached' }); await float.waitFor()
  await page.waitForFunction(() => document.activeElement?.matches('[data-floating-view] .git-file[title="modified.ts"]'))
  assert.deepEqual(await bounds(), initialBounds)
  assert.deepEqual(await gitFingerprint(project), before)

  await floatingGit.getByRole('button', { name: 'Preparar modified.ts', exact: true }).click()
  await sidebar.getByRole('button', { name: 'Despreparar modified.ts', exact: true }).waitFor()
  assert.equal(git(['show', ':modified.ts']), saved)
  assert.equal(git(['diff', '--cached', '--name-only']).trim(), 'modified.ts')
  await floatingGit.getByRole('button', { name: 'Despreparar modified.ts', exact: true }).click()
  await sidebar.getByRole('button', { name: 'Preparar modified.ts', exact: true }).waitFor()
  assert.equal(git(['diff', '--cached', '--name-only']), '')
  assert.equal(await readFile(join(project, 'modified.ts'), 'utf8'), saved)
  const protectedFiles = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([name]) => name !== '.git/index' && !name.startsWith('.git/objects/')))
  assert.deepEqual(protectedFiles(await gitFingerprint(project)), protectedFiles(before))
  assert.equal(await editor.inputValue(), draft)
  assert.deepEqual(await bounds(), initialBounds)

  await move(280, 460)
  const beforeResize = await bounds()
  await resize(1000, 720)
  await page.waitForFunction(before => {
    const window = document.querySelector('[data-floating-view]')?.getBoundingClientRect()
    const area = document.querySelector('.internal-view-layer')?.getBoundingClientRect()
    return window && area && window.left >= area.left && window.top >= area.top && window.right <= area.right && window.bottom <= area.bottom && window.left < before.x && window.top < before.y
  }, beforeResize)
  await page.screenshot({ path: join(diagnostics, 'reclamped.png') })
  await close.click(); await float.waitFor({ state: 'detached' })
  assert.equal(await raw(), unchangedLayout)
  await resize(1440, 920); await select('Bancada de Trabalho')
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="host:git-changes"]').click()
  await page.locator('[data-widget-place="sidebar"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const layoutWithWidget = await raw()
  assert.notEqual(layoutWithWidget, unchangedLayout)
  await menu.press('Enter'); await workbenchOpen.press('Enter'); await float.waitFor()
  const widget = page.locator('.widget-frame .git-changes')
  await change(widget, 'modified.ts').waitFor()
  assert.equal(await widget.getAttribute('data-git-root'), await floatingGit.getAttribute('data-git-root'))
  await select('GeppIO Code'); await change(sidebar, 'modified.ts').waitFor()
  assert.equal(await editor.inputValue(), draft)
  assert.equal(await raw(), layoutWithWidget)
  assert.equal(await floatingGit.getAttribute('data-git-root'), root)
  assert.equal(await terminal.getAttribute('data-terminal-id'), terminalId)
  assert.deepEqual(pluginWorkers(page), workers)

  await openProject(next, 'Trocar projeto'); await change(floatingGit, 'second-only.txt').waitFor()
  assert.equal(await change(floatingGit, 'modified.ts').count(), 0)
  assert.notEqual(await floatingGit.getAttribute('data-git-root'), root)
  const stale = await page.evaluate(root => window.geppio!.git.status(root), root)
  assert.ok(!stale.ok && stale.code === 'stale')
  await activity.click(); await change(sidebar, 'second-only.txt').waitFor()
  assert.equal(await sidebar.getAttribute('data-git-root'), await floatingGit.getAttribute('data-git-root'))
  await openProject(unavailable, 'Trocar projeto')
  await floatingGit.getByRole('alert').waitFor()
  assert.match(await floatingGit.getByRole('alert').innerText(), /não contém \.git/)
  assert.equal(await change(floatingGit, 'second-only.txt').count(), 0)
  await page.getByRole('button', { name: 'Projeto local', exact: true }).click()
  await page.getByRole('button', { name: 'Fechar projeto', exact: true }).click()
  await floatingGit.getByText('Abra uma pasta no Explorador para consultar sua raiz Git.').waitFor()
  await page.getByRole('button', { name: 'Projeto local', exact: true }).press('Escape')
  await close.click(); await float.waitFor({ state: 'detached' })
  assert.ok(await focused(activity), 'Close goes to the Code rail when the opening control is unavailable')
  assert.equal(await raw(), layoutWithWidget)
  assert.equal(await nativeWindows(), 1)
  assert.deepEqual(errors, [])
  console.log(`PASS Git Shared View at DPR ${scale125 ? 1.25 : 1}: singleton, bounded pointer drag/resize, non-modal focus, blocking comparison, shared per-file stage/unstage and stale grants; Workbench storage, dirty document, PTY and plugin Worker preserved`)
} catch (error) {
  await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {})
  await app?.close().catch(() => {})
  await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
