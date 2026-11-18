import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import ts from 'typescript'
import type { IsolationSelection } from './plan.ts'
import { completionCode } from './completion.ts'
import type { NativeResult } from './completion.ts'

export interface IsolationConfig { schema: 1; suite: string; variant?: string; helper: string; helperSha256: string; preload: string; preloadSha256: string; selfTest?: { probe: 'exit7' | 'exit0' | 'wait' | 'orphan'; nonce: string } }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export async function prepareIsolation(selection: IsolationSelection): Promise<{ directory: string; request: string; config: IsolationConfig }> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('ISOLATION_UNSUPPORTED_PLATFORM: Windows x64 required')
  const root = await realpath(process.cwd()), base = join(root, '.local', 'isolation')
  if (/[!%\r\n]/.test(root)) throw new Error('ISOLATION_UNSUPPORTED_REPOSITORY_PATH: Playwright Windows shell expansion must not alter the path')
  await mkdir(base, { recursive: true })
  if (await realpath(base) !== base || (await lstat(base)).isSymbolicLink()) throw new Error('ISOLATION_OUTPUT_REDIRECT')
  const directory = await mkdtemp(join(base, 'run-')), helper = join(directory, 'desktop-bridge.exe')
  const windowsRoot = process.env.SystemRoot
  if (!windowsRoot || !/^[a-z]:\\[^\r\n]+$/i.test(windowsRoot)) throw new Error('WINDOWS_ROOT_UNAVAILABLE')
  const compiler = join(windowsRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!(await lstat(compiler)).isFile()) throw new Error('NATIVE_COMPILER_MISSING')
  const built = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/warnaserror+', '/out:' + helper, join(root, 'tools', 'isolation', 'desktop-bridge.cs')], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  await writeFile(join(directory, 'compile.log'), (built.stdout ?? '') + (built.stderr ?? ''), { flag: 'wx' })
  if (built.error || built.status !== 0) throw new Error('NATIVE_HELPER_BUILD_FAILED: see ' + relative(root, directory))
  const source = await readFile(join(root, 'tools', 'isolation', 'attest-main.ts'), 'utf8')
  const preload = join(directory, 'attest-main.cjs')
  await writeFile(preload, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText, { flag: 'wx' })
  const config: IsolationConfig = { schema: 1, suite: selection.suite, variant: selection.step.args?.[0], helper, helperSha256: hash(await readFile(helper)), preload, preloadSha256: hash(await readFile(preload)) }
  const request = join(directory, 'request.json')
  await writeFile(request, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return { directory, request, config }
}

/** The helper owns only its suspended worker's job. EOF cancels it even if this controller dies. */
export async function runIsolation(selection: IsolationSelection, timeoutMs = 1800000): Promise<number> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw new Error('ISOLATION_TIMEOUT_RANGE')
  const { directory, request, config } = await prepareIsolation(selection), root = await realpath(process.cwd())
  const stat = await lstat(config.helper)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await realpath(config.helper) !== config.helper || hash(await readFile(config.helper)) !== config.helperSha256) throw new Error('NATIVE_HELPER_CHANGED')
  const mutex = hash(Buffer.from(root.toLowerCase()))
  const env: NodeJS.ProcessEnv = { ...process.env, GEPPIO_ISOLATION_CONFIG: request }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.GEPPIO_TEST_VISIBLE; delete env.GEPPIO_ISOLATION_DESKTOP
  const child = spawn(config.helper, ['run', process.execPath, join(root, 'tools', 'isolation', 'isolation-worker.ts'), request, mutex, String(timeoutMs)], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const log = createWriteStream(join(directory, 'execution.log'), { flags: 'wx' })
  let output = '', result: NativeResult | undefined, bytes = 0, cancelReason: number | undefined, logFailed = false, verifiedWindows = 0
  const cancel = (reason: number) => { cancelReason ??= reason; child.stdin.end() }
  log.on('error', () => { logFailed = true; cancel(125) })
  child.stdin.on('error', () => { /* An exited helper has already closed its cancel channel. */ })
  const sigint = () => cancel(130), sigterm = () => cancel(130)
  process.once('SIGINT', sigint); process.once('SIGTERM', sigterm)
  // A helper that loses its own wait/cleanup path must still have a bounded lifetime.
  const watchdog = setTimeout(() => { cancel(124); setTimeout(() => child.kill(), 7000).unref() }, timeoutMs + 10000)
  const consume = (chunk: Buffer) => {
    log.write(chunk); bytes += chunk.length
    if (bytes > 16 * 1024 * 1024) { cancel(125); return }
    output += chunk.toString('utf8')
    const lines = output.split(/\r?\n/); output = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('{"kind":')) continue
      try { const record = JSON.parse(line) as NativeResult | { kind: 'gui-verified'; windows: number }; if (record.kind === 'result') result = record; else if (record.kind === 'gui-verified' && Number.isSafeInteger(record.windows) && record.windows > 0) verifiedWindows = record.windows } catch { /* Other test output is retained only in the log. */ }
    }
  }
  child.stdout.on('data', consume); child.stderr.on('data', chunk => { log.write(chunk); bytes += chunk.length; if (bytes > 16 * 1024 * 1024) cancel(125) })
  try {
    const code = await new Promise<number>((resolveExit, reject) => { child.once('error', reject); child.once('close', code => resolveExit(code ?? 125)) })
    if (!logFailed) await new Promise<void>((resolveLog, reject) => { log.once('error', reject); log.end(resolveLog) })
    const valid = result?.kind === 'result' && Number.isInteger(result.exitCode) && (result.exitCode >>> 0) === (code >>> 0) && result.cleanup === true
    const finalCode = completionCode(code, result, verifiedWindows, cancelReason ?? (logFailed ? 125 : undefined))
    await writeFile(join(directory, 'result.json'), JSON.stringify({ suite: selection.suite, exitCode: finalCode, native: result ?? null, validCompletion: valid, verifiedWindows }, null, 2) + '\n')
    console.log(`Isolated ${selection.suite}: ${finalCode === 0 ? 'passed' : 'FAILED (' + finalCode + ')'}; diagnostics: ${relative(root, directory)}`)
    return finalCode
  } finally {
    clearTimeout(watchdog); process.removeListener('SIGINT', sigint); process.removeListener('SIGTERM', sigterm); child.stdin.destroy(); log.end()
  }
}
