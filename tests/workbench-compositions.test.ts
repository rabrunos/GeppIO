import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialWorkbench, widgetRegistry } from './fixtures/workbench.ts'
import type { SessionSlot } from './fixtures/workbench.ts'
import { applyComposition, captureComposition, captureCurrentComposition, compositionChrome, compositionScene, compositionSlots, systemCompositions } from './fixtures/compositions.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { EditHistory } from '../src/shared/workbench/history.ts'
import { fillReservation } from '../src/shared/workbench/slots.ts'

const registry = widgetRegistry()
test('new captures always contain scoped widget associations and exact geometry, with remembered dimensions independent of visibility', () => {
  for (const sidebar of [false, true]) for (const bottom of [false, true]) {
    const source = initialWorkbench()
    source.organization.chrome = { sidebar: { visible: sidebar, size: 321 }, bottom: { visible: bottom, size: 250 } }
    source.reference.bottom.height = 230
    const chart = source.placements.find(p => p.id === 'chart')!; chart.height = 230; chart.preferred.height = 230
    for (const scopes of [['main'], ['bottom'], ['main', 'bottom'], []] as const) for (const width of [false, true]) {
      if (!scopes.length && !width) continue
      const before = structuredClone(source), captured = captureCurrentComposition(source, 'Literal Ω', [...scopes], width)
      assert.equal(captured.mode, 'format-widgets'); assert.equal(captured.name, 'Literal Ω')
      assert.deepEqual(captured.placements, source.placements.filter(p => (scopes as readonly string[]).includes(p.region)))
      assert.deepEqual(captured.views, source.organization.views.filter(v => captured.placements.some(p => p.id === v.id)))
      assert.deepEqual(captured.reference, source.reference)
      assert.deepEqual(captured.chrome, { ...(width ? { sidebar: { size: 321 } } : {}), ...(scopes.includes('bottom' as never) ? { bottom: { size: 250 } } : {}) })
      source.organization.compositions = [captured]
      assert.deepEqual(parseWorkbench(serializeWorkbench(source, registry), registry).organization.compositions[0], captured)
      source.organization.compositions = []
      assert.deepEqual(source, before)
    }
  }
})

test('both restore actions preserve omitted canonical regions and ignore stale visibility patches without rewriting legacy bytes', () => {
  for (const scopes of [['main'], ['bottom'], [], ['main', 'bottom']] as const) for (const action of ['format', 'widgets'] as const) {
    const source = initialWorkbench(); source.organization.chrome.sidebar.visible = false; source.organization.chrome.bottom.visible = false
    const saved = captureCurrentComposition(source, 'Scope', [...scopes], true)
    // Older bytes may carry full chrome patches outside their declared scope.
    saved.chrome = { sidebar: { size: 310, visible: true }, bottom: { size: 250, visible: false } }
    const bytes = JSON.stringify(saved), before = structuredClone(source), next = applyComposition(source, registry, saved, action)!
    assert.ok(next)
    for (const region of ['main', 'bottom'] as const) if (!scopes.includes(region as never)) {
      assert.deepEqual(next.placements.filter(p => p.region === region), source.placements.filter(p => p.region === region))
      assert.deepEqual(next.reference[region], source.reference[region])
    }
    assert.deepEqual(next.organization.chrome.sidebar, { visible: false, size: 310 })
    assert.deepEqual(next.organization.chrome.bottom, scopes.includes('bottom' as never) ? { visible: true, size: 250 } : source.organization.chrome.bottom)
    assert.deepEqual(next.organization.bars, source.organization.bars); assert.equal(next.organization.activeBar, source.organization.activeBar)
    assert.equal(JSON.stringify(saved), bytes); assert.deepEqual(source, before)
    assert.ok(compositionSlots(saved, next).every(slot => scopes.includes(slot.region as never)))
  }
  const source = initialWorkbench(), focus = systemCompositions().find(c => c.id === 'system:focus')!
  assert.deepEqual(applyComposition(source, registry, focus, 'format')!.organization.chrome.bottom, source.organization.chrome.bottom)
  const legacy = captureComposition(source, 'Legacy', 'format', ['bottom'])
  source.organization.compositions = [legacy]
  const recovered = parseWorkbench(serializeWorkbench(source, registry), registry).organization.compositions[0]!
  assert.deepEqual(recovered, legacy); assert.equal(applyComposition(source, registry, recovered, 'widgets'), null)
})

test('included Bottom restores saved height and exact associations with one projection, without taking a unique omitted view', () => {
  const source = initialWorkbench(), saved = captureCurrentComposition(source, 'Bottom', ['bottom'], false)
  source.organization.chrome.bottom = { visible: false, size: 250 }; source.reference.bottom.height = 230
  source.placements.find(p => p.id === 'chart')!.height = 230
  const restored = applyComposition(source, registry, saved, 'widgets')!
  assert.deepEqual(restored.placements.filter(p => p.region === 'bottom'), saved.placements)
  assert.deepEqual(restored.reference.bottom, saved.reference.bottom)
  assert.deepEqual(restored.organization.chrome.bottom, { visible: true, size: 167 })
  const occupied = initialWorkbench(); occupied.placements.find(p => p.id === 'chart')!.region = 'main'
  const before = structuredClone(occupied)
  assert.equal(applyComposition(occupied, registry, saved, 'widgets'), null); assert.deepEqual(occupied, before)
  occupied.organization.views.push({ id: 'host:chart:view:main', typeId: 'host:chart', modelId: 'model:host:chart' })
  occupied.placements.find(p => p.id === 'chart')!.id = 'host:chart:view:main'
  assert.equal(applyComposition(occupied, registry, saved, 'widgets'), null, 'Unique type, not just view ID, is protected outside the scope')
})

test('composition projection/checkpoint scenes adopt only included geometry and width-only never changes layout reference', () => {
  const canonical = initialWorkbench(), projected = structuredClone(canonical)
  projected.placements.forEach(p => { p.width -= 20 }); projected.reference.main.width -= 20; projected.reference.bottom.width -= 20
  const scene = compositionScene(canonical, projected, ['main'])
  assert.deepEqual(scene.placements.filter(p => p.region !== 'main'), canonical.placements.filter(p => p.region !== 'main'))
  assert.deepEqual(scene.reference.bottom, canonical.reference.bottom)
  assert.deepEqual(scene.placements.filter(p => p.region === 'main'), projected.placements.filter(p => p.region === 'main'))
  const width = captureCurrentComposition(canonical, 'Width', [], true); width.chrome!.sidebar!.size = 430
  const next = compositionChrome(canonical, width)
  assert.deepEqual(next.reference, canonical.reference); assert.deepEqual(next.placements, canonical.placements)
})

test('Bottom reservations fill exactly at both panel limits for catalog and existing views with atomic rejection/history', () => {
  for (const height of [105, 230]) for (const kind of ['catalog', 'move'] as const) {
    const source = initialWorkbench(); source.placements = source.placements.filter(p => p.id === 'summary')
    source.organization.bars[0]!.members = []; source.organization.bars[0]!.positions = {}
    const surface = { ...source.reference.bottom, height, region: 'bottom' as const, expanded: false }
    const slots: SessionSlot[] = [0, 1].map(i => ({ id: `bottom:${i}`, region: 'bottom', x: i * 600, y: 0, width: 590, height, reference: surface }))
    const intent = kind === 'catalog' ? { kind, typeId: 'host:summary' } : { kind, viewId: 'summary', sourceBar: 'home' }
    const before = structuredClone(source), result = fillReservation(source, registry, slots, slots[0]!.id, surface, intent)!
    assert.ok(result); assert.deepEqual(result.slots, [slots[1]])
    const p = result.snapshot.placements.find(p => p.id === 'summary')!
    assert.deepEqual([p.x, p.y, p.width, p.height], [0, 0, 590, height]); assert.equal(p.region, 'bottom')
    assert.deepEqual(result.snapshot.organization.views, source.organization.views)
    assert.deepEqual(source, before)
    const draft = { snapshot: source, slots, formatId: 'bottom' }, after = { ...draft, ...result }, history = new EditHistory()
    history.record(draft, after); assert.deepEqual(history.undo(after), draft); assert.deepEqual(history.redo(draft), after)
    history.begin(after); assert.deepEqual(history.abort(), after)
    for (const invalid of [{ ...slots[0]!, width: 100 }, { ...slots[0]!, height: 100 }]) assert.equal(fillReservation(source, registry, [invalid], invalid.id, surface, intent), null)
    assert.equal(fillReservation(source, registry, slots, slots[0]!.id, surface, intent, new Set(['host'])), null)
    assert.equal(fillReservation(result.snapshot, registry, result.slots, slots[1]!.id, surface, { kind: 'catalog', typeId: 'host:summary' }), null)
    assert.equal(fillReservation(source, registry, slots, slots[0]!.id, surface, { kind: 'catalog', typeId: 'host:queue' }), null)
  }
})
