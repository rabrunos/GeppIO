/** Differential fixtures for native/crates/geppio-core. Every expected value is computed by
 * the TypeScript reference modules imported directly; the Rust integration test
 * (native/crates/geppio-core/tests/differential.rs) must reproduce them exactly. Run with
 * `node --experimental-strip-types tools/native-fixtures.ts` to regenerate. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { alignedGesture } from '@geppio/runtime/layout/alignment'
import type { AlignmentLocks } from '@geppio/runtime/layout/alignment'
import { candidate } from '@geppio/runtime/layout/geometry'
import { settleSnapshot } from '@geppio/runtime/layout/settlement'
import { reflow } from '@geppio/runtime/layout/reflow'
import type { Constraints, Direction, Placement, Region, Size, Surface } from '@geppio/runtime/layout/types'
import { CONSTRAINTS, DEFAULT_FREEFORM, constraintsFor } from '../src/geppio/src/shared/freeform/policy.ts'
import { projectRegion } from '../src/geppio/src/shared/freeform/projection.ts'
import { REGION_LABELS } from '../src/geppio/src/shared/freeform/transfer.ts'
import { activePlacements, adoptLayout, constraintsForViews, initialWorkbench, widgetRegistry, WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import type { Composition, Registry, SessionDraft, SessionSlot, UserBar, WorkbenchSnapshot } from '../src/geppio/src/shared/workbench/model.ts'
import type { InstalledPlugin } from '../src/geppio/src/shared/plugins.ts'
import { parseWorkbench, serializeWorkbench } from '../src/geppio/src/shared/workbench/codec.ts'
import { addWidget, configureBar, deleteBar, fitTargets, moveView, reconcileBarHeights, removePresence, reorderBar, resizePair, swapViews, updateBar } from '../src/geppio/src/shared/workbench/commands.ts'
import { groupTransferPlan, groupWidgets } from '../src/geppio/src/shared/workbench/groups.ts'
import { EditHistory, formatSignature } from '../src/geppio/src/shared/workbench/history.ts'
import { arrangePresentations, changePresentation, panelIds, returnToNormal, validatePresentationEdges } from '../src/geppio/src/shared/workbench/presentations.ts'
import type { PresentationPatch } from '../src/geppio/src/shared/workbench/presentations.ts'
import { writeWorkbench } from '../src/geppio/src/shared/workbench/storage.ts'
import { exportPortableComposition, importPortableComposition, parsePortableLayout, parsePortableText, portableDependencies, resolvePortableWidgets, serializePortableLayout,
  storedPortableComposition } from '../src/geppio/src/shared/workbench/portable.ts'
import { captureComposition, systemCompositions } from '../tests/fixtures/compositions.ts'
import { applyComposition, captureCurrentComposition, compositionChrome, compositionOrder, compositionScene, compositionSlots, favoriteComposition, projectSessionSlot, reorderComposition,
  systemCompositions as presets } from '../src/geppio/src/shared/workbench/compositions.ts'
import { fillReservation } from '../src/geppio/src/shared/workbench/slots.ts'
import type { SlotIntention } from '../src/geppio/src/shared/workbench/slots.ts'
import type { ChromePatch } from '../src/geppio/src/shared/workbench/chrome.ts'
import { COMPOSITIONS } from '../tests/fixtures/grid-compositions.ts'

export const FIXTURE_DIR = 'native/crates/geppio-core/tests/fixtures'
type Kind = 'move' | Direction
const DIRECTIONS: Direction[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']

/** One JSON document per area: a top-level object whose array members put one entry per line. */
function document(value: Record<string, unknown>): string {
  const lines = Object.entries(value).map(([key, member]) => Array.isArray(member)
    ? `${JSON.stringify(key)}:[\n${member.map(item => JSON.stringify(item)).join(',\n')}\n]`
    : `${JSON.stringify(key)}:${JSON.stringify(member)}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

const demoRegistry = () => widgetRegistry([], true)
const main = (snapshot: WorkbenchSnapshot, expanded = false): Surface => ({ ...snapshot.reference.main, region: 'main', expanded })
const regionSurface = (snapshot: WorkbenchSnapshot, region: Region): Surface => ({ ...snapshot.reference[region], region, expanded: false })
const box = (id: string, x: number, y: number, width = 100, height = 100): Placement => ({ id, x, y, width, height, region: 'main', preferred: { width, height } })

interface Scene { name: string; source: Placement[]; surface: Surface; constraints: Constraints }
function workbenchScene(name: string, snapshot: WorkbenchSnapshot, region: Region, surface = regionSurface(snapshot, region)): Scene {
  return { name, source: snapshot.placements.filter(p => p.region === region), surface, constraints: constraintsFor(surface, constraintsForViews(snapshot, demoRegistry())) }
}
function scenes() {
  const initial = initialWorkbench(true)
  const freeformSurface: Surface = { ...DEFAULT_FREEFORM.reference.main, region: 'main', expanded: false }
  const bottom = structuredClone(initial)
  bottom.placements = bottom.placements.filter(p => p.region !== 'bottom')
  bottom.placements.push({ id: 'chart', region: 'bottom', x: 0, y: 0, width: 700, height: 147, preferred: { width: 700, height: 147 } },
    { id: 'summary', region: 'bottom', x: 710, y: 0, width: 600, height: 147, preferred: { width: 600, height: 147 } })
  bottom.placements = bottom.placements.filter(p => !(p.id === 'summary' && p.region === 'main'))
  const constrained = structuredClone(initial), at = { width: 1000, height: 720 }
  const projected = projectRegion(constrained, 'main', at, false, constraintsForViews(constrained, demoRegistry()))
  constrained.reference.main = at
  constrained.placements = constrained.placements.map(p => projected.placements.find(q => q.id === p.id) ?? p)
  const synthetic: Constraints = Object.fromEntries(['moving', 'a', 'b'].map(id => [id, { min: { width: 100, height: 100 }, default: { width: 100, height: 100 }, max: { width: 800, height: 600 }, resizeX: true, resizeY: true, regions: ['main'], overflow: 'auto', responsive: 'region' }]))
  return {
    initial: workbenchScene('initial-main', initial, 'main'),
    expanded: workbenchScene('initial-main-expanded', initial, 'main', main(initial, true)),
    freeform: { name: 'freeform-main', source: structuredClone(DEFAULT_FREEFORM.placements), surface: freeformSurface, constraints: constraintsFor(freeformSurface, CONSTRAINTS) },
    sidebar: workbenchScene('initial-sidebar', initial, 'sidebar'),
    bottom: workbenchScene('bottom-pair', bottom, 'bottom'),
    constrained: workbenchScene('constrained-1000x720', constrained, 'main'),
    synthetic: { name: 'synthetic-pair', source: [box('a', 200, 0, 200, 180), box('moving', 440, 250, 200, 180)], surface: { region: 'main', width: 800, height: 600, expanded: false } as Surface, constraints: synthetic },
    triple: { name: 'synthetic-triple', source: [box('a', 0, 0, 200, 200), box('b', 400, 0, 200, 200), box('moving', 210, 300, 150, 150)], surface: { region: 'main', width: 800, height: 600, expanded: false } as Surface, constraints: synthetic }
  }
}

interface Script { scene: Scene; id: string; kind: Kind; frames: [number, number][] }
/** Mirrors useInteraction's solve(): every frame starts from the gesture source, carries the
 * previous frame's locks only after a valid result, and never accumulates drift. */
function runScript({ scene, id, kind, frames }: Script) {
  const original = scene.source.find(p => p.id === id)!
  let locks: AlignmentLocks | undefined
  const results = frames.map(([dx, dy]) => {
    const requested = candidate(original, dx, dy, kind, scene.surface, scene.constraints[id]!)
    const aligned = alignedGesture(scene.source, id, requested, scene.surface, scene.constraints, kind, locks)
    locks = aligned.result.status === 'valid' ? aligned.locks : undefined
    return { dx, dy, requested: { x: requested.x, y: requested.y, width: requested.width, height: requested.height }, result: aligned.result, locks: aligned.locks, guides: aligned.guides }
  })
  return { scene: scene.name, id, kind, frames: results }
}

function layoutFixtures() {
  const s = scenes(), scripts: Script[] = []
  const out = [[40, 30], [160, 120], [-60, -40], [0, 0]] as [number, number][]
  const inward = [[-40, -30], [-160, -120], [60, 40], [0, 0]] as [number, number][]
  for (const kind of DIRECTIONS) {
    scripts.push({ scene: s.initial, id: 'summary', kind, frames: out }, { scene: s.initial, id: 'activity', kind, frames: inward })
    scripts.push({ scene: s.freeform, id: 'properties', kind, frames: [[25, 25], [120, 90], [-80, -60], [-300, -300], [0, 0]] })
    scripts.push({ scene: s.constrained, id: 'queue', kind, frames: [[30, 20], [-90, 70], [0, 0]] })
  }
  scripts.push(
    { scene: s.initial, id: 'summary', kind: 'move', frames: [[50, 0], [300, 0], [300, 200], [800, 0], [5, 3], [0, 0]] },
    { scene: s.initial, id: 'activity', kind: 'move', frames: [[-400, 0], [-788.5, -392], [-3, 2], [0, 0]] },
    { scene: s.expanded, id: 'queue', kind: 'move', frames: [[400, 0], [900, 30], [0, 0]] },
    { scene: s.expanded, id: 'summary', kind: 'e', frames: [[500, 0], [2000, 0], [0, 0]] },
    { scene: s.freeform, id: 'summary', kind: 'move', frames: [[100, 0], [250, 0], [250, 40], [0, 0]] },
    { scene: s.freeform, id: 'queue', kind: 'se', frames: [[100, 100], [300, 200], [0, 0]] },
    { scene: s.freeform, id: 'properties', kind: 'move', frames: [[0, -100], [0, -200], [300, 0], [0, 0]] },
    { scene: s.freeform, id: 'notes', kind: 'e', frames: [[50, 0], [200, 0], [400, 0]] },
    { scene: s.freeform, id: 'chart', kind: 'move', frames: [[3, 4], [6, -5], [9, 0], [20, 0], [12, 0], [0, 0]] },
    { scene: s.freeform, id: 'activity', kind: 'w', frames: [[-30, 0], [-200, 0], [0, 0]] },
    { scene: s.freeform, id: 'library', kind: 'move', frames: [[-650, 300], [-300, 150], [0, 0]] },
    { scene: s.sidebar, id: 'notes', kind: 's', frames: [[0, 50], [0, 200], [0, -100], [0, 0]] },
    { scene: s.sidebar, id: 'notes', kind: 'move', frames: [[0, 320], [0, 600], [0, 0]] },
    { scene: s.sidebar, id: 'library', kind: 'n', frames: [[0, -100], [0, -310]] },
    { scene: s.bottom, id: 'summary', kind: 'move', frames: [[-300, 0], [-710, 0], [200, 0], [0, 0]] },
    { scene: s.bottom, id: 'chart', kind: 'e', frames: [[300, 0], [900, 0], [0, 0]] },
    { scene: s.bottom, id: 'summary', kind: 'w', frames: [[-200, 0], [-500, 0]] },
    { scene: s.constrained, id: 'summary', kind: 'move', frames: [[200, 100], [400, 300], [0, 0]] },
    { scene: s.synthetic, id: 'moving', kind: 'w', frames: [[26, 0], [30, 0], [0, 0]] },
    { scene: s.synthetic, id: 'moving', kind: 'move', frames: [[-26, -250], [-30, -245], [-40, -100], [0, 0]] },
    { scene: s.synthetic, id: 'moving', kind: 'nw', frames: [[-46, -64], [-50, -70], [-36, -60]] },
    { scene: s.triple, id: 'moving', kind: 'move', frames: [[-5, -95], [2, -90], [90, -100], [180, -300], [0, 0]] },
    { scene: s.triple, id: 'moving', kind: 'ne', frames: [[45, -95], [50, -92], [0, 0]] }
  )
  const initial = s.initial, summary = initial.source.find(p => p.id === 'summary')!
  const direct = (name: string, scene: Scene, id: string, rect: { x: number; y: number; width: number; height: number }, gesture: 'move' | 'insert' | Direction,
    budget?: { probes: number; states: number }, source = scene.source) => ({ name, scene: scene.name, source, id, rect, gesture, budget: budget ?? null,
    expected: reflow(source, id, rect, scene.surface, scene.constraints, gesture, budget) })
  const inserted: Placement = { id: 'chart', region: 'main', x: 0, y: 0, width: 230, height: 160, preferred: { width: 230, height: 160 } }
  const freeformSource = s.freeform.source
  const cases = [
    direct('push-budget-probes', initial, 'summary', { ...summary, x: 300 }, 'move', { probes: 3, states: 2048 }),
    direct('push-budget-states', initial, 'summary', { ...summary, x: 300 }, 'move', { probes: 8192, states: 1 }),
    direct('push-default', initial, 'summary', { ...summary, x: 300 }, 'move'),
    direct('space-fill', initial, 'summary', { x: 0, y: 0, width: 1567, height: 774 }, 'se'),
    direct('invalid-size-move', initial, 'summary', { ...summary, width: 700 }, 'move'),
    direct('invalid-out-of-bounds', initial, 'summary', { ...summary, x: 1000 }, 'move'),
    direct('invalid-unknown', initial, 'missing', { ...summary }, 'move'),
    direct('unchanged', initial, 'summary', { ...summary }, 'move'),
    direct('insert-initial', { ...initial, constraints: { ...initial.constraints } }, 'chart', inserted, 'insert', undefined, [...initial.source, inserted]),
    direct('insert-freeform', s.freeform, 'chart', { ...freeformSource.find(p => p.id === 'chart')!, x: 300, y: 100 }, 'insert', undefined,
      freeformSource.map(p => p.id === 'chart' ? { ...p, x: 300, y: 100 } : p)),
    direct('freeform-compress', s.freeform, 'queue', { x: 240, y: 0, width: 400, height: 560 }, 's'),
    direct('freeform-budget-small', s.freeform, 'queue', { x: 240, y: 0, width: 700, height: 560 }, 'se', { probes: 40, states: 12 }),
    direct('sidebar-push', s.sidebar, 'notes', { x: 0, y: 0, width: 253, height: 600 }, 's'),
    direct('bottom-push', s.bottom, 'chart', { x: 0, y: 0, width: 1200, height: 147 }, 'e')
  ]
  const ids = ['summary', 'Summary', 'host:notes', 'host:notes:view:main', 'host:notes-view', 'host:notes_view', 'host:notes.view', 'host:file-editor', 'host:file-explorer',
    'plugin:geppio.workspace-essentials:notes', 'plugin:geppio.workspace-essentials:checklist', 'plugin:local.counter:counter', 'a', 'A', 'a-', 'a_', 'a.', 'a:', 'a0', 'a9', 'aB', 'Ab',
    'group:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', 'group:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f1', 'group:a0000000-0000-4000-8000-000000000000', 'zz', 'Z', '9', '0']
  return document({
    collation: [...ids].sort((a, b) => a.localeCompare(b)),
    scripts: scripts.map(runScript),
    reflow: cases,
    scenes: Object.values(s).map(scene => ({ name: scene.name, source: scene.source, surface: scene.surface, constraints: scene.constraints }))
  })
}

function projectionFixtures() {
  const viewports = [{ name: '1280x800', width: 1280, height: 800 }, { name: '1000x720', width: 1000, height: 720 }, { name: 'constrained-760x560', width: 760, height: 560 }, { name: 'tiny-500x400', width: 500, height: 400 }]
  // Region inner sizes follow the shell with default tracks: Sidebar 283 (+48 rail), Bottom 167.
  const available = (v: { width: number; height: number }): Record<Region, Size> => ({
    main: { width: v.width - 353, height: v.height - 306 }, sidebar: { width: 253, height: v.height - 121 }, bottom: { width: v.width - 353, height: 147 } })
  const initial = initialWorkbench(true), cases: unknown[] = []
  const sources: { name: string; snapshot: WorkbenchSnapshot | typeof DEFAULT_FREEFORM; constraints: Constraints }[] = [
    { name: 'initial', snapshot: initial, constraints: constraintsForViews(initial, demoRegistry()) },
    { name: 'default-freeform', snapshot: DEFAULT_FREEFORM, constraints: CONSTRAINTS }
  ]
  for (const source of sources) for (const viewport of viewports) for (const region of ['main', 'sidebar', 'bottom'] as const) for (const expanded of [false, true]) {
    if (expanded && region !== 'main') continue
    const size = available(viewport)[region]
    const projection = projectRegion(source.snapshot, region, size, expanded, source.constraints)
    // A→B→A: projecting the projection back to the reference yields a stable result.
    const back = projection.feasible ? projectRegion({ ...source.snapshot, reference: { ...source.snapshot.reference, [region]: size }, placements: projection.placements }, region, source.snapshot.reference[region], expanded, source.constraints) : null
    cases.push({ name: `${source.name}/${viewport.name}/${region}${expanded ? '/expanded' : ''}`, source: source.name, region, available: size, expanded, expected: projection, back })
  }
  const direct = projectRegion(initial, 'main', initial.reference.main, false, constraintsForViews(initial, demoRegistry()))
  cases.push({ name: 'initial/reference/main', source: 'initial', region: 'main', available: initial.reference.main, expanded: false, expected: direct, back: null })
  return document({
    sources: sources.map(source => ({ name: source.name, reference: source.snapshot.reference, placements: source.snapshot.placements, constraints: source.constraints })),
    cases
  })
}

const plugin = (id: string, name: string, apiVersion: 1 | 2 | 3, widgets: string[], recoveryWidgets?: string[]): InstalledPlugin => ({ enabled: true, revision: 'fixture',
  manifest: { schemaVersion: 1, apiVersion, id, name, version: '1.0.0', entry: 'entry.js', widgets: widgets.map(widget => ({ id: widget, title: widget, surface: 'declarative' as const })) },
  ...(recoveryWidgets ? { recoveryWidgets: recoveryWidgets.map(widget => ({ id: widget, title: widget, surface: 'declarative' as const })) } : {}) })
const PLUGINS: InstalledPlugin[] = [
  plugin('local.counter', 'Counter', 1, ['counter']),
  plugin('geppio.workspace-essentials', 'Workspace Essentials', 2, ['notes', 'checklist', 'prompts', 'scratch']),
  plugin('geppio.time-tracker', 'Time Tracker', 2, ['timer', 'reports'], ['legacy'])
]
const REGISTRIES = {
  demo: () => widgetRegistry([], true), production: () => widgetRegistry([], false),
  plugins: () => widgetRegistry(PLUGINS, true), 'plugins-production': () => widgetRegistry(PLUGINS, false)
} satisfies Record<string, () => Registry>
type RegistryName = keyof typeof REGISTRIES
const registryOf = (name: RegistryName) => REGISTRIES[name]()

function registryFixtures() {
  return document({
    plugins: PLUGINS.map(p => ({ id: p.manifest.id, name: p.manifest.name, apiVersion: p.manifest.apiVersion, widgets: p.manifest.widgets.map(w => ({ id: w.id, title: w.title })),
      recoveryWidgets: (p.recoveryWidgets ?? []).map(w => ({ id: w.id, title: w.title })) })),
    registries: (Object.keys(REGISTRIES) as RegistryName[]).map(name => ({ name, demo: !name.endsWith('production'), plugins: name.startsWith('plugins'), types: [...registryOf(name).values()] })),
    initial: [
      { name: 'demo', snapshot: JSON.stringify(initialWorkbench(true)) },
      { name: 'production', snapshot: JSON.stringify(initialWorkbench(false)) },
      { name: 'adopted-default', snapshot: JSON.stringify(adoptLayout(DEFAULT_FREEFORM)) }
    ]
  })
}

function attempt<T>(run: () => T): { ok: true; value: T } | { ok: false; error: string; errorName: string } {
  try { return { ok: true, value: run() } } catch (e) { return { ok: false, error: (e as Error).message, errorName: (e as Error).name } }
}
const GROUP_ID = 'group:0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0'
const essentials = (name: string) => `plugin:geppio.workspace-essentials:${name}`
/** Plugin scene with a two-member Workspace Essentials tab group in Main (deterministic id). */
function groupScene() {
  const registry = registryOf('plugins')
  let next = initialWorkbench(true)
  const main: Surface = { ...next.reference.main, region: 'main', expanded: false }
  for (const name of ['notes', 'checklist', 'prompts']) next = addWidget(next, registry, essentials(name), main)!
  const id = (name: string) => next.organization.views.find(view => view.typeId === essentials(name))!.id
  const grouped = groupWidgets(next, registry, id('notes'), id('checklist'))!
  grouped.organization.groups!.entries[0]!.id = GROUP_ID
  return grouped
}
/** Grid fixtures in CSS pixels at a 100px pitch (cell minus the 10px gutter), never rounded. */
function gridLayouts() {
  return Object.entries(COMPOSITIONS).map(([name, grid]) => {
    const pitch = 100, layout = structuredClone(DEFAULT_FREEFORM)
    layout.reference.main = { width: grid.columns * pitch - 10, height: grid.rows * pitch - 10 }
    layout.placements = grid.placements.map(p => ({ id: p.id, region: 'main' as const, x: p.x * pitch, y: p.y * pitch, width: p.w * pitch - 10, height: p.h * pitch - 10,
      preferred: { width: p.preferred.w * pitch - 10, height: p.preferred.h * pitch - 10 } }))
    return { name: `grid-${name}`, layout }
  })
}
function documents() {
  const demo = registryOf('demo'), production = registryOf('production'), plugins = registryOf('plugins')
  const initialRaw = serializeWorkbench(initialWorkbench(true), demo)
  const archived = serializeWorkbench(parseWorkbench(initialRaw, production), production)
  const presented = changePresentation(changePresentation(initialWorkbench(true), { presentation: 'docked', anchor: 'bottom' }, demo, 'properties'),
    { presentation: 'overlay', anchor: null, preferred: { width: 300, height: 260 }, position: { x: 40, y: 80 } }, demo, 'summary')
  const withLibrary = initialWorkbench(true)
  withLibrary.organization.compositions = systemCompositions().map((preset, i) => ({ ...structuredClone(preset), id: `composition:preset-${i}`, system: false }))
  withLibrary.organization.compositions.push({ ...structuredClone(systemCompositions()[1]!), id: 'composition:format-only', name: 'Só formato', mode: 'format', views: [], placements: [], system: false })
  withLibrary.organization.favorites = ['system:default', 'composition:preset-1']
  withLibrary.organization.defaultComposition = 'composition:preset-1'
  withLibrary.organization.compositionOrder = ['composition:preset-2', 'system:focus']
  withLibrary.organization.chrome = { sidebar: { visible: false, size: 300.25 }, bottom: { visible: true, size: 125 } }
  const recipe = parsePortableLayout({ kind: 'geppio-layout', version: 1, name: 'Receita portátil', mode: 'format-widgets', scopes: ['main', 'bottom'],
    reference: { main: { width: 1200, height: 700 }, bottom: { width: 1200, height: 160 } }, chrome: { sidebar: { size: 250 }, bottom: { size: 180 } },
    format: [{ key: 's1', region: 'main', x: 0, y: 0, width: 590, height: 700 }, { key: 's2', region: 'bottom', x: 0, y: 0, width: 1200, height: 160 }],
    views: [{ key: 'v1', ref: { host: 'host:file-editor' } }, { key: 'v2', ref: { host: 'host:terminal' } }, { key: 'v3', ref: { pluginId: 'geppio.workspace-essentials', widgetId: 'notes' } }],
    placements: [{ view: 'v1', region: 'main', x: 0, y: 0, width: 590, height: 700, preferred: { width: 590, height: 700 } },
      { view: 'v3', region: 'main', x: 600, y: 0, width: 400, height: 300, preferred: { width: 400, height: 300 } },
      { view: 'v2', region: 'bottom', x: 0, y: 0, width: 800, height: 160, preferred: { width: 800, height: 160 } }], groups: [] })
  const portable = initialWorkbench(true)
  portable.organization.compositions = [storedPortableComposition('composition:portable-1', 'Receita portátil', recipe), ...withLibrary.organization.compositions.slice(0, 1)]
  const grouped = groupScene(), sidebarGroup = moveView(grouped, plugins, grouped.organization.groups!.entries[0]!.frameId, { region: 'sidebar', width: 253, height: 950, expanded: false })!
  const barScene = initialWorkbench(true)
  barScene.organization.bars.push(...['work', 'old', 'b2', 'b3'].map(id => ({ id, name: `Barra ${id}`, userNamed: true, icon: 'star', archived: id === 'old', members: [], positions: {} })))
  const docs: { name: string; registry: RegistryName; raw: string }[] = [
    { name: 'bars', registry: 'demo', raw: serializeWorkbench(barScene, demo) },
    { name: 'initial-demo', registry: 'demo', raw: initialRaw },
    { name: 'initial-production', registry: 'production', raw: serializeWorkbench(initialWorkbench(false), production) },
    { name: 'demo-retired-on-load', registry: 'production', raw: initialRaw },
    { name: 'archive-round-trip', registry: 'production', raw: archived },
    { name: 'adopted-default', registry: 'demo', raw: serializeWorkbench(adoptLayout(DEFAULT_FREEFORM), demo) },
    { name: 'presentations', registry: 'demo', raw: serializeWorkbench(presented, demo) },
    { name: 'library', registry: 'demo', raw: serializeWorkbench(withLibrary, demo) },
    { name: 'portable-v3', registry: 'plugins', raw: serializeWorkbench(portable, plugins) },
    { name: 'group-main', registry: 'plugins', raw: serializeWorkbench(grouped, plugins) },
    { name: 'group-sidebar', registry: 'plugins', raw: serializeWorkbench(sidebarGroup, plugins) },
    { name: 'group-composition', registry: 'plugins', raw: serializeWorkbench({ ...grouped, organization: { ...grouped.organization,
      compositions: [{ ...captureComposition(grouped, 'Com grupo', 'format-widgets', ['main'], { bottom: { size: 180 } }), id: 'composition:grouped' }] } }, plugins) },
    { name: 'plugins-production', registry: 'plugins-production', raw: serializeWorkbench(grouped, plugins) },
    ...gridLayouts().map(({ name, layout }) => ({ name, registry: 'demo' as const, raw: serializeWorkbench(adoptLayout(layout), demo) }))
  ]
  return { docs, initialRaw, archived }
}

/** Number spellings JSON.stringify never produces, injected into raw documents. */
const RAW_NUMBERS = { __INF__: '1e400', __E1__: '7.785e2', __E2__: '1.567E3', __E3__: '788.50000000000001', __NEGZERO__: '-0' }
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
function mutate(raw: string, change: (doc: Doc) => void) { const doc = JSON.parse(raw) as Doc; change(doc); return JSON.stringify(doc) }
function codecFixtures() {
  const { docs, initialRaw, archived } = documents()
  const presentations = docs.find(doc => doc.name === 'presentations')!.raw, library = docs.find(doc => doc.name === 'library')!.raw
  const grouped = docs.find(doc => doc.name === 'group-main')!.raw, portable = docs.find(doc => doc.name === 'portable-v3')!.raw
  const m = (name: string, change: (doc: Doc) => void, source = initialRaw, registry: RegistryName = 'demo') => ({ name, registry, raw: mutate(source, change) })
  const placement = (doc: Doc, id: string) => doc.layout.placements.find((p: Doc) => p.id === id)
  const cases = [
    ...docs,
    m('legacy-schema-1', doc => { doc.schemaVersion = 1 }),
    m('chrome-absent', doc => { delete doc.organization.chrome }),
    m('presentation-extra-keys', doc => { const entry = doc.organization.presentations.entries[0]; entry.preferred = { height: 260, width: 300, note: 'kept', 7: true }; entry.position = { y: 5, x: 6.5 } }, presentations),
    m('positions-reordered', doc => { doc.organization.bars[0].positions = { 'host:library': 310, 'host:notes': 0 } }),
    m('numbers-exotic', doc => { placement(doc, 'summary').width = '__E1__'; doc.layout.reference.main.width = '__E2__'; placement(doc, 'queue').x = '__E3__'; placement(doc, 'summary').y = '__NEGZERO__' }),
    m('fractional-geometry', doc => { const p = placement(doc, 'summary'); p.width = 700.123456789; p.preferred.width = 700.123456789; doc.layout.reference.bottom.width = 1543.0000001 }),
    { name: 'corrupt-json', registry: 'demo' as const, raw: initialRaw.slice(0, 200) },
    { name: 'empty', registry: 'demo' as const, raw: '' },
    { name: 'not-object', registry: 'demo' as const, raw: '[]' },
    m('future-version', doc => { doc.schemaVersion = 4 }),
    m('string-version', doc => { doc.schemaVersion = '2' }),
    m('wrong-kind', doc => { doc.kind = 'geppio-layout' }),
    { name: 'oversized', registry: 'demo' as const, raw: initialRaw + ' '.repeat(64 * 1024) },
    m('oversized-utf8', doc => { doc.organization.bars[0].name = 'é'.repeat(40000) }),
    m('name-too-long', doc => { doc.organization.bars[0].name = 'x'.repeat(101) }),
    m('name-blank', doc => { doc.organization.bars[0].name = '  ﻿ ' }),
    m('duplicate-view-ids', doc => { doc.organization.views.push(doc.organization.views[0]) }),
    m('duplicate-placement', doc => { doc.layout.placements.push(doc.layout.placements[0]) }),
    m('duplicate-bar', doc => { doc.organization.bars.push({ ...doc.organization.bars[0], name: 'Outra' }) }),
    m('negative-x', doc => { placement(doc, 'summary').x = -1 }),
    m('width-below-min', doc => { placement(doc, 'summary').width = 100 }),
    m('width-above-max', doc => { placement(doc, 'summary').width = 5000 }),
    m('preferred-below-min', doc => { placement(doc, 'queue').preferred.height = 10 }),
    m('beyond-reference-height', doc => { placement(doc, 'activity').y = 400 }),
    m('reference-zero', doc => { doc.layout.reference.bottom.height = 0 }),
    m('reference-too-large', doc => { doc.layout.reference.main.width = 100001 }),
    m('infinite-number', doc => { placement(doc, 'summary').x = '__INF__' }),
    m('sidebar-x-nonzero', doc => { placement(doc, 'notes').x = 3 }),
    m('sidebar-width-mismatch', doc => { placement(doc, 'notes').width = 250 }),
    m('bottom-height-mismatch', doc => { placement(doc, 'chart').height = 140 }),
    m('clearance-overlap', doc => { placement(doc, 'queue').x = 780 }),
    m('ineligible-region', doc => { placement(doc, 'queue').region = 'sidebar' }),
    m('unknown-type', doc => { doc.organization.views[0].typeId = 'host:unknown'; doc.organization.views[0].modelId = 'model:host:unknown' }),
    m('wrong-model', doc => { doc.organization.views[0].modelId = 'model:host:queue' }),
    m('wrong-host-view', doc => { doc.organization.views[0].id = 'summary-2'; placement(doc, 'summary').id = 'summary-2' }),
    m('qualified-host-view', doc => { doc.organization.views[0].id = 'host:summary:view:main'; placement(doc, 'summary').id = 'host:summary:view:main' }),
    m('unqualified-plugin-view', doc => { doc.organization.views.find((v: Doc) => v.typeId === essentials('prompts')).id = 'prompts-view' }, grouped, 'plugins'),
    m('bad-identifier', doc => { doc.organization.views[0].id = '-summary' }),
    m('bar-bad-icon', doc => { doc.organization.bars[0].icon = 'rocket' }),
    m('home-not-first', doc => { doc.organization.bars.unshift({ id: 'work', name: 'Trabalho', userNamed: true, icon: 'code', archived: false, members: [] }) }),
    m('home-archived', doc => { doc.organization.bars[0].archived = true }),
    m('bar-member-not-sidebar', doc => { doc.organization.bars[0].members.push('host:queue') }),
    m('bar-positions-not-member', doc => { doc.organization.bars[0].positions['host:chart'] = 10 }),
    m('bar-position-negative', doc => { doc.organization.bars[0].positions['host:notes'] = -5 }),
    m('too-many-active-bars', doc => { for (let i = 0; i < 21; i++) doc.organization.bars.push({ id: `bar-${i}`, name: `Barra ${i}`, userNamed: true, icon: 'star', archived: false, members: [] }) }),
    m('legacy-active-bars', doc => { for (let i = 0; i < 20; i++) doc.organization.bars.push({ id: `bar-${i}`, name: `Barra ${i}`, userNamed: true, icon: 'star', archived: i % 3 === 0, members: [] }) }),
    m('missing-sidebar-view', doc => { doc.organization.bars.push({ id: 'other', name: 'Outra', userNamed: true, icon: 'star', archived: false, members: ['host:summary'] }) }),
    m('bar-clearance', doc => { doc.organization.bars[0].positions['host:library'] = 100 }),
    m('active-bar-unknown', doc => { doc.organization.activeBar = 'nowhere' }),
    m('active-bar-archived', doc => { doc.organization.bars.push({ id: 'old', name: 'Antiga', userNamed: true, icon: 'star', archived: true, members: [] }); doc.organization.activeBar = 'old' }),
    m('favorite-unknown', doc => { doc.organization.favorites.push('composition:nope') }),
    m('default-missing', doc => { delete doc.organization.defaultComposition }),
    m('default-not-favorite', doc => { doc.organization.defaultComposition = 'system:focus'; doc.organization.favorites = ['system:default'] }),
    m('default-null', doc => { doc.organization.defaultComposition = null }),
    m('chrome-unknown-region', doc => { doc.organization.chrome.top = { visible: true, size: 200 } }),
    m('chrome-size-out-of-range', doc => { doc.organization.chrome.sidebar.size = 500 }),
    m('chrome-partial', doc => { delete doc.organization.chrome.bottom.visible }),
    m('presentation-edge-conflict', doc => { doc.organization.presentations.entries[1].anchor = 'bottom'; doc.organization.presentations.entries[1].presentation = 'docked' }, presentations),
    m('presentation-bad-anchor', doc => { doc.organization.presentations.entries[0].anchor = 'middle' }, presentations),
    m('presentation-normal-anchor', doc => { doc.organization.presentations.entries[0].presentation = 'normal' }, presentations),
    m('presentations-future', doc => { doc.organization.presentations.version = 3 }, presentations),
    m('presentations-v1', doc => { doc.organization.presentations = { version: 1, entries: [{ ...doc.organization.presentations.entries[0], anchor: 'bottom' }] } }, presentations),
    m('presentation-unsupported-type', doc => { doc.organization.presentations.entries[0].viewId = 'chart'; doc.organization.presentations.entries[0].typeId = 'host:chart'; doc.organization.presentations.entries[0].modelId = 'model:host:chart' }, presentations),
    m('composition-group-format', doc => { doc.organization.compositions[0].mode = 'format' }, docs.find(doc => doc.name === 'group-composition')!.raw, 'plugins'),
    m('composition-group-unscoped', doc => { doc.organization.compositions[0].scopes = ['bottom']; doc.organization.compositions[0].placements = []; doc.organization.compositions[0].format = [] }, docs.find(doc => doc.name === 'group-composition')!.raw, 'plugins'),
    m('group-bad-id', doc => { doc.organization.groups.entries[0].id = 'group:1' }, grouped, 'plugins'),
    m('group-extra-key', doc => { doc.organization.groups.entries[0].label = 'x' }, grouped, 'plugins'),
    m('group-non-tab-member', doc => { doc.organization.groups.entries[0].members.push('summary') }, grouped, 'plugins'),
    m('group-missing-frame', doc => { const g = doc.organization.groups.entries[0]; g.frameId = g.members[1] }, grouped, 'plugins'),
    m('composition-system', doc => { doc.organization.compositions[0].system = true }, library),
    m('composition-bad-id', doc => { doc.organization.compositions[0].id = 'composition:' }, library),
    m('composition-bad-scope', doc => { doc.organization.compositions[0].scopes = ['sidebar'] }, library),
    m('composition-overlap-format', doc => { const c = doc.organization.compositions[1]; c.format[1] = { ...c.format[0], id: 'format:x' } }, library),
    m('composition-format-with-views', doc => { doc.organization.compositions[0].mode = 'format' }, library),
    m('composition-order-unknown', doc => { doc.organization.compositionOrder.push('composition:missing') }, library),
    m('composition-name-last', doc => { const c = doc.organization.compositions[0]; c.name = ''; c.format[0].x = -1 }, library),
    m('portable-in-v2', doc => { doc.schemaVersion = 2 }, portable, 'plugins'),
    m('portable-extra-key', doc => { doc.organization.compositions[0].system = false }, portable, 'plugins'),
    m('portable-bad-recipe', doc => { doc.organization.compositions[0].portable.version = 2 }, portable, 'plugins'),
    m('portable-control-name', doc => { doc.organization.compositions[0].portable.name = 'a\u0007b' }, portable, 'plugins'),
    m('archive-conflict', doc => { doc.organization.views.push({ id: 'summary', typeId: 'host:summary', modelId: 'model:host:summary' }); doc.layout.placements.push({ id: 'summary', region: 'main', x: 0, y: 0, width: 400, height: 300, preferred: { width: 400, height: 300 } }) }, archived, 'production'),
    m('archive-not-object', doc => { doc.retiredDemos = [] }, archived, 'production'),
    m('archive-bad-owner', doc => { doc.retiredDemos.views.push({ id: 'host:file-editor:view:main', typeId: 'host:file-editor', modelId: 'model:host:file-editor' }) }, archived, 'production'),
    m('occupied-presence', doc => { doc.organization.views.push({ id: 'host:summary:view:bottom', typeId: 'host:summary', modelId: 'model:host:summary' }); doc.layout.placements.push({ id: 'host:summary:view:bottom', region: 'bottom', x: 0, y: 0, width: 200, height: 147, preferred: { width: 200, height: 147 } }); placement(doc, 'chart').x = 210; placement(doc, 'chart').width = 1333 })
  ].map(item => ({ ...item, raw: Object.entries(RAW_NUMBERS).reduce((raw, [token, text]) => raw.replace(`"${token}"`, text), item.raw) }))
  return document({
    cases: cases.map(({ name, registry: registryName, raw }) => {
      const registry = registryOf(registryName), parsed = attempt(() => parseWorkbench(raw, registry))
      if (!parsed.ok) return { name, registry: registryName, raw, expected: { ok: false, error: parsed.error, errorName: parsed.errorName } }
      const serialized = attempt(() => serializeWorkbench(parsed.value, registry))
      return { name, registry: registryName, raw, expected: { ok: true, snapshot: JSON.stringify(parsed.value),
        serialized: serialized.ok ? serialized.value : null, serializeError: serialized.ok ? null : serialized.error,
        reparsed: serialized.ok ? JSON.stringify(parseWorkbench(serialized.value, registry)) : null } }
    })
  })
}

interface CommandCase { name: string; document: string; command: Record<string, unknown>; run(source: WorkbenchSnapshot, registry: Registry): WorkbenchSnapshot | null }
function commandFixtures() {
  const { docs } = documents()
  const doc = (name: string) => docs.find(item => item.name === name)!
  const s = (region: Region, width: number, height: number, expanded = false): Surface => ({ region, width, height, expanded })
  const mainOf = (source: WorkbenchSnapshot) => ({ ...source.reference.main, region: 'main' as const, expanded: false })
  const add = (name: string, document: string, typeId: string, surface: Surface, at?: { x: number; y: number }, slot?: Size, disabled?: string[]): CommandCase => ({ name, document,
    command: { kind: 'add', typeId, surface, at: at ?? null, slot: slot ?? null, disabled: disabled ?? [] }, run: (source, registry) => addWidget(source, registry, typeId, surface, at, disabled && new Set(disabled), slot) })
  const move = (name: string, document: string, id: string, surface: Surface, at?: { x: number; y: number }, sourceBar?: string, slot?: Size): CommandCase => ({ name, document,
    command: { kind: 'move', id, surface, at: at ?? null, sourceBar: sourceBar ?? null, slot: slot ?? null }, run: (source, registry) => moveView(source, registry, id, surface, at, sourceBar, slot) })
  const swap = (name: string, document: string, a: string, b: string): CommandCase => ({ name, document, command: { kind: 'swap', a, b }, run: (source, registry) => swapViews(source, registry, a, b) })
  const remove = (name: string, document: string, id: string): CommandCase => ({ name, document, command: { kind: 'remove', id }, run: (source, registry) => removePresence(source, id, registry) })
  const pair = (name: string, document: string, first: string, second: string, axis: 'x' | 'y', delta: number): CommandCase => ({ name, document,
    command: { kind: 'resizePair', first, second, axis, delta }, run: (source, registry) => resizePair(source, registry, { kind: 'resizePair', first, second, axis, delta }) })
  const initial = parseWorkbench(doc('initial-demo').raw, registryOf('demo'))
  const fit = (name: string, document: string, targets: Placement[], reference: WorkbenchSnapshot['reference'], scopes: Region[]): CommandCase => ({ name, document,
    command: { kind: 'fit', targets, reference, scopes }, run: (source, registry) => fitTargets(source, registry, targets, reference, scopes) })
  const bar = (id: string, members: string[], extra: Partial<UserBar> = {}): UserBar => ({ id, name: `Barra ${id}`, userNamed: true, icon: 'code', archived: false, members, positions: {}, ...extra })
  const barCases = (sidebar: Surface): CommandCase[] => [
    { name: 'update-new', document: 'initial-demo', command: { kind: 'updateBar', bar: bar('fresh', []) }, run: source => updateBar(source, bar('fresh', [])) },
    { name: 'update-blank', document: 'initial-demo', command: { kind: 'updateBar', bar: bar('fresh', [], { name: '   ' }) }, run: source => updateBar(source, bar('fresh', [], { name: '   ' })) },
    { name: 'update-home-archived', document: 'bars', command: { kind: 'updateBar', bar: bar('home', [], { archived: true }) }, run: source => updateBar(source, bar('home', [], { archived: true })) },
    { name: 'update-rename', document: 'bars', command: { kind: 'updateBar', bar: bar('work', [], { name: 'Renomeada', icon: 'git' }) }, run: source => updateBar(source, bar('work', [], { name: 'Renomeada', icon: 'git' })) },
    { name: 'configure-existing', document: 'bars', command: { kind: 'configureBar', bar: bar('work', ['host:file-explorer']), surface: sidebar, disabled: [] },
      run: (source, registry) => configureBar(source, registry, bar('work', ['host:file-explorer']), sidebar) },
    { name: 'configure-new', document: 'initial-demo', command: { kind: 'configureBar', bar: bar('tools', ['host:file-explorer', 'host:git-changes']), surface: sidebar, disabled: [] },
      run: (source, registry) => configureBar(source, registry, bar('tools', ['host:file-explorer', 'host:git-changes']), sidebar) },
    { name: 'configure-home', document: 'initial-demo', command: { kind: 'configureBar', bar: bar('home', ['host:library', 'host:notes'], { name: 'Ferramentas', icon: 'home', userNamed: false, positions: { 'host:notes': 0 } }), surface: sidebar, disabled: [] },
      run: (source, registry) => configureBar(source, registry, bar('home', ['host:library', 'host:notes'], { name: 'Ferramentas', icon: 'home', userNamed: false, positions: { 'host:notes': 0 } }), sidebar) },
    { name: 'configure-narrow', document: 'initial-demo', command: { kind: 'configureBar', bar: bar('tools', ['host:file-explorer']), surface: { ...sidebar, width: 120 }, disabled: [] },
      run: (source, registry) => configureBar(source, registry, bar('tools', ['host:file-explorer']), { ...sidebar, width: 120 }) },
    { name: 'configure-partial-group', document: 'group-sidebar', command: { kind: 'configureBar', bar: bar('home', ['host:notes', essentials('checklist')], { name: 'Ferramentas', icon: 'home' }), surface: sidebar, disabled: [] },
      run: (source, registry) => configureBar(source, registry, bar('home', ['host:notes', essentials('checklist')], { name: 'Ferramentas', icon: 'home' }), sidebar) },
    { name: 'delete-archived', document: 'bars', command: { kind: 'deleteBar', id: 'old' }, run: source => deleteBar(source, 'old') },
    { name: 'delete-active', document: 'bars', command: { kind: 'deleteBar', id: 'work' }, run: source => deleteBar(source, 'work') },
    { name: 'delete-home', document: 'bars', command: { kind: 'deleteBar', id: 'home' }, run: source => deleteBar(source, 'home') },
    { name: 'reorder-up', document: 'bars', command: { kind: 'reorderBar', id: 'b3', offset: -2 }, run: source => reorderBar(source, 'b3', -2) },
    { name: 'reorder-home', document: 'bars', command: { kind: 'reorderBar', id: 'home', offset: 1 }, run: source => reorderBar(source, 'home', 1) },
    { name: 'reorder-out', document: 'bars', command: { kind: 'reorderBar', id: 'work', offset: -1 }, run: source => reorderBar(source, 'work', -1) }
  ]
  const groupFrame = parseWorkbench(doc('group-main').raw, registryOf('plugins')).organization.groups!.entries[0]!
  const sidebar = s('sidebar', 253, 950), bottom = s('bottom', 1543, 147), main = mainOf(initial)
  const cases: CommandCase[] = [
    add('add-editor-main', 'initial-demo', 'host:file-editor', main),
    add('add-editor-at', 'initial-demo', 'host:file-editor', main, { x: 900, y: 500 }),
    add('add-terminal-bottom', 'initial-demo', 'host:terminal', bottom),
    add('add-explorer-sidebar', 'initial-demo', 'host:file-explorer', sidebar),
    add('add-git-sidebar-at', 'initial-demo', 'host:git-changes', sidebar, { x: 0, y: 100 }),
    add('add-notes-main', 'initial-demo', 'host:notes', main),
    add('add-chart-main-moves', 'initial-demo', 'host:chart', main, { x: 10, y: 10 }),
    add('add-slot', 'adopted-default', 'host:file-editor', s('main', 960, 620), { x: 0, y: 0 }, { width: 330, height: 250 }),
    add('add-freeform-space', 'adopted-default', 'host:terminal', s('main', 960, 620), { x: 400, y: 500 }),
    add('add-expanded', 'adopted-default', 'host:file-editor', s('main', 960, 620, true), { x: 900, y: 0 }),
    add('add-retired', 'initial-production', 'host:summary', s('main', 1567, 774)),
    add('add-production-empty', 'initial-production', 'host:file-editor', s('main', 1567, 774)),
    add('add-production-sidebar', 'initial-production', 'host:file-explorer', sidebar),
    add('add-paused', 'group-main', 'plugin:local.counter:counter', main, undefined, undefined, ['plugin:local.counter']),
    add('add-plugin', 'group-main', 'plugin:local.counter:counter', main),
    add('add-grouped-occupied', 'group-main', essentials('checklist'), main),
    move('move-summary-bottom', 'initial-demo', 'summary', bottom, { x: 0, y: 0 }),
    move('move-notes-main', 'initial-demo', 'notes', main, { x: 100, y: 100 }),
    move('move-chart-main', 'initial-demo', 'chart', main, { x: 400, y: 200 }),
    move('move-queue-sidebar', 'initial-demo', 'queue', sidebar),
    move('move-library-top', 'initial-demo', 'library', sidebar, { x: 0, y: 0 }),
    move('move-properties-sidebar', 'initial-demo', 'properties', sidebar, { x: 0, y: 320 }),
    move('move-slot', 'adopted-default', 'chart', s('bottom', 960, 128), { x: 10, y: 0 }, undefined, { width: 300, height: 128 }),
    move('move-freeform-main', 'adopted-default', 'queue', s('main', 960, 620), { x: 600, y: 400 }),
    move('move-group-sidebar', 'group-main', groupFrame.frameId, sidebar),
    move('move-group-bottom', 'group-main', groupFrame.frameId, bottom, { x: 0, y: 0 }),
    move('move-group-member-frame', 'group-sidebar', groupFrame.frameId, main, { x: 50, y: 50 }),
    swap('swap-main', 'initial-demo', 'summary', 'activity'),
    swap('swap-cross', 'initial-demo', 'summary', 'chart'),
    swap('swap-sidebar', 'initial-demo', 'notes', 'library'),
    swap('swap-sidebar-main', 'initial-demo', 'notes', 'properties'),
    swap('swap-incompatible', 'initial-demo', 'queue', 'notes'),
    swap('swap-same', 'initial-demo', 'queue', 'queue'),
    remove('remove-summary', 'initial-demo', 'summary'),
    remove('remove-notes', 'initial-demo', 'notes'),
    remove('remove-missing', 'initial-demo', 'nowhere'),
    remove('remove-group-frame', 'group-main', groupFrame.frameId),
    remove('remove-group-member', 'group-main', groupFrame.members[1]!),
    pair('pair-x', 'initial-demo', 'summary', 'queue', 'x', 50),
    pair('pair-x-negative', 'initial-demo', 'properties', 'activity', 'x', -120.25),
    pair('pair-y', 'initial-demo', 'summary', 'properties', 'y', -30),
    pair('pair-sidebar', 'initial-demo', 'notes', 'library', 'y', 20),
    pair('pair-too-far', 'initial-demo', 'summary', 'queue', 'x', 700),
    pair('pair-not-adjacent', 'initial-demo', 'summary', 'activity', 'x', 10),
    pair('pair-sidebar-x', 'initial-demo', 'notes', 'library', 'x', 10),
    fit('fit-main', 'initial-demo', initial.placements.map(p => p.region === 'main' ? { ...p, x: p.x / 2, width: p.width / 2 } : p), { ...initial.reference, main: { width: 783.5, height: 774 } }, ['main']),
    fit('fit-main-bottom', 'initial-demo', initial.placements, initial.reference, ['main', 'bottom']),
    ...barCases(sidebar),
    fit('fit-infeasible', 'initial-demo', initial.placements.map(p => ({ ...p, width: p.width * 3 })), initial.reference, ['main'])
  ]
  return document({
    cases: cases.map(item => {
      const registry = registryOf(doc(item.document).registry), source = parseWorkbench(doc(item.document).raw, registry)
      const result = item.run(source, registry)
      return { name: item.name, document: item.document, command: item.command, expected: result ? JSON.stringify(result) : null }
    }),
    documents: docs
  })
}

/** FNV-1a (32-bit) over UTF-16 code units: a compact digest of each observed signature. */
function fnv1a(text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0 }
  return hash.toString(16).padStart(8, '0')
}
function historyFixtures() {
  const source = initialWorkbench(true)
  type Step = { op: 'record' | 'gesture-set'; id: string; x: number } | { op: 'record-same' | 'undo' | 'redo' | 'begin' | 'finish' | 'abort' | 'clear' }
  const steps: Step[] = []
  for (let i = 0; i < 300; i++) {
    steps.push({ op: 'record', id: ['summary', 'queue', 'notes', 'chart'][i % 4]!, x: (i * 7.25) % 500 })
    if (i % 50 === 49) steps.push({ op: 'record-same' })
  }
  for (let i = 0; i < 10; i++) steps.push({ op: 'undo' })
  for (let i = 0; i < 4; i++) steps.push({ op: 'redo' })
  steps.push({ op: 'begin' }, { op: 'undo' }, { op: 'gesture-set', id: 'summary', x: 12.5 }, { op: 'gesture-set', id: 'summary', x: 25 }, { op: 'finish' })
  steps.push({ op: 'redo' }, { op: 'undo' }, { op: 'begin' }, { op: 'gesture-set', id: 'queue', x: 1 }, { op: 'abort' }, { op: 'begin' }, { op: 'finish' })
  for (let i = 0; i < 260; i++) steps.push({ op: 'undo' })
  steps.push({ op: 'redo' }, { op: 'record', id: 'library', x: 3 }, { op: 'redo' }, { op: 'clear' }, { op: 'undo' })
  const history = new EditHistory()
  let current: SessionDraft = { snapshot: structuredClone(source), slots: [], formatId: null }
  const set = (draft: SessionDraft, id: string, x: number): SessionDraft => {
    const next = structuredClone(draft); next.snapshot.placements.find(p => p.id === id)!.x = x; return next
  }
  const observations = steps.map((step, index) => {
    let returned: boolean | null = null
    switch (step.op) {
      case 'record': { const after = set(current, step.id, step.x); history.record(current, after); current = after; break }
      case 'record-same': history.record(current, structuredClone(current)); break
      case 'gesture-set': current = set(current, step.id, step.x); break
      case 'undo': { const r = history.undo(current); returned = !!r; if (r) current = r; break }
      case 'redo': { const r = history.redo(current); returned = !!r; if (r) current = r; break }
      case 'begin': history.begin(current); break
      case 'finish': history.finish(current); break
      case 'abort': { const r = history.abort(); returned = !!r; if (r) current = r; break }
      case 'clear': history.clear(); break
    }
    const observe = index % 97 === 0 || step.op === 'finish' || step.op === 'abort'
    return { step, returned, canUndo: history.canUndo, canRedo: history.canRedo, active: history.active,
      xs: current.snapshot.placements.map(p => p.x), digest: fnv1a(formatSignature(current.snapshot, current.slots)), signature: observe ? formatSignature(current.snapshot, current.slots) : null }
  })
  const groupRaw = serializeWorkbench(groupScene(), registryOf('plugins'))
  return document({
    start: JSON.stringify(source),
    observations,
    signatures: [
      { name: 'initial', snapshot: JSON.stringify(source), signature: formatSignature(source) },
      { name: 'group', registry: 'plugins', document: groupRaw, signature: formatSignature(parseWorkbench(groupRaw, registryOf('plugins'))) }
    ]
  })
}

interface SessionSurfaces { sizes: Record<Region, Size>; expanded: boolean }
interface ReferenceGesture { id: string; kind: Kind; original: Placement; sourceBar: string; snapshot: WorkbenchSnapshot; source: WorkbenchSnapshot; alignment?: AlignmentLocks; constraints: Constraints; zones: Region[] }
const memoryStorage = (raw: string | null) => {
  const items = new Map<string, string>(raw === null ? [] : [[WORKBENCH_KEY, raw]])
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, items }
}
/** The pure rules of useTransaction.ts and useInteraction.ts, transcribed without React or
 * DOM: the same composition of reference functions the renderer performs per intention. */
class ReferenceSession {
  committed: WorkbenchSnapshot; observed: string | null; live: WorkbenchSnapshot; checkpoint: SessionDraft
  history = new EditHistory(); editing = false; baseline: string; gesture: ReferenceGesture | null = null; message: string
  readonly initialRaw: string | null; readonly initialRecovery: boolean; recovery: boolean
  readonly registry: Registry; readonly storage: ReturnType<typeof memoryStorage>
  constructor(registry: Registry, storage: ReturnType<typeof memoryStorage>, demo: boolean) {
    this.registry = registry; this.storage = storage
    const raw = storage.getItem(WORKBENCH_KEY)
    let snapshot: WorkbenchSnapshot, recovery = false
    if (raw === null) { snapshot = initialWorkbench(demo); this.message = 'Modo de uso · layout livre protegido.' }
    else try { snapshot = parseWorkbench(raw, registry); this.message = 'Composição protegida.' }
    catch { snapshot = initialWorkbench(); recovery = true; this.message = 'Composição incompatível, plugin ausente ou armazenamento indisponível. Dados preservados; escolha uma prévia explícita em Configurações.' }
    snapshot = settleSnapshot(snapshot)
    this.committed = snapshot; this.observed = raw; this.initialRaw = raw; this.initialRecovery = recovery; this.recovery = recovery
    this.live = snapshot; this.checkpoint = { snapshot, slots: [], formatId: null }; this.baseline = formatSignature(snapshot)
  }
  current(): SessionDraft { return { snapshot: this.live, slots: [], formatId: null } }
  surface(s: SessionSurfaces, region: Region): Surface { return { ...s.sizes[region], region, expanded: s.expanded && region === 'main' } }
  view(s: SessionSurfaces) {
    const constraints = constraintsForViews(this.live, this.registry), panels = panelIds(this.live)
    const visible = { ...this.live, placements: activePlacements(this.live).filter(p => constraints[p.id] && !panels.has(p.id)) }
    const projected = Object.fromEntries((['main', 'sidebar', 'bottom'] as const).map(r => [r, projectRegion(visible, r, s.sizes[r], s.expanded && r === 'main', constraints)])) as Record<Region, ReturnType<typeof projectRegion>>
    const feasible = Object.fromEntries((['main', 'sidebar', 'bottom'] as const).map(r => [r, projected[r].feasible])) as Record<Region, boolean>
    const view: WorkbenchSnapshot = { ...this.live, reference: { ...this.live.reference }, placements: this.live.placements.map(p => projected[p.region].placements.find(q => q.id === p.id) ?? p) }
    for (const r of ['main', 'sidebar', 'bottom'] as const) {
      const m = s.sizes[r]
      if (feasible[r] && m.width > 0 && m.height > 0) view.reference[r] = { width: m.width, height: r === 'sidebar' ? Math.max(m.height, projected.sidebar.world.height) : m.height }
    }
    return { view, feasible }
  }
  put(next: WorkbenchSnapshot) {
    try { validatePresentationEdges(next) } catch { this.message = 'Borda de apresentação ocupada. Mova o outro painel antes de restaurar esta presença.'; return }
    this.live = next
  }
  action(next: WorkbenchSnapshot) {
    try { validatePresentationEdges(next) } catch { this.message = 'Borda de apresentação ocupada. Mova o outro painel antes de restaurar esta presença.'; return false }
    const before = this.current(), after = { ...before, snapshot: next }
    if (this.editing && !this.history.active) this.history.record(before, after)
    this.put(after.snapshot); return true
  }
  begin(s: SessionSurfaces) {
    if (this.recovery && !this.editing) return false
    const next = panelIds(this.live).size ? this.live : this.view(s).view
    if (!this.editing) {
      this.history.clear(); this.checkpoint = { ...this.current(), snapshot: structuredClone(this.committed), slots: [], formatId: null }
      this.baseline = formatSignature(settleSnapshot(next)); this.editing = true
    }
    this.put(settleSnapshot(structuredClone(next))); this.message = 'Edite a composição. Salvar edição confirma um checkpoint; Concluir encerra a sessão.'
    return true
  }
  pickup(id: string, kind: Kind, s: SessionSurfaces) {
    if (!this.editing || this.gesture) return null
    const { view, feasible } = this.view(s), p = view.placements.find(q => q.id === id)
    if (!p || !feasible[p.region]) return null
    this.history.begin(this.current())
    const gesture: ReferenceGesture = { id, kind, original: structuredClone(p), sourceBar: this.live.organization.activeBar, snapshot: settleSnapshot(structuredClone(view)),
      source: structuredClone(this.live), constraints: constraintsForViews(this.live, this.registry), zones: [] }
    if (kind === 'move') {
      const source = { ...gesture.snapshot, organization: { ...gesture.snapshot.organization, activeBar: this.live.organization.activeBar } }
      gesture.zones = (['main', 'sidebar', 'bottom'] as const).filter(region => feasible[region] && (region === p.region && (region !== 'sidebar' || gesture.sourceBar === source.organization.activeBar)
        || !!moveView(source, this.registry, id, this.surface(s, region), undefined, gesture.sourceBar)))
    }
    this.gesture = gesture
    return gesture.zones
  }
  frame(dx: number, dy: number, over: boolean, s: SessionSurfaces) {
    const g = this.gesture
    if (!g) return null
    const p = g.original, { feasible } = this.view(s)
    const preview = (status: 'valid' | 'blocked', reason: string | null, guides: unknown[] = [], locks: AlignmentLocks = {}, states = 0, probes = 0) =>
      ({ status, reason, placements: this.live.placements.filter(q => q.region === p.region), guides, locks, zones: g.zones, states, probes })
    if (!feasible[p.region]) return null
    if (p.region === 'sidebar' && g.sourceBar !== this.live.organization.activeBar) return preview('valid', null)
    if (p.region === 'sidebar') {
      if (g.kind === 'move') return preview('valid', null)
      const c = constraintsFor(this.surface(s, 'sidebar'), g.constraints)[p.id]!
      const height = Math.max(c.min.height, Math.min(c.max.height, p.height + (g.kind.includes('n') ? -dy : dy)))
      const next = reconcileBarHeights({ ...g.snapshot, placements: g.snapshot.placements.map(q => q.id === p.id ? { ...q, height, preferred: { width: q.width, height } } : q) })
      if (!next) return preview('blocked', 'space')
      this.put(next); return preview('valid', null)
    }
    const at = this.surface(s, p.region), snapshot = g.snapshot, panels = panelIds(snapshot)
    const peers = snapshot.placements.filter(q => q.region === p.region && !panels.has(q.id)), cs = constraintsFor(at, g.constraints)
    const adapted = p.region === 'main' && snapshot.reference.main.height !== at.height ? projectRegion({ ...snapshot, placements: peers }, 'main', at, at.expanded, g.constraints) : null
    if (adapted && !adapted.feasible) { g.alignment = undefined; this.message = 'Sem espaço para os mínimos deste widget. A última prévia válida foi mantida.'; return preview('blocked', 'space') }
    const source = adapted?.placements ?? peers, original = g.kind === 'move' ? source.find(q => q.id === p.id)! : p
    const requested = candidate(original, dx, dy, g.kind, at, cs[p.id]!)
    const alignment = over ? alignedGesture(source, p.id, requested, at, cs, g.kind, g.alignment) : null
    const result = alignment?.result ?? reflow(source, p.id, requested, at, cs, g.kind)
    g.alignment = result.status === 'valid' ? alignment?.locks : undefined
    if (result.status === 'blocked') { this.message = 'Sem espaço para os mínimos deste widget. A última prévia válida foi mantida.'; return preview('blocked', result.reason ?? null, [], {}, result.states, result.probes) }
    const live = this.live.organization
    this.put({ ...snapshot, organization: { ...live, bars: live.bars.map(bar => bar.id === live.activeBar ? { ...bar, members: [...bar.members], positions: { ...bar.positions } } : bar) },
      reference: { ...snapshot.reference, [p.region]: { width: at.width, height: at.height } }, placements: snapshot.placements.map(q => result.placements.find(next => next.id === q.id) ?? q) })
    this.message = 'Prévia válida. Ao soltar, posições e tamanhos serão mantidos para o próximo gesto. Salve ou cancele.'
    return preview('valid', null, alignment?.guides ?? [], alignment?.locks ?? {}, result.states, result.probes)
  }
  commit() {
    if (!this.gesture) return false
    this.gesture = null
    const settled = settleSnapshot(this.live)
    if (settled !== this.live) this.put(settled)
    this.history.finish(this.current()); return true
  }
  cancelGesture() {
    const g = this.gesture
    if (!g) return false
    this.gesture = null
    const before = this.history.abort(); if (before) this.put(before.snapshot)
    this.put(g.source); this.message = 'Gesto cancelado. A prévia anterior foi restaurada.'; return true
  }
  drop(region: Region, at: { x: number; y: number }, s: SessionSurfaces) {
    const g = this.gesture
    if (!g) return false
    if (g.kind !== 'move' || (region === g.original.region && region !== 'sidebar')) return this.commit()
    const { feasible } = this.view(s), bar = this.live.organization.activeBar
    this.cancelGesture()
    if (region === g.original.region) {
      const source = { ...g.snapshot, organization: { ...g.snapshot.organization, activeBar: bar } }
      const result = moveView(source, this.registry, g.id, this.surface(s, 'sidebar'), { x: 0, y: at.y }, g.sourceBar)
      if (result) { this.action(settleSnapshot(result)); this.message = 'Widget inserido na barra lateral. Salve ou cancele.'; return true }
      this.put({ ...g.source, organization: { ...g.source.organization, activeBar: bar } }); this.message = 'Destino incompatível. A composição anterior foi preservada.'; return false
    }
    const result = feasible[region] ? moveView(g.snapshot, this.registry, g.id, this.surface(s, region), at, g.sourceBar) : null
    if (result) { this.action(settleSnapshot(result)); this.message = `Widget transferido para ${REGION_LABELS[region]}. Salve ou cancele.`; return true }
    this.message = 'Transferência incompatível ou sem espaço. A composição anterior foi restaurada.'
    const plan = groupTransferPlan(g.source, this.registry, g.id, region)
    if (plan) this.message = plan.reason ?? 'Sem espaço para todas as abas elegíveis. Composição preservada.'
    return false
  }
  undo() { const next = this.history.undo(this.current()); if (next) this.put(next.snapshot); return !!next }
  redo() { const next = this.history.redo(this.current()); if (next) this.put(next.snapshot); return !!next }
  add(typeId: string, region: Region, at: { x: number; y: number } | undefined, s: SessionSurfaces) {
    if (!this.editing) return false
    if (panelIds(this.live).size && region === 'main') return false
    const next = addWidget(this.view(s).view, this.registry, typeId, this.surface(s, region), at, new Set())
    if (!next) { this.message = 'Widget incompatível ou sem espaço nesta área.'; return false }
    return this.action(next)
  }
  save(conclude: boolean, s: SessionSurfaces) {
    if (!this.editing) return false
    const { view, feasible } = this.view(s), constraints = constraintsForViews(this.live, this.registry), panels = panelIds(this.live)
    const visible = activePlacements(this.live).filter(p => constraints[p.id] && !panels.has(p.id))
    if ((['main', 'sidebar', 'bottom'] as const).some(r => !feasible[r] && visible.some(p => p.region === r))) { this.message = 'Espaço insuficiente. Amplie a região antes de salvar.'; return false }
    const next = panels.size ? this.live : { ...view, organization: this.live.organization }
    if (this.history.active) return false
    let validated: WorkbenchSnapshot
    try { validated = parseWorkbench(serializeWorkbench({ ...next, ...settleSnapshot(next) }, this.registry), this.registry) }
    catch { this.message = 'Composição inválida ou sem espaço. A prévia e os dados salvos foram preservados.'; return false }
    const result = writeWorkbench(this.storage, validated, this.registry, this.observed, this.observed === null ? null : undefined)
    if (result.error) { this.message = result.error; return false }
    this.observed = result.raw; this.committed = structuredClone(validated)
    this.checkpoint = { ...this.current(), snapshot: structuredClone(validated), slots: [], formatId: null }
    this.baseline = formatSignature(validated, [])
    this.put(validated); this.recovery = false
    if (conclude) { this.editing = false; this.history.clear() }
    this.message = conclude ? 'Composição salva. Edição concluída.' : 'Edição salva. O checkpoint de Cancelar foi atualizado.'
    return true
  }
  cancel() {
    this.gesture = null; this.history.clear(); this.put(structuredClone(this.checkpoint.snapshot))
    this.editing = false; this.recovery = this.initialRecovery && this.observed === this.initialRaw
    this.message = 'Edição cancelada. Último checkpoint confirmado restaurado.'
  }
}

type SessionStep = { op: 'begin' | 'commit' | 'cancelGesture' | 'undo' | 'redo' | 'save' | 'conclude' | 'cancel' | 'external' }
  | { op: 'pickup'; id: string; kind: Kind } | { op: 'frame'; dx: number; dy: number; over: boolean }
  | { op: 'drop'; region: Region; x: number; y: number } | { op: 'add'; typeId: string; region: Region; x?: number; y?: number }
  | { op: 'surfaces'; main: Size; sidebar: Size; bottom: Size; expanded: boolean }
interface SessionScript { name: string; registry: RegistryName; stored: string | null; demo: boolean; surfaces: SessionSurfaces; steps: SessionStep[] }
function sessionFixtures() {
  const demoRaw = serializeWorkbench(initialWorkbench(true), registryOf('demo'))
  const wide: SessionSurfaces = { sizes: { main: { width: 1567, height: 774 }, sidebar: { width: 253, height: 950 }, bottom: { width: 1543, height: 147 } }, expanded: false }
  const compact: SessionSurfaces = { sizes: { main: { width: 647, height: 414 }, sidebar: { width: 253, height: 599 }, bottom: { width: 647, height: 147 } }, expanded: false }
  const frames = (...values: [number, number, boolean?][]): SessionStep[] => values.map(([dx, dy, over]) => ({ op: 'frame', dx, dy, over: over ?? true }))
  const scripts: SessionScript[] = [
    { name: 'demo-wide', registry: 'demo', stored: demoRaw, demo: true, surfaces: wide, steps: [
      { op: 'pickup', id: 'summary', kind: 'se' }, { op: 'undo' }, { op: 'begin' },
      { op: 'pickup', id: 'summary', kind: 'se' }, ...frames([40, 30], [160, 120], [-60, -40], [0, 0], [100, 50]), { op: 'commit' },
      { op: 'undo' }, { op: 'redo' },
      { op: 'pickup', id: 'queue', kind: 'move' }, ...frames([-300, 200], [-300, 200, false], [-5, 3]), { op: 'cancelGesture' },
      { op: 'add', typeId: 'host:file-editor', region: 'main', x: 300, y: 300 }, { op: 'save' },
      { op: 'pickup', id: 'activity', kind: 'nw' }, ...frames([-50, -40], [-400, -300]), { op: 'commit' }, { op: 'undo' }, { op: 'undo' }, { op: 'redo' },
      { op: 'cancel' }, { op: 'begin' },
      { op: 'pickup', id: 'summary', kind: 'move' }, ...frames([0, 400, false]), { op: 'drop', region: 'bottom', x: 100, y: 0 }, { op: 'undo' }, { op: 'redo' },
      { op: 'pickup', id: 'notes', kind: 's' }, ...frames([0, 80], [0, 2000]), { op: 'commit' },
      { op: 'pickup', id: 'library', kind: 'move' }, ...frames([0, -300]), { op: 'drop', region: 'sidebar', x: 0, y: 0 },
      { op: 'pickup', id: 'chart', kind: 'move' }, ...frames([-50, 0]), { op: 'drop', region: 'main', x: 200, y: 100 },
      { op: 'pickup', id: 'queue', kind: 'move' }, { op: 'drop', region: 'sidebar', x: 0, y: 10 },
      { op: 'conclude' }, { op: 'undo' }, { op: 'begin' }, { op: 'external' }, { op: 'save' }, { op: 'cancel' }
    ] },
    { name: 'demo-compact', registry: 'demo', stored: demoRaw, demo: true, surfaces: compact, steps: [
      { op: 'begin' }, { op: 'pickup', id: 'queue', kind: 'w' }, ...frames([30, 0], [-120, 0], [-200, 10]), { op: 'commit' },
      { op: 'pickup', id: 'properties', kind: 'move' }, ...frames([200, -50], [400, -200]), { op: 'commit' }, { op: 'save' },
      { op: 'surfaces', ...wide.sizes, expanded: false }, { op: 'pickup', id: 'summary', kind: 'e' }, ...frames([100, 0]), { op: 'commit' },
      { op: 'surfaces', main: { width: 300, height: 200 }, sidebar: { width: 253, height: 599 }, bottom: { width: 300, height: 147 }, expanded: false },
      { op: 'pickup', id: 'summary', kind: 'move' }, { op: 'save' }, { op: 'cancel' }
    ] },
    { name: 'production-empty', registry: 'production', stored: null, demo: false, surfaces: wide, steps: [
      { op: 'begin' }, { op: 'add', typeId: 'host:summary', region: 'main' }, { op: 'add', typeId: 'host:file-explorer', region: 'sidebar' },
      { op: 'add', typeId: 'host:file-editor', region: 'main', x: 0, y: 0 }, { op: 'add', typeId: 'host:terminal', region: 'bottom', x: 0, y: 0 },
      { op: 'add', typeId: 'host:git-changes', region: 'sidebar', x: 0, y: 0 }, { op: 'undo' }, { op: 'redo' }, { op: 'save' },
      { op: 'pickup', id: 'host:file-editor:view:main', kind: 'e' }, ...frames([200, 0], [-100, 0]), { op: 'commit' }, { op: 'conclude' }
    ] },
    { name: 'recovery', registry: 'demo', stored: '{"schemaVersion":9}', demo: true, surfaces: wide, steps: [
      { op: 'begin' }, { op: 'add', typeId: 'host:file-editor', region: 'main' }, { op: 'save' }, { op: 'cancel' }
    ] }
  ]
  return document({
    scripts: scripts.map(script => {
      const storage = memoryStorage(script.stored), session = new ReferenceSession(registryOf(script.registry), storage, script.demo)
      let surfaces = script.surfaces
      const observe = (index: number, step: SessionStep, result: unknown) => {
        const draft = JSON.stringify(session.live)
        return { index, step, result: result ?? null, editing: session.editing, recovery: session.recovery, canUndo: session.history.canUndo, canRedo: session.history.canRedo,
          gesture: !!session.gesture, pending: formatSignature(session.live) !== session.baseline, message: session.message, draftDigest: fnv1a(draft),
          draft: ['commit', 'save', 'conclude', 'cancel', 'drop'].includes(step.op) ? draft : null, stored: ['save', 'conclude'].includes(step.op) ? storage.getItem(WORKBENCH_KEY) : null, storedDigest: fnv1a(storage.getItem(WORKBENCH_KEY) ?? ''),
          committed: fnv1a(JSON.stringify(session.committed)), checkpoint: fnv1a(JSON.stringify(session.checkpoint.snapshot)) }
      }
      const start = { message: session.message, draft: JSON.stringify(session.live), recovery: session.recovery }
      const observations = script.steps.map((step, index) => {
        let result: unknown
        switch (step.op) {
          case 'begin': result = session.begin(surfaces); break
          case 'pickup': result = session.pickup(step.id, step.kind, surfaces); break
          case 'frame': result = session.frame(step.dx, step.dy, step.over, surfaces); break
          case 'commit': result = session.commit(); break
          case 'cancelGesture': result = session.cancelGesture(); break
          case 'drop': result = session.drop(step.region, { x: step.x, y: step.y }, surfaces); break
          case 'undo': result = session.undo(); break
          case 'redo': result = session.redo(); break
          case 'add': result = session.add(step.typeId, step.region, step.x === undefined ? undefined : { x: step.x, y: step.y! }, surfaces); break
          case 'save': result = session.save(false, surfaces); break
          case 'conclude': result = session.save(true, surfaces); break
          case 'cancel': session.cancel(); break
          case 'external': storage.setItem(WORKBENCH_KEY, (storage.getItem(WORKBENCH_KEY) ?? '') + ' '); break
          case 'surfaces': surfaces = { sizes: { main: step.main, sidebar: step.sidebar, bottom: step.bottom }, expanded: step.expanded }; break
        }
        return observe(index, step, result)
      })
      return { name: script.name, registry: script.registry, stored: script.stored, demo: script.demo, surfaces: script.surfaces, start, observations }
    })
  })
}

/** Session slots as plain records (`sidebarBar` explicit) for the Rust reader. */
const slotRecords = (slots: readonly SessionSlot[]) => slots.map(slot => ({ id: slot.id, region: slot.region, x: slot.x, y: slot.y, width: slot.width, height: slot.height,
  sidebarBar: slot.sidebarBar ?? null, reference: slot.reference }))
/** Composition library, apply (format and widgets), capture and format-slot reservations. */
function compositionFixtures() {
  const { docs } = documents(), demo = registryOf('demo')
  const parsed = (name: string) => { const item = docs.find(doc => doc.name === name)!; return parseWorkbench(item.raw, registryOf(item.registry)) }
  const library = parsed('library'), full = structuredClone(library)
  for (let i = 3; i < 9; i++) full.organization.compositions.push({ ...structuredClone(library.organization.compositions[0]!), id: `composition:preset-${i}`, name: `Preset ${i}` })
  full.organization.favorites = ['system:default', 'system:focus', 'system:balanced', ...[0, 1, 2, 3, 4, 5].map(i => `composition:preset-${i}`)]
  let emptied = parsed('initial-demo'), sidebarEmpty = parsed('initial-demo')
  for (const p of emptied.placements.filter(p => p.region === 'main')) emptied = removePresence(emptied, p.id, demo)
  for (const p of sidebarEmpty.placements.filter(p => p.region === 'sidebar')) sidebarEmpty = removePresence(sidebarEmpty, p.id, demo)
  const all = [...docs.filter(doc => ['library', 'initial-demo', 'initial-production', 'adopted-default', 'group-composition', 'group-main', 'portable-v3'].includes(doc.name)),
    { name: 'library-full', registry: 'demo' as const, raw: serializeWorkbench(full, demo) },
    { name: 'main-empty', registry: 'demo' as const, raw: serializeWorkbench(emptied, demo) },
    { name: 'sidebar-empty', registry: 'demo' as const, raw: serializeWorkbench(sidebarEmpty, demo) }]
  const load = (name: string) => { const item = all.find(doc => doc.name === name)!, registry = registryOf(item.registry); return { registry, source: parseWorkbench(item.raw, registry) } }
  const lookup = (source: WorkbenchSnapshot, id: string, demoFixtures: boolean) => [...presets(demoFixtures), ...source.organization.compositions].find(item => item.id === id)!
  const json = (value: unknown) => value ? JSON.stringify(value) : null
  const cases: Record<string, unknown>[] = [true, false].map(demoFixtures => ({ kind: 'system', name: `system-${demoFixtures ? 'demo' : 'production'}`, demo: demoFixtures, expected: JSON.stringify(presets(demoFixtures)) }))
  const apply = (name: string, document: string, composition: string, mode: 'format' | 'widgets', demoFixtures = true) => {
    const { registry, source } = load(document)
    cases.push({ kind: 'apply', name, document, composition, mode, demo: demoFixtures, expected: json(applyComposition(source, registry, lookup(source, composition, demoFixtures), mode)) })
  }
  apply('library-default-format', 'library', 'system:default', 'format')
  apply('library-focus-format', 'library', 'system:focus', 'format')
  apply('library-balanced-widgets', 'library', 'system:balanced', 'widgets')
  apply('library-preset-widgets', 'library', 'composition:preset-1', 'widgets')
  apply('library-format-only', 'library', 'composition:format-only', 'format')
  apply('library-format-only-widgets', 'library', 'composition:format-only', 'widgets')
  apply('initial-default-widgets', 'initial-demo', 'system:default', 'widgets')
  apply('initial-focus-format', 'initial-demo', 'system:focus', 'format')
  apply('adopted-focus-format', 'adopted-default', 'system:focus', 'format')
  apply('adopted-balanced-widgets', 'adopted-default', 'system:balanced', 'widgets')
  apply('production-default-format', 'initial-production', 'system:default', 'format', false)
  apply('production-balanced-widgets', 'initial-production', 'system:balanced', 'widgets', false)
  apply('production-demo-widgets', 'initial-production', 'system:balanced', 'widgets', true)
  apply('group-widgets', 'group-composition', 'composition:grouped', 'widgets')
  apply('group-format', 'group-composition', 'composition:grouped', 'format')
  apply('portable-widgets', 'portable-v3', 'composition:portable-1', 'widgets')
  apply('portable-format', 'portable-v3', 'composition:portable-1', 'format')
  apply('empty-focus-format', 'main-empty', 'system:focus', 'format')
  const scene = (name: string, document: string, composition: string, mode: 'format' | 'widgets', scopes: Region[]) => {
    const { registry, source } = load(document), displayed = applyComposition(source, registry, lookup(source, composition, true), mode)!
    cases.push({ kind: 'scene', name, document, composition, mode, scopes, expected: JSON.stringify(compositionScene(source, displayed, scopes)) })
  }
  scene('scene-main', 'library', 'system:default', 'format', ['main'])
  scene('scene-both', 'library', 'system:balanced', 'widgets', ['main', 'bottom'])
  const favorite = (name: string, document: string, id: string, value: boolean, makeDefault = false, replace?: string) => {
    const { source } = load(document)
    cases.push({ kind: 'favorite', name, document, id, favorite: value, makeDefault, replace: replace ?? null, expected: json(favoriteComposition(source, id, value, makeDefault, replace)) })
  }
  favorite('favorite-add', 'library', 'system:focus', true)
  favorite('favorite-again', 'library', 'system:default', true)
  favorite('favorite-remove-default', 'library', 'composition:preset-1', false)
  favorite('favorite-make-default', 'library', 'composition:preset-2', true, true)
  favorite('favorite-default-unfavored', 'library', 'composition:preset-2', false, true)
  favorite('favorite-unknown', 'library', 'composition:nowhere', true)
  favorite('favorite-full', 'library-full', 'composition:format-only', true)
  favorite('favorite-full-replace-default', 'library-full', 'composition:format-only', true, false, 'composition:preset-1')
  favorite('favorite-full-replace-missing', 'library-full', 'composition:format-only', true, false, 'composition:nowhere')
  favorite('favorite-full-default', 'library-full', 'composition:format-only', true, true, 'system:focus')
  for (const document of ['library', 'library-full', 'initial-demo']) for (const favorites of [false, true]) {
    cases.push({ kind: 'order', name: `order-${document}-${favorites ? 'favorites' : 'saved'}`, document, favorites, expected: compositionOrder(load(document).source, favorites) })
  }
  const reorder = (name: string, document: string, id: string, before: string | null, favorites = false) => {
    cases.push({ kind: 'reorder', name, document, id, before, favorites, expected: json(reorderComposition(load(document).source, id, before, favorites)) })
  }
  reorder('reorder-before', 'library', 'system:default', 'composition:preset-2')
  reorder('reorder-end', 'library', 'composition:preset-2', null)
  reorder('reorder-same', 'library', 'composition:preset-2', 'system:focus')
  reorder('reorder-self', 'library', 'system:focus', 'system:focus')
  reorder('reorder-unknown', 'library', 'composition:nowhere', null)
  reorder('reorder-unknown-before', 'library', 'system:focus', 'composition:nowhere')
  reorder('reorder-favorites', 'library', 'composition:preset-1', 'system:default', true)
  reorder('reorder-favorites-missing', 'library', 'system:focus', null, true)
  reorder('reorder-initial', 'initial-demo', 'system:balanced', 'system:default')
  const slotsOf = (document: string, composition: string) => { const { source } = load(document); return compositionSlots(lookup(source, composition, true), source) }
  for (const [document, composition] of [['main-empty', 'system:focus'], ['main-empty', 'system:default'], ['initial-demo', 'system:focus'], ['library', 'composition:format-only']] as const) {
    cases.push({ kind: 'slots', name: `slots-${document}-${composition}`, document, composition, expected: slotRecords(slotsOf(document, composition)) })
  }
  const capture = (name: string, document: string, mode: Composition['mode'], scopes: Region[], chrome: ChromePatch | null, slots: SessionSlot[] = [], current?: boolean) => {
    const { source } = load(document)
    const made = current === undefined ? captureComposition(source, 'Capturada', mode, scopes, chrome ?? undefined, slots) : captureCurrentComposition(source, 'Capturada', scopes, current, slots)
    cases.push({ kind: 'capture', name, document, mode, scopes, chrome, slots: slotRecords(slots), current: current ?? null, expected: JSON.stringify({ ...made, id: 'composition:captured' }) })
  }
  // Saved compositions never scope the Sidebar; its slots are built directly to cover the bar guard.
  const focusSlots = slotsOf('main-empty', 'system:focus'), sidebarSlots: SessionSlot[] = [0, 1].map(i => ({ id: `session:manual:${i}`, region: 'sidebar', x: 0, y: i * 310,
    width: 253, height: 300, sidebarBar: 'home', reference: { width: 253, height: 950 } }))
  capture('capture-main-chrome', 'library', 'format-widgets', ['main'], { bottom: { size: 180 } })
  capture('capture-format-both', 'library', 'format', ['main', 'bottom'], null)
  capture('capture-current-both', 'library', 'format-widgets', ['main', 'bottom'], null, [], true)
  capture('capture-current-main', 'library', 'format-widgets', ['main'], null, [], false)
  capture('capture-group', 'group-composition', 'format-widgets', ['main'], { sidebar: { size: 250, visible: false } })
  capture('capture-with-slots', 'main-empty', 'format-widgets', ['main', 'bottom'], null, focusSlots)
  capture('capture-projected-slots', 'main-empty', 'format', ['main'], null, focusSlots.map(slot => projectSessionSlot(slot, { width: 1000, height: 700 })))
  capture('capture-sidebar-slots', 'sidebar-empty', 'format', ['sidebar'], null, [...sidebarSlots, ...sidebarSlots.map(slot => ({ ...slot, id: `${slot.id}:other`, sidebarBar: 'other' }))])
  const fill = (name: string, document: string, slots: SessionSlot[], id: string, surface: Surface, intention: SlotIntention, disabled: string[] = []) => {
    const { registry, source } = load(document), result = fillReservation(source, registry, slots, id, surface, intention, new Set(disabled))
    cases.push({ kind: 'fill', name, document, slots: slotRecords(slots), id, surface, intention, disabled,
      expected: result ? { snapshot: JSON.stringify(result.snapshot), slots: result.slots.map(slot => slot.id) } : null })
  }
  const emptyMain = load('main-empty').source, sidebarSurface: Surface = { region: 'sidebar', width: 253, height: 950, expanded: false }
  fill('fill-catalog', 'main-empty', focusSlots, focusSlots[0]!.id, main(emptyMain), { kind: 'catalog', typeId: 'host:file-editor' })
  fill('fill-catalog-projected', 'main-empty', focusSlots, focusSlots[1]!.id, { region: 'main', width: 1000, height: 700, expanded: false }, { kind: 'catalog', typeId: 'host:notes' })
  fill('fill-move-bottom', 'main-empty', focusSlots, focusSlots[1]!.id, main(emptyMain), { kind: 'move', viewId: 'chart', sourceBar: 'home' })
  fill('fill-move-sidebar', 'main-empty', focusSlots, focusSlots[0]!.id, main(emptyMain), { kind: 'move', viewId: 'notes', sourceBar: 'home' })
  fill('fill-move-wrong-bar', 'main-empty', focusSlots, focusSlots[0]!.id, main(emptyMain), { kind: 'move', viewId: 'notes', sourceBar: 'other' })
  fill('fill-move-missing', 'main-empty', focusSlots, focusSlots[0]!.id, main(emptyMain), { kind: 'move', viewId: 'nowhere', sourceBar: 'home' })
  fill('fill-wrong-region', 'main-empty', focusSlots, focusSlots[0]!.id, { region: 'bottom', width: 1543, height: 147, expanded: false }, { kind: 'catalog', typeId: 'host:terminal' })
  fill('fill-unknown-slot', 'main-empty', focusSlots, 'session:nowhere', main(emptyMain), { kind: 'catalog', typeId: 'host:file-editor' })
  fill('fill-sidebar', 'sidebar-empty', sidebarSlots, sidebarSlots[0]!.id, sidebarSurface, { kind: 'catalog', typeId: 'host:file-explorer' })
  fill('fill-sidebar-other-bar', 'sidebar-empty', sidebarSlots.map(slot => ({ ...slot, sidebarBar: 'other' })), sidebarSlots[0]!.id, sidebarSurface, { kind: 'catalog', typeId: 'host:file-explorer' })
  portableCases(all, load, cases)
  cases.push(...libraryScripts(load))
  return document({ cases, documents: all })
}

type LibraryDraft = Pick<SessionDraft, 'snapshot' | 'slots' | 'formatId' | 'formatMode' | 'formatSource'>
/** The displayed scene of `useTransaction`/`App.tsx` (projected regions, measured references). */
function displayedView(live: WorkbenchSnapshot, registry: Registry, s: SessionSurfaces) {
  const constraints = constraintsForViews(live, registry), panels = panelIds(live)
  const visible = { ...live, placements: activePlacements(live).filter(p => constraints[p.id] && !panels.has(p.id)) }
  const projected = Object.fromEntries((['main', 'sidebar', 'bottom'] as const).map(r => [r, projectRegion(visible, r, s.sizes[r], s.expanded && r === 'main', constraints)])) as Record<Region, ReturnType<typeof projectRegion>>
  const view: WorkbenchSnapshot = { ...live, reference: { ...live.reference }, placements: live.placements.map(p => projected[p.region].placements.find(q => q.id === p.id) ?? p) }
  for (const r of ['main', 'sidebar', 'bottom'] as const) {
    const m = s.sizes[r]
    if (projected[r].feasible && m.width > 0 && m.height > 0) view.reference[r] = { width: m.width, height: r === 'sidebar' ? Math.max(m.height, projected.sidebar.world.height) : m.height }
  }
  return view
}
/** `applyLocal` of CompositionLibrary.tsx over a draft, transcribed without React. */
function applyLocalReference(draft: LibraryDraft, view: WorkbenchSnapshot, registry: Registry, item: Composition, requested: 'format' | 'widgets'): LibraryDraft | string {
  const scene = compositionScene(draft.snapshot, view, item.scopes)
  const remainingSource = draft.formatSource?.placements.filter(p => !item.scopes.includes(p.region)) ?? []
  const retainedSource = remainingSource.length ? { placements: remainingSource, reference: structuredClone(draft.formatSource!.reference) } : null
  const slots = (next: WorkbenchSnapshot) => [...draft.slots.filter(slot => !item.scopes.includes(slot.region)), ...compositionSlots(item, next)]
  if (requested === 'format' && draft.formatMode === 'format' && draft.formatId === item.id && view.placements.some(p => item.scopes.includes(p.region))) {
    if (view.organization.groups?.entries.some(group => view.placements.some(p => p.id === group.frameId && item.scopes.includes(p.region)))) return 'Separe as abas antes de converter grupos em espaços reservados.'
    const next = { ...compositionChrome(scene, item), placements: scene.placements.filter(p => !item.scopes.includes(p.region)) }
    return { snapshot: next, slots: slots(next), formatId: item.id, formatMode: 'format', formatSource: {
      placements: [...remainingSource, ...view.placements.filter(p => item.scopes.includes(p.region))],
      reference: { ...(retainedSource?.reference ?? view.reference), ...Object.fromEntries(item.scopes.map(region => [region, structuredClone(view.reference[region])])) } } }
  }
  const base = requested === 'format' && draft.formatSource ? { ...scene, placements: [...scene.placements, ...draft.formatSource.placements.filter(p => item.scopes.includes(p.region)
    && !view.placements.some(q => q.id === p.id || q.region === p.region))] } : scene
  const next = applyComposition(base, registry, item, requested)
  if (!next) return 'Composição incompatível ou sem espaço. Amplie a região e tente novamente.'
  return { snapshot: next, slots: slots(next), formatId: item.id, formatMode: requested, formatSource: retainedSource }
}
type LibraryStep = { op: 'apply'; composition: string; mode: 'format' | 'widgets' } | { op: 'fill'; slot: number; typeId: string }
/** Library scripts: each step applies to the previous draft, as successive clicks do. */
function libraryScripts(load: (name: string) => { registry: Registry; source: WorkbenchSnapshot }) {
  const wide: SessionSurfaces = { sizes: { main: { width: 1567, height: 774 }, sidebar: { width: 253, height: 950 }, bottom: { width: 1543, height: 147 } }, expanded: false }
  const narrow: SessionSurfaces = { sizes: { main: { width: 1100, height: 600 }, sidebar: { width: 253, height: 700 }, bottom: { width: 1100, height: 147 } }, expanded: false }
  const a = (composition: string, mode: 'format' | 'widgets' = 'format'): LibraryStep => ({ op: 'apply', composition, mode })
  const scripts: { name: string; document: string; demo: boolean; surfaces: SessionSurfaces; steps: LibraryStep[] }[] = [
    { name: 'library-toggle', document: 'library', demo: true, surfaces: wide, steps: [a('system:focus'), a('system:focus'), a('system:default'), a('system:default'), a('system:default'),
      a('system:balanced', 'widgets'), a('composition:format-only'), a('composition:format-only'), { op: 'fill', slot: 0, typeId: 'host:file-editor' }, { op: 'fill', slot: 0, typeId: 'host:queue' },
      a('composition:format-only'), a('composition:preset-1', 'widgets')] },
    { name: 'library-narrow', document: 'library', demo: true, surfaces: narrow, steps: [a('system:default'), a('system:default'), a('system:focus'), a('system:balanced'), a('system:balanced')] },
    { name: 'production-empty', document: 'initial-production', demo: false, surfaces: wide, steps: [a('system:default'), { op: 'fill', slot: 0, typeId: 'host:file-editor' },
      { op: 'fill', slot: 0, typeId: 'host:terminal' }, a('system:default'), a('system:default'), a('system:focus', 'widgets')] },
    { name: 'group-tabs', document: 'group-main', demo: true, surfaces: wide, steps: [a('system:default'), a('system:default'), a('system:focus'), a('system:focus')] }
  ]
  return scripts.map(script => {
    const { registry, source } = load(script.document)
    let draft: LibraryDraft = { snapshot: source, slots: [], formatId: null, formatMode: null, formatSource: null }
    const record = (value: LibraryDraft | string) => typeof value === 'string' ? { error: value } : { snapshot: JSON.stringify(value.snapshot), slots: slotRecords(value.slots),
      formatId: value.formatId, formatMode: value.formatMode ?? null, formatSource: value.formatSource ? JSON.stringify(value.formatSource) : null }
    const observations = script.steps.map(step => {
      const view = displayedView(draft.snapshot, registry, script.surfaces)
      let result: LibraryDraft | string
      if (step.op === 'apply') {
        const item = [...presets(script.demo), ...draft.snapshot.organization.compositions].find(entry => entry.id === step.composition)!
        result = applyLocalReference(draft, view, registry, item, step.mode)
      } else {
        const slot = draft.slots[step.slot]
        const filled = slot && fillReservation(view, registry, draft.slots, slot.id, { ...script.surfaces.sizes[slot.region], region: slot.region, expanded: script.surfaces.expanded && slot.region === 'main' },
          { kind: 'catalog', typeId: step.typeId }, new Set())
        result = filled ? { ...draft, snapshot: filled.snapshot, slots: filled.slots } : 'Espaço indisponível.'
      }
      if (typeof result !== 'string') draft = result
      return { step, expected: record(result) }
    })
    return { kind: 'library', name: script.name, document: script.document, demo: script.demo, surfaces: script.surfaces, observations }
  })
}

type FixtureDoc = { name: string; registry: RegistryName; raw: string }
/** Portable recipes: file text, export, import naming, dependencies and widget resolution. */
function portableCases(all: FixtureDoc[], load: (name: string) => { registry: Registry; source: WorkbenchSnapshot }, cases: Record<string, unknown>[]) {
  const outcome = <T>(run: () => T, value: (result: T) => unknown) => { const result = attempt(run); return result.ok ? { ok: true, value: value(result.value) } : { ok: false, error: result.error } }
  const plugins = registryOf('plugins-production'), recipeOf = (document: string, id: string) => load(document).source.organization.compositions.find(item => item.id === id)!.portable!
  const recipe = recipeOf('portable-v3', 'composition:portable-1'), text = serializePortableLayout(recipe)
  const fileText = (name: string, value: string) => cases.push({ kind: 'text', name, text: value, expected: outcome(() => parsePortableText(value), serializePortableLayout) })
  fileText('text-canonical', text)
  fileText('text-pretty', JSON.stringify(JSON.parse(text), null, 2))
  fileText('text-duplicate-top', text.replace('"name":', '"name":"Outro","name":'))
  fileText('text-duplicate-nested', text.replace('"key":"s1",', '"key":"s1","key":"s1",'))
  fileText('text-sibling-keys', text)
  fileText('text-key-in-string', text.replace('"name":"Receita portátil"', '"name":"{\\"a\\":1,\\"a\\":2}"'))
  fileText('text-escaped-key', text.replace('"name":', '"na\\u006de":'))
  fileText('text-escaped-duplicate', text.replace('"name":', '"name":"x","na\\u006de":'))
  fileText('text-invalid-json', text.slice(0, -1))
  fileText('text-oversized', text + ' '.repeat(64 * 1024))
  fileText('text-bom', '﻿' + text)
  fileText('text-not-object', '[]')
  // A Main-only plugin scene without demo fixtures: host and plugin widgets can be exported.
  let bound = parseWorkbench(serializeWorkbench(initialWorkbench(false), plugins), plugins)
  const add = (typeId: string, region: Region) => { bound = addWidget(bound, plugins, typeId, { ...bound.reference[region], region, expanded: false }) ?? bound }
  add('host:file-editor', 'main'); add('host:terminal', 'bottom'); add(essentials('notes'), 'main'); add(essentials('checklist'), 'main')
  const viewOf = (name: string) => bound.organization.views.find(view => view.typeId === essentials(name))!.id
  const grouped = groupWidgets(bound, plugins, viewOf('notes'), viewOf('checklist'))!
  grouped.organization.groups!.entries[0]!.id = GROUP_ID
  grouped.organization.compositions.push({ ...captureComposition(grouped, 'Com grupo', 'format-widgets', ['main'], { bottom: { size: 180 } }), id: 'composition:grouped' })
  bound.organization.compositions.push({ ...captureComposition(bound, 'Com editor', 'format-widgets', ['main', 'bottom'], { sidebar: { size: 260 }, bottom: { size: 180 } }), id: 'composition:bound' })
  let twice = bound
  twice = addWidget(twice, plugins, essentials('notes'), { ...twice.reference.bottom, region: 'bottom', expanded: false })!
  const names = structuredClone(load('library').source)
  const long = 'A'.repeat(100), astral = 'A'.repeat(95) + '\u{1F600}' + 'BBB'
  for (const [i, name] of [long, astral, 'Equilibrado (2)'].entries()) names.organization.compositions.push({ ...structuredClone(names.organization.compositions[3]!), id: `composition:named-${i}`, name })
  const capacity = structuredClone(load('library').source)
  while (capacity.organization.compositions.length < 100) capacity.organization.compositions.push({ ...structuredClone(capacity.organization.compositions[3]!), id: `composition:fill-${capacity.organization.compositions.length}` })
  all.push({ name: 'portable-bound', registry: 'plugins-production', raw: serializeWorkbench(bound, plugins) },
    { name: 'portable-grouped', registry: 'plugins-production', raw: serializeWorkbench(grouped, plugins) },
    { name: 'portable-twice', registry: 'plugins-production', raw: serializeWorkbench(twice, plugins) },
    { name: 'library-names', registry: 'demo', raw: serializeWorkbench(names, registryOf('demo')) },
    { name: 'library-capacity', registry: 'demo', raw: serializeWorkbench(capacity, registryOf('demo')) })
  const exported = (name: string, document: string, id: string) => {
    const { registry, source } = load(document), saved = [...presets(true), ...source.organization.compositions].find(item => item.id === id)!
    cases.push({ kind: 'export', name, document, composition: id, expected: outcome(() => exportPortableComposition(saved, registry), serializePortableLayout) })
  }
  exported('export-format-only', 'library', 'composition:format-only')
  exported('export-fixture-views', 'library', 'composition:preset-1')
  exported('export-system', 'library', 'system:default')
  exported('export-portable', 'portable-v3', 'composition:portable-1')
  exported('export-group', 'group-composition', 'composition:grouped')
  exported('export-bound', 'portable-bound', 'composition:bound')
  exported('export-grouped', 'portable-grouped', 'composition:grouped')
  const boundText = serializePortableLayout(exportPortableComposition(load('portable-bound').source.organization.compositions.find(item => item.id === 'composition:bound')!, plugins))
  const groupText = serializePortableLayout(exportPortableComposition(load('portable-grouped').source.organization.compositions.find(item => item.id === 'composition:grouped')!, plugins))
  const formatText = serializePortableLayout(exportPortableComposition(load('library').source.organization.compositions.find(item => item.id === 'composition:format-only')!, registryOf('demo')))
  const imported = (name: string, document: string, value: string, requested: string) => {
    const { source } = load(document)
    cases.push({ kind: 'import', name, document, text: value, requested, expected: outcome(() => importPortableComposition(source, parsePortableText(value), requested), item => JSON.stringify({ ...item, id: 'composition:imported' })) })
  }
  imported('import-plain', 'library', text, 'Receita portátil')
  imported('import-system-name', 'library', text, 'Padrão')
  imported('import-case-insensitive', 'library', text, '  padrão  ')
  imported('import-saved-name', 'library', formatText, 'Só formato')
  imported('import-third', 'library-names', formatText, 'Equilibrado')
  imported('import-long', 'library-names', formatText, long)
  imported('import-astral-cut', 'library-names', formatText, astral)
  imported('import-blank', 'library', text, '   ')
  imported('import-control', 'library', text, 'Nome\u0007')
  imported('import-too-long', 'library', text, 'B'.repeat(101))
  imported('import-capacity', 'library-capacity', text, 'Receita portátil')
  imported('import-group', 'portable-grouped', groupText, 'Grupo importado')
  const record = (document: string, value: string) => ({ ...importPortableComposition(load(document).source, parsePortableText(value), 'Importada'), id: 'composition:imported' })
  const dependencies = (name: string, document: string, value: string, disabled: string[] = []) => {
    const { registry, source } = load(document)
    cases.push({ kind: 'dependencies', name, document, text: value, disabled, expected: portableDependencies(source, registry, record(document, value), new Set(disabled)) })
  }
  dependencies('deps-none-local', 'portable-v3', text)
  dependencies('deps-bound', 'portable-bound', boundText)
  dependencies('deps-disabled', 'portable-bound', boundText, ['plugin:geppio.workspace-essentials'])
  dependencies('deps-twice', 'portable-twice', boundText)
  dependencies('deps-group', 'portable-grouped', groupText)
  dependencies('deps-group-ungrouped', 'portable-bound', groupText)
  dependencies('deps-group-demo', 'group-main', groupText)
  dependencies('deps-format', 'library', formatText)
  dependencies('deps-foreign', 'portable-bound', text)
  const uuid = crypto.randomUUID.bind(crypto)
  let counter = 0
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` })
  try {
    const resolve = (name: string, document: string, value: string, choices: Record<string, string> = {}, disabled: string[] = []) => {
      const { registry, source } = load(document)
      const item = record(document, value)
      counter = 0
      const resolved = resolvePortableWidgets(source, registry, item, new Set(disabled), choices)
      cases.push({ kind: 'resolve', name, document, text: value, choices, disabled, expected: resolved ? JSON.stringify(resolved) : null })
    }
    resolve('resolve-bound', 'portable-bound', boundText)
    resolve('resolve-disabled', 'portable-bound', boundText, {}, ['plugin:geppio.workspace-essentials'])
    resolve('resolve-moved', 'portable-twice', boundText)
    resolve('resolve-explicit-choice', 'portable-bound', boundText, { v1: 'host:file-editor:view:main' })
    resolve('resolve-wrong-choice', 'portable-bound', boundText, { v1: 'host:terminal:view:bottom' })
    resolve('resolve-empty-choice', 'portable-bound', boundText, { v1: '' })
    resolve('resolve-unknown-key', 'portable-bound', boundText, { v9: 'nowhere' })
    resolve('resolve-group', 'portable-grouped', groupText)
    resolve('resolve-group-new', 'portable-bound', groupText)
    resolve('resolve-group-demo', 'group-main', groupText)
    resolve('resolve-format', 'library', formatText)
    resolve('resolve-foreign', 'portable-bound', text)
  } finally { Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: uuid }) }
}

/** Presentation changes, the Main panel arrangement and the return to Normal (stage C2b). */
function presentationFixtures() {
  const registry = demoRegistry(), cases: Record<string, unknown>[] = []
  const doc = (snapshot: WorkbenchSnapshot) => serializeWorkbench(snapshot, registry)
  // Every source goes through the codec, as the Rust port reads it.
  const read = (snapshot: WorkbenchSnapshot) => parseWorkbench(doc(snapshot), registry)
  const change = (name: string, input: WorkbenchSnapshot, patch: PresentationPatch, id: string) => {
    const source = read(input)
    const result = attempt(() => changePresentation(source, patch, registry, id))
    cases.push({ kind: 'change', name, document: doc(source), patch, id, expected: result.ok ? doc(result.value) : null, error: result.ok ? null : result.error })
    return result.ok ? result.value : source
  }
  const base = initialWorkbench(true)
  const bottom = change('docked-bottom', base, { presentation: 'docked', anchor: 'bottom' }, 'properties')
  const left = change('docked-left-closed', bottom, { anchor: 'left', open: false }, 'properties')
  const top = change('overlay-top', bottom, { presentation: 'overlay', anchor: 'top' }, 'summary')
  const free = change('overlay-free', top, { presentation: 'overlay', anchor: null }, 'queue')
  const two = change('overlay-free-second', free, { presentation: 'overlay', anchor: null, position: { x: 30, y: 40 } }, 'activity')
  const wide = change('preferred-large', bottom, { preferred: { width: 900, height: 700 } }, 'properties')
  const right = change('docked-right', base, { presentation: 'docked', anchor: 'right', preferred: { width: 380, height: 260 } }, 'activity')
  change('occupied-edge', bottom, { presentation: 'docked', anchor: 'bottom' }, 'summary')
  change('anchor-required', base, { presentation: 'docked' }, 'properties')
  change('not-in-main', base, { presentation: 'docked', anchor: 'top' }, 'notes')
  change('back-to-normal', bottom, { presentation: 'normal' }, 'properties')
  change('open-toggle', bottom, { open: false }, 'properties')
  const sizes: Size[] = [{ width: 927, height: 494 }, { width: 600, height: 400 }, { width: 400, height: 300 }, { width: 1200, height: 700 }, { width: 200, height: 120 }]
  const scenes: [string, WorkbenchSnapshot][] = [['bottom', bottom], ['left', left], ['top', top], ['free', free], ['two', two], ['wide', wide], ['right', right]]
  for (const [name, input] of scenes) for (const size of sizes) {
    const source = read(input), constraints = constraintsForViews(source, registry)
    for (const [expanded, scrollbar] of [[false, 0], [true, 10]] as const) {
      const layout = arrangePresentations(source, size, constraints, expanded, scrollbar)
      cases.push({ kind: 'arrange', name: `${name}-${size.width}x${size.height}-${expanded ? 'expanded' : 'fit'}`, document: doc(source), size, expanded, scrollbar,
        expected: { normal: layout.normal, reservations: layout.reservations, adapted: layout.adapted, feasible: layout.feasible,
          panels: Object.values(layout.panels).map(p => ({ id: p.state.viewId, expanded: p.expanded, collapsed: p.collapsed, shown: p.shown, adapted: p.adapted })) } })
    }
  }
  const back = (name: string, input: WorkbenchSnapshot, id: string, size: Size) => {
    const source = read(input), result = attempt(() => returnToNormal(source, id, size, registry))
    cases.push({ kind: 'normal', name, document: doc(source), id, size, expected: result.ok && result.value ? doc(result.value) : null, error: result.ok ? null : result.error })
  }
  back('normal-from-bottom', bottom, 'properties', { width: 927, height: 494 })
  back('normal-from-top', top, 'summary', { width: 927, height: 494 })
  back('normal-from-free', two, 'activity', { width: 1200, height: 700 })
  back('normal-small', bottom, 'properties', { width: 400, height: 300 })
  back('normal-right', right, 'activity', { width: 1200, height: 700 })
  return document({ cases })
}

export function buildFixtures(): Record<string, string> {
  return { 'layout.json': layoutFixtures(), 'projection.json': projectionFixtures(), 'registry.json': registryFixtures(), 'codec.json': codecFixtures(),
    'commands.json': commandFixtures(), 'history.json': historyFixtures(), 'session.json': sessionFixtures(), 'compositions.json': compositionFixtures(),
    'presentations.json': presentationFixtures() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  for (const [name, text] of Object.entries(buildFixtures())) {
    writeFileSync(join(FIXTURE_DIR, name), text)
    console.log(`${name}: ${text.length} bytes`)
  }
}
