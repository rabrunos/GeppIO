import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { parseManifest } from '../src/shared/plugins.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'
import { compositionTemplates } from '../src/renderer/src/workbench/plugin-templates.ts'
import { initialWorkbench, widgetRegistry } from '../src/shared/workbench/model.ts'
import { addWidget, removePresence } from '../src/shared/workbench/commands.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { applyComposition } from '../src/shared/workbench/compositions.ts'
import { importPortableComposition, portableDependencies, resolvePortableWidgets } from '../src/shared/workbench/portable.ts'
import { selectSuite } from '../tools/isolation/plan.ts'

function sample(name: string, enabled: boolean): InstalledPlugin {
  const manifest = parseManifest(readFileSync(new URL('../examples/plugins/' + name + '/plugin.json', import.meta.url), 'utf8'))
  return { manifest, revision: randomUUID(), generation: randomUUID(), enabled, source: 'external' }
}

test('the shipped disabled sample copies an independent recipe with three public references into an empty Workbench', () => {
  const provider = sample('composition-templates', false)
  assert.deepEqual(provider.manifest.widgets, [])
  const [choice] = compositionTemplates([provider]); assert.ok(choice)
  const source = initialWorkbench(), registry = widgetRegistry([provider]), before = structuredClone(source)
  const copy = importPortableComposition(source, choice.recipe, 'Meu estudo')
  assert.deepEqual(source, before); assert.notEqual(copy.id, choice.id)
  assert.deepEqual(copy.views, []); assert.deepEqual(copy.placements, [])
  assert.deepEqual(copy.portable?.views.map(v => v.ref), [
    { host: 'host:file-editor' }, { pluginId: 'geppio.workspace-essentials', widgetId: 'notes' }, { host: 'host:terminal' }
  ])
  source.organization.compositions.push(copy)
  const originalBytes = serializeWorkbench(source, registry)
  assert.ok(!originalBytes.includes(provider.revision) && !originalBytes.includes(provider.manifest.id))
  choice.recipe.chrome.sidebar!.size = 340; choice.recipe.name = 'Revisado'
  const restored = parseWorkbench(originalBytes, widgetRegistry()), saved = restored.organization.compositions[0]!
  assert.equal(saved.name, 'Meu estudo'); assert.equal(saved.portable!.chrome.sidebar!.size, 280)
  assert.equal(resolvePortableWidgets(restored, widgetRegistry(), saved, new Set(), {}), null)
  assert.ok(applyComposition(restored, widgetRegistry(), saved, 'format'))
  assert.deepEqual(restored.organization.views, before.organization.views)
})

test('the published sample applies its requested geometry only with existing compatible destination models', () => {
  const source = sample('composition-templates', false), dependency = sample('workspace-essentials', true)
  const registry = widgetRegistry([source, dependency])
  const recipe = compositionTemplates([source])[0]!.recipe, copy = importPortableComposition(initialWorkbench(), recipe, recipe.name)
  let scene = initialWorkbench()
  for (const item of recipe.views) {
    const placement = recipe.placements.find(p => p.view === item.key)!
    const type = 'host' in item.ref ? item.ref.host : 'plugin:' + item.ref.pluginId + ':' + item.ref.widgetId
    const next = addWidget(scene, registry, type, { ...scene.reference[placement.region], region: placement.region, expanded: false })
    assert.ok(next); scene = removePresence(next, next.organization.views.find(v => v.typeId === type)!.id)
  }
  const savedModels = structuredClone(scene.organization.views)
  const disabled = new Set(['plugin:' + dependency.manifest.id])
  assert.ok(portableDependencies(scene, registry, copy, disabled).some(d => d.reason))
  assert.equal(resolvePortableWidgets(scene, registry, copy, disabled, {}), null)
  const bound = resolvePortableWidgets(scene, registry, copy, new Set(), {})
  assert.ok(bound)
  const applied = applyComposition(scene, registry, bound, 'widgets')
  assert.ok(applied); assert.deepEqual(applied.organization.views, savedModels)
  assert.deepEqual(bound.placements.map(({ x, y, width, height, region }) => ({ x, y, width, height, region })),
    recipe.placements.map(({ x, y, width, height, region }) => ({ x, y, width, height, region })))
  assert.deepEqual(applied.placements.map(p => [p.id, p.region]), bound.placements.map(p => [p.id, p.region]))
  assert.ok(applied.placements.every(p => p.width > 0 && p.height > 0))
})

test('template discovery and copy have real desktop coverage at both supported scales', () => {
  for (const variant of [undefined, '--scale125']) assert.equal(selectSuite('plugin-templates', variant).step.file, 'tools/plugin-templates-smoke.ts')
})
