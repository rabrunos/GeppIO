import test from 'node:test'
import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import childProcess from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { DirectoryStore } from '../src/geppio/src/main/explorer.ts'
import { GitFailure, GitStore, gitFailure, parseGitStatus, resolveGitExecutable, runGit } from '../src/geppio/src/main/git.ts'
import type { GitChange, GitResult } from '../src/geppio/src/shared/git.ts'
import { GIT_LIMITS } from '../src/geppio/src/shared/git.ts'
import { gitFingerprint, ignoredGitTrees, initializeGit } from '../tools/git-fixtures.ts'

const current = () => true
const rows = (changes: GitChange[]) => changes.map(({ name, previous, index, working }) => ({ name, previous, index, working }))
const success = (result: GitResult) => { assert.ok(result.ok && result.status); return result.status }
const denied = (reason: string) => (error: unknown) => error instanceof GitFailure && error.kind === 'unsupported' && error.reason === reason
async function fixture(run: (value: { base: string; path: string; outside: string; git: (args: string[]) => string; root: string; store: GitStore }) => Promise<void>) {
  const temporary = await mkdtemp(join(tmpdir(), 'geppio-smoke-git-compatibility-')), base = await realpath(temporary)
  try {
    const path = join(base, 'repository'), outside = join(base, 'outside'), git = await initializeGit(path)
    const directories = new DirectoryStore(), selected = await directories.select(path, current)
    assert.ok(selected.ok && selected.root)
    await run({ base, path, outside, git, root: selected.root.id, store: new GitStore(directories) })
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5 }) }
}
const reference = (git: (args: string[]) => string) => rows(parseGitStatus(Buffer.from(git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all']))))

test('ignored pnpm-shaped/arbitrary/deep trees preserve exact status and all original bytes without following junctions', async () => fixture(async ({ path, outside, git, root, store }) => {
  await ignoredGitTrees(path, outside)
  await writeFile(join(path, 'modified.ts'), 'changed\r\n')
  await writeFile(join(path, 'both.txt'), 'staged\n'); git(['add', 'both.txt']); await writeFile(join(path, 'both.txt'), 'unstaged\n')
  await unlink(join(path, 'deleted.txt')); await writeFile(join(path, 'novo Ω.txt'), 'new\n'); await writeFile(join(path, 'café 😀.txt'), 'changed Unicode\n')
  git(['config', 'branch.main.vscode-merge-base', 'main']); git(['config', 'pull.rebase', 'false']); git(['config', 'core.ignorecase', 'true'])
  const before = await gitFingerprint(path), external = await gitFingerprint(outside)
  const result = success(await store.inspect('status', root, undefined, current))
  assert.deepEqual(rows(result.changes), reference(git)); assert.equal(result.branch, 'main')
  assert.equal(result.changes.some(change => /node_modules|vendor-cache|outside-sentinel/.test(change.name)), false)
  assert.ok(result.changes.some(change => change.index + change.working === 'MM'))
  assert.deepEqual(await gitFingerprint(path), before); assert.deepEqual(await gitFingerprint(outside), external)
  git(['checkout', '--detach']); assert.ok(success(await store.inspect('status', root, undefined, current)).detached)
}))

test('tracked paths below ignored ancestors and Git negation rules remain visible with mixed-case Unicode names', async () => fixture(async ({ path, git, root, store }) => {
  await mkdir(join(path, 'Ignored')); await mkdir(join(path, 'generated'))
  await writeFile(join(path, 'Ignored', 'MiXeD Ω.ts'), 'tracked\n'); git(['add', 'Ignored']); git(['commit', '-m', 'Tracked before ignore'])
  await writeFile(join(path, '.gitignore'), 'Ignored/\ngenerated/*\n!generated/keep.txt\n')
  await writeFile(join(path, 'Ignored', 'MiXeD Ω.ts'), 'modified despite ignore\n')
  await writeFile(join(path, 'Ignored', 'hidden.txt'), 'ignored\n')
  await writeFile(join(path, 'generated', 'keep.txt'), 'unignored\n'); await writeFile(join(path, 'generated', 'hidden.txt'), 'ignored\n')
  const before = await gitFingerprint(path), result = success(await store.inspect('status', root, undefined, current))
  assert.deepEqual(rows(result.changes), reference(git))
  assert.ok(result.changes.some(change => change.name === 'Ignored/MiXeD Ω.ts' && change.working === 'M'))
  assert.ok(result.changes.some(change => change.name === 'generated/keep.txt' && change.untracked))
  assert.equal(result.changes.some(change => change.name.endsWith('hidden.txt')), false)
  assert.deepEqual(await gitFingerprint(path), before)
}))

test('hardlinked tracked files remain inspectable but cannot authorize compare or index mutation', async () => fixture(async ({ path, outside, git, root, store }) => {
  await ignoredGitTrees(path, outside)
  await link(join(outside, 'outside-sentinel.txt'), join(path, 'hardlinked.txt'))
  git(['add', 'hardlinked.txt']); git(['commit', '-m', 'Ordinary hardlinked entry'])
  await writeFile(join(outside, 'outside-sentinel.txt'), 'changed shared fixture\n'); await writeFile(join(path, 'modified.ts'), 'safe explicit target\n')
  const before = await gitFingerprint(path), external = await gitFingerprint(outside)
  const result = success(await store.inspect('status', root, undefined, current))
  assert.deepEqual(rows(result.changes), reference(git))
  const unsafe = result.changes.find(change => change.name === 'hardlinked.txt')!
  assert.ok(unsafe && unsafe.working === 'M' && !unsafe.stage && !unsafe.unstage && unsafe.actionReason)
  await assert.rejects(store.inspect('compare', root, unsafe.id, current))
  await assert.rejects(store.inspect('stage', root, unsafe.id, current))
  assert.deepEqual(await gitFingerprint(path), before); assert.deepEqual(await gitFingerprint(outside), external)
  const fresh = success(await store.inspect('status', root, undefined, current)), safe = fresh.changes.find(change => change.name === 'modified.ts')!
  assert.ok(safe.stage); const previousBlob = git(['rev-parse', ':hardlinked.txt'])
  const staged = await store.inspect('stage', root, safe.id, current); assert.ok(staged.ok && staged.mutated)
  assert.equal(git(['rev-parse', ':hardlinked.txt']), previousBlob); assert.deepEqual(await gitFingerprint(outside), external)
  const after = await gitFingerprint(path)
  for (const [name, value] of Object.entries(before)) if (!name.startsWith('.git/')) assert.equal(after[name], value)
}))

test('tracked symlink index mode and gitlink status agree with Git while special-index writes stay unavailable', async () => fixture(async ({ path, outside, git, root, store }) => {
  await ignoredGitTrees(path, outside)
  await writeFile(join(path, 'tracked-link'), 'modified.ts'); const blob = git(['hash-object', '-w', 'tracked-link']).trim()
  git(['update-index', '--add', '--cacheinfo', '120000,' + blob + ',tracked-link'])
  const head = git(['rev-parse', 'HEAD']).trim(); git(['update-index', '--add', '--cacheinfo', '160000,' + head + ',submodule'])
  await symlink(outside, join(path, 'submodule'), 'junction')
  await writeFile(join(path, 'modified.ts'), 'ordinary changed\n')
  const before = await gitFingerprint(path), external = await gitFingerprint(outside)
  const result = success(await store.inspect('status', root, undefined, current))
  assert.deepEqual(rows(result.changes), reference(git))
  assert.ok(result.changes.some(change => change.name === 'tracked-link'))
  assert.ok(result.changes.every(change => !change.stage && !change.unstage && change.actionReason))
  assert.equal(result.changes.some(change => change.name.includes('outside-sentinel')), false)
  assert.deepEqual(await gitFingerprint(path), before); assert.deepEqual(await gitFingerprint(outside), external)
}))

test('visible junctions and case-varied tracked redirected ancestors refuse before status can traverse outside', async () => fixture(async ({ path, outside, git, root, store }) => {
  await ignoredGitTrees(path, outside)
  await symlink(outside, join(path, 'visible'), 'junction')
  assert.ok(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).includes('outside-sentinel'), 'Installed Git would traverse this visible junction')
  const external = await gitFingerprint(outside)
  await assert.rejects(store.inspect('status', root, undefined, current), denied('worktree-redirect'))
  await unlink(join(path, 'visible'))
  await mkdir(join(path, 'CasePath')); await writeFile(join(path, 'CasePath', 'tracked.txt'), 'before\n'); git(['add', 'CasePath']); git(['commit', '-m', 'Tracked ancestor'])
  await rm(join(path, 'CasePath'), { recursive: true }); await symlink(outside, join(path, 'casepath'), 'junction')
  await writeFile(join(path, '.gitignore'), 'casepath/\nnode_modules/\nvendor-cache/\n.local/\n'); git(['config', 'core.ignorecase', 'false'])
  await assert.rejects(store.inspect('status', root, undefined, current), denied('worktree-redirect'))
  assert.deepEqual(await gitFingerprint(outside), external)
}))

test('linked rules, executable configuration and object redirects have distinct path-free refusal categories', async () => fixture(async ({ path, outside, git, root, store }) => {
  await ignoredGitTrees(path, outside); await unlink(join(path, '.gitignore'))
  await link(join(outside, 'outside-sentinel.txt'), join(path, '.gitignore'))
  await assert.rejects(store.inspect('status', root, undefined, current), denied('worktree-rules'))
  await unlink(join(path, '.gitignore')); await writeFile(join(path, '.gitignore'), 'node_modules/\nvendor-cache/\n.local/\n')
  git(['config', 'filter.evil.clean', 'cmd.exe /c echo executed > EXECUTED'])
  await assert.rejects(store.inspect('status', root, undefined, current), denied('configuration')); await assert.rejects(readFile(join(path, 'EXECUTED')))
  git(['config', '--remove-section', 'filter.evil']); await writeFile(join(path, '.git', 'objects', 'info', 'alternates'), '../outside\n')
  await assert.rejects(store.inspect('status', root, undefined, current), denied('metadata'))
  await unlink(join(path, '.git', 'objects', 'info', 'alternates')); await rm(join(path, '.git', 'objects', 'info'), { recursive: true })
  await symlink(outside, join(path, '.git', 'objects', 'info'), 'junction')
  const external = await gitFingerprint(outside)
  await assert.rejects(store.inspect('status', root, undefined, current), denied('metadata'))
  assert.deepEqual(await gitFingerprint(outside), external)
  for (const reason of ['layout', 'metadata', 'configuration', 'index', 'worktree-redirect', 'worktree-rules'] as const) {
    const failure = gitFailure(new GitFailure('unsupported', reason))
    assert.ok(!failure.ok && failure.code === 'unsupported'); assert.doesNotMatch(JSON.stringify(failure), /[A-Z]:\\|outside-sentinel|cmd\.exe|source content/)
  }
}))

test('visible depth budgets refuse the complete snapshot while ignored deep trees are pruned', async () => fixture(async ({ path, root, store }) => {
  let deep = path
  for (let i = 0; i < 34; i++) { deep = join(deep, 'd'); await mkdir(deep) }
  await writeFile(join(deep, 'leaf.txt'), 'outside supported depth\n')
  await assert.rejects(store.inspect('status', root, undefined, current), (error: unknown) => error instanceof GitFailure && error.kind === 'limit' && error.reason === 'worktree-budget')
  assert.equal((store as unknown as { status: unknown }).status, null)
  await writeFile(join(path, '.gitignore'), 'd/\n')
  const result = success(await store.inspect('status', root, undefined, current))
  assert.equal(result.changes.some(change => change.name.startsWith('d/')), false)
}))

test('a rule change at native status spawn cannot return a falsely clean snapshot', async () => fixture(async ({ path, root, store }) => {
  const rule = join(path, '.gitignore'); await writeFile(rule, ''); await writeFile(join(path, 'new.txt'), 'visible\n')
  const original = childProcess.spawn; let raced = false
  childProcess.spawn = ((file: string, args: readonly string[], options: SpawnOptions) => {
    if (!raced && args.includes('status')) { raced = true; writeFileSync(rule, 'new.txt\n') }
    return original(file, args, options)
  }) as typeof childProcess.spawn
  syncBuiltinESMExports()
  try {
    await assert.rejects(store.inspect('status', root, undefined, current), (error: unknown) => error instanceof GitFailure && error.kind === 'stale')
    assert.ok(raced); assert.equal((store as unknown as { status: unknown }).status, null)
  } finally { childProcess.spawn = original; syncBuiltinESMExports() }
}))

test('ordinary v4 index remains readable while split-index metadata receives an explicit refusal', async () => fixture(async ({ path, git, root, store }) => {
  await writeFile(join(path, 'modified.ts'), 'changed\n'); git(['update-index', '--index-version=4'])
  const result = success(await store.inspect('status', root, undefined, current))
  assert.deepEqual(rows(result.changes), reference(git)); assert.ok(result.changes.every(change => !change.stage && !change.unstage))
  git(['update-index', '--split-index'])
  await assert.rejects(store.inspect('status', root, undefined, current), denied('index'))
}))

test('fixed check-ignore protocol permits its no-match exit only and bounds input without weakening other Git calls', async () => fixture(async ({ path }) => {
  const executable = await resolveGitExecutable(), controller = new AbortController()
  await writeFile(join(path, '.gitignore'), 'ignored/\n')
  await mkdir(join(path, 'ignored'))
  const invoke = (input: string) => runGit(executable, ['-C', path, 'check-ignore', '--no-index', '--stdin', '-z'], path, controller.signal, GIT_LIMITS.output, GIT_LIMITS.timeout, { input: Buffer.from(input), ignoreQuery: true })
  assert.equal((await invoke('ordinary.txt\0')).length, 0)
  assert.equal((await invoke('ignored\0')).toString(), 'ignored\0')
  await assert.rejects(runGit(executable, ['--version'], path, controller.signal, GIT_LIMITS.output, GIT_LIMITS.timeout, { input: Buffer.alloc(0), ignoreQuery: true }))
  await assert.rejects(invoke('x'.repeat(GIT_LIMITS.output + 1)))
  await assert.rejects(runGit(executable, ['config', '--get', 'missing.setting'], path, controller.signal))
}))
