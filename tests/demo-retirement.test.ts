import test from 'node:test'
import assert from 'node:assert/strict'
import { initialWorkbench, widgetRegistry, WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { initialWorkbench as demoWorkbench, widgetRegistry as demoRegistry } from './fixtures/workbench.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { readWorkbench, writeWorkbench } from '../src/shared/workbench/storage.ts'
import { addWidget } from '../src/shared/workbench/commands.ts'
import { applyComposition, captureCurrentComposition, systemCompositions } from '../src/shared/workbench/compositions.ts'
import { changePresentation } from '../src/shared/workbench/presentations.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import type { WorkbenchSnapshot } from '../src/shared/workbench/model.ts'
import { resetWorkbench } from '../src/shared/workbench/retirement.ts'
import { DEFAULT_FREEFORM, FREEFORM_KEY } from '../src/shared/freeform/policy.ts'

const plugin: InstalledPlugin = { enabled: true, revision: 'test', manifest: { schemaVersion: 1, apiVersion: 1,
  id: 'test.counter', name: 'Counter', version: '1.0.0', entry: 'entry.js', widgets: [{ id: 'counter', title: 'Counter', surface: 'declarative' }] } }
const registry = widgetRegistry([plugin]), fixtures = demoRegistry([plugin])
const surface = { region: 'main' as const, width: 1567, height: 774, expanded: false }
function upgraded() {
  let source: WorkbenchSnapshot = changePresentation(demoWorkbench(), { presentation: 'overlay', anchor: 'left' }, fixtures)
  source.organization.bars.push({ id: 'bar:custom', name: 'Minha barra', userNamed: true, icon: 'notes', archived: true, members: ['host:notes'], positions: { 'host:notes': 42 } })
  source.organization.compositions.push(captureCurrentComposition(source, 'Meu layout', ['main', 'bottom'], true))
  source = addWidget(source, fixtures, 'plugin:test.counter:counter', { ...surface, expanded: true }, { x: 1700, y: 0 })!
  return source
}
test('normal startup/presets are empty and retired types cannot be placed', () => {
  assert.equal(initialWorkbench().placements.length, 0)
  assert.equal(readWorkbench({ getItem: () => null, setItem() { throw Error('Unexpected write') } }, registry).recovery, false)
  for (const type of registry.values()) if (type.fixture) assert.equal(addWidget(initialWorkbench(), registry, type.id, surface), null)
  for (const preset of systemCompositions()) {
    assert.deepEqual(preset.views, []); assert.deepEqual(preset.placements, [])
    assert.deepEqual(applyComposition(initialWorkbench(), registry, preset, 'widgets')!.placements, [])
  }
  assert.ok(addWidget(initialWorkbench(), registry, 'plugin:test.counter:counter', surface))
})
test('alpha.19 demos retire only after full validation; plugin and user records survive guarded save/restart', () => {
  const old = upgraded(), original = serializeWorkbench(old, fixtures), data = new Map([[WORKBENCH_KEY, original], ['plugin:state', 'preserved']])
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const read = readWorkbench(storage, registry)
  assert.equal(read.recovery, false); assert.equal(data.get(WORKBENCH_KEY), original)
  assert.deepEqual(read.snapshot.placements, old.placements.filter(p => p.id.startsWith('plugin:')))
  assert.equal(read.snapshot.organization.presentations!.entries.length, 0)
  assert.equal(read.snapshot.retiredDemos!.views.length, 7)
  assert.deepEqual(read.snapshot.retiredDemos!.placements, old.placements.filter(p => !p.id.startsWith('plugin:')))
  assert.equal(read.snapshot.organization.bars[1]!.name, 'Minha barra'); assert.equal(read.snapshot.organization.bars[1]!.archived, true)
  assert.deepEqual(read.snapshot.organization.bars[1]!.members, [])
  assert.deepEqual(read.snapshot.organization.compositions, old.organization.compositions)
  for (const mode of ['format', 'widgets'] as const) {
    const applied = applyComposition(read.snapshot, registry, old.organization.compositions[0]!, mode)!
    assert.ok(applied); assert.ok(applied.placements.every(p => p.id.startsWith('plugin:')))
  }
  const saved = writeWorkbench(storage, read.snapshot, registry, original)
  assert.equal(saved.error, null)
  const restart = readWorkbench(storage, registry)
  assert.equal(restart.recovery, false); assert.deepEqual(restart.snapshot, read.snapshot)
  assert.equal(data.get('plugin:state'), 'preserved')
  const reset = resetWorkbench(restart.snapshot)
  assert.deepEqual(reset.organization.bars, restart.snapshot.organization.bars)
  assert.deepEqual(reset.organization.compositions, restart.snapshot.organization.compositions)
  assert.deepEqual(reset.retiredDemos, restart.snapshot.retiredDemos)
  assert.doesNotThrow(() => parseWorkbench(serializeWorkbench(reset, registry), registry))
  const failed = writeWorkbench({ ...storage, setItem() { throw Error('Quota') } }, reset, registry, saved.raw)
  assert.ok(failed.error); assert.equal(data.get(WORKBENCH_KEY), saved.raw)
  assert.ok(writeWorkbench(storage, read.snapshot, registry, original).error, 'Stale bytes remain guarded')
})
test('unknown/malformed active, saved or archived associations retain recovery instead of being silently pruned', () => {
  const raw = JSON.parse(serializeWorkbench(upgraded(), fixtures))
  raw.organization.views[0].modelId = 'wrong'
  assert.throws(() => parseWorkbench(JSON.stringify(raw), registry))
  const absent = readWorkbench({ getItem: key => key === WORKBENCH_KEY ? serializeWorkbench(upgraded(), fixtures) : null, setItem() {} }, widgetRegistry())
  assert.equal(absent.recovery, true, 'Missing installed plugin still uses recovery')
  const archive = JSON.parse(serializeWorkbench(parseWorkbench(serializeWorkbench(upgraded(), fixtures), registry), registry))
  archive.retiredDemos.views[0].typeId = 'unknown:widget'
  assert.throws(() => parseWorkbench(JSON.stringify(archive), registry))
  const saved = JSON.parse(serializeWorkbench(upgraded(), fixtures)); saved.organization.compositions[0].views[0].modelId = 'wrong'
  assert.throws(() => parseWorkbench(JSON.stringify(saved), registry))
})

test('historical freeform adoption retains the original source and offers an empty normal preview', () => {
  const raw = JSON.stringify(DEFAULT_FREEFORM), data = new Map([[FREEFORM_KEY, raw]])
  const read = readWorkbench({ getItem: key => data.get(key) ?? null, setItem() { throw Error('Unexpected write') } }, registry)
  assert.equal(read.recovery, true); assert.equal(read.previous, raw)
  assert.deepEqual(read.snapshot.placements, [])
  assert.equal(read.snapshot.retiredDemos!.views.length, 7)
  assert.equal(data.get(FREEFORM_KEY), raw)
})
