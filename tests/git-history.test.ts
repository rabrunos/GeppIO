import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs, { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { DirectoryStore } from '../src/geppio/src/main/explorer.ts'
import { GitFailure, GitStore, gitEnvironment, gitFailure, resolveGitExecutable } from '../src/geppio/src/main/git.ts'
import { GitHistoryStore } from '../src/geppio/src/main/git-history.ts'
import { GIT_LIMITS, GIT_HISTORY_LIMITS } from '../src/geppio/src/shared/git.ts'
import type { GitOperation, GitResult } from '../src/geppio/src/shared/git.ts'
import { fixtureGit, gitFingerprint, initializeGit } from '../tools/git-fixtures.ts'

const current = () => true
const failure = (kind: string) => (error: unknown) => error instanceof GitFailure && error.kind === kind
function ok(result: GitResult) { assert.ok(result.ok); return result }
async function fixture(t: TestContext, initial = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'geppio-history-')))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))
  const dir = join(root, 'project'); await mkdir(dir)
  const git = initial ? await initializeGit(dir) : await fixtureGit(dir)
  if (!initial) git(['init', '-b', 'main'])
  const directories = new DirectoryStore(); await directories.select(dir, current)
  const grant = directories.snapshot!.id, store = new GitStore(directories)
  const inspect = async (op: GitOperation, id?: string, ...more: string[]) => ok(await store.inspect(op, grant, id, current, more))
  const history = async () => (await inspect('history')).history!
  const detail = async (snap: string, id: string) => (await inspect('historyCommit', snap, id)).commit!
  const compare = async (snap: string, id: string, file: string) => (await inspect('historyCompare', snap, id, file)).comparison!
  return { root, dir, git, grant, directories, store, inspect, history, detail, compare }
}
/** Fixture-only bulk history. Git writes exclusively into a disposable repository. */
async function importHistory(dir: string, count: number, subjectLength = 0, fileCount = 0, bodyLength = 0) {
  const input = ['blob', 'mark :1', 'data 1', 'x']
  for (let i = 0; i < count; i++) {
    const title = 'test ' + i + ' ' + 's'.repeat(subjectLength)
    const message = bodyLength ? title + '\n\n' + 'body'.repeat(bodyLength / 4) : title
    input.push('commit refs/heads/main', 'mark :' + (i + 2), 'committer Fixture <local@example.invalid> 1000000000 +0000', 'data ' + Buffer.byteLength(message), message)
    if (i) input.push('from :' + (i + 1))
    if (!i) for (let f = 0; f < fileCount; f++) input.push('M 100644 :1 file-' + f)
    input.push('')
  }
  input.push('done', '')
  execFileSync(await resolveGitExecutable(), ['fast-import', '--quiet'], { cwd: dir, shell: false, windowsHide: true, env: gitEnvironment(dir), input: input.join('\n'), stdio: ['pipe', 'pipe', 'pipe'] })
}

test('first-parent history, raw root/ordinary/rename/merge and detached comparisons preserve all original evidence', async t => {
  const p = await fixture(t), { dir, git } = p
  const initial = git(['rev-parse', 'HEAD']).trim()
  git(['checkout', '-b', 'side']); await writeFile(join(dir, 'side.txt'), 'side\r\n'); git(['add', 'side.txt']); git(['commit', '-m', 'side branch'])
  git(['checkout', 'main']); await writeFile(join(dir, 'both.txt'), 'committed new text\n'); git(['mv', 'rename old.txt', 'rename new.txt']); git(['add', 'both.txt'])
  git(['commit', '-m', 'ordinary <subject>', '-m', 'details Ω']); git(['merge', '--no-ff', 'side', '-m', 'merge fixture'])
  await writeFile(join(dir, 'both.txt'), 'worktree contents, not committed')
  git(['config', 'log.showSignature', 'true']); git(['config', 'log.decorate', 'full'])
  await writeFile(join(dir, '.mailmap'), 'Alternate author <test@example.invalid> <fixture@example.invalid>\n')
  const changes = (await p.inspect('status')).status!, eligible = changes.changes.find(item => item.name === 'both.txt')!
  const before = await gitFingerprint(dir), page = await p.history()
  assert.deepEqual(page.commits.map(c => c.subject), ['merge fixture', 'ordinary <subject>', 'Disposable fixture'])
  assert.ok(!page.unborn && !page.detached && !page.limited); assert.equal(page.cursor, null)
  assert.equal(page.commits[0]!.author, 'Disposable Test'); assert.ok(Number.isFinite(Date.parse(page.commits[0]!.date)))
  const merge = await p.detail(page.snapshot, page.commits[0]!.id)
  assert.equal(merge.parents.length, 2); assert.deepEqual(merge.files.map(f => [f.status, f.name]), [['A', 'side.txt']])
  const merged = await p.compare(page.snapshot, merge.id, merge.files[0]!.id)
  assert.equal(merged.original, ''); assert.equal(merged.modified, 'side\r\n'); assert.match(merged.basis, /primeiro pai/)
  const detail = await p.detail(page.snapshot, page.commits[1]!.id); assert.match(detail.message, /details Ω/)
  assert.deepEqual(detail.files.map(f => [f.status, f.name]), [['M', 'both.txt'], ['A', 'rename new.txt'], ['D', 'rename old.txt']])
  const historical = await p.compare(page.snapshot, detail.id, detail.files[0]!.id)
  assert.equal(historical.original, 'before\n'); assert.equal(historical.modified, 'committed new text\n')
  const removal = await p.compare(page.snapshot, detail.id, detail.files[2]!.id)
  assert.equal(removal.original, 'before\n'); assert.equal(removal.modified, '')
  await assert.rejects(p.compare(page.snapshot, merge.id, merge.files[0]!.id), failure('stale'))
  const first = await p.detail(page.snapshot, page.commits[2]!.id)
  assert.equal(first.hash, initial.slice(0, 12)); assert.deepEqual(first.parents, []); assert.ok(first.files.every(f => f.status === 'A'))
  const added = await p.compare(page.snapshot, first.id, first.files.find(f => f.name === 'both.txt')!.id)
  assert.equal(added.original, ''); assert.equal(added.modified, 'before\n')
  await assert.rejects(p.inspect('stage', first.files[0]!.id), failure('stale'))
  assert.equal((await p.inspect('compare', eligible.id)).comparison?.modified, 'worktree contents, not committed')
  assert.deepEqual(await gitFingerprint(dir), before)
  assert.equal((await p.inspect('stage', eligible.id)).mutated, true)
  git(['checkout', '--detach']); const detached = await gitFingerprint(dir)
  await assert.rejects(p.detail(page.snapshot, first.id), failure('stale'))
  assert.equal((await p.history()).detached, true); assert.deepEqual(await gitFingerprint(dir), detached)
})

test('unborn differs from corrupt or missing object; unsafe config, wrong IDs, owner and root never grant history', async t => {
  const p = await fixture(t, false), empty = await gitFingerprint(p.dir)
  const unborn = await p.history()
  assert.deepEqual(unborn.commits, []); assert.equal(unborn.unborn, true); assert.equal(unborn.detached, false)
  assert.deepEqual(await gitFingerprint(p.dir), empty)
  await writeFile(join(p.dir, '.git', 'refs', 'heads', 'main'), 'a'.repeat(40) + '\n')
  const corrupt = await gitFingerprint(p.dir)
  await assert.rejects(p.history()); assert.deepEqual(await gitFingerprint(p.dir), corrupt)
  await rm(join(p.dir, '.git', 'refs', 'heads', 'main'))
  await importHistory(p.dir, 1)
  const page = await p.history(), token = page.commits[0]!.id
  await assert.rejects(p.inspect('historyPage', page.snapshot, randomUUID()), failure('stale'))
  await assert.rejects(p.detail(page.snapshot, randomUUID()), failure('stale'))
  await assert.rejects(p.store.inspect('historyCommit', p.grant, page.snapshot, () => false, [token]), failure('stale'))
  const second = await fixture(t); await assert.rejects(second.detail(page.snapshot, token), failure('stale'))
  p.git(['config', 'filter.fixture.clean', 'unused']); const blocked = await gitFingerprint(p.dir)
  await assert.rejects(p.history(), failure('unsupported')); assert.deepEqual(await gitFingerprint(p.dir), blocked)
  p.directories.revoke(); await assert.rejects(p.detail(page.snapshot, token), failure('stale'))
  const bad = await fixture(t); await writeFile(join(bad.dir, '.git', 'index'), 'broken index')
  const unchanged = await gitFingerprint(bad.dir)
  await assert.rejects(bad.history(), failure('unsupported')); assert.deepEqual(await gitFingerprint(bad.dir), unchanged)
})

test('opaque first-parent pagination caps 500 and does not revive a snapshot after HEAD changes', async t => {
  const p = await fixture(t, false); await importHistory(p.dir, 501)
  const original = await gitFingerprint(p.dir), first = await p.history()
  const ids = new Set<string>(), firstCursor = first.cursor!
  let page = first
  for (let n = 0; n < 10; n++) {
    assert.equal(page.commits.length, 50); assert.equal(page.commits[0]!.subject, 'test ' + (500 - n * 50))
    for (const item of page.commits) { assert.ok(!ids.has(item.id)); ids.add(item.id) }
    if (n < 9) { assert.ok(page.cursor && !page.limited); page = (await p.inspect('historyPage', first.snapshot, page.cursor)).history! }
  }
  assert.equal(page.cursor, null); assert.equal(page.limited, true); assert.equal(ids.size, 500)
  await assert.rejects(p.inspect('historyPage', first.snapshot, firstCursor), failure('stale'))
  assert.deepEqual(await gitFingerprint(p.dir), original)
  const oid = p.git(['rev-parse', 'HEAD']).trim()
  p.git(['update-ref', 'refs/heads/main', p.git(['rev-parse', 'HEAD^']).trim()])
  await assert.rejects(p.detail(first.snapshot, first.commits[0]!.id), failure('stale'))
  p.git(['update-ref', 'refs/heads/main', oid])
  await assert.rejects(p.detail(first.snapshot, first.commits[0]!.id), failure('stale'))
})

test('per-commit, page, retained metadata and file-count limits are explicit', async t => {
  for (const kind of ['commit', 'page', 'retained', 'files']) {
    const p = await fixture(t, false)
    await importHistory(p.dir, kind === 'retained' ? 255 : kind === 'page' ? 50 : 1,
      kind === 'commit' ? GIT_HISTORY_LIMITS.commitBytes : kind === 'retained' ? 9500 : kind === 'page' ? 11500 : 0, kind === 'files' ? 513 : 0)
    const before = await gitFingerprint(p.dir)
    if (kind === 'files') {
      const page = await p.history(); await assert.rejects(p.detail(page.snapshot, page.commits[0]!.id), failure('limit'))
    } else if (kind === 'retained') {
      let page = await p.history()
      for (let i = 1; i < 4; i++) page = (await p.inspect('historyPage', page.snapshot, page.cursor!)).history!
      await assert.rejects(p.inspect('historyPage', page.snapshot, page.cursor!), failure('limit'))
    } else await assert.rejects(p.history(), failure('limit'))
    assert.deepEqual(await gitFingerprint(p.dir), before)
  }
})

test('a page of small visible summaries can span multiple bounded raw-object batches', async t => {
  const p = await fixture(t, false); await importHistory(p.dir, 50, 0, 0, 12_000)
  const before = await gitFingerprint(p.dir), page = await p.history()
  assert.equal(page.commits.length, 50); assert.equal(page.cursor, null); assert.equal(page.limited, false)
  assert.equal(page.commits[49]!.subject, 'test 0')
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 20_000)
  assert.match((await p.detail(page.snapshot, page.commits[4]!.id)).message, /bodybody/)
  assert.deepEqual(await gitFingerprint(p.dir), before)
})

test('text-side size, binary content and historical symlink/gitlink modes refuse with explicit explanations', async t => {
  const p = await fixture(t)
  const head = p.git(['rev-parse', 'HEAD']).trim(), blob = p.git(['rev-parse', 'HEAD:both.txt']).trim()
  await writeFile(join(p.dir, 'large.txt'), Buffer.alloc(GIT_LIMITS.text + 1, 97))
  await writeFile(join(p.dir, 'binary.dat'), Buffer.from([97, 0]))
  p.git(['add', 'large.txt', 'binary.dat'])
  p.git(['update-index', '--chmod=+x', 'both.txt'])
  for (const [mode, oid, name] of [['120000', blob, 'link'], ['160000', head, 'submodule']]) p.git(['update-index', '--add', '--cacheinfo', mode!, oid!, name!])
  p.git(['commit', '-m', 'modes'])
  const before = await gitFingerprint(p.dir), page = await p.history(), detail = await p.detail(page.snapshot, page.commits[0]!.id)
  const executable = detail.files.find(f => f.name === 'both.txt')!
  assert.equal(executable.status, 'M')
  const modeOnly = await p.compare(page.snapshot, detail.id, executable.id)
  assert.equal(modeOnly.original, modeOnly.modified); assert.equal(modeOnly.original, 'before\n')
  for (const [file, explanation] of [['large.txt', '256 KiB'], ['binary.dat', 'binário'], ['link', 'links'], ['submodule', 'submódulos']]) {
    await assert.rejects(p.compare(page.snapshot, detail.id, detail.files.find(f => f.name === file)!.id), error => {
      const result = gitFailure(error); return !result.ok && result.error.includes(explanation!)
    })
  }
  assert.deepEqual(await gitFingerprint(p.dir), before)
})

test('revocation, HEAD change and deadline during final cleanup never publish a late result or leak the private copy', async t => {
  for (const mode of ['owner', 'head', 'timeout']) {
    const p = await fixture(t), original = await gitFingerprint(p.dir)
    const remove = fs.rm.bind(fs), now = Date.now.bind(Date)
    let completed = false, scratch = ''
    const mock = t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
      await remove(...args)
      if (typeof args[0] === 'string' && basename(args[0]).startsWith('geppio-git-read-')) {
        completed = true; scratch = args[0]
        if (mode === 'head') p.git(['checkout', '--detach'])
      }
    })
    syncBuiltinESMExports()
    const clock = t.mock.method(Date, 'now', () => now() + (mode === 'timeout' && completed ? GIT_LIMITS.timeout + 1 : 0))
    try {
      await assert.rejects(p.store.inspect('history', p.grant, undefined, () => !(mode === 'owner' && completed)), failure(mode === 'timeout' ? 'timeout' : 'stale'))
    } finally { mock.mock.restore(); syncBuiltinESMExports(); clock.mock.restore() }
    assert.ok(completed && scratch); await assert.rejects(fs.stat(scratch), { code: 'ENOENT' })
    if (mode !== 'head') assert.deepEqual(await gitFingerprint(p.dir), original)
  }
})

test('typed cat-file headers, framing and object identity must match the private log', async () => {
  const oid = 'a'.repeat(40), head = { ref: 'refs/heads/main', oid, witness: 'root' }
  for (const mode of ['missing', 'type', 'framing', 'hash']) {
    const header = oid + ' commit 3\n'
    await assert.rejects(new GitHistoryStore().read('history', randomUUID(), undefined, [], head, async args => {
      if (args[0] === 'log') return Buffer.from(oid + '\n')
      if (args[1] === '--batch-check') return Buffer.from(mode === 'missing' ? oid + ' missing\n' : mode === 'type' ? oid + ' blob 3\n' : header)
      return Buffer.from(header + (mode === 'framing' ? 'bad!' : 'bad\n'))
    }), failure('unsupported'))
  }
})
