import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string; packageManager: string }
let failed = false
function report(name: string, pass: boolean, detail: string) { console.log(`${pass ? 'OK' : 'CHECK'}  ${name}: ${detail}`); if (!pass) failed = true }
report('Node.js', Number(process.versions.node.split('.')[0]) === 24, process.versions.node + ' (use Node 24.x)')
console.log(`INFO  Package manager: ${pkg.packageManager}; installs require registry access.`)
for (const tool of ['git', 'gh']) {
  const result = spawnSync(tool, ['--version'], { encoding: 'utf8', timeout: 5000 })
  const found = result.status === 0
  if (tool === 'git') report(tool, found, found ? 'available' : 'install Git before initializing the repository')
  else console.log(`INFO  gh: ${found ? 'available; authentication not tested' : 'optional for local UI; required for github:prepare --apply'}`)
}
for (const dependency of ['electron', 'react', 'typescript', 'electron-vite']) {
  try { require.resolve(dependency); report(dependency, true, 'installed') }
  catch { report(dependency, false, 'run pnpm install') }
}
console.log(`INFO  Lockfile: ${existsSync('pnpm-lock.yaml') ? 'present; verify frozen install' : 'not generated in this offline package; first pnpm install must generate it, then commit it'}`)
console.log(`INFO  Platform: ${process.platform}. Windows is the product target; Linux core tests are not Windows GUI validation.`)
console.log('INFO  Codex: TOML files express requested settings. Verify effective model, effort and sandbox in the installed client.')
console.log('INFO  No accounts, services, paid APIs, Git operations or remote metadata were changed.')
if (failed) process.exitCode = 1
