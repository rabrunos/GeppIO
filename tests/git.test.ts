import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DirectoryStore } from '../src/main/explorer.ts'
import { GitFailure, GitStore, gitEnvironment, gitFailure, gitRelativeName, parseGitStatus, resolveGitExecutable, runGit } from '../src/main/git.ts'
import { GIT_LIMITS, validGitRequest } from '../src/shared/git.ts'
import type { GitResult } from '../src/shared/git.ts'
import { GitSession } from '../src/renderer/src/git/session.ts'
import { ExplorerSession } from '../src/renderer/src/files-editor/explorer-session.ts'
import { EditorSession } from '../src/renderer/src/files-editor/session.ts'
import type { ExplorerBridge } from '../src/shared/explorer.ts'
import { gitFingerprint, initializeGit } from '../tools/git-fixtures.ts'

const current = () => true
function success(result: GitResult) { assert.ok(result.ok); return result }
const denied = (kind: string) => (error: unknown) => error instanceof GitFailure && error.kind === kind
async function fixture(run: (root: string) => Promise<void>) {
  const temporary = await mkdtemp(join(tmpdir(), 'geppio-smoke-git-unit-'))
  try { await run(await realpath(temporary)) } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5 }) }
}
async function selected(root: string) {
  const directories = new DirectoryStore(), selection = await directories.select(root, current)
  assert.ok(selection.ok && selection.root)
  return { directories, root: selection.root.id, store: new GitStore(directories) }
}
test('Git fixed requests, path-free failures, NUL status and bounded relative names', () => {
  const id = randomUUID()
  assert.ok(validGitRequest('status', [id])); assert.ok(validGitRequest('compare', [id, id]))
  for (const operation of ['status', 'compare', 'exec', 'commit']) for (const args of [[], [id, id, 'extra'], ['../root'], [id, 'C:\\private']]) assert.equal(validGitRequest(operation, args), false)
  assert.doesNotMatch(JSON.stringify(gitFailure(new Error('C:\\private'))), /private/)
  for (const name of ['../a', '/a', 'a\\b', 'a/.git/config', 'a:stream', 'a\n', 'nul', 'a/'.repeat(34)]) assert.equal(gitRelativeName(name), false)
  const changes = parseGitStatus(Buffer.from(' M café 😀.txt\0R  rename new.txt\0rename old.txt\0?? a b.txt\0UU conflict.txt\0'))
  assert.equal(changes.length, 4); assert.equal(changes[1]!.previous, 'rename old.txt'); assert.ok(changes[2]!.untracked); assert.ok(changes[3]!.conflict)
  assert.throws(() => parseGitStatus(Buffer.from(' M a')), denied('unsupported'))
  assert.throws(() => parseGitStatus(Buffer.from('?? x\0'.repeat(513))), denied('limit'))
  assert.throws(() => parseGitStatus(Buffer.from([32, 77, 32, 255, 0])))
})
test('real Git: clean/staged/unstaged/untracked/delete/rename/detached; exact HEAD-to-disk; no writes', async () => fixture(async path => {
  const git = await initializeGit(path), { root, store } = await selected(path)
  const clean = await gitFingerprint(path)
  assert.deepEqual(success(await store.inspect('status', root, undefined, current)).status?.changes, [])
  assert.deepEqual(await gitFingerprint(path), clean)
  git(['gc', '--prune=now'])
  const packed = await gitFingerprint(path)
  assert.deepEqual(success(await store.inspect('status', root, undefined, current)).status?.changes, [])
  assert.deepEqual(await gitFingerprint(path), packed)
  await writeFile(join(path, 'modified.ts'), 'const answer = 2;\r\n')
  await writeFile(join(path, 'both.txt'), 'staged\n'); git(['add', 'both.txt']); await writeFile(join(path, 'both.txt'), 'saved\r\n')
  await rm(join(path, 'deleted.txt')); git(['mv', 'rename old.txt', 'rename new.txt'])
  await writeFile(join(path, 'new file.txt'), 'untracked\n'); await writeFile(join(path, 'café 😀.txt'), 'unicode\n')
  const before = await gitFingerprint(path), result = success(await store.inspect('status', root, undefined, current)).status!
  assert.equal(result.branch, 'main'); assert.equal(result.detached, false)
  const change = (name: string) => result.changes.find(c => c.name === name)!
  assert.equal(change('modified.ts').working, 'M'); assert.equal(change('both.txt').index + change('both.txt').working, 'MM')
  assert.equal(change('deleted.txt').working, 'D'); assert.equal(change('rename new.txt').previous, 'rename old.txt'); assert.ok(change('new file.txt').untracked)
  const comparison = success(await store.inspect('compare', root, change('both.txt').id, current)).comparison!
  assert.equal(comparison.original, 'before\n'); assert.equal(comparison.modified, 'saved\r\n'); assert.match(comparison.basis, /HEAD.*disco/)
  assert.equal(success(await store.inspect('compare', root, change('deleted.txt').id, current)).comparison?.modified, '')
  assert.equal(success(await store.inspect('compare', root, change('rename new.txt').id, current)).comparison?.original, 'before\n')
  await assert.rejects(store.inspect('compare', root, change('new file.txt').id, current), denied('unsupported'))
  assert.deepEqual(await gitFingerprint(path), before)
  git(['checkout', '--detach']); assert.ok(success(await store.inspect('status', root, undefined, current)).status?.detached)
}))
test('binary/large comparison, stale IDs/grants, nested/bare/worktree/submodule and linked storage refuse safely', async () => fixture(async path => {
  await initializeGit(path)
  await writeFile(join(path, 'binary.dat'), Buffer.from([0, 255, 1])); await writeFile(join(path, 'large.txt'), 'x'.repeat(GIT_LIMITS.text + 1))
  const { root, store, directories } = await selected(path), before = await gitFingerprint(path)
  const changes = success(await store.inspect('status', root, undefined, current)).status!.changes
  await assert.rejects(store.inspect('compare', root, changes.find(c => c.name === 'binary.dat')!.id, current), denied('unsupported'))
  await assert.rejects(store.inspect('compare', root, changes.find(c => c.name === 'large.txt')!.id, current), denied('limit'))
  await store.inspect('status', root, undefined, current)
  await assert.rejects(store.inspect('compare', root, changes[0]!.id, current), denied('stale'))
  assert.deepEqual(await gitFingerprint(path), before)
  directories.revoke(); await assert.rejects(store.inspect('status', root, undefined, current))
  await mkdir(join(path, 'nested')); const nested = await selected(join(path, 'nested'))
  await assert.rejects(nested.store.inspect('status', nested.root, undefined, current), denied('unsupported'))
  const linked = join(path, 'nested', '.git'); await writeFile(linked, 'gitdir: ../../.git\n')
  await assert.rejects(nested.store.inspect('status', nested.root, undefined, current))
  await rm(linked); await symlink(join(path, '.git'), linked, 'junction')
  await assert.rejects(nested.store.inspect('status', nested.root, undefined, current))
}))
test('config/environment execution surfaces are isolated, filters/extensions rejected, metadata never touched', async () => fixture(async path => {
  const git = await initializeGit(path)
  const marker = join(path, 'EXECUTED'), command = 'cmd.exe /c echo executed > "' + marker + '"'
  for (const key of ['core.fsmonitor', 'diff.external', 'diff.evil.command', 'diff.evil.textconv', 'credential.helper', 'core.sshCommand', 'core.hooksPath']) git(['config', key, command])
  git(['config', 'include.path', '../outside-config'])
  await writeFile(join(path, '.gitattributes'), '* diff=evil\n'); await writeFile(join(path, 'modified.ts'), 'changed\n')
  const { root, store } = await selected(path), before = await gitFingerprint(path)
  const changes = success(await store.inspect('status', root, undefined, current)).status!.changes
  await store.inspect('compare', root, changes.find(c => c.name === 'modified.ts')!.id, current)
  assert.deepEqual(await gitFingerprint(path), before)
  await assert.rejects(readFile(marker))
  assert.equal(gitEnvironment(path).GIT_CONFIG_COUNT, undefined); assert.equal(gitEnvironment(path).PATH, undefined)
  git(['config', 'filter.evil.clean', command]); await assert.rejects(store.inspect('status', root, undefined, current), denied('unsupported'))
  git(['config', '--remove-section', 'filter.evil']); git(['config', 'extensions.worktreeConfig', 'true']); await assert.rejects(store.inspect('status', root, undefined, current), denied('unsupported'))
  git(['config', '--remove-section', 'extensions']); await writeFile(join(path, '.git', 'objects', 'info', 'alternates'), '..\n'); await assert.rejects(store.inspect('status', root, undefined, current), denied('unsupported'))
}))
test('missing Git, pre-cancelled process, process output cap and stale traversal', async () => fixture(async path => {
  const prior = process.env.ProgramW6432
  try { process.env.ProgramW6432 = join(path, 'absent'); await assert.rejects(resolveGitExecutable(), denied('missing')) } finally { if (prior === undefined) delete process.env.ProgramW6432; else process.env.ProgramW6432 = prior }
  const executable = await resolveGitExecutable(), controller = new AbortController(); controller.abort()
  await assert.rejects(runGit(executable, ['--version'], path, controller.signal), denied('stale'))
  await assert.rejects(runGit(executable, ['--version'], path, new AbortController().signal, 1), denied('limit'))
  await initializeGit(path); const { root, store } = await selected(path)
  await assert.rejects(store.inspect('status', root, undefined, () => false), denied('stale'))
}))
test('native Git timeout kills its process with a controlled timer', async context => fixture(async path => {
  const executable = await resolveGitExecutable()
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = runGit(executable, ['--version'], path, new AbortController().signal)
  context.mock.timers.tick(GIT_LIMITS.timeout + 1)
  await assert.rejects(pending, denied('timeout'))
  context.mock.timers.reset()
}))
test('real bare, linked worktree, gitlink, conflict, ignored file and ambiguous HEAD cases', async () => fixture(async path => {
  const scope = join(path, 'scope'), git = await initializeGit(scope), { root, store } = await selected(scope)
  await writeFile(join(scope, 'ignored.txt'), 'ignored\n'); await writeFile(join(scope, '.git', 'info', 'exclude'), 'ignored.txt\n')
  assert.ok(!success(await store.inspect('status', root, undefined, current)).status!.changes.some(c => c.name === 'ignored.txt'))
  const head = git(['rev-parse', 'HEAD']).trim()
  git(['update-index', '--add', '--cacheinfo', '160000,' + head + ',submodule'])
  await assert.rejects(store.inspect('status', root, undefined, current), denied('unsupported'))
  git(['update-index', '--force-remove', 'submodule'])
  git(['checkout', '-b', 'other']); await writeFile(join(scope, 'both.txt'), 'other\n'); git(['add', 'both.txt']); git(['commit', '-m', 'Other'])
  git(['checkout', 'main']); await writeFile(join(scope, 'both.txt'), 'main\n'); git(['add', 'both.txt']); git(['commit', '-m', 'Main'])
  assert.throws(() => git(['merge', 'other']))
  const conflicted = success(await store.inspect('status', root, undefined, current)).status!.changes.find(c => c.name === 'both.txt')!
  assert.ok(conflicted.conflict); await assert.rejects(store.inspect('compare', root, conflicted.id, current), denied('unsupported'))
  git(['merge', '--abort'])
  const linked = join(path, 'linked'); git(['worktree', 'add', '--detach', linked])
  const selectedLinked = await selected(linked); await assert.rejects(selectedLinked.store.inspect('status', selectedLinked.root, undefined, current))
  const bare = join(path, 'bare'); git(['init', '--bare', bare]); const selectedBare = await selected(bare)
  await assert.rejects(selectedBare.store.inspect('status', selectedBare.root, undefined, current), denied('unsupported'))
  await writeFile(join(scope, '.git', 'HEAD'), 'ambiguous\n'); await assert.rejects(store.inspect('status', root, undefined, current))
}))
test('root revocation while native inspection is pending prevents a successful response', async () => fixture(async path => {
  await initializeGit(path); const { root, store, directories } = await selected(path)
  const pending = store.inspect('status', root, undefined, current)
  directories.revoke(); store.revoke()
  await assert.rejects(pending)
}))
test('OS temporary aliases canonicalize private scratch without expanding the selected grant', async () => fixture(async path => {
  const scope = join(path, 'scope'); await initializeGit(scope)
  const scratch = join(path, 'temporary'), alias = join(path, 'temporary-alias'); await mkdir(scratch); await symlink(scratch, alias, 'junction')
  const parentGit = await initializeGit(scratch)
  parentGit(['config', 'core.repositoryformatversion', '1']); parentGit(['config', 'extensions.objectformat', 'unsupported-fixture-format'])
  const scratchBefore = await gitFingerprint(scratch)
  const { root, store } = await selected(scope), before = await gitFingerprint(scope)
  const prior = { TEMP: process.env.TEMP, TMP: process.env.TMP }
  try {
    process.env.TEMP = alias; process.env.TMP = alias
    assert.deepEqual(success(await store.inspect('status', root, undefined, current)).status?.changes, [])
    assert.deepEqual(await gitFingerprint(scope), before)
    assert.deepEqual(await gitFingerprint(scratch), scratchBefore, 'Host scratch parent repository/config is neither adopted nor modified')
    process.env.TEMP = scope; process.env.TMP = scope
    await assert.rejects(store.inspect('status', root, undefined, current), denied('unsupported'))
    assert.deepEqual(await gitFingerprint(scope), before)
  } finally {
    for (const key of ['TEMP', 'TMP'] as const) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
  }
}))
test('shared renderer state discards delayed results after root replacement/release', async () => {
  let selectedRoot = randomUUID(), finish!: (value: GitResult) => void
  const explorer = new ExplorerSession({ select: async () => ({ ok: true, root: { id: selectedRoot, name: 'scope', kind: 'directory' } }), list: async () => ({ ok: true, root: null, children: [] }), release: async () => ({ ok: true, root: null }) } as unknown as ExplorerBridge, new EditorSession({} as never))
  const session = new GitSession({ status: () => new Promise(resolve => { finish = resolve }), compare: async () => ({ ok: false, code: 'unsupported', error: 'unsupported' }) }, explorer)
  session.connect(); await explorer.select(); const old = finish
  selectedRoot = randomUUID(); await explorer.select(); old({ ok: true, status: { root: randomUUID(), name: 'stale', branch: 'stale', detached: false, changes: [] } }); await Promise.resolve()
  assert.equal(session.snapshot().status, null)
  await explorer.release(); finish({ ok: true, status: { root: selectedRoot, name: 'stale', branch: 'stale', detached: false, changes: [] } }); await Promise.resolve()
  assert.equal(session.snapshot().root, null); assert.equal(session.snapshot().status, null); session.dispose()
})
