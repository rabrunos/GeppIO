import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { randomUUID } from 'node:crypto'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { enableDeveloperMode } from './plugin-dev-support.ts'
import { TERMINAL_TYPE } from '../src/shared/terminal-widget.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { TerminalRead, TerminalResult } from '../src/shared/terminal.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-terminal-')), root = await realpath(profile)
const scale125 = process.argv.includes('--scale125'), diagnostics = resolve('.local/diagnostics/terminal-alpha40-' + (scale125 ? '125' : '100'))
await mkdir(diagnostics, { recursive: true })
const fixture = join(root, 'draft.json'); await writeFile(fixture, '\ufeff{\r\n  "saved": true\r\n}\r\n')
const textFixture = join(root, 'ordinary.txt'), typeFixture = join(root, 'code.ts')
await writeFile(textFixture, 'ordinary\ntext\n'); await writeFile(typeFixture, 'const alpha = 40;\r')
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], evidence: Record<string, unknown> = {}
const mode = (name: 'Editor' | 'Widgets') => page.locator('.file-mode-switch').getByRole('button', { name, exact: true }).click()
const state = async (): Promise<TerminalRead> => {
  const result = await page.evaluate(() => window.geppio!.terminal.read(null, 0))
  if (!result.ok) throw new Error(result.error)
  return result.value
}
const status = () => page.locator('[data-status-terminal]')
async function waitPhase(phase: string) { await page.waitForFunction(phase => document.querySelector('[data-status-terminal]')?.getAttribute('data-status-terminal') === phase, phase, { timeout: 20000 }) }
async function output(expected: string) {
  const until = Date.now() + 30000
  while (Date.now() < until) {
    const found = await page.evaluate(async expected => {
      let after = 0, text = ''
      for (let i = 0; i < 10; i++) {
        const result = await window.geppio!.terminal.read(null, after)
        if (!result.ok) return false
        text += result.value.data; after = result.value.next
        if (text.includes(expected)) return true
        if (!result.value.data) return false
      }
      return false
    }, expected)
    if (found) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out awaiting real PTY output')
}
async function pid(prefix: string) {
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const match = stripVTControlCharacters((await state()).data).match(new RegExp(prefix + '(\\d+)'))
    if (match) return Number(match[1])
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('No real shell PID received')
}
async function send(command: string) {
  const input = page.locator('.terminal-host .xterm-helper-textarea')
  await input.focus(); await page.keyboard.insertText(command); await page.keyboard.press('Enter')
}
async function place(region: 'main' | 'bottom') {
  await page.getByTestId('edit-layout').click()
  await page.locator(`[data-catalog-type="${TERMINAL_TYPE}"]`).click(); await page.locator(`[data-widget-place="${region}"]`).click()
  await page.getByTestId('conclude-layout').click(); await settle(page)
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
async function waitDead(pid: number) {
  const until = Date.now() + 10000
  while (alive(pid) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(alive(pid), false, 'native shell must be gone')
}
try {
  console.log('terminal smoke: launching built Electron')
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env, timeout: 30000 })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1480, 980); win.show(); win.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  // A real unrelated Worker must survive the terminal/document/mode journey.
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true }); await enableDeveloperMode(manager)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/time-tracker'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  await manager.locator('[data-plugin="geppio.time-tracker"]').getByRole('switch').click()
  await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.time-tracker"]')?.getAttribute('data-status') === 'active')
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  const workers = page.workers()
  console.log('terminal smoke: starting PowerShell')
  assert.equal((await state()).state.phase, 'none')
  await page.getByRole('button', { name: 'Mostrar Terminal', exact: true }).click()
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }) }, root)
  await page.getByRole('button', { name: 'Abrir pasta', exact: true }).first().click()
  await page.getByRole('treeitem', { name: 'draft.json', exact: true }).waitFor()
  const navigation = await page.locator('[data-explorer-node]').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-explorer-node'), expanded: node.getAttribute('aria-expanded') })))
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click(); await waitPhase('running')
  await output('PS ')
  const first = (await state()).state
  assert.ok(first.id); assert.match(first.shell, /PowerShell/); assert.ok(first.cwd)
  await send("'POLICY_' + (Get-PSReadLineOption).HistorySaveStyle + '_' + [IO.Path]::GetFileName((Get-PSReadLineOption).HistorySavePath)"); await output('POLICY_SaveNothing_NUL')
  evidence.historyPolicy = 'passed: actual PSReadLine SaveNothing with NUL target before interactive commands'
  await send('$alpha40 = 41'); await send("'VALUE_' + ($alpha40 + 1)"); await output('VALUE_42')
  await send("$env:GEPPIO_ALPHA40 = 'session'")
  await send("Set-Location -LiteralPath '" + root.replaceAll("'", "''") + "'")
  await send("'CWD_' + (Split-Path -Leaf (Get-Location))"); await output('CWD_' + root.split(/[\\/]/).pop())
  await send("'PID_' + $PID"); await output('PID_')
  const firstPid = await pid('PID_'); assert.ok(alive(firstPid))
  await send("Write-Host ('COLOR_' + 'café 😀') -ForegroundColor Green"); await output('COLOR_café 😀')
  assert.ok((await state()).data.includes('\u001b['))
  await page.keyboard.insertText("'EDIT_' + 'abX'"); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.keyboard.insertText('c'); await page.keyboard.press('Enter'); await output('EDIT_abc')
  await app.evaluate(({ clipboard }) => clipboard.writeText("'PASTE_' + 'ok'"))
  await page.locator('.terminal-host .xterm-helper-textarea').focus(); await page.keyboard.press('Control+v'); await page.keyboard.press('Enter'); await output('PASTE_ok')
  await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows > div')].some(element => element.textContent?.trim() === 'PASTE_ok'))
  const row = await page.locator('.xterm-rows > div').evaluateAll(rows => {
    const element = rows.find(row => row.textContent?.trim() === 'PASTE_ok')!, box = element.getBoundingClientRect()
    const span = element.querySelector('span')!, charWidth = span.getBoundingClientRect().width / (span.textContent?.length ?? 1)
    return { left: box.left, top: box.top, height: box.height, charWidth }
  })
  await page.mouse.move(row.left + 1, row.top + row.height / 2); await page.mouse.down(); await page.mouse.move(row.left + row.charWidth * 8 + 1, row.top + row.height / 2); await page.mouse.up()
  await page.getByRole('button', { name: 'Copiar', exact: true }).click()
  assert.equal((await app.evaluate(({ clipboard }) => clipboard.readText())).trim(), 'PASTE_ok')
  await send("Write-Error ('ERR_' + 'ordinary')"); await output('ERR_ordinary'); assert.equal((await state()).state.phase, 'running')
  assert.equal(await status().getAttribute('data-failed'), 'false')
  evidence.persistent = 'passed: native PowerShell prompt, keyboard input, variable/CWD/PID persistence, ANSI/Unicode/stderr, command failure leaves shell running'
  console.log('terminal smoke: persistent shell passed')

  // Exercise real registered Main handlers, without adding production test hooks.
  const negatives = await app.evaluate(async ({ ipcMain, BrowserWindow }, id) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => TerminalResult> })._invokeHandlers
    const sender = BrowserWindow.getAllWindows()[0]!.webContents, frame = sender.mainFrame
    return [
      handlers.get('terminal:start')!({ sender, senderFrame: frame }, 'extra'),
      handlers.get('terminal:start')!({ sender: {}, senderFrame: frame }),
      handlers.get('terminal:start')!({ sender, senderFrame: { url: frame.url } }),
      handlers.get('terminal:resize')!({ sender, senderFrame: frame }, id, 0, 900),
      handlers.get('terminal:input')!({ sender, senderFrame: frame }, id, 'x'.repeat(8193)),
      handlers.get('terminal:read')!({ sender, senderFrame: frame }, id, -1)
    ]
  }, first.id)
  assert.ok(negatives.every(result => !result.ok))
  const stale = await page.evaluate(id => window.geppio!.terminal.input(id, 'x'), randomUUID()); assert.equal(stale.ok, false)
  const duplicate = await page.evaluate(() => window.geppio!.terminal.start()); assert.ok(duplicate.ok); assert.equal(duplicate.value.state.id, first.id)
  evidence.boundary = 'passed: fixed real handlers reject foreign sender/subframe, malformed calls, stale IDs, oversized input and invalid resize; duplicate start retains session'

  await send("Write-Output ('SLEEP_' + 'started'); Start-Sleep -Seconds 30"); await output('SLEEP_started')
  await page.keyboard.press('Control+c'); await send("'INT_' + 'ok'"); await output('INT_ok')
  await page.evaluate(async () => { const result = await window.geppio!.terminal.read(null, 0); if (result.ok) await window.geppio!.terminal.input(result.value.state.id!, "1..4000 | ForEach-Object { 'long-output-' + $_ }; Write-Output ('LONG_' + 'done')\r") })
  await output('LONG_done')
  await send("1..20000 | ForEach-Object { 'bounded-output-{0:D8}-{1:D8}' -f $_, ($_ * 7) }; Write-Output ('BOUND_' + 'ok')"); await output('BOUND_ok')
  const outputBudget = await page.evaluate(async () => {
    let after = 0, retained = 0, dropped = false
    for (let i = 0; i < 10; i++) {
      const r = await window.geppio!.terminal.read(null, after)
      if (!r.ok) throw new Error(r.error)
      dropped ||= r.value.dropped; retained += r.value.data.length; after = r.value.next
      if (!r.value.data) break
    }
    return { dropped, retained, end: after }
  })
  console.log('terminal smoke: output budget', outputBudget)
  assert.equal(outputBudget.dropped, true); assert.ok(outputBudget.retained <= 262144)
  await send("'AFTER_' + 'flood'"); await output('AFTER_flood')
  await send('Clear-Host'); await send("'CLEAR_' + 'ok'"); await output('CLEAR_ok')
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('CLEAR_ok'))
  assert.equal((await state()).state.id, first.id)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 768)); await settle(page)
  const narrow = (await state()).state
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1800, 1000)); await settle(page)
  const resizeUntil = Date.now() + 10000
  while ((await state()).state.cols === narrow.cols && Date.now() < resizeUntil) await new Promise(resolve => setTimeout(resolve, 50))
  assert.notEqual((await state()).state.cols, narrow.cols)
  await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter'); await settle(page)
  assert.equal(await page.locator('.workbench').getAttribute('data-bottom-mode'), 'hidden')
  assert.equal((await state()).state.id, first.id)
  await page.getByRole('button', { name: 'Mostrar Terminal', exact: true }).click(); await settle(page)
  await send("'REOPEN_' + ($alpha40 + 1)"); await output('REOPEN_42')
  const resized = (await state()).state
  await send("'SIZE_' + [Console]::WindowWidth + 'x' + [Console]::WindowHeight"); await output(`SIZE_${resized.cols}x${resized.rows}`)
  evidence.interaction = 'passed: Ctrl+C, 4000-line output and native resize without replacing shell'
  console.log('terminal smoke: interaction and bounds passed')

  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }) }, fixture)
  await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-status-document]')?.getAttribute('data-status-document') === 'saved')
  assert.equal(await page.locator('.status-encoding').innerText(), 'UTF-8 BOM'); assert.equal(await page.locator('.status-eol').innerText(), 'CRLF')
  const bytes = await readFile(fixture)
  await page.getByRole('combobox', { name: 'Linguagem do documento' }).selectOption('TypeScript'); assert.deepEqual(await readFile(fixture), bytes)
  const editor = page.getByRole('textbox', { name: 'Conteúdo do arquivo', exact: true })
  await editor.fill('{\n  "draft": 40\n}\n'); await editor.press('Control+Home'); await editor.press('ArrowDown'); await editor.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.status-cursor')?.textContent === 'Ln 2, Col 2')
  assert.equal(await page.locator('[data-status-document]').getAttribute('data-status-document'), 'dirty')
  await send("Start-Sleep -Milliseconds 350; Write-Output ('HIDDEN_' + 'kept')")
  await mode('Widgets'); await place('bottom'); await output('HIDDEN_kept')
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('HIDDEN_kept'))
  const savedLayout = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  const emulator = await page.locator('.terminal-emulator').elementHandle()
  for (let i = 0; i < 3; i++) {
    await mode('Editor'); assert.equal(await editor.inputValue(), '{\n  "draft": 40\n}\n')
    assert.deepEqual(await page.locator('[data-explorer-node]').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-explorer-node'), expanded: node.getAttribute('aria-expanded') }))), navigation)
    await mode('Widgets'); assert.equal((await state()).state.id, first.id)
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), savedLayout)
  assert.equal(await emulator!.evaluate(element => element === document.querySelector('.terminal-emulator')), true, 'same emulator DOM survives presentation changes')
  assert.deepEqual(page.workers(), workers)
  await send("'CONT_' + ($alpha40 + 1)"); await output('CONT_42')
  await send("'ENV_' + $env:GEPPIO_ALPHA40"); await output('ENV_session')
  await mode('Editor'); await editor.press('Control+s')
  await page.waitForFunction(() => document.querySelector('[data-status-document]')?.getAttribute('data-status-document') === 'saved')
  assert.equal(await readFile(fixture, 'utf8'), '\ufeff{\r\n  "draft": 40\r\n}\r\n')
  for (const [file, language, eol] of [[textFixture, 'Texto simples', 'LF'], [typeFixture, 'TypeScript', 'CR']]) {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file!] }) }, file)
    await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
    await page.waitForFunction(name => document.querySelector('.file-editor-toolbar strong')?.textContent === name, file!.split(/[\\/]/).pop())
    assert.equal(await page.getByRole('combobox', { name: 'Linguagem do documento' }).inputValue(), language)
    assert.equal(await page.locator('.status-eol').innerText(), eol)
    assert.equal(await page.locator('.status-encoding').innerText(), 'UTF-8')
  }
  await editor.fill('const draft = 41;\n'); await writeFile(typeFixture, 'const external = 42;\r')
  await page.getByRole('button', { name: 'Salvar arquivo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-status-document]')?.getAttribute('data-status-document') === 'error')
  assert.match(await page.locator('[data-status-document]').innerText(), /Conflito/); assert.equal(await editor.inputValue(), 'const draft = 41;\n')
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox }, fixture)
  await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-status-document]')?.getAttribute('data-status-document') === 'saved')
  evidence.modesDocuments = 'passed: one live native session, bounded emulator history, explicit Bottom widget, three mode roundtrips, exact unchanged layout, dirty JSON/cursor/BOM/CRLF and language override without bytes; real Save'
  console.log('terminal smoke: modes and document passed')

  await send('exit 7'); await waitPhase('exited'); await waitDead(firstPid)
  assert.equal((await state()).state.exitCode, 7); assert.equal(await status().getAttribute('data-failed'), 'true')
  const failedScreen = await page.locator('.xterm-rows').innerText()
  await mode('Widgets'); await status().click(); assert.equal(await page.locator('.workbench').getAttribute('data-file-mode'), 'editor')
  assert.ok(await page.locator('.direct-terminal').isVisible())
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'))
  assert.equal(await page.locator('.xterm-rows').innerText(), failedScreen)
  await page.getByRole('button', { name: 'Reiniciar terminal', exact: true }).click(); await waitPhase('running'); await output('PS ')
  assert.notEqual((await state()).state.id, first.id); assert.equal(await status().getAttribute('data-failed'), 'false')
  assert.equal((await page.evaluate(id => window.geppio!.terminal.resize(id!, 80, 24), first.id)).ok, false)
  await send('exit 0'); await waitPhase('exited'); assert.equal((await state()).state.exitCode, 0); assert.equal(await status().getAttribute('data-failed'), 'false')
  await page.getByRole('button', { name: 'Reiniciar terminal', exact: true }).click(); await waitPhase('running'); await output('PS ')
  await page.getByRole('button', { name: 'Encerrar', exact: true }).click(); await waitPhase('closed')
  const closedId = (await state()).state.id!
  assert.equal((await page.evaluate(id => window.geppio!.terminal.input(id, 'x'), closedId)).ok, false)
  evidence.exit = 'passed: real exit 7/failure route/restart, real exit 0 without false error, explicit termination and closed-session input refusal'

  // A controlled one-use native spawn failure tests real registered start/error propagation.
  await app.evaluate((_electron, manifest) => {
    const requireModule = process.getBuiltinModule('module').createRequire(manifest)
    const pty = requireModule('node-pty') as typeof import('node-pty'), original = pty.spawn
    pty.spawn = () => { pty.spawn = original; throw new Error('Disposable native startup failure') }
  }, resolve('package.json'))
  await page.getByRole('button', { name: 'Reiniciar terminal', exact: true }).click(); await waitPhase('failed')
  assert.equal(await status().getAttribute('data-failed'), 'true')
  assert.match(await page.locator('.terminal-feedback').innerText(), /ConPTY/)
  evidence.startupFailure = 'passed: controlled native spawn failure reaches functional surface/status; retry remains explicit'
  await page.getByRole('button', { name: 'Reiniciar terminal', exact: true }).click(); await waitPhase('running'); await output('PS ')

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { localStorage.setItem('geppio:theme:v1', theme) }, theme)
    // Use existing theme control; no reload, which would intentionally revoke the native owner.
    const current = await page.locator('.workbench').getAttribute('data-theme')
    if (current !== theme) await page.getByRole('button', { name: /Alternar tema/ }).first().click()
    for (const width of [1800, 1024]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 900), width); await settle(page)
      const boxes = await page.locator('.status-bar').evaluate(element => {
        const box = element.getBoundingClientRect(), left = element.querySelector('.status-left')!.getBoundingClientRect(), right = element.querySelector('.status-right')!.getBoundingClientRect()
        return { height: box.height, overflow: element.scrollWidth > element.clientWidth, overlap: left.right > right.left + .1 }
      })
      assert.equal(boxes.height, 25); assert.equal(boxes.overflow, false); assert.equal(boxes.overlap, false)
      await send(`'THEME_' + '${theme}${width}'`); await output(`THEME_${theme}${width}`)
      await page.screenshot({ path: join(diagnostics, `${theme}-${width}.png`) })
    }
  }
  evidence.themes = 'passed: live Terminal, both themes at 1800/1024 widths; 25px Status Bar without overflow/overlap'
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1800, 1000)); await settle(page)
  await mode('Widgets')
  await page.getByTestId('edit-layout').click()
  await page.locator(`[data-catalog-type="${TERMINAL_TYPE}"]`).click(); await page.locator('[data-widget-place="main"]').click()
  await page.getByTestId('conclude-layout').click(); await settle(page)
  assert.equal(await page.locator('.widget-frame:has(.terminal-view)').getAttribute('data-owner-region'), 'main')
  await mode('Editor')
  // Navigation revokes the old native owner; the new renderer must not inherit a stale process.
  await send("'REVOKE_' + $PID"); const revokedPid = await pid('REVOKE_')
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await waitDead(revokedPid)
  assert.equal((await state()).state.phase, 'none')
  await page.getByRole('button', { name: 'Mostrar Terminal', exact: true }).click()
  await page.getByRole('button', { name: 'Iniciar terminal', exact: true }).click(); await waitPhase('running'); await output('PS ')
  await send("'CLEANUP_' + $PID"); await output('CLEANUP_')
  const cleanupPid = await pid('CLEANUP_'); assert.ok(cleanupPid); assert.ok(alive(cleanupPid))
  evidence.runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, napi: process.versions.napi, arch: process.arch, platform: process.platform }))
  evidence.shell = first.shell; evidence.dpr = await page.evaluate(() => devicePixelRatio)
  await app.close(); app = undefined; await waitDead(cleanupPid)
  assert.deepEqual(errors, []); evidence.shutdown = 'passed: navigation revokes/kills native owner, app shutdown kills native shell; no renderer errors'
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => undefined); await writeFile(join(diagnostics, 'failure-dom.txt'), await page.content()).catch(() => undefined) }
  console.error('TERMINAL_SMOKE_FAILED', error); process.exitCode = 1
} finally {
  if (app) {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox }).catch(() => undefined)
    await app.close()
  }
  assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert.ok(basename(profile).startsWith('geppio-smoke-terminal-'))
  await rm(profile, { recursive: true, force: true })
}
