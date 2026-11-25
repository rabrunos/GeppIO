import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { WorkspaceToolsSession } from '../src/geppio/src/renderer/src/workspace-tools/session.ts'
import type { WorkspaceToolReport, WorkspaceToolsResult } from '../src/geppio/src/shared/workspace-tools.ts'

function observable<T>(value: T) {
  const listeners = new Set<() => void>()
  return { snapshot: () => value, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    change(next: T) { value = next; listeners.forEach(listener => listener()) } }
}
function fixture() {
  const tree = observable<{ root: { id: string } | null }>({ root: null }), editor = observable<{ invalidRoot: string | null }>({ invalidRoot: null })
  const reads: { root: string; resolve(result: WorkspaceToolsResult): void; reject(): void }[] = []
  let time = 1000
  const session = new WorkspaceToolsSession({ readTools: root => new Promise((resolve, reject) => { reads.push({ root, resolve, reject }) }) },
    { ...tree, editor }, () => ++time)
  const select = (id: string | null) => tree.change({ root: id ? { id } : null })
  const report = (id: string): WorkspaceToolReport => ({ id, title: id.toUpperCase(), blocks: [{ kind: 'text', text: id }] })
  const ready = (index: number, root: string, ids: string[]) => reads[index]!.resolve({ ok: true, root, status: 'ready', reports: ids.map(report) })
  return { session, reads, ready, select, editor }
}

test('one discovery per selected or restored root; presentations and Strict replay borrow the snapshot until explicit refresh', async () => {
  const { session, select, ready, reads } = fixture()
  select('a'); session.connect(); session.connect()
  session.dispose(); session.connect()
  assert.deepEqual(reads.map(r => r.root), ['a'])
  ready(0, 'a', ['one', 'two']); await setImmediate()
  assert.equal(session.snapshot().selected, 'one'); assert.equal(session.snapshot().lastRead, 1001)
  const close = session.subscribe(() => {}); close()
  session.select('two'); session.select('missing'); select('a'); session.dispose(); session.connect()
  assert.equal(session.snapshot().selected, 'two'); assert.equal(reads.length, 1)
  const refresh = session.refresh(); await session.refresh()
  assert.equal(reads.length, 2); assert.equal(session.snapshot().reading, true)
  ready(1, 'a', ['two', 'three']); await refresh
  assert.equal(session.snapshot().selected, 'two'); assert.equal(session.snapshot().lastRead, 1002)
  const changed = session.refresh(); ready(2, 'a', ['three']); await changed
  assert.equal(session.snapshot().selected, 'three')
})

test('unavailable and invalid same-root reads preserve the last valid snapshot visibly stale; confirmed deletion clears it', async () => {
  const { session, select, ready, reads } = fixture()
  session.connect(); select('a')
  ready(0, 'a', ['ok']); await setImmediate()
  const previous = session.snapshot()
  const partial = session.refresh(); reads[1]!.resolve({ ok: false, error: 'Arquivo incompleto.' }); await partial
  assert.equal(session.snapshot().status, 'stale'); assert.equal(session.snapshot().reports, previous.reports)
  assert.equal(session.snapshot().lastRead, previous.lastRead); assert.match(session.snapshot().error!, /incompleto/)
  const lost = session.refresh(); reads[2]!.reject(); await lost
  assert.equal(session.snapshot().status, 'stale'); assert.equal(session.snapshot().reports, previous.reports)
  const deleted = session.refresh(); reads[3]!.resolve({ ok: true, root: 'a', status: 'missing', reports: [] }); await deleted
  assert.equal(session.snapshot().status, 'missing'); assert.equal(session.snapshot().selected, null)
  assert.equal(session.snapshot().lastRead, null); assert.deepEqual(session.snapshot().reports, [])
  const later = session.refresh(); reads[4]!.reject(); await later
  assert.equal(session.snapshot().status, 'error'); assert.equal(reads.length, 5)
})

test('root changes, standalone, physical expiry and late receipts cannot publish a previous project', async () => {
  const { session, select, editor, ready, reads } = fixture()
  session.connect(); select('a'); ready(0, 'a', ['from-a']); await setImmediate()
  const old = session.refresh()
  select('b'); assert.deepEqual(session.snapshot().reports, []); assert.equal(session.snapshot().lastRead, null)
  ready(1, 'a', ['late-a']); await old
  assert.equal(session.snapshot().root, 'b'); assert.equal(session.snapshot().reading, true)
  select(null); ready(2, 'b', ['late-b']); await setImmediate()
  assert.equal(session.snapshot().root, null); assert.deepEqual(session.snapshot().reports, [])
  select('c'); ready(3, 'c', ['from-c']); await setImmediate()
  const expired = session.refresh(); reads[4]!.resolve({ ok: false, expired: true, error: 'Raiz expirada.' }); await expired
  assert.equal(session.snapshot().status, 'error'); assert.deepEqual(session.snapshot().reports, []); assert.equal(session.snapshot().lastRead, null)
  const mismatch = session.refresh(); ready(5, 'other', ['wrong']); await mismatch
  assert.deepEqual(session.snapshot().reports, []); assert.equal(session.snapshot().status, 'error')
  const beforeRevocation = session.refresh(); editor.change({ invalidRoot: 'c' })
  assert.equal(session.snapshot().root, null); editor.change({ invalidRoot: null })
  ready(6, 'c', ['obsolete']); await beforeRevocation; assert.deepEqual(session.snapshot().reports, [])
  assert.equal(reads.length, 7)
  select('d'); session.dispose(); ready(7, 'd', ['after-close']); await setImmediate()
  assert.equal(session.snapshot().root, null); assert.deepEqual(session.snapshot().reports, [])
})
