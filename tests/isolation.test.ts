import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { incompatible, launchMode, parseSelection, selectSuite } from '../tools/isolation/plan.ts'
import { completionCode } from '../tools/isolation/completion.ts'
import { electron } from '../tools/test-electron.ts'

test('isolated suite selection accepts only known paths and literal supported runtime flags', () => {
  assert.deepEqual(selectSuite('monaco', '--dev'), { suite: 'monaco', step: { file: 'tools/monaco-smoke.ts', args: ['--dev'] } })
  assert.equal(selectSuite('desktop-core', '--scale125').step.file, 'tools/desktop-smoke.ts')
  for (const args of [[], ['monaco', '--dev', '--scale125'], ['../monaco'], ['monaco && whoami'], ['C:\\run.exe'], ['__proto__'], ['constructor'], ['monaco', '--no-sandbox'], ['sidebar-stack', '--dev']]) assert.throws(() => parseSelection(args))
})

test('clipboard and paste suites refuse before native helper preparation instead of dropping assertions', () => {
  assert.deepEqual(Object.keys(incompatible).sort(), ['edit-lock', 'terminal', 'workspace-essentials'])
  for (const suite of Object.keys(incompatible)) assert.throws(() => selectSuite(suite), /ISOLATION_INCOMPATIBLE/)
  assert.equal(selectSuite('conpty').step.file, 'tools/isolation/conpty-smoke.ts')
})

test('local launches require isolation or explicit visible opt-in, without fallback from broken isolation', () => {
  assert.throws(() => launchMode({}, 'win32'), /ISOLATION_REQUIRED/)
  assert.equal(launchMode({ GEPPIO_TEST_VISIBLE: '1' }, 'win32'), 'visible')
  assert.equal(launchMode({ GITHUB_ACTIONS: 'true', CI: 'true' }, 'win32'), 'visible')
  assert.throws(() => launchMode({ GITHUB_ACTIONS: 'true' }, 'win32'))
  const desktop = 'GeppIOTest' + 'a'.repeat(32)
  assert.equal(launchMode({ GEPPIO_ISOLATION_DESKTOP: desktop }, 'win32'), 'isolated')
  for (const env of [
    { GEPPIO_ISOLATION_CONFIG: 'missing', GEPPIO_TEST_VISIBLE: '1' },
    { GEPPIO_ISOLATION_DESKTOP: 'Default', GEPPIO_TEST_VISIBLE: '1' },
    { GEPPIO_ISOLATION_DESKTOP: desktop, GEPPIO_TEST_VISIBLE: '1' },
    { GEPPIO_ISOLATION_DESKTOP: 'Default', GITHUB_ACTIONS: 'true', CI: 'true' }
  ]) assert.throws(() => launchMode(env, 'win32'))
  assert.throws(() => launchMode({ GEPPIO_ISOLATION_DESKTOP: desktop }, 'linux'))
})

test('missing launch authority rejects through the real shared entry before any Electron process', async () => {
  const keys = ['GEPPIO_TEST_VISIBLE', 'GEPPIO_ISOLATION_DESKTOP', 'GEPPIO_ISOLATION_CONFIG', 'GITHUB_ACTIONS', 'CI'] as const
  const before = keys.map(key => process.env[key])
  try { for (const key of keys) delete process.env[key]; await assert.rejects(electron.launch(), /ISOLATION_REQUIRED/) }
  finally { keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index] }) }
})

test('isolated completion preserves actual failures and refuses missing GUI, cleanup failure or inconsistent status', () => {
  const pass = { kind: 'result' as const, exitCode: 0, cleanup: true }
  assert.equal(completionCode(0, pass, 1), 0)
  assert.equal(completionCode(7, { ...pass, exitCode: 7 }, 0), 7)
  assert.equal(completionCode(0, pass, 0), 125)
  assert.equal(completionCode(0, { ...pass, cleanup: false }, 1), 125)
  assert.equal(completionCode(0, undefined, 1), 125)
  assert.equal(completionCode(0, { ...pass, exitCode: 7 }, 1), 125)
  assert.equal(completionCode(0, pass, 1, 124), 124)
  assert.equal(completionCode(0, pass, 1, 130), 130)
})

test('all test Electron imports use the shared guard; application and CI boundaries remain separate', () => {
  const bypasses = readdirSync('tools').filter(file => file.endsWith('.ts') && file !== 'test-electron.ts' && /import\s*\{[^}]*\b_electron\b[^}]*\}\s*from\s*['"]playwright['"]/.test(readFileSync('tools/' + file, 'utf8')))
  assert.deepEqual(bypasses, [])
  const native = readFileSync('tools/isolation/desktop-bridge.cs', 'utf8')
  assert.doesNotMatch(native, /extern\s+\w+\s+(?:SwitchDesktop|SendInput|SetCursorPos|Nt\w+)\(/)
  assert.doesNotMatch(readFileSync('tools/test-electron.ts', 'utf8'), /--no-sandbox|webSecurity:\s*false/)
})
