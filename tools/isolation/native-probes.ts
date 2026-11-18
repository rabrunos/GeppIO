import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Internal negative fixtures, never selectable through the public suite catalog. */
export async function runProbe(probe: string, request: string) {
  if (probe === 'exit7') { process.exitCode = 7; return }
  if (probe === 'exit0') return
  if (probe !== 'wait' && probe !== 'orphan') throw new Error('UNKNOWN_NATIVE_PROBE')
  let orphan: number | undefined
  if (probe === 'orphan') {
    const child = spawn(process.execPath, ['--experimental-strip-types', resolve('tools/isolation/stay-alive.ts')], { windowsHide: true, stdio: 'ignore' })
    await new Promise<void>((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject) }); orphan = child.pid; child.unref()
  }
  await writeFile(join(dirname(request), 'probe-ready.json'), JSON.stringify({ worker: process.pid, orphan }) + '\n', { flag: 'wx' })
  await new Promise(resolveWait => setTimeout(resolveWait, 60000))
}
