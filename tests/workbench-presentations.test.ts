import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialWorkbench, widgetRegistry, constraintsForViews, WORKBENCH_KEY } from './fixtures/workbench.ts'
import type { WorkbenchSnapshot } from './fixtures/workbench.ts'
import { availablePresentations, changePresentation, defaultPresentation, arrangePresentations, EDGES, panelIds, presentationFor, returnToNormal, PANEL_GAP, PANEL_BAR_HEIGHT } from '../src/shared/workbench/presentations.ts'
import type { Edge, Presentation } from '../src/shared/workbench/presentations.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { readWorkbench, writeWorkbench } from '../src/shared/workbench/storage.ts'
import { EditHistory, formatSignature } from '../src/shared/workbench/history.ts'
import { applyComposition, captureCurrentComposition } from './fixtures/compositions.ts'
import { removePresence, moveView, addWidget } from '../src/shared/workbench/commands.ts'
import { projectRegion } from '../src/shared/freeform/projection.ts'

const registry = widgetRegistry(), size = { width: 1567, height: 1000 }
const arrange = (source: WorkbenchSnapshot, available = size, expanded = false, scrollbar = 0) => arrangePresentations(source, available, constraintsForViews(source, registry), expanded, scrollbar)
const select = (source: WorkbenchSnapshot, id: string, presentation: Presentation, anchor: Edge | null = 'bottom', open = true) => changePresentation(source, { presentation, anchor, open }, registry, id)
const ids = ['summary', 'queue', 'properties', 'activity']
function four(open = true) { return ids.reduce((source, id, i) => select(source, id, 'docked', EDGES[i]!, open), initialWorkbench()) }
const rect = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) => ({ x, y, width, height })

test('capabilities belong to the eligible Main types and never change their defaults or regions', () => {
  for (const id of ids) {
    const type = registry.get('host:' + id)!
    assert.deepEqual(availablePresentations(type, 'main'), ['normal', 'docked', 'overlay'])
    assert.deepEqual(availablePresentations(type, 'sidebar'), ['normal'])
    assert.equal(presentationFor(initialWorkbench(), id).presentation, 'normal')
    const side = { ...initialWorkbench(), placements: initialWorkbench().placements.map(p => p.id === id ? { ...p, region: 'sidebar' as const } : p) }
    assert.throws(() => select(side, id, 'docked'))
  }
  assert.deepEqual(availablePresentations(registry.get('host:notes')!, 'main'), ['normal'])
  assert.throws(() => select(initialWorkbench(), 'notes', 'overlay'))
  const disabled = new Map(registry); disabled.set('host:properties', { ...registry.get('host:properties')!, presentations: undefined })
  assert.throws(() => changePresentation(initialWorkbench(), { presentation: 'overlay', anchor: 'top' }, disabled))
  assert.throws(() => changePresentation(initialWorkbench(), { presentation: 'docked' }), 'Mode alone cannot apply a stale anchor')
})

test('reservation fit shares normal projection availability when a plugin contribution leaves the registry', () => {
  const initial = initialWorkbench(), source = structuredClone(initial), id = 'plugin:test.action:action:view:main'
  source.organization.views.push({ id, typeId: 'plugin:test.action:action', modelId: 'model:plugin:test.action:action' })
  source.placements.push({ id, region: 'main', x: 0, y: 0, width: 180, height: 112, preferred: { width: 180, height: 112 } })
  assert.deepEqual(arrange(source), arrange(initial), 'Unavailable mounted/recovery records do not supply executable geometry constraints')
  assert.equal(source.placements.at(-1)!.id, id, 'Fit never deletes unavailable recovery records or changes lifecycle')
})

test('four-edge and free preferences roundtrip the existing envelope with fractional dimensions and position', () => {
  for (const presentation of ['normal', 'docked', 'overlay'] as const) for (const anchor of [...EDGES, null]) for (const open of [false, true]) {
    if (presentation === 'docked' && anchor === null) continue
    const original = initialWorkbench(), next = changePresentation(original, { presentation, anchor, open, preferred: { width: 701.25, height: 340.125 }, position: { x: 45.5, y: 82.125 } })
    const raw = serializeWorkbench(next, registry), restored = parseWorkbench(raw, registry)
    assert.equal(JSON.parse(raw).schemaVersion, 2); assert.equal(restored.organization.presentations!.version, 2)
    assert.deepEqual(presentationFor(restored), presentationFor(next)); assert.deepEqual(restored.placements, original.placements)
    assert.deepEqual(restored.organization.chrome, original.organization.chrome)
    if (presentation === 'normal') assert.equal(presentationFor(next).anchor, null)
  }
})

test('alpha.17/18 bottom records and older absent records read without writing their recovery bytes', () => {
  for (const presentation of ['normal', 'docked', 'overlay'] as const) for (const open of [false, true]) {
    const old = JSON.parse(serializeWorkbench(initialWorkbench(), registry))
    old.organization.presentations = { version: 1, entries: [{ ...defaultPresentation(), presentation, anchor: 'bottom', preferred: { width: 720, height: 340.125 }, open }] }
    delete old.organization.presentations.entries[0].position
    const raw = JSON.stringify(old), storage = { getItem: (key: string) => key === WORKBENCH_KEY ? raw : null, setItem() { throw new Error('No read writes') } }
    const recovered = readWorkbench(storage, registry)
    assert.equal(recovered.recovery, false); assert.equal(recovered.raw, raw)
    assert.equal(presentationFor(recovered.snapshot).open, open)
    assert.deepEqual(presentationFor(recovered.snapshot).preferred, { width: 720, height: 340.125 })
    assert.equal(presentationFor(recovered.snapshot).anchor, presentation === 'normal' ? null : 'bottom')
  }
  const old = JSON.parse(serializeWorkbench(initialWorkbench(), registry)); old.schemaVersion = 1; delete old.organization.presentations
  assert.deepEqual(presentationFor(parseWorkbench(JSON.stringify(old), registry)), defaultPresentation())
})

test('malformed associations, anchors, coordinates, sizes, duplicates and future versions fail closed', () => {
  const original = select(initialWorkbench(), 'properties', 'docked')
  for (const patch of [{ presentation: 'floating' }, { open: 1 }, { viewId: 'queue' }, { typeId: 'host:queue' }, { owner: 'plugin:other' },
    { modelId: 'model:host:queue' }, { anchor: 'diagonal' }, { anchor: null }, { preferred: null }, { position: null }, { position: { x: -1, y: 0 } },
    { position: { x: '0', y: 0 } }, { preferred: { width: 0, height: 260 } }, { preferred: { width: 720, height: 4097 } }, { preferred: { width: 720, height: null } }]) {
    const document = JSON.parse(serializeWorkbench(original, registry)); Object.assign(document.organization.presentations.entries[0], patch)
    const raw = JSON.stringify(document); assert.throws(() => parseWorkbench(raw, registry), JSON.stringify(patch))
    const read = readWorkbench({ getItem: key => key === WORKBENCH_KEY ? raw : null, setItem() { throw new Error('No writes') } }, registry)
    assert.equal(read.recovery, true); assert.equal(read.raw, raw)
  }
  const doc = JSON.parse(serializeWorkbench(original, registry)); doc.organization.presentations.entries.push(doc.organization.presentations.entries[0]); assert.throws(() => parseWorkbench(JSON.stringify(doc), registry))
  doc.organization.presentations.version = 3; assert.throws(() => parseWorkbench(JSON.stringify(doc), registry))
  for (const n of [NaN, Infinity, -1]) assert.throws(() => changePresentation(original, { position: { x: n, y: 0 } }))
})

test('Docked edge occupancy is atomic, inactive preferences survive and conflicting reactivation is refused', () => {
  const source = select(initialWorkbench(), 'summary', 'docked', 'top'), raw = serializeWorkbench(source, registry)
  assert.throws(() => select(source, 'queue', 'docked', 'top')); assert.equal(serializeWorkbench(source, registry), raw)
  const removed = removePresence(source, 'summary'), occupied = select(removed, 'queue', 'docked', 'top')
  assert.equal(presentationFor(occupied, 'summary').anchor, 'top')
  assert.equal(addWidget(occupied, registry, 'host:summary', { region: 'main', ...size, expanded: false }), null)
  const doc = JSON.parse(serializeWorkbench(four(), registry)); doc.organization.presentations.entries[1].anchor = 'top'
  assert.throws(() => parseWorkbench(JSON.stringify(doc), registry))
  const composition = captureCurrentComposition(source, 'Docked', ['main'], false)
  assert.equal(applyComposition(occupied, registry, composition, 'widgets'), null)
  const floating = select(initialWorkbench(), 'properties', 'overlay', 'top')
  assert.throws(() => select(floating, 'activity', 'overlay', 'top'), 'Same-edge Floating stacks are outside this slice')
  assert.throws(() => select(floating, 'summary', 'docked', 'top'), 'Both strip types own their edge once; mixed stacks are outside this slice')
})

test('horizontal edges own full-width corners; sides track zero, one and two horizontal reservations', () => {
  let source = initialWorkbench()
  for (const [id, edge] of [['properties', 'left'], ['activity', 'right']] as const) source = select(source, id, 'docked', edge)
  for (const count of [0, 1, 2]) {
    if (count === 1) source = select(source, 'summary', 'docked', 'top')
    if (count === 2) source = select(source, 'queue', 'docked', 'bottom')
    const g = arrange(source), top = count >= 1 ? 260 + PANEL_GAP : 0, bottom = count >= 2 ? 260 + PANEL_GAP : 0
    for (const id of ['properties', 'activity']) { assert.equal(g.panels[id]!.expanded.y, top); assert.equal(g.panels[id]!.expanded.height, size.height - top - bottom) }
    for (const id of ['summary', 'queue'].slice(0, count)) { assert.equal(g.panels[id]!.expanded.x, 0); assert.equal(g.panels[id]!.expanded.width, size.width) }
  }
  const closed = arrange(four(false))
  for (const id of ['summary', 'queue']) assert.equal(closed.panels[id]!.collapsed.width, size.width)
  for (const id of ['properties', 'activity']) { assert.equal(closed.panels[id]!.collapsed.y, PANEL_BAR_HEIGHT + PANEL_GAP); assert.equal(closed.panels[id]!.collapsed.height, size.height - 2 * (PANEL_BAR_HEIGHT + PANEL_GAP)) }
  const one = arrange(changePresentation(four(false), { open: true }, registry, 'summary'))
  assert.equal(one.panels.summary!.expanded.height, 260); assert.equal(one.panels.properties!.collapsed.y, 270)
  assert.equal(one.panels.properties!.collapsed.height, size.height - 270 - 41)
})

test('one arrangement clamps and collapses deterministically, restores intent, and never writes viewport adaptation', () => {
  const source = four(), raw = serializeWorkbench(source, registry), wide = arrange(source)
  assert.deepEqual(changePresentation(source, { preferred: { width: 320, height: 292 } }, registry, 'summary').organization.presentations!.entries.map(e => e.viewId), source.organization.presentations!.entries.map(e => e.viewId), 'A size intention never reorders unrelated panel identities')
  assert.ok(Object.values(wide.panels).every(p => p.shown)); assert.equal(wide.adapted, false)
  const small = arrange(source, { width: 580, height: 500 })
  assert.equal(small.adapted, true); assert.equal(small.panels.activity!.shown, false, 'Right collapses first')
  for (const p of Object.values(small.panels)) {
    const r = p.shown ? p.expanded : p.collapsed
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 580 && r.y + r.height <= 500)
  }
  assert.deepEqual(arrange(parseWorkbench(raw, registry)), wide); assert.equal(serializeWorkbench(source, registry), raw)
  for (const p of source.organization.presentations!.entries) assert.equal(p.open, true)
  const peers = select(initialWorkbench(), 'properties', 'docked', 'bottom')
  const fitted = arrange(peers, { width: 659.6, height: 654.6 }, true, 7)
  const normal = projectRegion({ ...peers, placements: peers.placements.filter(p => !panelIds(peers).has(p.id)) }, 'main',
    { width: Math.floor(fitted.normal.width), height: Math.floor(fitted.normal.height - 8) }, true, constraintsForViews(peers, registry))
  assert.equal(normal.feasible, true)
})

test('mixed Docked/Floating strips reserve each edge once and only expanded Docked changes the peer viewport', () => {
  let source = initialWorkbench()
  for (const [i, id] of ids.entries()) source = select(source, id, i % 2 ? 'overlay' : 'docked', EDGES[i]!, false)
  const closed = arrange(source)
  assert.deepEqual(closed.reservations, { top: 41, bottom: 41, left: 41, right: 41 })
  for (const id of ['summary', 'queue']) { assert.equal(closed.panels[id]!.collapsed.width, size.width); assert.equal(closed.panels[id]!.collapsed.height, 31) }
  for (const id of ['properties', 'activity']) { assert.equal(closed.panels[id]!.collapsed.width, 31); assert.equal(closed.panels[id]!.collapsed.height, size.height - 82) }
  const hoverNeutral = changePresentation(source, { open: true }, registry, 'queue')
  assert.deepEqual(arrange(hoverNeutral).normal, closed.normal, 'Floating explicit historical open does not change its strip reservation')
  const dockedOpen = arrange(changePresentation(source, { open: true }, registry, 'summary'))
  assert.equal(dockedOpen.reservations.top, 270); assert.equal(dockedOpen.reservations.bottom, 41)
  assert.equal(dockedOpen.panels.activity!.collapsed.y, 270)
  assert.equal(dockedOpen.panels.activity!.collapsed.height, size.height - 311)
})

test('anchored Floating reserves its fixed strip once; free Floating uses the remaining area without reservation', () => {
  for (const anchor of [...EDGES, null]) {
    const dock = anchor === 'top' ? 'bottom' : 'top'
    const source = select(select(initialWorkbench(), 'summary', 'docked', dock), 'properties', 'overlay', anchor), g = arrange(source)
    assert.equal(g.reservations[dock], 270)
    assert.equal(Object.values(g.reservations).reduce((a, b) => a + b, 0), anchor ? 311 : 270)
    if (anchor) assert.equal(g.reservations[anchor], 41)
    const p = g.panels.properties!, r = p.expanded
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= size.width && r.y + r.height <= size.height)
    if (anchor === 'top' || anchor === 'bottom') { assert.equal(r.width, size.width); assert.equal(p.collapsed.height, 31) }
    else if (anchor) { assert.equal(r.height, size.height - g.reservations.top - g.reservations.bottom); assert.equal(p.collapsed.width, 31) }
    else { assert.equal(r.width, 320); assert.equal(p.collapsed.width, 208); assert.ok(r.x >= g.normal.x && r.y >= g.normal.y) }
    const changed = changePresentation(source, { position: { x: 10000, y: 10000 } })
    const narrow = arrange(changed, { width: 600, height: 500 }).panels.properties!
    assert.ok(narrow.expanded.x + narrow.expanded.width <= 600 && narrow.expanded.y + narrow.expanded.height <= 500)
    assert.equal(presentationFor(changed).position.x, 10000, 'Clamping never rewrites the saved position')
  }
})

test('coincident free triggers separate transiently and retain a pointer path within their expanded rectangles', () => {
  let source = initialWorkbench()
  for (const id of ids) source = changePresentation(source, { presentation: 'overlay', anchor: null, position: { x: 10000, y: 10000 } }, registry, id)
  const bytes = serializeWorkbench(source, registry), g = arrange(source, { width: 300, height: 400 })
  const triggers = Object.values(g.panels).map(p => p.collapsed)
  for (const [i, trigger] of triggers.entries()) {
    assert.ok(trigger.y >= 0 && trigger.y + trigger.height <= 400 && trigger.x + trigger.width <= 300)
    for (const other of triggers.slice(i + 1)) assert.ok(trigger.y + trigger.height + 10 <= other.y || other.y + other.height + 10 <= trigger.y)
  }
  for (const p of Object.values(g.panels)) assert.ok(p.collapsed.x >= p.expanded.x && p.collapsed.y >= p.expanded.y
    && p.collapsed.x + p.collapsed.width <= p.expanded.x + p.expanded.width && p.collapsed.y + p.collapsed.height <= p.expanded.y + p.expanded.height)
  assert.equal(serializeWorkbench(source, registry), bytes)
})

test('legal open/collapsed returns preserve exact expanded geometry and visible Normal peer rectangles', () => {
  for (const anchor of EDGES) for (const open of [true, false]) {
    const initial = initialWorkbench()
    if (!open) {
      initial.reference.main = { ...size }
      initial.placements = initial.placements.filter(p => p.region !== 'main' || ['summary', 'properties'].includes(p.id))
      Object.assign(initial.placements.find(p => p.id === 'summary')!, { x: anchor === 'left' ? 500 : 0, y: anchor === 'top' ? 400 : 0,
        width: 200, height: 200, preferred: { width: 200, height: 200 } })
    }
    const source = select(initial, 'properties', 'docked', anchor, open), before = arrange(source)
    const normals = projectRegion({ ...source, placements: source.placements.filter(p => p.id !== 'properties') }, 'main', before.normal, false, constraintsForViews(source, registry))
    const next = returnToNormal(source, 'properties', size, registry); assert.ok(next, `${anchor}/${open}`)
    assert.deepEqual(rect(next.placements.find(p => p.id === 'properties')!), rect(before.panels.properties!.expanded))
    for (const p of normals.placements) assert.deepEqual(rect(next.placements.find(q => q.id === p.id)!), { ...rect(p), x: p.x + before.normal.x, y: p.y + before.normal.y })
    assert.equal(presentationFor(next).anchor, null); assert.equal(presentationFor(next).presentation, 'normal')
    assert.deepEqual(parseWorkbench(serializeWorkbench(next, registry), registry).placements, next.placements)
    const history = new EditHistory(), beforeDraft = { snapshot: source, slots: [], formatId: null }, afterDraft = { ...beforeDraft, snapshot: next }
    history.record(beforeDraft, afterDraft); assert.deepEqual(history.undo(afterDraft), beforeDraft); assert.deepEqual(history.redo(beforeDraft), afterDraft)
  }
})

test('Floating return is exact when legal; overlap and post-switch reservation conflicts refuse atomically', () => {
  for (const anchor of [...EDGES, null]) {
    const only = initialWorkbench(); only.placements = only.placements.filter(p => p.region !== 'main' || p.id === 'properties')
    const source = select(only, 'properties', 'overlay', anchor), next = returnToNormal(source, 'properties', size, registry)
    assert.ok(next); assert.deepEqual(rect(next.placements.find(p => p.id === 'properties')!), arrange(source).panels.properties!.expanded)
  }
  for (const source of [select(initialWorkbench(), 'properties', 'overlay', null), select(initialWorkbench(), 'properties', 'docked', 'top', false), four()]) {
    const raw = serializeWorkbench(source, registry)
    assert.equal(returnToNormal(source, source.organization.presentations!.entries[0]!.viewId, size, registry), null)
    assert.equal(serializeWorkbench(source, registry), raw)
  }
  assert.equal(returnToNormal(four(), 'summary', size, registry, true), null, 'Horizontal expansion cannot hide part of an exact conversion under remaining Docked sides')
})

test('fractional Main returns preserve exact model rectangles and peers with a horizontal scrollbar', () => {
  const available = { width: 1567.5, height: 1000.25 }
  for (const anchor of EDGES) {
    const source = select(initialWorkbench(), 'properties', 'docked', anchor), before = arrange(source, available)
    const next = returnToNormal(source, 'properties', available, registry); assert.ok(next)
    assert.deepEqual(rect(next.placements.find(p => p.id === 'properties')!), before.panels.properties!.expanded)
    assert.deepEqual(parseWorkbench(serializeWorkbench(next, registry), registry).placements, next.placements)
  }
  const initial = initialWorkbench(); initial.reference.main.width = 1800
  Object.assign(initial.placements.find(p => p.id === 'queue')!, { x: 900, width: 900, preferred: { width: 900, height: 382 } })
  const source = select(initial, 'properties', 'docked', 'top'), before = arrange(source, available, true, 7)
  const peers = projectRegion({ ...source, placements: source.placements.filter(p => p.id !== 'properties') }, 'main',
    { width: before.normal.width, height: before.normal.height - 7 }, true, constraintsForViews(source, registry))
  const next = returnToNormal(source, 'properties', available, registry, true, 7); assert.ok(next)
  for (const p of peers.placements) assert.deepEqual(rect(next.placements.find(q => q.id === p.id)!), { ...rect(p), x: p.x + before.normal.x, y: p.y + before.normal.y })
})

test('stale/quota/invalid writes preserve the previous envelope; valid writes restore all preferences', () => {
  const source = four(), raw = serializeWorkbench(source, registry), data = new Map([[WORKBENCH_KEY, raw]])
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const next = changePresentation(source, { open: false })
  assert.ok(writeWorkbench(storage, next, registry, null).error); assert.equal(data.get(WORKBENCH_KEY), raw)
  assert.ok(writeWorkbench({ ...storage, setItem() { throw new Error('Quota') } }, next, registry, raw).error); assert.equal(data.get(WORKBENCH_KEY), raw)
  const invalid = structuredClone(next); invalid.organization.presentations!.entries[0]!.owner = 'plugin:other'
  assert.ok(writeWorkbench(storage, invalid, registry, raw).error); assert.equal(data.get(WORKBENCH_KEY), raw)
  assert.equal(writeWorkbench(storage, next, registry, raw).error, null)
  assert.deepEqual(readWorkbench(storage, registry).snapshot.organization.presentations, next.organization.presentations)
})

test('history/composition/removal/region changes retain identity preferences without capturing viewport or hover', () => {
  const source = select(initialWorkbench(), 'properties', 'overlay', 'right'), composition = captureCurrentComposition(source, 'Panel', ['main'], false)
  assert.equal('presentations' in composition, false)
  assert.deepEqual(presentationFor(applyComposition(source, registry, composition, 'widgets')!), presentationFor(source))
  const removed = removePresence(source, 'properties'); assert.equal(arrange(removed).panels.properties, undefined)
  const restored = addWidget(removed, registry, 'host:properties', { region: 'main', ...size, expanded: false })!
  assert.ok(restored); assert.deepEqual(presentationFor(restored), presentationFor(source))
  const side = moveView(source, registry, 'properties', { region: 'sidebar', width: 253, height: 1600, expanded: false })!
  assert.ok(side); assert.equal(arrange(side).panels.properties, undefined)
  assert.deepEqual(presentationFor(parseWorkbench(serializeWorkbench(side, registry), registry)), presentationFor(source))
  assert.notEqual(formatSignature(source), formatSignature(initialWorkbench()))
})
