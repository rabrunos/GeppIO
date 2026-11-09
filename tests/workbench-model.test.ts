import test from 'node:test'
import assert from 'node:assert/strict'
import { constraintsFor, DEFAULT_FREEFORM, FREEFORM_KEY } from '../src/shared/freeform/policy.ts'
import { validLayout } from '../src/shared/freeform/geometry.ts'
import { widgetRegistry, adoptLayout, activePlacements, constraintsForViews, evaluatePlacement, initialWorkbench, modelId, WORKBENCH_KEY } from './fixtures/workbench.ts'
import { serializeWorkbench, parseWorkbench } from '../src/shared/workbench/codec.ts'
import { readWorkbench, writeWorkbench } from '../src/shared/workbench/storage.ts'
import { addWidget, moveView, removePresence, resizePair, updateBar, deleteBar, swapViews } from '../src/shared/workbench/commands.ts'
import { EditHistory } from '../src/shared/workbench/history.ts'
import { applyComposition, captureComposition, compositionOrder, compositionSlots, favoriteComposition, projectSessionSlot, reorderComposition, systemCompositions } from './fixtures/compositions.ts'
import { defaultChrome, parseChrome } from '../src/shared/workbench/chrome.ts'

const registry = widgetRegistry([{ enabled: false, revision: 'test', manifest: { schemaVersion: 1, apiVersion: 1,
  id: 'local.counter', name: 'Counter', version: '1.0.0', entry: 'index.js', widgets: [{ id: 'counter', title: 'Counter', surface: 'declarative' }] } }])
const copy = () => adoptLayout(DEFAULT_FREEFORM)

test('one catalog policy applies the view cap while allowing an existing model/view to be reused', () => {
  const source = initialWorkbench()
  for (let i = 0; i < 9; i++) source.organization.views.push({ id: `host:notes:view:unused${i}`, typeId: 'host:notes', modelId: modelId('host:notes') })
  assert.equal(parseWorkbench(serializeWorkbench(source, registry), registry).organization.views.length, 16)
  assert.deepEqual(evaluatePlacement(source, registry, 'plugin:local.counter:counter', 'main', 'catalog'), { allowed: false, reason: 'limit' })
  assert.equal(addWidget(source, registry, 'plugin:local.counter:counter', { ...source.reference.main, region: 'main', expanded: false }), null)
  assert.equal(evaluatePlacement(source, registry, 'host:notes', 'main', 'catalog').allowed, true, 'A hidden view of the shared model can be reused at capacity')
  source.organization.views.pop()
  assert.equal(evaluatePlacement(source, registry, 'plugin:local.counter:counter', 'main', 'catalog').allowed, true)
})

test('catalog insertion uses bounded continuous push/compression when the region has no vacant seed', () => {
  const source = initialWorkbench(), surface = { region: 'main' as const, width: 1000, height: 620, expanded: false }
  source.reference.main = { width: 1000, height: 620 }
  source.placements = source.placements.map(p => p.region !== 'main' ? p : { ...p, x: ['queue', 'activity'].includes(p.id) ? 505 : 0, y: ['properties', 'activity'].includes(p.id) ? 315 : 0, width: 495, height: 305, preferred: { width: 495, height: 305 } })
  const before = structuredClone(source), next = addWidget(source, registry, 'plugin:local.counter:counter', surface)
  assert.ok(next, 'A free seed is not required when the real solver can make room')
  assert.equal(next.placements.length, source.placements.length + 1)
  assert.ok(validLayout(next.placements.filter(p => p.region === 'main'), surface, constraintsFor(surface, constraintsForViews(next, registry))))
  assert.deepEqual(source, before)
  const packed = structuredClone(source)
  packed.reference.main = { width: 510, height: 160 }
  packed.placements = packed.placements.filter(p => p.region !== 'main' || ['summary', 'queue'].includes(p.id)).map(p => p.region !== 'main' ? p : { ...p, x: p.id === 'summary' ? 0 : 250, y: 0, width: p.id === 'summary' ? 240 : 260, height: 160, preferred: { width: p.id === 'summary' ? 240 : 260, height: 160 } })
  const packedBefore = structuredClone(packed)
  assert.equal(addWidget(packed, registry, 'plugin:local.counter:counter', { ...surface, width: 510, height: 160 }), null)
  assert.deepEqual(packed, packedBefore)
})

test('format slots project from their own session reference without accumulating viewport changes or entering storage', () => {
  const source = initialWorkbench(), composition = systemCompositions()[0]!
  const slots = compositionSlots(composition, { ...source, placements: [] })
  const original = structuredClone(slots[0]!)
  const narrow = projectSessionSlot(original, { width: 700, height: 500 })
  assert.deepEqual(projectSessionSlot(narrow, original.reference), original)
  assert.deepEqual(slots[0], original)
  const raw = serializeWorkbench({ ...source, slots } as typeof source, registry)
  assert.ok(!('slots' in JSON.parse(raw).layout))
  const saved = parseWorkbench(raw, registry)
  assert.ok(!('slots' in saved))
  const empty = { ...source, placements: source.placements.filter(p => p.region === 'sidebar') }
  const reusable = captureComposition(empty, 'Empty format', 'format', ['main', 'bottom'], undefined, slots)
  empty.organization.compositions.push(reusable)
  const recovered = parseWorkbench(serializeWorkbench(empty, registry), registry).organization.compositions[0]!
  assert.equal(recovered.format.length, slots.length)
  assert.equal(recovered.placements.length, 0); assert.equal(recovered.views.length, 0)
  assert.ok(recovered.format.every(slot => !('reference' in slot)), 'Only reusable format geometry enters the library, never session reference or executable slot identity')
  for (const id of ['system:default', 'system:focus', 'composition:']) {
    const spoofed = JSON.parse(serializeWorkbench(empty, registry)); spoofed.organization.compositions[0].id = id
    assert.throws(() => parseWorkbench(JSON.stringify(spoofed), registry), /Invalid saved composition/, 'Imported records cannot replace a protected system composition')
  }
  const invalid = captureComposition(source, 'Sidebar format', 'format', ['sidebar'])
  source.organization.compositions.push(invalid)
  assert.throws(() => serializeWorkbench(source, registry), /scopes/)
})
test('dynamic qualified views validate without changing legacy identities or executable metadata', () => {
  const snapshot = copy()
  snapshot.placements = []
  snapshot.organization.views.push({ id: 'plugin:local.counter:counter:view:main', typeId: 'plugin:local.counter:counter', modelId: modelId('plugin:local.counter:counter') })
  const parsed = parseWorkbench(serializeWorkbench(snapshot, registry), registry)
  assert.deepEqual(parsed, snapshot)
  assert.throws(() => parseWorkbench(serializeWorkbench(snapshot, registry), widgetRegistry()), /Unknown/)
  const tampered = JSON.parse(serializeWorkbench(snapshot, registry))
  tampered.organization.views.at(-1).id = 'counter'
  assert.throws(() => parseWorkbench(JSON.stringify(tampered), registry), /Unqualified/)
  for (const change of [
    (value: typeof tampered) => { value.organization.views[0].modelId = 'model:other' },
    (value: typeof tampered) => { value.organization.bars[0].archived = true },
    (value: typeof tampered) => { value.organization.bars[0].members = ['plugin:local.counter:counter'] },
    (value: typeof tampered) => { value.organization.activeBar = 'unknown' },
    (value: typeof tampered) => { value.organization.favorites = ['unknown'] },
    (value: typeof tampered) => { value.organization.defaultComposition = 'composition:missing' },
    (value: typeof tampered) => { value.organization.views.push(value.organization.views[0]) }
  ]) { const value = JSON.parse(serializeWorkbench(copy(), registry)); change(value); assert.throws(() => parseWorkbench(JSON.stringify(value), registry)) }
  assert.throws(() => parseWorkbench(' '.repeat(65537), registry))
})
test('adoption is explicit; old freeform bytes survive successful CAS, quota, corruption and concurrent adoption', () => {
  const values = new Map<string, string>([[FREEFORM_KEY, JSON.stringify(DEFAULT_FREEFORM)]]), writes: string[] = []
  const storage = { getItem(key: string) { return values.get(key) ?? null }, setItem(key: string, value: string) { writes.push(key); values.set(key, value) } }
  const initial = readWorkbench(storage, registry), legacy = storage.getItem(FREEFORM_KEY)
  assert.equal(initial.recovery, true); assert.deepEqual(writes, [])
  assert.equal(writeWorkbench(storage, initial.snapshot, registry, null, initial.previous).error, null)
  assert.deepEqual(writes, [WORKBENCH_KEY]); assert.equal(storage.getItem(FREEFORM_KEY), legacy)
  const saved = storage.getItem(WORKBENCH_KEY)
  assert.ok(writeWorkbench(storage, initial.snapshot, registry, null).error)
  assert.ok(writeWorkbench({ getItem: storage.getItem, setItem() { throw new Error('Quota') } }, initial.snapshot, registry, saved).error)
  assert.equal(storage.getItem(WORKBENCH_KEY), saved)
  values.delete(WORKBENCH_KEY); values.set(FREEFORM_KEY, 'concurrent source')
  assert.ok(writeWorkbench(storage, initial.snapshot, registry, null, initial.previous).error)
  assert.equal(values.has(WORKBENCH_KEY), false)
  values.set(WORKBENCH_KEY, '{broken')
  assert.equal(readWorkbench(storage, registry).recovery, true); assert.equal(storage.getItem(WORKBENCH_KEY), '{broken')
})
test('Sidebar memberships are independent; reuse shares a model and never duplicates a plugin runtime', () => {
  let snapshot = copy(); snapshot.placements = []
  snapshot = addWidget(snapshot, registry, 'host:notes', { region: 'sidebar', width: 250, height: 600, expanded: false })!
  assert.ok(snapshot)
  snapshot = updateBar(snapshot, { id: 'bar:two', name: 'Foco', userNamed: true, icon: 'notes', archived: false, members: [] })!
  snapshot.organization.activeBar = 'bar:two'
  snapshot = addWidget(snapshot, registry, 'host:notes', { region: 'sidebar', width: 250, height: 600, expanded: false })!
  assert.equal(snapshot.placements.length, 1)
  assert.deepEqual(snapshot.organization.bars.map(bar => bar.members), [['host:notes'], ['host:notes']])
  const next = removePresence(snapshot, snapshot.placements[0]!.id)
  assert.equal(next.placements.length, 1); assert.deepEqual(next.organization.bars.map(bar => bar.members), [['host:notes'], []])
  assert.equal(addWidget(snapshot, registry, 'plugin:local.counter:counter', { region: 'bottom', width: 700, height: 150, expanded: false }), null)
  assert.equal(addWidget(snapshot, registry, 'plugin:local.counter:counter', { region: 'main', width: 700, height: 600, expanded: false }, undefined, new Set(['plugin:local.counter'])), null)
  assert.equal(deleteBar(snapshot, 'home'), null); assert.equal(deleteBar(snapshot, 'bar:two'), null)
  const archived = updateBar(snapshot, { ...snapshot.organization.bars[1]!, archived: true })!
  assert.equal(archived.organization.activeBar, 'home'); assert.ok(deleteBar(archived, 'bar:two'))
})
test('shared single-view Sidebar membership cannot become a dangling reference through move, swap or import', () => {
  const sidebar = moveView(initialWorkbench(), registry, 'summary', { region: 'sidebar', width: 253, height: 950, expanded: false }, { x: 0, y: 600 })!
  assert.ok(sidebar)
  const shared = updateBar(sidebar, { id: 'bar:shared', name: 'Shared', userNamed: true, icon: 'folder', archived: false, members: ['host:summary'], positions: { 'host:summary': 600 } })!
  const before = structuredClone(shared), main = { region: 'main' as const, ...shared.reference.main, expanded: false }
  assert.doesNotThrow(() => serializeWorkbench(shared, registry))
  assert.equal(evaluatePlacement(shared, registry, 'host:summary', 'main', 'catalog').allowed, false)
  assert.equal(moveView(shared, registry, 'summary', main), null)
  assert.equal(swapViews(shared, registry, 'summary', 'properties'), null)
  assert.deepEqual(shared, before)
  const raw = JSON.parse(serializeWorkbench(shared, registry)); raw.layout.placements = raw.layout.placements.filter((p: { id: string }) => p.id !== 'summary')
  assert.throws(() => parseWorkbench(JSON.stringify(raw), registry), /Missing Sidebar membership view/)
  const oneBar = updateBar(shared, { ...shared.organization.bars[1]!, members: [], positions: {} })!
  const moved = moveView(oneBar, registry, 'summary', main)
  assert.ok(moved); assert.doesNotThrow(() => serializeWorkbench(moved, registry))
})

test('coupled divider is bilateral and atomic, rejects nonadjacent/cross-axis/minimum failures', () => {
  const snapshot = copy()
  snapshot.placements = snapshot.placements.filter(p => ['summary', 'chart'].includes(p.id))
  snapshot.placements[0] = { ...snapshot.placements[0]!, x: 0, y: 0, width: 230, height: 140 }
  snapshot.placements[1] = { ...snapshot.placements[1]!, x: 240, y: 0, width: 230, height: 140 }
  const before = structuredClone(snapshot)
  const resized = resizePair(snapshot, registry, { kind: 'resizePair', first: 'summary', second: 'chart', axis: 'x', delta: 20.125 })!
  assert.ok(resized); assert.equal(resized.placements[0]!.width, 250.125); assert.equal(resized.placements[1]!.x, 260.125)
  assert.equal(resized.placements[1]!.x + resized.placements[1]!.width, 470)
  assert.equal(resizePair(snapshot, registry, { kind: 'resizePair', first: 'summary', second: 'chart', axis: 'x', delta: 200 }), null)
  assert.equal(resizePair(snapshot, registry, { kind: 'resizePair', first: 'summary', second: 'chart', axis: 'y', delta: 2 }), null)
  assert.deepEqual(snapshot, before)
  const swapped = swapViews(snapshot, registry, 'summary', 'chart')!
  assert.ok(swapped); assert.equal(swapped.placements[0]!.x, 240)
  assert.equal(validLayout(swapped.placements, { region: 'main', width: 960, height: 620, expanded: false }, Object.fromEntries(swapped.organization.views.map(v => [v.id, registry.get(v.typeId)!.constraint]))), true)
})
test('session history records complete intentions including transient slots, branching and cancellation', () => {
  const history = new EditHistory(), before = { snapshot: copy(), slots: [], formatId: null }
  const after = { ...structuredClone(before), formatMode: 'format' as const, slots: [{ id: 'slot:1', region: 'main' as const, x: 0, y: 0, width: 250, height: 200, reference: { width: 960, height: 620 } }] }
  history.begin(before); assert.equal(history.canUndo, false); history.finish(after)
  assert.deepEqual(history.undo(after), before); assert.deepEqual(history.redo(before), after)
  history.undo(after); history.record(before, { ...after, formatId: 'format:two' }); assert.equal(history.canRedo, false)
  history.begin(after); assert.deepEqual(history.abort(), after); assert.equal(history.active, false)
})

test('Sidebar swaps use the active bar positions and preserve other memberships sharing the model', () => {
  const snapshot = initialWorkbench()
  snapshot.organization.bars.push({ id: 'bar:other', name: 'Outra', userNamed: true, icon: 'notes', archived: false, members: ['host:notes'], positions: { 'host:notes': 700 } })
  const swapped = swapViews(snapshot, registry, 'notes', 'summary')!
  assert.ok(swapped)
  assert.equal(swapped.placements.find(p => p.id === 'notes')!.region, 'main')
  assert.equal(activePlacements(swapped).find(p => p.id === 'summary')!.y, 0)
  const other = { ...swapped, organization: { ...swapped.organization, activeBar: 'bar:other' } }
  const retained = activePlacements(other).find(p => p.region === 'sidebar')!
  assert.equal(retained.y, 0, 'Each bar projects its own top-packed stack')
  assert.equal(other.organization.bars[1]!.positions!['host:notes'], 700, 'Projection preserves the saved recovery source')
  assert.equal(other.organization.views.find(view => view.id === retained.id)!.modelId, 'model:host:notes')
  assert.doesNotThrow(() => serializeWorkbench(swapped, registry))
  assert.equal(snapshot.organization.views.length, 7)
})

test('composition orders include system records and remain independent with bounded validated IDs', () => {
  const snapshot = initialWorkbench(), before = structuredClone(snapshot.organization.favorites)
  const moved = reorderComposition(snapshot, 'system:balanced', 'system:default')!
  assert.deepEqual(compositionOrder(moved), ['system:balanced', 'system:default', 'system:focus'])
  assert.deepEqual(moved.organization.favorites, before)
  const favorite = reorderComposition(moved, 'system:focus', 'system:default', true)!
  assert.deepEqual(compositionOrder(favorite), compositionOrder(moved))
  assert.deepEqual(favorite.organization.favorites, ['system:focus', 'system:default', 'system:balanced'])
  assert.deepEqual(parseWorkbench(serializeWorkbench(favorite, registry), registry), favorite)
  assert.equal(reorderComposition(favorite, 'missing', null), null)
  const raw = JSON.parse(serializeWorkbench(favorite, registry))
  raw.organization.compositionOrder.push('system:focus')
  assert.throws(() => parseWorkbench(JSON.stringify(raw), registry), /Duplicate/)
  raw.organization.compositionOrder = ['host:missing']
  assert.throws(() => parseWorkbench(JSON.stringify(raw), registry), /Invalid composition order/)
})

test('confirmed chrome is bounded host state and composition patches preserve omitted regions', () => {
  const snapshot = initialWorkbench(), original = structuredClone(snapshot)
  const chrome = { sidebar: { visible: false, size: 238 }, bottom: { visible: false, size: 200 } }
  snapshot.organization.chrome = chrome
  assert.deepEqual(parseWorkbench(serializeWorkbench(snapshot, registry), registry).organization.chrome, chrome)
  for (const invalid of [{ sidebar: { visible: true, size: 179 }, bottom: chrome.bottom }, { ...chrome, bottom: { visible: true, size: Infinity } }, { ...chrome, main: { size: 3 } }]) assert.throws(() => parseChrome(invalid))
  const widthOnly = captureComposition(snapshot, 'Largura literal', 'format', [], { sidebar: { size: 310 } })
  snapshot.organization.compositions.push(widthOnly)
  assert.doesNotThrow(() => serializeWorkbench(snapshot, registry))
  const applied = applyComposition(snapshot, registry, widthOnly, 'format')!
  assert.deepEqual(applied.placements, snapshot.placements)
  assert.deepEqual(applied.organization.bars, snapshot.organization.bars)
  assert.deepEqual(applied.organization.chrome, { sidebar: { visible: false, size: 310 }, bottom: chrome.bottom })
  for (const preset of systemCompositions()) {
    assert.ok(preset.views.every(view => registry.has(view.typeId)))
    assert.ok(applyComposition(original, registry, preset, 'widgets'))
  }
  assert.deepEqual(defaultChrome(), original.organization.chrome)
})

test('session history has a bounded intention count', () => {
  const history = new EditHistory(), state = { snapshot: copy(), slots: [], formatId: null }
  for (let i = 0; i < 300; i++) history.record({ ...state, formatId: String(i) }, { ...state, formatId: String(i + 1) })
  let count = 0
  while (history.canUndo) { history.undo(state); count++ }
  assert.equal(count, 256)
})
test('bar-specific positions can overlap across separate bars, never within one bar', () => {
  const snapshot = copy()
  snapshot.reference.sidebar = { width: 253, height: 950 }
  snapshot.placements = snapshot.placements.filter(p => ['notes', 'library'].includes(p.id)).map(p => ({ ...p, region: 'sidebar', x: 0, y: 0, width: 253 }))
  snapshot.organization.bars = [
    { id: 'home', name: 'Ferramentas', userNamed: false, icon: 'home', archived: false, members: ['host:notes'], positions: { 'host:notes': 0 } },
    { id: 'bar:other', name: 'Foco', userNamed: true, icon: 'notes', archived: false, members: ['host:library'], positions: { 'host:library': 0 } }
  ]
  assert.deepEqual(parseWorkbench(serializeWorkbench(snapshot, registry), registry), snapshot)
  assert.equal(activePlacements(snapshot).length, 1)
  snapshot.organization.activeBar = 'bar:other'
  assert.equal(activePlacements(snapshot)[0]!.id, 'library')
  snapshot.organization.bars[1]!.members.push('host:notes'); snapshot.organization.bars[1]!.positions!['host:notes'] = 0
  assert.throws(() => serializeWorkbench(snapshot, registry), /clearance/)
})
test('compositions preserve omitted regions and reject invalid formats; favorites have a transactional nine-item cap', () => {
  const snapshot = initialWorkbench(), before = structuredClone(snapshot)
  const composition = captureComposition(snapshot, 'Foco', 'format-widgets', ['main'])
  const restored = applyComposition(snapshot, registry, composition, 'widgets')!
  assert.ok(restored); assert.deepEqual(restored.placements.filter(p => p.region !== 'main'), snapshot.placements.filter(p => p.region !== 'main'))
  const format = captureComposition(snapshot, 'Nome literal', 'format', ['main'])
  assert.deepEqual(format.placements, []); assert.deepEqual(format.views, [])
  snapshot.organization.compositions.push(format)
  assert.equal(parseWorkbench(serializeWorkbench(snapshot, registry), registry).organization.compositions[0]!.name, 'Nome literal')
  const invalid = structuredClone(snapshot); invalid.organization.compositions[0]!.format.push({ ...format.format[0]!, id: 'format:overlap' })
  assert.throws(() => serializeWorkbench(invalid, registry), /Overlapping/)
  let next = before
  for (let i = 0; i < 7; i++) {
    const record = { ...format, id: `composition:${i}`, name: String(i) }
    next = { ...next, organization: { ...next.organization, compositions: [...next.organization.compositions, record] } }
    const favorite = favoriteComposition(next, record.id, true)
    if (i < 6) { assert.ok(favorite); next = favorite }
    else assert.equal(favorite, null)
  }
  const replaced = favoriteComposition(next, 'composition:6', true, true, 'system:default')!
  assert.equal(replaced.organization.favorites.length, 9); assert.equal(replaced.organization.defaultComposition, 'composition:6')
  const removed = favoriteComposition(replaced, 'composition:6', false)!
  assert.equal(removed.organization.defaultComposition, null)
  assert.equal(systemCompositions().every(record => record.system), true)
})
