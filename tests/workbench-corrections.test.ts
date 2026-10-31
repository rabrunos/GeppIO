import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialWorkbench, widgetRegistry, constraintsForViews, LIMITS } from '../src/shared/workbench/model.ts'
import type { LocalSessionState, UserBar } from '../src/shared/workbench/model.ts'
import { addWidget, updateBar, moveView } from '../src/shared/workbench/commands.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { projectRegion } from '../src/shared/freeform/projection.ts'
import { CONSTRAINTS, constraintsFor } from '../src/shared/freeform/policy.ts'
import { reflow } from '../src/shared/freeform/reflow.ts'
import { EditHistory, formatSignature } from '../src/shared/workbench/history.ts'
import { reduceNotifications } from '../src/shared/workbench/notifications.ts'

const registry = widgetRegistry()
const bar = (index: number, archived = false): UserBar => ({ id: `bar:${index}`, name: `Literal ${index}`, userNamed: true, icon: 'widgets', archived, members: [], positions: {} })

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
