import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EPSILON } from '../src/shared/freeform/geometry.ts'
import { POLICY } from '../src/shared/freeform/policy.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import { initialWorkbench, LIMITS, WORKBENCH_KEY, widgetRegistry } from '../src/shared/workbench/model.ts'
import type { Registry, WorkbenchSnapshot } from '../src/shared/workbench/model.ts'
import { captureCurrentComposition, applyComposition } from '../src/shared/workbench/compositions.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { addWidget, removePresence } from '../src/shared/workbench/commands.ts'
import { groupWidgets, reorderGroup } from '../src/shared/workbench/groups.ts'
import { readWorkbench, writeWorkbench } from '../src/shared/workbench/storage.ts'
import { exportPortableComposition, importPortableComposition, parsePortableLayout, parsePortableText, portableDependencies, resolvePortableWidgets, serializePortableLayout } from '../src/shared/workbench/portable.ts'

const id = 'geppio.workspace-essentials', type = (name: string) => 'plugin:' + id + ':' + name
const installation = (): InstalledPlugin => ({ enabled: true, revision: randomUUID(), generation: randomUUID(),
  manifest: { schemaVersion: 1, apiVersion: 2, id, name: 'Private package display name', version: '1.0.2', entry: 'entry.js',
    widgets: ['notes', 'checklist'].map(id => ({ id, title: 'Private display ' + id, surface: 'declarative' })) } })
const firstPlugin = installation(), secondPlugin = installation()
const registry = widgetRegistry([firstPlugin]), destinationRegistry = widgetRegistry([secondPlugin]), none = new Set<string>()
function prepare(source: WorkbenchSnapshot, reg: Registry, name: string, region: 'main' | 'bottom' | 'sidebar') {
  const next = addWidget(source, reg, name, { ...source.reference[region], region, expanded: false })
  assert.ok(next); return next
}
function sourceFixture() {
  let scene = initialWorkbench()
  scene = prepare(scene, registry, type('notes'), 'main')
  scene = prepare(scene, registry, type('checklist'), 'main')
  scene = prepare(scene, registry, 'host:terminal', 'bottom')
  const [notes, checklist] = scene.organization.views
  scene = groupWidgets(scene, registry, checklist!.id, notes!.id)!
  const group = scene.organization.groups!.entries[0]!
  scene = reorderGroup(scene, group.id, checklist!.id, -1)!
  const saved = captureCurrentComposition(scene, 'Arranjo Δ', ['main', 'bottom'], true)
  saved.format[0]!.width -= 18
  const recipe = exportPortableComposition(saved, registry)
  return { saved, recipe, scene }
}
function destinationFixture() {
  let scene = initialWorkbench()
  for (const name of [type('notes'), type('checklist'), 'host:terminal']) {
    scene = prepare(scene, destinationRegistry, name, name === 'host:terminal' ? 'bottom' : 'main')
    scene = removePresence(scene, scene.organization.views.find(view => view.typeId === name)!.id)
  }
  return scene
}

test('portable round trip preserves distinct Format and Widgets geometry, public types and tab order; private identifiers stay local', () => {
  const { saved, recipe, scene } = sourceFixture(), text = serializePortableLayout(recipe)
  assert.deepEqual(parsePortableText(text), recipe)
  assert.notEqual(firstPlugin.revision, secondPlugin.revision)
  for (const value of [firstPlugin.revision, firstPlugin.generation!, firstPlugin.manifest.name, 'Private display', saved.id,
    scene.organization.groups!.entries[0]!.id, ...saved.views.flatMap(view => [view.id, view.modelId])]) assert.ok(!text.includes(value))
  assert.deepEqual(recipe.reference, { main: saved.reference.main, bottom: saved.reference.bottom })
  assert.equal(recipe.format[0]!.width, saved.format[0]!.width); assert.notEqual(recipe.format[0]!.width, recipe.placements[0]!.width)
  const destination = destinationFixture(), before = structuredClone(destination)
  const imported = importPortableComposition(destination, recipe, 'Reutilizada')
  assert.deepEqual(destination, before); assert.deepEqual(imported.views, []); assert.deepEqual(imported.placements, [])
  assert.ok(applyComposition(destination, destinationRegistry, imported, 'format')); assert.equal(applyComposition(destination, destinationRegistry, imported, 'widgets'), null)
  const resolved = resolvePortableWidgets(destination, destinationRegistry, imported, none, {}); assert.ok(resolved)
  const applied = applyComposition(destination, destinationRegistry, resolved, 'widgets'); assert.ok(applied)
  assert.equal(applied.organization.views.length, destination.organization.views.length)
  const group = applied.organization.groups!.entries[0]!
  assert.notEqual(group.id, scene.organization.groups!.entries[0]!.id)
  assert.deepEqual(group.members.map(member => applied.organization.views.find(view => view.id === member)!.typeId), [type('checklist'), type('notes')])
  assert.equal(applied.organization.views.find(view => view.id === group.active)!.typeId, type('checklist'))
  assert.deepEqual(applied.organization.bars, before.organization.bars)
  assert.deepEqual(parseWorkbench(serializeWorkbench(applied, destinationRegistry), destinationRegistry).organization.groups, applied.organization.groups)
  assert.deepEqual(exportPortableComposition(imported, widgetRegistry()), { ...recipe, name: imported.name })
})

test('unknown plugins are inert across restart; rebind against current enabled inventory and explicitly prepared destination instances', () => {
  const { recipe } = sourceFixture(), empty = initialWorkbench(), absent = widgetRegistry()
  const imported = importPortableComposition(empty, recipe, recipe.name)
  empty.organization.compositions = [imported]
  const raw = serializeWorkbench(empty, absent), stored = JSON.parse(raw)
  assert.equal(stored.schemaVersion, 3); assert.deepEqual(Object.keys(stored.organization.compositions[0]).sort(), ['id', 'name', 'portable'])
  const recovered = parseWorkbench(raw, absent), record = recovered.organization.compositions[0]!
  assert.deepEqual(recovered, empty)
  assert.ok(applyComposition(recovered, absent, record, 'format'))
  assert.ok(portableDependencies(recovered, absent, record, none).some(dep => dep.reason?.includes('ausente')))
  assert.equal(resolvePortableWidgets(recovered, absent, record, none, {}), null)
  assert.ok(portableDependencies(recovered, destinationRegistry, record, none).every(dep => dep.candidates.length === 0))
  assert.equal(resolvePortableWidgets(recovered, destinationRegistry, record, none, {}), null)
  const prepared = destinationFixture()
  assert.ok(resolvePortableWidgets(prepared, destinationRegistry, record, none, {}))
  assert.equal(resolvePortableWidgets(prepared, destinationRegistry, record, new Set(['plugin:' + id]), {}), null)
  const typed = structuredClone(prepared.organization.views[0]!)
  // Two retained local presentations share the host's canonical model binding.
  typed.id = typed.typeId + ':view:second-local'; prepared.organization.views.push(typed)
  assert.ok(parseWorkbench(serializeWorkbench(prepared, destinationRegistry), destinationRegistry))
  const dependency = portableDependencies(prepared, destinationRegistry, record, none).find(item => item.candidates.length === 2)!
  assert.ok(dependency); assert.equal(resolvePortableWidgets(prepared, destinationRegistry, record, none, {}), null)
  const chosen = { [dependency.key]: typed.id }
  assert.ok(resolvePortableWidgets(prepared, destinationRegistry, record, none, chosen)!.views.some(view => view.id === typed.id))
  assert.equal(resolvePortableWidgets(prepared, destinationRegistry, record, none, { extra: 'unknown' }), null)
  prepared.organization.views.pop()
  assert.equal(resolvePortableWidgets(prepared, destinationRegistry, record, none, chosen), null)
  const inSidebar = prepare(prepared, destinationRegistry, type('checklist'), 'sidebar')
  assert.equal(resolvePortableWidgets(inSidebar, destinationRegistry, record, none, {}), null)
})

test('a public multi-area type round-trips two presentations of one model and requires distinct destination choices', () => {
  const multi = new Map(registry), notes = type('notes')
  multi.set(notes, { ...multi.get(notes)!, presence: 'multiple-areas' })
  let source = prepare(initialWorkbench(), multi, notes, 'main')
  source = prepare(source, multi, notes, 'bottom')
  const saved = captureCurrentComposition(source, 'Two areas', ['main', 'bottom'], false)
  source.organization.compositions = [saved]
  const confirmed = parseWorkbench(serializeWorkbench(source, multi), multi).organization.compositions[0]!
  const recipe = parsePortableText(serializePortableLayout(exportPortableComposition(confirmed, multi)))
  assert.equal(recipe.views.length, 2)
  assert.deepEqual(recipe.views[0]!.ref, recipe.views[1]!.ref)
  const destination = prepare(prepare(initialWorkbench(), multi, notes, 'bottom'), multi, notes, 'main')
  const record = importPortableComposition(destination, recipe, recipe.name), before = structuredClone(destination)
  const deps = portableDependencies(destination, multi, record, none)
  assert.deepEqual(deps.map(dep => dep.candidates.length), [2, 2])
  const bottom = destination.placements.find(p => p.region === 'bottom')!.id
  const main = destination.placements.find(p => p.region === 'main')!.id
  assert.equal(resolvePortableWidgets(destination, multi, record, none, {}), null)
  assert.equal(resolvePortableWidgets(destination, multi, record, none, { v1: main, v2: main }), null)
  assert.deepEqual(destination, before)
  const resolved = resolvePortableWidgets(destination, multi, record, none, { v1: bottom, v2: main })
  assert.ok(resolved)
  const result = applyComposition(destination, multi, resolved, 'widgets')!
  assert.deepEqual(parseWorkbench(serializeWorkbench(result, multi), multi).placements.map(p => [p.id, p.region]),
    [[bottom, 'main'], [main, 'bottom']])
  assert.deepEqual(result.organization.views, before.organization.views)
  assert.equal(new Set(result.organization.views.map(v => v.modelId)).size, 1)
  const one = prepare(initialWorkbench(), multi, notes, 'main')
  assert.ok(portableDependencies(one, multi, record, none).every(dep => dep.reason))
  assert.ok(portableDependencies(destination, registry, record, none).every(dep => dep.reason))
  assert.equal(resolvePortableWidgets(destination, registry, record, none, { v1: main, v2: bottom }), null)
  const sameRegion = structuredClone(recipe)
  const first = sameRegion.placements[0]!, second = sameRegion.placements[1]!
  Object.assign(second, { ...first, view: second.view, x: first.x + first.width + POLICY.gap })
  assert.throws(() => parsePortableLayout(sameRegion))
})

test('expanded Main placements retain the native coordinate and vertical tolerance while Format stays inside its reference', () => {
  const scene = prepare(initialWorkbench(), registry, 'host:terminal', 'main')
  const saved = captureCurrentComposition(scene, 'Expanded', ['main'], false)
  const placed = saved.placements[0]!, bounds = saved.reference.main
  placed.x = bounds.width
  placed.y = bounds.height - placed.height + EPSILON / 2
  scene.organization.compositions = [saved]
  const stored = parseWorkbench(serializeWorkbench(scene, registry), registry).organization.compositions[0]!
  const recipe = exportPortableComposition(stored, registry)
  const record = importPortableComposition(scene, parsePortableText(serializePortableLayout(recipe)), recipe.name)
  const local = resolvePortableWidgets(scene, registry, record, none, {})
  assert.ok(local)
  assert.deepEqual(local.placements, saved.placements)
  assert.equal(recipe.format[0]!.x, saved.format[0]!.x)
  assert.throws(() => parsePortableLayout({ ...recipe, format: [{ ...recipe.format[0], x: bounds.width }] }))
  assert.throws(() => parsePortableLayout({ ...recipe, placements: [{ ...recipe.placements[0], x: POLICY.maxCoordinate }] }))
  assert.throws(() => parsePortableLayout({ ...recipe, placements: [{ ...recipe.placements[0], y: placed.y + 2 * EPSILON }] }))
})

test('closed format rejects unknown fields, foreign and repeated keys, private references, malformed geometry and groups', () => {
  const { recipe } = sourceFixture()
  for (const invalid of [
    { ...recipe, version: 2 }, { ...recipe, path: 'private' }, { ...recipe, name: 'x'.repeat(101) },
    { ...recipe, scopes: ['main', 'sidebar'] }, { ...recipe, scopes: ['main', 'main'] },
    { ...recipe, chrome: { ...recipe.chrome, sidebar: { visible: true } } },
    { ...recipe, reference: { ...recipe.reference, sidebar: { width: 253, height: 100 } } },
    { ...recipe, format: [{ ...recipe.format[0], key: 'source:view:main' }] },
    { ...recipe, format: [{ ...recipe.format[0], width: Infinity }] },
    { ...recipe, format: [{ ...recipe.format[0], x: -1 }] },
    { ...recipe, format: [recipe.format[0], { ...recipe.format[0], key: 's2' }] },
    { ...recipe, views: [{ key: 'v1', ref: { host: 'host:unknown' } }] },
    { ...recipe, views: [{ key: 'v1', ref: { pluginId: id, widgetId: 'notes', installation: 'foreign' } }] },
    { ...recipe, views: [...recipe.views, { ...recipe.views[0], key: 'v4' }] },
    { ...recipe, placements: [{ ...recipe.placements[0], view: 'v17' }] },
    { ...recipe, placements: [{ ...recipe.placements[0], preferred: { width: 4097, height: 70 } }] },
    { ...recipe, groups: [{ ...recipe.groups[0], active: 'source:id' }] },
    { ...recipe, groups: [{ ...recipe.groups[0], members: ['v1', 'v1'] }] },
    { ...recipe, views: recipe.views.map((view, i) => i === 1 ? { ...view, ref: recipe.views[0]!.ref } : view) },
    { ...recipe, groups: [...recipe.groups, recipe.groups[0]] }, { ...recipe, groups: [] },
    { ...recipe, mode: 'format' }
  ]) assert.throws(() => parsePortableLayout(invalid))
  const bytes = JSON.stringify(recipe)
  assert.throws(() => parsePortableText(' '.repeat(65536) + bytes))
  assert.throws(() => parsePortableText(bytes.replace('"version":1', '"version":2,"ver\\u0073ion":1')))
  assert.throws(() => parsePortableText(bytes.replace('"width":', '"width":1,"width":')))
})

test('v1/v2 historical reads preserve bytes; imported items use fresh local IDs, name suffixes and existing quota/CAS gates', () => {
  const { recipe } = sourceFixture(), empty = initialWorkbench(), reg = widgetRegistry()
  let bytes = serializeWorkbench(empty, reg), writes = 0
  const storage = { getItem: (key: string) => key === WORKBENCH_KEY ? bytes : null, setItem: (_: string, value: string) => { bytes = value; writes++ } }
  for (const schemaVersion of [1, 2]) {
    bytes = JSON.stringify({ ...JSON.parse(bytes), schemaVersion })
    const previous = bytes, read = readWorkbench(storage, reg)
    assert.equal(read.raw, previous); assert.equal(read.recovery, false); assert.equal(bytes, previous); assert.equal(writes, 0)
  }
  const first = importPortableComposition(empty, recipe, recipe.name)
  empty.organization.compositions.push(first)
  const again = importPortableComposition(empty, recipe, recipe.name)
  assert.notEqual(first.id, again.id); assert.equal(again.name, recipe.name + ' (2)')
  empty.organization.compositions.push(again)
  const stored = writeWorkbench(storage, empty, reg, bytes); assert.equal(stored.error, null)
  const previous = bytes; assert.equal(readWorkbench(storage, reg).recovery, false)
  assert.ok(writeWorkbench(storage, empty, reg, 'stale').error); assert.equal(bytes, previous)
  assert.throws(() => parseWorkbench(previous.replace('"schemaVersion":3', '"schemaVersion":2'), reg))
  const polluted = JSON.parse(previous); polluted.organization.compositions[0].views = []; assert.throws(() => parseWorkbench(JSON.stringify(polluted), reg))
  const many = structuredClone(empty)
  while (many.organization.compositions.length < LIMITS.compositions) many.organization.compositions.push(importPortableComposition(many, recipe, recipe.name))
  assert.throws(() => importPortableComposition(many, recipe, recipe.name))
  assert.ok(writeWorkbench(storage, many, reg, bytes).error); assert.equal(bytes, previous); assert.equal(writes, 1)
})
