import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { compileFunction } from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import type { ReactElement } from 'react'
import ts from 'typescript'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { addWidget } from '../src/shared/workbench/commands.ts'
import { initialWorkbench, widgetRegistry, WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { importPortableComposition, parsePortableLayout } from '../src/shared/workbench/portable.ts'
import type { useTransaction } from '../src/renderer/src/freeform/useTransaction.ts'
import type { usePortableCompositions } from '../src/renderer/src/workbench/usePortableCompositions.tsx'
import { disabledWidgetOwners } from '../src/renderer/src/plugin-runtime.ts'
import type { InstalledPlugin } from '../src/shared/plugins.ts'

// Keep the actual transaction and codec. Only React's hook slots, browser
// storage and the browser lock scheduler are supplied by this fixture.
const source = new URL('../src/renderer/src/freeform/useTransaction.ts', import.meta.url)
const requireFromSource = createRequire(source)
const load = compileFunction(ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 }
}).outputText, ['require', 'exports', 'window', 'navigator', 'localStorage'])
const recipe = parsePortableLayout({ kind: 'geppio-layout', version: 1, name: 'Importada', mode: 'format',
  scopes: ['main'], reference: { main: { width: 1000, height: 700 } }, chrome: {}, format: [
    { key: 's1', region: 'main', x: 0, y: 0, width: 400, height: 200 }
  ], views: [], groups: [], placements: [] })

function hookSlots() {
  const slots: unknown[] = []
  let index = 0
  function slot<T>(init: () => T) {
    const at = index++
    if (at === slots.length) slots.push(init())
    return at
  }
  const react = {
    useEffect(effect: () => unknown) { slot(effect) },
    useRef<T>(init: T) { return slots[slot(() => ({ current: init }))] },
    useState<T>(init: T | (() => T)) {
      const at = slot(() => typeof init === 'function' ? (init as () => T)() : init)
      return [slots[at], (value: T | ((old: T) => T)) => { slots[at] = typeof value === 'function' ? (value as (old: T) => T)(slots[at] as T) : value }]
    }
  }
  return { react, reset() { index = 0 } }
}
function fixture({ projected = false, historicalPreference = false } = {}) {
  const registry = widgetRegistry()
  let seed = initialWorkbench()
  if (historicalPreference) {
    seed = addWidget(seed, registry, 'host:terminal', { ...seed.reference.bottom, region: 'bottom', expanded: false })!
    seed.placements[0]!.preferred.width = seed.placements[0]!.width + 40
  }
  const initial = serializeWorkbench(seed, registry)
  const entries = new Map([[WORKBENCH_KEY, initial]])
  let quota = false, barrier: Promise<void> | undefined
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => {
    if (quota) throw new Error('fixture quota')
    entries.set(key, value)
  } }
  const hooks = hookSlots()
  const owner = {} as { useTransaction: typeof useTransaction }
  load((id: string) => id === 'react' ? hooks.react : requireFromSource(id), owner, {},
    { locks: { async request(_key: string, write: () => unknown) { await barrier; return write() } } }, storage)
  function render() { hooks.reset(); return owner.useTransaction(registry) }
  const tx = render()
  const scene = structuredClone(tx.snapshot)
  if (projected) scene.reference.main.width += 14
  tx.begin(scene)
  const item = importPortableComposition(tx.live.current, recipe, recipe.name)
  return { item, registry, render, entries, initial, exhaustQuota() { quota = true }, raw: () => entries.get(WORKBENCH_KEY)!,
    hold() { let release!: () => void; barrier = new Promise<void>(resolve => { release = resolve }); return release } }
}

test('import requires an explicit library checkpoint and preserves the draft and bytes on refusal', async () => {
  const p = fixture(), tx = p.render(), before = tx.live.current
  const favorites = [...before.organization.favorites].reverse()
  tx.action({ ...before, organization: { ...before.organization, favorites } })
  assert.equal(tx.hasPending(), false, 'library-only changes do not change geometry')
  assert.equal(tx.pendingImportCheckpoint(), true)
  assert.equal(await tx.saveImportedComposition(p.item, () => true), false)
  assert.equal(p.raw(), p.initial)
  assert.deepEqual(tx.live.current.organization.favorites, favorites)
  assert.equal(tx.live.current.organization.compositions.length, 0)
  assert.equal(await tx.saveEditing(), true)
  const saved = structuredClone(tx.live.current)
  assert.equal(tx.pendingImportCheckpoint(), false)
  assert.equal(await tx.saveImportedComposition(p.item, () => true), true)
  const expected = { ...saved, organization: { ...saved.organization, compositions: [p.item] } }
  assert.deepEqual(tx.live.current, expected)
  assert.deepEqual(parseWorkbench(p.raw(), p.registry), expected)
  tx.cancel()
  assert.deepEqual(tx.live.current, expected)
})

test('a changed dependency context or external storage update before the write retains all preceding bytes', async () => {
  const p = fixture(), tx = p.render(), prior = structuredClone(tx.live.current)
  const release = p.hold()
  let current = true
  const saving = tx.saveImportedComposition(p.item, () => current)
  current = false; release()
  assert.equal(await saving, false)
  assert.equal(p.raw(), p.initial)
  assert.deepEqual(tx.live.current, prior)
  const external = p.initial + ' '
  p.entries.set(WORKBENCH_KEY, external)
  assert.equal(await tx.saveImportedComposition(p.item, () => true), false)
  assert.equal(p.raw(), external)
  assert.deepEqual(tx.live.current, prior)
})

test('adding an inert recipe leaves the live projection intact and writes only to the confirmed library', async () => {
  const p = fixture({ projected: true }), tx = p.render(), saved = parseWorkbench(p.raw(), p.registry)
  const projected = structuredClone(tx.live.current)
  assert.notDeepEqual(projected.reference, saved.reference)
  assert.equal(tx.pendingImportCheckpoint(), false)
  assert.equal(await tx.saveImportedComposition(p.item, () => true), true)
  assert.deepEqual(tx.live.current.reference, projected.reference)
  assert.deepEqual(parseWorkbench(p.raw(), p.registry).reference, saved.reference)
  assert.equal(tx.pendingImportCheckpoint(), false)
})

test('historical preferred geometry needs its own explicit checkpoint before importing a composition', async () => {
  const p = fixture({ historicalPreference: true }), tx = p.render()
  const original = parseWorkbench(p.raw(), p.registry).placements[0]!
  assert.notEqual(original.preferred.width, original.width)
  assert.equal(tx.pendingImportCheckpoint(), true)
  assert.equal(await tx.saveImportedComposition(p.item, () => true), false)
  tx.cancel()
  assert.equal(p.raw(), p.initial)
  tx.begin(tx.live.current)
  assert.equal(tx.pendingImportCheckpoint(), true)
  assert.equal(await tx.saveEditing(), true)
  const checkpoint = parseWorkbench(p.raw(), p.registry)
  assert.deepEqual(checkpoint.organization.compositions, [])
  assert.equal(checkpoint.placements[0]!.preferred.width, original.width)
  assert.equal(tx.pendingImportCheckpoint(), false)
  assert.equal(await tx.saveImportedComposition(p.item, () => true), true)
  assert.deepEqual(parseWorkbench(p.raw(), p.registry), { ...checkpoint, organization: { ...checkpoint.organization, compositions: [p.item] } })
})

test('storage quota rejection preserves the edit, confirmed bytes and import eligibility', async () => {
  const p = fixture(), tx = p.render(), before = structuredClone(tx.live.current)
  p.exhaustQuota()
  assert.equal(await tx.saveImportedComposition(p.item, () => true), false)
  assert.equal(p.raw(), p.initial)
  assert.deepEqual(tx.live.current, before)
  assert.equal(tx.canImportComposition(), true)
})

test('plugin management starting inside the preview confirmation cancels both kinds of queued writes', async () => {
  const module = new URL('../src/renderer/src/workbench/usePortableCompositions.tsx', import.meta.url)
  const loadPortable = compileFunction(ts.transpileModule(readFileSync(module, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 }
  }).outputText, ['require', 'exports', 'window'])
  for (const historicalPreference of [false, true]) {
    const p = fixture({ historicalPreference }), hooks = hookSlots(), owner = {} as { usePortableCompositions: typeof usePortableCompositions }
    const require = createRequire(module)
    loadPortable((id: string) => id === 'react' ? hooks.react : id.endsWith('.tsx') ?
      { CompositionThumbnail: 'thumbnail', Dialog: 'dialog', Confirm: 'confirm' } : require(id),
    owner, { geppio: { portableLayouts: { async importFile() { return { ok: true, recipe } } } } })
    let managing = false, imported = 0
    function render() {
      hooks.reset()
      const tx = p.render()
      return owner.usePortableCompositions({ tx, registry: p.registry, view: tx.live.current, hidden: false,
        gesture: () => false, managing: () => managing, inventory: [], disabled: new Set(),
        applied: () => assert.fail('preview must preserve scene'), imported() { imported++ } })
    }
    await render().selectImport()
    const release = p.hold()
    const preview = render().dialogs.props.children[0] as ReactElement<{ children: ReactElement<{ onSubmit(event: { preventDefault(): void }): void }> }>
    preview.props.children.props.onSubmit({ preventDefault() {} })
    if (historicalPreference) {
      const checkpoint = render().dialogs.props.children[1] as ReactElement<{ confirm(): void }>
      checkpoint.props.confirm()
    }
    managing = true
    release(); await setImmediate()
    assert.equal(p.raw(), p.initial)
    assert.equal(imported, 0)
    assert.equal(p.render().pendingImportCheckpoint(), historicalPreference)
    assert.ok(render().dialogs.props.children[0])
  }
})

test('a published surface becomes eligible only when installation and code generation match the current inventory', () => {
  const plugin: InstalledPlugin = { revision: 'new-installation', generation: 'new-code', enabled: true, manifest: {
    schemaVersion: 1, apiVersion: 2, id: 'test.example', version: '1.0.0', entry: 'entry.js', name: 'Exemplo', widgets: []
  } }
  const active = { status: 'active' as const, plugin }
  const owner = 'plugin:' + plugin.manifest.id
  assert.ok(disabledWidgetOwners([plugin], [{ ...active, plugin: { ...plugin, revision: 'old-installation' } }]).has(owner))
  assert.ok(disabledWidgetOwners([plugin], [{ ...active, plugin: { ...plugin, generation: 'old-code' } }]).has(owner))
  assert.ok(disabledWidgetOwners([plugin], [{ ...active, status: 'starting' }]).has(owner))
  assert.ok(disabledWidgetOwners([{ ...plugin, enabled: false }], [active]).has(owner))
  assert.equal(disabledWidgetOwners([plugin], [active]).size, 0)
})
