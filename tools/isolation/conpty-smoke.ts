import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { electron } from '../test-electron.ts'
import { portugueseFixture } from '../freeform-smoke.ts'

// A distinct focused probe. It does not replace Terminal's clipboard/geometry/security CI gate.
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-isolated-conpty-')), token = randomUUID()
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
const args = ['.', ...(process.argv.includes('--scale125') ? ['--force-device-scale-factor=1.25'] : [])]
const app = await electron.launch({ args, env })
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  await page.locator('.file-mode-switch').getByRole('button', { name: 'Editor', exact: true }).click()
  const show = page.getByRole('button', { name: 'Mostrar Terminal', exact: true })
  if (await show.count()) await show.click()
  await page.getByRole('button', { name: /^(Iniciar|Reiniciar) terminal$/ }).click()
  await page.waitForFunction(async () => { const result = await window.geppio!.terminal.read(null, 0); return result.ok && result.value.state.phase === 'running' })
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
  await mkdir('.local/diagnostics', { recursive: true }); await page.screenshot({ path: resolve('.local/diagnostics/isolated-conpty' + (args.length > 1 ? '-125' : '') + '.png') })
  await page.getByRole('button', { name: 'Encerrar', exact: true }).click()
  await page.waitForFunction(async () => { const result = await window.geppio!.terminal.read(null, 0); return result.ok && ['closed', 'exited'].includes(result.value.state.phase) })
  console.log('PASS isolated real application Terminal/ConPTY: native PowerShell, actual keyboard input/output, explicit termination; no clipboard operation')
} finally { await app.close(); await rm(profile, { recursive: true, force: true }) }
