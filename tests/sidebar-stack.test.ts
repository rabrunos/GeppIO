import test from 'node:test'
import assert from 'node:assert/strict'
import { activePlacements, initialWorkbench, sidebarInsertion, widgetRegistry, WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { WorkbenchSnapshot } from '../src/shared/workbench/model.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import { addWidget, moveView, removePresence, resizePair } from '../src/shared/workbench/commands.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { readWorkbench } from '../src/shared/workbench/storage.ts'
import { EditHistory } from '../src/shared/workbench/history.ts'

const plugin: InstalledPlugin = { enabled: true, revision: 'fixture', manifest: { schemaVersion: 1, apiVersion: 2,
  id: 'geppio.workspace-essentials', name: 'Workspace Essentials', version: '1.0.0', entry: 'index.js',
  widgets: ['notes', 'checklist', 'prompts', 'scratch'].map(id => ({ id, title: id, surface: 'declarative' })) } }
const registry = widgetRegistry([plugin]), type = (name: string) => `plugin:geppio.workspace-essentials:${name}`
const side = { region: 'sidebar' as const, width: 150, height: 500, expanded: false }
const main = { region: 'main' as const, width: 1500, height: 900, expanded: false }
const stack = (source: WorkbenchSnapshot) => activePlacements(source).filter(p => p.region === 'sidebar')
function scene() {
  let source = initialWorkbench()
  for (const name of ['notes', 'checklist', 'prompts']) source = addWidget(source, registry, type(name), side)!
  assert.ok(source)
  return source
}
function packed(source: WorkbenchSnapshot) {
  let y = 0
  for (const p of stack(source)) { assert.equal(p.y, y); y += p.height + 10 }
}

test('Workspace Essentials host eligibility is shared, narrowly scoped and independent of install revision', () => {
  for (const name of ['notes', 'checklist', 'prompts']) assert.deepEqual(registry.get(type(name))!.constraint.regions, ['main', 'sidebar', 'bottom'])
  assert.deepEqual(registry.get(type('scratch'))!.constraint.regions, ['main'])
  assert.equal(addWidget(initialWorkbench(), registry, type('scratch'), side), null)
  assert.equal(addWidget(initialWorkbench(), registry, type('notes'), { ...side, width: 149 }), null)
  const old = { ...plugin, revision: 'existing-installation', enabled: false }
  assert.deepEqual(widgetRegistry([old]).get(type('notes'))!.constraint, registry.get(type('notes'))!.constraint)
  const unrelated = widgetRegistry([{ ...plugin, manifest: { ...plugin.manifest, id: 'other.plugin' } }])
  assert.deepEqual(unrelated.get('plugin:other.plugin:notes')!.constraint.regions, ['main'])
})

test('legacy gaps project per-bar saved y order without startup writes or identity/height changes', () => {
  const source = scene(), ids = stack(source).map(p => p.id), bar = source.organization.bars[0]!
  bar.positions = { [type('notes')]: 1800, [type('checklist')]: 100, [type('prompts')]: 900 }
  for (const p of source.placements) p.y = bar.positions[source.organization.views.find(view => view.id === p.id)!.typeId]!
  source.reference.sidebar.height = 2400
  source.organization.bars.push({ ...structuredClone(bar), id: 'custom', name: 'Custom', positions: { [type('notes')]: 0, [type('checklist')]: 900, [type('prompts')]: 2000 } })
  const raw = serializeWorkbench(source, registry), writes: string[] = []
  const loaded = readWorkbench({ getItem: () => raw, setItem: (_key, value) => { writes.push(value) } }, registry)
  assert.equal(loaded.recovery, false); assert.deepEqual(writes, [])
  assert.deepEqual(JSON.parse(serializeWorkbench(loaded.snapshot, registry)), JSON.parse(raw))
  assert.deepEqual(stack(loaded.snapshot).map(p => p.id), [ids[1], ids[2], ids[0]])
  packed(loaded.snapshot)
  loaded.snapshot.organization.activeBar = 'custom'; packed(loaded.snapshot)
  assert.deepEqual(stack(loaded.snapshot).map(p => p.id), ids)
  assert.ok(stack(loaded.snapshot).every(p => p.height === 360))
})

test('pre-stack host layouts retain their original bytes and per-bar order in the compatibility fixture', () => {
  const legacyRegistry = widgetRegistry([], true), source = initialWorkbench(true)
  source.organization.bars[0]!.positions = { 'host:notes': 500, 'host:library': 40 }
  for (const p of source.placements) if (p.region === 'sidebar') p.y = p.id === 'notes' ? 500 : 40
  source.organization.bars.push({ id: 'old-custom', name: 'Old custom', userNamed: true, icon: 'notes', archived: false,
    members: ['host:notes', 'host:library'], positions: { 'host:notes': 40, 'host:library': 500 } })
  const raw = serializeWorkbench(source, legacyRegistry), before = structuredClone(source), writes: string[] = []
  const loaded = readWorkbench({ getItem: key => key === WORKBENCH_KEY ? raw : null, setItem: (_key, value) => { writes.push(value) } }, legacyRegistry)
  assert.equal(loaded.recovery, false); assert.equal(loaded.raw, raw); assert.deepEqual(writes, [])
  assert.deepEqual(stack(loaded.snapshot).map(p => [p.id, p.y, p.height]), [['library', 0, 230], ['notes', 240, 300]])
  loaded.snapshot.organization.activeBar = 'old-custom'
  assert.deepEqual(stack(loaded.snapshot).map(p => [p.id, p.y, p.height]), [['notes', 0, 300], ['library', 310, 230]])
  assert.deepEqual(source, before)
})

test('insertion/reorder/removal/pair resize and region/bar moves pack Home and custom independently', () => {
  const source = scene(), before = structuredClone(source), [a, b, c] = stack(source)
  assert.equal(sidebarInsertion(source, c!.id, 0).index, 0)
  let next = moveView(source, registry, c!.id, side, { x: 0, y: 0 })!
  assert.deepEqual(stack(next).map(p => p.id), [c!.id, a!.id, b!.id]); packed(next)
  next = moveView(next, registry, c!.id, side, { x: 0, y: 90000 })!
  assert.deepEqual(stack(next).map(p => p.id), [a!.id, b!.id, c!.id]); packed(next)
  next = resizePair(next, registry, { kind: 'resizePair', first: a!.id, second: b!.id, axis: 'y', delta: 47.5 })!
  assert.equal(stack(next)[0]!.height, 407.5); packed(next)
  assert.equal(resizePair(next, registry, { kind: 'resizePair', first: a!.id, second: b!.id, axis: 'y', delta: 10000 }), null)
  next.organization.bars.push({ id: 'custom', name: 'Custom', userNamed: true, icon: 'notes', archived: false, members: [], positions: {} })
  next.organization.activeBar = 'custom'
  next = moveView(next, registry, b!.id, side, { x: 0, y: 10000 }, 'home')!
  assert.deepEqual(stack(next).map(p => p.id), [b!.id]); packed(next)
  next.organization.activeBar = 'home'; packed(next)
  next = removePresence(next, a!.id); packed(next)
  assert.deepEqual(stack(next).map(p => p.id), [c!.id])
  next = moveView(next, registry, c!.id, main)!
  assert.equal(stack(next).length, 0)
  next = moveView(next, registry, c!.id, side)!
  assert.equal(stack(next)[0]!.height, c!.height); packed(next)
  const bottom = moveView(next, registry, c!.id, { ...main, region: 'bottom', height: 105 })!
  assert.ok(bottom)
  assert.equal(bottom.placements.find(p => p.id === c!.id)?.region, 'bottom')
  const returned = moveView(bottom, registry, c!.id, side)!
  assert.ok(returned, 'A minimum-height Bottom widget adapts to the Sidebar minimum on transfer')
  assert.equal(returned.placements.find(p => p.id === c!.id)?.height, 112)
  assert.equal(moveView(next, registry, c!.id, side, { x: 0, y: NaN }), null)
  assert.equal(addWidget(initialWorkbench(), registry, type('notes'), side, { x: 0, y: 0 }, undefined, { width: 149, height: 360 }), null)
  const restarted = parseWorkbench(serializeWorkbench(next, registry), registry)
  packed(restarted); restarted.organization.activeBar = 'custom'; packed(restarted)
  assert.deepEqual(source, before)
})

test('shared single-view Sidebar content cannot leave another bar dangling and absent positions use saved y', () => {
  const source = scene(), first = stack(source)[0]!
  source.organization.bars.push({ id: 'shared', name: 'Shared', userNamed: true, icon: 'notes', archived: false,
    members: [type('notes')], positions: { [type('notes')]: 900 } })
  assert.equal(moveView(source, registry, first.id, main), null)
  delete source.organization.bars[0]!.positions
  source.organization.bars[0]!.members.reverse()
  assert.deepEqual(stack(source).map(p => p.id), source.placements.filter(p => p.region === 'sidebar').map(p => p.id))
  packed(source)
})

test('one reorder is reversible through session history and codec retains saved clearance rejection', () => {
  const source = scene(), a = stack(source)[2]!, after = moveView(source, registry, a.id, side, { x: 0, y: 0 })!
  const history = new EditHistory(), before = { snapshot: source, slots: [], formatId: null }, next = { ...before, snapshot: after }
  history.record(before, next)
  assert.deepEqual(history.undo(next), before); assert.deepEqual(history.redo(before), next)
  const raw = JSON.parse(serializeWorkbench(source, registry))
  raw.organization.bars[0].positions[type('checklist')] = 1
  assert.throws(() => parseWorkbench(JSON.stringify(raw), registry), /clearance/)
})
