import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { gitFingerprint, initializeGit } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'
import { electron } from './test-electron.ts'
import { measureAppHost } from './app-host-measurements.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-app-host-'))
const scale125 = process.argv.includes('--scale125')
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
const errors: string[] = []
let app: ElectronApplication | undefined

try {
  const project = join(await realpath(profile), 'app-host-project')
  await initializeGit(project)
  await writeFile(join(project, 'modified.ts'), 'const answer = 2;\r\n')
  const fingerprints = await gitFingerprint(project)
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const openFixture = (selected: string) => app!.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, selected)
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setContentSize(1000, 720); win.show(); win.focus()
  })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)

  const shell = page.locator('.workbench')
  const switcher = page.getByRole('group', { name: 'Experiência de trabalho' })
  const code = switcher.getByRole('button', { name: 'GeppIO Code', exact: true })
  const workbench = switcher.getByRole('button', { name: 'Bancada de Trabalho', exact: true })
  const editor = fileEditor(page), host = page.locator('.monaco-host')
  const workspace = page.locator('.workspace-controls')
  const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  const tabs = () => page.locator('[data-document-tab]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('data-document-tab'), node.getAttribute('aria-selected'), node.textContent]))
  const waitForDocument = (name: string) => page.waitForFunction(name => {
    const active = document.querySelector('[data-document-tab][aria-selected="true"]')
    return active?.textContent?.includes(name) && document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy'
  }, name)
  const changeTo = async (experience: 'workbench' | 'geppio-code') => {
    const button = experience === 'workbench' ? workbench : code
    await button.press('Enter'); await settle(page)
    assert.equal(await shell.getAttribute('data-experience'), experience)
    assert.equal(await shell.getAttribute('data-app-id'), experience === 'workbench' ? null : experience)
    assert.equal(await button.getAttribute('aria-pressed'), 'true')
    assert.equal(await button.evaluate(element => document.activeElement === element), true)
  }
  assert.equal(await shell.getAttribute('data-experience'), 'workbench')
  for (const button of [workbench, code]) {
    assert.equal(await button.evaluate(node => {
      const bounds = node.getBoundingClientRect()
      return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth
    }), true)
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))

  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  const installed = manager.locator('[data-plugin="local.counter"]')
  await enableDeveloperMode(manager)
  await openFixture(resolve('.local/plugin-packages/counter'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  await installed.getByRole('switch').click()
  await installed.and(page.locator('[data-status="active"]')).waitFor()
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  const workers = pluginWorkers(page)
  assert.equal(workers.length, 1)

  await page.getByTestId('edit-layout').click(); await settle(page)
  assert.equal(await code.isDisabled(), true)
  await code.evaluate((button: HTMLButtonElement) => button.click())
  assert.equal(await shell.getAttribute('data-experience'), 'workbench')
  for (const [type, region] of [['host:file-editor', 'main'], ['plugin:local.counter:counter', 'main'], ['host:terminal', 'bottom']]) {
    await page.locator(`[data-catalog-type="${type}"]`).click()
    await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
  }
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const counter = page.locator('[data-plugin-widget="local.counter:counter"]')
  const counterNode = await counter.elementHandle()
  await counter.getByRole('button', { name: 'Incrementar' }).click()
  await counter.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor()

  const sidebar = page.getByRole('separator', { name: 'Largura da Sidebar', exact: true })
  const initialLayout = await raw()
  assert.ok(initialLayout)
  const side = (await sidebar.boundingBox())!
  await page.mouse.move(side.x + side.width / 2, side.y + side.height / 2)
  await page.mouse.down()
  try {
    await page.mouse.move(side.x + side.width / 2 + 18, side.y + side.height / 2)
    await code.evaluate((button: HTMLButtonElement) => button.click())
    await page.getByText('Conclua ou cancele a operação atual antes de trocar de experiência.', { exact: true }).waitFor()
    assert.equal(await shell.getAttribute('data-experience'), 'workbench')
    assert.equal(await raw(), initialLayout)
    await page.keyboard.press('Escape')
  } finally { await page.mouse.up() }
  assert.equal(await raw(), initialLayout)

  const release = await page.evaluateHandle(key => new Promise<() => void>(resolveLock => {
    void navigator.locks.request(key, () => new Promise<void>(releaseLock => resolveLock(releaseLock)))
  }), WORKBENCH_KEY)
  try {
    const bottom = page.getByRole('separator', { name: 'Altura da Bottom', exact: true })
    await bottom.press('Enter')
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.experience-switch button:last-child')?.disabled)
    await code.evaluate((button: HTMLButtonElement) => button.click())
    assert.equal(await shell.getAttribute('data-experience'), 'workbench')
    assert.equal(await raw(), initialLayout)
  } finally { await release.evaluate(unlock => unlock()); await release.dispose() }
  await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('data-bottom-mode') === 'hidden' &&
    !document.querySelector<HTMLButtonElement>('.experience-switch button:last-child')?.disabled)
  await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter')
  await settle(page)
  const savedLayout = await raw()
  assert.ok(savedLayout)

  await changeTo('geppio-code')
  assert.equal(await counter.isVisible(), false)
  await page.locator('.direct-file-editor .file-editor').waitFor()
  await openFixture(project)
  await page.getByRole('button', { name: 'Projeto local' }).click()
  await page.getByRole('button', { name: 'Abrir projeto', exact: true }).click()
  const tree = page.getByRole('tree')
  const root = tree.getByRole('treeitem', { name: 'app-host-project', exact: true })
  await root.waitFor()
  const rootId = await root.getAttribute('data-explorer-node')
  assert.ok(rootId)
  assert.equal(await workspace.getAttribute('data-workspace-root'), rootId)
  await tree.getByRole('treeitem', { name: 'modified.ts', exact: true }).press('Enter')
  await waitForDocument('modified.ts')
  await editor.fill('const answer = 52;\n')
  await tree.getByRole('treeitem', { name: 'both.txt', exact: true }).press('Enter')
  await waitForDocument('both.txt')
  await editor.fill('unsaved second file\n')
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'before\n')
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), 'unsaved second file\n')
  const setPosition = () => host.evaluate(node => {
    const editor = (node as MonacoHost).monacoEditor!
    editor.setSelection({ startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 8 })
  })
  const currentSelection = () => host.evaluate(node => (node as MonacoHost).monacoEditor!.getSelection())
  await setPosition()
  const selection = await currentSelection(), snapshot = await tabs()
  assert.equal(snapshot.length, 2)
  assert.ok(snapshot.every(([, , title]) => title?.includes('●')))
  const monaco = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!)
  const activeModel = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel())

  await page.getByRole('button', { name: 'Alterações Git', exact: true }).click()
  const change = page.locator('.git-file').getByText('modified.ts', { exact: true })
  await change.waitFor()
  const gitStatus = await page.locator('.git-changes').innerText()
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click()
  const terminal = page.locator('[data-terminal-phase="running"]')
  await terminal.waitFor()
  const terminalId = await terminal.getAttribute('data-terminal-id')
  assert.ok(terminalId)
  const emulator = await terminal.locator('.terminal-emulator').elementHandle()
  const state = async () => {
    const result = await page.evaluate(id => window.geppio!.terminal.read(id, 0), terminalId)
    assert.ok(result.ok)
    return result.value.state
  }
  assert.equal((await realpath((await state()).cwd)).toLowerCase(), project.toLowerCase())
  async function terminalCommand(command: string, output: string) {
    const input = page.locator('.terminal-host .xterm-helper-textarea')
    await input.focus(); await page.keyboard.insertText(command); await page.keyboard.press('Enter')
    await page.waitForFunction(async ({ id, output }) => {
      const result = await window.geppio!.terminal.read(id, 0)
      return result.ok && result.value.data.includes(output)
    }, { id: terminalId, output })
  }
  await terminalCommand("$global:GeppioAppHost = 'CONTINUITY'; Write-Output ('APP_' + $global:GeppioAppHost)", 'APP_CONTINUITY')
  const bottom = page.getByRole('separator', { name: 'Altura da Bottom', exact: true })
  await bottom.press('Enter'); await settle(page)
  assert.equal(await terminal.isVisible(), false); assert.equal((await state()).id, terminalId)
  await bottom.press('Enter'); await settle(page)
  assert.ok(await terminal.isVisible())
  assert.equal(await raw(), savedLayout)
  for (let round = 0; round < 2; round++) {
    await changeTo('workbench')
    assert.equal(await page.locator('.direct-file-editor').count(), 0)
    assert.equal(await counterNode!.evaluate(node => node === document.querySelector('[data-plugin-widget="local.counter:counter"]')), true)
    await counter.getByText(`Cliques nesta ativação: ${round + 1}`, { exact: true }).waitFor()
    await counter.getByRole('button', { name: 'Incrementar' }).click()
    await terminalCommand(`Write-Output ('ROUND${round}_' + $global:GeppioAppHost)`, `ROUND${round}_CONTINUITY`)
    await changeTo('geppio-code')
    assert.equal(await counter.isVisible(), false)
    await change.waitFor()
    assert.equal(await page.locator('.git-changes').innerText(), gitStatus)
    assert.deepEqual(pluginWorkers(page), workers)
    assert.equal(await workspace.getAttribute('data-workspace-root'), rootId)
    assert.deepEqual(await tabs(), snapshot)
    assert.equal(await host.evaluate((node, previous) => (node as MonacoHost).monacoEditor === previous, monaco), true)
    assert.equal(await host.evaluate((node, previous) => (node as MonacoHost).monacoEditor!.getModel() === previous, activeModel), true)
    assert.deepEqual(await currentSelection(), selection)
    assert.equal(await editor.inputValue(), 'unsaved second file\n')
    assert.equal(await terminal.getAttribute('data-terminal-id'), terminalId)
    assert.equal(await emulator!.evaluate(node => node === document.querySelector('.terminal-emulator')), true)
    assert.equal(await raw(), savedLayout)
  }
  await page.locator('[data-document-tab]').filter({ hasText: 'modified.ts' }).click()
  await waitForDocument('modified.ts')
  assert.equal(await editor.inputValue(), 'const answer = 52;\n')
  await page.getByRole('button', { name: 'Explorador', exact: true }).click()
  assert.equal(await root.getAttribute('data-explorer-node'), rootId)
  assert.equal(await tree.getByRole('treeitem', { name: 'modified.ts', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: 'Encerrar', exact: true }).click()
  await page.waitForFunction(() => !!document.querySelector('[data-terminal-phase="closed"]'))
  assert.deepEqual(await gitFingerprint(project), fingerprints)
  await assert.rejects(stat(join(project, '.geppio')), { code: 'ENOENT' })
  assert.deepEqual(errors, [])
  console.log('PASS App Host: keyboard selection; blocked Edit, region capture and pending saves; exact layouts, two drafts, Monaco, Workspace, Git, native PTY and plugin Worker continuity')
} finally {
  try { await app?.close() } finally { await rm(profile, { recursive: true, force: true }) }
}
if (!scale125) await measureAppHost(env)
