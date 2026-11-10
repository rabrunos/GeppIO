import type { Composition, DemoArchive, Registry, WorkbenchSnapshot } from './model.ts'
import { initialWorkbench } from './model.ts'

/** Only already validated identities are retired. Unknown/corrupt data still
 * belongs to the existing recovery path. The archive survives explicit saves;
 * startup projection never writes or replaces the original storage bytes.
 */
export function retireDemoViews(source: WorkbenchSnapshot, registry: Registry): WorkbenchSnapshot {
  const retired = source.organization.views.filter(view => registry.get(view.typeId)?.retired)
  if (!retired.length) return source
  const ids = new Set(retired.map(view => view.id)), types = new Set(retired.map(view => view.typeId))
  if (source.retiredDemos) throw new Error('Conflicting retired demo archive')
  const bars = source.organization.bars.map(bar => ({ id: bar.id, members: bar.members.filter(id => types.has(id)),
    positions: Object.fromEntries(Object.entries(bar.positions ?? {}).filter(([id]) => types.has(id))) })).filter(bar => bar.id === 'home' || bar.members.length)
  const retiredDemos: DemoArchive = { reference: structuredClone(source.reference), views: retired,
    placements: source.placements.filter(p => ids.has(p.id)), bars,
    presentations: { version: 2, entries: (source.organization.presentations?.entries ?? []).filter(entry => ids.has(entry.viewId)) } }
  return { ...source, retiredDemos, placements: source.placements.filter(p => !ids.has(p.id)), organization: {
    ...source.organization, views: source.organization.views.filter(view => !ids.has(view.id)),
    bars: source.organization.bars.map(bar => ({ ...bar, members: bar.members.filter(id => !types.has(id)),
      positions: Object.fromEntries(Object.entries(bar.positions ?? {}).filter(([id]) => !types.has(id))) })),
    presentations: { version: 2, entries: (source.organization.presentations?.entries ?? []).filter(entry => !ids.has(entry.viewId)) }
  } }
}

/** Keep saved records and their format geometry recoverable. Applying their
 * widget associations cannot reactivate a retired type in a normal workspace.
 */
export function availableComposition(source: Composition, registry: Registry): Composition {
  const views = source.views.filter(view => !registry.get(view.typeId)?.retired)
  const ids = new Set(views.map(view => view.id))
  return { ...source, views, placements: source.placements.filter(p => ids.has(p.id)) }
}

export function resetWorkbench(source: WorkbenchSnapshot, demoFixtures = false): WorkbenchSnapshot {
  const initial = initialWorkbench(demoFixtures)
  return demoFixtures ? initial : { ...initial, retiredDemos: source.retiredDemos,
    organization: { ...source.organization, ...(source.organization.groups ? { groups: undefined } : {}), chrome: initial.organization.chrome, presentations: initial.organization.presentations },
    placements: source.placements.filter(p => p.region === 'sidebar') }
}
