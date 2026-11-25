import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright'
import type { DocumentResult } from '@geppio/runtime/documents'
import type { MonacoHost } from '../src/geppio/src/renderer/src/files-editor/monaco.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { fileEditor } from './monaco-support.ts'
import { electron } from './test-electron.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-document-reload-')), scale125 = process.argv.includes('--scale125')
let app: ElectronApplication | undefined
try {
  const project = join(await realpath(profile), 'project'), main = join(project, 'active.txt'), sibling = join(project, 'other.txt')
  await mkdir(project); await writeFile(main, '\ufeffone\r\ntwo\nthree\r'); await writeFile(sibling, 'other')
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined))
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
  env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000)
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1480, 980); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const item = (name: string) => page.getByRole('treeitem', { name, exact: true })
  const editor = fileEditor(page), host = page.locator('.monaco-host'), state = page.locator('.file-editor')
  const idle = () => page.waitForFunction(() => !document.querySelector('.file-explorer[aria-busy="true"], .file-editor[data-document-status="busy"]'))
  const view = () => host.evaluate(node => { const editor = (node as MonacoHost).monacoEditor!, model = editor.getModel()!
    return { uri: model.uri.toString(), text: model.getValue(), version: model.getAlternativeVersionId(), language: model.getLanguageId(),
      selection: editor.getSelections()?.map(s => [s.selectionStartLineNumber, s.selectionStartColumn, s.positionLineNumber, s.positionColumn]), top: editor.getScrollTop() }
  })
  const tab = (id: string) => page.locator('[data-document-tab="' + id + '"]')
  const reload = async () => { await button('Recarregar do disco').press('Enter'); await idle() }
  type DialogProbe = { choices: number[]; calls: number; defaultCancel: boolean }
  type ProbeScope = { reloadProbe: DialogProbe }
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] })
    const probe = ((globalThis as unknown as ProbeScope).reloadProbe = { choices: [], calls: 0, defaultCancel: true } as DialogProbe)
    dialog.showMessageBox = (async (_win, options) => {
      probe.calls++
      probe.defaultCancel &&= options.title === 'Recarregar do disco' && options.defaultId === 0 && options.cancelId === 0 &&
        options.buttons?.[0] === 'Cancelar' && options.buttons[1] === 'Descartar rascunho e recarregar' && !!options.detail?.includes('desfazer')
      return { response: probe.choices.shift() ?? 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, project)
  const probe = () => app!.evaluate(() => (globalThis as unknown as ProbeScope).reloadProbe)
  const choose = (choice: number) => app!.evaluate((_electron, choice) => { (globalThis as unknown as ProbeScope).reloadProbe.choices.push(choice) }, choice)
  await button('GeppIO Code').click(); await button('Projeto local').click(); await button('Abrir projeto').click()
  await item('other.txt').press('Enter'); await idle()
  const otherId = await state.getAttribute('data-document-id'); assert.ok(otherId)
  await editor.fill('other draft'); const otherView = await view()
  await item('active.txt').press('Enter'); await idle()
  const active = await state.getAttribute('data-document-id'); assert.ok(active)
  const root = await item('project').getAttribute('data-explorer-node'); assert.ok(root)
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  const layout = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await page.getByRole('combobox', { name: 'Linguagem do documento' }).selectOption({ label: 'TypeScript' })
  await host.evaluate(node => {
    const editor = (node as MonacoHost).monacoEditor!
    editor.pushUndoStop()
    editor.executeEdits('fixture-insert', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'saved ' }])
    editor.pushUndoStop()
  })
  await editor.press('Control+s')
  await page.locator('.file-editor[data-document-status="clean"]').waitFor()
  assert.equal(await readFile(main, 'utf8'), '\ufeffsaved one\r\ntwo\nthree\r')
  await button('Atualizar árvore').press('Enter'); await idle()
  const oldNode = await item('active.txt').getAttribute('data-explorer-node'); assert.ok(oldNode)
  const grant = await page.evaluate(async id => {
    const reply = await window.geppio!.documents.activate(id)
    if (!reply.ok || !reply.document) throw new Error('Disposable active grant missing')
    const { id: token, revision, text } = reply.document
    return { id: token, revision, text }
  }, active)
  const denied = await app.evaluate(async ({ ipcMain, BrowserWindow }, grant) => {
    type Handler = (event: unknown, ...args: unknown[]) => Promise<DocumentResult>
    const handler = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('document:reload')!
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, senderFrame = sender.mainFrame, event = { sender, senderFrame }
    const results = await Promise.all([handler({ sender: {}, senderFrame }, grant, false),
      handler({ sender, senderFrame: { url: senderFrame.url } }, grant, false),
      handler({ sender, senderFrame: { url: 'https://example.invalid' } }, grant, false),
      handler(event, { ...grant, path: 'unused' }, false), handler(event, grant, false, 'extra'), handler(event, grant, 'false')])
    return results.every(value => !value.ok && value.code === 'invalid' && !value.confirmed && !value.documents)
  }, grant)
  assert.ok(denied); assert.equal((await probe()).calls, 0)
  const saved = await view(); await reload()
  assert.deepEqual(await view(), saved); assert.equal((await probe()).calls, 0)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'one\ntwo\nthree\n')
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), saved.text)
  assert.equal((await page.evaluate(({ root, oldNode }) => window.geppio!.explorer.open(root, oldNode, null), { root, oldNode })).ok, false)
  // Preserve visible undo when only line endings changed, and use the new exact base on the next save.
  await writeFile(main, saved.text); const beforeEol = await view(); await reload()
  assert.deepEqual(await view(), beforeEol)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'one\ntwo\nthree\n')
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), saved.text)
  await editor.press('Control+End'); await page.keyboard.insertText('lf'); await editor.press('Control+s')
  await page.locator('.file-editor[data-document-status="clean"]').waitFor()
  assert.deepEqual(await readFile(main), Buffer.from(saved.text + 'lf'))

  // Explicit reload can adopt new bytes and a new file identity at the same authorized path.
  const replacement = join(project, 'incoming.txt')
  await host.evaluate(node => { const editor = (node as MonacoHost).monacoEditor!
    editor.setSelections([{ selectionStartLineNumber: 1, selectionStartColumn: 3, positionLineNumber: 1, positionColumn: 2 },
      { selectionStartLineNumber: 4, selectionStartColumn: 2, positionLineNumber: 4, positionColumn: 3 }])
  })
  await writeFile(replacement, 'external\r\n'); await rename(replacement, main)
  await reload(); assert.equal(await editor.inputValue(), 'external\n')
  assert.deepEqual((await view()).selection, [[1, 3, 1, 2], [2, 1, 2, 1]])
  assert.equal(await state.getAttribute('data-document-id'), active); assert.equal((await view()).language, 'typescript')
  assert.equal(await host.evaluate((node, kept) => (node as MonacoHost).monacoEditor!.getModel() === kept, model), true)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'external\n')
  await editor.fill('protected draft'); const dirty = await view()
  await writeFile(main, 'second\n'); await choose(0); await reload()
  assert.deepEqual(await view(), dirty); assert.equal((await probe()).calls, 1)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'external\n')
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), 'protected draft')
  await choose(1); await reload(); assert.equal(await editor.inputValue(), 'second\n')
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'second\n')

  // Lose the reply after Main has accepted the new file. The next explicit action reconciles that exact grant.
  await app.evaluate(({ ipcMain }) => {
    type Handler = (event: unknown, ...args: unknown[]) => Promise<DocumentResult>
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const key = 'document:reload', actual = handlers.get(key)!
    handlers.set(key, async (event, ...args) => { handlers.set(key, actual); const result = await actual(event, ...args)
      if (!result.ok || !result.document) throw new Error('Unexpected fixture result')
      throw new Error('Disposable lost reply')
    })
  })
  await writeFile(main, 'after lost reply'); const beforeLost = await view(); await reload()
  assert.deepEqual(await view(), beforeLost); assert.equal(await readFile(main, 'utf8'), 'after lost reply')
  await choose(0); await reload(); assert.deepEqual(await view(), beforeLost)
  await choose(1); await reload(); assert.equal(await editor.inputValue(), 'after lost reply')
  const dialogs = await probe(); assert.equal(dialogs.calls, 4); assert.ok(dialogs.defaultCancel); assert.deepEqual(dialogs.choices, [])
  // Exercise Alpha.56's unconfirmed Save through the real broker before the next read-only reload.
  await app.evaluate((_electron, path) => {
    const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises'), original = fs.rename
    fs.rename = async (from, to) => {
      await original(from, to)
      if (String(to) === path) { fs.rename = original; await fs.writeFile(path, 'external after save') }
    }
  }, main)
  await editor.fill('draft at uncertain save'); await editor.press('Control+s')
  await page.locator('.file-editor[data-document-status="unconfirmed"]').waitFor()
  const afterSave = await view(); await choose(0); await reload()
  assert.deepEqual(await view(), afterSave); assert.equal(await readFile(main, 'utf8'), 'external after save')
  await choose(1); await reload(); assert.equal(await editor.inputValue(), 'external after save')
  assert.equal((await probe()).calls, 6)
  await editor.fill('retained on bad bytes'); await writeFile(main, Buffer.from([0, 255]))
  await choose(1); await reload(); assert.equal(await editor.inputValue(), 'retained on bad bytes')
  assert.deepEqual(await readFile(main), Buffer.from([0, 255]))
  await tab(otherId).click(); await idle(); assert.deepEqual(await view(), otherView)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), 'other'); assert.equal(await readFile(sibling, 'utf8'), 'other')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), layout)
  assert.deepEqual(errors, []); await model.dispose()
  console.log('PASS explicit reload: clean, default Cancel, deliberate discard, mixed EOL, invalid bytes, lost acknowledgment, model and undo retention; DPR', scale125 ? 1.25 : 1)
} finally {
  try { await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {}) }
  finally { await rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
}
