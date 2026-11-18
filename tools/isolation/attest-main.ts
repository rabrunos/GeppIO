import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute } from 'node:path'

// Compiled into this run's private artifact directory, required before the app's Main module.
// No renderer bridge and no production code changes. Failure exits before BrowserWindow creation.
try {
  const desktop = process.env.GEPPIO_ISOLATION_DESKTOP, configPath = process.env.GEPPIO_ISOLATION_CONFIG
  if (process.platform !== 'win32' || !desktop || !/^GeppIOTest[0-9a-f]{32}$/.test(desktop) || !configPath || !isAbsolute(configPath) || process.env.GEPPIO_TEST_VISIBLE) throw new Error('MAIN_ISOLATION_ENVIRONMENT')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as { helper: string; helperSha256: string }
  if (typeof config.helper !== 'string' || dirname(config.helper) !== dirname(realpathSync(configPath)) || basename(config.helper) !== 'desktop-bridge.exe' || !/^[0-9a-f]{64}$/.test(config.helperSha256)) throw new Error('MAIN_HELPER_BINDING')
  const stat = lstatSync(config.helper)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(config.helper) !== config.helper || createHash('sha256').update(readFileSync(config.helper)).digest('hex') !== config.helperSha256) throw new Error('MAIN_HELPER_CHANGED')
  const result = spawnSync(config.helper, ['attest', String(process.pid), desktop], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  if (result.error || result.status !== 0 || JSON.parse(result.stdout).desktop !== desktop) throw new Error('MAIN_DESKTOP_ATTESTATION')
  process.env.GEPPIO_ISOLATION_MAIN_ATTESTED = desktop
} catch (failure) {
  console.error('ISOLATION_REFUSED_BEFORE_APP_MAIN', failure instanceof Error ? failure.message : 'UNKNOWN')
  process.exit(125)
}
