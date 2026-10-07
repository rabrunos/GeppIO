import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const files = readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort().map(name => 'tests/' + name)
if (!files.length) throw new Error('No tests found')
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
