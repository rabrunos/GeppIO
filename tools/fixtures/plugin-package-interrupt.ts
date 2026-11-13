import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename } from 'node:path'
import type { PluginTrustEntry } from '../../src/main/plugin-trust.ts'

// Fault injection lives only in this child-process fixture, never in application configuration.
const [root, source, phase] = process.argv.slice(2)
if (!root || !source || !['before', 'after', 'failure'].includes(phase ?? '')) throw new Error('Invalid interruption fixture')
const roots = JSON.parse(readFileSync(0, 'utf8')) as PluginTrustEntry[]
const rename = fs.rename
fs.rename = async (from, to) => {
  if (basename(to.toString()) === 'state.json') {
    if (phase === 'failure') throw new Error('Injected state rename failure')
    if (phase === 'before') process.exit(73)
    await rename(from, to); process.exit(74)
  }
  return rename(from, to)
}
syncBuiltinESMExports()
const { PluginStore } = await import('../../src/main/plugins.ts')
try { await new PluginStore(root, roots).installSigned(source, async () => true, () => true) }
catch (error) { if (phase === 'failure' && error instanceof Error && error.message === 'Injected state rename failure') process.exit(75); throw error }
throw new Error('Expected forced interruption')
