import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { DocumentStore } from '../src/main/documents.ts'
import { DirectoryStore } from '../src/main/explorer.ts'
import { WorkspaceOwner } from '../src/main/workspace.ts'
import { WorkspaceRecovery } from '../src/main/workspace-recovery.ts'
import { readWorkspaceTools } from '../src/main/workspace-tools.ts'
import { parseWorkspaceTools, WORKSPACE_TOOLS_LIMITS } from '../src/shared/workspace-tools.ts'

const text = { kind: 'text', text: '<script>literal</script> **texto** https://example.invalid/' }
const list = { kind: 'list', items: ['build', 'test'] }
const table = { kind: 'table', columns: ['Nome', 'Estado'], rows: [['Tipo', 'OK']] }
const quality = { id: 'quality', title: 'Qualidade', blocks: [text, list, table] }
const json = (reports: unknown) => JSON.stringify({ schemaVersion: 1, reports })
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
const always = () => true
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'geppio-workspace-tools-')))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))
  const project = join(root, 'project'), folder = join(project, '.geppio'), file = join(folder, 'tools.json')
  await mkdir(project)
  const owner = new WorkspaceOwner(new DirectoryStore(), new DocumentStore(), new WorkspaceRecovery(join(root, 'profile')), () => {})
  return { owner, root, project, folder, file }
}

test('the closed UTF-8 envelope preserves literal strings and enforces byte, identity and UTF-16 quotas', () => {
  const parse = (reports: unknown) => parseWorkspaceTools(Buffer.from(json(reports)))
  assert.deepEqual(parse([quality]).reports, [quality]); assert.deepEqual(parse([]).reports, [])
  const unicode = { ...quality, title: '😀'.repeat(40) }
  const raw = Buffer.from(json([unicode]))
  assert.deepEqual(parseWorkspaceTools(Buffer.concat([raw, Buffer.alloc(WORKSPACE_TOOLS_LIMITS.bytes - raw.length, 32)])).reports, [unicode])
  assert.throws(() => parseWorkspaceTools(Buffer.concat([raw, Buffer.alloc(WORKSPACE_TOOLS_LIMITS.bytes + 1 - raw.length, 32)])))
  assert.throws(() => parseWorkspaceTools(Buffer.concat([Buffer.from(json([quality]).split('Qualidade')[0]!), Buffer.from([0xc2]), Buffer.from(json([quality]).split('Qualidade')[1]!)])))
  assert.throws(() => parseWorkspaceTools(Buffer.from(json([quality]).replace('"title":', '"ti\\u0074le":"ambíguo","title":'))))
  for (const value of [{ schemaVersion: 2, reports: [] }, { schemaVersion: 1, reports: [], path: '' }, {}, null]) assert.throws(() => parseWorkspaceTools(bytes(value)))
  const full = Array.from({ length: 8 }, (_, i) => ({ id: 'report-' + i, title: 'r', blocks: Array(8).fill(text) }))
  assert.deepEqual(parse(full).reports, full)
  assert.equal(parse([{ ...quality, id: 'a'.repeat(64) }]).reports.length, 1)
  for (const reports of [null, [quality, quality], [...full, { ...quality }], [{ ...quality, blocks: Array(9).fill(text) }],
    [{ ...quality, id: 'b'.repeat(65) }], [{ ...quality, id: '../path' }], [{ ...quality, id: 'constructor' }],
    [{ ...unicode, title: unicode.title + 'x' }], [{ ...quality, callback: true }], [{ id: 'one', blocks: [] }]]) assert.throws(() => parse(reports))
  const withBlock = (block: unknown) => parse([{ ...quality, blocks: [block] }])
  const longest = '😀'.repeat(2048)
  assert.ok(withBlock({ kind: 'text', text: longest })); assert.ok(withBlock({ kind: 'list', items: Array(50).fill('😀'.repeat(128)) }))
  assert.ok(withBlock({ kind: 'table', columns: Array(6).fill('h'), rows: Array(50).fill(Array(6).fill('c')) }))
  for (const bad of [null, { ...text, kind: 'html' }, { ...text, source: 'file' }, { ...text, text: longest + 'x' },
    { ...list, items: [false] }, { ...list, items: Array(51).fill('') }, { ...list, items: ['x'.repeat(257)] },
    { ...table, columns: Array(7).fill('c') }, { ...table, columns: ['x'.repeat(257), ''] }, { ...table, rows: Array(51).fill(['', '']) },
    { ...table, rows: [['x']] }, { ...table, rows: [['x', 'x', 'x']] }, { ...table, rows: [['', 'x'.repeat(257)]] }]) assert.throws(() => withBlock(bad))
})

test('list items, table headers and data cells share one total budget across all reports', () => {
  const fullTable = { kind: 'table', columns: Array(6).fill('h'), rows: Array(50).fill(Array(6).fill('v')) }
  const lastItems = Array(32).fill('x')
  const reports = [{ ...quality, blocks: [fullTable, fullTable, fullTable] },
    { ...quality, id: 'other', blocks: [{ kind: 'list', items: Array(50).fill('x') }, { kind: 'list', items: lastItems }] }]
  assert.equal(parseWorkspaceTools(Buffer.from(json(reports))).reports.length, 2)
  lastItems.push('x'); assert.throws(() => parseWorkspaceTools(Buffer.from(json(reports))))
})

test('reads only the fixed report after authorization, distinguishes missing from malformed, creates no files or grants', async t => {
  const { owner, project, folder, file } = await fixture(t)
  const refused = await readWorkspaceTools(owner, always)
  assert.ok(!refused.ok && refused.expired)
  const root = (await owner.opened(project, always)).root!.id
  const missing = { ok: true, root, status: 'missing', reports: [] }
  await writeFile(join(project, 'tools.json'), json([quality]))
  owner.directories.list = async () => assert.fail('fixed read enumerated the project')
  assert.deepEqual(await readWorkspaceTools(owner, always), missing)
  assert.deepEqual(await readdir(project), ['tools.json'])
  await mkdir(folder); assert.deepEqual(await readWorkspaceTools(owner, always), missing)
  await writeFile(file, json([quality]))
  const closed = await readWorkspaceTools(owner, () => false, async () => assert.fail('owner had expired'))
  assert.ok(!closed.ok && closed.expired)
  const result = await readWorkspaceTools(owner, always)
  assert.deepEqual(result, { ok: true, root, status: 'ready', reports: [quality] })
  assert.deepEqual(owner.documents.snapshots, [])
  await writeFile(file, '{"schemaVersion":1,'); assert.equal((await readWorkspaceTools(owner, always)).ok, false)
  const huge = Buffer.alloc(WORKSPACE_TOOLS_LIMITS.bytes + 1)
  await writeFile(file, huge)
  const large = await readWorkspaceTools(owner, always, async stage => assert.notEqual(stage, 'opened'))
  assert.equal(large.ok, false); assert.deepEqual(await readFile(file), huge)
  await rm(file); assert.deepEqual(await readWorkspaceTools(owner, always), missing)
})

test('rejects changed input before open, while reading and after handle close, without publishing bytes or paths', async t => {
  const { owner, project, folder, file } = await fixture(t)
  await owner.opened(project, always); await mkdir(folder)
  const previous = ' '.repeat(20000) + json([quality])
  for (const stage of ['before-open', 'opened', 'read', 'closed'] as const) {
    await writeFile(file, previous)
    let observed = 0
    const result = await readWorkspaceTools(owner, always, async at => {
      if (stage === at && ++observed === 1) await writeFile(file, json([{ ...quality, title: 'Outra versão' }]))
    })
    assert.ok(observed > 0); assert.ok(!result.ok && !result.expired); assert.ok(!JSON.stringify(result).includes(project))
    assert.ok(!Object.hasOwn(result, 'reports'))
  }
  for (const replace of ['parent', 'file'] as const) {
    await writeFile(file, previous)
    const result = await readWorkspaceTools(owner, always, async at => {
      if (at !== 'closed') return
      if (replace === 'parent') { await rename(folder, folder + '-old'); await mkdir(folder) }
      else await rename(file, file + '-old')
      await writeFile(file, previous)
    })
    assert.ok(!result.ok && !result.expired)
  }
})

test('rejects linked folders, multiply linked files and an unstable missing observation', async t => {
  const { owner, root, project, folder, file } = await fixture(t)
  await owner.opened(project, always)
  const outside = join(root, 'other'); await mkdir(outside); await writeFile(join(outside, 'tools.json'), json([quality]))
  await symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await readWorkspaceTools(owner, always)).ok, false)
  await rm(folder); await mkdir(folder); await link(join(outside, 'tools.json'), file)
  assert.equal((await readWorkspaceTools(owner, always)).ok, false)
  await rm(file)
  const appeared = await readWorkspaceTools(owner, always, async at => { if (at === 'missing') await writeFile(file, json([quality])) })
  assert.ok(!appeared.ok && !appeared.expired)
})

test('root A to B, close, owner revocation and physical root replacement annul even a completed handle read', async t => {
  for (const event of ['change', 'close', 'generation', 'physical', 'caller'] as const) {
    const { owner, root, project, folder, file } = await fixture(t)
    const id = (await owner.opened(project, always)).root!.id
    await mkdir(folder); await writeFile(file, json([quality]))
    let active = true, closed = false
    const result = await readWorkspaceTools(owner, () => active, async at => {
      if (at !== 'closed') return
      closed = true
      if (event === 'change') { const other = join(root, 'next'); await mkdir(other); await owner.opened(other, always) }
      if (event === 'close') await owner.close(id, always)
      if (event === 'generation') owner.revoke()
      if (event === 'physical') { await rename(project, project + '-old'); await mkdir(project) }
      if (event === 'caller') active = false
    })
    assert.ok(closed); assert.ok(!result.ok && result.expired); assert.ok(!Object.hasOwn(result, 'reports'))
  }
})
