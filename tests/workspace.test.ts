import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { DocumentStore } from '../src/main/documents.ts'
import { DirectoryStore } from '../src/main/explorer.ts'
import { WorkspaceOwner } from '../src/main/workspace.ts'
import { WorkspaceRecovery, WORKSPACE_RECOVERY_LIMIT, emptyWorkspaceRecord, parseWorkspaceRecord } from '../src/main/workspace-recovery.ts'
import { validWorkspaceEditor, validWorkspaceRequest } from '../src/shared/workspace.ts'
import type { WorkspaceEditor } from '../src/shared/workspace.ts'

const current = () => true
async function fixture(run: (value: { root: string; project: string; profile: string; a: string; b: string }) => Promise<void>) {
  const temporary = await mkdtemp(join(tmpdir(), 'geppio-smoke-workspace-unit-')), root = await realpath(temporary)
  const project = join(root, 'project'), profile = join(root, 'profile'), a = join(project, 'one.ts'), b = join(project, 'two.txt')
  await mkdir(project); await writeFile(a, '\ufeffconst one = 1;\r\n'); await writeFile(b, 'second\n')
  try { await run({ root, project, profile, a, b }) } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5 }) }
}
function owner(profile: string) {
  const directories = new DirectoryStore(), documents = new DocumentStore(), recovery = new WorkspaceRecovery(profile)
  return new WorkspaceOwner(directories, documents, recovery, () => {})
}
function editor(workspace: WorkspaceOwner, dirty = false): WorkspaceEditor {
  return { active: workspace.documents.snapshot?.id ?? null, tabs: workspace.documents.snapshots.map(document => ({ id: document.id, revision: document.revision, dirty, language: 'TypeScript', selection: { start: 1, end: 3, top: 0, left: 0 } })) }
}
async function selected(workspace: WorkspaceOwner, path: string) {
  const result = await workspace.documents.select(path, null, async () => 'cancel', current)
  assert.ok(result.ok && result.document); return result.document
}

test('Workspace protocol accepts only bounded metadata and fixed operations; never native paths or source', () => {
  const view = { id: randomUUID(), revision: randomUUID(), dirty: false, language: null, selection: { start: 0, end: 0, top: 0, left: 0 } }
  const state = { active: view.id, tabs: [view] }
  assert.ok(validWorkspaceEditor(state))
  for (const operation of ['read', 'restore', 'standalone', 'forget']) { assert.ok(validWorkspaceRequest(operation, [])); assert.equal(validWorkspaceRequest(operation, ['C:\\private']), false) }
  assert.ok(validWorkspaceRequest('configure', [false])); assert.ok(validWorkspaceRequest('remember', [state]))
  for (const value of [{ ...state, path: 'C:\\private' }, { ...state, source: 'private draft' }, { ...state, tabs: [view, view] }, { ...state, active: randomUUID() }, { ...state, tabs: [{ ...view, text: 'source' }] }, { ...state, tabs: [{ ...view, selection: { ...view.selection, top: Infinity } }] }, { ...state, tabs: Array.from({ length: 9 }, () => ({ ...view, id: randomUUID() })) }]) assert.equal(validWorkspaceEditor(value), false)
  assert.equal(validWorkspaceRequest('cwd', ['C:\\private']), false)
  assert.equal(validWorkspaceRequest('configure', [true, 'extra']), false)
  assert.throws(() => parseWorkspaceRecord({ ...emptyWorkspaceRecord(), schemaVersion: 2 }))
})

test('first launch, independent project/file authority, metadata-only roundtrip and explicit forget', async () => fixture(async ({ root, project, profile, a, b }) => {
  const workspace = owner(profile), metadata = join(profile, 'workspace-session.v1.json')
  assert.deepEqual(await workspace.read(), { root: null, remember: true, recovery: null, error: null, notice: null })
  await assert.rejects(readFile(metadata))
  const beforeA = await readFile(a), beforeB = await readFile(b)
  await workspace.opened(project, current)
  const first = await selected(workspace, a); await selected(workspace, b); workspace.documents.activate(first.id)
  await workspace.remember(editor(workspace, true), current)
  const raw = await readFile(metadata, 'utf8'), value = parseWorkspaceRecord(JSON.parse(raw))
  assert.equal(value.files.length, 2); assert.equal(value.active, 0); assert.ok(value.files.every(file => file.dirty))
  assert.equal(raw.includes('const one'), false); assert.equal(raw.includes(first.id), false); assert.equal(raw.includes(first.revision), false)
  assert.deepEqual(await readFile(a), beforeA); assert.deepEqual(await readFile(b), beforeB)
  const rootId = workspace.directories.snapshot!.id
  await workspace.close(rootId, current)
  assert.equal(workspace.documents.snapshots.length, 2); assert.equal(workspace.status().root, null)
  const history = await readFile(metadata, 'utf8')
  await workspace.remember(editor(workspace), current); assert.equal(await readFile(metadata, 'utf8'), history, 'A standalone/startup metadata heartbeat cannot erase offered history')
  await workspace.documents.save({ id: first.id, revision: first.revision, text: 'still explicitly authorized\n' }, current)
  assert.equal(await readFile(a, 'utf8'), '\ufeffstill explicitly authorized\n')
  await workspace.forget(current)
  assert.deepEqual(JSON.parse(await readFile(metadata, 'utf8')), emptyWorkspaceRecord(false))
  assert.equal(workspace.documents.snapshots.length, 2)
  await assert.rejects(workspace.opened(root, current), 'App profile data cannot be written inside a selected project ancestor')
}))

test('restoration needs explicit consent, fresh grants, active tab and clean view state', async () => fixture(async ({ project, profile, a, b }) => {
  const first = owner(profile); await first.opened(project, current)
  const original = await selected(first, a); await selected(first, b); first.documents.activate(original.id)
  await first.remember(editor(first), current)
  const next = owner(profile); const offered = await next.read()
  assert.equal(offered.root, null); assert.equal(offered.recovery?.tabs, 2)
  const canceled = await next.restore(current, async () => false, async () => 'cancel')
  assert.ok(canceled.ok && canceled.canceled); assert.equal(next.directories.snapshot, null); assert.equal(next.documents.snapshots.length, 0)
  const restored = await next.restore(current, async () => true, async () => { throw new Error('unchanged file must not need a conflict decision') })
  assert.ok(restored.ok && restored.documents?.ok && restored.documents.document)
  assert.equal(next.documents.snapshots.length, 2); assert.notEqual(next.documents.snapshot!.id, original.id)
  assert.equal(next.documents.snapshot!.name, 'one.ts'); assert.equal(restored.views?.length, 2)
  assert.equal(restored.views?.[0]?.language, 'TypeScript'); assert.equal(restored.views?.[0]?.selection.end, 3)
  await assert.rejects(next.documents.save({ id: original.id, revision: original.revision, text: 'forged old authority' }, current))
}))

test('changed file recovery offers Current/Skip/Cancel and never overwrites disk or destroys history', async () => fixture(async ({ project, profile, a, b }) => {
  const first = owner(profile); await first.opened(project, current); await selected(first, a); await selected(first, b); await first.remember(editor(first), current)
  const metadata = join(profile, 'workspace-session.v1.json'), originalMetadata = await readFile(metadata)
  await writeFile(a, 'external new disk\n')
  const canceledOwner = owner(profile), canceled = await canceledOwner.restore(current, async () => true, async () => 'cancel')
  assert.ok(canceled.ok && canceled.canceled); assert.equal(canceledOwner.documents.snapshots.length, 0); assert.equal(canceledOwner.directories.snapshot, null)
  assert.deepEqual(await readFile(metadata), originalMetadata)
  const skippedOwner = owner(profile), skipped = await skippedOwner.restore(current, async () => true, async () => 'skip')
  assert.ok(skipped.ok); assert.equal(skippedOwner.documents.snapshots.length, 1); assert.equal(skippedOwner.documents.snapshot!.name, 'two.txt')
  const currentOwner = owner(profile), restored = await currentOwner.restore(current, async () => true, async () => 'current')
  assert.ok(restored.ok); assert.equal(currentOwner.documents.snapshots.length, 2); assert.equal(restored.views?.length, 1, 'Changed file does not receive a stale selection/language override')
  assert.equal(currentOwner.documents.snapshots.find(doc => doc.name === 'one.ts')!.text, 'external new disk\n')
  assert.equal(await readFile(a, 'utf8'), 'external new disk\n'); assert.deepEqual(await readFile(metadata), originalMetadata)
}))

test('missing/replaced project, missing/linked file and explicit work before restore fail safely', async () => fixture(async ({ root, project, profile, a, b }) => {
  const first = owner(profile); await first.opened(project, current); await selected(first, a); await selected(first, b); await first.remember(editor(first), current)
  await rm(b)
  const next = owner(profile), result = await next.restore(current, async () => true, async () => 'cancel')
  assert.ok(result.ok); assert.equal(next.documents.snapshots.length, 1); assert.match(result.value.notice!, /indisponível/)
  const standalone = owner(profile); await selected(standalone, a)
  await assert.rejects(standalone.restore(current, async () => true, async () => 'current')); assert.equal(standalone.documents.snapshots.length, 1)
  const hidden = join(root, 'old-project'); await rename(project, hidden); await mkdir(project)
  const replaced = owner(profile); let confirmed = false
  await assert.rejects(replaced.restore(current, async () => { confirmed = true; return true }, async () => 'current'))
  assert.equal(confirmed, false); assert.equal(replaced.directories.snapshot, null)
  await rm(project, { recursive: true }); await rename(hidden, project)
  await link(a, b)
  const linked = owner(profile), linkedResult = await linked.restore(current, async () => true, async () => 'current')
  assert.ok(linkedResult.ok); assert.equal(linked.documents.snapshots.length, 0)
}))

test('corrupt/future metadata is preserved, external replacements and canceled writes never clobber it', async () => fixture(async ({ profile }) => {
  await mkdir(profile); const path = join(profile, 'workspace-session.v1.json')
  const future = '{"schemaVersion":99,"private":"preserve"}'
  await writeFile(path, future)
  const recovery = new WorkspaceRecovery(profile); await recovery.load(); assert.ok(recovery.snapshot.error)
  await assert.rejects(recovery.save(emptyWorkspaceRecord(), current)); assert.equal(await readFile(path, 'utf8'), future)
  await recovery.forget(current); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), emptyWorkspaceRecord(false))
  await writeFile(path, JSON.stringify(emptyWorkspaceRecord()))
  await assert.rejects(recovery.save(emptyWorkspaceRecord(false), current)); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), emptyWorkspaceRecord())
  const fresh = new WorkspaceRecovery(profile); await fresh.load()
  await assert.rejects(fresh.save(emptyWorkspaceRecord(false), () => false)); assert.equal(fresh.snapshot.error, null)
  await writeFile(path, 'x'.repeat(WORKSPACE_RECOVERY_LIMIT + 1))
  const oversized = new WorkspaceRecovery(profile); await oversized.load(); assert.ok(oversized.snapshot.error)
  await assert.rejects(oversized.save(emptyWorkspaceRecord(), current))
  await oversized.forget(current); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), emptyWorkspaceRecord(false))
}))

test('recovery denies hardlinks and bounds abandoned staging; explicit forget only clears owned metadata', async () => fixture(async ({ root, profile }) => {
  await mkdir(profile); const path = join(profile, 'workspace-session.v1.json'), other = join(root, 'protected.txt')
  await writeFile(other, JSON.stringify(emptyWorkspaceRecord())); await link(other, path)
  const linked = new WorkspaceRecovery(profile); await linked.load(); assert.ok(linked.snapshot.error)
  await assert.rejects(linked.forget(current)); assert.deepEqual(JSON.parse(await readFile(other, 'utf8')), emptyWorkspaceRecord())
  await rm(path)
  const recovery = new WorkspaceRecovery(profile); await recovery.load()
  await writeFile(join(profile, '.workspace-session.v1.tmp'), 'partial metadata')
  await assert.rejects(recovery.save(emptyWorkspaceRecord(), current)); await recovery.forget(current)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), emptyWorkspaceRecord(false))
  await assert.rejects(readFile(join(profile, '.workspace-session.v1.tmp')))
}))

test('terminal startup captures project generation; changed grants cancel, stale unchanged roots fall back truthfully', async () => fixture(async ({ root, project, profile }) => {
  const workspace = owner(profile), none = workspace.startupDirectory()
  assert.equal((await none.resolve()).path, homedir())
  await workspace.opened(project, current); assert.equal(none.current(), false)
  const selected = workspace.startupDirectory(); assert.equal((await selected.resolve()).path, project)
  await workspace.close(workspace.directories.snapshot!.id, current)
  assert.equal(selected.current(), false); await assert.rejects(selected.resolve())
  await workspace.opened(project, current)
  const stale = workspace.startupDirectory(); await rename(project, join(root, 'moved'))
  assert.equal(stale.current(), true)
  const fallback = await stale.resolve(); assert.equal(fallback.path, homedir()); assert.match(fallback.note!, /pasta pessoal/)
}))
