import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialWorkbench, widgetRegistry, constraintsForViews, WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { availablePresentations, changePresentation, defaultPresentation, effectivePresentation, presentationFor } from '../src/shared/workbench/presentations.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { readWorkbench, writeWorkbench } from '../src/shared/workbench/storage.ts'
import { EditHistory, formatSignature } from '../src/shared/workbench/history.ts'
import { applyComposition, captureCurrentComposition, systemCompositions } from '../src/shared/workbench/compositions.ts'
import { removePresence, moveView, addWidget } from '../src/shared/workbench/commands.ts'

const registry = widgetRegistry()
test('host capabilities gate modes by type and current region; legacy closed Normal and Overlay remain recoverable', () => {
  assert.deepEqual(availablePresentations(registry.get('host:queue')!, 'main'), ['normal'])
  assert.deepEqual(availablePresentations(registry.get('host:properties')!, 'main'), ['normal', 'docked', 'overlay'])
  assert.deepEqual(availablePresentations(registry.get('host:properties')!, 'sidebar'), ['normal'])
  const source = initialWorkbench(), side = { ...source, placements: source.placements.map(p => p.id === 'properties' ? { ...p, region: 'sidebar' as const } : p) }
  assert.throws(() => changePresentation(side, { presentation: 'docked' }))
  const disabled = new Map(registry); disabled.set('host:properties', { ...registry.get('host:properties')!, presentations: undefined })
  assert.throws(() => changePresentation(source, { presentation: 'overlay' }, disabled))
  for (const presentation of ['normal', 'overlay'] as const) {
    const legacy = JSON.parse(serializeWorkbench(changePresentation(source, { presentation }), registry))
    legacy.organization.presentations.entries[0].open = false
    const restored = parseWorkbench(JSON.stringify(legacy), registry)
    assert.equal(effectivePresentation(restored, { width: 1567, height: 900 }, constraintsForViews(restored, registry)).shown, true)
    assert.equal(presentationFor(restored).open, false, 'Reading never changes historical bytes or explicit state')
    assert.equal(presentationFor(changePresentation(restored, { presentation: 'normal' })).open, true)
  }
})
test('all presentations, explicit visibility and fractional preferred sizes survive the actual envelope codec', () => {
  for (const presentation of ['normal', 'docked', 'overlay'] as const) for (const open of [false, true]) {
    const original = initialWorkbench(), next = changePresentation(original, { presentation, open, preferred: { width: 701.25, height: 340.125 } })
    const raw = serializeWorkbench(next, registry), restored = parseWorkbench(raw, registry)
    assert.equal(JSON.parse(raw).schemaVersion, 2)
    assert.deepEqual(presentationFor(restored), presentationFor(next))
    assert.deepEqual(restored.placements, original.placements)
    assert.deepEqual(restored.organization.chrome, original.organization.chrome)
    assert.deepEqual(presentationFor(original), defaultPresentation())
  }
})
test('alpha.16 documents default to Normal/open without adopting or rewriting historical bytes', () => {
  const old = JSON.parse(serializeWorkbench(initialWorkbench(), registry)); old.schemaVersion = 1; delete old.organization.presentations
  const raw = JSON.stringify(old), data = new Map([[WORKBENCH_KEY, raw]])
  const recovered = readWorkbench({ getItem: key => data.get(key) ?? null, setItem() { throw new Error('Read only') } }, registry)
  assert.equal(recovered.recovery, false); assert.deepEqual(presentationFor(recovered.snapshot), defaultPresentation())
  assert.equal(data.get(WORKBENCH_KEY), raw)
})
test('invalid enums, identity, models, owners, anchors, sizes and future schemas preserve recovery source bytes', () => {
  const original = changePresentation(initialWorkbench(), { presentation: 'docked' })
  for (const patch of [ { presentation: 'floating' }, { open: 1 }, { viewId: 'queue' }, { typeId: 'host:queue' }, { owner: 'plugin:other' },
    { modelId: 'model:host:queue' }, { anchor: 'top' }, { preferred: null }, { preferred: { width: 0, height: 260 } },
    { preferred: { width: 720, height: 4097 } }, { preferred: { width: '720', height: 260 } }, { preferred: { width: 720, height: null } } ]) {
    const document = JSON.parse(serializeWorkbench(original, registry)); Object.assign(document.organization.presentations.entries[0], patch)
    const raw = JSON.stringify(document); assert.throws(() => parseWorkbench(raw, registry))
    const read = readWorkbench({ getItem: key => key === WORKBENCH_KEY ? raw : null, setItem() { throw new Error('No writes') } }, registry)
    assert.equal(read.recovery, true); assert.equal(read.raw, raw)
  }
  const document = JSON.parse(serializeWorkbench(original, registry))
  document.organization.views = document.organization.views.filter((view: { id: string }) => view.id !== 'properties')
  document.layout.placements = document.layout.placements.filter((p: { id: string }) => p.id !== 'properties')
  assert.throws(() => parseWorkbench(JSON.stringify(document), registry))
  for (const version of [0, 3, '2']) { document.schemaVersion = version; assert.throws(() => parseWorkbench(JSON.stringify(document), registry)) }
  for (const height of [NaN, Infinity, -1]) assert.throws(() => changePresentation(original, { preferred: { width: 720, height } }))
})
test('Docked bounded fit and temporary collapse are pure and reverse wide/narrow/wide, even after a small-viewport restart', () => {
  const snapshot = changePresentation(initialWorkbench(), { presentation: 'docked', preferred: { width: 720, height: 420 } }), before = serializeWorkbench(snapshot, registry)
  const constraints = constraintsForViews(snapshot, registry)
  const wide = effectivePresentation(snapshot, { width: 1567, height: 900 }, constraints)
  assert.equal(wide.shown, true); assert.equal(wide.height, 420); assert.equal(wide.reservation, 429)
  const medium = effectivePresentation(snapshot, { width: 1567, height: 650 }, constraints)
  assert.equal(medium.shown, true); assert.ok(medium.height >= 220 && medium.height < 420); assert.equal(medium.adapted, true)
  const small = effectivePresentation(parseWorkbench(before, registry), { width: 600, height: 400 }, constraints)
  assert.equal(small.shown, false); assert.equal(small.adapted, true); assert.equal(small.reservation, 40)
  assert.deepEqual(effectivePresentation(snapshot, { width: 1567, height: 900 }, constraints), wide)
  const fractional = effectivePresentation(snapshot, { width: 659.6, height: 654.6 }, constraints, true, 7)
  assert.equal(fractional.shown, true); assert.ok(fractional.height >= 220)
  assert.ok(Math.floor(654.6 - fractional.reservation - 8) >= 344, 'Scrollbar and inward CSS-pixel quantization preserve Main minima')
  assert.equal(serializeWorkbench(snapshot, registry), before); assert.equal(presentationFor(snapshot).open, true)
  const closed = changePresentation(snapshot, { open: false })
  assert.equal(effectivePresentation(closed, { width: 1567, height: 900 }, constraints).reservation, 40)
  assert.equal(effectivePresentation(closed, { width: 1567, height: 900 }, constraints).shown, false)
})
test('Overlay has no reservation and clips to Main; a truly tiny viewport keeps a recovery control outside the panel', () => {
  const source = changePresentation(initialWorkbench(), { presentation: 'overlay' }), constraints = constraintsForViews(source, registry)
  const effective = effectivePresentation(source, { width: 500, height: 230 }, constraints)
  assert.equal(effective.reservation, 0); assert.equal(effective.shown, true); assert.equal(effective.width, 500); assert.equal(effective.height, 230)
  assert.equal(effectivePresentation(source, { width: 500, height: 200 }, constraints).shown, false)
  const wide = effectivePresentation(source, { width: 1567, height: 900 }, constraints)
  assert.equal(wide.width, 1567, 'Floating follows the full available Main width, independently of legacy preferred width')
  assert.equal(wide.adapted, false); assert.equal(presentationFor(source).preferred.width, 720)
})
test('stale, quota, invalid and historical adoption writes never replace a valid prior envelope', () => {
  const source = changePresentation(initialWorkbench(), { presentation: 'overlay' }), raw = serializeWorkbench(source, registry)
  const data = new Map([[WORKBENCH_KEY, raw]]), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const next = changePresentation(source, { presentation: 'docked' })
  assert.ok(writeWorkbench(storage, next, registry, null).error); assert.equal(data.get(WORKBENCH_KEY), raw)
  assert.ok(writeWorkbench({ ...storage, setItem() { throw new Error('Quota') } }, next, registry, raw).error); assert.equal(data.get(WORKBENCH_KEY), raw)
  const invalid = structuredClone(next); invalid.organization.presentations!.entries[0]!.modelId = 'model:other' as 'model:host:properties'
  assert.ok(writeWorkbench(storage, invalid, registry, raw).error); assert.equal(data.get(WORKBENCH_KEY), raw)
  assert.equal(writeWorkbench(storage, next, registry, raw).error, null)
  assert.deepEqual(presentationFor(readWorkbench(storage, registry).snapshot), presentationFor(next))
})
test('presentation intentions participate in pending format/history without capturing temporary geometry or slots', () => {
  const snapshot = initialWorkbench(), after = changePresentation(snapshot, { presentation: 'docked', open: false })
  const beforeDraft = { snapshot, slots: [], formatId: null }, afterDraft = { ...beforeDraft, snapshot: after }, history = new EditHistory()
  history.record(beforeDraft, afterDraft)
  assert.notEqual(formatSignature(after), formatSignature(snapshot))
  assert.deepEqual(history.undo(afterDraft), beforeDraft); assert.deepEqual(history.redo(beforeDraft), afterDraft)
  assert.deepEqual(after.reference, snapshot.reference); assert.deepEqual(after.placements, snapshot.placements)
})
test('composition format stays unchanged; same view retains choices, removal/restoration and leaving Main suspend without reassociation', () => {
  const source = changePresentation(initialWorkbench(), { presentation: 'overlay', open: true }), constraints = constraintsForViews(source, registry)
  const composition = captureCurrentComposition(source, 'Pilot', ['main'], false)
  assert.equal('presentations' in composition, false)
  const applied = applyComposition(source, registry, composition, 'widgets')!
  assert.deepEqual(presentationFor(applied), presentationFor(source))
  const omitted = applyComposition(source, registry, { ...composition, scopes: ['bottom'], placements: [], views: [], format: [] }, 'widgets')!
  assert.deepEqual(omitted.placements.filter(p => p.region === 'main'), source.placements.filter(p => p.region === 'main'))
  const removed = removePresence(source, 'properties')
  assert.equal(effectivePresentation(removed, { width: 1600, height: 800 }, constraints).active, false)
  assert.deepEqual(presentationFor(removed), presentationFor(source))
  const restored = addWidget(removed, registry, 'host:properties', { region: 'main', width: 1600, height: 800, expanded: false })!
  assert.ok(restored); assert.equal(restored.placements.find(p => p.id === 'properties')?.region, 'main')
  assert.deepEqual(presentationFor(restored), presentationFor(source))
  const side = moveView(source, registry, 'properties', { region: 'sidebar', width: 253, height: 1600, expanded: false })!
  assert.ok(side); assert.equal(effectivePresentation(side, { width: 1600, height: 800 }, constraints).active, false)
  assert.deepEqual(presentationFor(parseWorkbench(serializeWorkbench(side, registry), registry)), presentationFor(source))
  const replaced = applyComposition(source, registry, systemCompositions()[1]!, 'widgets')!
  assert.ok(replaced); assert.equal(effectivePresentation(replaced, { width: 1600, height: 800 }, constraints).active, false)
  assert.deepEqual(presentationFor(replaced), presentationFor(source))
})
