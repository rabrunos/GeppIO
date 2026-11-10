import test from 'node:test'
import assert from 'node:assert/strict'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import { initialWorkbench, widgetRegistry, groupFor, constraintsForViews, surfacePlacements } from '../src/shared/workbench/model.ts'
import type { WorkbenchSnapshot } from '../src/shared/workbench/model.ts'
import { addWidget, moveView, removePresence } from '../src/shared/workbench/commands.ts'
import { groupWidgets, detachWidget, reorderGroup } from '../src/shared/workbench/groups.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { captureComposition, applyComposition } from '../src/shared/workbench/compositions.ts'
import { maximizableSurface } from '../src/shared/workbench/maximize.ts'
const plugin: InstalledPlugin = { enabled: true, revision: 'fixture', manifest: { schemaVersion: 1, apiVersion: 2, id: 'geppio.workspace-essentials', name: 'Workspace Essentials', version: '1.0.0', entry: 'entry.js', widgets: ['notes', 'checklist', 'prompts', 'scratch'].map(id => ({ id, title: id, surface: 'declarative' })) } }
const registry = widgetRegistry([plugin]), main = { region: 'main' as const, width: 1800, height: 1200, expanded: false }
function scene() { let next = initialWorkbench(); for (const name of ['notes', 'checklist', 'prompts', 'scratch']) next = addWidget(next, registry, `plugin:geppio.workspace-essentials:${name}`, main)!; return next }
const id = (source: WorkbenchSnapshot, name: string) => source.organization.views.find(view => view.typeId.endsWith(':' + name))!.id
test('group eligibility is explicit; create/extend retain identities and one bounded placement with combined minima', () => {
  const source = scene(), before = structuredClone(source), notes = id(source, 'notes'), checklist = id(source, 'checklist'), prompts = id(source, 'prompts')
  assert.equal(groupWidgets(source, registry, id(source, 'scratch'), notes), null)
  let grouped = groupWidgets(source, registry, checklist, notes)!
  assert.ok(grouped); grouped = groupWidgets(grouped, registry, prompts, notes)!
  assert.deepEqual(grouped.organization.views, source.organization.views); assert.equal(grouped.placements.length, 2)
  assert.equal(surfacePlacements(grouped).length, 4); assert.equal(constraintsForViews(grouped, registry)[notes]!.min.height, 144)
  assert.deepEqual(groupFor(grouped, notes)!.members, [notes, checklist, prompts]); assert.equal(maximizableSurface(grouped, registry, notes), true)
  assert.equal(moveView(grouped, registry, notes, { region: 'sidebar', width: 250, height: 900, expanded: false }), null)
  assert.equal(addWidget(grouped, registry, 'plugin:geppio.workspace-essentials:checklist', main), null)
  assert.deepEqual(source, before)
})
test('reorder, detach and removal are atomic and preserve the shared frame and remaining models', () => {
  const source = scene(), notes = id(source, 'notes'), checklist = id(source, 'checklist'), prompts = id(source, 'prompts')
  const grouped = groupWidgets(groupWidgets(source, registry, checklist, notes)!, registry, prompts, notes)!, group = groupFor(grouped, notes)!
  const reordered = reorderGroup(grouped, group.id, prompts, -1)!
  assert.deepEqual(groupFor(reordered, notes)!.members, [notes, prompts, checklist])
  const detached = detachWidget(reordered, registry, notes)!
  assert.ok(detached); assert.equal(groupFor(detached, checklist)!.frameId, prompts); assert.ok(detached.placements.some(p => p.id === notes))
  assert.deepEqual(detached.organization.views, source.organization.views)
  const removed = removePresence(reordered, notes); assert.equal(groupFor(removed, checklist)!.frameId, prompts)
  const two = groupWidgets(source, registry, checklist, notes)!, frame = two.placements.find(p => p.id === notes)!
  const full = { ...two, reference: { ...two.reference, main: { width: frame.width, height: frame.height } }, placements: [{ ...frame, x: 0, y: 0 }] }
  const before = JSON.stringify(full); assert.equal(detachWidget(full, registry, checklist), null); assert.equal(JSON.stringify(full), before)
})
test('group codec is nested/versioned, old layouts remain readable, malformed or orphaned groups fail closed', () => {
  const source = scene(), older = serializeWorkbench(source, registry)
  assert.equal(parseWorkbench(older, registry).organization.groups, undefined)
  const grouped = groupWidgets(source, registry, id(source, 'checklist'), id(source, 'notes'))!, raw = serializeWorkbench(grouped, registry)
  assert.deepEqual(parseWorkbench(raw, registry).organization.groups, grouped.organization.groups)
  for (const edit of [(v: Record<string, unknown>) => { v.version = 2 }, (v: Record<string, unknown>) => { (v.entries as { active: string }[])[0]!.active = 'missing' }]) {
    const broken = JSON.parse(raw); edit(broken.organization.groups); assert.throws(() => parseWorkbench(JSON.stringify(broken), registry))
  }
  const orphan = JSON.parse(raw); orphan.layout.placements = []; assert.throws(() => parseWorkbench(JSON.stringify(orphan), registry))
  const tooSmall = structuredClone(source); tooSmall.placements.find(p => p.id === id(source, 'notes'))!.height = 112
  assert.equal(groupWidgets(tooSmall, registry, id(source, 'checklist'), id(source, 'notes')), null)
})
test('saved composition captures all members and restores groups while omitted Sidebar content cannot be evicted', () => {
  const source = scene(), notes = id(source, 'notes'), checklist = id(source, 'checklist')
  const grouped = groupWidgets(source, registry, checklist, notes)!, composition = captureComposition(grouped, 'Grouped', 'format-widgets', ['main'])
  assert.equal(composition.groups!.entries.length, 1); assert.equal(composition.views.length, 4)
  const restored = applyComposition(source, registry, composition, 'widgets')!
  assert.ok(restored); assert.deepEqual(restored.organization.groups, grouped.organization.groups)
  assert.deepEqual(parseWorkbench(serializeWorkbench(restored, registry), registry).organization.groups, grouped.organization.groups)
  const sidebar = moveView(source, registry, checklist, { region: 'sidebar', width: 250, height: 900, expanded: false })!
  assert.equal(applyComposition(sidebar, registry, composition, 'widgets'), null)
})
