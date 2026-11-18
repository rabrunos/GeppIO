import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { prepareIsolation } from './controller.ts'
import { selectSuite } from './plan.ts'
import type { IsolationConfig } from './controller.ts'

// Explicit local Win32 negative gate. No GUI, arbitrary commands or global policy changes.
if (process.platform !== 'win32') throw new Error('Windows x64 normal session required')
const root = resolve('.'), mutex = createHash('sha256').update(root.toLowerCase()).digest('hex')
type Prepared = Awaited<ReturnType<typeof prepareIsolation>>
async function prepare(probe: NonNullable<IsolationConfig['selfTest']>['probe']) {
  const prepared = await prepareIsolation(selectSuite('conpty'))
  prepared.config.selfTest = { probe, nonce: randomBytes(32).toString('hex') }
  await writeFile(prepared.request, JSON.stringify(prepared.config))
  return prepared
}
function launch(prepared: Prepared, timeout = 30000) {
  const child = spawn(prepared.config.helper, ['run', process.execPath, join(root, 'tools/isolation/isolation-worker.ts'), prepared.request, mutex, String(timeout)], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GEPPIO_ISOLATION_CONFIG: prepared.request, GEPPIO_ISOLATION_SELFTEST: prepared.config.selfTest!.nonce }
  })
  child.stdin.on('error', () => {})
  let text = ''
  child.stdout.on('data', data => { text += String(data) }); child.stderr.on('data', data => { text += String(data) })
  const done = new Promise<{ code: number; text: string }>((resolveDone, reject) => {
    child.once('error', reject); child.once('close', async code => { try { await writeFile(join(prepared.directory, 'self-test.log'), text); resolveDone({ code: code ?? 125, text }) } catch (error) { reject(error) } })
  })
  return { child, done, output: () => text }
}
async function probeReady(prepared: Prepared) {
  const until = performance.now() + 10000
  while (performance.now() < until) {
    try { return JSON.parse(await readFile(join(prepared.directory, 'probe-ready.json'), 'utf8')) as { worker: number; orphan?: number } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  throw new Error('Probe readiness timed out')
}
function completed(text: string) { const line = text.split(/\r?\n/).findLast(line => line.startsWith('{"kind":"result"')); assert.ok(line, text); return JSON.parse(line) as { exitCode: number; cleanup: boolean } }
function desktopOf(text: string) { const line = text.split(/\r?\n/).find(line => line.startsWith('{"kind":"ready"')); assert.ok(line, text); return (JSON.parse(line) as { desktop: string }).desktop }
async function absent(prepared: Prepared, desktop: string) {
  const until = performance.now() + 5000
  while (performance.now() < until) {
    const result = spawnSync(prepared.config.helper, ['verify-absent', desktop], { encoding: 'utf8', windowsHide: true, timeout: 2000 })
    if (result.status === 0) return
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  throw new Error('Owned job/desktop did not disappear')
}
async function variant(prepared: Prepared, from: string, to: string) {
  const source = await readFile('tools/isolation/desktop-bridge.cs', 'utf8'); assert.equal(source.split(from).length, 2, 'Unique first-party fault-injection point')
  const path = join(prepared.directory, 'fault.cs'); await writeFile(path, source.replace(from, to))
  const compiler = join(process.env.SystemRoot!, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const built = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/warnaserror+', '/out:' + prepared.config.helper, path], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(built.status, 0, built.stdout + built.stderr)
  prepared.config.helperSha256 = createHash('sha256').update(await readFile(prepared.config.helper)).digest('hex'); await writeFile(prepared.request, JSON.stringify(prepared.config))
}
const outcomes: { test: string; status: 'passed'; directory: string }[] = []
async function check(name: string, body: () => Promise<Prepared>) { const prepared = await body(); outcomes.push({ test: name, status: 'passed', directory: prepared.directory }); console.log('PASS ' + name) }

await check('exact exit 7 and normal cleanup', async () => { const p = await prepare('exit7'), run = launch(p); const result = await run.done; assert.equal(result.code, 7, result.text); assert.equal(completed(result.text).cleanup, true); await absent(p, desktopOf(result.text)); return p })
await check('timeout stays 124 and cleans owned worker', async () => { const p = await prepare('wait'), run = launch(p, 1000); const result = await run.done; assert.equal(result.code, 124, result.text); assert.equal(completed(result.text).cleanup, true); await absent(p, desktopOf(result.text)); return p })
await check('EOF cancellation stays 130', async () => { const p = await prepare('wait'), run = launch(p); await probeReady(p); run.child.stdin.end(); const result = await run.done; assert.equal(result.code, 130, result.text); assert.equal(completed(result.text).cleanup, true); await absent(p, desktopOf(result.text)); return p })
await check('concurrent invocation refuses without touching the first owner', async () => {
  const p = await prepare('wait'), first = launch(p); await probeReady(p)
  try { const second = launch(await prepare('exit7')); const refusal = await second.done; assert.equal(refusal.code, 125); assert.match(refusal.text, /CONCURRENT_INVOCATION/); assert.equal(first.child.exitCode, null) }
  finally { first.child.stdin.end() }
  const result = await first.done; assert.equal(result.code, 130, result.text); await absent(p, desktopOf(result.text)); return p
})
await check('hard helper termination kills worker and orphan without process-name killing', async () => {
  const p = await prepare('orphan'), run = launch(p); const pids = await probeReady(p); assert.ok(pids.orphan); const desktop = desktopOf(run.output()); run.child.kill(); const result = await run.done; assert.notEqual(result.code, 0)
  await absent(p, desktop)
  for (const pid of [pids.worker, pids.orphan!]) assert.throws(() => process.kill(pid, 0), /ESRCH|no such process/)
  return p
})
await check('cleanup API fault remains nonzero and cannot fabricate green', async () => {
  const p = await prepare('exit0'); await variant(p, 'if (!CloseDesktop(desk)) {', 'OpenDesktopW(desktop, 0, false, 1); // Hold an extra fixture reference until process exit.\n                    if (!CloseDesktop(desk)) {')
  const run = launch(p), result = await run.done; assert.equal(result.code, 125, result.text); assert.equal(completed(result.text).cleanup, false); await absent(p, desktopOf(result.text)); return p
})
await check('failed assignment terminates the exact suspended worker', async () => {
  const p = await prepare('exit0'); await variant(p, 'Need(AssignProcessToJobObject(job, child.process), "JOB_ASSIGN_BEFORE_EXECUTION"); assigned = true;', 'Need(false, "FIXTURE_ASSIGNMENT_REFUSED");')
  const run = launch(p), result = await run.done; assert.equal(result.code, 125, result.text); assert.match(result.text, /FIXTURE_ASSIGNMENT_REFUSED/); assert.equal(completed(result.text).cleanup, true); return p
})
await check('missing helper never starts a visible fallback', async () => {
  const p = await prepare('exit0'), result = spawnSync(join(p.directory, 'missing.exe'), [], { encoding: 'utf8', windowsHide: true }); assert.ok(result.error); assert.equal(result.status, null); return p
})
await check('tampered preload refuses before suite or GUI execution', async () => {
  const p = await prepare('exit0'); await writeFile(p.config.preload, '\n// Controlled tamper fixture.\n', { flag: 'a' })
  const result = await launch(p).done; assert.notEqual(result.code, 0); assert.match(result.text, /ISOLATION_HELPER_OR_PRELOAD_CHANGED/); assert.equal(completed(result.text).cleanup, true); await absent(p, desktopOf(result.text)); return p
})
await check('execution-denied helper has no fallback; only its disposable file ACL is restored', async () => {
  const p = await prepare('exit0'), windows = process.env.SystemRoot!
  const identity = spawnSync(join(windows, 'System32/whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true })
  assert.equal(identity.status, 0); const sid = /S-1-(?:\d+-)+\d+/.exec(identity.stdout)?.[0]; assert.ok(sid)
  const icacls = join(windows, 'System32/icacls.exe')
  const denied = spawnSync(icacls, [p.config.helper, '/deny', '*' + sid + ':(X)'], { encoding: 'utf8', windowsHide: true }); assert.equal(denied.status, 0)
  try { const result = spawnSync(p.config.helper, [], { encoding: 'utf8', windowsHide: true }); assert.ok(result.error); assert.equal(result.status, null) }
  finally { const restored = spawnSync(icacls, [p.config.helper, '/remove:d', '*' + sid], { encoding: 'utf8', windowsHide: true }); assert.equal(restored.status, 0, 'Restore only the disposable helper deny ACE') }
  return p
})
await writeFile('.local/isolation-alpha50/native-negative-results.json', JSON.stringify(outcomes, null, 2) + '\n')
console.log('PASS all ten explicit native negative cases; no GUI was requested')
