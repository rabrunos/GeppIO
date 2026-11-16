import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ciGroups } from './ci-plan.ts'
import type { CiGroup, SmokeStep } from './ci-plan.ts'

export interface StepResult { command: string; status: number; signal: string | null; elapsedMs: number }

/** Fail at the first unsuccessful suite; preserve its output/status and never retry gestures. */
export function runSteps(steps: readonly SmokeStep[]): StepResult[] {
  const results: StepResult[] = []
  for (const step of steps) {
    const args = ['--experimental-strip-types', step.file, ...(step.args ?? [])]
    const command = ['node', ...args].join(' '), start = performance.now()
    console.log(`\nSTART ${command}`)
    const child = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true })
    const status = child.status ?? 1
    results.push({ command, status, signal: child.signal, elapsedMs: Math.round(performance.now() - start) })
    console.log(`END ${command}: ${status === 0 ? 'passed' : 'FAILED'} (${results.at(-1)!.elapsedMs} ms)`)
    if (child.error) console.error(child.error)
    if (status !== 0) break
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [group, ...extra] = process.argv.slice(2)
  if (!group || !Object.hasOwn(ciGroups, group) || extra.length) throw new Error('Usage: ci-tests.ts core|ide|workbench')
  const steps = ciGroups[group as CiGroup], results = runSteps(steps)
  const status = results.find(result => result.status !== 0)?.status ?? 0
  mkdirSync('.local/ci-results', { recursive: true })
  writeFileSync(`.local/ci-results/${group}.json`, JSON.stringify({ group, expected: steps.length, executed: results.length, status, results }, null, 2) + '\n')
  console.log(`${group}: ${results.length}/${steps.length} suites executed; ${status === 0 ? 'passed' : 'FAILED'}`)
  process.exitCode = status
}
