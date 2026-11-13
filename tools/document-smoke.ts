import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { DocumentDraft, DocumentResult } from '../src/shared/documents.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-documents-')), documentRoot = await realpath(profile)
// Retain the lexical profile under os.tmpdir() for the existing profile guard;
// selected document fixtures use canonical paths, including on Windows 8.3 temp roots.
const path = join(documentRoot, 'document.ts'), other = join(documentRoot, 'other.txt'), diagnostics = resolve('.local/diagnostics/documents-alpha37')
await mkdir(diagnostics, { recursive: true }); await writeFile(path, '\ufeffconst café = "😀";\r\n'); await writeFile(other, 'other\n')
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], evidence: Record<string, string> = {}
const text = () => page.getByRole('textbox', { name: 'Conteúdo do arquivo', exact: true })
const mode = (value: 'Editor' | 'Widgets') => page.locator('.file-mode-switch').getByRole('button', { name: value, exact: true }).click()
const state = () => page.locator('.file-editor')
const idle = () => page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-status') !== 'busy')
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
async function launch() {
  app = await electron.launch({ args: ['.'], env }); page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1920, 1080); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
}
async function picker(file: string | null = path, response = 2) {
  await app!.evaluate(({ dialog }, { file, response }) => {
    dialog.showOpenDialog = async () => ({ canceled: file === null, filePaths: file === null ? [] : [file] })
    dialog.showMessageBox = (async () => ({ response, checkboxChecked: false })) as typeof dialog.showMessageBox
  }, { file, response })
}
async function open(file: string | null = path, response = 2) { await picker(file, response); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click(); await idle() }
async function save() { await page.getByRole('button', { name: 'Salvar arquivo', exact: true }).click(); await idle() }
async function nativeClose() { await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()); await idle() }
async function place(type: string, region: string) {
  await page.locator(`[data-catalog-type="${type}"]`).click(); await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
}
try {
  await launch()
  if (process.argv.includes('--native-ui')) {
    await mode('Editor')
    await writeFile(join(diagnostics, 'native-fixture.json'), JSON.stringify({ profile, path, other }))
    console.log('NATIVE_UI_READY: disposable fixture recorded in .local/diagnostics/documents-alpha37/native-fixture.json')
    await app!.waitForEvent('close', { timeout: 600_000 }); app = undefined
    evidence.nativeUI = 'External computer-use observation required; this wait alone proves no interaction.'
  } else {
    await mode('Editor'); await open(); assert.equal(await text().inputValue(), 'const café = "😀";\n')
    const id = await state().getAttribute('data-document-id')
    await text().fill('const café = "editado 😀";\n'); assert.equal(await state().getAttribute('data-document-dirty'), 'true')
    await open(null); assert.equal(await text().inputValue(), 'const café = "editado 😀";\n'); assert.equal(await state().getAttribute('data-document-id'), id)
    await open(other, 2); assert.equal(await state().getAttribute('data-document-id'), id)
    await text().press('Control+s'); await idle(); assert.equal(await state().getAttribute('data-document-dirty'), 'false')
    assert.equal(await readFile(path, 'utf8'), '\ufeffconst café = "editado 😀";\r\n')
    evidence.lifecycle = 'passed: native picker boundary, cancellation, exact BOM/CRLF/non-BMP bytes and Ctrl+S'

    // Actual native handlers with malformed, foreign and subframe identities; no production test hook.
    const negatives = await app!.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<DocumentResult>> })._invokeHandlers
      const win = BrowserWindow.getAllWindows()[0]!, sender = win.webContents, frame = sender.mainFrame
      const value = { id: 'bad', revision: 'bad', text: 'bad' }
      return Promise.all([
        handlers.get('document:save')!({ sender, senderFrame: frame }, value),
        handlers.get('document:open')!({ sender, senderFrame: frame }, null, 'extra'),
        handlers.get('document:save')!({ sender: {}, senderFrame: frame }, value),
        handlers.get('document:save')!({ sender, senderFrame: { url: frame.url } }, value),
        handlers.get('document:save')!({ sender, senderFrame: { url: 'https://example.invalid/' } }, value)
      ])
    })
    assert.ok(negatives.every(result => !result.ok && result.code === 'invalid'))
    const retryClose = await app!.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<DocumentResult>> })._invokeHandlers
      const win = BrowserWindow.getAllWindows()[0]!, sender = win.webContents, send = sender.send, tickets: string[] = [], results: DocumentResult[] = []
      // Intercept only delivery, so malformed replies exercise the real native close gate.
      sender.send = function (channel, ...args) { if (channel === 'document:close-requested') { tickets.push(args[0]); return }; send.call(this, channel, ...args) }
      try {
        for (let i = 0; i < 2; i++) {
          win.close()
          results.push(await handlers.get('document:close')!({ sender, senderFrame: sender.mainFrame }, tickets[i], null, 'extra'))
        }
        return { tickets, results }
      } finally { sender.send = send }
    })
    assert.equal(retryClose.tickets.length, 2); assert.notEqual(retryClose.tickets[0], retryClose.tickets[1])
    assert.ok(retryClose.results.every(result => !result.ok && result.code === 'invalid'))
    assert.equal(await page.evaluate(() => 'require' in window || 'process' in window), false)
    evidence.bridge = 'passed: registered Main handlers reject malformed arguments, wrong sender/frame/URL; malformed close reply allows a fresh native close; renderer has no Node'

    await mode('Widgets'); await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    const manager = page.getByRole('dialog', { name: 'Plugins', exact: true }); await enableDeveloperMode(manager)
    for (const name of ['workspace-essentials', 'time-tracker']) {
      await picker(resolve('.local/plugin-packages/' + name)); await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
      await manager.locator(`[data-plugin="geppio.${name}"]`).getByRole('switch').click()
      await page.waitForFunction(id => document.querySelector(`[data-plugin="${id}"]`)?.getAttribute('data-status') === 'active', 'geppio.' + name)
    }
    await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
    await page.getByTestId('edit-layout').click(); await settle(page)
    await place('host:file-editor', 'main'); await place('plugin:geppio.time-tracker:timer', 'main')
    await place('plugin:geppio.workspace-essentials:notes', 'sidebar'); await place('plugin:geppio.workspace-essentials:checklist', 'bottom')
    assert.equal(await page.locator('.file-mode-switch button').first().isDisabled(), true)
    await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    await page.getByRole('button', { name: 'Iniciar', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-plugin-widget="geppio.time-tracker:timer"] p')?.textContent?.includes('Salvo.'))
    const workers = page.workers(), layout = await raw()
    await page.locator('[data-plugin-widget]').evaluateAll(nodes => nodes.forEach(node => node.setAttribute('data-document-mount', 'retained')))
    await text().fill('widgets draft\n'); assert.equal(await state().getAttribute('data-document-id'), id)
    for (const value of ['Editor', 'Widgets', 'Editor', 'Widgets'] as const) {
      await mode(value); await settle(page); assert.equal(await text().count(), 1); assert.equal(await text().inputValue(), 'widgets draft\n')
      assert.equal(await state().getAttribute('data-document-id'), id); assert.equal(await state().getAttribute('data-document-dirty'), 'true')
      assert.equal(await raw(), layout); assert.deepEqual(page.workers(), workers)
      assert.equal(await page.locator('[data-document-mount="retained"]').count(), 3)
    }
    await text().fill('shared final\n'); await save(); assert.equal(await readFile(path, 'utf8'), '\ufeffshared final\r\n')
    evidence.modes = 'passed: one editor, same ID/draft, explicit Main placement, exact layout bytes, same Workers and mounted Sidebar/Bottom/timer'

    await text().fill('local draft'); await writeFile(path, '\ufeffSHARED FINAL\r\n')
    await save(); assert.equal(await state().getAttribute('data-document-status'), 'conflict'); assert.equal(await text().inputValue(), 'local draft')
    await picker(path, 0); await nativeClose(); assert.equal(await text().inputValue(), 'local draft'); assert.equal(await readFile(path, 'utf8'), '\ufeffSHARED FINAL\r\n')
    await picker(path, 2); await page.getByRole('button', { name: 'Fechar', exact: true }).click(); await idle(); assert.equal(await text().inputValue(), 'local draft')
    await open(path, 1); assert.equal(await text().inputValue(), 'SHARED FINAL\n')
    await text().fill('missing draft'); await rm(path); await save(); assert.equal(await text().inputValue(), 'missing draft')
    assert.equal(await state().getAttribute('data-document-status'), 'unavailable')
    await open(other, 1); await chmod(other, 0o444); await open(other, 1); await text().fill('denied draft'); await save()
    assert.equal(await state().getAttribute('data-document-status'), 'write'); assert.equal(await text().inputValue(), 'denied draft'); await chmod(other, 0o600)
    await open(other, 1); await text().fill('final saved\n'); await save()
    evidence.failures = 'passed: equal-size external conflict, native/app close Cancel and failed Save stay open, missing target and read-only write retain drafts'

    // Capture a real capability, revoke by actual navigation, then reject it through the fixed bridge.
    await picker(path); await writeFile(path, 'revocable')
    const old = await page.evaluate(async () => window.geppio!.documents.open(null))
    // Existing selection requires its current capability; null must be denied.
    assert.ok(!old.ok && old.code === 'stale')
    await page.getByRole('button', { name: 'Fechar arquivo', exact: true }).click(); await idle()
    const opened = await page.evaluate(async () => window.geppio!.documents.open(null)); assert.ok(opened.ok && opened.document)
    const stale: DocumentDraft = { id: opened.document.id, revision: opened.document.revision, text: 'forbidden' }
    await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    const rejected = await page.evaluate(draft => window.geppio!.documents.save(draft), stale); assert.ok(!rejected.ok && rejected.code === 'stale')
    evidence.revocation = 'passed: real renderer navigation revokes capability; null cannot replace an active authorization'

    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('geppio:theme:v1', theme), theme); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
      await mode('Editor'); await open(other); await text().focus(); assert.equal(await text().evaluate(node => node === document.activeElement), true)
      await page.screenshot({ path: join(diagnostics, `${theme}.png`) }); await page.getByRole('button', { name: 'Fechar arquivo', exact: true }).click(); await idle()
    }
    evidence.themes = 'passed: light/dark screenshots and textarea keyboard focus'
    await open(other); await text().fill('saved on native close\n'); await picker(other, 0)
    const closed = app!.waitForEvent('close'); await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()); await closed; app = undefined
    assert.equal(await readFile(other, 'utf8'), 'saved on native close\n')
    await launch(); await mode('Editor'); await open(other); assert.equal(await text().inputValue(), 'saved on native close\n')
    assert.equal(await raw(), layout); await picker(other, 1); await text().fill('discard me')
    const discarded = app!.waitForEvent('close'); await page.getByRole('button', { name: 'Fechar', exact: true }).click(); await discarded; app = undefined
    assert.equal(await readFile(other, 'utf8'), 'saved on native close\n')
    evidence.restart = 'passed: native close Save, relaunch, explicit reopen, original layout and app-close Discard'
    assert.deepEqual(errors, [])
  }
  await writeFile(join(diagnostics, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2))
} catch (error) { await page?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {}); throw error }
finally {
  // Only this created profile. Force-destroy test window on a failed dirty-flow assertion.
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {}); await app?.close().catch(() => {})
  await chmod(other, 0o600).catch(() => {}); await rm(profile, { recursive: true, force: true, maxRetries: 5 })
}
