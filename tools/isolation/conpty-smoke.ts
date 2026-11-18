import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { electron } from '../test-electron.ts'
import { portugueseFixture, settle } from '../freeform-smoke.ts'

// A distinct focused probe. It does not replace Terminal's clipboard/geometry/security CI gate.
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-isolated-conpty-')), token = randomUUID()
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
const args = ['.', ...(process.argv.includes('--scale125') ? ['--force-device-scale-factor=1.25'] : [])]
const app = await electron.launch({ args, env })
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setContentSize(1480, 980); win.show(); win.focus()
  })
  const project = join(await realpath(profile), 'project-for-pty-size-convergence')
  await mkdir(project)
  const prompt = 'PS ' + project + '>'
  assert.ok(prompt.length > 80, 'The disposable PowerShell prompt must exceed the initial PTY width')
  await page.locator('.experience-switch').getByRole('button', { name: 'GeppIO Code', exact: true }).click()
  const show = page.getByRole('button', { name: 'Mostrar Terminal', exact: true })
  if (await show.count()) await show.click()
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.locator('.explorer-toolbar').getByRole('button', { name: 'Abrir pasta', exact: true }).click()
  await page.getByRole('treeitem', { name: 'project-for-pty-size-convergence', exact: true }).waitFor()
  await settle(page)

  async function sizesAtPrompt(marker?: string) {
    const handle = await page.waitForFunction(({ prompt, marker }) => {
      const dom = [...document.querySelectorAll('.xterm-rows > div')].map(node => node.textContent?.trim() ?? '')
      const cursor = document.querySelector('.xterm-rows .xterm-cursor')
      const screen = document.querySelector('.terminal-host .xterm-screen')
      const cell = cursor?.getBoundingClientRect().width
      if (!cell || !screen) return false
      // xterm renders the cursor as a single cell and each visible row as one element.
      const promptLine = dom.findLastIndex(text => text.length > 0)
      if (dom[promptLine]?.toLowerCase() !== prompt.toLowerCase()) return false
      if (marker && !(dom.indexOf(marker) >= 0 && dom.indexOf(marker) < promptLine)) return false
      return { cols: Math.round(screen.getBoundingClientRect().width / cell), rows: dom.length }
    }, { prompt, marker })
    try {
      const xterm = await handle.jsonValue()
      const result = await page.evaluate(() => window.geppio!.terminal.read(null, 0))
      assert.ok(xterm && result.ok && result.value.state.phase === 'running')
      const { id, cols, rows } = result.value.state
      assert.ok(id)
      const native = { cols, rows }
      assert.deepEqual(native, xterm)
      return { id, native, xterm }
    } finally { await handle.dispose() }
  }

  async function stop() {
    await page.getByRole('button', { name: 'Encerrar', exact: true }).click()
    await page.locator('[data-terminal-phase="closed"], [data-terminal-phase="exited"]').waitFor()
  }

  await page.getByRole('button', { name: /^(Iniciar|Reiniciar) terminal$/ }).click()
  await page.locator('[data-terminal-phase="running"]').waitFor()
  const first = await sizesAtPrompt()
  const input = page.locator('.terminal-host .xterm-helper-textarea'); await input.focus()
  await page.keyboard.insertText(`Write-Output ('ISOLATED_' + '${token}'); Write-Output ('SHELLPID_' + $PID)`); await page.keyboard.press('Enter')
  let shellPid = 0
  const until = performance.now() + 30000
  while (!shellPid && performance.now() < until) {
    const result = await page.evaluate(() => window.geppio!.terminal.read(null, 0)); assert.ok(result.ok); assert.equal(result.value.state.phase, 'running')
    const text = stripVTControlCharacters(result.value.data)
    if (text.includes('ISOLATED_' + token)) shellPid = Number(/(?:^|\n)SHELLPID_(\d+)(?:\r?\n)/.exec(text)?.[1] ?? 0)
    if (!shellPid) await new Promise(resolveWait => setTimeout(resolveWait, 50))
  }
  assert.ok(Number.isSafeInteger(shellPid) && shellPid > 0, 'Actual PowerShell output, distinct from the echoed command')
  await sizesAtPrompt('ISOLATED_' + token)
  await mkdir('.local/diagnostics', { recursive: true }); await page.screenshot({ path: resolve('.local/diagnostics/isolated-conpty' + (args.length > 1 ? '-125' : '') + '.png') })
  await stop()
  await page.getByRole('button', { name: 'Reiniciar terminal', exact: true }).click()
  const restarted = await sizesAtPrompt()
  assert.notEqual(restarted.id, first.id)
  await stop()
  console.log(JSON.stringify({ dpr: await page.evaluate(() => devicePixelRatio), promptLength: prompt.length,
    start: { native: first.native, xterm: first.xterm }, restart: { native: restarted.native, xterm: restarted.xterm } }))
  console.log('PASS isolated real application Terminal/ConPTY: native PowerShell, actual keyboard input/output, explicit termination; no clipboard operation')
} finally { await app.close(); await rm(profile, { recursive: true, force: true }) }
