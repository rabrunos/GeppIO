import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { PluginStore } from '../src/geppio/src/main/plugins.ts'
import type { ExplorerMutationResult } from '../src/geppio/src/shared/explorer.ts'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { initializeGit } from './git-fixtures.ts'
import { fileEditor, pluginWorkers } from './monaco-support.ts'
import { electron } from './test-electron.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-explorer-write-')), scale125 = process.argv.includes('--scale125')
let app: ElectronApplication | undefined
try {
  const base = await realpath(profile), project = join(base, 'project'), other = join(base, 'other')
  await initializeGit(project); await mkdir(other)
  const original = 'const answer = 1;\n', draft = 'const retained = 65;\n'
  for (let i = 1; i < 8; i++) await writeFile(join(project, 'slot-' + i + '.txt'), 'disposable ' + i)
  const plugins = new PluginStore(join(profile, 'GeppIO/plugins'))
  await plugins.install(resolve('.local/plugin-packages/counter')); await plugins.setEnabled('local.counter', true)
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
  env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(), errors: string[] = []
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1440, 940); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const tree = page.getByRole('tree', { name: 'Arquivos da pasta' })
  const item = (name: string) => tree.getByRole('treeitem', { name, exact: true })
  const idle = () => page.waitForFunction(() => !document.querySelector('.file-explorer[aria-busy="true"], .workspace-controls[aria-busy="true"], .file-editor[data-document-status="busy"]'))
  const pick = async (path: string, action: string) => {
    await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
    await button('Projeto local').click(); await button(action).click(); await idle()
  }
  const submit = async (trigger: string, title: string, field: string, name: string, action: string) => {
    await button(trigger).press('Enter')
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await dialog.getByRole('textbox', { name: field, exact: true }).fill(name)
    await dialog.getByRole('button', { name: action, exact: true }).press('Enter')
    await dialog.waitFor({ state: 'detached' }); await idle()
  }
  const layout = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="plugin:local.counter:counter"]').click()
  await page.locator('[data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const workers = pluginWorkers(page); assert.equal(workers.length, 1)
  await button('GeppIO Code').click(); await pick(project, 'Abrir projeto')
  await item('modified.ts').press('Enter'); await idle()
  const editor = fileEditor(page), host = page.locator('.monaco-host')
  await editor.fill(draft)
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  const grant = await page.locator('.file-editor').getAttribute('data-document-id'); assert.ok(grant)
  await button('Iniciar terminal').click()
  const terminal = page.locator('[data-terminal-phase="running"]'); await terminal.waitFor()
  const pty = await terminal.getAttribute('data-terminal-id'); assert.ok(pty)
  const baseline = await layout(), root = await item('project').getAttribute('data-explorer-node')
  assert.ok(root); assert.ok(baseline)
  const untouched = 'caller-check.txt', closed = await item('slot-1.txt').getAttribute('data-explorer-node')
  assert.ok(closed)
  const denied = await app.evaluate(async ({ ipcMain, BrowserWindow }, { root, closed, untouched }) => {
    type Handler = (event: unknown, ...args: unknown[]) => Promise<ExplorerMutationResult>
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, senderFrame = sender.mainFrame
    const results: ExplorerMutationResult[] = []
    for (const op of ['create-file', 'create-directory', 'rename-file']) {
      const handler = handlers.get('explorer:' + op)!, target = op === 'rename-file' ? closed : root
      for (const event of [{ sender: {}, senderFrame }, { sender, senderFrame: { url: senderFrame.url } },
        { sender, senderFrame: { url: 'https://example.invalid' } }]) {
        results.push(await handler(event, root, target, untouched))
      }
      results.push(await handler({ sender, senderFrame }, root, target, untouched, 'extra'))
    }
    return results.map(result => result.outcome)
  }, { root, closed, untouched })
  assert.deepEqual(denied, Array(12).fill('refused'))
  await assert.rejects(stat(join(project, untouched)), { code: 'ENOENT' })
  assert.equal(await readFile(join(project, 'slot-1.txt'), 'utf8'), 'disposable 1')
  const old = await page.evaluate(async root => {
    const { quickOpen, search } = window.geppio!
    const a = await quickOpen.start(root, 'modified.ts'), b = await search.start(root, 'answer', false)
    if (!a.ok || !b.ok) throw new Error('Expected disposable project grants')
    const end = Date.now() + 10000
    while (Date.now() < end) {
      const file = await quickOpen.read(a.value.job, 'modified.ts'), text = await search.read(b.value.job, 0)
      if (file.ok && file.value.items[0] && text.ok && text.value.items[0]) return {
        nameJob: a.value.job, nameId: file.value.items[0].id, textJob: b.value.job, textId: text.value.items[0].id }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Missing initial fixture results')
  }, root)
  const folder = 'Área de teste', source = "café $ & 'semi;.txt", target = "final $ & 'semi;.txt"
  const folderPath = join(project, folder)
  await item('project').focus(); await button('Novo arquivo').press('Enter')
  const invalidForm = page.getByRole('dialog', { name: 'Criar arquivo' })
  const overlength = 'x'.repeat(256), invalidName = invalidForm.getByRole('textbox', { name: 'Nome do arquivo' })
  await invalidName.fill(overlength)
  assert.equal(await invalidName.inputValue(), overlength)
  assert.ok(await invalidForm.getByRole('button', { name: 'Criar', exact: true }).isDisabled())
  await invalidName.press('Control+s')
  assert.ok(await invalidName.evaluate(node => node === document.activeElement))
  await idle()
  assert.equal(await readFile(join(project, 'modified.ts'), 'utf8'), 'const answer = 1;\r\n')
  await invalidForm.getByRole('button', { name: 'Cancelar' }).press('Enter')
  await invalidForm.waitFor({ state: 'detached' })
  await item('project').focus(); await submit('Nova pasta', 'Criar pasta', 'Nome da pasta', folder, 'Criar')
  await item(folder).waitFor(); assert.ok((await stat(folderPath)).isDirectory())
  const stale = await page.evaluate(async x => {
    const { quickOpen, search } = window.geppio!
    return [await quickOpen.open(x.nameJob, x.nameId), await search.open(x.textJob, x.textId)].map(r => !r.ok && r.expired === true)
  }, old); assert.deepEqual(stale, [true, true])
  await item(folder).focus(); await submit('Novo arquivo', 'Criar arquivo', 'Nome do arquivo', source, 'Criar')
  await page.getByRole('tab', { name: source, exact: false }).waitFor()
  assert.deepEqual(await readFile(join(folderPath, source)), Buffer.alloc(0))
  await editor.fill('salvo\n'); await editor.press('Control+s')
  await page.locator('.file-editor[data-document-status="clean"]').waitFor()
  assert.equal(await readFile(join(folderPath, source), 'utf8'), 'salvo\n')
  await button('Atualizar árvore').press('Enter'); await idle()
  const fileId = await item(source).getAttribute('data-explorer-node'); assert.ok(fileId)
  const rename = (id: string, name: string) => page.evaluate(({ root, id, name }) => window.geppio!.explorer.renameFile(root, id, name), { root, id, name })
  assert.equal((await rename(fileId, target)).outcome, 'refused', 'Open document bindings survive a native rename request')
  await button('Fechar arquivo').press('Enter'); await page.getByRole('tab', { name: source, exact: false }).waitFor({ state: 'detached' }); await idle()
  assert.equal(await editor.inputValue(), draft); assert.equal(await page.locator('.file-editor').getAttribute('data-document-id'), grant)
  const collision = 'ocupado.txt'
  await writeFile(join(folderPath, collision), 'keep existing', { flag: 'wx' })
  assert.equal((await rename(fileId, collision)).outcome, 'refused'); assert.equal(await readFile(join(folderPath, collision), 'utf8'), 'keep existing')
  assert.equal((await rename(fileId, source.toUpperCase())).outcome, 'refused')
  await item(source).focus(); await submit('Renomear arquivo', 'Renomear arquivo', 'Novo nome', target, 'Renomear')
  await item(target).waitFor()
  assert.equal(await readFile(join(folderPath, target), 'utf8'), 'salvo\n'); await assert.rejects(stat(join(folderPath, source)), { code: 'ENOENT' })
  assert.equal((await rename(fileId, 'obsolete.txt')).outcome, 'refused')
  await button('Alterações Git').click(); await page.locator('.git-file').filter({ hasText: folder + '/' + target }).waitFor()
  await button('Explorador').click(); await item('project').waitFor()
  assert.ok(await host.evaluate((node, saved) => (node as MonacoHost).monacoEditor!.getModel() === saved, model))
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), original); await model.dispose()
  for (let i = 1; i < 8; i++) { await item('slot-' + i + '.txt').press('Enter'); await idle() }
  assert.equal(await page.getByRole('tab').count(), 8)
  const eighth = await page.locator('.file-editor').getAttribute('data-document-id')
  await item('project').focus(); await submit('Novo arquivo', 'Criar arquivo', 'Nome do arquivo', 'ninth.txt', 'Criar')
  await item('ninth.txt').waitFor()
  await page.locator('[data-explorer-write-feedback]').filter({ hasText: /criado/i }).waitFor()
  assert.deepEqual(await readFile(join(project, 'ninth.txt')), Buffer.alloc(0))
  assert.equal(await page.getByRole('tab').count(), 8); assert.equal(await page.locator('.file-editor').getAttribute('data-document-id'), eighth)
  await pick(other, 'Trocar projeto'); await item('other').waitFor()
  const expired = await page.evaluate(root => window.geppio!.explorer.createFile(root, root, 'expired.txt'), root)
  assert.equal(expired.outcome, 'refused'); await assert.rejects(stat(join(project, 'expired.txt')), { code: 'ENOENT' })
  assert.deepEqual(pluginWorkers(page), workers); assert.equal(await terminal.getAttribute('data-terminal-id'), pty)
  assert.equal(await layout(), baseline); assert.deepEqual(errors, [])
  console.log('PASS Explorer writes: exclusive creation, witnessed open, real rename, collisions, revoked jobs, retained drafts/undo, ninth document, PTY and Worker at DPR', scale125 ? 1.25 : 1)
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
