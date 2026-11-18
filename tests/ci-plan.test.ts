import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ciGroups } from '../tools/ci-plan.ts'
import { runSteps } from '../tools/ci-tests.ts'

// Independent acceptance inventory from alpha.48, ce14aba, workflow run 43869693602.
// A scenario is an entrypoint + arguments; internal assertions/matrices remain in each suite.
const alpha48 = [
  'monaco', 'monaco --scale125', 'monaco --dev', 'git', 'git --scale125', 'git --dev',
  'terminal', 'terminal --scale125', 'plugin-package', 'plugin-dev', 'sidebar-stack',
  'workspace-essentials', 'time-tracker', 'maximize', 'alignment', 'groups', 'edit-lock',
  'demo-retirement', 'identity', 'desktop', 'workbench', 'workbench-organization',
  'workbench-plugins', 'workbench-corrections', 'presentation', 'real-presentation',
  'real-presentation --scale125', 'document', 'multi-document', 'multi-document --scale125',
  'multi-document --dev', 'explorer', 'explorer --scale125', 'workspace',
  'workspace --scale125', 'workspace --dev', 'maximize --scale125', 'presentation --scale125'
].map(value => value.replace(/^([\w-]+)/, 'tools/$1-smoke.ts')).sort()

const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts
function expand(name: string): string[] {
  return scripts[name]!.split(' && ').flatMap(command => {
    const nested = /^pnpm ([\w:-]+)$/.exec(command)
    if (nested) return expand(nested[1]!)
    return [command.replace('node --experimental-strip-types ', '')]
  })
}

test('CI preserves all 38 distinct alpha.48 Electron invocations and public commands', () => {
  const actual = Object.values(ciGroups).flat().map(step => [step.file, ...(step.args ?? [])].join(' ')).sort()
  assert.equal(alpha48.length, 38)
  assert.deepEqual(actual, [...alpha48, 'tools/app-host-smoke.ts', 'tools/app-host-smoke.ts --scale125'].sort(),
    'No omission, duplicate execution or changed DPR/runtime flag. App Host coverage is additive.')
  const publicSmokes = [
    'test:desktop', 'test:monaco', 'test:git', 'test:terminal', 'test:documents',
    'test:explorer', 'test:workspace', 'test:sidebar', 'test:plugin-package', 'test:plugin-dev'
  ].flatMap(expand).filter(command => /^tools\/[\w-]+-smoke\.ts/.test(command))
  publicSmokes.push('tools/terminal-smoke.ts --scale125', 'tools/explorer-smoke.ts --scale125',
    'tools/maximize-smoke.ts --scale125', 'tools/presentation-smoke.ts --scale125')
  assert.deepEqual(publicSmokes.sort(), alpha48, 'Existing public commands retain their full native contract')
  for (const step of actual) assert.ok(existsSync(step.split(' ')[0]!))
  for (const group of Object.keys(ciGroups)) assert.equal(scripts['test:ci:' + group], 'node --experimental-strip-types tools/ci-tests.ts ' + group)
  assert.equal(scripts.check, 'pnpm check:repo && pnpm typecheck && pnpm lint && pnpm test && pnpm plugins:build && pnpm build')
})

test('all 45 alpha.48 Node suite files still run through the full discovery gate', () => {
  const baseline = `demo-retirement documents execution-policy explorer freeform-alignment freeform-geometry
    freeform-projection freeform-storage git-compatibility git github-plan grid-coverage grid-geometry
    grid-horizontal grid-projection-continuity grid-projection grid-reflow grid-storage identity-migration
    layout-correction layout monaco plugin-data plugin-dev plugin-package plugin-runtime plugins
    real-presentations reflow region-policy security sidebar-stack status-bar storage terminal time-tracker
    widget-frame-layout window-controls workbench-compositions workbench-corrections workbench-groups
    workbench-model workbench-presentations workbench-regional-groups workspace`.split(/\s+/).filter(Boolean)
  assert.equal(baseline.length, 45)
  const files = readdirSync('tests').filter(name => name.endsWith('.test.ts'))
  for (const name of baseline) assert.ok(files.includes(name + '.test.ts'), name)
  assert.equal(scripts.test, 'node --experimental-strip-types tools/test.ts')
  const runner = readFileSync('tools/test.ts', 'utf8')
  assert.match(runner, /readdirSync\('tests'\)\.filter\(name => name\.endsWith\('\.test\.ts'\)\)\.sort\(\)/)
  assert.match(runner, /\['--experimental-strip-types', '--test', \.\.\.files\]/)
})

function validateWorkflow(source: string) {
  assert.deepEqual([...source.matchAll(/^ {2}([\w-]+):$/gm)].map(match => match[1]), ['push', 'pull_request', 'workflow_dispatch', 'windows-tests', 'windows', 'secrets'])
  assert.match(source, /permissions:\s+contents: read/)
  assert.match(source, /group: geppio-checks-\$\{\{ github.ref \}\}\s+cancel-in-progress: true/)
  assert.match(source, /fail-fast: false\s+matrix:\s+group: \[core, ide, workbench\]/)
  assert.doesNotMatch(source, /continue-on-error|\|\|\s*true|paths-ignore|paths:|exclude:|include:|pull_request_target/)
  assert.deepEqual([...source.matchAll(/^\s+if: (.+)$/gm)].map(match => match[1]), ["matrix.group == 'core'", "matrix.group != 'core'", '${{ always() }}'])
  assert.match(source, /if: matrix.group == 'core'\s+run: pnpm check/)
  assert.match(source, /if: matrix.group != 'core'\s+run: pnpm plugins:build && pnpm build/)
  assert.match(source, /run: pnpm test:ci:\$\{\{ matrix.group \}\}/)
  assert.match(source, /windows:\s+needs: \[windows-tests, secrets\]\s+if: \$\{\{ always\(\) \}\}/)
  assert.match(source, /WINDOWS_RESULT: \$\{\{ needs.windows-tests.result \}\}/)
  assert.match(source, /SECRETS_RESULT: \$\{\{ needs.secrets.result \}\}/)
  assert.match(source, /run: test "\$WINDOWS_RESULT" = success && test "\$SECRETS_RESULT" = success/)
  assert.match(source, /node-version: '24'/)
  assert.match(source, /package-manager-cache: false/)
  assert.match(source, /npm install --global pnpm@11\.25\.0/)
  assert.match(source, /pnpm install --frozen-lockfile/)
  assert.equal([...source.matchAll(/persist-credentials: false/g)].length, 2)
  for (const match of source.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1]!, /@[a-f0-9]{40}$/)
  assert.match(source, /fetch-depth: 0/)
  assert.match(source, /git show --format= --check HEAD/)
  assert.match(source, /sha256sum --check --status/)
  assert.match(source, /gitleaks" git --redact --no-banner --log-opts=--all --timeout=180/)
}

test('required matrix/aggregate status fails closed and preserves security/triggers', () => {
  const workflow = readFileSync('.github/workflows/checks.yml', 'utf8')
  validateWorkflow(workflow)
  for (const [from, to] of [
    ['fail-fast: false', 'fail-fast: true'],
    ['needs: [windows-tests, secrets]', 'needs: [windows-tests]'],
    ['${{ always() }}', '${{ success() }}'],
    ['= success && test', '= success || test'],
    ['group: [core, ide, workbench]', 'group: [core, ide]'],
    ['run: pnpm test:ci:', 'continue-on-error: true\n        run: pnpm test:ci:']
  ]) assert.throws(() => validateWorkflow(workflow.replace(from!, to!)), from)
})

test('sequential runner propagates a real child failure and never executes the next suite', t => {
  const root = mkdtempSync(join(tmpdir(), 'geppio-ci-contract-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fail = join(root, 'fail.ts'), next = join(root, 'next.ts'), sentinel = join(root, 'executed')
  writeFileSync(fail, 'process.exitCode = 7\n')
  writeFileSync(next, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'unexpected')\n`)
  const results = runSteps([{ file: fail }, { file: next }])
  assert.equal(results.length, 1)
  assert.equal(results[0]!.status, 7)
  assert.equal(existsSync(sentinel), false)
  const missing = runSteps([{ file: join(root, 'missing.ts') }, { file: next }])
  assert.notEqual(missing[0]!.status, 0)
  assert.equal(missing.length, 1)
  assert.equal(existsSync(sentinel), false)
})
