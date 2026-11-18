import { spawnSync } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchMode, selectSuite } from './plan.ts'
import type { IsolationConfig } from './controller.ts'
import { finishIsolatedLaunches, isolationConfigFromEnvironment } from '../test-electron.ts'

const [request, ...extra] = process.argv.slice(2)
if (!request || extra.length || request !== process.env.GEPPIO_ISOLATION_CONFIG || launchMode(process.env) !== 'isolated') throw new Error('ISOLATION_WORKER_BINDING')
const config: IsolationConfig = isolationConfigFromEnvironment()
if (config.schema !== 1) throw new Error('ISOLATION_REQUEST_SCHEMA')
const attest = spawnSync(config.helper, ['attest', String(process.pid), process.env.GEPPIO_ISOLATION_DESKTOP!], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
if (attest.error || attest.status !== 0) throw new Error('WORKER_DESKTOP_ATTESTATION: ' + attest.stderr)
if (config.selfTest) {
  if (!/^[0-9a-f]{64}$/.test(config.selfTest.nonce) || config.selfTest.nonce !== process.env.GEPPIO_ISOLATION_SELFTEST) throw new Error('SELFTEST_BINDING')
  const { runProbe } = await import('./native-probes.ts'); await runProbe(config.selfTest.probe, request)
} else {
  const selection = selectSuite(config.suite, config.variant), entry = resolve(selection.step.file)
  if (await realpath(entry) !== entry) throw new Error('SUITE_PATH_REDIRECT')
  process.argv = [process.execPath, entry, ...(selection.step.args ?? [])]
  await import(pathToFileURL(entry).href)
  const verifiedWindows = await finishIsolatedLaunches()
  if (verifiedWindows < 1) throw new Error('NO_ELECTRON_WINDOW_ATTESTED')
  console.log(JSON.stringify({ kind: 'gui-verified', windows: verifiedWindows }))
}
