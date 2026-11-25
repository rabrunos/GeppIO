import { _electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { launchMode } from './isolation/plan.ts'
import type { IsolationConfig } from './isolation/controller.ts'

const checks: Promise<void>[] = []
const pendingIdentity = new Set<string>()
let isolationFailure: Error | undefined
let verifiedWindows = 0
function native(config: IsolationConfig, args: string[]) {
  const result = spawnSync(config.helper, args, { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  if (result.error || result.status !== 0) throw new Error('ISOLATION_ATTESTATION_FAILED: ' + (result.stderr || result.error?.message || result.status))
}
export function isolationConfigFromEnvironment(): IsolationConfig {
  const path = process.env.GEPPIO_ISOLATION_CONFIG
  if (!path) throw new Error('ISOLATION_CONFIG_MISSING')
  const config = JSON.parse(readFileSync(path, 'utf8')) as IsolationConfig, directory = dirname(realpathSync(path))
  const local = relative(resolve('.local/isolation'), directory)
  if (config.schema !== 1 || basename(path) !== 'request.json' || !/^run-[^\\/]+$/.test(local) || config.helper !== join(directory, 'desktop-bridge.exe') || config.preload !== join(directory, 'attest-main.cjs')) throw new Error('ISOLATION_CONFIG_BINDING')
  for (const [file, expected] of [[config.helper, config.helperSha256], [config.preload, config.preloadSha256]]) {
    const stat = lstatSync(file!)
    if (!/^[0-9a-f]{64}$/.test(expected!) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file!) !== file || createHash('sha256').update(readFileSync(file!)).digest('hex') !== expected) throw new Error('ISOLATION_HELPER_OR_PRELOAD_CHANGED')
  }
  return config
}
async function windowCheck(app: ElectronApplication, page: Page, config: IsolationConfig) {
  const window = await app.browserWindow(page)
  const hwnd = await window.evaluate(window => window.getNativeWindowHandle().readBigUInt64LE(0).toString(16))
  const pid = await app.evaluate(() => process.pid)
  native(config, ['window', String(pid), hwnd, process.env.GEPPIO_ISOLATION_DESKTOP!])
  verifiedWindows++
}
export function countIdentityReceipts(helper: string, nonce: string, pid: number, desktop: string): number {
  const path = join(dirname(helper), 'identity-' + nonce + '.jsonl')
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size > 1024 * 1024) throw new Error('IDENTITY_RECEIPT_FILE')
  const lines = readFileSync(path, 'utf8').split('\n')
  if (lines.pop() !== '' || lines.length < 2) throw new Error('IDENTITY_MISSING_WINDOW_OR_END')
  const ids = new Set<number>()
  for (const [index, line] of lines.entries()) {
    const record = JSON.parse(line)
    if (record?.nonce !== nonce || record.pid !== pid || record.desktop !== desktop) throw new Error('IDENTITY_RECEIPT_BINDING')
    if (index === lines.length - 1) {
      if (record.kind !== 'closed' || record.count !== ids.size) throw new Error('IDENTITY_RECEIPT_COUNT')
    } else {
      if (record.kind !== 'window' || !Number.isSafeInteger(record.id) || record.id <= 0 || ids.has(record.id) ||
        typeof record.hwnd !== 'string' || !/^[1-9a-f][a-f0-9]{0,15}$/.test(record.hwnd)) throw new Error('IDENTITY_WINDOW_RECEIPT')
      ids.add(record.id)
    }
  }
  return ids.size
}
export async function finishIsolatedLaunches() {
  await Promise.all(checks)
  if (pendingIdentity.size) throw new Error('IDENTITY_PROCESS_NOT_VERIFIED')
  if (isolationFailure) throw isolationFailure
  return verifiedWindows
}
export const electron: Pick<typeof _electron, 'launch'> = {
  async launch(options = {}) {
    const mode = launchMode(process.env)
    if (mode === 'visible') {
      if (process.env.GITHUB_ACTIONS !== 'true') console.warn('VISIBLE TEST DEBUGGING explicitly enabled: windows/focus/clipboard can affect this desktop.')
      return _electron.launch(options)
    }
    const config = isolationConfigFromEnvironment(), desktop = process.env.GEPPIO_ISOLATION_DESKTOP!
    native(config, ['attest', String(process.pid), desktop])
    const env = options.env ?? process.env
    if (env.GEPPIO_ISOLATION_CONFIG !== process.env.GEPPIO_ISOLATION_CONFIG || env.GEPPIO_ISOLATION_DESKTOP !== desktop || env.GEPPIO_TEST_VISIBLE) throw new Error('LAUNCH_DROPPED_ISOLATION_ENVIRONMENT')
    const launchEnv: Record<string, string> = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete launchEnv.GEPPIO_ISOLATION_MAIN_ATTESTED
    const identityNonce = config.suite === 'identity' ? randomBytes(16).toString('hex') : undefined
    if (identityNonce) launchEnv.GEPPIO_ISOLATION_IDENTITY_NONCE = identityNonce
    const app = await _electron.launch({ ...options, env: launchEnv, args: ['-r', config.preload, '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', ...(options.args ?? [])] })
    const attested = await app.evaluate(() => process.env.GEPPIO_ISOLATION_MAIN_ATTESTED)
    if (attested !== desktop) { writeSync(2, 'ISOLATION_REFUSED MAIN_PRELOAD_NOT_ATTESTED\n'); process.exit(125) }
    if (identityNonce) {
      const pid = await app.evaluate(() => process.pid)
      pendingIdentity.add(identityNonce)
      const close = app.close.bind(app)
      let closing: Promise<void> | undefined
      app.close = () => closing ??= close().then(() => {
        verifiedWindows += countIdentityReceipts(config.helper, identityNonce, pid, desktop)
        pendingIdentity.delete(identityNonce)
      })
      return app
    }
    app.on('window', page => {
      const check = windowCheck(app, page, config).catch(error => { isolationFailure = error instanceof Error ? error : new Error('WINDOW_ATTESTATION_FAILED'); writeSync(2, 'ISOLATION_REFUSED ' + isolationFailure.message + '\n'); process.exit(125) })
      checks.push(check)
    })
    for (const page of app.windows()) await windowCheck(app, page, config)
    if (config.suite === 'desktop-core') {
      const close = app.close.bind(app)
      app.close = async () => {
        try {
          const pages = await Promise.all(app.windows().map(page => page.evaluate(() => ({ viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, surfaces: [...document.querySelectorAll<HTMLElement>('[data-surface]')].map(port => ({ region: port.dataset.surface, client: [port.clientWidth, port.clientHeight], rect: [port.getBoundingClientRect().width, port.getBoundingClientRect().height], usable: [port.dataset.usableWidth, port.dataset.usableHeight] })) }))))
          await writeFile(join(dirname(config.helper), 'desktop-metrics.json'), JSON.stringify(pages, null, 2))
        } catch { /* The app may already be closed by the original native-window-control test. */ }
        await close()
      }
    }
    return app
  }
}
