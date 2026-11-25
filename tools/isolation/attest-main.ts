import { spawnSync } from 'node:child_process'
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

// Recovery windows can be destroyed before Playwright receives a page for them.
// The native checker must see each original handle while its window is alive.
function attestIdentityWindows(helper: string, desktop: string) {
  const nonce = process.env.GEPPIO_ISOLATION_IDENTITY_NONCE
  if (!nonce || !/^[a-f0-9]{32}$/.test(nonce)) throw new Error('IDENTITY_RECEIPT_BINDING')
  const pid = process.pid
  const receipt = openSync(join(dirname(helper), 'identity-' + nonce + '.jsonl'), 'wx')
  let count = 0
  app.on('browser-window-created', (_event, window) => {
    try {
      const hwnd = window.getNativeWindowHandle().readBigUInt64LE().toString(16)
      const result = spawnSync(helper, ['window', String(pid), hwnd, desktop], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
      if (result.error || result.status !== 0 || JSON.parse(result.stdout).kind !== 'window-attested') throw new Error('IDENTITY_NATIVE_WINDOW: ' + (result.stderr || result.error?.message || result.status))
      writeSync(receipt, JSON.stringify({ kind: 'window', nonce, pid, desktop, id: window.id, hwnd }) + '\n')
      count++
    } catch (failure) {
      writeSync(2, 'ISOLATION_REFUSED ' + String(failure) + '\n')
      process.exit(125)
    }
  })
  app.once('quit', () => {
    writeSync(receipt, JSON.stringify({ kind: 'closed', nonce, pid, desktop, count }) + '\n')
    closeSync(receipt)
  })
}

// Compiled into this run's private artifact directory, required before the app's Main module.
// No renderer bridge and no production code changes. Failure exits before BrowserWindow creation.
try {
  const desktop = process.env.GEPPIO_ISOLATION_DESKTOP, configPath = process.env.GEPPIO_ISOLATION_CONFIG
  if (process.platform !== 'win32' || !desktop || !/^GeppIOTest[0-9a-f]{32}$/.test(desktop) || !configPath || !isAbsolute(configPath) || process.env.GEPPIO_TEST_VISIBLE) throw new Error('MAIN_ISOLATION_ENVIRONMENT')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as { helper: string; helperSha256: string; suite: string }
  if (typeof config.helper !== 'string' || dirname(config.helper) !== dirname(realpathSync(configPath)) || basename(config.helper) !== 'desktop-bridge.exe' || !/^[0-9a-f]{64}$/.test(config.helperSha256)) throw new Error('MAIN_HELPER_BINDING')
  const stat = lstatSync(config.helper)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(config.helper) !== config.helper || createHash('sha256').update(readFileSync(config.helper)).digest('hex') !== config.helperSha256) throw new Error('MAIN_HELPER_CHANGED')
  const result = spawnSync(config.helper, ['attest', String(process.pid), desktop], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  if (result.error || result.status !== 0 || JSON.parse(result.stdout).desktop !== desktop) throw new Error('MAIN_DESKTOP_ATTESTATION')
  if (config.suite === 'identity') attestIdentityWindows(config.helper, desktop)
  process.env.GEPPIO_ISOLATION_MAIN_ATTESTED = desktop
} catch (failure) {
  console.error('ISOLATION_REFUSED_BEFORE_APP_MAIN', failure instanceof Error ? failure.message : 'UNKNOWN')
  process.exit(125)
}
