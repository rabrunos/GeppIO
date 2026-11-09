import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialWorkbench, widgetRegistry, constraintsForViews, LIMITS } from './fixtures/workbench.ts'
import type { LocalSessionState, UserBar, SessionSlot } from './fixtures/workbench.ts'
import { addWidget, updateBar, moveView } from '../src/shared/workbench/commands.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { projectRegion } from '../src/shared/freeform/projection.ts'
import { CONSTRAINTS, constraintsFor } from '../src/shared/freeform/policy.ts'
import { reflow } from '../src/shared/freeform/reflow.ts'
import { EditHistory, formatSignature } from '../src/shared/workbench/history.ts'
import { reduceNotifications } from '../src/shared/workbench/notifications.ts'
import { fillReservation } from '../src/shared/workbench/slots.ts'
import { captureComposition } from './fixtures/compositions.ts'

const registry = widgetRegistry()
const bar = (index: number, archived = false): UserBar => ({ id: `bar:${index}`, name: `Literal ${index}`, userNamed: true, icon: 'widgets', archived, members: [], positions: {} })

test('catalog drop fills only the current projected reservation, preserving sibling slots and other-area model presence', () => {
  const source = initialWorkbench(); source.placements = source.placements.filter(p => p.region !== 'main')
  const surface = { ...source.reference.main, region: 'main' as const, expanded: false }
  const slots: SessionSlot[] = [0, 1].map(i => ({ id: `slot:${i}`, region: 'main', x: i * 550, y: 0, width: 540, height: 774, reference: { width: 1567, height: 774 } }))
  const before = structuredClone(source), filled = fillReservation(source, registry, slots, 'slot:0', { ...surface, width: 1089 }, { kind: 'catalog', typeId: 'host:notes' })!
  assert.ok(filled); assert.deepEqual(filled.slots, [slots[1]])
  const placed = filled.snapshot.placements.find(p => p.region === 'main')!
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [0, 0, 540 / 1567 * 1089, 774])
  assert.equal(filled.snapshot.organization.views.find(v => v.id === placed.id)!.modelId, 'model:host:notes')
  assert.deepEqual(filled.snapshot.placements.find(p => p.id === 'notes'), source.placements.find(p => p.id === 'notes'))
  assert.deepEqual(source, before)
  const history = new EditHistory(), draft = { snapshot: source, slots, formatId: 'test' }, after = { ...draft, ...filled }
  history.begin(draft); history.finish(after)
  assert.deepEqual(history.undo(after), draft); assert.equal(history.canUndo, false)
  assert.deepEqual(history.redo(draft), after)
  history.begin(after); assert.deepEqual(history.abort(), after)
  assert.equal(fillReservation(filled.snapshot, registry, filled.slots, 'slot:0', surface, { kind: 'catalog', typeId: 'host:notes' }), null)
})

test('reserved drops reject incompatible, undersized, occupied, duplicate, paused and stale targets atomically', () => {
  const source = initialWorkbench(), before = structuredClone(source), surface = { ...source.reference.main, region: 'main' as const, expanded: false }
  const slot: SessionSlot = { id: 'slot', region: 'main', x: 0, y: 0, width: 540, height: 774, reference: surface }
  const catalog = { kind: 'catalog' as const, typeId: 'host:notes' }
  assert.equal(fillReservation(source, registry, [slot], slot.id, surface, catalog), null, 'An occupied rectangle cannot push its neighbours')
  source.placements = source.placements.filter(p => p.region !== 'main')
  assert.equal(fillReservation(source, registry, [{ ...slot, width: 100 }], slot.id, surface, catalog), null)
  assert.equal(fillReservation(source, registry, [slot], 'old-slot', surface, catalog), null)
  assert.equal(fillReservation(source, registry, [slot], slot.id, surface, catalog, new Set(['host'])), null)
  assert.equal(fillReservation(source, new Map(), [slot], slot.id, surface, { kind: 'move', viewId: 'notes', sourceBar: 'home' }), null, 'Removed plugin/type is revalidated on release')
  const filled = fillReservation(source, registry, [slot], slot.id, surface, catalog)!
  assert.equal(fillReservation(filled.snapshot, registry, [{ ...slot, x: 700 }], slot.id, surface, catalog), null, 'Duplicate presence cannot fall through to free insertion')
  const bottom = { ...source.reference.bottom, region: 'bottom' as const, expanded: false }
  assert.equal(fillReservation(source, registry, [{ ...slot, region: 'bottom', reference: bottom }], slot.id, bottom, { kind: 'catalog', typeId: 'host:queue' }), null)
  assert.deepEqual(before.organization, source.organization)
})

test('existing view exact transfer preserves identity and removes only legitimate source membership', () => {
  const source = initialWorkbench(); source.placements = source.placements.filter(p => p.region !== 'main')
  source.organization.bars.push({ ...bar(1), members: ['host:notes'], positions: { 'host:notes': 24 } })
  const surface = { ...source.reference.main, region: 'main' as const, expanded: false }
  const slot: SessionSlot = { id: 'slot', region: 'main', x: 24.5, y: 10, width: 500, height: 600, reference: surface }
  const intent = { kind: 'move' as const, viewId: 'notes', sourceBar: 'home' }, before = structuredClone(source)
  const filled = fillReservation(source, registry, [slot], slot.id, surface, intent)!
  assert.ok(filled); assert.deepEqual(filled.snapshot.organization.bars[1], source.organization.bars[1])
  assert.equal(filled.snapshot.organization.bars[0]!.members.includes('host:notes'), false)
  assert.ok(filled.snapshot.placements.some(p => p.id === 'notes' && p.region === 'sidebar'), 'Shared Sidebar view is retained for the other bar')
  const main = filled.snapshot.placements.find(p => p.region === 'main')!
  assert.equal(filled.snapshot.organization.views.find(v => v.id === main.id)!.modelId, 'model:host:notes')
  assert.deepEqual([main.x, main.y, main.width, main.height], [24.5, 10, 500, 600])
  assert.equal(fillReservation(source, registry, [slot], slot.id, surface, { ...intent, sourceBar: 'missing' }), null)
  assert.deepEqual(source, before)
  source.organization.bars.pop()
  const sole = fillReservation(source, registry, [slot], slot.id, surface, intent)!
  assert.equal(sole.snapshot.placements.find(p => p.region === 'main')!.id, 'notes', 'Unshared view retains its mounted identity')
})

test('Sidebar exact drop binds only its owning bar and reuses an existing shared view without duplicating IDs', () => {
  const source = initialWorkbench(); source.organization.bars.push(bar(1)); source.organization.activeBar = 'bar:1'
  const surface = { ...source.reference.sidebar, region: 'sidebar' as const, expanded: false }
  const slot: SessionSlot = { id: 'slot', region: 'sidebar', sidebarBar: 'bar:1', x: 0, y: 30, width: 253, height: 400, reference: surface }
  const filled = fillReservation(source, registry, [slot], slot.id, surface, { kind: 'catalog', typeId: 'host:notes' })!
  assert.ok(filled); assert.equal(new Set(filled.snapshot.placements.map(p => p.id)).size, filled.snapshot.placements.length)
  assert.deepEqual(filled.snapshot.organization.bars[0]!.members, source.organization.bars[0]!.members)
  assert.deepEqual(filled.snapshot.organization.bars[1]!.members, ['host:notes'])
  assert.equal(filled.snapshot.organization.bars[1]!.positions!['host:notes'], 0, 'Sidebar reservations retain height and owning bar while top-packing')
  assert.equal(fillReservation({ ...source, organization: { ...source.organization, activeBar: 'home' } }, registry, [slot], slot.id, surface, { kind: 'catalog', typeId: 'host:summary' }), null)
  const otherBar = { ...source, placements: [], organization: { ...source.organization, activeBar: 'home' } }
  assert.deepEqual(captureComposition(otherBar, 'Other bar', 'format', ['sidebar'], undefined, [slot]).format, [], 'Capturing another bar cannot adopt its hidden reservation')
})

test('fourteen new custom activations, independently bounded saved bars and lossless legacy twenty-bar editing', () => {
  const initial = initialWorkbench(); initial.organization.bars.push(...Array.from({ length: 13 }, (_, i) => bar(i)))
  const fourteen = updateBar(initial, bar(13))!; assert.ok(fourteen)
  assert.equal(fourteen.organization.bars.length, 15); assert.equal(updateBar(fourteen, bar(14)), null)
  const saved = updateBar(fourteen, bar(14, true))!; assert.ok(saved)
  assert.equal(updateBar(saved, bar(14)), null, 'Restoring is an activation too')
  const legacy = initialWorkbench(); legacy.organization.bars.push(...Array.from({ length: 20 }, (_, i) => bar(i)))
  const bytes = serializeWorkbench(legacy, registry)
  assert.deepEqual(parseWorkbench(bytes, registry), legacy)
  assert.equal(bytes, serializeWorkbench(legacy, registry), 'Reading never mutates the original legacy object or bytes')
  const edited = updateBar(legacy, { ...legacy.organization.bars[1]!, name: 'Edited Ω' })!
  assert.equal(edited.organization.bars.length, 21); assert.equal(legacy.organization.bars[1]!.name, 'Literal 0')
  assert.equal(updateBar(edited, bar(21)), null)
  assert.equal(updateBar(edited, { ...edited.organization.bars[1]!, archived: true })!.organization.bars.filter(item => !item.archived).length, 20)
  assert.ok(updateBar(edited, bar(21, true)), 'Saved cap remains independent of active capacity')
  assert.equal(LIMITS.activeBars, 14); assert.equal(LIMITS.savedBars, 100)
})

test('responsive host minima fit 150px Sidebar and 105px Bottom while legacy/Main constraints remain unchanged', () => {
  const source = initialWorkbench(), cs = constraintsForViews(source, registry)
  const sidebar = projectRegion(source, 'sidebar', { width: 150, height: 950 }, false, cs)
  const bottom = projectRegion(source, 'bottom', { width: 1543, height: 105 }, false, cs)
  assert.ok(sidebar.feasible && bottom.feasible)
  assert.ok(sidebar.placements.every(p => p.width === 150)); assert.equal(bottom.placements[0]!.height, 105)
  assert.equal(CONSTRAINTS.library!.min.width, 180); assert.equal(registry.get('host:properties')!.constraint.min.width, 240)
  const compact = { ...source, reference: { ...source.reference, sidebar: { width: 150, height: 950 }, bottom: { width: 1543, height: 105 } },
    placements: source.placements.map(p => { const projected = [...sidebar.placements, ...bottom.placements].find(q => q.id === p.id) ?? p; return { ...projected, preferred: { width: projected.width, height: projected.height } } }) }
  assert.ok(parseWorkbench(serializeWorkbench(compact, registry), registry))
  assert.ok(moveView(compact, registry, 'properties', { region: 'sidebar', width: 150, height: 950, expanded: false }))
  assert.equal(projectRegion(compact, 'sidebar', { width: 149, height: 950 }, false, cs).feasible, false)
  assert.equal(projectRegion(compact, 'bottom', { width: 1543, height: 104 }, false, cs).feasible, false)
})

test('reserved slot uses exact admitted geometry and leaves move resize rejection intact', () => {
  const source = initialWorkbench(); source.placements = source.placements.filter(p => p.region !== 'main')
  const before = structuredClone(source), surface = { ...source.reference.main, region: 'main' as const, expanded: false }
  const filled = addWidget(source, registry, 'host:notes', surface, { x: 0, y: 0 }, undefined, { width: 540.03, height: 774 })!
  assert.ok(filled)
  const p = filled.placements.find(p => p.region === 'main')!
  assert.deepEqual([p.x, p.y, p.width, p.height], [0, 0, 540.03, 774])
  assert.equal(filled.organization.views.find(v => v.id === p.id)!.modelId, 'model:host:notes')
  assert.equal(addWidget(source, registry, 'host:notes', surface, { x: 0, y: 0 }, undefined, { width: 100, height: 774 }), null)
  assert.equal(addWidget(filled, registry, 'host:notes', surface, { x: 0, y: 0 }, undefined, { width: 540.03, height: 774 }), null)
  assert.deepEqual(source, before)
  const wrong = reflow([p], p.id, { ...p, width: 600 }, surface, constraintsFor(surface, constraintsForViews(filled, registry)), 'move')
  assert.equal(wrong.status, 'blocked')
})

test('format signature excludes library metadata and active-bar visits, history includes typed local models without plugin state', () => {
  const source = initialWorkbench(); source.organization.bars.push(bar(1))
  const library = structuredClone(source); library.organization.activeBar = 'bar:1'; library.organization.favorites.reverse(); library.organization.defaultComposition = null; library.organization.compositionOrder = ['system:focus']
  assert.equal(formatSignature(library), formatSignature(source))
  library.organization.bars[1]!.name = 'Changed'; assert.notEqual(formatSignature(library), formatSignature(source))
  const local: LocalSessionState = { projectName: null, theme: 'dark', snap: true, properties: { name: 'Literal Ω', density: 'compact', details: true } }
  const before = { snapshot: source, slots: [], formatId: null, localState: local }, after = { ...before, localState: { ...local, theme: 'light' as const, properties: { ...local.properties, name: 'Edited Ω' } } }
  const history = new EditHistory(); history.record(before, after)
  assert.deepEqual(history.undo(after), before); assert.deepEqual(history.redo(before), after)
  const sessionOnly = { ...source, localState: after.localState }
  assert.equal(serializeWorkbench(sessionOnly, registry).includes('localState'), false, 'Session metadata never becomes an implicit codec extension')
})

test('notification inventory is bounded and supports individual/all read, dismiss and clear with no initial sample items', () => {
  let items = reduceNotifications([], { type: 'clear' }); assert.deepEqual(items, [])
  for (let i = 0; i < 25; i++) items = reduceNotifications(items, { type: 'add', item: { id: `n:${i}`, title: 'Plugin instalado', message: '“{0}”', params: ['Literal Ω'], at: i, read: false } })
  assert.equal(items.length, 20); assert.equal(items[0]!.id, 'n:24')
  items = reduceNotifications(items, { type: 'read', id: 'n:24' }); assert.equal(items.filter(item => !item.read).length, 19)
  items = reduceNotifications(items, { type: 'read' }); assert.ok(items.every(item => item.read))
  items = reduceNotifications(items, { type: 'dismiss', id: 'n:24' }); assert.equal(items.length, 19)
  assert.deepEqual(reduceNotifications(items, { type: 'clear' }), [])
})
