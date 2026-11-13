import assert from 'node:assert/strict'
import test from 'node:test'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import { initialWorkbench, widgetRegistry, constraintsForViews } from '../src/shared/workbench/model.ts'
import { addWidget, moveView, removePresence, swapViews } from '../src/shared/workbench/commands.ts'
import { groupWidgets } from '../src/shared/workbench/groups.ts'
import { availablePresentations, changePresentation, returnToNormal, arrangePresentations, EDGES } from '../src/shared/workbench/presentations.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { captureComposition, applyComposition } from '../src/shared/workbench/compositions.ts'

const plugin: InstalledPlugin = { enabled: true, revision: 'pilot', manifest: { schemaVersion: 1, apiVersion: 2, id: 'geppio.workspace-essentials', name: 'Workspace Essentials', version: '1.0.0', entry: 'entry.js', widgets: ['notes', 'checklist'].map(id => ({ id, title: id, surface: 'declarative' })) } }
const registry = widgetRegistry([plugin]), main = { region: 'main' as const, width: 1800, height: 1200, expanded: false }
function fixture() {
  let source = initialWorkbench()
  for (const name of ['notes', 'checklist']) source = addWidget(source, registry, `plugin:geppio.workspace-essentials:${name}`, main)!
  const id = (name: string) => source.organization.views.find(v => v.typeId.endsWith(':' + name))!.id
  return { source, notes: id('notes'), checklist: id('checklist') }
}
test('only known Notes receives Main presentations; every panel returns the unchanged Normal seed and peer layout', () => {
  const { source, notes, checklist } = fixture()
  assert.deepEqual(availablePresentations(registry.get('plugin:geppio.workspace-essentials:notes')!, 'main'), ['normal', 'docked', 'overlay'])
  for (const region of ['sidebar', 'bottom'] as const) assert.deepEqual(availablePresentations(registry.get('plugin:geppio.workspace-essentials:notes')!, region), ['normal'])
  assert.throws(() => changePresentation(source, { presentation: 'overlay', anchor: null }, registry, checklist))
  for (const mode of ['docked', 'overlay'] as const) for (const anchor of [...EDGES, null]) {
    if (mode === 'docked' && anchor === null) continue
    const panel = changePresentation(source, { presentation: mode, anchor, open: false }, registry, notes)
    const restored = parseWorkbench(serializeWorkbench(panel, registry), registry)
    const normal = returnToNormal(restored, notes, main, registry)!
    assert.ok(normal); assert.deepEqual(normal.placements, source.placements); assert.deepEqual(normal.reference, source.reference)
    assert.deepEqual(normal.organization.views, source.organization.views)
    assert.equal(moveView(panel, registry, notes, { region: 'sidebar', width: 280, height: 1000, expanded: false }), null)
    assert.ok(moveView(normal, registry, notes, { region: 'sidebar', width: 280, height: 1000, expanded: false }))
    const raw = serializeWorkbench(panel, registry), constraints = constraintsForViews(panel, registry)
    arrangePresentations(panel, { width: 500, height: 350 }, constraints)
    assert.equal(serializeWorkbench(panel, registry), raw)
    assert.deepEqual(arrangePresentations(panel, main, constraints), arrangePresentations(restored, main, constraints))
  }
})
test('group transitions, regional swaps and conflicting Normal seeds refuse without partial mutation', () => {
  const { source, notes, checklist } = fixture()
  const grouped = groupWidgets(source, registry, checklist, notes)!, before = serializeWorkbench(grouped, registry)
  assert.throws(() => changePresentation(grouped, { presentation: 'docked', anchor: 'left' }, registry, notes))
  assert.equal(serializeWorkbench(grouped, registry), before)
  const panel = changePresentation(source, { presentation: 'overlay', anchor: null }, registry, notes)
  const sidebarPeer = moveView(panel, registry, checklist, { region: 'sidebar', width: 280, height: 1000, expanded: false })!
  assert.equal(swapViews(sidebarPeer, registry, notes, checklist), null, 'A swap cannot bypass explicit Normal before regional transfer')
  const conflict = structuredClone(panel)
  Object.assign(conflict.placements.find(p => p.id === checklist)!, conflict.placements.find(p => p.id === notes)!, { id: checklist })
  const bytes = serializeWorkbench(conflict, registry)
  assert.equal(returnToNormal(conflict, notes, main, registry), null)
  assert.equal(serializeWorkbench(conflict, registry), bytes)
  const malformed = JSON.parse(serializeWorkbench(panel, registry)); malformed.organization.presentations.entries[0].modelId = 'other'
  assert.throws(() => parseWorkbench(JSON.stringify(malformed), registry))
})
test('compositions preserve omitted Notes presentation and removed-view preferences roundtrip', () => {
  const { source, notes } = fixture()
  const panel = changePresentation(source, { presentation: 'docked', anchor: 'right', open: false }, registry, notes)
  const composition = captureComposition(panel, 'Bottom only', 'format-widgets', ['bottom'])
  assert.ok(composition)
  const applied = applyComposition(panel, registry, composition!, 'widgets')!
  assert.deepEqual(applied.organization.presentations, panel.organization.presentations)
  const removed = removePresence(panel, notes)
  assert.deepEqual(parseWorkbench(serializeWorkbench(removed, registry), registry).organization.presentations, panel.organization.presentations)
})
